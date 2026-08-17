import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TaskScheduler,
  ExecutionQueue,
  TaskRetryPolicy,
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

  it('F-01 REMEDIATION: re-validates lease immediately at dispatch boundary and rejects execution if lease becomes invalid', async () => {
    let leaseValid = true;
    const mockLeaseBoundary = {
      validateLease: async () => ({
        valid: leaseValid,
        reason: leaseValid ? undefined : 'Lease revoked at dispatch boundary',
      }),
    } as unknown as ExecutionLeaseBoundary;

    const { scheduler, orchestrator } = createTestScheduler();
    (scheduler as unknown as Record<string, unknown>)['leaseBoundary'] = mockLeaseBoundary;
    (scheduler as unknown as Record<string, unknown>)['admissionController'] = {
      evaluateAdmission: async () => ({ admitted: true }),
    };

    const leaseHeader = createValidLeaseHeader();
    let executedInOrchestrator = false;
    (orchestrator as unknown as Record<string, unknown>)['executeTask'] = async () => {
      executedInOrchestrator = true;
      return { success: true, taskId: 'task-f01', stepId: 'step-1', executionTimeMs: 10 };
    };

    // 1. Lease valid during queueing
    leaseValid = false; // Lease becomes invalid right at dispatch boundary

    const res = await scheduler.scheduleTask({
      task_id: 'task-f01',
      step_id: 'step-1',
      correlation_id: 'corr-f01',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    });

    assert.equal(res.success, false);
    assert.equal(res.errorCode, 'LEASE_DENIED');
    assert.equal(
      executedInOrchestrator,
      false,
      'Orchestrator MUST NOT be called when lease fails at dispatch boundary',
    );
  });

  it('F-02 REMEDIATION: taskScheduler.shutdown() stops maintenance timer and is idempotent', () => {
    const { scheduler } = createTestScheduler();
    // Verify maintenance timer active
    assert.ok((scheduler as unknown as Record<string, unknown>)['maintenanceTimer'] !== undefined);

    scheduler.shutdown();
    assert.equal((scheduler as unknown as Record<string, unknown>)['maintenanceTimer'], undefined);

    // Repeated shutdown MUST be safe & idempotent
    assert.doesNotThrow(() => scheduler.shutdown());
  });

  it('F-03 REMEDIATION: TaskRetryPolicy calculates jitter strictly within [0.5, 1.5] bounds', () => {
    // Min jitter supplier
    const minPolicy = new TaskRetryPolicy(3, 1000, 30000, 2.0, () => 0.0);
    const minDelay = minPolicy.calculateNextBackoffDelay(1);
    assert.equal(minDelay, 500, 'Min jitter (0.0 supplier) MUST yield 50% of base delay (500ms)');

    // Max jitter supplier
    const maxPolicy = new TaskRetryPolicy(3, 1000, 30000, 2.0, () => 1.0);
    const maxDelay = maxPolicy.calculateNextBackoffDelay(1);
    assert.equal(
      maxDelay,
      1500,
      'Max jitter (1.0 supplier) MUST yield 150% of base delay (1500ms)',
    );
  });

  it('F-04 REMEDIATION: ExecutionQueue interleaves tasks in round-robin order across multiple tenants', () => {
    const queue = new ExecutionQueue(100, 20);
    const leaseHeader = createValidLeaseHeader();

    // Enqueue 3 tasks for Tenant A, 3 for Tenant B, 3 for Tenant C in same priority lane
    const tenants = ['tenant-A', 'tenant-B', 'tenant-C'];
    for (let i = 1; i <= 3; i++) {
      for (const tenantId of tenants) {
        queue.enqueue({
          request: {
            task_id: `task-${tenantId}-${i}`,
            step_id: 'step-1',
            correlation_id: `corr-${tenantId}-${i}`,
            leaseHeader: { ...leaseHeader, tenant_id: tenantId },
            capabilityId: 'device.execute',
            runtimeCategory: 'device',
            payload: {},
          },
          priorityLane: 'NORMAL',
          tenantId,
          queuedAt: Date.now(),
          expiresAt: Date.now() + 60000,
          retryCount: 0,
        });
      }
    }

    assert.equal(queue.getSize(), 9);

    // Dequeue all 9 items and record sequence of tenant IDs
    const sequence: string[] = [];
    for (let i = 0; i < 9; i++) {
      const item = queue.dequeue();
      assert.ok(item !== null);
      sequence.push(item!.tenantId);
    }

    assert.deepEqual(
      sequence,
      [
        'tenant-A',
        'tenant-B',
        'tenant-C',
        'tenant-A',
        'tenant-B',
        'tenant-C',
        'tenant-A',
        'tenant-B',
        'tenant-C',
      ],
      'Queue MUST interleave tasks in round-robin order across distinct tenants within the same priority lane',
    );
  });
});
