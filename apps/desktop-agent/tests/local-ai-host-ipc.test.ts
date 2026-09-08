import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ExecutionLeaseHeader } from '@nexusos/contracts';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { DesktopAgent } from '../src/agent.js';
import { DesktopAgentConfig } from '../src/config/index.js';
import { AgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { Logger } from '@nexusos/backend';
import { LocalAiRuntime } from '../src/runtimes/local-ai/runtime.js';
import { RuntimeCategory } from '../src/registry/runtime-registry.js';
import { AgentLifecycleState } from '../src/lifecycle/index.js';

class StubAllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      reason: 'Allowed in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Task 046 — Local AI Host IPC & Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  function createValidLease(
    scopes: string[] = ['ai:read', 'ai:write', 'ai:inference', '*'],
    taskId = crypto.randomUUID(),
    tenantId = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 60000).toISOString(),
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: 'test-agent-046',
      tenant_id: tenantId,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      scopes,
      nonce: crypto.randomUUID(),
      signature: 'valid-test-signature',
    };
  }

  async function callIPCHandler(method: string, params: unknown): Promise<unknown> {
    const handler = agent.ipcManager!['methodHandlers'].get(method);
    if (!handler) {
      throw new Error(`Handler '${method}' not found`);
    }
    return handler(params as any, {
      caller: { authenticated: true },
      correlationId: crypto.randomUUID(),
    });
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-local-ai-ipc-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_046',
      agentVersion: '1.0.0',
      environment: 'development',
      heartbeatIntervalMs: 60000,
      controlPlaneUrl: 'https://localhost:8443',
      logLevel: 'info',
      stateStoragePath: tmpDir,
      maxConcurrentLeases: 5,
    };

    const identityProvider: AgentIdentityProvider = {
      getIdentity: async () => ({
        agentId: 'test-agent-046',
        deviceId: 'dev_test_046',
        pairedTenantId: 'tenant_test_046',
        deviceFingerprint: 'fingerprint-046',
        agentVersion: '1.0.0',
        enrolledAt: new Date().toISOString(),
      }),
      verifyHardwareAttestation: async () =>
        ({ valid: true, status: 'PASSED', reason: 'OK' }) as any,
    };

    const controlPlaneClient: ControlPlaneClient = {
      start: async () => {},
      registerAgent: async () => ({ accepted: true, controlPlaneVersion: '1.0.0' }),
      sendHeartbeat: async () => ({ acknowledged: true }),
      reportHealth: async () => {},
      reportStateTransition: async () => {},
      fetchTaskSchedule: async () => ({ tasks: [] }),
      reportTaskExecutionProgress: async () => {},
      acknowledgeCancellation: async () => {},
      publishTelemetryEvent: async () => {},
      stop: async () => {},
      disconnect: async () => {},
    } as any;

    const leaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator());
    const stateStore = new InMemoryLocalStateStore();
    const logger = new Logger('info');

    agent = new DesktopAgent(
      config,
      identityProvider,
      controlPlaneClient,
      leaseBoundary,
      stateStore,
      logger,
    );

    await agent.start();
  });

  afterEach(async () => {
    if (agent && !agent.lifecycle.isStoppingOrStopped()) {
      await agent.stop();
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: DesktopAgent Composition Root Wiring
  // -------------------------------------------------------------------------
  it('1. DesktopAgent exposes localAiRuntime and modelRuntimeManager instances', () => {
    assert.ok(agent.localAiRuntime instanceof LocalAiRuntime);
    assert.ok(agent.modelRuntimeManager);
    assert.equal(agent.localAiRuntime.modelRuntimeManager, agent.modelRuntimeManager);
  });

  // -------------------------------------------------------------------------
  // Test 2: RuntimeRegistry Registration
  // -------------------------------------------------------------------------
  it('2. rt:local-ai-v1 is registered in RuntimeRegistry under category LOCAL_AI', () => {
    const descriptor = agent.runtimeRegistry.getRuntime('rt:local-ai-v1');
    assert.ok(descriptor, 'rt:local-ai-v1 must be registered in RuntimeRegistry');
    assert.equal(descriptor?.category, RuntimeCategory.LOCAL_AI);
    assert.equal(descriptor?.isExecutable, true);
    assert.ok(descriptor?.supportedActions.includes('generate'));
    assert.ok(descriptor?.supportedActions.includes('list_models'));
    assert.ok(descriptor?.supportedActions.includes('get_hardware_profile'));
    assert.ok(descriptor?.supportedActions.includes('unload_model'));
  });

  // -------------------------------------------------------------------------
  // Test 3: CapabilityRegistry Registration
  // -------------------------------------------------------------------------
  it('3. All 4 Local AI capabilities are registered in CapabilityRegistry', () => {
    const expectedCaps = [
      { id: 'localAi.generate', dangerous: true, scope: 'ai:inference' },
      { id: 'localAi.listModels', dangerous: false, scope: 'ai:read' },
      { id: 'localAi.getHardwareProfile', dangerous: false, scope: 'ai:read' },
      { id: 'localAi.unloadModel', dangerous: true, scope: 'ai:write' },
    ];

    for (const expected of expectedCaps) {
      assert.ok(
        agent.capabilityRegistry.hasCapability(expected.id),
        `Capability ${expected.id} must be registered`,
      );
      const cap = agent.capabilityRegistry.getCapability(expected.id);
      assert.equal(cap?.isDangerous, expected.dangerous);
      assert.equal(cap?.requiredScope, expected.scope);
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: localAi.listModels via IPC
  // -------------------------------------------------------------------------
  it('4. localAi.listModels returns model catalog array via IPC', async () => {
    const lease = createValidLease(['ai:read']);
    const res = (await callIPCHandler('localAi.listModels', {
      leaseHeader: lease,
    })) as { models: unknown[] };

    assert.ok(res, 'Response must be returned');
    assert.ok(Array.isArray(res.models), 'models must be an array');
  });

  // -------------------------------------------------------------------------
  // Test 5: localAi.getHardwareProfile via IPC
  // -------------------------------------------------------------------------
  it('5. localAi.getHardwareProfile returns hardware profile via IPC', async () => {
    const lease = createValidLease(['ai:read']);
    const res = (await callIPCHandler('localAi.getHardwareProfile', {
      leaseHeader: lease,
    })) as { cpuArch: string; cpuCores: number; totalRamBytes: number; gpuAdapters: unknown[] };

    assert.ok(res, 'Response must be returned');
    assert.ok(typeof res.cpuArch === 'string');
    assert.ok(typeof res.cpuCores === 'number');
    assert.ok(typeof res.totalRamBytes === 'number');
    assert.ok(Array.isArray(res.gpuAdapters));
  });

  // -------------------------------------------------------------------------
  // Test 6: localAi.generate via IPC
  // -------------------------------------------------------------------------
  it('6. localAi.generate returns streamed inference chunks via IPC', async () => {
    const lease = createValidLease(['ai:inference']);
    const req = {
      requestId: 'req-test-gen-1',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Summarize the architecture invariants of NexusOS.',
      tenantId: lease.tenant_id,
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    const res = (await callIPCHandler('localAi.generate', req)) as {
      chunks: Array<{ text: string; isFinal: boolean }>;
    };

    assert.ok(res, 'Response must be returned');
    assert.ok(Array.isArray(res.chunks), 'chunks must be an array');
    assert.ok(res.chunks.length > 0, 'chunks must not be empty');
    assert.ok(
      res.chunks.some((c) => c.isFinal),
      'At least one chunk must be final',
    );
  });

  // -------------------------------------------------------------------------
  // Test 7: localAi.unloadModel via IPC
  // -------------------------------------------------------------------------
  it('7. localAi.unloadModel unloads active model via IPC', async () => {
    const lease = createValidLease(['ai:write']);
    const res = (await callIPCHandler('localAi.unloadModel', {
      modelId: 'phi-3-mini',
      leaseHeader: lease,
    })) as { success: boolean; modelId: string };

    assert.ok(res, 'Response must be returned');
    assert.equal(res.success, true);
    assert.equal(res.modelId, 'phi-3-mini');
  });

  // -------------------------------------------------------------------------
  // Test 8: Rejection of Malformed Payload via Zod
  // -------------------------------------------------------------------------
  it('8. Rejects malformed IPC request payload at schema layer', async () => {
    const lease = createValidLease(['ai:inference']);
    // Missing required 'prompt'
    const malformedReq = {
      requestId: 'req-malformed-1',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      tenantId: lease.tenant_id,
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', malformedReq),
      (err: Error) => {
        return err.name === 'ZodError' || /prompt/i.test(err.message);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Test 9: Rejection of Expired Execution Lease
  // -------------------------------------------------------------------------
  it('9. Rejects expired execution lease header', async () => {
    const expiredLease = createValidLease(
      ['ai:inference'],
      crypto.randomUUID(),
      crypto.randomUUID(),
      new Date(Date.now() - 60000).toISOString(), // Expired 1 minute ago
    );

    const req = {
      requestId: 'req-expired-1',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'This should be rejected due to expired lease',
      tenantId: expiredLease.tenant_id,
      deviceId: expiredLease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: expiredLease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', req),
      /lease validation failed/i,
    );
  });

  // -------------------------------------------------------------------------
  // Test 10: Graceful Shutdown Lifecycle Cleanup
  // -------------------------------------------------------------------------
  it('10. DesktopAgent.stop() triggers graceful runtime shutdown', async () => {
    assert.equal(agent.lifecycle.getState(), AgentLifecycleState.READY);

    await agent.stop();

    assert.ok(
      agent.lifecycle.getState() === AgentLifecycleState.STOPPED ||
        agent.lifecycle.getState() === AgentLifecycleState.STOPPING,
    );

    // After shutdown, ResourceGovernor stats should be zeroed
    const stats = agent.localAiRuntime.modelRuntimeManager.resourceGovernor.getStats();
    assert.equal(stats.activeConcurrentCount, 0);
    assert.equal(stats.reservedRamBytes, 0);
    assert.equal(stats.reservedVramBytes, 0);
  });
});
