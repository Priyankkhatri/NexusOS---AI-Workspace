import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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
import { RuntimeRegistry } from '../src/registry/runtime-registry.js';
import { PluginExecutionPolicy } from '../src/runtimes/plugin/policy.js';
import { PluginRuntime } from '../src/runtimes/plugin/runtime.js';
import { PluginOperationName, PluginPackage } from '../src/runtimes/plugin/types.js';

class AllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Allowed by test evaluator',
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

describe('Plugin Host Manager — Lifecycle, Invocation, & Security', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let runtime: PluginRuntime;
  let validLease: ExecutionLeaseHeader;
  let validPkg: PluginPackage;

  beforeEach(() => {
    leaseBoundary = new ExecutionLeaseBoundary(new AllowPolicyEvaluator());
    runtime = new PluginRuntime(leaseBoundary);

    validLease = {
      lease_id: '00000000-0000-4000-8000-000000000001',
      task_id: '00000000-0000-4000-8000-000000000002',
      agent_id: 'agent_test_1',
      tenant_id: '00000000-0000-4000-8000-000000000003',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [
        PluginOperationName.VERIFY,
        PluginOperationName.INSTALL,
        PluginOperationName.ACTIVATE,
        PluginOperationName.INVOKE,
        PluginOperationName.SUSPEND,
        PluginOperationName.QUARANTINE,
        'plugin:github:pr:read',
      ],
      signature: 'valid_sig',
    };

    validPkg = {
      manifest: {
        pluginId: 'plug_github_v1',
        version: '1.0.0',
        publisher: 'NexusOS Enterprise',
        name: 'GitHub Connector Plugin',
        description: 'Integrates GitHub PR workflows.',
        requestedCapabilities: ['github:pr:read'],
        outboundDomains: ['api.github.com'],
        trustLevel: 'VERIFIED_PUBLISHER',
      },
      packageHash: 'hash_sha256_12345',
      signature: 'sig_valid_official',
      bundleContent: 'MOCK_CODE',
    };
  });

  it('registers in RuntimeRegistry with PluginExecutionPolicy', () => {
    const registry = new RuntimeRegistry(new PluginExecutionPolicy());
    const descriptor = runtime.getDescriptor();

    registry.registerRuntime(descriptor);
    assert.equal(registry.hasRuntime(descriptor.runtimeId), true);
    assert.equal(descriptor.isExecutable, true);
  });

  it('verifies, installs, and activates a valid signed plugin package', async () => {
    const vRes = await runtime.verifyPluginPackage(validPkg, {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(vRes.result.success, true);
    assert.equal(vRes.event.schema_id, 'nexusos.events.plugin.verify.v1');

    const iRes = await runtime.installPlugin(validPkg, { lease: validLease, allowedRoots: [] });
    assert.equal(iRes.result.success, true);
    assert.equal(iRes.event.schema_id, 'nexusos.events.plugin.install.v1');

    const aRes = await runtime.activatePlugin('plug_github_v1', {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(aRes.result.success, true);
    assert.equal(aRes.event.schema_id, 'nexusos.events.plugin.activate.v1');
  });

  it('invokes a manifest-approved capability in a sandboxed host environment', async () => {
    await runtime.installPlugin(validPkg, { lease: validLease, allowedRoots: [] });
    await runtime.activatePlugin('plug_github_v1', { lease: validLease, allowedRoots: [] });

    const invRes = await runtime.invokePlugin(
      {
        pluginId: 'plug_github_v1',
        capability: 'github:pr:read',
        action: 'listPRs',
        payload: { repo: 'nexusos' },
      },
      { lease: validLease, allowedRoots: [] },
    );

    assert.equal(invRes.result.success, true);
    assert.equal(invRes.event.schema_id, 'nexusos.events.plugin.invocation_completed.v1');
  });

  it('rejects invocation when capability is not declared in manifest', async () => {
    await runtime.installPlugin(validPkg, { lease: validLease, allowedRoots: [] });
    await runtime.activatePlugin('plug_github_v1', { lease: validLease, allowedRoots: [] });

    const invRes = await runtime.invokePlugin(
      {
        pluginId: 'plug_github_v1',
        capability: 'github:repo:delete', // Not in manifest requestedCapabilities
        action: 'deleteRepo',
        payload: {},
      },
      { lease: validLease, allowedRoots: [] },
    );

    assert.equal(invRes.result.success, false);
    assert.equal(invRes.result.error?.code, 'UNAUTHORIZED_PLUGIN_CAPABILITY');
    assert.equal(invRes.event.schema_id, 'nexusos.events.plugin.denied.v1');
  });

  it('rejects invocation when plugin is quarantined', async () => {
    await runtime.installPlugin(validPkg, { lease: validLease, allowedRoots: [] });
    await runtime.activatePlugin('plug_github_v1', { lease: validLease, allowedRoots: [] });

    await runtime.quarantinePlugin('plug_github_v1', 'Signature mismatch', {
      lease: validLease,
      allowedRoots: [],
    });

    const invRes = await runtime.invokePlugin(
      {
        pluginId: 'plug_github_v1',
        capability: 'github:pr:read',
        action: 'listPRs',
        payload: {},
      },
      { lease: validLease, allowedRoots: [] },
    );

    assert.equal(invRes.result.success, false);
    assert.equal(invRes.result.error?.code, 'PLUGIN_QUARANTINED');
  });

  it('fails closed when lease scope missing required plugin capability', async () => {
    await runtime.installPlugin(validPkg, { lease: validLease, allowedRoots: [] });
    await runtime.activatePlugin('plug_github_v1', { lease: validLease, allowedRoots: [] });

    const restrictedLease: ExecutionLeaseHeader = {
      ...validLease,
      scopes: ['fs:read'], // missing plugin capability scope
    };

    const invRes = await runtime.invokePlugin(
      {
        pluginId: 'plug_github_v1',
        capability: 'github:pr:read',
        action: 'listPRs',
        payload: {},
      },
      { lease: restrictedLease, allowedRoots: [] },
    );

    assert.equal(invRes.result.success, false);
    assert.equal(invRes.result.error?.code, 'MISSING_CAPABILITY_SCOPE');
  });
});
