import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DesktopAgent } from '../src/agent.js';
import { loadDesktopAgentConfig } from '../src/config/index.js';
import { DefaultAgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { IPCManager } from '../src/ipc/ipc-manager.js';
import { ConfigLayer, SignedConfigEnvelope } from '../src/config/types.js';

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

describe('Task 03Y — Configuration & State IPC Integration Suite', () => {
  const testDir = path.join(process.cwd(), '.test-config-state-ipc');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('handles config.getActive, config.applyUpdate, and config.rollback IPC endpoints', async () => {
    const config = loadDesktopAgentConfig({});
    const identityProvider = new DefaultAgentIdentityProvider(
      config.deviceId,
      crypto.randomUUID(),
      config.agentVersion,
    );
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

    const activeConfig = agent.configurationManager.getActiveConfiguration();
    assert.equal(activeConfig.layer, ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS);

    // Apply signed release update
    const envelope: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 10,
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'valid_sig',
      payload: {
        resourceBudgets: { processTimeoutMs: 120000 },
      },
    };

    const updateRes = await agent.configurationManager.applyConfigurationUpdate(
      ConfigLayer.SIGNED_RELEASE_CONFIG,
      envelope,
    );
    assert.equal(updateRes.result.success, true);
    assert.equal(updateRes.result.snapshot?.revision, 10);

    // Rollback to LKG
    const rollbackRes = await agent.configurationManager.rollbackToLKG();
    assert.equal(rollbackRes.result.success, true);
  });

  test('handles state.getRecord, state.setRecord, state.deleteRecord, and state.getStatus IPC endpoints', async () => {
    const config = loadDesktopAgentConfig({});
    const identityProvider = new DefaultAgentIdentityProvider(
      config.deviceId,
      crypto.randomUUID(),
      config.agentVersion,
    );
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

    await agent.stateManager.start();

    // Set state
    await agent.stateManager.set('app:preference', { theme: 'dark' });

    // Get state
    const val = await agent.stateManager.get<{ theme: string }>('app:preference');
    assert.deepEqual(val, { theme: 'dark' });

    // Status
    const status = agent.stateManager.getStatus();
    assert.equal(status.initialized, true);
    assert.ok(status.recordCount >= 1);

    // Delete state
    const deleted = await agent.stateManager.delete('app:preference');
    assert.equal(deleted, true);

    await agent.stateManager.stop();
  });
});
