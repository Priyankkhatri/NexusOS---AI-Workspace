import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';
import { ClipboardRuntimeManager } from '../src/runtimes/clipboard/clipboard-runtime.js';
import {
  type ClipboardReadRequest,
  type ClipboardWriteRequest,
  type IClipboardProvider,
  ClipboardRuntimeError,
} from '../src/runtimes/clipboard/types.js';

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

class AlwaysAllowPolicyEvaluator {
  async evaluate(request: any): Promise<any> {
    return {
      decisionId: crypto.randomUUID(),
      effect: 'ALLOW',
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Always allow in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): any {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Task 03U — ClipboardRuntimeManager Unit Tests', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let redactionFilter: RedactionFilter;
  let provider: MockClipboardProvider;
  let manager: ClipboardRuntimeManager;

  const validLeaseHeader = {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-desktop-01',
    tenant_id: crypto.randomUUID(),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    scopes: ['clipboard:read', 'clipboard:write'],
    policy_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    nonce: '00000000-0000-0000-0000-000000000005',
    signature: 'mock-valid-signature',
  };

  beforeEach(() => {
    leaseBoundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator() as any);
    const registry = new SecretRedactionRegistry();
    redactionFilter = new RedactionFilter(registry);
    provider = new MockClipboardProvider();
    manager = new ClipboardRuntimeManager(leaseBoundary, redactionFilter, provider);
  });

  afterEach(() => {
    manager.shutdown();
  });

  const makeReadReq = (): ClipboardReadRequest => ({
    requestId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    callerId: 'test-caller',
    leaseHeader: validLeaseHeader,
  });

  const makeWriteReq = (text = 'Hello Clipboard'): ClipboardWriteRequest => ({
    requestId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    callerId: 'test-caller',
    leaseHeader: validLeaseHeader,
    contentType: 'text',
    text,
    ttlSeconds: 60,
    isSensitive: true,
  });

  it('CB-01: readClipboard reads content and applies secret redaction', async () => {
    provider.content = 'Here is your token: Bearer secret-token-123';
    const req = makeReadReq();

    const result = await manager.readClipboard(req);
    assert.ok(result.item);
    assert.equal(result.redacted, true);
    assert.ok(result.item.text?.includes('REDACTED'));
    assert.equal(result.item.text?.includes('secret-token-123'), false);
  });

  it('CB-02: readClipboard rejects invalid or expired execution lease', async () => {
    provider.content = 'Some content';
    const req = makeReadReq();
    req.leaseHeader = { ...validLeaseHeader, expires_at: new Date(Date.now() - 10000).toISOString() };

    await assert.rejects(
      async () => {
        await manager.readClipboard(req);
      },
      (err: unknown) => err instanceof ClipboardRuntimeError && err.code === 'READ_DENIED',
    );
  });

  it('CB-03: writeClipboard redacts secrets and schedules auto-clear timer', async () => {
    const req = makeWriteReq('Sensitive token: Bearer my-secret-pass-456');

    const result = await manager.writeClipboard(req);
    assert.equal(result.success, true);
    assert.equal(result.autoClearScheduled, true);
    assert.equal(manager.isAutoClearScheduled(), true);
    assert.ok(provider.content.includes('REDACTED'));
    assert.equal(provider.content.includes('my-secret-pass-456'), false);
  });

  it('CB-04: performAutoClear wipes clipboard if hash matches', async () => {
    const req = makeWriteReq('Auto clear content');
    const result = await manager.writeClipboard(req);

    const cleared = await manager.performAutoClear(result.itemHash);
    assert.equal(cleared, true);
    assert.equal(provider.content, '');
    assert.equal(manager.isAutoClearScheduled(), false);
  });

  it('CB-05: performAutoClear preserves clipboard if user modified content (TOCTOU)', async () => {
    const req = makeWriteReq('Original agent content');
    const result = await manager.writeClipboard(req);

    // User copies new text into clipboard
    provider.content = 'User copied text';

    const cleared = await manager.performAutoClear(result.itemHash);
    assert.equal(cleared, false);
    assert.equal(provider.content, 'User copied text');
  });

  it('CB-06: clearClipboard purges content and cancels timer', async () => {
    const req = makeWriteReq('Test content');
    await manager.writeClipboard(req);

    await manager.clearClipboard();
    assert.equal(provider.content, '');
    assert.equal(manager.isAutoClearScheduled(), false);
  });
});
