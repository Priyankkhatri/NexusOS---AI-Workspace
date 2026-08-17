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

describe('Task 03Q Agent Orchestrator — Security Hardening & Vulnerability Audit', () => {
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

  function createTestOrchestrator(
    lifecycleState: AgentLifecycleState = AgentLifecycleState.READY,
    redactionFilter?: RedactionFilter,
  ) {
    const mockTransport = new MockTransportAdapter();
    const controlPlaneClient = new ProductionControlPlaneClient(
      mockConfig,
      identityProvider,
      leaseBoundary,
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
      redactionFilter || new RedactionFilter(),
      undefined,
      undefined,
      () => lifecycleState,
    );

    return { orchestrator, controlPlaneClient };
  }

  it('VULNERABILITY-Q01: rejects task execution without a valid execution lease header', async () => {
    const { orchestrator } = createTestOrchestrator();
    // Lease missing signature
    const invalidLease = createValidLeaseHeader({ signature: undefined });

    const request: TaskExecutionRequest = {
      task_id: 'task-q01',
      step_id: 'step-1',
      correlation_id: 'corr-q01',
      leaseHeader: invalidLease,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'LEASE_DENIED');
  });

  it('VULNERABILITY-Q02: rejects duplicate message IDs under 15-minute replay protection', async () => {
    const { orchestrator } = createTestOrchestrator();
    const leaseHeader = createValidLeaseHeader();
    const messageId = 'msg-replay-001';

    const request: TaskExecutionRequest = {
      task_id: 'task-q02',
      step_id: 'step-1',
      correlation_id: 'corr-q02',
      message_id: messageId,
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const result1 = await orchestrator.executeTask(request);
    assert.equal(result1.success, true);

    // Second arrival with same message ID
    const result2 = await orchestrator.executeTask(request);
    assert.equal(result2.success, false);
    assert.equal(result2.errorCode, 'REPLAY_REJECTED');
  });

  it('VULNERABILITY-Q03: rejects task execution when tenant or device context mismatches paired agent identity', async () => {
    const { orchestrator } = createTestOrchestrator();
    const mismatchedLease = createValidLeaseHeader({
      tenant_id: '99999999-9999-4999-8999-999999999999', // Foreign tenant
    });

    const request: TaskExecutionRequest = {
      task_id: 'task-q03',
      step_id: 'step-1',
      correlation_id: 'corr-q03',
      leaseHeader: mismatchedLease,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'TENANT_DEVICE_MISMATCH');
  });

  it('VULNERABILITY-Q04: rejects task execution when agent lifecycle state is STOPPING, STOPPED, or FAILED', async () => {
    const { orchestrator: stoppingOrchestrator } = createTestOrchestrator(
      AgentLifecycleState.STOPPING,
    );
    const { orchestrator: failedOrchestrator } = createTestOrchestrator(AgentLifecycleState.FAILED);
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: 'task-q04',
      step_id: 'step-1',
      correlation_id: 'corr-q04',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const res1 = await stoppingOrchestrator.executeTask(request);
    assert.equal(res1.success, false);
    assert.equal(res1.errorCode, 'LIFECYCLE_DENIED');

    const res2 = await failedOrchestrator.executeTask(request);
    assert.equal(res2.success, false);
    assert.equal(res2.errorCode, 'LIFECYCLE_DENIED');
  });

  it('VULNERABILITY-Q05: redacts sensitive keys and secret values from runtime output and error tracebacks', async () => {
    const redactionFilter = new RedactionFilter();
    const { orchestrator } = createTestOrchestrator(AgentLifecycleState.READY, redactionFilter);
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: 'task-q05',
      step_id: 'step-1',
      correlation_id: 'corr-q05',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: { api_key: 'super_secret_key_123', password: 'my_password' },
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, true);
    const outputStr = JSON.stringify(result.output);
    assert.equal(outputStr.includes('super_secret_key_123'), false);
    assert.equal(outputStr.includes('my_password'), false);
  });

  it('VULNERABILITY-Q06: prevents state races between completion and cancellation', async () => {
    const { orchestrator } = createTestOrchestrator();
    const taskId = 'task-q06';
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-1',
      correlation_id: 'corr-q06',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
    };

    const execPromise = orchestrator.executeTask(request);
    await orchestrator.cancelTask(taskId);
    const result = await execPromise;

    const finalStatus = orchestrator.getTaskStatus(taskId);
    assert.ok(finalStatus === 'COMPLETED' || finalStatus === 'CANCELED');
    if (finalStatus === 'CANCELED') {
      assert.equal(result.success, false);
    }
  });

  it('rejects execution when runtime category does not match declared capability ID', async () => {
    const { orchestrator } = createTestOrchestrator();
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: 'task-mismatch',
      step_id: 'step-1',
      correlation_id: 'corr-mismatch',
      leaseHeader,
      capabilityId: 'filesystem.read',
      runtimeCategory: 'terminal', // Mismatch!
      payload: {},
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'RUNTIME_MISMATCH');
  });

  it('rejects invalid timeout values (<=0 or > 300000ms)', async () => {
    const { orchestrator } = createTestOrchestrator();
    const leaseHeader = createValidLeaseHeader();

    const request: TaskExecutionRequest = {
      task_id: 'task-bad-timeout',
      step_id: 'step-1',
      correlation_id: 'corr-bad-timeout',
      leaseHeader,
      capabilityId: 'device.execute',
      runtimeCategory: 'device',
      payload: {},
      timeoutMs: 999999, // Too large
    };

    const result = await orchestrator.executeTask(request);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'INVALID_TIMEOUT');
  });
});
