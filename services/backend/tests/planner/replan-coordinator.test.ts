import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ReplanCoordinator, defaultCapabilityRegistry } from '../../src/planner/index.js';
import { AdaptiveReplanRequest, TaskGraphCreateRequest } from '@nexusos/contracts';

describe('Replan Coordinator — Functional Unit Tests', () => {
  const defaultTenantId = 'e0000000-0000-4000-8000-000000000001';
  const defaultWorkspaceId = 'e0000000-0000-4000-8000-000000000002';
  const defaultAgentId = 'e0000000-0000-4000-8000-000000000003';

  let coordinator: ReplanCoordinator;
  let sampleDAG: TaskGraphCreateRequest;

  beforeEach(() => {
    coordinator = new ReplanCoordinator(defaultCapabilityRegistry);

    sampleDAG = {
      title: 'Sample Data Extraction Workflow',
      targetAgentId: defaultAgentId,
      nodes: [
        {
          nodeId: 'node-inspect',
          capabilityId: 'filesystem.listDirectory',
          runtimeCategory: 'FILESYSTEM',
          payload: { path: './data' },
        },
        {
          nodeId: 'node-download',
          capabilityId: 'browser.navigate',
          runtimeCategory: 'BROWSER',
          payload: { url: 'https://example.com/data.csv' },
          dependencies: ['node-inspect'],
        },
        {
          nodeId: 'node-transform',
          capabilityId: 'filesystem.writeFile',
          runtimeCategory: 'FILESYSTEM',
          payload: { path: './dist/data.json' },
          dependencies: ['node-download'],
          compensationPayload: { action: 'deleteFile', path: './dist/data.json' },
        },
      ],
    };
  });

  it('coordinates replan from v1 to v2 with monotonic version increment', () => {
    const taskId = crypto.randomUUID();
    const originalWorkflowId = crypto.randomUUID();

    const request: AdaptiveReplanRequest = {
      tenantId: defaultTenantId,
      workspaceId: defaultWorkspaceId,
      taskId,
      originalWorkflowId,
      priorVersion: 1,
      replanIteration: 1,
      failedNodeId: 'node-download',
      failureReason: 'HTTP 504 Gateway Timeout connecting to https://example.com/data.csv',
      failureEvidenceChecksum: 'f'.repeat(64),
      isTerminalFailure: false,
      completedNodes: ['node-inspect'],
      completedNodeOutputs: {
        'node-inspect': { files: ['data/manifest.txt'] },
      },
      originalDAG: sampleDAG,
      preferredStrategy: 'REPLAN_REMAINING_NODES',
    };

    const response = coordinator.coordinateReplan(request);

    assert.equal(response.taskId, taskId);
    assert.equal(response.priorWorkflowId, originalWorkflowId);
    assert.notEqual(response.successorWorkflowId, originalWorkflowId);
    assert.equal(response.version, 2);
    assert.equal(response.replanIteration, 1);
    assert.equal(response.status, 'PROPOSED');
    assert.equal(response.strategy, 'REPLAN_REMAINING_NODES');
    assert.ok(response.replanRationale.length > 0);

    // Completed node must be preserved in sealed list and omitted from successor DAG execution
    assert.ok(response.preservedCompletedNodes.includes('node-inspect'));
    const successorNodeIds = response.successorDAG.nodes.map((n) => n.nodeId);
    assert.ok(!successorNodeIds.includes('node-inspect'));
  });

  it('coordinates replan from v2 to v3 with monotonic version increment', () => {
    const taskId = crypto.randomUUID();
    const priorWorkflowId = crypto.randomUUID();

    const request: AdaptiveReplanRequest = {
      tenantId: defaultTenantId,
      workspaceId: defaultWorkspaceId,
      taskId,
      originalWorkflowId: priorWorkflowId,
      priorVersion: 2,
      replanIteration: 2,
      failedNodeId: 'node-download',
      failureReason: 'Fallback mirror connection reset by peer',
      failureEvidenceChecksum: 'e'.repeat(64),
      isTerminalFailure: false,
      completedNodes: ['node-inspect'],
      completedNodeOutputs: {
        'node-inspect': { files: ['data/manifest.txt'] },
      },
      originalDAG: sampleDAG,
      preferredStrategy: 'RETRY_NODE_WITH_BACKOFF',
    };

    const response = coordinator.coordinateReplan(request);

    assert.equal(response.version, 3);
    assert.equal(response.replanIteration, 2);
    assert.equal(response.priorWorkflowId, priorWorkflowId);
    assert.equal(response.status, 'PROPOSED');
  });

  it('rejects replan when replan iteration exceeds hard limit of 3 (057-SEC-03 & 057-SEC-05)', () => {
    const request: AdaptiveReplanRequest = {
      tenantId: defaultTenantId,
      workspaceId: defaultWorkspaceId,
      taskId: crypto.randomUUID(),
      originalWorkflowId: crypto.randomUUID(),
      priorVersion: 3,
      replanIteration: 4, // Exceeds MAX_REPLAN_ITERATIONS (3)
      failedNodeId: 'node-download',
      failureReason: 'Third fallback attempt failed',
      failureEvidenceChecksum: 'd'.repeat(64),
      isTerminalFailure: false,
      completedNodes: [],
      completedNodeOutputs: {},
      originalDAG: sampleDAG,
      preferredStrategy: 'REPLAN_REMAINING_NODES',
    };

    assert.throws(() => {
      coordinator.coordinateReplan(request);
    }, /EXCEEDS_MAX_REPLAN_ITERATIONS/);
  });

  it('handles ambiguous execution outcome as NEEDS_RECONCILIATION without blindly retrying mutations', () => {
    const request: AdaptiveReplanRequest = {
      tenantId: defaultTenantId,
      workspaceId: defaultWorkspaceId,
      taskId: crypto.randomUUID(),
      originalWorkflowId: crypto.randomUUID(),
      priorVersion: 1,
      replanIteration: 1,
      failedNodeId: 'node-transform',
      failureReason: 'Socket hung up during file commit: outcome unknown, state unverified',
      failureEvidenceChecksum: 'c'.repeat(64),
      isTerminalFailure: false,
      completedNodes: ['node-inspect', 'node-download'],
      completedNodeOutputs: {},
      originalDAG: sampleDAG,
      preferredStrategy: 'REPLAN_REMAINING_NODES',
    };

    const response = coordinator.coordinateReplan(request);

    assert.equal(response.strategy, 'FAIL_AND_COMPENSATE');
    assert.ok(response.replanRationale.includes('NEEDS_RECONCILIATION'));
    // Compensation node generated because node-transform defines compensationPayload
    assert.ok(response.compensationNodes && response.compensationNodes.length > 0);
  });

  it('rejects replan when isTerminalFailure flag is set', () => {
    const request: AdaptiveReplanRequest = {
      tenantId: defaultTenantId,
      workspaceId: defaultWorkspaceId,
      taskId: crypto.randomUUID(),
      originalWorkflowId: crypto.randomUUID(),
      priorVersion: 1,
      replanIteration: 1,
      failedNodeId: 'node-inspect',
      failureReason: 'Hardware storage volume destroyed',
      failureEvidenceChecksum: 'b'.repeat(64),
      isTerminalFailure: true,
      completedNodes: [],
      completedNodeOutputs: {},
      originalDAG: sampleDAG,
      preferredStrategy: 'REPLAN_REMAINING_NODES',
    };

    assert.throws(() => {
      coordinator.coordinateReplan(request);
    }, /TERMINAL_FAILURE_NO_REPLAN/);
  });

  it('preserves immutable prior version and does not mutate input request DAG', () => {
    const originalNodesSnapshot = JSON.stringify(sampleDAG.nodes);

    const request: AdaptiveReplanRequest = {
      tenantId: defaultTenantId,
      workspaceId: defaultWorkspaceId,
      taskId: crypto.randomUUID(),
      originalWorkflowId: crypto.randomUUID(),
      priorVersion: 1,
      replanIteration: 1,
      failedNodeId: 'node-download',
      failureReason: 'Temporary network partition',
      failureEvidenceChecksum: 'a'.repeat(64),
      isTerminalFailure: false,
      completedNodes: ['node-inspect'],
      completedNodeOutputs: {},
      originalDAG: sampleDAG,
      preferredStrategy: 'REPLAN_REMAINING_NODES',
    };

    const response = coordinator.coordinateReplan(request);

    // Verify original DAG was untouched
    assert.equal(JSON.stringify(sampleDAG.nodes), originalNodesSnapshot);
    // Successor DAG has its own new title and metadata
    assert.ok(response.successorDAG.title.includes('Replan v2'));
  });
});
