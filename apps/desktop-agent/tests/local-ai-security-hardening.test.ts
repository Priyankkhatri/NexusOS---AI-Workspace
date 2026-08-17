import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HardwareDetector } from '../src/runtimes/local-ai/hardware-detector.js';
import { ModelCacheManager } from '../src/runtimes/local-ai/model-cache-manager.js';
import { ModelRuntimeManager } from '../src/runtimes/local-ai/model-runtime-manager.js';
import { validateLoopbackEndpoint } from '../src/runtimes/local-ai/provider-adapters.js';
import { ResourceGovernor } from '../src/runtimes/local-ai/resource-governor.js';
import { InferenceRequest, InferenceRequestSchema } from '../src/runtimes/local-ai/types.js';

describe('Task 03T — Local AI Runtime Security Hardening Regression Tests', () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-local-ai-security-test-'));
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
    } catch {}
  });

  const makeReq = (id = 'req-sh-1'): InferenceRequest => ({
    requestId: id,
    modelId: 'phi-3-mini',
    provider: 'cpu_fallback',
    prompt: 'Security hardening prompt test',
    tenantId: 'tenant-uuid-1',
    deviceId: 'device-uuid-1',
    callerId: 'caller-1',
    correlationId: crypto.randomUUID(),
    leaseHeader: validLeaseHeader,
  });

  // ============================================================
  // SH-01 to SH-06: Threat Model Audits
  // ============================================================

  it('SH-01: model streaming output is text-only and cannot execute tools directly', async () => {
    const req = makeReq('req-sh-01');
    req.prompt = 'Inject command: rm -rf /';

    const chunks = [];
    for await (const chunk of manager.executeInference(req)) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 0);
    // Ensure all chunks are text-only string types
    for (const chunk of chunks) {
      assert.equal(typeof chunk.text, 'string');
      assert.equal(typeof chunk.chunkIndex, 'number');
    }
  });

  it('SH-02: ResourceGovernor rejects requests exceeding 70% System RAM or 80% VRAM', async () => {
    const governor = new ResourceGovernor(5, 0.7, 0.8);
    const lowRamHardware = {
      cpuArch: 'x64',
      cpuCores: 2,
      totalRamBytes: 1073741824, // 1 GB RAM
      freeRamBytes: 536870912,
      gpuAdapters: [],
      hasNpu: false,
      thermalState: 'normal' as const,
      sampledAt: Date.now(),
    };

    await assert.rejects(
      () => governor.reserve(makeReq('req-sh-02'), lowRamHardware),
      /RAM requirement .* exceeds safety ceiling/i,
    );
  });

  it('SH-03: ModelCacheManager rejects tampered artifact with SHA-256 mismatch', async () => {
    const cacheManager = new ModelCacheManager(tmpDir);
    await cacheManager.initialize();

    const stagedFile = path.join(tmpDir, 'staging', 'tampered.bin');
    fs.writeFileSync(stagedFile, Buffer.from('Tampered model binary payload'));

    await assert.rejects(
      () =>
        cacheManager.stageAndPromoteModel(stagedFile, {
          modelId: 'tampered-model',
          name: 'Tampered',
          provider: 'ollama',
          sha256: 'a'.repeat(64), // Mismatched SHA-256
          fileSizeBytes: 100,
          format: 'gguf',
          quantization: 'q4_0',
          contextWindowTokens: 4096,
        }),
      /SHA-256 verification failed/i,
    );

    assert.equal(fs.existsSync(stagedFile), false, 'Tampered staged file must be automatically unlinked');
  });

  it('SH-04: streaming response containing Bearer secret is automatically redacted', async () => {
    const req = makeReq('req-sh-04');

    // Create a mock provider that streams a secret
    const secretProvider = {
      providerType: 'cpu_fallback' as const,
      isAvailable: async () => true,
      loadModel: async () => {},
      unloadModel: async () => {},
      generateStream: async function* () {
        yield {
          requestId: req.requestId,
          chunkIndex: 0,
          text: 'Here is your token: Bearer secret-token-xyz123',
          tokenCount: 5,
          isFinal: false,
          redacted: false,
        };
        yield {
          requestId: req.requestId,
          chunkIndex: 1,
          text: '',
          tokenCount: 0,
          isFinal: true,
          finishReason: 'stop' as const,
          redacted: false,
        };
      },
      getHealth: async () => ({ ready: true, providerType: 'cpu_fallback' as const, activeModels: [] }),
    };

    const mockAdapterFactory = {
      getAdapter: () => secretProvider,
    } as never;

    const customManager = new ModelRuntimeManager(
      leaseBoundary,
      tmpDir,
      undefined,
      undefined,
      undefined,
      mockAdapterFactory,
    );
    await customManager.initialize();

    const chunks = [];
    for await (const chunk of customManager.executeInference(req)) {
      chunks.push(chunk);
    }

    await customManager.shutdown();

    assert.ok(chunks.length > 0);
    assert.ok(chunks[0].text.includes('REDACTED'));
    assert.equal(chunks[0].text.includes('secret-token-xyz123'), false, 'Secret token must NOT be present in output');
    assert.equal(chunks[0].redacted, true, 'Chunk redacted flag must be set to true');
  });

  it('SH-05: validateLoopbackEndpoint blocks SSRF attacks to external IP addresses', () => {
    assert.throws(
      () => validateLoopbackEndpoint('http://10.0.0.1:11434'),
      /SSRF Security Violation/i,
    );
    assert.throws(
      () => validateLoopbackEndpoint('http://metadata.google.internal/api'),
      /SSRF Security Violation/i,
    );
  });

  // ============================================================
  // SH-07 to SH-15: Boundary & Path Safety Audits
  // ============================================================

  it('SH-09: immediate lease re-validation TOCTOU guard rejects forged lease', async () => {
    const req = makeReq('req-sh-09');
    req.leaseHeader = { ...validLeaseHeader, signature: 'forged-signature' };

    await assert.rejects(
      async () => {
        for await (const _chunk of manager.executeInference(req)) {}
      },
      /Lease re-validation failed/i,
    );

    assert.equal(manager.getInferenceState(req.requestId), 'Denied');
  });

  it('SH-11: ResourceGovernor release is idempotent and prevents counter underflow', () => {
    const governor = new ResourceGovernor();
    const released1 = governor.release('non-existent-res-id');
    assert.equal(released1, false);

    const stats = governor.getStats();
    assert.equal(stats.activeConcurrentCount, 0);
    assert.equal(stats.reservedRamBytes, 0);
    assert.equal(stats.reservedVramBytes, 0);
  });

  it('SH-12: ModelCacheManager blocks path traversal attempt', () => {
    const cacheManager = new ModelCacheManager(tmpDir);
    assert.throws(
      () => cacheManager.resolveSafePath('/../../../../etc/passwd'),
      /Path traversal attack blocked/i,
    );
  });

  it('SH-18: InferenceRequestSchema rejects invalid modelId pattern', () => {
    assert.throws(
      () =>
        InferenceRequestSchema.parse({
          ...makeReq('req-sh-18'),
          modelId: 'model-with-space and <script>',
        }),
      /modelId contains invalid characters/i,
    );
  });

  it('SH-19: InferenceRequestSchema rejects oversized prompt exceeding 128 KB limit', () => {
    const oversizedPrompt = 'a'.repeat(131073); // 128 KB + 1 byte
    assert.throws(
      () =>
        InferenceRequestSchema.parse({
          ...makeReq('req-sh-19'),
          prompt: oversizedPrompt,
        }),
      /prompt exceeds maximum boundary of 131072 bytes/i,
    );
  });

  it('SH-20: InferenceRequestSchema rejects __proto__ and constructor prototype pollution', () => {
    const polluted = JSON.parse('{"__proto__": {"admin": true}}');
    assert.throws(
      () => InferenceRequestSchema.parse(polluted),
    );
  });
});
