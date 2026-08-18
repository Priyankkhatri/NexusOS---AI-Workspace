import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DesktopAgent } from '../src/agent.js';
import { loadDesktopAgentConfig } from '../src/config/index.js';
import { DefaultAgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { IPCManager } from '../src/ipc/ipc-manager.js';
import type { ExecutionLeaseHeader } from '@nexusos/contracts';

function createDummyLeaseHeader(): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-ipc-vault-01',
    tenant_id: crypto.randomUUID(),
    scopes: ['secret:read', 'secret:write', 'vault:read', 'vault:write', 'update:read', 'update:write'],
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    signature: 'sig-dummy-ipc-vault-01',
  };
}

class MockControlPlaneClient implements ControlPlaneClient {
  async start() {}
  async registerAgent() {
    return { accepted: true, controlPlaneVersion: '1.0.0' };
  }
  async sendHeartbeat() {
    return true;
  }
  async relayEvent() {
    return { success: true };
  }
  getConnectionState() {
    return 'CONNECTED_ACTIVE' as any;
  }
  async disconnect() {}
}

class MockLeaseBoundary extends ExecutionLeaseBoundary {
  override async validateLease(_header: unknown) {
    return { valid: true, lease: _header as any };
  }
}

test('IPC Integration - vault.* and update.* method invocation and agent lifecycle', async () => {
  const config = loadDesktopAgentConfig({});

  const identityProvider = new DefaultAgentIdentityProvider(config.deviceId, crypto.randomUUID(), config.agentVersion);
  const controlPlaneClient = new MockControlPlaneClient();
  const leaseBoundary = new MockLeaseBoundary();
  const stateStore = new InMemoryLocalStateStore();
  const ipcManager = new IPCManager();

  const dummyLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const agent = new DesktopAgent(
    config,
    identityProvider,
    controlPlaneClient,
    leaseBoundary,
    stateStore,
    dummyLogger as any,
    undefined,
    ipcManager,
  );

  const handlers = (ipcManager as any).methodHandlers as Map<string, (params?: any) => Promise<any>>;

  // Seed mock secret for test
  (agent.vaultClient.resolver as any).mockVaultStore.set('vault:sec_ref_ipc_01', {
    secretName: 'IPC_SECRET',
    secretValue: 'ipc_secret_value_123',
  });

  // 1. vault.resolveSecret
  const resolveHandler = handlers.get('vault.resolveSecret')!;
  assert.ok(resolveHandler);
  const resolveRes = await resolveHandler({
    leaseHeader: createDummyLeaseHeader(),
    referenceString: 'vault:sec_ref_ipc_01',
    allowedRoots: ['.'],
  });
  assert.equal(resolveRes.success, true);
  assert.equal(resolveRes.referenceId, 'vault:sec_ref_ipc_01');

  // 2. vault.injectSecret
  const injectHandler = handlers.get('vault.injectSecret')!;
  assert.ok(injectHandler);
  const injectRes = await injectHandler({
    leaseHeader: createDummyLeaseHeader(),
    referenceId: 'vault:sec_ref_ipc_01',
    channel: 'TERMINAL',
    targetId: 'proc-101',
  });
  assert.equal(injectRes.success, true);

  // 3. vault.revokeSecret
  const revokeHandler = handlers.get('vault.revokeSecret')!;
  assert.ok(revokeHandler);
  const revokeRes = await revokeHandler({
    referenceString: 'vault:sec_ref_ipc_01',
  });
  assert.equal(revokeRes.success, true);

  // 4. update.getStatus
  const updateStatusHandler = handlers.get('update.getStatus')!;
  assert.ok(updateStatusHandler);
  const status = await updateStatusHandler({});
  assert.equal(status.state, 'IDLE');
  assert.equal(status.channel, 'stable');

  // 5. update.checkForUpdates
  const checkForUpdatesHandler = handlers.get('update.checkForUpdates')!;
  assert.ok(checkForUpdatesHandler);
  const checkRes = await checkForUpdatesHandler({});
  assert.equal(checkRes, null);

  // Graceful shutdown
  await agent.stop();
});
