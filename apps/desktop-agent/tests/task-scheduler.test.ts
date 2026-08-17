import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TaskScheduler,
  ExecutionQueue,
  AgentOrchestrator,
  RuntimeRouter,
  TaskExecutionRequest,
  ControlPlaneConfig,
  MockTransportAdapter,
  ProductionControlPlaneClient,
  ExecutionLeaseBoundary,
  CapabilityRegistry,
  RuntimeRegistry,
  RedactionFilter,
  HardwareAttestationStatus,
  AgentIdentity,
  AgentLifecycleState,
} from '../src/index.js';
import { ExecutionLeaseHeader } from '@nexusos/contracts';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';

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
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Task 03R Task Scheduler — Functional & Integration Verification', () => {
  const sampleIdentity: AgentIdentity = {
    deviceId: '11111111-1111-4111-8111-111111111111',
    deviceFingerprint: 'fingerprint123',
    pairedTenantId: '22222222-2222-4222-8222-222222222222',
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

  function createValidLeaseHeader(overrides: Record<string, unknown> = {}): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: sampleIdentity.deviceId,
      tenant_id: sampleIdentity.pairedTenantId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      scopes: ['agent:foundation', 'device:execute'],
      signature: 'test-signature-value',
      nonce: crypto.randomUUID(),
      ...overrides,
    } as unknown as ExecutionLeaseHeader;
  }

  function createTestScheduler(lifecycleState: AgentLifecycleState = AgentLifecycleState.READY) {
    const mockTransport = new MockTransportAdapter();
    const controlPlaneClient = new ProductionControlPlaneClient(
      mockConfig,
      identityProvider,
      leaseBoundary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTransport,
    );

    const orchestrator = new AgentOrchestrator(
      { agentVersion: '0.1.0-sprint0' } as never,
      identityProvider,
      controlPlaneClient,
      leaseBoundary,
      runtimeRouter,
      undefined,
      undefined,
      undefined,
      new RedactionFilter(),
      undefined,
      undefined,
      () => lifecycleState,
    );

    const scheduler = new TaskScheduler(
      { agentVersion: '0.1.0-sprint0' } as never,
      identityProvider,
      leaseBoundary,
      orchestrator,
      undefined,
      undefined,
      new RedactionFilter(),
      undefined,
      () => lifecycleState,
    );

    return { scheduler, orchestrator, controlPlaneClient };
  }

  it('schedules and executes a valid task end-to-end', async () => {
    const { scheduler } = createTestScheduler();
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: 'task-r-01',
      step_id: 'step-1',
      correlation_id: 'corr-r-01',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const result = await scheduler.scheduleTask(request);
    assert.equal(result.success, true);
    assert.equal(result.taskId, 'task-r-01');
  });

  it('enforces priority ordering (CRITICAL dequeues before NORMAL)', async () => {
    const queue = new ExecutionQueue(100, 20);
    const leaseHeader = createValidLeaseHeader();

    const normalItem = {
      request: {
        task_id: 'task-normal',
        step_id: 'step-1',
        correlation_id: 'corr-normal',
        leaseHeader,
        capabilityId: 'device.execute',
        runtimeCategory: 'device',
        payload: {},
      },
      priorityLane: 'NORMAL' as const,
      tenantId: sampleIdentity.pairedTenantId,
      queuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      retryCount: 0,
    };

    const criticalItem = {
      request: {
        task_id: 'task-critical',
        step_id: 'step-1',
        correlation_id: 'corr-critical',
        leaseHeader,
        capabilityId: 'device.execute',
        runtimeCategory: 'device',
        payload: {},
      },
      priorityLane: 'CRITICAL' as const,
      tenantId: sampleIdentity.pairedTenantId,
      queuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      retryCount: 0,
    };

    queue.enqueue(normalItem);
    queue.enqueue(criticalItem);

    const dequeued = queue.dequeue();
    assert.ok(dequeued);
    assert.equal(dequeued.request.task_id, 'task-critical', 'CRITICAL item MUST be dequeued first');
  });

  it('cancels a queued task cleanly', async () => {
    const { scheduler } = createTestScheduler();
    const leaseHeader = createValidLeaseHeader();
    const taskId = 'task-r-cancel';

    // Mock orchestrator to hold task in running if executed
    (scheduler as unknown as Record<string, unknown>)['orchestrator'] = {
      getActiveCount: () => 5, // Force task to remain queued
      getTaskStatus: () => null,
      cancelTask: () => Promise.resolve(true),
    };

    const request: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-1',
      correlation_id: 'corr-r-cancel',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    await scheduler.scheduleTask(request);

    const cancelRes = await scheduler.cancelScheduledTask(taskId, sampleIdentity.pairedTenantId);
    assert.equal(cancelRes, true);

    const status = scheduler.getScheduledTaskStatus(taskId, sampleIdentity.pairedTenantId);
    assert.equal(status, null);
  });

  it('returns queue metrics accurately', async () => {
    const { scheduler } = createTestScheduler();
    const metrics = scheduler.getQueueMetrics();

    assert.equal(typeof metrics.queuedCount, 'number');
    assert.equal(typeof metrics.activeCount, 'number');
    assert.equal(metrics.maxCapacity, 100);
    assert.ok(metrics.perLaneCounts);
  });
});
