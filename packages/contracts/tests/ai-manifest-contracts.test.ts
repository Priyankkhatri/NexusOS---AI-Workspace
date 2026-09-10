import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ModelArtifactSourceTypeSchema,
  ModelArtifactSourceSchema,
  ModelIdSchema,
  ModelManifestSchema,
  ModelDownloadRequestSchema,
  ModelDownloadProgressSchema,
  InferenceBenchmarkResultSchema,
  QuantizationTypeSchema,
} from '../src/ai/index.js';

describe('Task 065 Phase 1: Canonical Local-AI Model Manifest Contracts Audit', () => {
  const validSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const validGgufManifest = {
    modelId: 'meta-llama/Llama-3.2-1B-Instruct',
    name: 'Llama 3.2 1B Instruct',
    version: '1.0.0',
    format: 'gguf',
    quantization: 'Q4_K_M',
    parameterSize: '1.24B',
    contextLength: 131072,
    byteSize: 800000000,
    sha256: validSha256,
    source: {
      sourceType: 'HUGGING_FACE',
      url: 'https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct-GGUF/resolve/main/llama-3.2-1b-instruct-q4_k_m.gguf',
      mirrors: ['https://cdn.nexusos.local/models/llama-3.2-1b.gguf'],
    },
    metadata: {
      architecture: 'llama',
      vocabularySize: 128256,
    },
  };

  it('validates a well-formed GGUF model manifest', () => {
    assert.equal(ModelArtifactSourceTypeSchema.parse('HUGGING_FACE'), 'HUGGING_FACE');
    assert.equal(ModelArtifactSourceTypeSchema.parse('OLLAMA_REGISTRY'), 'OLLAMA_REGISTRY');
    assert.equal(ModelArtifactSourceTypeSchema.parse('LOCAL_STORAGE'), 'LOCAL_STORAGE');
    assert.equal(ModelArtifactSourceTypeSchema.parse('TRUSTED_HTTPS'), 'TRUSTED_HTTPS');
    assert.equal(
      ModelIdSchema.parse('meta-llama/Llama-3.2-1B-Instruct'),
      'meta-llama/Llama-3.2-1B-Instruct',
    );

    const parsed = ModelManifestSchema.parse(validGgufManifest);
    assert.equal(parsed.modelId, 'meta-llama/Llama-3.2-1B-Instruct');
    assert.equal(parsed.format, 'gguf');
    assert.equal(parsed.quantization, 'Q4_K_M');
    assert.equal(parsed.byteSize, 800000000);
    assert.equal(parsed.sha256, validSha256);
    assert.equal(parsed.source.sourceType, 'HUGGING_FACE');
  });

  it('validates a well-formed ONNX model manifest', () => {
    const onnxManifest = {
      ...validGgufManifest,
      modelId: 'onnx-models/bge-micro-v2',
      name: 'BGE Micro V2',
      format: 'onnx',
      quantization: 'FP16',
      parameterSize: '15M',
      contextLength: 512,
      byteSize: 30000000,
      source: {
        sourceType: 'TRUSTED_HTTPS',
        url: 'https://models.nexusos.internal/onnx/bge-micro.onnx',
      },
    };
    const parsed = ModelManifestSchema.parse(onnxManifest);
    assert.equal(parsed.format, 'onnx');
    assert.equal(parsed.quantization, 'FP16');
  });

  it('validates all supported quantization schemes and rejects unsupported values', () => {
    const supported = ['Q4_0', 'Q4_K_M', 'Q5_0', 'Q5_K_M', 'Q8_0', 'FP16', 'FP32', 'INT8', 'INT4'];
    for (const q of supported) {
      assert.equal(QuantizationTypeSchema.parse(q), q);
      const manifest = { ...validGgufManifest, quantization: q };
      assert.doesNotThrow(() => ModelManifestSchema.parse(manifest));
    }

    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          quantization: 'UNSUPPORTED_QUANT',
        }),
      /Invalid enum value/,
    );
  });

  it('rejects invalid SHA-256 digests', () => {
    // Too short (63 chars)
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85',
        }),
      /Invalid SHA-256 hex string/,
    );

    // Non-hex characters
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          sha256: 'z'.repeat(64),
        }),
      /Invalid SHA-256 hex string/,
    );

    // Empty string
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          sha256: '',
        }),
      /SHA-256 hash must be exactly 64 hex characters/,
    );
  });

  it('rejects negative or zero byteSize', () => {
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          byteSize: 0,
        }),
      /byteSize must be a positive integer/,
    );

    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          byteSize: -1024,
        }),
      /byteSize must be a positive integer/,
    );

    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          byteSize: 1234.56,
        }),
      /Expected integer/,
    );
  });

  it('rejects invalid contextLength', () => {
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          contextLength: 0,
        }),
      /contextLength must be a positive integer/,
    );

    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          contextLength: -512,
        }),
      /contextLength must be a positive integer/,
    );

    // Over maximum window (2,097,152)
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          contextLength: 5000000,
        }),
      /contextLength exceeds maximum allowable window/,
    );
  });

  it('rejects malformed model IDs and path traversal attempts', () => {
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          modelId: '',
        }),
      /modelId cannot be empty/,
    );

    // Directory traversal attempt
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          modelId: '../../../etc/passwd',
        }),
      /modelId cannot contain directory traversal sequence/,
    );

    // Disallowed special characters
    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          modelId: 'bad model name with spaces',
        }),
      /modelId contains invalid characters/,
    );

    assert.throws(
      () =>
        ModelManifestSchema.parse({
          ...validGgufManifest,
          modelId: 'model@v1$!',
        }),
      /modelId contains invalid characters/,
    );
  });

  it('rejects invalid source URL shape', () => {
    assert.throws(
      () =>
        ModelArtifactSourceSchema.parse({
          sourceType: 'HUGGING_FACE',
          url: 'not-a-valid-url',
        }),
      /Invalid url/,
    );

    assert.throws(
      () =>
        ModelArtifactSourceSchema.parse({
          sourceType: 'INVALID_SOURCE_TYPE',
          url: 'https://example.com/model.gguf',
        }),
      /Invalid enum value/,
    );

    assert.throws(
      () =>
        ModelArtifactSourceSchema.parse({
          sourceType: 'HUGGING_FACE',
          url: 'https://example.com/model.gguf',
          mirrors: ['invalid-mirror-url'],
        }),
      /Invalid url/,
    );
  });

  it('validates ModelDownloadRequestSchema with identity bindings', () => {
    const tenantId = crypto.randomUUID();
    const validRequest = {
      manifest: validGgufManifest,
      tenantId,
      workspaceId: 'ws-engineering-ai',
      maxBandwidthBytesPerSec: 10485760, // 10 MB/s
    };

    const parsed = ModelDownloadRequestSchema.parse(validRequest);
    assert.equal(parsed.tenantId, tenantId);
    assert.equal(parsed.workspaceId, 'ws-engineering-ai');
    assert.equal(parsed.maxBandwidthBytesPerSec, 10485760);

    // Rejects missing workspaceId
    assert.throws(
      () =>
        ModelDownloadRequestSchema.parse({
          manifest: validGgufManifest,
          tenantId,
          workspaceId: '',
        }),
      /workspaceId cannot be empty/,
    );

    // Rejects non-UUID tenantId
    assert.throws(
      () =>
        ModelDownloadRequestSchema.parse({
          manifest: validGgufManifest,
          tenantId: 'invalid-tenant-id',
          workspaceId: 'ws-test',
        }),
      /Invalid uuid/,
    );
  });

  it('enforces that download progress cannot exceed totalBytes', () => {
    assert.throws(
      () =>
        ModelDownloadProgressSchema.parse({
          modelId: 'meta-llama/Llama-3.2-1B-Instruct',
          bytesTransferred: 1500,
          totalBytes: 1000,
          transferRateBytesPerSec: 500,
          status: 'DOWNLOADING',
        }),
      /bytesTransferred cannot exceed totalBytes/,
    );

    // Exact equal is valid (completed download)
    const completed = ModelDownloadProgressSchema.parse({
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      bytesTransferred: 1000,
      totalBytes: 1000,
      transferRateBytesPerSec: 0,
      status: 'VERIFYING',
    });
    assert.equal(completed.bytesTransferred, 1000);
    assert.equal(completed.status, 'VERIFYING');
  });

  it('rejects negative download progress metrics', () => {
    assert.throws(
      () =>
        ModelDownloadProgressSchema.parse({
          modelId: 'meta-llama/Llama-3.2-1B-Instruct',
          bytesTransferred: -1,
          totalBytes: 1000,
          transferRateBytesPerSec: 500,
        }),
      /bytesTransferred must be non-negative/,
    );

    assert.throws(
      () =>
        ModelDownloadProgressSchema.parse({
          modelId: 'meta-llama/Llama-3.2-1B-Instruct',
          bytesTransferred: 500,
          totalBytes: -1000,
          transferRateBytesPerSec: 500,
        }),
      /totalBytes must be positive/,
    );

    assert.throws(
      () =>
        ModelDownloadProgressSchema.parse({
          modelId: 'meta-llama/Llama-3.2-1B-Instruct',
          bytesTransferred: 500,
          totalBytes: 1000,
          transferRateBytesPerSec: -10,
        }),
      /transferRateBytesPerSec must be non-negative/,
    );
  });

  it('validates a well-formed empirical InferenceBenchmarkResult', () => {
    const validBenchmark = {
      benchmarkId: crypto.randomUUID(),
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      quantization: 'Q4_K_M',
      modelFormat: 'gguf',
      hardwareProfile: {
        deviceModel: 'ASUS TUF Gaming A15',
        gpuName: 'NVIDIA GeForce RTX 3050 6GB Laptop GPU',
        totalVramBytes: 6442450944,
        totalRamBytes: 16353984512,
        cpuCores: 12,
        cpuArch: 'x64',
      },
      timeToFirstTokenMs: 45.2,
      tokensPerSecond: 28.6,
      promptTokens: 128,
      completionTokens: 256,
      totalDurationMs: 8996.5,
      peakVramBytes: 2400000000,
      peakRamBytes: 1200000000,
      gpuLayers: 24,
      cpuLayers: 8,
      cpuFallback: false,
      gpuAccelerated: true,
      timestamp: new Date().toISOString(),
    };

    const parsed = InferenceBenchmarkResultSchema.parse(validBenchmark);
    assert.equal(parsed.tokensPerSecond, 28.6);
    assert.equal(parsed.gpuAccelerated, true);
    assert.equal(parsed.cpuFallback, false);
    assert.equal(parsed.gpuLayers, 24);
  });

  it('enforces truthfulness invariant: rejects contradictory cpuFallback=true AND gpuAccelerated=true', () => {
    const contradictoryBenchmark = {
      benchmarkId: crypto.randomUUID(),
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      quantization: 'Q4_K_M',
      modelFormat: 'gguf',
      hardwareProfile: {
        deviceModel: 'Reference-Workstation',
        totalRamBytes: 16353984512,
      },
      timeToFirstTokenMs: 120.0,
      tokensPerSecond: 10.5,
      promptTokens: 32,
      completionTokens: 64,
      totalDurationMs: 6219.0,
      peakVramBytes: 0,
      peakRamBytes: 4000000000,
      gpuLayers: 0,
      cpuLayers: 32,
      cpuFallback: true,
      gpuAccelerated: true, // Contradiction!
      timestamp: Date.now(),
    };

    assert.throws(
      () => InferenceBenchmarkResultSchema.parse(contradictoryBenchmark),
      /Truthfulness invariant violation: cpuFallback and gpuAccelerated cannot both be true/,
    );
  });

  it('enforces truthfulness invariant: rejects gpuAccelerated=true with 0 gpuLayers', () => {
    const fakeGpuBenchmark = {
      benchmarkId: crypto.randomUUID(),
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      quantization: 'Q4_K_M',
      modelFormat: 'gguf',
      hardwareProfile: {
        deviceModel: 'Reference-Workstation',
        totalRamBytes: 16353984512,
      },
      timeToFirstTokenMs: 120.0,
      tokensPerSecond: 10.5,
      promptTokens: 32,
      completionTokens: 64,
      totalDurationMs: 6219.0,
      peakVramBytes: 0,
      peakRamBytes: 4000000000,
      gpuLayers: 0, // No GPU layers offloaded
      cpuLayers: 32,
      cpuFallback: false,
      gpuAccelerated: true, // Falsely claimed!
      timestamp: Date.now(),
    };

    assert.throws(
      () => InferenceBenchmarkResultSchema.parse(fakeGpuBenchmark),
      /Truthfulness invariant violation: gpuAccelerated is true but gpuLayers is 0/,
    );
  });

  it('enforces benchmark numeric bounds (rejects negative metrics)', () => {
    const baseBenchmark = {
      benchmarkId: crypto.randomUUID(),
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      quantization: 'Q4_K_M',
      modelFormat: 'gguf',
      hardwareProfile: {
        deviceModel: 'Reference-Workstation',
        totalRamBytes: 16353984512,
      },
      timeToFirstTokenMs: 45.2,
      tokensPerSecond: 28.6,
      promptTokens: 128,
      completionTokens: 256,
      totalDurationMs: 8996.5,
      peakVramBytes: 2400000000,
      peakRamBytes: 1200000000,
      gpuLayers: 24,
      cpuLayers: 8,
      cpuFallback: false,
      gpuAccelerated: true,
      timestamp: new Date().toISOString(),
    };

    assert.throws(
      () =>
        InferenceBenchmarkResultSchema.parse({
          ...baseBenchmark,
          timeToFirstTokenMs: -5.0,
        }),
      /timeToFirstTokenMs must be non-negative/,
    );

    assert.throws(
      () =>
        InferenceBenchmarkResultSchema.parse({
          ...baseBenchmark,
          tokensPerSecond: -1.0,
        }),
      /tokensPerSecond must be non-negative/,
    );

    assert.throws(
      () =>
        InferenceBenchmarkResultSchema.parse({
          ...baseBenchmark,
          peakVramBytes: -100,
        }),
      /peakVramBytes must be non-negative/,
    );

    assert.throws(
      () =>
        InferenceBenchmarkResultSchema.parse({
          ...baseBenchmark,
          plannedVramBytes: -50,
        }),
      /plannedVramBytes must be non-negative/,
    );
  });

  it('validates planned memory metrics and accepts null peak memory when unmeasured', () => {
    const truthfulBenchmark = {
      benchmarkId: crypto.randomUUID(),
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      quantization: 'Q4_K_M',
      modelFormat: 'gguf',
      hardwareProfile: {
        deviceModel: 'Reference-Workstation',
        totalRamBytes: 16353984512,
      },
      timeToFirstTokenMs: 85.5,
      tokensPerSecond: 28.6,
      promptTokens: 16,
      completionTokens: 64,
      totalDurationMs: 2320.0,
      plannedVramBytes: 2147483648,
      plannedRamBytes: 536870912,
      peakVramBytes: null, // Truthful: unavailable without GPU process counter
      peakRamBytes: 156237824, // Measured process RSS
      gpuLayers: 0,
      cpuLayers: 32,
      cpuFallback: true,
      gpuAccelerated: false,
      timestamp: new Date().toISOString(),
    };

    const parsed = InferenceBenchmarkResultSchema.parse(truthfulBenchmark);
    assert.equal(parsed.plannedVramBytes, 2147483648);
    assert.equal(parsed.plannedRamBytes, 536870912);
    assert.equal(parsed.peakVramBytes, null);
    assert.equal(parsed.peakRamBytes, 156237824);
  });
});
