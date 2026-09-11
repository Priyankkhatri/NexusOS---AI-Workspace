import { createHash } from 'node:crypto';
import {
  MemoryRecord,
  MemoryStatus,
  MemorySourceType,
  MemoryGraphEdgeType,
  GraphExtractionResult,
  GraphEvolutionPlan,
  GraphEvolutionOperation,
  GraphEvolutionOperationType,
  EvolutionReceipt,
  GraphEvolutionOptions,
  EvolutionRejectedNode,
  EvolutionRejectedEdge,
  MemoryGraphNodeInput,
  MemoryGraphEdgeInput,
  computeCandidateSetHash,
  computeEvolutionDeliveryId,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  IGraphExtractor,
  IGraphEvolutionEngine,
  MemoryServiceContext,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from './types.js';
import { GraphExtractor, normalizeToCanonicalKey } from './graph-extractor.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { Logger } from '../observability/logger.js';

export interface GraphEvolutionEngineOptions {
  store: IMemoryStore;
  extractor?: IGraphExtractor;
  logger?: Logger;
  nowProvider?: () => string;
}

/**
 * Deterministic canonical node entity ID computation via SHA-256.
 * node-{SHA256(tenantId:workspaceId:nodeType:canonicalKey)[0..16]}
 */
export function computeCanonicalNodeId(
  tenantId: string,
  workspaceId: string,
  nodeType: string,
  canonicalKey: string,
): string {
  const hash = createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${nodeType}:${canonicalKey}`)
    .digest('hex')
    .slice(0, 16);
  return `node-${hash}`;
}

/**
 * Deterministic canonical edge entity ID computation via SHA-256.
 * edge-{SHA256(tenantId:workspaceId:sourceId:targetId:edgeType)[0..16]}
 */
export function computeCanonicalEdgeId(
  tenantId: string,
  workspaceId: string,
  sourceId: string,
  targetId: string,
  edgeType: string,
): string {
  const hash = createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${sourceId}:${targetId}:${edgeType}`)
    .digest('hex')
    .slice(0, 16);
  return `edge-${hash}`;
}

/**
 * Governed Graph Evolution Engine (Task 066 Phase 3)
 *
 * Ingests unverified extraction candidates from GraphExtractor,
 * enforces multi-tenant security boundaries, secret sanitization,
 * entity canonicalization, optimistic locking, and temporal supersession.
 *
 * CRITICAL INVARIANT:
 * Graph is strictly ADVISORY DATA, NEVER an authority (066-P3-SEC-01).
 * All evolved assertions remain verified: false (066-P3-SEC-03).
 */
export class GraphEvolutionEngine implements IGraphEvolutionEngine {
  private readonly store: IMemoryStore;
  private readonly extractor: IGraphExtractor;
  private readonly logger: Logger;
  private readonly now: () => string;

  constructor(options: GraphEvolutionEngineOptions) {
    this.store = options.store;
    this.extractor = options.extractor ?? new GraphExtractor();
    this.logger = options.logger ?? new Logger('info');
    this.now = options.nowProvider ?? (() => new Date().toISOString());
  }

  public getExtractor(): IGraphExtractor {
    return this.extractor;
  }

  /**
   * Evolve the persistent knowledge graph from a governed MemoryRecord.
   */
  public async evolveFromRecord(
    record: MemoryRecord,
    ctx: MemoryServiceContext,
    options?: GraphEvolutionOptions,
  ): Promise<EvolutionReceipt> {
    // 1. Extract candidates from the memory record via Phase 2 GraphExtractor
    const candidates = await this.extractor.extract(record);
    return this.evolveCandidates(record, candidates, ctx, options);
  }

