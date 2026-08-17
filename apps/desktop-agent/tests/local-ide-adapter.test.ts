import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { IDEIntegrationAdapter } from '../src/adapters/ide/ide-adapter.js';
import {
  type PolicyDecisionRequest,
  type PolicyDecisionResult,
  type PolicyEvaluator,
  type PolicySnapshot,
  PolicyEffect,
} from '@nexusos/policy';
import {
  type IDEContextSnapshot,
  type IDEDiffRequest,
  IDEAdapterError,
} from '../src/adapters/ide/types.js';

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

describe('Task 03U — IDEIntegrationAdapter Unit Tests', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let adapter: IDEIntegrationAdapter;
  let tmpDir: string;

  const validLeaseHeader = {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-desktop-01',
    tenant_id: crypto.randomUUID(),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    scopes: ['ide:read', 'ide:write'],
    policy_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    nonce: '00000000-0000-0000-0000-000000000005',
    signature: 'mock-valid-signature',
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ide-test-'));
    leaseBoundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator());
    adapter = new IDEIntegrationAdapter(leaseBoundary);
  });

  afterEach(() => {
    adapter.reset();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('IDE-01: registers and retrieves IDE capability profiles', () => {
    adapter.registerIDE({
      ideType: 'cursor',
      name: 'Cursor IDE Adapter',
      version: '0.1.0',
      supportedActions: ['ide.getContext', 'ide.applyDiff'],
      workspaceRoots: [tmpDir],
    });

    const cap = adapter.getCapabilities('cursor');
    assert.ok(cap);
    assert.equal(cap.name, 'Cursor IDE Adapter');

    const unregistered = adapter.unregisterIDE('cursor');
    assert.equal(unregistered, true);
    assert.equal(adapter.getCapabilities('cursor'), undefined);
  });

  it('IDE-02: updates and retrieves IDE context snapshots', () => {
    const snapshot: IDEContextSnapshot = {
      ideType: 'vscode',
      activeFilePath: path.join(tmpDir, 'src', 'index.ts'),
      selectedText: 'const x = 42;',
      cursorLine: 10,
      cursorColumn: 5,
      workspaceRoot: tmpDir,
      openFilePaths: [path.join(tmpDir, 'src', 'index.ts')],
      timestamp: Date.now(),
    };

    adapter.updateContext(snapshot);

    const retrieved = adapter.getContext({
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'test-caller',
      ideType: 'vscode',
    });

    assert.ok(retrieved);
    assert.equal(retrieved.selectedText, 'const x = 42;');
    assert.equal(retrieved.activeFilePath, path.join(tmpDir, 'src', 'index.ts'));
  });

  it('IDE-03: resolveSafePath prevents path traversal attacks', () => {
    const safePath = adapter.resolveSafePath('src/file.ts', tmpDir);
    assert.equal(safePath, path.resolve(tmpDir, 'src/file.ts'));

    assert.throws(
      () => adapter.resolveSafePath('../../../Windows/System32/cmd.exe', tmpDir),
      (err: unknown) => err instanceof IDEAdapterError && err.code === 'PATH_TRAVERSAL',
    );
  });

  it('IDE-04: applyDiff dryRun simulates diff apply without mutating filesystem', async () => {
    const targetFile = path.join(tmpDir, 'test.ts');
    const req: IDEDiffRequest = {
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'test-caller',
      leaseHeader: validLeaseHeader,
      targetFilePath: targetFile,
      diffContent: 'export const value = 100;',
      workspaceRoot: tmpDir,
      dryRun: true,
    };

    const res = await adapter.applyDiff(req);
    assert.equal(res.success, true);
    assert.equal(res.dryRun, true);
    assert.equal(fs.existsSync(targetFile), false);
  });

  it('IDE-05: applyDiff writes target file and creates backup if file exists', async () => {
    const targetFile = path.join(tmpDir, 'existing.ts');
    fs.writeFileSync(targetFile, 'original content', 'utf-8');

    const req: IDEDiffRequest = {
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'test-caller',
      leaseHeader: validLeaseHeader,
      targetFilePath: targetFile,
      diffContent: 'new content updated',
      workspaceRoot: tmpDir,
      dryRun: false,
    };

    const res = await adapter.applyDiff(req);
    assert.equal(res.success, true);
    assert.equal(res.dryRun, false);
    assert.ok(res.backupPath);
    assert.equal(fs.readFileSync(targetFile, 'utf-8'), 'new content updated');
    assert.equal(fs.readFileSync(res.backupPath, 'utf-8'), 'original content');
  });

  it('IDE-06: applyDiff rejects invalid or expired execution lease', async () => {
    const targetFile = path.join(tmpDir, 'secure.ts');
    const req: IDEDiffRequest = {
      requestId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      callerId: 'test-caller',
      leaseHeader: { ...validLeaseHeader, expires_at: new Date(Date.now() - 10000).toISOString() },
      targetFilePath: targetFile,
      diffContent: 'unauthorized edit',
      workspaceRoot: tmpDir,
      dryRun: false,
    };

    await assert.rejects(
      async () => {
        await adapter.applyDiff(req);
      },
      (err: unknown) => err instanceof IDEAdapterError && err.code === 'UNAUTHORIZED',
    );
  });
});
