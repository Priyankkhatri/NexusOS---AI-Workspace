/**
 * Task 043 — Adversarial Security Regression Suite
 * Cases 043-SEC-01 through 043-SEC-12
 *
 * Each test targets a specific security boundary enforced by TerminalRuntime,
 * the IPC handler layer in DesktopAgent, or ProcessSupervisor.
 *
 * These tests run against the live DesktopAgent composition root to verify
 * that every security control is wired end-to-end.
 */
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

describe('Task 043 — Adversarial Security Hardening Tests (043-SEC-01 to 043-SEC-12)', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  function createValidLease(scopes?: string[]): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: 'test-agent-sec',
      tenant_id: crypto.randomUUID(),
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      scopes: scopes ?? [
        'terminal:read',
        'terminal:write',
        'term:execute',
        'term:kill',
        'term:list_processes',
      ],
      nonce: crypto.randomUUID(),
      signature: 'valid-test-signature',
    };
  }

  async function callIPCHandler(method: string, params: unknown): Promise<unknown> {
    const handler = (agent.ipcManager as any)['methodHandlers'].get(method);
    if (!handler) throw new Error(`Handler '${method}' not found`);
    return handler(params as any, {
      caller: { authenticated: true },
      correlationId: crypto.randomUUID(),
    });
  }

  /**
   * Calls TerminalRuntime.executeCommand directly (bypassing IPC layer)
   * to test runtime-level security boundaries precisely.
   */
  async function callRuntimeExecute(
    cmd: string,
    args: string[],
    cwd: string,
    lease: ExecutionLeaseHeader,
    allowedRoots?: string[],
  ) {
    return agent.terminalRuntime.executeCommand(
      { command: cmd, args, cwd },
      { lease, allowedRoots: allowedRoots ?? [fs.realpathSync(tmpDir)] },
    );
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sec043-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_sec_043',
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
        agentId: 'test-agent-sec-043',
        deviceId: 'dev_sec_043',
        pairedTenantId: 'tenant_sec_043',
        deviceFingerprint: 'fingerprint-sec-043',
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

  it('043-SEC-01: Deny command not in permitted allowlist', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = await callRuntimeExecute('curl', ['https://example.com'], canonicalTmp, lease);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_COMMAND');
    assert.ok(res.result.error?.message?.includes('not in the permitted tool allowlist'));
  });

  it('043-SEC-02: Deny shell: true injection via powershell -Command flag', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = await callRuntimeExecute(
      'powershell',
      ['-Command', 'Write-Output "pwned"'],
      canonicalTmp,
      lease,
    );

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_SHELL_EXECUTION');
    assert.ok(res.result.error?.message?.includes('-Command'));
  });

  it('043-SEC-03: Deny powershell -c shell-string execution shorthand', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = await callRuntimeExecute('powershell', ['-c', 'whoami'], canonicalTmp, lease);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_SHELL_EXECUTION');
  });

  it('043-SEC-04: Deny cmd.exe /c shell-string execution', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = await callRuntimeExecute('cmd', ['/c', 'dir'], canonicalTmp, lease);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_SHELL_EXECUTION');
  });

  it('043-SEC-05: Deny path traversal outside allowedRoots (../..)', async () => {
    const lease = createValidLease();
    const escapedPath = path.join(tmpDir, '..', '..');

    const res = await callRuntimeExecute('node', ['-v'], escapedPath, lease, [
      fs.realpathSync(tmpDir),
    ]);

    assert.equal(res.result.success, false);
    assert.ok(
      res.result.error?.code === 'WORKING_DIRECTORY_OUTSIDE_SCOPE' ||
        res.result.error?.code === 'PATH_TRAVERSAL_DETECTED' ||
        res.result.error?.message?.includes('outside authorized scope'),
    );
  });

  it('043-SEC-06: Deny absolute path escaping to system root (C:\\)', async () => {
    const lease = createValidLease();
    const systemRoot = process.platform === 'win32' ? 'C:\\' : '/';

    const res = await callRuntimeExecute('node', ['-v'], systemRoot, lease, [
      fs.realpathSync(tmpDir),
    ]);

    assert.equal(res.result.success, false);
    assert.ok(
      res.result.error?.code === 'WORKING_DIRECTORY_OUTSIDE_SCOPE' ||
        res.result.error?.code === 'PATH_TRAVERSAL_DETECTED' ||
        res.result.error?.message?.includes('outside authorized scope'),
    );
  });

  it('043-SEC-07: Deny execution with missing capability scope (term:execute absent from lease)', async () => {
    // Lease has terminal:write but NOT term:execute capability scope
    const lease = createValidLease(['terminal:write', 'terminal:read', 'term:kill']);
    const canonicalTmp = fs.realpathSync(tmpDir);

    const res = await callRuntimeExecute('node', ['-v'], canonicalTmp, lease);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'MISSING_CAPABILITY_SCOPE');
    assert.ok(res.result.error?.message?.includes('term:execute'));
  });

  it('043-SEC-08: Deny terminal.executeCommand via IPC handler when write scope is absent', async () => {
    // Lease has only terminal:read — no write scope
    const lease = createValidLease(['terminal:read', 'term:list_processes']);
    const canonicalTmp = fs.realpathSync(tmpDir);

    await assert.rejects(
      () =>
        callIPCHandler('terminal.executeCommand', {
          command: 'node',
          args: ['-v'],
          cwd: canonicalTmp,
          leaseHeader: lease,
          allowedRoots: [canonicalTmp],
        }),
      (err: Error) => err.message.includes('required write scope is missing'),
    );
  });

  it('043-SEC-09: Deny terminal.killProcess via IPC handler when write scope is absent', async () => {
    const lease = createValidLease(['terminal:read', 'term:list_processes']);

    await assert.rejects(
      () =>
        callIPCHandler('terminal.killProcess', {
          processToken: 'proc_nonexistent',
          leaseHeader: lease,
          allowedRoots: [fs.realpathSync(tmpDir)],
        }),
      (err: Error) => err.message.includes('required write scope is missing'),
    );
  });

  it('043-SEC-10: Deny IPC call during STOPPING lifecycle state', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);

    await agent.stop();

    await assert.rejects(
      () =>
        callIPCHandler('terminal.executeCommand', {
          command: 'node',
          args: ['-v'],
          cwd: canonicalTmp,
          leaseHeader: lease,
          allowedRoots: [canonicalTmp],
        }),
      (err: Error) => err.message.includes('agent lifecycle state is'),
    );
  });

  it('043-SEC-11: Deny powershell -EncodedCommand execution (Base64 shell bypass)', async () => {
    const lease = createValidLease();
    const canonicalTmp = fs.realpathSync(tmpDir);
    const encoded = Buffer.from('whoami', 'utf16le').toString('base64');

    const res = await callRuntimeExecute(
      'powershell',
      ['-EncodedCommand', encoded],
      canonicalTmp,
      lease,
    );

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_SHELL_EXECUTION');
    assert.ok(res.result.error?.message?.includes('-EncodedCommand'));
  });

  it('043-SEC-12: Deny sensitive environment key injection (SECRET_TOKEN leak attempt)', async () => {
    // Verify env sanitization by checking ProcessSupervisor.sanitizeEnvironment directly
    const { ProcessSupervisor } = await import('../src/runtimes/terminal/process-supervisor.js');
    const supervisor = new ProcessSupervisor();
    const sensitiveEnv = {
      SECRET_TOKEN: 'super-secret-value',
      NORMAL_VAR: 'allowed-value',
      API_KEY: 'leaked-key',
      password: 'super-password',
    };

    const sanitized = supervisor.sanitizeEnvironment(sensitiveEnv);

    // SECRET_TOKEN, API_KEY, password must be stripped
    assert.equal(sanitized['SECRET_TOKEN'], undefined);
    assert.equal(sanitized['API_KEY'], undefined);
    assert.equal(sanitized['password'], undefined);
    // Normal var should be preserved
    assert.equal(sanitized['NORMAL_VAR'], 'allowed-value');
  });
});