  /**
   * Evolve the persistent knowledge graph given pre-extracted candidates.
   */
  public async evolveCandidates(
    record: MemoryRecord,
    candidates: GraphExtractionResult,
    ctx: MemoryServiceContext,
    options?: GraphEvolutionOptions,
  ): Promise<EvolutionReceipt> {
    const startTime = performance.now();
    const evolvedAt = options?.evolvedAt ?? this.now();
    const minConfidence = options?.minConfidence ?? 0.5;

    // -------------------------------------------------------------------------
    // 066-P3-SEC-02: Tenant & Workspace Isolation
    // -------------------------------------------------------------------------
    if (ctx.tenantId !== record.tenantId || ctx.workspaceId !== record.workspaceId) {
      throw new MemorySecurityViolationError(
        `066-P3-SEC-02: Tenant/Workspace boundary violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot evolve record in (${record.tenantId}/${record.workspaceId}).`,
      );
    }
    if (candidates.tenantId !== record.tenantId || candidates.workspaceId !== record.workspaceId) {
      throw new MemorySecurityViolationError(
        `066-P3-SEC-02: Candidate tenant/workspace mismatch with parent record.`,
      );
    }

    // -------------------------------------------------------------------------
    // 066-P3-SEC-04: Validate Parent MemoryRecord Liveness & Status
    // -------------------------------------------------------------------------
    const existingParent = await this.store.getById(record.id, ctx.tenantId, ctx.workspaceId);
    if (!existingParent) {
      throw new MemorySecurityViolationError(
        `066-P3-SEC-04: Cannot evolve graph for non-existent or TOMBSTONED parent memory record '${record.id}'.`,
      );
    }
    if (existingParent.status !== MemoryStatus.ACTIVE) {
      throw new MemorySecurityViolationError(
        `066-P3-SEC-04: Cannot evolve graph from inactive (not ACTIVE) parent memory record '${record.id}' (status: ${existingParent.status}).`,
      );
    }

    // Check expiration
    if (existingParent.retentionPolicy?.expiresAt) {
      const expiresAtMs = new Date(existingParent.retentionPolicy.expiresAt).getTime();
      const nowMs = new Date(evolvedAt).getTime();
      if (expiresAtMs <= nowMs) {
        throw new MemorySecurityViolationError(
          `066-P3-SEC-04: Cannot evolve graph from expired parent memory record '${record.id}'.`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // 066-P3-SEC-01: Secret Sanitization Fail-Closed on all candidates
    // -------------------------------------------------------------------------
    try {
      for (const node of candidates.nodes) {
        RedactionFilter.assertNoSecrets(node.label, `Candidate node label '${node.label}'`);
        if (node.properties) {
          for (const [k, v] of Object.entries(node.properties)) {
            if (typeof v === 'string') {
              RedactionFilter.assertNoSecrets(v, `Candidate node property '${k}'`);
            }
          }
        }
      }
      for (const edge of candidates.edges) {
        if (edge.properties) {
          for (const [k, v] of Object.entries(edge.properties)) {
            if (typeof v === 'string') {
              RedactionFilter.assertNoSecrets(v, `Candidate edge property '${k}'`);
            }
          }
        }
      }
    } catch (err) {
      throw new MemorySecretDetectedError(
        `066-P3-SEC-01: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // -------------------------------------------------------------------------
    // Candidate Evaluation, Canonicalization & Conflict Planning
    // -------------------------------------------------------------------------
    const operations: GraphEvolutionOperation[] = [];
    const rejectedNodes: EvolutionRejectedNode[] = [];
    const rejectedEdges: EvolutionRejectedEdge[] = [];

    // Map: candidateNodeId -> persistent canonical nodeId
    const candidateToCanonicalNodeId = new Map<string, string>();
    // Set of persistent node IDs that are known active or planned in this batch
    const activeOrPlannedNodeIds = new Set<string>();

    // Process Candidate Nodes
    for (const candNode of candidates.nodes) {
      // 1. Confidence threshold check
      if (candNode.confidence < minConfidence) {
        rejectedNodes.push({
          candidateId: candNode.candidateId,
          label: candNode.label,
          reason: `LOW_CONFIDENCE: ${candNode.confidence} < ${minConfidence}`,
        });
        continue;
      }

      const canonicalKey = normalizeToCanonicalKey(candNode.label);
      if (!canonicalKey) {
        rejectedNodes.push({
          candidateId: candNode.candidateId,
          label: candNode.label,
          reason: 'EMPTY_CANONICAL_KEY',
        });
        continue;
      }

      const canonicalId = computeCanonicalNodeId(
        record.tenantId,
        record.workspaceId,
        candNode.nodeType,
        canonicalKey,
      );

      candidateToCanonicalNodeId.set(candNode.candidateId, canonicalId);
      activeOrPlannedNodeIds.add(canonicalId);

      // Check if canonical node already exists in store
      let existing = await this.store.getGraphNode(
        canonicalId,
        record.tenantId,
        record.workspaceId,
      );
      if (!existing && typeof candNode.properties?.supersedes === 'string') {
        existing = await this.store.getGraphNode(
          candNode.properties.supersedes,
          record.tenantId,
          record.workspaceId,
        );
      }
      if (!existing && typeof candNode.properties?.supersedesNodeId === 'string') {
        existing = await this.store.getGraphNode(
          candNode.properties.supersedesNodeId,
          record.tenantId,
          record.workspaceId,
        );
      }

      // 066-P3-R-04: Monotonic Version Fencing (Phase 7 & Phase 8)
      // Only reject strictly-stale incoming versions. Same-version re-evolution is
      // legitimate (refinements, supersessions, idempotent replay) and is guarded by
      // the store's OCC expectedVersion check at persist time.
      if (existing) {
        const lastAppliedVersion = existing.lastMemoryVersion ?? 1;

        // Rule: incomingVersion < lastAppliedVersion => reject as stale
        if (record.version < lastAppliedVersion) {
          rejectedNodes.push({
            candidateId: candNode.candidateId,
            label: candNode.label,
            reason: `STALE_MEMORY_VERSION: incoming memory version ${record.version} < applied graph version ${lastAppliedVersion}`,
          });
          continue;
        }
      }

      // 066-P3-SEC-03: Extracted facts strictly enforce verified: false
      const unverifiedProvenance = {
        sourceType: record.provenance?.sourceType ?? MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: ctx.principalId,
        sourceId: record.id,
        timestamp: evolvedAt,
        verified: false,
      };

      if (!existing) {
        // Node does not exist: ADD_NODE
        const newNode: MemoryGraphNodeInput = {
          id: canonicalId,
          tenantId: record.tenantId,
          workspaceId: record.workspaceId,
          nodeType: candNode.nodeType,
          label: candNode.label,
          confidence: candNode.confidence,
          memoryRecordId: record.id,
          properties: {
            ...candNode.properties,
            canonicalKey,
          },
          provenance: unverifiedProvenance,
          version: 1,
          lastMemoryVersion: record.version,
          isCurrent: true,
          validFrom: evolvedAt,
          createdAt: evolvedAt,
          updatedAt: evolvedAt,
        };

        operations.push({
          operationType: GraphEvolutionOperationType.ADD_NODE,
          node: newNode,
        });
      } else {
        // Node exists: determine Refinement vs. Supersession
        const isExplicitSupersession =
          Boolean(candNode.properties?.supersedes) ||
          Boolean(candNode.properties?.replaces) ||
          Boolean(candNode.properties?.contradicts) ||
          Boolean(candNode.properties?.contrary) ||
          Boolean(candNode.properties?.incompatible);

        if (isExplicitSupersession) {
          // 066-P3-SEC-06: Contradiction / Supersession: new immutable ID, link with SUPERSEDES
          const newVersion = existing.version + 1;
          const newImmutableId = `${canonicalId}-v${newVersion}`;
          activeOrPlannedNodeIds.add(newImmutableId);
          candidateToCanonicalNodeId.set(candNode.candidateId, newImmutableId);

          const replacementNode: MemoryGraphNodeInput = {
            id: newImmutableId,
            tenantId: record.tenantId,
            workspaceId: record.workspaceId,
            nodeType: candNode.nodeType,
            label: candNode.label,
            confidence: candNode.confidence,
            memoryRecordId: record.id,
            properties: {
              ...existing.properties,
              ...candNode.properties,
              canonicalKey,
            },
            provenance: unverifiedProvenance,
            version: 1,
            lastMemoryVersion: record.version,
            isCurrent: true,
            validFrom: evolvedAt,
            createdAt: evolvedAt,
            updatedAt: evolvedAt,
          };

          operations.push({
            operationType: GraphEvolutionOperationType.SUPERSEDE_NODE,
            targetId: existing.id,
            expectedVersion: existing.version,
            validTo: evolvedAt,
            supersededBy: newImmutableId,
            node: replacementNode,
          });

          // Establish directional SUPERSEDES edge: new -> old
          const supersedesEdgeId = computeCanonicalEdgeId(
            record.tenantId,
            record.workspaceId,
            newImmutableId,
            existing.id,
            MemoryGraphEdgeType.SUPERSEDES,
          );

          operations.push({
            operationType: GraphEvolutionOperationType.ADD_EDGE,
            edge: {
              id: supersedesEdgeId,
              tenantId: record.tenantId,
              workspaceId: record.workspaceId,
              sourceNodeId: newImmutableId,
              targetNodeId: existing.id,
              edgeType: MemoryGraphEdgeType.SUPERSEDES,
              confidence: 1.0,
              weight: 1.0,
              properties: { reason: 'fact_contradiction_supersession' },
              provenance: unverifiedProvenance,
              version: 1,
              lastMemoryVersion: record.version,
              isCurrent: true,
              validFrom: evolvedAt,
              createdAt: evolvedAt,
              updatedAt: evolvedAt,
            },
          });
        } else {
          // Compatible Refinement: update in place with OCC
          const mergedConfidence = Math.max(existing.confidence, candNode.confidence);
          const refinedNode: MemoryGraphNodeInput = {
            ...existing,
            label: candNode.label, // update to freshest label casing
            confidence: mergedConfidence,
            properties: {
              ...existing.properties,
              ...candNode.properties,
              canonicalKey,
            },
            provenance: unverifiedProvenance,
            lastMemoryVersion: record.version,
            updatedAt: evolvedAt,
          };

          operations.push({
            operationType: GraphEvolutionOperationType.REFINE_NODE,
            targetId: existing.id,
            expectedVersion: existing.version,
            node: refinedNode,
          });
        }
      }
    }

    // Process Candidate Edges
    for (const candEdge of candidates.edges) {
      if (candEdge.confidence < minConfidence) {
        rejectedEdges.push({
          candidateId: candEdge.candidateId,
          sourceNodeId: candEdge.sourceNodeId,
          targetNodeId: candEdge.targetNodeId,
          reason: `LOW_CONFIDENCE: ${candEdge.confidence} < ${minConfidence}`,
        });
        continue;
      }

      // Remap candidate node IDs to canonical persistent node IDs
      const rawSource = candEdge.sourceNodeId;
      const rawTarget = candEdge.targetNodeId;

      if (!rawSource || !rawTarget) {
        rejectedEdges.push({
          candidateId: candEdge.candidateId,
          sourceNodeId: rawSource ?? 'unknown',
          targetNodeId: rawTarget ?? 'unknown',
          reason: 'MISSING_ENDPOINT: candidate edge lacks sourceNodeId or targetNodeId',
        });
        continue;
      }

      const canonicalSourceId = candidateToCanonicalNodeId.get(rawSource) ?? rawSource;
      const canonicalTargetId = candidateToCanonicalNodeId.get(rawTarget) ?? rawTarget;

      // Referential Integrity Check: endpoints must exist or be planned
      const sourceValid =
        activeOrPlannedNodeIds.has(canonicalSourceId) ||
        (await this.store.getGraphNode(canonicalSourceId, record.tenantId, record.workspaceId)) !==
          null;

      const targetValid =
        activeOrPlannedNodeIds.has(canonicalTargetId) ||
        (await this.store.getGraphNode(canonicalTargetId, record.tenantId, record.workspaceId)) !==
          null;

      if (!sourceValid || !targetValid) {
        rejectedEdges.push({
          candidateId: candEdge.candidateId,
          sourceNodeId: canonicalSourceId,
          targetNodeId: canonicalTargetId,
          reason: `DANGLING_ENDPOINT: sourceValid=${sourceValid}, targetValid=${targetValid}`,
        });
        continue;
      }

      const canonicalEdgeId = computeCanonicalEdgeId(
        record.tenantId,
        record.workspaceId,
        canonicalSourceId,
        canonicalTargetId,
        candEdge.edgeType,
      );

      const unverifiedProvenance = {
        sourceType: record.provenance?.sourceType ?? MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: ctx.principalId,
        sourceId: record.id,
        timestamp: evolvedAt,
        verified: false,
      };

      const existingEdge = await this.store.getGraphEdge(
        canonicalEdgeId,
        record.tenantId,
        record.workspaceId,
      );

      if (existingEdge) {
        const lastAppliedVersion = existingEdge.lastMemoryVersion ?? 1;

        // Rule: incomingVersion < lastAppliedVersion => reject as stale
        // Same-version re-evolution is handled by OCC at the store layer.
        if (record.version < lastAppliedVersion) {
          rejectedEdges.push({
            candidateId: candEdge.candidateId,
            sourceNodeId: canonicalSourceId,
            targetNodeId: canonicalTargetId,
            reason: `STALE_MEMORY_VERSION: incoming memory version ${record.version} < applied graph edge version ${lastAppliedVersion}`,
          });
          continue;
        }
      }

      if (!existingEdge) {
        // Edge does not exist: ADD_EDGE
        const newEdge: MemoryGraphEdgeInput = {
          id: canonicalEdgeId,
          tenantId: record.tenantId,
          workspaceId: record.workspaceId,
          sourceNodeId: canonicalSourceId,
          targetNodeId: canonicalTargetId,
          edgeType: candEdge.edgeType,
          confidence: candEdge.confidence,
          weight: candEdge.weight,
          properties: candEdge.properties ?? {},
          provenance: unverifiedProvenance,
          version: 1,
          lastMemoryVersion: record.version,
          isCurrent: true,
          validFrom: evolvedAt,
          createdAt: evolvedAt,
          updatedAt: evolvedAt,
        };

        operations.push({
          operationType: GraphEvolutionOperationType.ADD_EDGE,
          edge: newEdge,
        });
      } else {
        // Existing edge: check if explicit supersession or skip duplicate
        const isExplicitSupersession =
          candEdge.properties?.supersedes === true || candEdge.properties?.replaces === true;

        if (isExplicitSupersession && existingEdge.isCurrent) {
          const newEdgeVersion = existingEdge.version + 1;
          const newEdgeId = `${canonicalEdgeId}-v${newEdgeVersion}`;

          const replacementEdge: MemoryGraphEdgeInput = {
            id: newEdgeId,
            tenantId: record.tenantId,
            workspaceId: record.workspaceId,
            sourceNodeId: canonicalSourceId,
            targetNodeId: canonicalTargetId,
            edgeType: candEdge.edgeType,
            confidence: candEdge.confidence,
            weight: candEdge.weight,
            properties: candEdge.properties ?? {},
            provenance: unverifiedProvenance,
            version: 1,
            lastMemoryVersion: record.version,
            isCurrent: true,
            validFrom: evolvedAt,
            createdAt: evolvedAt,
            updatedAt: evolvedAt,
          };

          operations.push({
            operationType: GraphEvolutionOperationType.SUPERSEDE_EDGE,
            targetId: existingEdge.id,
            expectedVersion: existingEdge.version,
            validTo: evolvedAt,
            supersededBy: newEdgeId,
            edge: replacementEdge,
          });
        }
        // If compatible/duplicate existing edge without supersession, no-op to maintain idempotency
      }
    }

    // -------------------------------------------------------------------------
    // Assemble Plan & Execute Atomic Evolution via Store (066-P3-SEC-07)
    // -------------------------------------------------------------------------
    const candidateSetHash = computeCandidateSetHash(candidates);
    const deterministicEvolutionId =
      options?.evolutionId ??
      computeEvolutionDeliveryId(
        record.tenantId,
        record.workspaceId,
        record.id,
        record.version,
        candidateSetHash,
      );

    const plan: GraphEvolutionPlan = {
      evolutionId: deterministicEvolutionId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      memoryRecordId: record.id,
      memoryVersion: record.version,
      operations,
      createdAt: evolvedAt,
    };

    if (options?.dryRun) {
      return {
        evolutionId: plan.evolutionId,
        tenantId: plan.tenantId,
        workspaceId: plan.workspaceId,
        memoryRecordId: plan.memoryRecordId,
        memoryVersion: plan.memoryVersion,
        acceptedNodes: operations
          .filter((o) => o.operationType === GraphEvolutionOperationType.ADD_NODE && o.node)
          .map((o) => o.node!.id),
        acceptedEdges: operations
          .filter((o) => o.operationType === GraphEvolutionOperationType.ADD_EDGE && o.edge)
          .map((o) => o.edge!.id),
        supersededNodeIds: operations
          .filter(
            (o) => o.operationType === GraphEvolutionOperationType.SUPERSEDE_NODE && o.targetId,
          )
          .map((o) => o.targetId!),
        supersededEdgeIds: operations
          .filter(
            (o) => o.operationType === GraphEvolutionOperationType.SUPERSEDE_EDGE && o.targetId,
          )
          .map((o) => o.targetId!),
        rejectedNodes,
        rejectedEdges,
        evolvedAt,
        executionDurationMs: Math.round(performance.now() - startTime),
        idempotentSkip: false,
      };
    }

    // Execute atomic evolution in store
    const receipt = await this.store.evolveGraph(plan, ctx);

    // Merge rejected counts into the receipt
    receipt.rejectedNodes = rejectedNodes;
    receipt.rejectedEdges = rejectedEdges;
    receipt.executionDurationMs = Math.round(performance.now() - startTime);

    this.logger.info(`Graph evolved for memory record: ${record.id}`, {
      details: {
        evolutionId: receipt.evolutionId,
        acceptedNodes: receipt.acceptedNodes.length,
        acceptedEdges: receipt.acceptedEdges.length,
        supersededNodes: receipt.supersededNodeIds.length,
        supersededEdges: receipt.supersededEdgeIds.length,
        rejectedNodes: receipt.rejectedNodes.length,
        rejectedEdges: receipt.rejectedEdges.length,
      },
    });

    return receipt;
  }
}
