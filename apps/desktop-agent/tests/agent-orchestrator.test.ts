import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AgentOrchestrator,
  RuntimeRouter,
  TaskExecutionRequest,
  ControlPlaneConfig,
  MockTransportAdapter,
  ProductionControlPlaneClient,
  ExecutionLeaseBoundary,
  CapabilityRegistry,
  RuntimeRegistry,
  MemoryCacheManager,
  DeviceRuntime,
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

describe('Task 03Q Agent Orchestrator — Functional & Integration Verification', () => {
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

  function createTestOrchestrator() {
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
    const memoryCache = new MemoryCacheManager(
      {},
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );
    const deviceRuntime = new DeviceRuntime(
      leaseBoundary,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );

    const orchestrator = new AgentOrchestrator(
      { agentVersion: '0.1.0-sprint0' } as never,
      identityProvider,
      controlPlaneClient,
      leaseBoundary,
      runtimeRouter,
      undefined, // stateManager
      memoryCache,
      undefined, // telemetrySpool
      undefined, // redactionFilter
      undefined, // notificationManager
      undefined, // secretsVault
      () => AgentLifecycleState.READY,
      undefined, // filesystem
      undefined, // terminal
      undefined, // browser
      undefined, // plugin
      deviceRuntime,
    );

    return { orchestrator, controlPlaneClient, memoryCache, deviceRuntime };
  }

  it('executes task end-to-end and transitions state from QUEUED to RUNNING to COMPLETED', async () => {
    const { orchestrator } = createTestOrchestrator();
    const taskId = 'task-001';
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-1',
      correlation_id: 'corr-001',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: { action: 'NOTIFICATION_SHOW', body: 'Hello' },
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, true);
    assert.equal(result.taskId, taskId);
    assert.equal(result.stepId, 'step-1');
    assert.equal(orchestrator.getTaskStatus(taskId), 'COMPLETED');
    assert.equal(orchestrator.getActiveCount(), 0);
  });

  it('routes task requests across all supported runtime categories', async () => {
    const { orchestrator } = createTestOrchestrator();
    const leaseHeader = createValidLeaseHeader();

    const categories = ['filesystem', 'terminal', 'browser', 'plugin', 'device', 'memory'];
    for (const cat of categories) {
      const request: TaskExecutionRequest = {
        task_id: `task-cat-${cat}`,
        step_id: `step-${cat}`,
        correlation_id: `corr-${cat}`,
        leaseHeader,
        capabilityId: `${cat}.execute`,
        runtimeCategory: cat,
        payload: { test: true },
      };

      const res = await orchestrator.executeTask(request);
      assert.equal(res.success, true, `Execution failed for category ${cat}`);
      assert.equal(orchestrator.getTaskStatus(`task-cat-${cat}`), 'COMPLETED');
    }
  });

  it('handles task cancellation gracefully via cancelTask()', async () => {
    const { orchestrator } = createTestOrchestrator();
    const taskId = 'task-cancel-001';
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-1',
      correlation_id: 'corr-cancel',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
      timeoutMs: 5000,
    };

    (orchestrator as unknown as Record<string, unknown>)['deviceRuntime'] = {
      execute: () => new Promise((resolve) => setTimeout(resolve, 200)),
    };

    const execPromise = orchestrator.executeTask(request);
    await new Promise((r) => setTimeout(r, 10)); // Ensure executeTask reaches RUNNING state
    const cancelSuccess = await orchestrator.cancelTask(taskId, 'User requested cancel');
    const result = await execPromise;

    assert.equal(cancelSuccess, true);
    assert.equal(result.success, false);
    assert.equal(orchestrator.getTaskStatus(taskId), 'CANCELED');
  });

  it('enforces task timeout when execution exceeds timeoutMs limit', async () => {
    const { orchestrator } = createTestOrchestrator();
    const taskId = 'task-timeout-001';
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-timeout',
      correlation_id: 'corr-timeout',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
      timeoutMs: 10, // 10ms quick timeout
    };

    // Replace device runtime with a slow implementation
    (orchestrator as unknown as Record<string, unknown>)['deviceRuntime'] = {
      execute: () => new Promise((resolve) => setTimeout(resolve, 500)),
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'TASK_TIMEOUT');
    assert.equal(orchestrator.getTaskStatus(taskId), 'FAILED');
  });

  it('enforces hard concurrency limit of maximum 5 active executions', async () => {
    const { orchestrator } = createTestOrchestrator();
    const leaseHeader = createValidLeaseHeader();

    // Fill up 5 concurrent execution slots
    (orchestrator as unknown as Record<string, unknown>)['activeCount'] = 5;

    const request: TaskExecutionRequest = {
      task_id: 'task-concurrency-exceeded',
      step_id: 'step-over',
      correlation_id: 'corr-over',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'CONCURRENCY_EXCEEDED');
  });
});
