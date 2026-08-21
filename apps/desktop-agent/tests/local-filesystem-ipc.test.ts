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
import { FilesystemRuntime } from '../src/runtimes/filesystem/runtime.js';

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

describe('Task 042 — Local Filesystem IPC & Host Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  function createValidLease(
    scopes: string[] = [
      'filesystem:read',
      'filesystem:write',
      'fs:read',
      'fs:write',
      'fs:list',
      'fs:stat',
      'fs:copy',
      'fs:move',
      'fs:delete',
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fs-ipc-test-'));

    const config: DesktopAgentConfig = {
      deviceId: 'dev_test_042',
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
        agentId: 'test-agent-042',
        deviceId: 'dev_test_042',
        pairedTenantId: 'tenant_test_042',
        deviceFingerprint: 'fingerprint-042',
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
    if (agent && !agent.lifecycle.isStoppingOrStopped()) {
      await agent.stop();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. exposes filesystemRuntime as a FilesystemRuntime instance on DesktopAgent', () => {
    assert.ok(agent.filesystemRuntime instanceof FilesystemRuntime);
  });

  it('2. registers rt:filesystem-v1 in RuntimeRegistry with category FILESYSTEM', () => {
    const descriptor = agent.runtimeRegistry.getRuntime('rt:filesystem-v1');
    assert.ok(descriptor);
    assert.equal(descriptor.runtimeId, 'rt:filesystem-v1');
    assert.equal(descriptor.category, 'FILESYSTEM');
    assert.equal(descriptor.isExecutable, true);
    assert.ok(descriptor.supportedActions.includes('fs:read'));
    assert.ok(descriptor.supportedActions.includes('fs:write'));
  });

  it('3. registers filesystem capability descriptors in CapabilityRegistry', () => {
    const caps = agent.capabilityRegistry.listCapabilityIds();
    assert.ok(caps.includes('filesystem.readFile'));
    assert.ok(caps.includes('filesystem.writeFile'));
    assert.ok(caps.includes('filesystem.listDirectory'));
    assert.ok(caps.includes('filesystem.statFile'));
    assert.ok(caps.includes('filesystem.copyFile'));
    assert.ok(caps.includes('filesystem.moveFile'));
    assert.ok(caps.includes('filesystem.deleteFile'));

    const writeCap = agent.capabilityRegistry.getCapability('filesystem.writeFile');
    assert.equal(writeCap?.isDangerous, true);
    assert.equal(writeCap?.requiredScope, 'filesystem:write');
  });

  it('4. filesystem.writeFile writes file contents via IPC', async () => {
    const filePath = path.join(tmpDir, 'test-write.txt');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.writeFile', {
      path: filePath,
      content: 'Hello NexusOS Filesystem IPC!',
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean };

    assert.equal(res.success, true);
    assert.equal(fs.readFileSync(filePath, 'utf-8'), 'Hello NexusOS Filesystem IPC!');
  });

  it('5. filesystem.readFile reads file contents via IPC', async () => {
    const filePath = path.join(tmpDir, 'test-read.txt');
    fs.writeFileSync(filePath, 'Content to read', 'utf-8');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.readFile', {
      path: filePath,
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean; data: string };

    assert.equal(res.success, true);
    assert.equal(res.data, 'Content to read');
  });

  it('6. filesystem.listDirectory returns entries via IPC', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f1.txt'), 'file 1');
    fs.writeFileSync(path.join(tmpDir, 'f2.txt'), 'file 2');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.listDirectory', {
      path: tmpDir,
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean; data: { entries: Array<{ name: string }> } };

    assert.equal(res.success, true);
    assert.equal(res.data.entries.length, 2);
  });

  it('7. filesystem.statFile returns metadata via IPC', async () => {
    const filePath = path.join(tmpDir, 'test-stat.txt');
    fs.writeFileSync(filePath, '1234567890');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.statFile', {
      path: filePath,
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean; data: { size: number; isFile: boolean } };

    assert.equal(res.success, true);
    assert.equal(res.data.isFile, true);
    assert.equal(res.data.size, 10);
  });

  it('8. filesystem.copyFile copies file via IPC', async () => {
    const srcPath = path.join(tmpDir, 'src-copy.txt');
    const destPath = path.join(tmpDir, 'dest-copy.txt');
    fs.writeFileSync(srcPath, 'Copy data');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.copyFile', {
      sourcePath: srcPath,
      destinationPath: destPath,
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean };

    assert.equal(res.success, true);
    assert.equal(fs.readFileSync(destPath, 'utf-8'), 'Copy data');
  });

  it('9. filesystem.moveFile moves file via IPC', async () => {
    const srcPath = path.join(tmpDir, 'src-move.txt');
    const destPath = path.join(tmpDir, 'dest-move.txt');
    fs.writeFileSync(srcPath, 'Move data');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.moveFile', {
      sourcePath: srcPath,
      destinationPath: destPath,
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean };

    assert.equal(res.success, true);
    assert.equal(fs.existsSync(srcPath), false);
    assert.equal(fs.readFileSync(destPath, 'utf-8'), 'Move data');
  });

  it('10. filesystem.deleteFile deletes file via IPC', async () => {
    const filePath = path.join(tmpDir, 'delete-me.txt');
    fs.writeFileSync(filePath, 'Delete me');
    const lease = createValidLease();

    const res = (await callIPCHandler('filesystem.deleteFile', {
      path: filePath,
      permanent: true,
      leaseHeader: lease,
      allowedRoots: [tmpDir],
    })) as { success: boolean };

    assert.equal(res.success, true);
    assert.equal(fs.existsSync(filePath), false);
  });

  it('11. Reject malformed IPC request payload', async () => {
    await assert.rejects(
      async () => {
        await callIPCHandler('filesystem.readFile', {
          // path is missing
          leaseHeader: createValidLease(),
        });
      },
      (err: Error) => {
        return err.name === 'ZodError' || err.message.includes('Path is required');
      },
    );
  });

  it('12. Reject expired execution lease', async () => {
    const expiredLease = createValidLease();
    expiredLease.expires_at = new Date(Date.now() - 60000).toISOString();

    await assert.rejects(
      async () => {
        await callIPCHandler('filesystem.readFile', {
          path: path.join(tmpDir, 'any.txt'),
          leaseHeader: expiredLease,
          allowedRoots: [tmpDir],
        });
      },
      (err: Error) => {
        return err.message.includes('lease validation failed');
      },
    );
  });

  it('13. Reject filesystem operation during STOPPING state', async () => {
    const lease = createValidLease();
    const filePath = path.join(tmpDir, 'any.txt');
    fs.writeFileSync(filePath, 'data');

    // Trigger agent stop
    await agent.stop();

    await assert.rejects(
      async () => {
        await callIPCHandler('filesystem.readFile', {
          path: filePath,
          leaseHeader: lease,
          allowedRoots: [tmpDir],
        });
      },
      (err: Error) => {
        return err.message.includes('agent lifecycle state is');
      },
    );
  });
});
