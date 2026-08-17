import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TaskScheduler,
  ExecutionQueue,
  AgentOrchestrator,
  RuntimeRouter,
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

describe('Task 03R Task Scheduler — Security Hardening & Vulnerability Audit', () => {
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

    return { scheduler, orchestrator };
  }

  it('RISK-R01: rejects task admission without valid lease header', async () => {
    const { scheduler } = createTestScheduler();
    const invalidLease = createValidLeaseHeader({ signature: undefined });

    const result = await scheduler.scheduleTask({
      task_id: 'task-r01',
      step_id: 'step-1',
      correlation_id: 'corr-r01',
      leaseHeader: invalidLease,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'LEASE_DENIED');
  });

  it('RISK-R02: rejects cross-tenant cancellation and status probing requests', async () => {
    const { scheduler } = createTestScheduler();
    const taskId = 'task-r02-tenantA';
    const leaseHeader = createValidLeaseHeader();

    // Mock orchestrator to hold task queued
    (scheduler as unknown as Record<string, unknown>)['orchestrator'] = {
      getActiveCount: () => 5,
      getTaskStatus: () => null,
      cancelTask: () => Promise.resolve(true),
    };

    await scheduler.scheduleTask({
      task_id: taskId,
      step_id: 'step-1',
      correlation_id: 'corr-r02',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    // Foreign tenant cancel attempt
    const cancelRes = await scheduler.cancelScheduledTask(taskId, 'foreign-tenant-999');
    assert.equal(cancelRes, false, 'Cross-tenant task cancellation MUST be rejected');

    // Foreign tenant status query
    const statusRes = scheduler.getScheduledTaskStatus(taskId, 'foreign-tenant-999');
    assert.equal(statusRes, null, 'Cross-tenant status probing MUST return null');
  });

  it('RISK-R03: prevents priority escalation from untrusted payloads', async () => {
    const { scheduler } = createTestScheduler();
    // Lease without agent:foundation scope
    const untrustedLease = createValidLeaseHeader({ scopes: ['device:read'] });

    await scheduler.scheduleTask({
      task_id: 'task-r03-escalate',
      step_id: 'step-1',
      correlation_id: 'corr-r03',
      leaseHeader: untrustedLease,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: { isCritical: true }, // Attempts escalation
    });

    const queue = (scheduler as unknown as Record<string, ExecutionQueue>)['queue'];
    assert.equal(
      queue.getLaneCount('CRITICAL'),
      0,
      'Untrusted payload MUST NOT escalate to CRITICAL lane',
    );
  });

  it('RISK-R04 & R08: enforces queue capacity saturation and tenant quota limits', async () => {
    const smallQueue = new ExecutionQueue(10, 3); // Max 10 total, max 3 per tenant
    const { scheduler } = createTestScheduler();
    (scheduler as unknown as Record<string, unknown>)['queue'] = smallQueue;
    (scheduler as unknown as Record<string, unknown>)['orchestrator'] = {
      getActiveCount: () => 5, // Hold in queue
      getTaskStatus: () => null,
    };

    const leaseHeader = createValidLeaseHeader();

    // Fill tenant quota (3 items)
    for (let i = 0; i < 3; i++) {
      const res = await scheduler.scheduleTask({
        task_id: `task-quota-${i}`,
        step_id: 'step-1',
        correlation_id: `corr-${i}`,
        leaseHeader,
        capabilityId: 'device.execute',
        runtimeCategory: 'device',
        payload: {},
      });
      assert.equal(res.success, true);
    }

    // 4th item for same tenant exceeds tenant quota
    const overflowRes = await scheduler.scheduleTask({
      task_id: 'task-quota-overflow',
      step_id: 'step-1',
      correlation_id: 'corr-overflow',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    assert.equal(overflowRes.success, false);
    assert.equal(overflowRes.errorCode, 'QUEUE_SATURATED');
  });

  it('RISK-R05: rejects duplicate active task execution and re-queueing', async () => {
    const { scheduler } = createTestScheduler();
    const taskId = 'task-r05-dup';
    const leaseHeader = createValidLeaseHeader();

    (scheduler as unknown as Record<string, unknown>)['orchestrator'] = {
      getActiveCount: () => 5,
      getTaskStatus: () => 'QUEUED',
    };

    await scheduler.scheduleTask({
      task_id: taskId,
      step_id: 'step-1',
      correlation_id: 'corr-1',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    // Duplicate scheduling request
    const dupRes = await scheduler.scheduleTask({
      task_id: taskId,
      step_id: 'step-2',
      correlation_id: 'corr-2',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    assert.equal(dupRes.success, false);
    assert.equal(dupRes.errorCode, 'DUPLICATE_TASK_ID');
  });

  it('RISK-R09: fails closed when agent lifecycle state is STOPPING, STOPPED, or FAILED', async () => {
    const { scheduler: stoppingScheduler } = createTestScheduler(AgentLifecycleState.STOPPING);
    const leaseHeader = createValidLeaseHeader();

    const result = await stoppingScheduler.scheduleTask({
      task_id: 'task-r09-stopping',
      step_id: 'step-1',
      correlation_id: 'corr-r09',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'LIFECYCLE_DENIED');
  });

  it('RISK-R13: does not double-count active concurrency slots', async () => {
    const { scheduler, orchestrator } = createTestScheduler();
    const initialActive = orchestrator.getActiveCount();
    assert.equal(initialActive, 0);

    const leaseHeader = createValidLeaseHeader();
    await scheduler.scheduleTask({
      task_id: 'task-r13-count',
      step_id: 'step-1',
      correlation_id: 'corr-r13',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    const metrics = scheduler.getQueueMetrics();
    assert.equal(
      metrics.activeCount,
      orchestrator.getActiveCount(),
      'Scheduler MUST reflect 03Q active count without double-counting',
    );
  });

  it('prunes expired queue items based on expiresAt', () => {
    const queue = new ExecutionQueue();
    const now = Date.now();
    const leaseHeader = createValidLeaseHeader();

    queue.enqueue({
      request: {
        task_id: 'task-expired',
        step_id: 'step-1',
        correlation_id: 'corr-exp',
        leaseHeader,
        capabilityId: 'device.execute',
        runtimeCategory: 'device',
        payload: {},
      },
      priorityLane: 'NORMAL',
      tenantId: sampleIdentity.pairedTenantId,
      queuedAt: now - 10000,
      expiresAt: now - 1000, // Expired
      retryCount: 0,
    });

    const expired = queue.pruneExpired(now);
    assert.equal(expired.length, 1);
    assert.equal(queue.getSize(), 0);
  });
});
