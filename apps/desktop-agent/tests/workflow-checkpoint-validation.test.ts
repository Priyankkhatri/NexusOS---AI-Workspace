/**
 * Task 03S — WorkflowEngine Checkpoint Restore Validation
 * Regression tests: malformed checkpoint rejection, tampered checkpoint detection,
 * workflowId key mismatch detection, and clean restoration from valid checkpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  WorkflowEngine,
  AgentOrchestrator,
  RuntimeRouter,
  ExecutionLeaseBoundary,
  CapabilityRegistry,
  RuntimeRegistry,
  RedactionFilter,
  HardwareAttestationStatus,
  AgentIdentity,
  AgentLifecycleState,
  MockTransportAdapter,
  ProductionControlPlaneClient,
  ControlPlaneConfig,
} from '../src/index.js';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import { TaskScheduler } from '../src/scheduler/task-scheduler.js';
import { StateManager } from '../src/state/state-manager.js';

class AlwaysAllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Always allow in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }
  getSnapshot(): PolicySnapshot {
    return { policyVersion: '1.0.0', policyHash: 'test-hash', createdAt: new Date().toISOString(), rules: [] };
  }
}

const sampleIdentity: AgentIdentity = {
  deviceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  deviceFingerprint: 'sm-fp-001',
  pairedTenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  agentVersion: '0.1.0-sprint0',
  enrolledAt: new Date().toISOString(),
};

const identityProvider = {
  getIdentity: async () => sampleIdentity,
  verifyHardwareAttestation: async () => ({
    status: HardwareAttestationStatus.NOT_IMPLEMENTED,
    reason: 'Foundation level',
  }),
};

const mockConfig: ControlPlaneConfig = {
  gatewayUrl: 'wss://gateway.nexusos.internal/v1/stream',
  heartbeatIntervalMs: 60000,
  idleTimeoutMs: 180000,
  maxFrameSizeBytes: 1024 * 1024,
  maxSpoolSizeBytes: 50 * 1024 * 1024,
  reconnectInitialDelayMs: 100,
  reconnectMaxDelayMs: 1000,
  reconnectMultiplier: 2.0,
};

const leaseBoundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator());
const capabilityRegistry = new CapabilityRegistry();
const runtimeRegistry = new RuntimeRegistry();
const runtimeRouter = new RuntimeRouter(capabilityRegistry, runtimeRegistry);

/**
 * Creates an in-memory StateManager populated with a specific checkpoint.
 */
function createStateManagerWithCheckpoint(
  workflowId: string,
  checkpoint: unknown,
): StateManager {
  const store = new Map<string, unknown>();
  store.set('workflow_index', [workflowId]);
  store.set(`workflow_checkpoint:${workflowId}`, checkpoint);

  return {
    get: async <T>(key: string): Promise<T | null> => {
      return (store.get(key) as T) ?? null;
    },
    set: async <T>(key: string, value: T): Promise<void> => {
      store.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
    },
    has: async (key: string): Promise<boolean> => store.has(key),
    clear: async (): Promise<void> => { store.clear(); },
    shutdown: (): void => {},
  } as unknown as StateManager;
}

function createWorkflowEngine(stateManager?: StateManager) {
  const mockTransport = new MockTransportAdapter();
  const controlPlaneClient = new ProductionControlPlaneClient(
    mockConfig, identityProvider, leaseBoundary,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    mockTransport,
  );
  const orchestrator = new AgentOrchestrator(
    { agentVersion: '0.1.0-sprint0' } as never,
    identityProvider, controlPlaneClient, leaseBoundary, runtimeRouter,
    undefined, undefined, undefined, new RedactionFilter(), undefined, undefined,
    () => AgentLifecycleState.READY,
  );
  const scheduler = new TaskScheduler(
    { agentVersion: '0.1.0-sprint0' } as never,
    identityProvider, leaseBoundary, orchestrator,
    undefined, undefined, new RedactionFilter(), undefined,
    () => AgentLifecycleState.READY,
  );
  return new WorkflowEngine(
    { agentVersion: '0.1.0-sprint0' } as never,
    identityProvider, leaseBoundary, orchestrator, scheduler,
    stateManager, undefined, undefined, undefined,
    () => AgentLifecycleState.READY,
  );
}

function validCheckpoint(workflowId: string): unknown {
  return {
    workflowId,
    taskId: crypto.randomUUID(),
    tenantId: sampleIdentity.pairedTenantId,
    deviceId: sampleIdentity.deviceId,
    correlationId: crypto.randomUUID(),
    status: 'Running',
    nodeStates: {},
    completedNodes: [],
    pendingNodes: [],
    activeNodes: [],
    nodeOutputs: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  };
}

// ============================================================
// Checkpoint Restore Validation
// ============================================================

