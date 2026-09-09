import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GoalDecompositionRequestSchema,
  GoalDecompositionResponseSchema,
  AdaptiveReplanRequestSchema,
  AdaptiveReplanResponseSchema,
  AmbiguousGoalDetailsSchema,
  calculateDAGDepth,
  validatePlanSafetyLimits,
  PLANNER_SAFETY_LIMITS,
} from '../../src/planner/index.js';

describe('Planner Contracts (Task 057)', () => {
  const validTenantId = '11111111-1111-4111-8111-111111111111';
  const validWorkspaceId = '22222222-2222-4222-8222-222222222222';
  const validAgentId = '33333333-3333-4333-8333-333333333333';
  const validTaskId = '44444444-4444-4444-8444-444444444444';

  it('validates a well-formed GoalDecompositionRequest with defaults', () => {
    const raw = {
      goal: 'Clone repository, inspect tests, and summarize findings',
      tenantId: validTenantId,
      workspaceId: validWorkspaceId,
      targetAgentId: validAgentId,
      submittedBy: 'user-001',
    };

    const parsed = GoalDecompositionRequestSchema.parse(raw);
    assert.equal(parsed.goal, raw.goal);
    assert.equal(parsed.tenantId, validTenantId);
    assert.equal(parsed.constraints.timeoutMs, PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS);
    assert.equal(parsed.constraints.maxNodes, PLANNER_SAFETY_LIMITS.MAX_NODES);
    assert.deepEqual(parsed.contextReferences, []);
  });

  it('rejects an empty or malformed goal in GoalDecompositionRequest', () => {
    assert.throws(() =>
      GoalDecompositionRequestSchema.parse({
        goal: '',
        tenantId: validTenantId,
        workspaceId: validWorkspaceId,
        targetAgentId: validAgentId,
        submittedBy: 'user-001',
      }),
    );
  });

  it('validates a well-formed GoalDecompositionResponse proposal', () => {
    const raw = {
      planId: '22222222-2222-4222-8222-222222222222',
      normalizedGoal: 'Clone repo and inspect tests',
      tenantId: validTenantId,
      workspaceId: validWorkspaceId,
      strategy: 'SEQUENTIAL',
      dag: {
        title: 'Git inspection plan',
        targetAgentId: validAgentId,
        nodes: [
          {
            nodeId: 'node-1',
            capabilityId: 'filesystem.readFile',
            runtimeCategory: 'filesystem',
          },
        ],
      },
      rationale: 'Read repository configuration file first.',
      assumptions: ['Repository exists in workspace root.'],
      requiredCapabilities: ['filesystem.readFile'],
      estimatedRiskTier: 'LOW',
      requiresHumanApproval: false,
      confidence: 0.95,
      depth: 1,
      nodeCount: 1,
      edgeCount: 0,
      createdAt: new Date().toISOString(),
      status: 'PROPOSED',
    };

    const parsed = GoalDecompositionResponseSchema.parse(raw);
    assert.equal(parsed.status, 'PROPOSED');
    assert.equal(parsed.depth, 1);
    assert.equal(parsed.confidence, 0.95);
  });

  it('accurately calculates DAG depth across linear, branching, and diamond graphs', () => {
    // Single node: depth 1
    assert.equal(calculateDAGDepth([{ nodeId: 'n1' }]), 1);

    // Linear chain: n1 -> n2 -> n3 : depth 3
    const linear = [
      { nodeId: 'n1' },
      { nodeId: 'n2', dependencies: ['n1'] },
      { nodeId: 'n3', dependencies: ['n2'] },
    ];
    assert.equal(calculateDAGDepth(linear), 3);

    // Diamond: n1 -> n2, n3 -> n4 : depth 3
    const diamond = [
      { nodeId: 'n1' },
      { nodeId: 'n2', dependencies: ['n1'] },
      { nodeId: 'n3', dependencies: ['n1'] },
      { nodeId: 'n4', dependencies: ['n2', 'n3'] },
    ];
    assert.equal(calculateDAGDepth(diamond), 3);

    // Parallel independent nodes: depth 1
    const parallel = [{ nodeId: 'n1' }, { nodeId: 'n2' }, { nodeId: 'n3' }];
    assert.equal(calculateDAGDepth(parallel), 1);
  });

  it('enforces hard safety limits (057-SEC-03) via validatePlanSafetyLimits', () => {
    // Valid small DAG
    const validDAG = {
      nodes: [
        { nodeId: 'n1', timeoutMs: 5000 },
        { nodeId: 'n2', dependencies: ['n1'], timeoutMs: 5000 },
      ],
    };
    assert.equal(validatePlanSafetyLimits(validDAG).valid, true);

    // Exceeds max nodes (> 50)
    const tooManyNodes = {
      nodes: Array.from({ length: 51 }, (_, i) => ({ nodeId: `n${i}` })),
    };
    const nodeRes = validatePlanSafetyLimits(tooManyNodes);
    assert.equal(nodeRes.valid, false);
    assert.equal(nodeRes.errorCode, 'EXCEEDS_MAX_NODES');

    // Exceeds max timeout (> 300s)
    const timeoutExceeded = {
      nodes: [{ nodeId: 'n1', timeoutMs: 300001 }],
    };
    const timeoutRes = validatePlanSafetyLimits(timeoutExceeded);
    assert.equal(timeoutRes.valid, false);
    assert.equal(timeoutRes.errorCode, 'EXCEEDS_MAX_TIMEOUT');

    // Exceeds max depth (> 10)
    const deepNodes = Array.from({ length: 12 }, (_, i) => ({
      nodeId: `deep-${i}`,
      dependencies: i > 0 ? [`deep-${i - 1}`] : [],
    }));
    const depthRes = validatePlanSafetyLimits({ nodes: deepNodes });
    assert.equal(depthRes.valid, false);
    assert.equal(depthRes.errorCode, 'EXCEEDS_MAX_DEPTH');

    // Cycle detection
    const cyclicDAG = {
      nodes: [
        { nodeId: 'c1', dependencies: ['c2'] },
        { nodeId: 'c2', dependencies: ['c1'] },
      ],
    };
    const cycleRes = validatePlanSafetyLimits(cyclicDAG);
    assert.equal(cycleRes.valid, false);
    assert.equal(cycleRes.errorCode, 'DAG_CYCLE_DETECTED');
  });

  it('validates AdaptiveReplanRequest and rejects replan iteration > 3', () => {
    const validEvidenceChecksum = 'a'.repeat(64);
    const validReplan = {
      tenantId: validTenantId,
      workspaceId: validWorkspaceId,
      taskId: validTaskId,
      originalWorkflowId: '33333333-3333-4333-8333-333333333333',
      priorVersion: 1,
      replanIteration: 2,
      failedNodeId: 'node-2',
      failureReason: 'File not found at destination path',
      failureEvidenceChecksum: validEvidenceChecksum,
      originalDAG: {
        title: 'Original workflow',
        targetAgentId: validAgentId,
        nodes: [
          { nodeId: 'node-1', capabilityId: 'filesystem.readFile', runtimeCategory: 'filesystem' },
          {
            nodeId: 'node-2',
            capabilityId: 'filesystem.writeFile',
            runtimeCategory: 'filesystem',
            dependencies: ['node-1'],
          },
        ],
      },
    };

    const parsed = AdaptiveReplanRequestSchema.parse(validReplan);
    assert.equal(parsed.replanIteration, 2);
    assert.equal(parsed.preferredStrategy, 'REPLAN_REMAINING_NODES');

    // Replan iteration > 3 must be rejected
    assert.throws(() =>
      AdaptiveReplanRequestSchema.parse({
        ...validReplan,
        replanIteration: 4,
      }),
    );
  });

  it('validates AdaptiveReplanResponse with monotonic version lineage', () => {
    const raw = {
      successorWorkflowId: '44444444-4444-4444-8444-444444444444',
      tenantId: validTenantId,
      workspaceId: validWorkspaceId,
      taskId: validTaskId,
      priorWorkflowId: '33333333-3333-4333-8333-333333333333',
      version: 2,
      replanIteration: 1,
      strategy: 'REPLAN_REMAINING_NODES',
      replanRationale: 'Fallback to alternative search query after file not found.',
      successorDAG: {
        title: 'Replan v2',
        targetAgentId: validAgentId,
        nodes: [
          {
            nodeId: 'node-alt',
            capabilityId: 'filesystem.listDirectory',
            runtimeCategory: 'filesystem',
          },
        ],
      },
      preservedCompletedNodes: ['node-1'],
      estimatedRiskTier: 'LOW',
      requiresHumanApproval: false,
      createdAt: new Date().toISOString(),
      status: 'PROPOSED',
    };

    const parsed = AdaptiveReplanResponseSchema.parse(raw);
    assert.equal(parsed.version, 2);
    assert.deepEqual(parsed.preservedCompletedNodes, ['node-1']);
  });

  it('validates structured AmbiguousGoalDetails schema', () => {
    const raw = {
      code: 'AMBIGUOUS_GOAL',
      message: 'The goal specifies an action without target destination or deliverable.',
      missingDeliverables: ['targetFilePath', 'searchQuery'],
      clarificationPrompts: ['Please provide the target file path or directory.'],
      suggestedAlternatives: ['Inspect root directory files', 'Search workspace recursively'],
    };

    const parsed = AmbiguousGoalDetailsSchema.parse(raw);
    assert.equal(parsed.code, 'AMBIGUOUS_GOAL');
    assert.equal(parsed.missingDeliverables?.length, 2);
  });
});
