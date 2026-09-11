import {
  MemoryRecord,
  MemorySearchRequest,
  MemoryProposal,
  MemoryStatus,
  MemorySensitivity,
  SENSITIVITY_HIERARCHY,
  EpisodicEpisode,
  ProceduralPlaybookProposal,
  MemoryGraphNodeInput,
  MemoryGraphNodeOutput,
  MemoryGraphNodeSchema,
  MemoryGraphEdgeInput,
  MemoryGraphEdgeOutput,
  MemoryGraphEdgeSchema,
  MemoryGraphQueryRequest,
  MemoryGraphQueryResponse,
  isPlaybookPlanningEligible,
  VectorEmbedding,
  VectorSearchRequest,
  VectorSearchResponse,
  DEFAULT_VECTOR_DIMENSION,
  GraphEvolutionPlan,
  EvolutionReceipt,
  GraphEvolutionOperationType,
  EvolutionDeliveryStatus,
  EvolutionOutboxRecord,
  EvolutionOutboxRecordInput,
  EvolutionOutboxRecordSchema,
  EvolutionOutboxRecordInputSchema,
  OUTBOX_MAX_ATTEMPTS_DEFAULT,
  OUTBOX_PROCESSING_LEASE_TIMEOUT_MS,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  MemoryNotFoundError,
  MemoryVersionConflictError,
  MemorySecurityViolationError,
  MemoryServiceContext,
} from './types.js';
import { VectorIndex } from './vector-index.js';

export interface InMemoryStoreOptions {
  simulateFailure?: boolean;
  vectorDimensions?: number;
}

/**
 * In-Memory Memory Store
 * Implements IMemoryStore with thread-safe JS Maps and vector simulation.
 * Strict multi-tenant isolation via compound keys "tenantId:workspaceId:id".
 */
export class InMemoryMemoryStore implements IMemoryStore {
  // Primary storage: composite key "tenantId:workspaceId:memoryId" -> MemoryRecord
  private readonly records = new Map<string, MemoryRecord>();
  // Proposals storage: "tenantId:workspaceId:proposalId" -> MemoryProposal
  private readonly proposals = new Map<string, MemoryProposal>();
  // Episodes storage: "tenantId:workspaceId:episodeId" -> EpisodicEpisode
  private readonly episodes = new Map<string, EpisodicEpisode>();
  // Playbooks storage: "tenantId:workspaceId:playbookId" -> ProceduralPlaybookProposal
  private readonly playbooks = new Map<string, ProceduralPlaybookProposal>();
  // Graph nodes: "tenantId:workspaceId:nodeId" -> MemoryGraphNodeOutput
  private readonly graphNodes = new Map<string, MemoryGraphNodeOutput>();
  // Graph edges: "tenantId:workspaceId:edgeId" -> MemoryGraphEdgeOutput
  private readonly graphEdges = new Map<string, MemoryGraphEdgeOutput>();
  // Vector embeddings: "tenantId:workspaceId:memoryRecordId" -> VectorEmbedding
  private readonly vectorEmbeddings = new Map<string, VectorEmbedding>();
  // Outbox storage: "tenantId:workspaceId:id" -> EvolutionOutboxRecord
  private readonly outboxRecords = new Map<string, EvolutionOutboxRecord>();
  private readonly vectorIndex: VectorIndex;

  public simulateFailure = false;
  public simulateFailureInEvolution = false;
  public simulateFailureInEvolutionMidway = false;

  constructor(options?: InMemoryStoreOptions) {
    if (options?.simulateFailure) {
      this.simulateFailure = true;
    }
    this.vectorIndex = new VectorIndex({
      dimensions: options?.vectorDimensions ?? DEFAULT_VECTOR_DIMENSION,
    });
  }

  private getKey(tenantId: string, workspaceId: string, id: string): string {
    return `${tenantId}:${workspaceId}:${id}`;
  }

  private checkFailure(): void {
    if (this.simulateFailure) {
      throw new Error('056-STORE-FAIL: Persistent memory storage backend unreachable.');
    }
  }

  // -------------------------------------------------------------------------
  // Core Memory CRUD
  // -------------------------------------------------------------------------

  public async create(
    record: MemoryRecord,
    outboxItem?: EvolutionOutboxRecordInput,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    if (!record.tenantId || !record.workspaceId || !record.id) {
      throw new MemorySecurityViolationError(
        'Cannot create memory record without tenantId, workspaceId, and id.',
      );
    }

    const key = this.getKey(record.tenantId, record.workspaceId, record.id);
    if (this.records.has(key)) {
      throw new Error(`Memory record with ID '${record.id}' already exists in this workspace.`);
    }

    // Deep clone to ensure immutability in store
    const cloned = JSON.parse(JSON.stringify(record)) as MemoryRecord;
    this.records.set(key, cloned);

    if (outboxItem) {
      await this.createOutboxRecord(outboxItem);
    }

    return JSON.parse(JSON.stringify(cloned));
  }

