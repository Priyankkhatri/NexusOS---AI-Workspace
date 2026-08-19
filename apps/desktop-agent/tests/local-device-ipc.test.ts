import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DesktopAgent } from '../src/agent.js';
import { DesktopAgentConfig } from '../src/config/index.js';
import { AgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { Logger } from '@nexusos/backend';
import { DeviceRuntime } from '../src/runtimes/device/runtime.js';
import { DeviceOperationName, DeviceRequestContext } from '../src/runtimes/device/types.js';
import { ExecutionLeaseHeader } from '@nexusos/contracts';

describe('Task 041 — Local Device IPC & Host Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  function createValidLease(scopes: string[], taskId = crypto.randomUUID(), tenantId = 'tenant-041'): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: 'test-device-id-041',
      tenant_id: tenantId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      scopes,
      signature: 'valid-signature-041',
      nonce: crypto.randomUUID(),
      policy_hash: 'stub-policy-hash',
    };
  }

  function createRequestContext(scopes: string[], taskId = crypto.randomUUID(), tenantId = 'tenant-041'): DeviceRequestContext {
    const leaseHeader = createValidLease(scopes, taskId, tenantId);
    return {
      taskId: leaseHeader.task_id,
      workspaceId: crypto.randomUUID(),
      tenantId: leaseHeader.tenant_id,
      subjectId: 'user-041',
      correlationId: crypto.randomUUID(),
      leaseHeader,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-device-ipc-test-'));

    const config: DesktopAgentConfig = {
      agentVersion: '1.0.0',
      deviceId: 'test-device-id-041',
      environment: 'development',
      heartbeatIntervalMs: 60000,
      controlPlaneUrl: 'https://localhost:8443',
      logLevel: 'info',
      stateStoragePath: tmpDir,
      maxConcurrentLeases: 5,
    };

    const identityProvider: AgentIdentityProvider = {
      getIdentity: async () => ({
        agentId: 'test-agent-041',
        deviceId: 'test-device-id-041',
        pairedTenantId: 'tenant-041',
        deviceFingerprint: 'fingerprint-041',
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

  it('1. exposes deviceRuntime as a DeviceRuntime instance on DesktopAgent', () => {
    assert.ok(agent.deviceRuntime instanceof DeviceRuntime);
  });

  it('2. registers rt:device-v1 in RuntimeRegistry with category DEVICE', () => {
    const descriptor = agent.runtimeRegistry.getRuntime('rt:device-v1');
    assert.ok(descriptor);
    assert.equal(descriptor.runtimeId, 'rt:device-v1');
    assert.equal(descriptor.category, 'DEVICE');
    assert.equal(descriptor.isExecutable, true);
    assert.ok(descriptor.supportedActions.includes('queryInfo'));
    assert.ok(descriptor.supportedActions.includes('getPosture'));
    assert.ok(descriptor.supportedActions.includes('executeOperation'));
  });

  it('3. registers device capability descriptors in CapabilityRegistry', () => {
    const caps = agent.capabilityRegistry.listCapabilityIds();
    assert.ok(caps.includes('device.queryInfo'));
    assert.ok(caps.includes('device.getPosture'));
    assert.ok(caps.includes('device.execute'));

    const execCap = agent.capabilityRegistry.getCapability('device.execute');
    assert.equal(execCap?.isDangerous, true);
    assert.equal(execCap?.requiredScope, 'device:write');
  });

  it('4. device.queryInfo — returns sanitized device hardware/software summary', async () => {
    await agent.start();
    const info = await agent.deviceRuntime['capabilitiesAdapter'].queryInfo();
    assert.ok(info.platform);
    assert.ok(info.agentVersion);
    assert.ok(Array.isArray(info.supportedCapabilities));
  });

  it('5. device.getPosture — returns device posture, power source, and OS consent', async () => {
    await agent.start();
    const posture = await agent.deviceRuntime['capabilitiesAdapter'].getPosture();
    assert.ok(posture.platform);
    assert.ok(typeof posture.hasOSConsent === 'boolean');
    assert.ok(typeof posture.uptimeSeconds === 'number');
  });

  it('6. device.execute — executes authorized clipboard write and read operations', async () => {
    await agent.start();

    const writeCtx = createRequestContext(['capability:clipboard:write']);
    const writeRes = await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'IPC Integration Test Payload',
      context: writeCtx,
    });
    assert.equal(writeRes.success, true);

    const readCtx = createRequestContext(['capability:clipboard:read']);
    const readRes = await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: readCtx,
    });
    assert.equal(readRes.success, true);
    const data = readRes.data as { text: string };
    assert.equal(data.text, 'IPC Integration Test Payload');
  });

  it('7. device.execute — rejects request with missing scope in lease header', async () => {
    await agent.start();

    const writeCtx = createRequestContext(['unrelated:scope']);
    const writeRes = await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Should be denied',
      context: writeCtx,
    });

    assert.equal(writeRes.success, false);
    assert.equal(writeRes.error?.code, 'MISSING_REQUIRED_SCOPE');
  });

  it('8. device.execute — rejects request with task context mismatch', async () => {
    await agent.start();

    const leaseHeader = createValidLease(['capability:clipboard:write'], 'task-correct-123');
    const mismatchedContext: DeviceRequestContext = {
      taskId: 'task-WRONG-456',
      workspaceId: crypto.randomUUID(),
      tenantId: leaseHeader.tenant_id,
      subjectId: 'user-041',
      correlationId: crypto.randomUUID(),
      leaseHeader,
    };

    const res = await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Mismatched task payload',
      context: mismatchedContext,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'TASK_CONTEXT_MISMATCH');
  });

  it('9. device.execute — rejects request with tenant context mismatch', async () => {
    await agent.start();

    const leaseHeader = createValidLease(['capability:clipboard:write'], 'task-123', 'tenant-A');
    const mismatchedContext: DeviceRequestContext = {
      taskId: 'task-123',
      workspaceId: crypto.randomUUID(),
      tenantId: 'tenant-WRONG-B',
      subjectId: 'user-041',
      correlationId: crypto.randomUUID(),
      leaseHeader,
    };

    const res = await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Mismatched tenant payload',
      context: mismatchedContext,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'TENANT_CONTEXT_MISMATCH');
  });

  it('10. device operations rejected during STOPPING / STOPPED lifecycle states', async () => {
    await agent.start();
    await agent.stop();

    assert.equal(agent.lifecycle.getState(), 'STOPPED');

    const ctx = createRequestContext(['capability:clipboard:read']);
    const res = await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'LIFECYCLE_STATE_REJECTED');
  });

  it('11. DesktopAgent stop() cleanly calls deviceRuntime.shutdown()', async () => {
    await agent.start();

    // Perform an operation to ensure runtime is active
    const writeCtx = createRequestContext(['capability:clipboard:write']);
    await agent.deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Sensitive temporary data',
      context: writeCtx,
    });

    await agent.stop();

    assert.equal(agent.lifecycle.getState(), 'STOPPED');
    assert.equal(agent.deviceRuntime.getActiveOperationsCount(), 0);
  });
});
