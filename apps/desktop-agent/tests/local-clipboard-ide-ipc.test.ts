import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { ClipboardRuntimeManager } from '../src/runtimes/clipboard/clipboard-runtime.js';
import { IDEIntegrationAdapter } from '../src/adapters/ide/ide-adapter.js';
import { IPCManager } from '../src/ipc/ipc-manager.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';
import {
  type ClipboardReadRequest,
  type ClipboardWriteRequest,
  type IClipboardProvider,
} from '../src/runtimes/clipboard/types.js';
import { type IDEContextSnapshot, type IDEDiffRequest } from '../src/adapters/ide/types.js';

class MockClipboardProvider implements IClipboardProvider {
  public content = '';

  public async readText(): Promise<string> {
    return this.content;
  }

  public async writeText(text: string): Promise<void> {
    this.content = text;
  }

  public async clear(): Promise<void> {
    this.content = '';
  }
}

import {
  type PolicyDecisionRequest,
  type PolicyDecisionResult,
  type PolicyEvaluator,
  type PolicySnapshot,
  PolicyEffect,
} from '@nexusos/policy';

class AlwaysAllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Always allow in test',
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

describe('Task 03U — Clipboard & IDE IPC Integration Tests', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let provider: MockClipboardProvider;
  let clipboardRuntime: ClipboardRuntimeManager;
  let ideAdapter: IDEIntegrationAdapter;
  let ipcManager: IPCManager;
  let tmpDir: string;

  const validLeaseHeader = {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-desktop-01',
    tenant_id: crypto.randomUUID(),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    scopes: ['clipboard:read', 'clipboard:write', 'ide:read', 'ide:write'],
    policy_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    nonce: '00000000-0000-0000-0000-000000000005',
    signature: 'mock-valid-signature',
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-clipboard-ipc-test-'));
    leaseBoundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator() as any);
    const registry = new SecretRedactionRegistry();
    registry.registerSecret('secret-ipc-999', 'fp-secret-ipc-999');
    const redactionFilter = new RedactionFilter(registry);
    provider = new MockClipboardProvider();
    clipboardRuntime = new ClipboardRuntimeManager(leaseBoundary, redactionFilter, provider);
    ideAdapter = new IDEIntegrationAdapter(leaseBoundary);

    ipcManager = new IPCManager({}, leaseBoundary);

    ipcManager.registerMethodHandler('clipboard.read', async (params) => {
      return clipboardRuntime.readClipboard(params as unknown as ClipboardReadRequest);
    });
    ipcManager.registerMethodHandler('clipboard.write', async (params) => {
      return clipboardRuntime.writeClipboard(params as unknown as ClipboardWriteRequest);
    });
    ipcManager.registerMethodHandler('clipboard.clear', async () => {
      await clipboardRuntime.clearClipboard();
      return { success: true };
    });
    ipcManager.registerMethodHandler('ide.getContext', async (params) => {
      return ideAdapter.getContext(params as unknown as any);
    });
    ipcManager.registerMethodHandler('ide.applyDiff', async (params) => {
      return ideAdapter.applyDiff(params as unknown as IDEDiffRequest);
    });
    ipcManager.registerMethodHandler('ide.getDiagnostics', async (params) => {
      const { filePath } = (params || {}) as { filePath?: string };
      return ideAdapter.getDiagnostics(filePath);
    });
  });

  afterEach(async () => {
    clipboardRuntime.shutdown();
    ideAdapter.reset();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('IPC-01: clipboard.write and clipboard.read IPC dispatch through IPCManager', async () => {
    const writeReq: ClipboardWriteRequest = {
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'ipc-caller-1',
      leaseHeader: validLeaseHeader,
      contentType: 'text',
      text: 'IPC text payload with Bearer secret-ipc-999',
      isSensitive: false,
    };

    const handler = (ipcManager as any).methodHandlers.get('clipboard.write');
    assert.ok(handler);

    const writeRes = await handler(writeReq);
    assert.equal(writeRes.success, true);
    assert.ok(provider.content.includes('REDACTED'));

    const readReq: ClipboardReadRequest = {
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'ipc-caller-1',
      leaseHeader: validLeaseHeader,
    };

    const readHandler = (ipcManager as any).methodHandlers.get('clipboard.read');
    const readRes = await readHandler(readReq);
    assert.ok(readRes.item);
    assert.ok(readRes.item.text?.includes('[REDACTED'));
  });

  it('IPC-02: ide.getContext and ide.applyDiff IPC dispatch through IPCManager', async () => {
    const snapshot: IDEContextSnapshot = {
      ideType: 'cursor',
      activeFilePath: path.join(tmpDir, 'app.ts'),
      selectedText: 'console.log("hello")',
      cursorLine: 5,
      cursorColumn: 1,
      workspaceRoot: tmpDir,
      openFilePaths: [path.join(tmpDir, 'app.ts')],
      timestamp: Date.now(),
    };
    ideAdapter.updateContext(snapshot);

    const getContextHandler = (ipcManager as any).methodHandlers.get('ide.getContext');
    const context = await getContextHandler({
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'ipc-caller-2',
      ideType: 'cursor',
    });

    assert.ok(context);
    assert.equal(context.selectedText, 'console.log("hello")');

    const targetFile = path.join(tmpDir, 'app.ts');
    const applyDiffHandler = (ipcManager as any).methodHandlers.get('ide.applyDiff');
    const diffRes = await applyDiffHandler({
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'ipc-caller-2',
      leaseHeader: validLeaseHeader,
      targetFilePath: targetFile,
      diffContent: 'console.log("world");',
      workspaceRoot: tmpDir,
      dryRun: false,
    });

    assert.equal(diffRes.success, true);
    assert.equal(fs.readFileSync(targetFile, 'utf-8'), 'console.log("world");');
  });

  it('IPC-03: clipboard.clear purges clipboard content via IPC handler', async () => {
    provider.content = 'Sensitive clipboard text';
    const clearHandler = (ipcManager as any).methodHandlers.get('clipboard.clear');

    const res = await clearHandler();
    assert.equal(res.success, true);
    assert.equal(provider.content, '');
  });
});