describe('Task 03S — WorkflowEngine: checkpoint restore validation', () => {
  it('CP-01: initialize() skips null checkpoint and cleans up index entry', async () => {
    const workflowId = crypto.randomUUID();
    const store = new Map<string, unknown>();
    store.set('workflow_index', [workflowId]);
    // No checkpoint stored for this workflowId
    const stateManager = {
      get: async <T>(key: string): Promise<T | null> => (store.get(key) as T) ?? null,
      set: async <T>(key: string, value: T): Promise<void> => { store.set(key, value); },
      delete: async (key: string): Promise<void> => { store.delete(key); },
      has: async (key: string): Promise<boolean> => store.has(key),
      clear: async (): Promise<void> => { store.clear(); },
      shutdown: (): void => {},
    } as unknown as StateManager;

    const engine = createWorkflowEngine(stateManager);
    await engine.initialize();
    engine.shutdown();

    // The invalid workflow entry must be removed from the index
    const updatedIndex = store.get('workflow_index') as string[];
    assert.equal(
      updatedIndex.includes(workflowId), false,
      'Null checkpoint must be removed from workflow index',
    );
  });

  it('CP-02: initialize() rejects malformed checkpoint (missing required fields)', async () => {
    const workflowId = crypto.randomUUID();
    const malformedCheckpoint = { workflowId, status: 'Running' }; // missing many required fields
    const stateManager = createStateManagerWithCheckpoint(workflowId, malformedCheckpoint);

    const engine = createWorkflowEngine(stateManager);
    await engine.initialize();
    engine.shutdown();

    // Engine must not register the malformed state as active
    const status = engine.getWorkflowStatus(workflowId);
    assert.equal(status, null, 'Malformed checkpoint must NOT be loaded into active workflows');
  });

  it('CP-03: initialize() rejects checkpoint with workflowId mismatch (tampering)', async () => {
    const indexedId = crypto.randomUUID();
    const tamperedId = crypto.randomUUID(); // Different from index key
    const tamperedCheckpoint = { ...validCheckpoint(tamperedId) };
    const stateManager = createStateManagerWithCheckpoint(indexedId, tamperedCheckpoint);

    const engine = createWorkflowEngine(stateManager);
    await engine.initialize();
    engine.shutdown();

    // Neither the indexed nor the tampered ID should appear as active
    assert.equal(engine.getWorkflowStatus(indexedId), null, 'Tampered checkpoint must not be loaded (indexedId)');
    assert.equal(engine.getWorkflowStatus(tamperedId), null, 'Tampered checkpoint must not be loaded (tamperedId)');
  });

  it('CP-04: initialize() rejects checkpoint with zero/negative epoch timestamps', async () => {
    const workflowId = crypto.randomUUID();
    const badTimestampCheckpoint = {
      ...validCheckpoint(workflowId),
      createdAt: 0,
      expiresAt: 0,
    };
    const stateManager = createStateManagerWithCheckpoint(workflowId, badTimestampCheckpoint);

    const engine = createWorkflowEngine(stateManager);
    await engine.initialize();
    engine.shutdown();

    assert.equal(
      engine.getWorkflowStatus(workflowId), null,
      'Checkpoint with zero timestamps must be rejected',
    );
  });

  it('CP-05: initialize() restores valid non-expired checkpoint into active workflows', async () => {
    const workflowId = crypto.randomUUID();
    const checkpoint = validCheckpoint(workflowId);
    const stateManager = createStateManagerWithCheckpoint(workflowId, checkpoint);

    const engine = createWorkflowEngine(stateManager);
    await engine.initialize();

    const status = engine.getWorkflowStatus(workflowId);
    engine.shutdown();

    // A valid Running checkpoint should be restored into active map
    assert.equal(
      status, 'RUNNING',
      'Valid non-expired Running checkpoint must be restored as RUNNING status',
    );
  });

  it('CP-06: initialize() does not load expired checkpoint (past expiresAt)', async () => {
    const workflowId = crypto.randomUUID();
    const expiredCheckpoint = {
      ...validCheckpoint(workflowId),
      expiresAt: Date.now() - 1000, // already expired
    };
    const stateManager = createStateManagerWithCheckpoint(workflowId, expiredCheckpoint);

    const engine = createWorkflowEngine(stateManager);
    await engine.initialize();
    engine.shutdown();

    assert.equal(
      engine.getWorkflowStatus(workflowId), null,
      'Expired checkpoint must not be restored into active workflows',
    );
  });

  it('CP-07: initialize() without StateManager resolves cleanly (no-op)', async () => {
    const engine = createWorkflowEngine(); // no stateManager
    await assert.doesNotReject(engine.initialize(), 'initialize() without StateManager must not throw');
    engine.shutdown();
  });
});
