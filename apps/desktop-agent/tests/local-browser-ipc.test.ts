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
import { BrowserRuntime } from '../src/runtimes/browser/runtime.js';

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

describe('Task 044 — Local Browser IPC & Host Integration Tests', () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-brw-ipc-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_044',
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
        agentId: 'test-agent-044',
        deviceId: 'dev_test_044',
        pairedTenantId: 'tenant_test_044',
        deviceFingerprint: 'fingerprint-044',
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
      // Ignore stop errors if already stopped
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('verifies Browser Runtime & descriptor registration in RuntimeRegistry', () => {
    assert.ok(agent.browserRuntime);
    assert.ok(agent.browserRuntime instanceof BrowserRuntime);

    const registered = agent.runtimeRegistry.hasRuntime('rt:browser-v1');
    assert.strictEqual(registered, true);

    const descriptor = agent.runtimeRegistry.getRuntime('rt:browser-v1');
    assert.ok(descriptor);
    assert.strictEqual(descriptor.category, 'BROWSER');
    assert.strictEqual(descriptor.isExecutable, true);
  });

  it('verifies 9 Browser capabilities are registered in CapabilityRegistry', () => {
    const expectedCapabilities = [
      { id: 'browser.createSession', dangerous: true, scope: 'browser:write' },
      { id: 'browser.navigate', dangerous: true, scope: 'browser:write' },
      { id: 'browser.extractContent', dangerous: false, scope: 'browser:read' },
      { id: 'browser.interactForm', dangerous: true, scope: 'browser:write' },
      { id: 'browser.captureScreenshot', dangerous: false, scope: 'browser:read' },
      { id: 'browser.downloadFile', dangerous: true, scope: 'browser:write' },
      { id: 'browser.uploadFile', dangerous: true, scope: 'browser:write' },
      { id: 'browser.clearSession', dangerous: true, scope: 'browser:write' },
      { id: 'browser.listSessions', dangerous: false, scope: 'browser:read' },
    ];

    for (const cap of expectedCapabilities) {
      const descriptor = agent.capabilityRegistry.getCapability(cap.id);
      assert.ok(descriptor, `Capability ${cap.id} should be registered`);
      assert.strictEqual(descriptor.category, 'runtime');
      assert.strictEqual(descriptor.isDangerous, cap.dangerous);
      assert.strictEqual(descriptor.requiredScope, cap.scope);
    }
  });

  it('handles browser.createSession and browser.listSessions via IPC', async () => {
    const lease = createValidLease(['browser:write', 'browser:read']);
    const createRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_001',
      workspaceId: 'ws_001',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string; profilePath: string; createdAt: string };

    assert.ok(createRes.sessionId);
    assert.ok(createRes.sessionId.startsWith('sess_'));
    assert.ok(createRes.profilePath);

    const listRes = (await callIPCHandler('browser.listSessions', {
      leaseHeader: lease,
    })) as { sessions: Array<{ sessionId: string }> };

    assert.ok(Array.isArray(listRes.sessions));
    assert.strictEqual(listRes.sessions.length, 1);
    assert.strictEqual(listRes.sessions[0]?.sessionId, createRes.sessionId);
  });

  it('handles browser.navigate and browser.extractContent via IPC', async () => {
    const lease = createValidLease([
      'browser:write',
      'browser:read',
      'brw:navigate',
      'brw:extract',
    ]);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_002',
      workspaceId: 'ws_002',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const navRes = (await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'https://example.com/dashboard',
      allowedDomains: ['example.com'],
      leaseHeader: lease,
    })) as { success: boolean; activeUrl?: string; data?: string };

    assert.strictEqual(navRes.success, true);
    assert.strictEqual(navRes.activeUrl, 'https://example.com/dashboard');

    const extractRes = (await callIPCHandler('browser.extractContent', {
      sessionId: sessionRes.sessionId,
      leaseHeader: lease,
    })) as { success: boolean; data?: string };

    assert.strictEqual(extractRes.success, true);
    assert.ok(extractRes.data?.includes('Structured Content for session'));
  });

  it('handles browser.interactForm via IPC', async () => {
    const lease = createValidLease(['browser:write', 'brw:interact']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_003',
      workspaceId: 'ws_003',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    await callIPCHandler('browser.navigate', {
      sessionId: sessionRes.sessionId,
      url: 'https://example.com/form',
      allowedDomains: ['example.com'],
      leaseHeader: lease,
    });

    const interactRes = (await callIPCHandler('browser.interactForm', {
      sessionId: sessionRes.sessionId,
      selector: '#search-box',
      actionType: 'fill',
      value: 'query',
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(interactRes.success, true);
    assert.strictEqual(interactRes.data, true);
  });

  it('handles browser.captureScreenshot via IPC', async () => {
    const lease = createValidLease(['browser:write', 'browser:read', 'brw:screenshot']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_004',
      workspaceId: 'ws_004',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    const destPath = path.join(tmpDir, 'screenshots', 'page.png');
    const screenshotRes = (await callIPCHandler('browser.captureScreenshot', {
      sessionId: sessionRes.sessionId,
      destinationPath: destPath,
      allowedRoots: [tmpDir],
      leaseHeader: lease,
    })) as { success: boolean; data?: string };

    assert.strictEqual(screenshotRes.success, true);
    assert.ok(fs.existsSync(destPath));
  });

  it('handles browser.downloadFile and browser.uploadFile via IPC', async () => {
    const lease = createValidLease(['browser:write', 'browser:read', 'brw:download', 'brw:upload']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_005',
      workspaceId: 'ws_005',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string };

    // Download
    const downloadDest = path.join(tmpDir, 'downloads', 'sample.pdf');
    const downloadRes = (await callIPCHandler('browser.downloadFile', {
      sessionId: sessionRes.sessionId,
      downloadUrl: 'https://example.com/file.pdf',
      destinationPath: downloadDest,
      allowedDomains: ['example.com'],
      allowedRoots: [tmpDir],
      leaseHeader: lease,
    })) as { success: boolean; data?: string };

    assert.strictEqual(downloadRes.success, true);
    assert.ok(fs.existsSync(downloadDest));

    // Upload
    const uploadSource = path.join(tmpDir, 'upload.txt');
    fs.writeFileSync(uploadSource, 'upload payload content');

    const uploadRes = (await callIPCHandler('browser.uploadFile', {
      sessionId: sessionRes.sessionId,
      selector: '#file-input',
      sourceFilePath: uploadSource,
      allowedRoots: [tmpDir],
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(uploadRes.success, true);
    assert.strictEqual(uploadRes.data, true);
  });

  it('handles browser.clearSession via IPC', async () => {
    const lease = createValidLease(['browser:write', 'browser:read', 'brw:clear_session']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_006',
      workspaceId: 'ws_006',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string; profilePath: string };

    assert.ok(fs.existsSync(sessionRes.profilePath));

    const clearRes = (await callIPCHandler('browser.clearSession', {
      sessionId: sessionRes.sessionId,
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(clearRes.success, true);
    assert.strictEqual(clearRes.data, true);
    assert.strictEqual(fs.existsSync(sessionRes.profilePath), false);
  });

  it('cleans up active sessions on agent stop / shutdown', async () => {
    const lease = createValidLease(['browser:write', 'browser:read']);
    const sessionRes = (await callIPCHandler('browser.createSession', {
      taskId: 'task_shutdown',
      workspaceId: 'ws_shutdown',
      storageDir: tmpDir,
      leaseHeader: lease,
    })) as { sessionId: string; profilePath: string };

    assert.ok(fs.existsSync(sessionRes.profilePath));
    assert.strictEqual(agent.browserRuntime.sessionManager.listSessions().length, 1);

    await agent.stop();

    assert.strictEqual(agent.browserRuntime.sessionManager.listSessions().length, 0);
    assert.strictEqual(fs.existsSync(sessionRes.profilePath), false);
  });
});
