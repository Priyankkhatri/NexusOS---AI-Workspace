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
import { TerminalRuntime } from '../src/runtimes/terminal/runtime.js';

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

describe('Task 043 — Local Terminal IPC & Host Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  function createValidLease(
    scopes: string[] = [
      'terminal:read',
      'terminal:write',
      'term:execute',
      'term:kill',
      'term:list_processes',
    ],
    taskId = crypto.randomUUID(),
    tenantId = crypto.randomUUID(),
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: 'test-agent-id',
      tenant_id: tenantId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-term-ipc-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_043',
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
        agentId: 'test-agent-043',
        deviceId: 'dev_test_043',
        pairedTenantId: 'tenant_test_043',
        deviceFingerprint: 'fingerprint-043',
        agentVersion: '1.0.0',
        enrolledAt: new Date().toISOString(),
      }),
      verifyHardwareAttestation: async () =>
        ({ valid: true, status: 'PASSED', reason: 'OK' }) as any,
    };

    const controlPlaneClient: ControlPlaneClient = {
      start: async () => {},
      registerAgent: async () => ({ accepted: true, controlPlaneVersion: '1.0.0' }),
      sendHeartbeat: async () => true,
      relayEvent: async () => ({ success: true }) as any,
      getConnectionState: () => 'CONNECTED' as any,
      disconnect: async () => {},
    };

    const leaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator() as any);
    const stateStore = new InMemoryLocalStateStore();
    const baseLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    } as unknown as Logger;

    agent = new DesktopAgent(
      config,
      identityProvider,
      controlPlaneClient,
      leaseBoundary,
      stateStore,
      baseLogger,
    );

    await agent.start();
  });

  afterEach(async () => {
    if (agent && !agent.lifecycle.isStoppingOrStopped()) {
      await agent.stop();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. exposes terminalRuntime as a TerminalRuntime instance on DesktopAgent', () => {
    assert.ok(agent.terminalRuntime instanceof TerminalRuntime);
  });

  it('2. registers rt:terminal-v1 in RuntimeRegistry with category TERMINAL', () => {
    const descriptor = agent.runtimeRegistry.getRuntime('rt:terminal-v1');
    assert.ok(descriptor);
    assert.equal(descriptor.runtimeId, 'rt:terminal-v1');
    assert.equal(descriptor.category, 'TERMINAL');
    assert.equal(descriptor.isExecutable, true);
    assert.ok(descriptor.supportedActions.includes('term:execute'));
    assert.ok(descriptor.supportedActions.includes('term:kill'));
    assert.ok(descriptor.supportedActions.includes('term:list_processes'));
  });

  it('3. registers terminal capability descriptors in CapabilityRegistry', () => {
    const caps = agent.capabilityRegistry.listCapabilityIds();
    assert.ok(caps.includes('terminal.executeCommand'));
    assert.ok(caps.includes('terminal.killProcess'));
    assert.ok(caps.includes('terminal.listProcesses'));

    const execCap = agent.capabilityRegistry.getCapability('terminal.executeCommand');
    assert.equal(execCap?.isDangerous, true);
    assert.equal(execCap?.requiredScope, 'terminal:write');
  });

  it('4. terminal.executeCommand executes permitted tool binary via IPC', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = (await callIPCHandler('terminal.executeCommand', {
      command: 'node',
      args: ['-v'],
      cwd: canonicalTmp,
      leaseHeader: lease,
      allowedRoots: [canonicalTmp],
    })) as { success: boolean; stdout: string };

    assert.equal(res.success, true);
    assert.ok(res.stdout.startsWith('v'));
  });

  it('5. terminal.listProcesses returns active processes via IPC', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = (await callIPCHandler('terminal.listProcesses', {
      leaseHeader: lease,
      allowedRoots: [canonicalTmp],
    })) as { success: boolean; data?: unknown[] };

    assert.equal(res.success, true);
  });

  it('6. terminal.killProcess responds correctly via IPC', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = (await callIPCHandler('terminal.killProcess', {
      processToken: 'proc_nonexistent',
      leaseHeader: lease,
      allowedRoots: [canonicalTmp],
    })) as { success: boolean };

    // Returns res.result from TerminalRuntime (killProcess returns success: false for unknown token)
    assert.equal(typeof res.success, 'boolean');
  });

  it('7. Reject malformed IPC request payload (missing required command or cwd)', async () => {
    await assert.rejects(
      async () => {
        await callIPCHandler('terminal.executeCommand', {
          command: 'node',
          // missing cwd
          leaseHeader: createValidLease(),
        });
      },
      (err: Error) => err.name === 'ZodError' || err.message.includes('cwd is required'),
    );
  });

  it('8. Reject expired execution lease', async () => {
    const expiredLease = createValidLease();
    expiredLease.expires_at = new Date(Date.now() - 60000).toISOString();
    const canonicalTmp = fs.realpathSync(tmpDir);

    await assert.rejects(
      async () => {
        await callIPCHandler('terminal.executeCommand', {
          command: 'node',
          args: ['-v'],
          cwd: canonicalTmp,
          leaseHeader: expiredLease,
          allowedRoots: [canonicalTmp],
        });
      },
      (err: Error) => err.message.includes('lease validation failed'),
    );
  });

  it('9. Reject terminal operation during STOPPING state', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    await agent.stop();

    await assert.rejects(
      async () => {
        await callIPCHandler('terminal.executeCommand', {
          command: 'node',
          args: ['-v'],
          cwd: canonicalTmp,
          leaseHeader: lease,
          allowedRoots: [canonicalTmp],
        });
      },
      (err: Error) => err.message.includes('agent lifecycle state is'),
    );
  });
});
