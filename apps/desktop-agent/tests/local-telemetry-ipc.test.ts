import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DesktopAgent } from '../src/agent.js';
import { DesktopAgentConfig } from '../src/config/index.js';
import { AgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { Logger } from '@nexusos/backend';
import { TelemetryManager } from '../src/telemetry/telemetry-manager.js';

describe('Task 03Z — Local Telemetry IPC & Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-telemetry-ipc-test-'));

    const config: DesktopAgentConfig = {
      agentVersion: '1.0.0',
      deviceId: 'test-device-id-03z',
      environment: 'development',
      heartbeatIntervalMs: 60000,
      controlPlaneUrl: 'https://localhost:8443',
      logLevel: 'info',
      stateStoragePath: tmpDir,
      maxConcurrentLeases: 5,
    };

    const identityProvider: AgentIdentityProvider = {
      getIdentity: async () => ({
        agentId: 'test-agent-03z',
        deviceId: 'test-device-id-03z',
        pairedTenantId: 'tenant-03z',
        deviceFingerprint: 'fingerprint-03z',
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

    const leaseBoundary = new ExecutionLeaseBoundary();
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
  });

  afterEach(async () => {
    try {
      if (!agent.lifecycle.isStoppingOrStopped()) {
        await agent.stop();
      }
    } catch {
      // Ignore
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('exposes telemetryManager on DesktopAgent instance', () => {
    assert.ok(agent.telemetryManager instanceof TelemetryManager);
  });

  it('tracks metrics and flushes signed batch via telemetryManager', async () => {
    agent.telemetryManager.trackMetric('memory_saturation', 75, { subsystem: 'ipc' });
    agent.telemetryManager.trackTrace('ipc_invocation_start', { method: 'telemetry.trackMetric' });

    const batch = await agent.telemetryManager.flush();
    assert.ok(batch !== null);
    assert.equal(batch.agentId, 'test-device-id-03z');
    assert.equal(batch.items.length, 2);
    assert.ok(agent.telemetryManager.verifyBatchIntegrity(batch));
  });

  it('flushes pending telemetry spooled items gracefully during DesktopAgent.stop()', async () => {
    await agent.start();
    agent.telemetryManager.trackMetric('spool_flush_on_shutdown', 100);

    await agent.stop();
    assert.equal(agent.lifecycle.getState(), 'STOPPED');
  });

  it('exports diagnostic bundle to specified output directory', async () => {
    const exportDir = path.join(tmpDir, 'diagnostics');
    const bundle = await agent.telemetryManager.exportDiagnosticBundle(exportDir);

    assert.ok(bundle.bundleId.length > 0);
    assert.ok(fs.existsSync(exportDir));
    const files = fs.readdirSync(exportDir);
    assert.equal(files.length, 1);
  });
});
