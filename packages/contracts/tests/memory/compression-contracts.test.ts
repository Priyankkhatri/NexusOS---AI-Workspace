import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LossinessClass,
  LossinessClassSchema,
  CompressionStrategy,
  CompressionStrategySchema,
  MemoryCitationSchema,
  MemoryCompressionRequestSchema,
  MemoryCompressionResponseSchema,
  inheritHighestSensitivity,
  EpisodeOutcome,
  EpisodicEpisodeSchema,
  PlaybookStatus,
  ProceduralPlaybookProposalSchema,
  isPlaybookPlanningEligible,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  MemoryGraphNodeSchema,
  MemoryGraphEdgeSchema,
  MemoryGraphQueryRequestSchema,
  MemorySensitivity,
  MemorySourceType,
} from '../../src/memory/index.js';

describe('Canonical Memory Compression, Episodic, & Graph Contracts (@nexusos/contracts/memory)', () => {
  // -------------------------------------------------------------------------
  // 1. Compression & Lossiness Contracts
  // -------------------------------------------------------------------------
  it('validates LossinessClassSchema for all 3 classes and rejects unknown', () => {
    assert.equal(LossinessClassSchema.parse('LOSSLESS'), LossinessClass.LOSSLESS);
    assert.equal(LossinessClassSchema.parse('BOUNDED_LOSSY'), LossinessClass.BOUNDED_LOSSY);
    assert.equal(LossinessClassSchema.parse('HIGH_LOSSY'), LossinessClass.HIGH_LOSSY);

    assert.throws(() => LossinessClassSchema.parse('INFINITE_LOSS'));
    assert.throws(() => LossinessClassSchema.parse('ZERO'));
  });

  it('validates CompressionStrategySchema for all 3 strategies and rejects unknown', () => {
    assert.equal(CompressionStrategySchema.parse('EXTRACTIVE'), CompressionStrategy.EXTRACTIVE);
    assert.equal(CompressionStrategySchema.parse('ABSTRACTIVE'), CompressionStrategy.ABSTRACTIVE);
    assert.equal(
      CompressionStrategySchema.parse('HIERARCHICAL_SUMMARIZATION'),
      CompressionStrategy.HIERARCHICAL_SUMMARIZATION,
    );

    assert.throws(() => CompressionStrategySchema.parse('UNSUPERVISED'));
  });

  it('validates MemoryCitationSchema with required provenance and attribution', () => {
    const citation = MemoryCitationSchema.parse({
      memoryId: 'mem-101',
      citationToken: 'cite:mem-101',
      sourceType: MemorySourceType.TASK_EXECUTION,
      sourceId: 'task-99',
      sensitivity: MemorySensitivity.INTERNAL,
      snippet: 'Key findings from task execution',
      sourceHash: 'sha256-abc12345',
    });

    assert.equal(citation.memoryId, 'mem-101');
    assert.equal(citation.citationToken, 'cite:mem-101');
    assert.equal(citation.sensitivity, MemorySensitivity.INTERNAL);

    // Rejects missing memoryId or citationToken
    assert.throws(() =>
      MemoryCitationSchema.parse({
        memoryId: '',
        citationToken: 'cite:empty',
        sourceType: MemorySourceType.USER_EXPLICIT,
        sensitivity: MemorySensitivity.PUBLIC,
      }),
    );
  });

  it('validates MemoryCompressionRequestSchema defaults and rejects empty source memory IDs', () => {
    const parsed = MemoryCompressionRequestSchema.parse({
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      sourceMemoryIds: ['mem-1', 'mem-2'],
    });

    assert.equal(parsed.strategy, CompressionStrategy.EXTRACTIVE);
    assert.equal(parsed.maxTokens, 500);
    assert.deepEqual(parsed.preservationDirectives, []);

    // Rejects empty source array
    assert.throws(() =>
      MemoryCompressionRequestSchema.parse({
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        sourceMemoryIds: [],
      }),
    );
  });

  it('validates MemoryCompressionResponseSchema requiring non-empty citations (058-SEC-02)', () => {
    const response = MemoryCompressionResponseSchema.parse({
      id: 'comp-1',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      summaryContent: 'Synthesized summary of source executions.',
      strategy: CompressionStrategy.EXTRACTIVE,
      lossinessClass: LossinessClass.BOUNDED_LOSSY,
      sourceMemoryIds: ['mem-1'],
      citations: [
        {
          memoryId: 'mem-1',
          citationToken: 'cite:mem-1',
          sourceType: MemorySourceType.TASK_EXECUTION,
          sensitivity: MemorySensitivity.INTERNAL,
        },
      ],
      inheritedSensitivity: MemorySensitivity.INTERNAL,
      originalTokenEstimate: 1200,
      compressedTokenEstimate: 300,
      compressionRatio: 0.25,
      preservedClaims: ['File created at path /app/out.txt'],
      provenance: {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: 'service:memory-compressor',
        timestamp: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    });

    assert.equal(response.lossinessClass, LossinessClass.BOUNDED_LOSSY);
    assert.equal(response.citations.length, 1);

    // Rejects empty citations array (058-SEC-02)
    assert.throws(() =>
      MemoryCompressionResponseSchema.parse({
        ...response,
        citations: [],
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 2. Sensitivity Inheritance (058-SEC-04)
  // -------------------------------------------------------------------------
  it('enforces highest sensitivity inheritance across all input combinations (058-SEC-04)', () => {
    assert.equal(
      inheritHighestSensitivity([MemorySensitivity.PUBLIC, MemorySensitivity.INTERNAL]),
      MemorySensitivity.INTERNAL,
    );

    assert.equal(
      inheritHighestSensitivity([MemorySensitivity.INTERNAL, MemorySensitivity.CONFIDENTIAL]),
      MemorySensitivity.CONFIDENTIAL,
    );

    assert.equal(
      inheritHighestSensitivity([
        MemorySensitivity.PUBLIC,
        MemorySensitivity.CONFIDENTIAL,
        MemorySensitivity.RESTRICTED,
        MemorySensitivity.INTERNAL,
      ]),
      MemorySensitivity.RESTRICTED,
    );

    // All public results in public
    assert.equal(inheritHighestSensitivity([MemorySensitivity.PUBLIC]), MemorySensitivity.PUBLIC);

    // Empty list defaults to safe internal
    assert.equal(inheritHighestSensitivity([]), MemorySensitivity.INTERNAL);
  });

  // -------------------------------------------------------------------------
  // 3. Episodic Episode Contracts
  // -------------------------------------------------------------------------
  it('validates EpisodicEpisodeSchema with node receipts and human decisions', () => {
    const episode = EpisodicEpisodeSchema.parse({
      id: 'ep-001',
      taskId: 'task-123',
      executionId: 'exec-456',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      goal: 'Deploy application stack to sandbox',
      planGraphVersion: 1,
      outcome: EpisodeOutcome.SUCCESS,
      summary: 'Application stack deployed successfully with all health checks passing.',
      nodeReceipts: [
        {
          nodeId: 'node-1',
          capability: 'filesystem.write',
          status: 'COMPLETED',
          durationMs: 45,
          evidenceHash: 'hash-abc',
        },
        {
          nodeId: 'node-2',
          capability: 'terminal.execute',
          status: 'COMPLETED',
          durationMs: 120,
        },
      ],
      humanDecisions: [
        {
          decisionId: 'dec-1',
          action: 'APPROVED',
          principalId: 'user-admin',
          timestamp: new Date().toISOString(),
          rationale: 'Approved deployment script execution',
        },
      ],
      keyDecisions: ['Configured port 8080', 'Granted elevated write lease'],
      errorPatterns: [],
      tags: ['deployment', 'sandbox'],
      sensitivity: MemorySensitivity.INTERNAL,
      provenance: {
        sourceType: MemorySourceType.TASK_EXECUTION,
        creatorPrincipalId: 'service:orchestrator',
        timestamp: new Date().toISOString(),
      },
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    assert.equal(episode.outcome, EpisodeOutcome.SUCCESS);
    assert.equal(episode.nodeReceipts.length, 2);
    assert.equal(episode.humanDecisions.length, 1);
  });

  // -------------------------------------------------------------------------
  // 4. Procedural Playbook Proposals & Planning Eligibility (058-SEC-06)
  // -------------------------------------------------------------------------
  it('validates ProceduralPlaybookProposalSchema with default PROPOSED status', () => {
    const proposal = ProceduralPlaybookProposalSchema.parse({
      id: 'pb-001',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      title: 'Build and Verify TypeScript Project',
      goalPattern: 'build and verify typescript project',
      confidence: 0.85,
      steps: [
        {
          stepIndex: 0,
          capability: 'filesystem.read',
          description: 'Read package.json and tsconfig.json',
        },
        {
          stepIndex: 1,
          capability: 'terminal.execute',
          description: 'Execute build command',
          suggestedRiskTier: 'MEDIUM',
        },
      ],
      sourceEpisodeIds: ['ep-001'],
      provenance: {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: 'service:episodic-learner',
        timestamp: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    assert.equal(proposal.status, PlaybookStatus.PROPOSED);
    assert.equal(proposal.successCount, 1);
    assert.equal(proposal.failureCount, 0);
  });

  it('enforces 058-SEC-06: playbooks require confidence >= 0.90 or human approval for planning eligibility', () => {
    const baseProposal = {
      id: 'pb-002',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      title: 'Test Playbook',
      goalPattern: 'test pattern',
      confidence: 0.85,
      status: PlaybookStatus.PROPOSED,
      steps: [
        {
          stepIndex: 0,
          capability: 'filesystem.read',
          description: 'Read file',
          suggestedRiskTier: 'LOW' as const,
        },
      ],
      sourceEpisodeIds: ['ep-002'],
      sensitivity: MemorySensitivity.INTERNAL,
      provenance: {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: 'service:episodic-learner',
        timestamp: new Date().toISOString(),
        verified: false,
      },
      successCount: 1,
      failureCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 1. Proposed with confidence < 0.90 -> NOT eligible
    assert.equal(isPlaybookPlanningEligible(baseProposal), false);

    // 2. High confidence (>= 0.90) -> eligible
    assert.equal(isPlaybookPlanningEligible({ ...baseProposal, confidence: 0.9 }), true);
    assert.equal(isPlaybookPlanningEligible({ ...baseProposal, confidence: 0.95 }), true);

    // 3. Explicit human approval -> eligible regardless of lower confidence
    assert.equal(
      isPlaybookPlanningEligible({
        ...baseProposal,
        confidence: 0.75,
        humanApproval: {
          approvedBy: 'lead-architect',
          approvedAt: new Date().toISOString(),
          approvalId: 'appr-001',
        },
      }),
      true,
    );

    // 4. Explicit APPROVED status -> eligible
    assert.equal(
      isPlaybookPlanningEligible({
        ...baseProposal,
        status: PlaybookStatus.APPROVED,
      }),
      true,
    );

    // 5. Explicit PLANNING_ELIGIBLE status -> eligible
    assert.equal(
      isPlaybookPlanningEligible({
        ...baseProposal,
        status: PlaybookStatus.PLANNING_ELIGIBLE,
      }),
      true,
    );

    // 6. Explicitly REJECTED -> NOT eligible even if confidence is 1.0
    assert.equal(
      isPlaybookPlanningEligible({
        ...baseProposal,
        confidence: 1.0,
        status: PlaybookStatus.REJECTED,
      }),
      false,
    );
  });

  // -------------------------------------------------------------------------
  // 5. Memory Knowledge Graph Contracts (058-SEC-03)
  // -------------------------------------------------------------------------
  it('validates MemoryGraphNodeSchema and MemoryGraphEdgeSchema with scoped provenance', () => {
    const node = MemoryGraphNodeSchema.parse({
      id: 'node-entity-1',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      nodeType: MemoryGraphNodeType.ENTITY,
      label: 'AuthenticationService',
      confidence: 0.95,
      createdAt: new Date().toISOString(),
    });

    const edge = MemoryGraphEdgeSchema.parse({
      id: 'edge-1',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      sourceNodeId: 'node-entity-1',
      targetNodeId: 'node-task-1',
      edgeType: MemoryGraphEdgeType.RELATES_TO,
      weight: 1.5,
      confidence: 0.92,
      provenance: {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: 'service:graph-engine',
        timestamp: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    });

    assert.equal(node.nodeType, MemoryGraphNodeType.ENTITY);
    assert.equal(edge.edgeType, MemoryGraphEdgeType.RELATES_TO);
    assert.equal(edge.tenantId, 'tenant-1');
    assert.equal(edge.workspaceId, 'ws-1');
  });

  it('validates MemoryGraphQueryRequestSchema with bounded maxDepth (<= 4)', () => {
    const query = MemoryGraphQueryRequestSchema.parse({
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      maxDepth: 3,
      limit: 50,
    });

    assert.equal(query.maxDepth, 3);
    assert.equal(query.limit, 50);

    // Max depth > 4 is rejected to prevent graph traversal resource exhaustion
    assert.throws(() =>
      MemoryGraphQueryRequestSchema.parse({
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        maxDepth: 5,
      }),
    );
  });
});
