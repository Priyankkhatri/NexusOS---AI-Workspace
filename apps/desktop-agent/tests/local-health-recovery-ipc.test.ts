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

test('IPC Integration - health.* and recovery.* method invocation and agent lifecycle', async () => {
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

  const handlers = (ipcManager as any).methodHandlers as Map<
    string,
    (params?: any) => Promise<any>
  >;

  // 1. health.getReport
  const getReportHandler = handlers.get('health.getReport')!;
  assert.ok(getReportHandler);
  const report = await getReportHandler({});
  assert.equal(report.state, 'HEALTHY');
  assert.equal(report.agentVersion, config.agentVersion);

  // 2. health.checkReadiness
  const checkReadinessHandler = handlers.get('health.checkReadiness')!;
  assert.ok(checkReadinessHandler);
  const readiness = await checkReadinessHandler({});
  assert.equal(readiness.ready, true);

  // 3. health.checkLiveness
  const checkLivenessHandler = handlers.get('health.checkLiveness')!;
  assert.ok(checkLivenessHandler);
  const liveness = await checkLivenessHandler({});
  assert.equal(liveness.alive, true);

  // 4. recovery.loadManifest
  const loadManifestHandler = handlers.get('recovery.loadManifest')!;
  assert.ok(loadManifestHandler);
  const manifest = await loadManifestHandler({});
  assert.equal(manifest, null);

  // 5. recovery.execute
  const executeRecoveryHandler = handlers.get('recovery.execute')!;
  assert.ok(executeRecoveryHandler);
  const execResult = await executeRecoveryHandler({});
  assert.equal(execResult.action, 'NO_MANIFEST');

  // Graceful shutdown
  await agent.stop();
});
