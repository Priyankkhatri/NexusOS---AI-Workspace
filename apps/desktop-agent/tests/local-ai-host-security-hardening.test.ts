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
import { RuntimeCategory } from '../src/registry/runtime-registry.js';
import { PluginExecutionPolicy } from '../src/runtimes/plugin/policy.js';
import { validateLoopbackEndpoint } from '../src/runtimes/local-ai/provider-adapters.js';

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

class StubDenyPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.DENY,
      allowed: false,
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      reason: 'Denied by security policy test',
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

describe('Task 046 — Local AI Host Security Hardening (046-SEC-01 to 046-SEC-12)', () => {
  let agent: DesktopAgent;
  let tmpDir: string;
  let leaseBoundary: ExecutionLeaseBoundary;

  function createValidLease(
    scopes: string[] = ['ai:read', 'ai:write', 'ai:inference', '*'],
    taskId = crypto.randomUUID(),
    tenantId = crypto.randomUUID(),
    expiresAt = new Date(Date.now() + 60000).toISOString(),
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: 'test-agent-sec-046',
      tenant_id: tenantId,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      scopes,
      nonce: crypto.randomUUID(),
      signature: 'valid-test-sec-signature',
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-local-ai-sec-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_sec_046',
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
        agentId: 'test-agent-sec-046',
        deviceId: 'dev_sec_046',
        pairedTenantId: 'tenant_sec_046',
        deviceFingerprint: 'fingerprint-sec-046',
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

    leaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator());
    const stateStore = new InMemoryLocalStateStore();
    const logger = new Logger('error');

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
    try {
      await agent.stop();
    } catch {
      // ignore cleanup errors
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 046-SEC-01: Missing execution lease
  // -------------------------------------------------------------------------
  it('046-SEC-01: Rejects requests missing execution lease header', async () => {
    const invalidReq = {
      requestId: 'req-sec-01',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Hello AI',
      tenantId: crypto.randomUUID(),
      deviceId: 'dev_sec_046',
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      // leaseHeader intentionally missing
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', invalidReq),
      /schema validation failed|leaseHeader/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-02: Invalid / Expired execution lease
  // -------------------------------------------------------------------------
  it('046-SEC-02: Rejects requests with expired or invalid execution lease', async () => {
    const expiredLease = createValidLease(
      ['ai:inference'],
      crypto.randomUUID(),
      crypto.randomUUID(),
      new Date(Date.now() - 10000).toISOString(),
    );

    const req = {
      requestId: 'req-sec-02',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Explain quantum computing',
      tenantId: expiredLease.tenant_id,
      deviceId: expiredLease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: expiredLease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', req),
      /lease validation failed|expired/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-03: Tenant / context mismatch
  // -------------------------------------------------------------------------
  it('046-SEC-03: Rejects requests where payload tenantId differs from leaseHeader.tenant_id', async () => {
    const lease = createValidLease(['ai:inference']);

    const req = {
      requestId: 'req-sec-03',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Hello from different tenant',
      tenantId: crypto.randomUUID(), // Different valid UUID
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', req),
      /tenant_id mismatch/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-04: Unauthorized LOCAL_AI category in policy
  // -------------------------------------------------------------------------
  it('046-SEC-04: Enforces fail-closed category policy authorization', async () => {
    // 1. Verify policy evaluator denial stops localAi IPC
    const denyBoundary = new ExecutionLeaseBoundary(new StubDenyPolicyEvaluator());
    const originalBoundary = agent['leaseBoundary'];
    (agent as any)['leaseBoundary'] = denyBoundary;

    try {
      const lease = createValidLease(['ai:inference']);
      const req = {
        requestId: 'req-sec-04',
        modelId: 'phi-3-mini',
        provider: 'cpu_fallback',
        prompt: 'test',
        tenantId: lease.tenant_id,
        deviceId: lease.agent_id,
        callerId: 'user-001',
        correlationId: crypto.randomUUID(),
        leaseHeader: lease,
      };

      await assert.rejects(
        async () => callIPCHandler('localAi.generate', req),
        /lease validation failed|policy denied/i,
      );
    } finally {
      (agent as any)['leaseBoundary'] = originalBoundary;
    }

    // 2. Verify PluginExecutionPolicy authorizes LOCAL_AI while keeping CAMERA/MICROPHONE fail-closed
    const policy = new PluginExecutionPolicy();
    assert.strictEqual(policy.isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI), true);
    assert.strictEqual(policy.isRuntimeCategoryAuthorized(RuntimeCategory.CAMERA), false);
    assert.strictEqual(policy.isRuntimeCategoryAuthorized(RuntimeCategory.MICROPHONE), false);
  });

  // -------------------------------------------------------------------------
  // 046-SEC-05: Unauthorized capability / scope
  // -------------------------------------------------------------------------
  it('046-SEC-05: Enforces scope verification on localAi operations', async () => {
    // Read-only scope cannot run inference
    const readOnlyLease = createValidLease(['ai:read']);

    const genReq = {
      requestId: 'req-sec-05-a',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Summarize report',
      tenantId: readOnlyLease.tenant_id,
      deviceId: readOnlyLease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: readOnlyLease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', genReq),
      /missing required .*scope/i,
    );

    // Inference scope cannot unload models (requires ai:write, admin, or *)
    const inferenceOnlyLease = createValidLease(['ai:inference']);
    const unloadReq = {
      requestId: 'req-sec-05-b',
      modelId: 'phi-3-mini',
      leaseHeader: inferenceOnlyLease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.unloadModel', unloadReq),
      /missing required .*scope/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-06: Malformed IPC payload
  // -------------------------------------------------------------------------
  it('046-SEC-06: Rejects malformed IPC payloads via strict Zod validation', async () => {
    const lease = createValidLease(['ai:inference']);

    // Missing modelId
    await assert.rejects(
      async () =>
        callIPCHandler('localAi.generate', {
          requestId: 'req-sec-06-a',
          prompt: 'test',
          tenantId: lease.tenant_id,
          deviceId: lease.agent_id,
          callerId: 'user-001',
          correlationId: crypto.randomUUID(),
          leaseHeader: lease,
        }),
      /Required|invalid_type/i,
    );

    // Invalid modelId format (special characters)
    await assert.rejects(
      async () =>
        callIPCHandler('localAi.generate', {
          requestId: 'req-sec-06-b',
          modelId: '../../../etc/passwd',
          prompt: 'test',
          tenantId: lease.tenant_id,
          deviceId: lease.agent_id,
          callerId: 'user-001',
          correlationId: crypto.randomUUID(),
          leaseHeader: lease,
        }),
      /invalid characters|regex|invalid/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-07: Oversized prompt / input (> 128 KB)
  // -------------------------------------------------------------------------
  it('046-SEC-07: Rejects prompt exceeding the 128KB ceiling', async () => {
    const lease = createValidLease(['ai:inference']);
    const oversizedPrompt = 'A'.repeat(128 * 1024 + 1); // 131,073 bytes

    const req = {
      requestId: 'req-sec-07',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: oversizedPrompt,
      tenantId: lease.tenant_id,
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', req),
      /prompt exceeds maximum boundary/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-08: Excessive output / resource request
  // -------------------------------------------------------------------------
  it('046-SEC-08: Rejects excessive output token request exceeding 8192 ceiling', async () => {
    const lease = createValidLease(['ai:inference']);

    const req = {
      requestId: 'req-sec-08',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Generate novel',
      maxOutputTokens: 16384, // Exceeds ceiling 8192
      tenantId: lease.tenant_id,
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', req),
      /Output tokens exceed maximum allowable ceiling/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-09: Non-loopback provider endpoint / SSRF attempt
  // -------------------------------------------------------------------------
  it('046-SEC-09: Provider adapter loopback guard rejects remote/cloud metadata endpoints', () => {
    // Prohibited destinations must throw SecurityError
    assert.throws(() => validateLoopbackEndpoint('http://169.254.169.254:11434'), /loopback/i);
    assert.throws(() => validateLoopbackEndpoint('http://10.0.0.1:8080'), /loopback/i);
    assert.throws(() => validateLoopbackEndpoint('https://api.external.com:443'), /loopback/i);

    // Permitted loopback destinations must pass
    assert.doesNotThrow(() => validateLoopbackEndpoint('http://localhost:11434'));
    assert.doesNotThrow(() => validateLoopbackEndpoint('http://127.0.0.1:11434'));
    assert.doesNotThrow(() => validateLoopbackEndpoint('http://[::1]:11434'));
  });

  // -------------------------------------------------------------------------
  // 046-SEC-10: Sensitive output & error redaction
  // -------------------------------------------------------------------------
  it('046-SEC-10: Redacts sensitive tokens and secrets from generation output and errors', async () => {
    const lease = createValidLease(['ai:inference']);

    // Model returns prompt containing API key
    const sensitiveKey = 'sk-proj-abc1234567890abcdef1234567890';
    const req = {
      requestId: 'req-sec-10',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: `My secret is ${sensitiveKey}`,
      tenantId: lease.tenant_id,
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    const result = (await callIPCHandler('localAi.generate', req)) as any;
    assert.ok(result && Array.isArray(result.chunks));
    const combinedText = result.chunks.map((c: any) => c.text).join('');
    // The raw secret should NOT appear unredacted in the output text
    assert.ok(!combinedText.includes(sensitiveKey), 'Output text must not leak raw api secret');
  });

  // -------------------------------------------------------------------------
  // 046-SEC-11: Lifecycle / shutdown denial
  // -------------------------------------------------------------------------
  it('046-SEC-11: Rejects localAi requests when agent is stopped or shutting down', async () => {
    await agent.stop();

    const lease = createValidLease(['ai:inference']);
    const req = {
      requestId: 'req-sec-11',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Run after stop',
      tenantId: lease.tenant_id,
      deviceId: lease.agent_id,
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    await assert.rejects(
      async () => callIPCHandler('localAi.generate', req),
      /localAi.generate denied: agent lifecycle state is 'STOPPED'|Desktop Agent is not ready/i,
    );
  });

  // -------------------------------------------------------------------------
  // 046-SEC-12: Resource-admission bypass / concurrent inference abuse
  // -------------------------------------------------------------------------
  it('046-SEC-12: ResourceGovernor denies admission when concurrency ceiling is reached', async () => {
    const governor = agent.localAiRuntime.modelRuntimeManager.resourceGovernor;
    governor.reset();

    const hw = {
      cpuArch: 'x64',
      cpuCores: 8,
      totalRamBytes: 64 * 1024 * 1024 * 1024, // 64 GB
      freeRamBytes: 32 * 1024 * 1024 * 1024,
      gpuAdapters: [],
      hasNpu: false,
      thermalState: 'normal' as const,
      sampledAt: Date.now(),
    };

    const req1 = {
      requestId: 'req-cov-1',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback' as const,
      prompt: 'test 1',
      maxTokens: 100,
      temperature: 0.7,
      tenantId: crypto.randomUUID(),
      deviceId: 'dev_sec_046',
      callerId: 'user-001',
      correlationId: crypto.randomUUID(),
    };
    const req2 = { ...req1, requestId: 'req-cov-2' };
    const req3 = { ...req1, requestId: 'req-cov-3' };

    // Simulate 2 active inferences (max concurrent = 2)
    const res1 = await governor.reserve(req1, hw);
    assert.ok(res1.reservationId);

    const res2 = await governor.reserve(req2, hw);
    assert.ok(res2.reservationId);

    // 3rd inference must throw ResourceGovernorError due to concurrency ceiling
    await assert.rejects(
      async () => governor.reserve(req3, hw),
      /maximum concurrent inference limit of 2 reached/i,
    );

    // Releasing one reservation allows admission again
    governor.release(res1.reservationId);
    const res3 = await governor.reserve(req3, hw);
    assert.ok(res3.reservationId);

    // Cleanup
    governor.release(res2.reservationId);
    governor.release(res3.reservationId);
  });
});