  public async getById(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryRecord | null> {
    this.checkFailure();

    if (!id || !tenantId || !workspaceId) {
      return null;
    }

    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.records.get(key);
    if (!existing) {
      return null;
    }

    // Check expiry
    if (this.isExpired(existing)) {
      return null;
    }

    // Check tombstone
    if (existing.status === MemoryStatus.TOMBSTONED) {
      return null;
    }

    return JSON.parse(JSON.stringify(existing));
  }

  public async update(
    id: string,
    tenantId: string,
    workspaceId: string,
    updates: Partial<
      Omit<MemoryRecord, 'id' | 'tenantId' | 'workspaceId' | 'version' | 'createdAt'>
    >,
    expectedVersion: number,
    outboxItem?: EvolutionOutboxRecordInput,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.records.get(key);
    if (!existing) {
      throw new MemoryNotFoundError(id);
    }

    if (existing.status === MemoryStatus.TOMBSTONED) {
      throw new MemoryNotFoundError(id);
    }

    // Optimistic locking
    if (existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const updated: MemoryRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      workspaceId: existing.workspaceId,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.records.set(key, JSON.parse(JSON.stringify(updated)));

    if (outboxItem) {
      await this.createOutboxRecord(outboxItem);
    }

    return JSON.parse(JSON.stringify(updated));
  }

  public async tombstone(
    id: string,
    tenantId: string,
    workspaceId: string,
    tombstonedAt: string,
    expectedVersion?: number,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.records.get(key);
    if (!existing) {
      throw new MemoryNotFoundError(id);
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const tombstoned: MemoryRecord = {
      ...existing,
      status: MemoryStatus.TOMBSTONED,
      tombstonedAt,
      version: existing.version + 1,
      updatedAt: tombstonedAt,
    };

    this.records.set(key, JSON.parse(JSON.stringify(tombstoned)));

    // 058-SEC-05: Cascading tombstone to graph projections and derived compressions
    await this.revokeGraphForMemory(id, tenantId, workspaceId);
    await this.markDerivedCompressionsTombstoned(id, tenantId, workspaceId);

    // 062-SEC-01 / 062-SEC-05: Cascading deletion of vector index entry on tombstone
    this.vectorIndex.delete(id, tenantId, workspaceId);
    this.vectorEmbeddings.delete(key);

    return JSON.parse(JSON.stringify(tombstoned));
  }

  public async search(
    request: MemorySearchRequest,
  ): Promise<{ records: MemoryRecord[]; total: number }> {
    this.checkFailure();

    const tenantId = request.tenantId;
    const workspaceId = request.workspaceId;
    const allowedStatuses = new Set(request.status ?? [MemoryStatus.ACTIVE]);
    const classes = request.classes ? new Set(request.classes) : null;
    const tags = request.tags ? new Set(request.tags) : null;
    const maxSensitivityRank = request.maxSensitivity
      ? SENSITIVITY_HIERARCHY[request.maxSensitivity]
      : SENSITIVITY_HIERARCHY[MemorySensitivity.RESTRICTED];
    const minConfidence = request.minConfidence ?? 0.0;
    const nowMs = Date.now();

    const matching: MemoryRecord[] = [];

    for (const record of this.records.values()) {
      // 1. Strict Tenant and Workspace Isolation (056-SEC-02)
      if (record.tenantId !== tenantId || record.workspaceId !== workspaceId) {
        continue;
      }

      // 2. Status check
      if (!allowedStatuses.has(record.status)) {
        continue;
      }

      // 3. Expiry check
      if (this.isExpired(record, nowMs)) {
        continue;
      }

      // 4. Sensitivity hierarchy check
      const recordRank = SENSITIVITY_HIERARCHY[record.sensitivity] ?? 0;
      if (recordRank > maxSensitivityRank) {
        continue;
      }

      // 5. Confidence check
      if (record.confidence < minConfidence) {
        continue;
      }

      // 6. Memory class check
      if (classes && !classes.has(record.class)) {
        continue;
      }

      // 7. Owner check
      if (request.ownerId && record.ownerId !== request.ownerId) {
        continue;
      }

      // 8. Tag check
      if (tags) {
        const hasMatchingTag = record.tags.some((t) => tags.has(t));
        if (!hasMatchingTag) {
          continue;
        }
      }

      // 9. Lexical query match
      if (request.query && request.query.trim().length > 0) {
        const q = request.query.toLowerCase();
        const contentMatch = record.content.toLowerCase().includes(q);
        const titleMatch = record.title ? record.title.toLowerCase().includes(q) : false;
        const tagMatch = record.tags.some((t) => t.toLowerCase().includes(q));

        if (!contentMatch && !titleMatch && !tagMatch) {
          continue;
        }
      }

      matching.push(JSON.parse(JSON.stringify(record)));
    }

    const total = matching.length;
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 10;
    const paginated = matching.slice(offset, offset + limit);

    return { records: paginated, total };
  }

  // -------------------------------------------------------------------------
  // Proposals
  // -------------------------------------------------------------------------

  public async saveProposal(proposal: MemoryProposal): Promise<MemoryProposal> {
    this.checkFailure();
    const key = this.getKey(proposal.tenantId, proposal.workspaceId, proposal.proposalId);
    const cloned = JSON.parse(JSON.stringify(proposal)) as MemoryProposal;
    this.proposals.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryProposal | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, proposalId);
    const existing = this.proposals.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
  }

  public async updateProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
    status: 'APPROVED' | 'REJECTED',
    resolvedBy: string,
    resolvedAt: string,
    reason?: string,
  ): Promise<MemoryProposal> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, proposalId);
    const existing = this.proposals.get(key);
    if (!existing) {
      throw new MemoryNotFoundError(`Proposal '${proposalId}' not found.`);
    }

