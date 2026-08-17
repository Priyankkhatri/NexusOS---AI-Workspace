import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRuntimeManager } from '../src/runtimes/local-ai/model-runtime-manager.js';
import { InferenceRequest } from '../src/runtimes/local-ai/types.js';

describe('Task 03T — ModelRuntimeManager Integration Tests', () => {
  let tmpDir: string;
  let leaseBoundary: never;
  let manager: ModelRuntimeManager;

  const validLeaseHeader = {
    leaseId: 'lease-uuid-1',
    taskId: 'task-uuid-1',
    tenantId: 'tenant-uuid-1',
    deviceId: 'device-uuid-1',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    scopes: ['local_ai:execute'],
    signature: 'valid-sig-1',
    nonce: 'nonce-1',
    policyHash: 'hash-1',
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-model-runtime-test-'));
    leaseBoundary = {
      validateLease: (header: { signature?: string }) => {
        return header && header.signature === 'valid-sig-1';
      },
    } as never;

    manager = new ModelRuntimeManager(leaseBoundary, tmpDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const makeReq = (id = 'req-1'): InferenceRequest => ({
    requestId: id,
    modelId: 'phi-3-mini',
    provider: 'cpu_fallback',
    prompt: 'Execute integration test prompt',
    tenantId: 'tenant-uuid-1',
    deviceId: 'device-uuid-1',
    callerId: 'caller-1',
    correlationId: crypto.randomUUID(),
    leaseHeader: validLeaseHeader,
  });

  it('MRM-01: executeInference streams tokens and completes successfully', async () => {
    const req = makeReq('req-mrm-1');
    const chunks = [];

    for await (const chunk of manager.executeInference(req)) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 0);
    assert.equal(chunks[chunks.length - 1].isFinal, true);
    assert.equal(chunks[chunks.length - 1].finishReason, 'stop');
    assert.equal(manager.getInferenceState(req.requestId), 'Completed');
  });

  it('MRM-02: executeInference fails closed when lease re-validation fails', async () => {
    const req = makeReq('req-mrm-2');
    req.leaseHeader = { ...validLeaseHeader, signature: 'invalid-sig' };

    await assert.rejects(async () => {
      for await (const chunk of manager.executeInference(req)) {
        void chunk;
      }
    }, /Lease re-validation failed/i);

    assert.equal(manager.getInferenceState(req.requestId), 'Denied');
  });

  it('MRM-03: stream cancellation with AbortSignal returns cancel finishReason', async () => {
    const req = makeReq('req-mrm-3');
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const chunks = [];
    for await (const chunk of manager.executeInference(req, controller.signal)) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 0);
    assert.equal(chunks[chunks.length - 1].finishReason, 'cancel');
    assert.equal(manager.getInferenceState(req.requestId), 'Canceled');
  });

  it('MRM-04: shutdown releases state and rejects subsequent requests', async () => {
    const req = makeReq('req-mrm-4');
    await manager.shutdown();

    await assert.rejects(async () => {
      for await (const chunk of manager.executeInference(req)) {
        void chunk;
      }
    }, /ModelRuntimeManager is shutdown/i);
  });
});
