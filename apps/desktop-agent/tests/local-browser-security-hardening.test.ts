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

describe('Task 044 — Adversarial Security Regression Test Suite (044-SEC-01 to 044-SEC-12)', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  function createValidLease(
    scopes: string[] = [
      'browser:read',
      'browser:write',
      'brw:navigate',
      'brw:extract',
      'brw:interact',
      'brw:screenshot',
      'brw:download',
      'brw:upload',
      'brw:clear_session',
    ],
    taskId = crypto.randomUUID(),
    tenantId = crypto.randomUUID(),
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: 'test-agent-sec-id',
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-brw-sec-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_sec_044',
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
        agentId: 'test-agent-sec-044',
        deviceId: 'dev_test_sec_044',
        pairedTenantId: 'tenant_test_sec_044',
        deviceFingerprint: 'fingerprint-sec-044',
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
    try {
      await agent.stop();
    } catch {
      // Ignore stop errors
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('044-SEC-01: Rejects SSRF navigation to localhost', async () => {
    const lease = createValidLease(['browser:write', 'brw:navigate']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_01',
      workspaceId: 'ws_sec_01',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'http://localhost:9000/internal-api',
      allowedDomains: ['localhost'],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(navRes.success, false);
    assert.strictEqual(navRes.error?.code, 'PROHIBITED_DESTINATION');
  });

  it('044-SEC-02: Rejects cloud metadata endpoint (169.254.169.254)', async () => {
    const lease = createValidLease(['browser:write', 'brw:navigate']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_02',
      workspaceId: 'ws_sec_02',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'http://169.254.169.254/latest/meta-data/',
      allowedDomains: ['169.254.169.254'],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(navRes.success, false);
    assert.strictEqual(navRes.error?.code, 'PROHIBITED_DESTINATION');
  });

  it('044-SEC-03: Rejects prohibited file:// URL scheme navigation', async () => {
    const lease = createValidLease(['browser:write', 'brw:navigate']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_03',
      workspaceId: 'ws_sec_03',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'file:///etc/passwd',
      allowedDomains: ['*'],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(navRes.success, false);
    assert.strictEqual(navRes.error?.code, 'PROHIBITED_SCHEME');
  });

  it('044-SEC-04: Rejects navigation to unauthorized domain outside allowlist', async () => {
    const lease = createValidLease(['browser:write', 'brw:navigate']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_04',
      workspaceId: 'ws_sec_04',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'https://evil-unauthorized.com/exfiltrate',
      allowedDomains: ['example.com'],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(navRes.success, false);
    assert.strictEqual(navRes.error?.code, 'UNAUTHORIZED_DOMAIN');
  });

  it('044-SEC-05: Triggers human intervention pause on sensitive form submission', async () => {
    const lease = createValidLease(['browser:write', 'brw:interact']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_05',
      workspaceId: 'ws_sec_05',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const interactRes = (await callIPCHandler('browser.interactForm', {
      sessionId: sessionRes.sessionId,
      selector: 'input#password-field',
      actionType: 'submit',
      value: 'secret123',
      leaseHeader: lease,
    })) as { success: boolean; humanInterventionRequired?: boolean; interventionReason?: string };

    assert.strictEqual(interactRes.success, false);
    assert.strictEqual(interactRes.humanInterventionRequired, true);
    assert.ok(interactRes.interventionReason?.includes('Sensitive form interaction'));
  });

  it('044-SEC-06: Rejects screenshot destination outside allowedRoots', async () => {
    const lease = createValidLease(['browser:write', 'browser:read', 'brw:screenshot']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_06',
      workspaceId: 'ws_sec_06',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const outsidePath = path.resolve(tmpDir, '..', 'unauthorized_dir', 'shot.png');
    const shotRes = (await callIPCHandler('browser.captureScreenshot', {
      sessionId: sessionRes.sessionId,
      destinationPath: outsidePath,
      allowedRoots: [tmpDir],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(shotRes.success, false);
    assert.strictEqual(shotRes.error?.code, 'PATH_OUTSIDE_SCOPE');
  });

  it('044-SEC-07: Rejects file download from unauthorized domain', async () => {
    const lease = createValidLease(['browser:write', 'brw:download']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_07',
      workspaceId: 'ws_sec_07',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const downloadDest = path.join(tmpDir, 'downloads', 'malicious.exe');
    const downloadRes = (await callIPCHandler('browser.downloadFile', {
      sessionId: sessionRes.sessionId,
      downloadUrl: 'https://unauthorized-domain.org/malicious.exe',
      destinationPath: downloadDest,
      allowedDomains: ['trusted.org'],
      allowedRoots: [tmpDir],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(downloadRes.success, false);
    assert.strictEqual(downloadRes.error?.code, 'UNAUTHORIZED_DOMAIN');
  });

  it('044-SEC-08: Rejects file download redirecting to unauthorized domain', async () => {
    const lease = createValidLease(['browser:write', 'brw:download']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_08',
      workspaceId: 'ws_sec_08',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const downloadDest = path.join(tmpDir, 'downloads', 'redirected.zip');
    const downloadRes = (await callIPCHandler('browser.downloadFile', {
      sessionId: sessionRes.sessionId,
      downloadUrl: 'https://trusted.org/file.zip',
      redirectUrl: 'https://unauthorized-redirect-target.com/file.zip',
      destinationPath: downloadDest,
      allowedDomains: ['trusted.org'],
      allowedRoots: [tmpDir],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(downloadRes.success, false);
    assert.strictEqual(downloadRes.error?.code, 'UNAUTHORIZED_REDIRECT');
  });

  it('044-SEC-09: Rejects request with expired or invalid ExecutionLeaseHeader', async () => {
    const expiredLease: ExecutionLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: 'sec_09',
      agent_id: 'test-agent-sec-id',
      tenant_id: 'tenant_sec_09',
      issued_at: new Date(Date.now() - 120000).toISOString(),
      expires_at: new Date(Date.now() - 60000).toISOString(), // Expired 1 min ago
      scopes: ['browser:write'],
      nonce: crypto.randomUUID(),
      signature: 'valid-test-signature',
    };

    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_09',
      workspaceId: 'ws_sec_09',
      storageDir: tmpDir,
      leaseHeader: expiredLease,
    })) as { sessionId: string };

    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'https://example.com',
      allowedDomains: ['example.com'],
      leaseHeader: expiredLease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(navRes.success, false);
    assert.strictEqual(navRes.error?.code, 'LEASE_OR_POLICY_INVALID');
  });

  it('044-SEC-10: Fails closed when browser IPC submitted during STOPPING state', async () => {
    const lease = createValidLease(['browser:write']);
    agent.lifecycle.transitionTo('STOPPING' as any, 'Shutdown initiated');

    await assert.rejects(
      async () => {
        await callIPCHandler('browser.createSession', {
          taskId: 'sec_10',
          workspaceId: 'ws_sec_10',
          storageDir: tmpDir,
          leaseHeader: lease,
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes("agent lifecycle state is 'STOPPING'"));
        return true;
      },
    );
  });

  it('044-SEC-11: Rejects navigation request using a cleared / stale session ID', async () => {
    const lease = createValidLease(['browser:write', 'brw:clear_session', 'brw:navigate']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_11',
      workspaceId: 'ws_sec_11',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    // Clear session
    await callIPCHandler('browser.clearSession', {
      sessionId: sessionRes.sessionId,
      leaseHeader: lease,
    });

    // Attempt navigate on cleared session
    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'https://example.com',
      allowedDomains: ['example.com'],
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(navRes.success, false);
    assert.strictEqual(navRes.error?.code, 'INVALID_SESSION');
  });

  it('044-SEC-12: BrowserRuntime shutdown cleans all active sessions and profile directories', async () => {
    const lease = createValidLease(['browser:write']);

    const s1 = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_12_1',
      workspaceId: 'ws_sec_12_1',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string; profilePath: string };

    const s2 = (await callIPCHandler('browser.createSession', {
      taskId: 'sec_12_2',
      workspaceId: 'ws_sec_12_2',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string; profilePath: string };

    assert.ok(fs.existsSync(s1.profilePath));
    assert.ok(fs.existsSync(s2.profilePath));
    assert.strictEqual(agent.browserRuntime.sessionManager.listSessions().length, 2);

    // Perform shutdown
    agent.browserRuntime.shutdown();

    assert.strictEqual(agent.browserRuntime.sessionManager.listSessions().length, 0);
    assert.strictEqual(fs.existsSync(s1.profilePath), false);
    assert.strictEqual(fs.existsSync(s2.profilePath), false);
  });
});
