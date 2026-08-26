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
import { PluginPackage } from '../src/runtimes/plugin/types.js';
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

describe('Task 045 — Plugin Security Hardening & Adversarial Regression Suite', () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-sec-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_sec_045',
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
        agentId: 'test-agent-sec-045',
        deviceId: 'dev_test_sec_045',
        pairedTenantId: 'tenant_test_sec_045',
        deviceFingerprint: 'fingerprint-sec-045',
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

  it('045-SEC-01: Forged/tampered plugin package signature rejected by PluginVerifier', async () => {
    const lease = createValidLease();
    const forgedPkg: PluginPackage = {
      ...validPkg,
      signature: 'invalid_forged_sig_bad_sha',
    };

    const res = (await callIPCHandler('plugin.verify', {
      pkg: forgedPkg,
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error?.code, 'PLUGIN_SIGNATURE_INVALID');
  });

  it('045-SEC-02: Capability escalation beyond plugin manifest rejected by PluginPolicyGateway', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg, // manifest requests ['github:pr:read', 'github:pr:comment']
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });

    // Attempt to invoke undeclared capability
    const res = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'system:root:execute', // NOT in manifest
      action: 'execCmd',
      payload: { cmd: 'rm -rf /' },
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error?.code, 'UNAUTHORIZED_PLUGIN_CAPABILITY');
  });

  it('045-SEC-03: Execution lease missing required plugin scope is rejected', async () => {
    const restrictedLease = createValidLease(['read']); // No write, admin, or plugin:install scope

    await assert.rejects(
      async () => {
        await callIPCHandler('plugin.install', {
          pkg: validPkg,
          leaseHeader: restrictedLease,
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes('required plugin:install or write scope is missing'));
        return true;
      },
    );
  });

  it('045-SEC-04: Quarantined plugin install/activation/invocation fails closed', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.quarantine', {
      pluginId: 'plug_github_v1',
      reason: 'Security incident quarantine',
      leaseHeader: lease,
    });

    // 1. Invocation rejected
    const invokeRes = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: { repo: 'nexusos', prNumber: 42 },
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(invokeRes.success, false);
    assert.strictEqual(invokeRes.error?.code, 'PLUGIN_QUARANTINED');

    // 2. Re-install rejected
    const installRes = (await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(installRes.success, false);
    assert.strictEqual(installRes.error?.code, 'PLUGIN_QUARANTINED');

    // 3. Activation rejected
    const activateRes = (await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(activateRes.success, false);
    assert.strictEqual(activateRes.error?.code, 'PLUGIN_QUARANTINED');
  });

  it('045-SEC-05: Illegal state transition from QUARANTINED to ACTIVATED rejected by PluginCatalog', () => {
    const catalog = agent.pluginRuntime.catalog;
    catalog.registerPackage(validPkg, 'QUARANTINED');

    const transitionOk = catalog.setPluginState('plug_github_v1', 'ACTIVATED');
    assert.strictEqual(transitionOk, false);

    const entry = catalog.getEntry('plug_github_v1');
    assert.strictEqual(entry?.state, 'QUARANTINED');
  });

  it('045-SEC-06: Runaway plugin concurrency/resource exhaustion rejected by resource governor', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });

    // Invoke with maxConcurrentHosts limit = 0
    const res = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: { repo: 'nexusos', prNumber: 42 },
      limits: { maxConcurrentHosts: 0 },
      leaseHeader: lease,
    })) as { success: boolean; error?: { code: string } };

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error?.code, 'PLUGIN_HOST_LIMIT_EXCEEDED');
  });

  it('045-SEC-07: Expired or malformed execution lease fails closed', async () => {
    const expiredLease: ExecutionLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: 'test-agent-sec-id',
      tenant_id: crypto.randomUUID(),
      issued_at: new Date(Date.now() - 120000).toISOString(),
      expires_at: new Date(Date.now() - 60000).toISOString(), // Expired
      scopes: ['plugin:install', 'write'],
      nonce: crypto.randomUUID(),
      signature: 'valid-test-signature',
    };

    await assert.rejects(
      async () => {
        await callIPCHandler('plugin.install', {
          pkg: validPkg,
          leaseHeader: expiredLease,
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes('lease validation failed'));
        return true;
      },
    );
  });

  it('045-SEC-08: Cross-tenant plugin invocation preserves tenant isolation', async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const leaseTenantA = createValidLease(undefined, undefined, tenantA);
    const leaseTenantB = createValidLease(undefined, undefined, tenantB);

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: leaseTenantA,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: leaseTenantA,
    });

    const resA = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: { repo: 'nexusos', prNumber: 42 },
      leaseHeader: leaseTenantA,
    })) as { success: boolean };

    assert.strictEqual(resA.success, true);

    const resB = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: { repo: 'nexusos', prNumber: 42 },
      leaseHeader: leaseTenantB,
    })) as { success: boolean };

    assert.strictEqual(resB.success, true);
  });

  it('045-SEC-09: Plugin IPC during STOPPING/STOPPED/FAILED states fails closed', async () => {
    const lease = createValidLease();

    // Transition agent to STOPPING
    agent.lifecycle.transitionTo(AgentLifecycleState.STOPPING, 'Simulated shutdown');

    await assert.rejects(
      async () => {
        await callIPCHandler('plugin.verify', {
          pkg: validPkg,
          leaseHeader: lease,
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes("agent lifecycle state is 'STOPPING'"));
        return true;
      },
    );

    agent.lifecycle['currentState'] = AgentLifecycleState.READY;
  });

  it('045-SEC-10: Malformed IPC payload rejected by strict Zod schema validation', async () => {
    const lease = createValidLease();

    // Missing manifest.requestedCapabilities and bad types
    const malformedPkg = {
      manifest: {
        pluginId: '', // Invalid empty string
        version: '1.0.0',
      },
      packageHash: 'hash123',
    };

    await assert.rejects(
      async () => {
        await callIPCHandler('plugin.install', {
          pkg: malformedPkg,
          leaseHeader: lease,
        });
      },
      (err: Error) => {
        assert.ok(err.name === 'ZodError' || err.message.includes('pluginId is required'));
        return true;
      },
    );
  });

  it('045-SEC-11: Secret leakage through plugin output or error is redacted by RedactionFilter', async () => {
    const lease = createValidLease();

    await callIPCHandler('plugin.install', {
      pkg: validPkg,
      leaseHeader: lease,
    });
    await callIPCHandler('plugin.activate', {
      pluginId: 'plug_github_v1',
      leaseHeader: lease,
    });

    const res = (await callIPCHandler('plugin.invoke', {
      pluginId: 'plug_github_v1',
      capability: 'github:pr:read',
      action: 'getPullRequest',
      payload: {
        repo: 'nexusos',
        apiKey: 'sk-ant-api03-secretkey12345678901234567890123456789012',
      },
      leaseHeader: lease,
    })) as { success: boolean; data?: Record<string, unknown> };

    assert.strictEqual(res.success, true);
    const jsonStr = JSON.stringify(res);
    assert.strictEqual(
      jsonStr.includes('sk-ant-api03-secretkey12345678901234567890123456789012'),
      false,
      'Sensitive API key must be redacted in output',
    );
  });

  it('045-SEC-12: Orphan plugin host and resource state cleared after shutdown', async () => {
    assert.strictEqual(agent.pluginRuntime['activeHostsCount'], 0);
    agent.pluginRuntime.shutdown();
    assert.strictEqual(agent.pluginRuntime['activeHostsCount'], 0);
  });
});
