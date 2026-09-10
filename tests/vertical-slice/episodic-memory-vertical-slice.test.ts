/**
 * Task 058 — Sprint 1 Milestone 10
 * Cross-Session Episodic Learning, Memory Compression & Graph Retrieval Projections
 *
 * Deterministic End-to-End Vertical Slice Test:
 *
 * Completed Governed Task
 *        ↓
 * Execution Evidence (Receipts, Outcome, Decided Actions)
 *        ↓
 * Episodic Episode
 *        ↓
 * Compression (Bounded Extractive Fallback)
 *        ↓
 * Immutable Citation & Provenance
 *        ↓
 * Graph Projection (Nodes & Edges)
 *        ↓
 * Bounded Graph Retrieval
 *        ↓
 * <<<UNTRUSTED_RETRIEVED_MEMORY>>> Packaging
 *        ↓
 * Planner-Consumable Context (Data, Never Authority)
 *
 * Also Proves:
 * - Atomic Forgetting Cascade (058-SEC-05)
 * - Playbook Proposal Governance & Eligibility Gate (058-SEC-06)
 * - Memory Authority Boundary (058-SEC-01)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryClass,
  EpisodeOutcome,
  PlaybookStatus,
  LossinessClass,
  CompressionStrategy,
  MemorySensitivity,
  MemorySourceType,
  MemoryStatus,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  isPlaybookPlanningEligible,
  wrapUntrustedMemory,
  UNTRUSTED_MEMORY_START_DELIMITER,
  UNTRUSTED_MEMORY_END_DELIMITER,
} from '@nexusos/contracts';
import {
  InMemoryMemoryStore,
  MemoryService,
  MemoryCompressor,
  EpisodicLearner,
  GraphProjectionEngine,
  MemoryServiceContext,
} from '@nexusos/backend';

describe('Task 058 — Episodic Memory Vertical Slice (Milestone 10)', () => {
  let store: InMemoryMemoryStore;
  let compressor: MemoryCompressor;
  let learner: EpisodicLearner;
  let graphEngine: GraphProjectionEngine;
  let memoryService: MemoryService;

  const tenantId = 'tenant-slice-prod';
  const workspaceId = 'ws-slice-primary';
  const actorId = 'agent-orchestrator-01';

  const ctx: MemoryServiceContext = {
    tenantId,
    workspaceId,
    principalId: actorId,
  };

  const defaultProvenance = {
    sourceType: MemorySourceType.TASK_EXECUTION,
    sourceId: 'task-governed-run-99',
    creatorPrincipalId: actorId,
    timestamp: '2026-09-10T01:00:00.000Z',
    verified: false,
  };

  beforeEach(() => {
    store = new InMemoryMemoryStore();
    compressor = new MemoryCompressor({ store });
    learner = new EpisodicLearner({ store });
    graphEngine = new GraphProjectionEngine({ store });
    memoryService = new MemoryService({
      store,
      compressor,
      episodicLearner: learner,
      graphEngine,
    });
  });

  it('completes the full deterministic episodic learning, compression, graph projection, and untrusted retrieval cycle', async () => {
    // -------------------------------------------------------------------------
    // Step 1: Ingest execution evidence from a completed governed task
    // -------------------------------------------------------------------------
    const episode = await memoryService.recordEpisode(
      {
        tenantId,
        workspaceId,
        taskId: 'task-build-pipeline-42',
        executionId: 'exec-build-run-1',
        goal: 'Compile and bundle microservice container with security scan',
        planGraphVersion: 1,
        outcome: EpisodeOutcome.SUCCESS,
        summary:
          'Successfully compiled TypeScript packages, generated Docker container, and passed Trivy security audit with 0 vulnerabilities.',
        nodeReceipts: [
          {
            nodeId: 'node-step-1',
            capability: 'pnpm-build',
            status: 'COMPLETED',
            durationMs: 4200,
            outputSummary: 'Compiled 4 workspace packages cleanly.',
          },
          {
            nodeId: 'node-step-2',
            capability: 'docker-build',
            status: 'COMPLETED',
            durationMs: 8500,
            outputSummary: 'Built image tag nexusos/backend:sha-abc123.',
          },
          {
            nodeId: 'node-step-3',
            capability: 'security-scan',
            status: 'COMPLETED',
            durationMs: 3100,
            outputSummary: '0 HIGH/CRITICAL CVEs found.',
          },
        ],
        humanDecisions: [
          {
            decisionId: 'dec-approval-01',
            action: 'APPROVED',
            principalId: 'security-admin@nexusos.io',
            scope: 'production-deployment-lease',
            timestamp: '2026-09-10T01:05:00.000Z',
            rationale: 'Verified build receipts and zero vulnerability findings.',
          },
        ],
        keyDecisions: ['Allowed parallel package compilation', 'Cached base docker layer'],
        errorPatterns: [],
        tags: ['build', 'docker', 'security'],
        sensitivity: MemorySensitivity.INTERNAL,
        provenance: defaultProvenance,
        startedAt: '2026-09-10T01:00:00.000Z',
        completedAt: '2026-09-10T01:15:48.000Z',
      },
      ctx,
    );

    assert.ok(episode.id.startsWith('ep-'));
    assert.equal(episode.outcome, EpisodeOutcome.SUCCESS);

    // Persist as a Governed MemoryRecord so it can be cited and compressed
    const memoryRecord = await memoryService.createMemory(
      {
        tenantId,
        workspaceId,
        title: 'Task 42 Build Pipeline Episode Record',
        content: episode.summary,
        class: MemoryClass.EPISODIC,
        sensitivity: episode.sensitivity,
        ownerId: actorId,
        confidence: 0.98,
        provenance: defaultProvenance,
        tags: ['episode', 'build'],
        metadata: {
          episodeId: episode.id,
          taskId: episode.taskId,
        },
      },
      ctx,
    );

    // -------------------------------------------------------------------------
    // Step 2: Governed Memory Compression with citation preservation (058-SEC-02)
    // -------------------------------------------------------------------------
    const compressionRes = await memoryService.compressMemories(
      {
        tenantId,
        workspaceId,
        sourceMemoryIds: [memoryRecord.id],
        strategy: CompressionStrategy.EXTRACTIVE,
        maxTokens: 100,
      },
      ctx,
    );

    assert.ok(compressionRes.id.startsWith('comp-'));
    assert.equal(compressionRes.lossinessClass, LossinessClass.BOUNDED_LOSSY);
    assert.equal(compressionRes.strategy, CompressionStrategy.EXTRACTIVE);
    assert.equal(compressionRes.citations.length, 1);
    assert.equal(compressionRes.citations[0].memoryId, memoryRecord.id);
    assert.equal(compressionRes.inheritedSensitivity, MemorySensitivity.INTERNAL); // 058-SEC-04

    // -------------------------------------------------------------------------
    // Step 3: Project Knowledge Graph relationships (058-SEC-03)
    // -------------------------------------------------------------------------
    const episodeNode = await memoryService.upsertGraphNode(
      {
        id: `node-${episode.id}`,
        tenantId,
        workspaceId,
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Build Pipeline Episode',
        memoryRecordId: memoryRecord.id,
        confidence: 0.98,
        properties: {
          taskId: episode.taskId,
          outcome: episode.outcome,
        },
        createdAt: '2026-09-10T01:16:00.000Z',
      },
      ctx,
    );

    const artifactNode = await memoryService.upsertGraphNode(
      {
        id: 'node-artifact-image',
        tenantId,
        workspaceId,
        nodeType: MemoryGraphNodeType.ARTIFACT,
        label: 'Container Image: nexusos/backend',
        confidence: 1.0,
        properties: {
          digest: 'sha256:abc1234567890def',
        },
        createdAt: '2026-09-10T01:16:00.000Z',
      },
      ctx,
    );

    const graphEdge = await memoryService.upsertGraphEdge(
      {
        id: `edge-${episode.id}-artifact`,
        tenantId,
        workspaceId,
        sourceNodeId: episodeNode.id,
        targetNodeId: artifactNode.id,
        edgeType: MemoryGraphEdgeType.DERIVED_FROM,
        weight: 1.0,
        confidence: 0.95,
        properties: { step: 'docker-build' },
        provenance: defaultProvenance,
        createdAt: '2026-09-10T01:16:00.000Z',
      },
      ctx,
    );

    assert.equal(graphEdge.sourceNodeId, episodeNode.id);

    // -------------------------------------------------------------------------
    // Step 4: Bounded Graph Retrieval & Packaging as Untrusted Data (058-SEC-01)
    // -------------------------------------------------------------------------
    const graphQueryResult = await memoryService.queryGraph(
      {
        tenantId,
        workspaceId,
        startNodeId: episodeNode.id,
        maxDepth: 2,
        minConfidence: 0.9,
      },
      ctx,
    );

    assert.equal(graphQueryResult.nodes.length, 2);
    assert.equal(graphQueryResult.edges.length, 1);
    assert.equal(graphQueryResult.traversalDepth, 1);

    // Package graph-retrieved context for planner/LLM consumption
    const graphContextPayload = JSON.stringify({
      nodes: graphQueryResult.nodes.map((n) => ({ id: n.id, label: n.label, type: n.nodeType })),
      edges: graphQueryResult.edges.map((e) => ({
        from: e.sourceNodeId,
        to: e.targetNodeId,
        rel: e.edgeType,
      })),
      summary: compressionRes.summaryContent,
    });

    const untrustedPlanningContext = wrapUntrustedMemory(graphContextPayload);

    // Assert untrusted encapsulation boundary
    assert.ok(untrustedPlanningContext.startsWith(UNTRUSTED_MEMORY_START_DELIMITER));
    assert.ok(untrustedPlanningContext.endsWith(UNTRUSTED_MEMORY_END_DELIMITER));
    assert.ok(untrustedPlanningContext.includes('Container Image: nexusos/backend'));

    // -------------------------------------------------------------------------
    // Step 5: Procedural Playbook Proposals & Eligibility Governance (058-SEC-06)
    // -------------------------------------------------------------------------
    const playbook = await memoryService.proposePlaybook(
      {
        tenantId,
        workspaceId,
        title: 'Microservice Build & Verification Playbook',
        goalPattern: 'compile and bundle microservice container',
        description: 'Standard multi-step build, package, and containerization sequence.',
        confidence: 0.88, // Below 0.90 threshold
        steps: [
          {
            stepIndex: 0,
            capability: 'pnpm-build',
            description: 'Compile packages',
            suggestedRiskTier: 'LOW',
          },
          {
            stepIndex: 1,
            capability: 'docker-build',
            description: 'Build docker image',
            suggestedRiskTier: 'MEDIUM',
          },
          {
            stepIndex: 2,
            capability: 'security-scan',
            description: 'Execute vulnerability scan',
            suggestedRiskTier: 'LOW',
          },
        ],
        sourceEpisodeIds: [episode.id],
        provenance: defaultProvenance,
        sensitivity: MemorySensitivity.INTERNAL,
      },
      ctx,
    );

    // Defaults to PROPOSED
    assert.equal(playbook.status, PlaybookStatus.PROPOSED);
    // Not eligible yet because confidence < 0.90
    assert.equal(isPlaybookPlanningEligible(playbook), false);

    // Human Approval grants planning eligibility (Task 052 Authority Reuse)
    const approvedPlaybook = await memoryService.approvePlaybook(
      playbook.id,
      {
        approvedBy: 'lead-devops@nexusos.io',
        notes: 'Promoted to planning eligible playbook based on validated build receipts.',
      },
      ctx,
    );

    assert.equal(approvedPlaybook.status, PlaybookStatus.APPROVED);
    assert.equal(isPlaybookPlanningEligible(approvedPlaybook), true);

    // -------------------------------------------------------------------------
    // Step 6: Atomic Forgetting & Revocation (058-SEC-05)
    // -------------------------------------------------------------------------
    // Create derived compressed record citing the parent memoryRecord.id
    const derivedCompressedRecord = await memoryService.createMemory(
      {
        tenantId,
        workspaceId,
        title: 'Derived Architecture Summary',
        content: `Derived summary referencing parent memory record: ${memoryRecord.id}`,
        summary: `Derived summary of ${memoryRecord.id}`,
        class: MemoryClass.EPISODIC,
        sensitivity: MemorySensitivity.INTERNAL,
        ownerId: actorId,
        confidence: 0.95,
        provenance: defaultProvenance,
        tags: ['summary'],
        metadata: {
          sourceMemoryIds: [memoryRecord.id],
        },
      },
      ctx,
    );

    // Tombstone the parent memoryRecord through Governed Memory Service
    await memoryService.tombstoneMemory(memoryRecord.id, ctx);

    // Assert: Parent record cannot be fetched (null)
    const postParent = await memoryService.getMemory(memoryRecord.id, ctx);
    assert.equal(postParent, null);

    // Assert: Dependent graph node associated with parent memoryRecord is revoked
    const postGraphNode = await store.getGraphNode(episodeNode.id, tenantId, workspaceId);
    assert.equal(postGraphNode, null);

    // Assert: Connected graph edge is also revoked
    const postEdge = await store.getGraphEdge(graphEdge.id, tenantId, workspaceId);
    assert.equal(postEdge, null);

    // Assert: Derived compression citing parent is tombstoned and returns null
    const postDerived = await memoryService.getMemory(derivedCompressedRecord.id, ctx);
    assert.equal(postDerived, null);

    // Assert: Search cannot discover or resurrect tombstoned derived records
    const searchAfterForgetting = await memoryService.searchMemory(
      {
        tenantId,
        workspaceId,
        query: 'Derived Architecture Summary',
        status: [MemoryStatus.ACTIVE],
      },
      ctx,
    );
    assert.equal(searchAfterForgetting.items.length, 0);
  });
});