    const updated: MemoryProposal = {
      ...existing,
      status,
      resolvedBy,
      resolvedAt,
      reason,
    };
    this.proposals.set(key, JSON.parse(JSON.stringify(updated)));
    return JSON.parse(JSON.stringify(updated));
  }

  public async purgeExpired(currentIsoTimestamp: string): Promise<number> {
    this.checkFailure();
    let purged = 0;
    const nowMs = new Date(currentIsoTimestamp).getTime();

    for (const [key, record] of this.records.entries()) {
      if (this.isExpired(record, nowMs)) {
        const tombstoned: MemoryRecord = {
          ...record,
          status: MemoryStatus.TOMBSTONED,
          tombstonedAt: currentIsoTimestamp,
          version: record.version + 1,
          updatedAt: currentIsoTimestamp,
        };
        this.records.set(key, tombstoned);
        purged++;
      }
    }
    return purged;
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Episodic Episodes
  // -------------------------------------------------------------------------

  public async saveEpisode(episode: EpisodicEpisode): Promise<EpisodicEpisode> {
    this.checkFailure();
    const key = this.getKey(episode.tenantId, episode.workspaceId, episode.id);
    const cloned = JSON.parse(JSON.stringify(episode)) as EpisodicEpisode;
    this.episodes.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getEpisode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<EpisodicEpisode | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.episodes.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
  }

  public async listEpisodes(
    tenantId: string,
    workspaceId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ episodes: EpisodicEpisode[]; total: number }> {
    this.checkFailure();
    const matching: EpisodicEpisode[] = [];
    for (const ep of this.episodes.values()) {
      if (ep.tenantId === tenantId && ep.workspaceId === workspaceId) {
        matching.push(JSON.parse(JSON.stringify(ep)));
      }
    }
    matching.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    const total = matching.length;
    const paginated = matching.slice(offset, offset + limit);
    return { episodes: paginated, total };
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Procedural Playbooks
  // -------------------------------------------------------------------------

  public async savePlaybook(
    playbook: ProceduralPlaybookProposal,
  ): Promise<ProceduralPlaybookProposal> {
    this.checkFailure();
    const key = this.getKey(playbook.tenantId, playbook.workspaceId, playbook.id);
    const cloned = JSON.parse(JSON.stringify(playbook)) as ProceduralPlaybookProposal;
    this.playbooks.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getPlaybook(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<ProceduralPlaybookProposal | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.playbooks.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
  }

  public async listPlaybooks(
    tenantId: string,
    workspaceId: string,
    options?: { planningEligibleOnly?: boolean },
  ): Promise<ProceduralPlaybookProposal[]> {
    this.checkFailure();
    const result: ProceduralPlaybookProposal[] = [];
    for (const pb of this.playbooks.values()) {
      if (pb.tenantId === tenantId && pb.workspaceId === workspaceId) {
        if (options?.planningEligibleOnly) {
          if (isPlaybookPlanningEligible(pb)) {
            result.push(JSON.parse(JSON.stringify(pb)));
          }
        } else {
          result.push(JSON.parse(JSON.stringify(pb)));
        }
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Knowledge Graph Projections (058-SEC-03)
  // -------------------------------------------------------------------------

  public async saveGraphNode(
    node: MemoryGraphNodeInput,
    options?: { expectedVersion?: number },
  ): Promise<MemoryGraphNodeOutput> {
    this.checkFailure();
    const validated = MemoryGraphNodeSchema.parse(node);
    const key = this.getKey(validated.tenantId, validated.workspaceId, validated.id);
    const existing = this.graphNodes.get(key);

    if (existing) {
      const currentVersion = existing.version;
      if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, options.expectedVersion);
      }
      if (node.version !== undefined && node.version < currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, node.version);
      }
      let nextVersion = currentVersion + 1;
      if (node.version !== undefined && node.version > currentVersion) {
        nextVersion = node.version;
      }
      const validFrom = validated.validFrom ?? existing.validFrom ?? existing.createdAt;
      const updatedAt = validated.updatedAt ?? new Date().toISOString();
      const updatedNode: MemoryGraphNodeOutput = {
        ...validated,
        validFrom,
        version: nextVersion,
        lastMemoryVersion: validated.lastMemoryVersion ?? existing.lastMemoryVersion ?? 1,
        updatedAt,
      };
      this.graphNodes.set(key, JSON.parse(JSON.stringify(updatedNode)));
      return JSON.parse(JSON.stringify(updatedNode));
    } else {
      if (
        options?.expectedVersion !== undefined &&
        options.expectedVersion !== 0 &&
        options.expectedVersion !== 1
      ) {
        throw new MemoryVersionConflictError(validated.id, 0, options.expectedVersion);
      }
      const initialVersion = node.version ?? 1;
      const validFrom = validated.validFrom ?? validated.createdAt;
      const updatedAt = validated.updatedAt ?? validated.createdAt;
      const createdNode: MemoryGraphNodeOutput = {
        ...validated,
        validFrom,
        version: initialVersion,
        lastMemoryVersion: validated.lastMemoryVersion ?? 1,
        updatedAt,
      };
      this.graphNodes.set(key, JSON.parse(JSON.stringify(createdNode)));
      return JSON.parse(JSON.stringify(createdNode));
    }
  }

  public async getGraphNode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphNodeOutput | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const node = this.graphNodes.get(key);
    if (!node) return null;
    return JSON.parse(JSON.stringify(node));
  }

  public async saveGraphEdge(
    edge: MemoryGraphEdgeInput,
    options?: { expectedVersion?: number },
  ): Promise<MemoryGraphEdgeOutput> {
    this.checkFailure();
    const validated = MemoryGraphEdgeSchema.parse(edge);
    const key = this.getKey(validated.tenantId, validated.workspaceId, validated.id);
    const existing = this.graphEdges.get(key);

    if (existing) {
      const currentVersion = existing.version;
      if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, options.expectedVersion);
      }
      if (edge.version !== undefined && edge.version < currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, edge.version);
      }
      let nextVersion = currentVersion + 1;
      if (edge.version !== undefined && edge.version > currentVersion) {
        nextVersion = edge.version;
      }
      const validFrom = validated.validFrom ?? existing.validFrom ?? existing.createdAt;
      const updatedAt = validated.updatedAt ?? new Date().toISOString();
      const updatedEdge: MemoryGraphEdgeOutput = {
        ...validated,
        validFrom,
        version: nextVersion,
        lastMemoryVersion: validated.lastMemoryVersion ?? existing.lastMemoryVersion ?? 1,
        updatedAt,
      };
      this.graphEdges.set(key, JSON.parse(JSON.stringify(updatedEdge)));
      return JSON.parse(JSON.stringify(updatedEdge));
    } else {
      if (
        options?.expectedVersion !== undefined &&
        options.expectedVersion !== 0 &&
        options.expectedVersion !== 1
      ) {
        throw new MemoryVersionConflictError(validated.id, 0, options.expectedVersion);
      }
      const initialVersion = edge.version ?? 1;
      const validFrom = validated.validFrom ?? validated.createdAt;
      const updatedAt = validated.updatedAt ?? validated.createdAt;
      const createdEdge: MemoryGraphEdgeOutput = {
        ...validated,
        validFrom,
        version: initialVersion,
        lastMemoryVersion: validated.lastMemoryVersion ?? 1,
        updatedAt,
      };
      this.graphEdges.set(key, JSON.parse(JSON.stringify(createdEdge)));
      return JSON.parse(JSON.stringify(createdEdge));
    }
  }

  public async getGraphEdge(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphEdgeOutput | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const edge = this.graphEdges.get(key);
    if (!edge) return null;
    return JSON.parse(JSON.stringify(edge));
  }

  public async queryGraph(request: MemoryGraphQueryRequest): Promise<MemoryGraphQueryResponse> {
    this.checkFailure();

    const tenantId = request.tenantId;
    const workspaceId = request.workspaceId;
    const startNodeId = request.startNodeId;
    const maxDepth = request.maxDepth ?? 2;
    const minConfidence = request.minConfidence ?? 0.0;
    const limit = request.limit ?? 25;
    const allowedNodeTypes = request.nodeTypes ? new Set(request.nodeTypes) : null;
    const allowedEdgeTypes = request.edgeTypes ? new Set(request.edgeTypes) : null;
    const asOfTime = request.asOf ? new Date(request.asOf).getTime() : null;
    const includeSuperseded = request.includeSuperseded ?? false;

    // Collect all nodes and edges belonging strictly to this tenant and workspace (058-SEC-03)
    const wsNodes = new Map<string, MemoryGraphNodeOutput>();
    for (const n of this.graphNodes.values()) {
      if (n.tenantId === tenantId && n.workspaceId === workspaceId) {
        let isVisible = true;
        if (asOfTime !== null) {
          const from = new Date(n.validFrom ?? n.createdAt).getTime();
          const to = n.validTo ? new Date(n.validTo).getTime() : Infinity;
          isVisible = from <= asOfTime && asOfTime < to;
        } else if (!includeSuperseded) {
          isVisible = Boolean(n.isCurrent);
        }

        if (isVisible && (!allowedNodeTypes || allowedNodeTypes.has(n.nodeType))) {
          if (n.confidence >= minConfidence) {
            wsNodes.set(n.id, JSON.parse(JSON.stringify(n)));
          }
        }
      }
    }

    const wsEdges: MemoryGraphEdgeOutput[] = [];
    for (const e of this.graphEdges.values()) {
      if (e.tenantId === tenantId && e.workspaceId === workspaceId) {
        let isVisible = true;
        if (asOfTime !== null) {
          const from = new Date(e.validFrom ?? e.createdAt).getTime();
          const to = e.validTo ? new Date(e.validTo).getTime() : Infinity;
          isVisible = from <= asOfTime && asOfTime < to;
        } else if (!includeSuperseded) {
          isVisible = Boolean(e.isCurrent);
        }

        if (isVisible && (!allowedEdgeTypes || allowedEdgeTypes.has(e.edgeType))) {
          if (e.confidence >= minConfidence) {
            wsEdges.push(JSON.parse(JSON.stringify(e)));
          }
        }
      }
    }

    // Traversal logic
    if (startNodeId) {
      // Start node must exist within workspace
      if (!wsNodes.has(startNodeId)) {
        return {
          nodes: [],
          edges: [],
          traversalDepth: 0,
          tenantId,
          workspaceId,
          totalNodes: 0,
          totalEdges: 0,
        };
      }

      const visitedNodes = new Set<string>([startNodeId]);
      const visitedEdgeIds = new Set<string>();
      const resultEdges: MemoryGraphEdgeOutput[] = [];
      let currentFrontier = new Set<string>([startNodeId]);
      let currentDepth = 0;

      while (currentFrontier.size > 0 && currentDepth < maxDepth) {
        const nextFrontier = new Set<string>();
        let progressed = false;

        for (const edge of wsEdges) {
          if (visitedEdgeIds.has(edge.id)) {
            continue;
          }
          if (currentFrontier.has(edge.sourceNodeId)) {
            const targetId = edge.targetNodeId;
            if (wsNodes.has(targetId)) {
              visitedEdgeIds.add(edge.id);
              resultEdges.push(edge);
              progressed = true;
              if (!visitedNodes.has(targetId)) {
                visitedNodes.add(targetId);
                nextFrontier.add(targetId);
              }
            }
          } else if (currentFrontier.has(edge.targetNodeId)) {
            const sourceId = edge.sourceNodeId;
            if (wsNodes.has(sourceId)) {
              visitedEdgeIds.add(edge.id);
              resultEdges.push(edge);
              progressed = true;
              if (!visitedNodes.has(sourceId)) {
                visitedNodes.add(sourceId);
                nextFrontier.add(sourceId);
              }
            }
          }
        }

        if (progressed || nextFrontier.size > 0) {
          currentDepth++;
        }
        currentFrontier = nextFrontier;
      }

      const selectedNodes = Array.from(visitedNodes)
        .map((id) => wsNodes.get(id)!)
        .filter(Boolean)
        .slice(0, limit);

      const nodeIds = new Set(selectedNodes.map((n) => n.id));
      const selectedEdges = resultEdges
        .filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId))
        .slice(0, limit);

      return {
        nodes: selectedNodes,
        edges: selectedEdges,
        traversalDepth: currentDepth,
        tenantId,
        workspaceId,
        totalNodes: selectedNodes.length,
        totalEdges: selectedEdges.length,
      };
    }

    // Unanchored query: return all workspace nodes and matching edges up to limit
    const allNodes = Array.from(wsNodes.values()).slice(0, limit);
    const nodeIds = new Set(allNodes.map((n) => n.id));
    const allEdges = wsEdges
      .filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId))
      .slice(0, limit);

    return {
      nodes: allNodes,
      edges: allEdges,
      traversalDepth: 1,
      tenantId,
      workspaceId,
      totalNodes: allNodes.length,
      totalEdges: allEdges.length,
    };
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Atomic Forgetting & Graph Revocation (058-SEC-05)
  // -------------------------------------------------------------------------

  public async revokeGraphForMemory(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<{ revokedNodes: number; revokedEdges: number }> {
    this.checkFailure();

    // 1. Find nodes associated with this memoryRecordId
    const targetNodeIds = new Set<string>();
    for (const [key, node] of this.graphNodes.entries()) {
      if (
        node.tenantId === tenantId &&
        node.workspaceId === workspaceId &&
        node.memoryRecordId === memoryRecordId
      ) {
        targetNodeIds.add(node.id);
        this.graphNodes.delete(key);
      }
    }

    // 2. Find and delete edges referencing these nodes or citing memoryRecordId directly
    let deletedEdgesCount = 0;
    for (const [key, edge] of this.graphEdges.entries()) {
      if (edge.tenantId === tenantId && edge.workspaceId === workspaceId) {
        if (
          targetNodeIds.has(edge.sourceNodeId) ||
          targetNodeIds.has(edge.targetNodeId) ||
          edge.provenance?.sourceId === memoryRecordId
        ) {
          this.graphEdges.delete(key);
          deletedEdgesCount++;
        }
      }
    }

    return {
      revokedNodes: targetNodeIds.size,
      revokedEdges: deletedEdgesCount,
    };
  }

  // -------------------------------------------------------------------------
  // Governed Graph Evolution Batch Operation (Task 066 Phase 3)
  // -------------------------------------------------------------------------

  public async evolveGraph(
    plan: GraphEvolutionPlan,
    ctx?: MemoryServiceContext,
  ): Promise<EvolutionReceipt> {
    this.checkFailure();
    const startTime = performance.now();

    if (ctx) {
      if (ctx.tenantId !== plan.tenantId || ctx.workspaceId !== plan.workspaceId) {
        throw new MemorySecurityViolationError(
          `066-P3-SEC-02: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot evolve graph in (${plan.tenantId}/${plan.workspaceId}).`,
        );
      }
    }

    if (this.simulateFailureInEvolution) {
      throw new Error(
        '066-P3-SEC-07-SIMULATED-FAIL: Injected evolution failure before transaction',
      );
    }

    if (plan.operations.length === 0) {
      return {
        evolutionId: plan.evolutionId,
        tenantId: plan.tenantId,
        workspaceId: plan.workspaceId,
        memoryRecordId: plan.memoryRecordId,
        memoryVersion: plan.memoryVersion,
        acceptedNodes: [],
        acceptedEdges: [],
        supersededNodeIds: [],
        supersededEdgeIds: [],
        rejectedNodes: [],
        rejectedEdges: [],
        evolvedAt: new Date().toISOString(),
        executionDurationMs: Math.round(performance.now() - startTime),
        idempotentSkip: true,
      };
    }

    // Snapshot state for atomic rollback
    const nodesBackup = new Map(this.graphNodes);
    const edgesBackup = new Map(this.graphEdges);

    const acceptedNodes: string[] = [];
    const acceptedEdges: string[] = [];
    const supersededNodeIds: string[] = [];
    const supersededEdgeIds: string[] = [];

    try {
      for (const op of plan.operations) {
        if (op.operationType === GraphEvolutionOperationType.ADD_NODE) {
          if (!op.node) {
            throw new Error('ADD_NODE operation requires node payload');
          }
          const node = MemoryGraphNodeSchema.parse(op.node);
          if (node.tenantId !== plan.tenantId || node.workspaceId !== plan.workspaceId) {
            throw new MemorySecurityViolationError(
              `066-P3-SEC-02: Node tenant/workspace mismatch in evolution plan`,
            );
          }

          const key = this.getKey(node.tenantId, node.workspaceId, node.id);
          if (!this.graphNodes.has(key)) {
            const initialVersion = node.version ?? 1;
            const validFrom = node.validFrom ?? node.createdAt;
            const updatedAt = node.updatedAt ?? node.createdAt;
            const lastMemoryVersion = node.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            const createdNode: MemoryGraphNodeOutput = {
              ...node,
              validFrom,
              version: initialVersion,
              lastMemoryVersion,
              updatedAt,
            };
            this.graphNodes.set(key, JSON.parse(JSON.stringify(createdNode)));
          }
          acceptedNodes.push(node.id);
        } else if (op.operationType === GraphEvolutionOperationType.REFINE_NODE) {
          if (!op.node) {
            throw new Error('REFINE_NODE operation requires node payload');
          }
          const node = MemoryGraphNodeSchema.parse(op.node);
          const key = this.getKey(node.tenantId, node.workspaceId, node.id);
          const existing = this.graphNodes.get(key);

          if (!existing) {
            throw new MemoryNotFoundError(node.id);
          }

          const currentVersion = existing.version;
          if (op.expectedVersion !== undefined && op.expectedVersion !== currentVersion) {
            throw new MemoryVersionConflictError(node.id, currentVersion, op.expectedVersion);
          }

          const nextVersion = currentVersion + 1;
          const updatedAt = node.updatedAt ?? new Date().toISOString();
          const lastMemoryVersion = node.lastMemoryVersion ?? plan.memoryVersion ?? 1;

          const updatedNode: MemoryGraphNodeOutput = {
            ...existing,
            ...node,
            version: nextVersion,
            lastMemoryVersion,
            updatedAt,
          };
          this.graphNodes.set(key, JSON.parse(JSON.stringify(updatedNode)));
          acceptedNodes.push(node.id);
        } else if (op.operationType === GraphEvolutionOperationType.SUPERSEDE_NODE) {
          const targetId = op.targetId;
          if (!targetId) {
            throw new Error('SUPERSEDE_NODE operation requires targetId');
          }

          const key = this.getKey(plan.tenantId, plan.workspaceId, targetId);
          const existing = this.graphNodes.get(key);

          if (!existing) {
            throw new MemoryNotFoundError(targetId);
          }

          const currentVersion = existing.version;
          if (op.expectedVersion !== undefined && op.expectedVersion !== currentVersion) {
            throw new MemoryVersionConflictError(targetId, currentVersion, op.expectedVersion);
          }

          const validTo = op.validTo ?? new Date().toISOString();
          const supersededBy = op.supersededBy ?? op.node?.id ?? undefined;
          const nextVersion = currentVersion + 1;
          const lastMemoryVersion = plan.memoryVersion ?? 1;

          const supersededNode: MemoryGraphNodeOutput = {
            ...existing,
            isCurrent: false,
            validTo,
            supersededBy,
            version: nextVersion,
            lastMemoryVersion,
            updatedAt: validTo,
          };
          this.graphNodes.set(key, JSON.parse(JSON.stringify(supersededNode)));
          supersededNodeIds.push(targetId);

          if (op.node) {
            const newNode = MemoryGraphNodeSchema.parse(op.node);
            const newKey = this.getKey(newNode.tenantId, newNode.workspaceId, newNode.id);
            const initialVersion = newNode.version ?? 1;
            const validFrom = newNode.validFrom ?? validTo;
            const updatedAt = newNode.updatedAt ?? validTo;
            const newNodeLastMemoryVersion = newNode.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            const createdNode: MemoryGraphNodeOutput = {
              ...newNode,
              isCurrent: true,
              validFrom,
              validTo: undefined,
              supersededBy: undefined,
              version: initialVersion,
              lastMemoryVersion: newNodeLastMemoryVersion,
              updatedAt,
            };
            this.graphNodes.set(newKey, JSON.parse(JSON.stringify(createdNode)));
            acceptedNodes.push(newNode.id);
          }
        } else if (op.operationType === GraphEvolutionOperationType.ADD_EDGE) {
          if (!op.edge) {
            throw new Error('ADD_EDGE operation requires edge payload');
          }
          const edge = MemoryGraphEdgeSchema.parse(op.edge);
          if (edge.tenantId !== plan.tenantId || edge.workspaceId !== plan.workspaceId) {
            throw new MemorySecurityViolationError(
              `066-P3-SEC-02: Edge tenant/workspace mismatch in evolution plan`,
            );
          }

          const key = this.getKey(edge.tenantId, edge.workspaceId, edge.id);
          if (!this.graphEdges.has(key)) {
            const initialVersion = edge.version ?? 1;
            const validFrom = edge.validFrom ?? edge.createdAt;
            const updatedAt = edge.updatedAt ?? edge.createdAt;
            const lastMemoryVersion = edge.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            const createdEdge: MemoryGraphEdgeOutput = {
              ...edge,
              validFrom,
              version: initialVersion,
              lastMemoryVersion,
              updatedAt,
            };
            this.graphEdges.set(key, JSON.parse(JSON.stringify(createdEdge)));
          }
          acceptedEdges.push(edge.id);
        } else if (op.operationType === GraphEvolutionOperationType.SUPERSEDE_EDGE) {
          const targetId = op.targetId;
          if (!targetId) {
            throw new Error('SUPERSEDE_EDGE operation requires targetId');
          }

          const key = this.getKey(plan.tenantId, plan.workspaceId, targetId);
          const existing = this.graphEdges.get(key);

          if (!existing) {
            throw new MemoryNotFoundError(targetId);
          }

          const currentVersion = existing.version;
          if (op.expectedVersion !== undefined && op.expectedVersion !== currentVersion) {
            throw new MemoryVersionConflictError(targetId, currentVersion, op.expectedVersion);
          }

          const validTo = op.validTo ?? new Date().toISOString();
          const supersededBy = op.supersededBy ?? op.edge?.id ?? undefined;
          const nextVersion = currentVersion + 1;
          const lastMemoryVersion = plan.memoryVersion ?? 1;

          const supersededEdge: MemoryGraphEdgeOutput = {
            ...existing,
            isCurrent: false,
            validTo,
            supersededBy,
            version: nextVersion,
            lastMemoryVersion,
            updatedAt: validTo,
          };
          this.graphEdges.set(key, JSON.parse(JSON.stringify(supersededEdge)));
          supersededEdgeIds.push(targetId);

          if (op.edge) {
            const newEdge = MemoryGraphEdgeSchema.parse(op.edge);
            const newKey = this.getKey(newEdge.tenantId, newEdge.workspaceId, newEdge.id);
            const initialVersion = newEdge.version ?? 1;
            const validFrom = newEdge.validFrom ?? validTo;
            const updatedAt = newEdge.updatedAt ?? validTo;
            const newEdgeLastMemoryVersion = newEdge.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            const createdEdge: MemoryGraphEdgeOutput = {
              ...newEdge,
              isCurrent: true,
              validFrom,
              validTo: undefined,
              supersededBy: undefined,
              version: initialVersion,
              lastMemoryVersion: newEdgeLastMemoryVersion,
              updatedAt,
            };
            this.graphEdges.set(newKey, JSON.parse(JSON.stringify(createdEdge)));
            acceptedEdges.push(newEdge.id);
          }
        }

        if (this.simulateFailureInEvolutionMidway) {
          throw new Error('066-P3-SEC-07-SIMULATED-FAIL: Injected mid-batch evolution failure');
        }
      }

      return {
        evolutionId: plan.evolutionId,
        tenantId: plan.tenantId,
        workspaceId: plan.workspaceId,
        memoryRecordId: plan.memoryRecordId,
        memoryVersion: plan.memoryVersion,
        acceptedNodes,
        acceptedEdges,
        supersededNodeIds,
        supersededEdgeIds,
        rejectedNodes: [],
        rejectedEdges: [],
        evolvedAt: new Date().toISOString(),
        executionDurationMs: Math.round(performance.now() - startTime),
        idempotentSkip: false,
      };
    } catch (err) {
      // Atomic rollback: restore snapshot
      this.graphNodes.clear();
      for (const [k, v] of nodesBackup.entries()) {
        this.graphNodes.set(k, v);
      }
      this.graphEdges.clear();
      for (const [k, v] of edgesBackup.entries()) {
        this.graphEdges.set(k, v);
      }
      throw err;
    }
  }

  public async markDerivedCompressionsTombstoned(
    sourceMemoryId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<number> {
    this.checkFailure();
    let updatedCount = 0;
    const now = new Date().toISOString();

    for (const [key, record] of this.records.entries()) {
      if (record.tenantId === tenantId && record.workspaceId === workspaceId) {
        if (record.status === MemoryStatus.TOMBSTONED) {
          continue;
        }

        // Check if metadata contains sourceMemoryIds array citing this memory
        const srcIds = (record.metadata?.sourceMemoryIds as string[] | undefined) ?? [];
        const isCitedInSourceIds = Array.isArray(srcIds) && srcIds.includes(sourceMemoryId);
        const isCitedInSummary =
          record.summary?.includes(sourceMemoryId) || record.content.includes(sourceMemoryId);

        if (isCitedInSourceIds || (record.class === 'EPISODIC' && isCitedInSummary)) {
          const tombstoned: MemoryRecord = {
            ...record,
            status: MemoryStatus.TOMBSTONED,
            tombstonedAt: now,
            version: record.version + 1,
            updatedAt: now,
          };
          this.records.set(key, tombstoned);
          updatedCount++;
        }
      }
    }

    return updatedCount;
  }

  private isExpired(record: MemoryRecord, nowMs: number = Date.now()): boolean {
    if (!record.retentionPolicy) {
      return false;
    }

    if (record.retentionPolicy.expiresAt) {
      const exp = new Date(record.retentionPolicy.expiresAt).getTime();
      if (!Number.isNaN(exp) && exp <= nowMs) {
        return true;
      }
    }

    if (record.retentionPolicy.ttlSeconds) {
      const createdMs = new Date(record.createdAt).getTime();
      const expiresAtMs = createdMs + record.retentionPolicy.ttlSeconds * 1000;
      if (expiresAtMs <= nowMs) {
        return true;
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Task 062 Store: Vector Embedding Storage & Similarity Search
  // -------------------------------------------------------------------------

  public async saveVector(vector: VectorEmbedding): Promise<VectorEmbedding> {
    this.checkFailure();
    const key = this.getKey(vector.tenantId, vector.workspaceId, vector.memoryRecordId);
    const cloned = JSON.parse(JSON.stringify(vector)) as VectorEmbedding;
    this.vectorEmbeddings.set(key, cloned);

    // Synchronize to in-process vector similarity index
    const existingRecord = this.records.get(key);
    this.vectorIndex.upsert({
      id: vector.id,
      memoryRecordId: vector.memoryRecordId,
      tenantId: vector.tenantId,
      workspaceId: vector.workspaceId,
      values: vector.values,
      dimensions: vector.dimensions,
      normalized: vector.normalized,
      metric: vector.metric,
      sensitivity: existingRecord?.sensitivity,
      status: existingRecord?.status ?? MemoryStatus.ACTIVE,
      classes: existingRecord?.class ? [existingRecord.class] : undefined,
      tags: existingRecord?.tags,
      metadata: vector.metadata,
      createdAt: vector.createdAt,
    });

    return JSON.parse(JSON.stringify(cloned));
  }

  public async getVector(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<VectorEmbedding | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, memoryRecordId);
    const existing = this.vectorEmbeddings.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
  }

  public async deleteVector(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, memoryRecordId);
    this.vectorIndex.delete(memoryRecordId, tenantId, workspaceId);
    return this.vectorEmbeddings.delete(key);
  }

  public async searchVectors(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    this.checkFailure();
    return this.vectorIndex.search(request);
  }

  // -------------------------------------------------------------------------
  // Durable Outbox Operations (066-P3-R-01, 066-P3-R-02, 066-P3-R-05)
  // -------------------------------------------------------------------------

  public async createOutboxRecord(
    record: EvolutionOutboxRecordInput,
  ): Promise<EvolutionOutboxRecord> {
    this.checkFailure();
    const validated = EvolutionOutboxRecordInputSchema.parse(record);
    const key = this.getKey(validated.tenantId, validated.workspaceId, validated.id);
    const existing = this.outboxRecords.get(key);
    if (existing) {
      return JSON.parse(JSON.stringify(existing));
    }
    const now = new Date().toISOString();
    const outboxRecord: EvolutionOutboxRecord = {
      id: validated.id,
      tenantId: validated.tenantId,
      workspaceId: validated.workspaceId,
      memoryRecordId: validated.memoryRecordId,
      memoryVersion: validated.memoryVersion,
      candidateSetHash: validated.candidateSetHash,
      evolutionPayload: validated.evolutionPayload,
      status: validated.status ?? EvolutionDeliveryStatus.PENDING,
      attemptCount: validated.attemptCount ?? 0,
      maxAttempts: validated.maxAttempts ?? OUTBOX_MAX_ATTEMPTS_DEFAULT,
      nextAttemptAt: validated.nextAttemptAt ?? null,
      createdAt: validated.createdAt ?? now,
      updatedAt: validated.updatedAt ?? validated.createdAt ?? now,
      processedAt: validated.processedAt ?? null,
      lastError: validated.lastError ?? null,
    };
    this.outboxRecords.set(key, outboxRecord);
    return JSON.parse(JSON.stringify(outboxRecord));
  }

  public async getOutboxRecord(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<EvolutionOutboxRecord | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const record = this.outboxRecords.get(key);
    return record ? JSON.parse(JSON.stringify(record)) : null;
  }

  public async listPendingOutboxRecords(options?: {
    tenantId?: string;
    workspaceId?: string;
    limit?: number;
    olderThanMs?: number;
    ignoreLeaseTimeout?: boolean;
  }): Promise<EvolutionOutboxRecord[]> {
    this.checkFailure();
    const nowMs = Date.now();
    const limit = options?.limit ?? 50;
    const results: EvolutionOutboxRecord[] = [];

    for (const record of this.outboxRecords.values()) {
      if (options?.tenantId && record.tenantId !== options.tenantId) continue;
      if (options?.workspaceId && record.workspaceId !== options.workspaceId) continue;

      let eligible = false;
      if (record.status === EvolutionDeliveryStatus.PENDING) {
        eligible = true;
      } else if (record.status === EvolutionDeliveryStatus.FAILED) {
        if (!record.nextAttemptAt || new Date(record.nextAttemptAt).getTime() <= nowMs) {
          eligible = true;
        }
      } else if (record.status === EvolutionDeliveryStatus.PROCESSING) {
        if (options?.ignoreLeaseTimeout) {
          eligible = true;
        } else {
          const updatedMs = new Date(record.updatedAt).getTime();
          if (nowMs - updatedMs >= OUTBOX_PROCESSING_LEASE_TIMEOUT_MS) {
            eligible = true;
          }
        }
      }

      if (eligible) {
        results.push(JSON.parse(JSON.stringify(record)));
        if (results.length >= limit) break;
      }
    }

    return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  public async claimOutboxRecord(
    id: string,
    tenantId: string,
    workspaceId: string,
    options?: { ignoreLeaseTimeout?: boolean },
  ): Promise<boolean> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const record = this.outboxRecords.get(key);
    if (!record) return false;

    const nowMs = Date.now();
    let eligible = false;
    if (record.status === EvolutionDeliveryStatus.PENDING) {
      eligible = true;
    } else if (record.status === EvolutionDeliveryStatus.FAILED) {
      if (!record.nextAttemptAt || new Date(record.nextAttemptAt).getTime() <= nowMs) {
        eligible = true;
      }
    } else if (record.status === EvolutionDeliveryStatus.PROCESSING) {
      if (options?.ignoreLeaseTimeout) {
        eligible = true;
      } else {
        const updatedMs = new Date(record.updatedAt).getTime();
        if (nowMs - updatedMs >= OUTBOX_PROCESSING_LEASE_TIMEOUT_MS) {
          eligible = true;
        }
      }
    }

    if (!eligible) return false;

    record.status = EvolutionDeliveryStatus.PROCESSING;
    record.updatedAt = new Date().toISOString();
    return true;
  }

  public async updateOutboxStatus(
    id: string,
    tenantId: string,
    workspaceId: string,
    update: {
      status: EvolutionDeliveryStatus;
      attemptCount?: number;
      lastError?: string | null;
      nextAttemptAt?: string | null;
      processedAt?: string | null;
    },
  ): Promise<EvolutionOutboxRecord> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const record = this.outboxRecords.get(key);
    if (!record) {
      throw new Error(`Outbox record not found: ${id}`);
    }

    const now = new Date().toISOString();
    record.status = update.status;
    if (update.attemptCount !== undefined) {
      record.attemptCount = update.attemptCount;
    }
    if (update.nextAttemptAt !== undefined) {
      record.nextAttemptAt = update.nextAttemptAt;
    }
    if (update.lastError !== undefined) {
      record.lastError = update.lastError;
    }
    if (update.processedAt !== undefined) {
      record.processedAt = update.processedAt;
    } else if (update.status === EvolutionDeliveryStatus.COMPLETED) {
      record.processedAt = now;
    }
    record.updatedAt = now;

    return JSON.parse(JSON.stringify(record));
  }

  public clear(): void {
    this.records.clear();
    this.proposals.clear();
    this.episodes.clear();
    this.playbooks.clear();
    this.graphNodes.clear();
    this.graphEdges.clear();
    this.vectorEmbeddings.clear();
    this.vectorIndex.clear();
    this.outboxRecords.clear();
  }
}
