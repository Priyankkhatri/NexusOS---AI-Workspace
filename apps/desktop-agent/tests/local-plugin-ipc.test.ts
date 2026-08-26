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
import { PluginRuntime } from '../src/runtimes/plugin/runtime.js';
import { PluginPackage } from '../src/runtimes/plugin/types.js';

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

describe('Task 045 — Local Plugin IPC & Host Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  const validPkg: PluginPackage = {
    manifest: {
      pluginId: 'plug_github_v1',
      version: '1.0.0',
      publisher: 'NexusOS Enterprise',
      name: 'GitHub Connector Plugin',
      description: 'Integrates GitHub repositories and PR workflows.',
      requestedCapabilities: ['github:pr:read', 'github:pr:comment'],
      outboundDomains: ['api.github.com'],
      trustLevel: 'VERIFIED_PUBLISHER',
    },
    packageHash: 'hash_sha256_123456789',
    signature: 'sig_valid_nexusos_official',
    bundleContent: 'console.log("Mock plugin bundle code");',
  };

  function createValidLease(
    scopes: string[] = [
      'plugin:verify',
      'plugin:install',
      'plugin:activate',
      'plugin:invoke',
      'plugin:suspend',
      'plugin:quarantine',
      'plugin:read',
      'plugin:write',
      'write',
      'read',
      '*',
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-ipc-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_045',
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
        agentId: 'test-agent-045',
        deviceId: 'dev_test_045',
        pairedTenantId: 'tenant_test_045',
        deviceFingerprint: 'fingerprint-045',
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

    const leaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator());
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

  it('verifies Plugin Runtime & descriptor registration in RuntimeRegistry', () => {
    assert.ok(agent.pluginRuntime);
    assert.ok(agent.pluginRuntime instanceof PluginRuntime);

    const registered = agent.runtimeRegistry.hasRuntime('rt:plugin-v1');
    assert.strictEqual(registered, true);

    const descriptor = agent.runtimeRegistry.getRuntime('rt:plugin-v1');
    assert.ok(descriptor);
    assert.strictEqual(descriptor.category, 'PLUGIN');
    assert.strictEqual(descriptor.isExecutable, true);
  });

  it('verifies 8 Plugin capabilities are registered in CapabilityRegistry', () => {
    const expectedCapabilities = [
      { id: 'plugin.verify', dangerous: false, scope: 'plugin:verify' },
      { id: 'plugin.install', dangerous: true, scope: 'plugin:install' },
      { id: 'plugin.activate', dangerous: true, scope: 'plugin:activate' },
      { id: 'plugin.invoke', dangerous: true, scope: 'plugin:invoke' },
      { id: 'plugin.suspend', dangerous: true, scope: 'plugin:suspend' },
      { id: 'plugin.quarantine', dangerous: true, scope: 'plugin:quarantine' },
      { id: 'plugin.listEntries', dangerous: false, scope: 'plugin:read' },
      { id: 'plugin.listQuarantined', dangerous: false, scope: 'plugin:read' },
    ];

    for (const cap of expectedCapabilities) {
      assert.strictEqual(
        agent.capabilityRegistry.hasCapability(cap.id),
        true,
        `Capability ${cap.id} should be registered`,
      );
      const reg = agent.capabilityRegistry.getCapability(cap.id);
      assert.strictEqual(reg?.isDangerous, cap.dangerous);
      assert.strictEqual(reg?.requiredScope, cap.scope);
      assert.strictEqual(reg?.category, 'runtime');
    }
  });

  it('executes plugin.verify via IPC for valid package', async () => {
    const lease = createValidLease();
    const res = (await callIPCHandler('plugin.verify', {
      pkg: validPkg,
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean; pluginId?: string };

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data, true);
    assert.strictEqual(res.pluginId, 'plug_github_v1');
  });

  it('executes plugin.verify via IPC for invalid package signature', async () => {
    const lease = createValidLease();
    const forgedPkg: PluginPackage = {
      ...validPkg,
      signature: 'invalid_forged_sig',
    };

    const res = (await callIPCHandler('plugin.verify', {
      pkg: forgedPkg,
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error?.code, 'PLUGIN_SIGNATURE_INVALID');
  });

  it('executes plugin.install and plugin.activate via IPC sequentially', async () => {
    const lease = createValidLease();

    const installRes = (await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(installRes.success, true);
    assert.strictEqual(installRes.data, true);

    const activateRes = (await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(activateRes.success, true);
    assert.strictEqual(activateRes.data, true);
  });

  it('executes plugin.invoke via IPC for active plugin and declared capability', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });

    const invokeRes = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: { repo: 'nexusos', prNumber: 42 },
      leaseHeader: lease,
    })) as {
      success: boolean;
      data?: { executedInSandboxHost: boolean; invokedPluginId: string; capability: string };
    };

    assert.strictEqual(invokeRes.success, true);
    assert.strictEqual(invokeRes.data?.executedInSandboxHost, true);
    assert.strictEqual(invokeRes.data?.invokedPluginId, 'plug_github_v1');
    assert.strictEqual(invokeRes.data?.capability, 'github:pr:read');
  });

  it('executes plugin.suspend via IPC', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });

    const suspendRes = (await callIPCHandler('plugin.suspend', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(suspendRes.success, true);
    assert.strictEqual(suspendRes.data, true);
  });

  it('executes plugin.quarantine via IPC and blocks subsequent invocation', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });

    const quarantineRes = (await callIPCHandler('plugin.quarantine', {
      pluginId: 'plug_github_v1',
      reason: 'Crash loop detected in sandbox host',
      leaseHeader: lease,
    })) as { success: boolean; data?: boolean };

    assert.strictEqual(quarantineRes.success, true);
    assert.strictEqual(quarantineRes.data, true);

    const invokeRes = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: { repo: 'nexusos', prNumber: 42 },
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(invokeRes.success, false);
    assert.strictEqual(invokeRes.error?.code, 'PLUGIN_QUARANTINED');
  });

  it('executes plugin.listEntries and plugin.listQuarantined via IPC', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.quarantine', {
      pluginId: 'plug_github_v1',
      reason: 'Malware signature test',
      leaseHeader: lease,
    });

    const entriesRes = (await callIPCHandler('plugin.listEntries', {
      leaseHeader: lease,
    })) as { entries: Array<{ pluginId: string; state: string }> };

    assert.ok(Array.isArray(entriesRes.entries));
    assert.strictEqual(entriesRes.entries.length, 1);
    assert.strictEqual(entriesRes.entries[0].pluginId, 'plug_github_v1');
    assert.strictEqual(entriesRes.entries[0].state, 'QUARANTINED');

    const quarantinedRes = (await callIPCHandler('plugin.listQuarantined', {
      leaseHeader: lease,
    })) as { quarantined: Array<{ pluginId: string; reason: string }> };

    assert.ok(Array.isArray(quarantinedRes.quarantined));
    assert.strictEqual(quarantinedRes.quarantined.length, 1);
    assert.strictEqual(quarantinedRes.quarantined[0].pluginId, 'plug_github_v1');
    assert.strictEqual(quarantinedRes.quarantined[0].reason, 'Malware signature test');
  });

  it('verifies PluginRuntime.shutdown() on DesktopAgent.stop()', async () => {
    assert.doesNotThrow(() => agent.pluginRuntime.shutdown());
    await agent.stop();
  });
});
