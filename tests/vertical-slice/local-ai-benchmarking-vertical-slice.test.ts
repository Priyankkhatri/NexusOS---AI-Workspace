import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InferenceBenchmarkResultSchema } from '@nexusos/contracts';
import {
  HardwareDetector,
  ModelCacheManager,
  ProviderAdapterFactory,
  LlamaCppAdapter,
  INativeEngineBackend,
  ExecutionLeaseBoundary,
} from '@nexusos/desktop-agent';
import { runBenchmark } from '../../scripts/benchmark-local-ai.js';

class MockHardwareSampler {
  constructor(
    private readonly gpuAdapters: any[] = [],
    private readonly totalRam: number = 16 * 1024 * 1024 * 1024,
  ) {}

  async sampleGpuAdapters() {
    return this.gpuAdapters;
  }
  async sampleNpuPresence() {
    return false;
  }
  async sampleThermalState() {
    return 'normal';
  }
  async sampleSystemRam() {
    return this.totalRam;
  }
}

class AllowAllPolicyEvaluator {
  async evaluate(request: any) {
    return {
      decisionId: crypto.randomUUID(),
      effect: 'ALLOW',
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      reason: 'Allowed in benchmark test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context?.requestId,
      correlationId: request.context?.correlationId,
    };
  }

  getSnapshot() {
    return {
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Task 065 — Local AI Benchmarking Vertical Slice', () => {
  let tmpDir: string;
  let leaseBoundary: ExecutionLeaseBoundary;
  const sampleHmacKey = 'nexusos-benchmark-local-operator-key-32b!';

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-065-bench-vs-'));
    leaseBoundary = new ExecutionLeaseBoundary(new AllowAllPolicyEvaluator() as any, sampleHmacKey);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function createSyntheticModel(
    cacheManager: ModelCacheManager,
    modelId: string = 'test-benchmark-model',
    quantization: string = 'Q4_K_M',
  ) {
    const modelPayload = Buffer.from('SYNTHETIC_GGUF_DATA_FOR_BENCHMARK_TEST');
    const stagedPath = path.join(tmpDir, 'staging', `${modelId}.gguf`);
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.writeFileSync(stagedPath, modelPayload);

    const sha256 = crypto.createHash('sha256').update(modelPayload).digest('hex');
    return await cacheManager.stageAndPromoteModel(stagedPath, {
      modelId,
      name: 'Benchmark Test Model',
      provider: 'llamacpp',
      sha256,
      fileSizeBytes: modelPayload.length,
      format: 'gguf',
      quantization,
      contextWindowTokens: 4096,
    });
  }

  // 1. benchmark result schema validation
  it('1. benchmark result conforms strictly to InferenceBenchmarkResultSchema', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'schema-val-model', 'Q4_K_M');

    const sampler = new MockHardwareSampler([]);
    const detector = new HardwareDetector(sampler as any);

    const result = await runBenchmark({
      modelId: 'schema-val-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      warmup: 1,
      iterations: 2,
      hardwareDetector: detector,
      leaseBoundary,
    });

    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.ok(result.result);

    // Strict schema parse: will throw if any invariant or type is violated
    const parsed = InferenceBenchmarkResultSchema.parse(result.result);
    assert.equal(parsed.modelId, 'schema-val-model');
    assert.equal(parsed.quantization, 'Q4_K_M');
    assert.ok(parsed.timeToFirstTokenMs >= 0);
    assert.ok(parsed.tokensPerSecond >= 0);
    assert.ok(parsed.promptTokens > 0);
    assert.ok(parsed.completionTokens > 0);
    assert.ok(parsed.totalDurationMs >= 0);
  });

  // 2. CPU fallback truthfulness
  it('2. CPU fallback truthfulness: reports cpuFallback=true and gpuAccelerated=false without native backend', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'cpu-truth-model', 'Q4_K_M');

    // Host reports GPU hardware present, but native backend is NOT loaded/attached
    const sampler = new MockHardwareSampler([
      {
        name: 'NVIDIA GeForce RTX 3050 Laptop GPU',
        vramBytes: 6 * 1024 * 1024 * 1024,
        freeVramBytes: 5 * 1024 * 1024 * 1024,
      },
    ]);
    const detector = new HardwareDetector(sampler as any);

    const adapterFactory = new ProviderAdapterFactory();
    const llama = adapterFactory.getAdapter('llamacpp') as LlamaCppAdapter;
    llama.setNativeBackend(null); // Explicitly ensure no native engine

    const result = await runBenchmark({
      modelId: 'cpu-truth-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      warmup: 0,
      iterations: 1,
      hardwareDetector: detector,
      adapterFactory,
      leaseBoundary,
    });

    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.equal(result.executionMode, 'CPU_FALLBACK');
    assert.ok(result.result);
    assert.equal(result.result.cpuFallback, true);
    assert.equal(result.result.gpuAccelerated, false);
    assert.equal(result.result.gpuLayers, 0);
    assert.equal(result.result.peakVramBytes, 0);
    assert.ok(result.result.cpuLayers > 0);
  });

  // 3. GPU/native truthfulness
  it('3. GPU/native truthfulness: reports gpuAccelerated=true only when native backend executes', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'gpu-truth-model', 'Q5_K_M');

    let nativeBackendExecuted = false;
    const mockNativeBackend: INativeEngineBackend = {
      async *execute(request, _model, _plan) {
        nativeBackendExecuted = true;
        yield {
          requestId: request.requestId,
          chunkIndex: 0,
          text: 'First token ',
          tokenCount: 2,
          isFinal: false,
          finishReason: undefined,
          redacted: false,
        };
        yield {
          requestId: request.requestId,
          chunkIndex: 1,
          text: 'streamed from native CUDA backend.',
          tokenCount: 6,
          isFinal: true,
          finishReason: 'stop',
          redacted: false,
        };
      },
    };

    const sampler = new MockHardwareSampler([
      {
        name: 'NVIDIA GeForce RTX 3050 Laptop GPU',
        vramBytes: 6 * 1024 * 1024 * 1024,
        freeVramBytes: 5 * 1024 * 1024 * 1024,
      },
    ]);
    const detector = new HardwareDetector(sampler as any);

    const adapterFactory = new ProviderAdapterFactory();
    const llama = adapterFactory.getAdapter('llamacpp') as LlamaCppAdapter;
    llama.setNativeBackend(mockNativeBackend, 'cuda');

    const result = await runBenchmark({
      modelId: 'gpu-truth-model',
      quantization: 'Q5_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      warmup: 0,
      iterations: 1,
      hardwareDetector: detector,
      adapterFactory,
      leaseBoundary,
    });

    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.equal(nativeBackendExecuted, true, 'Native backend execute() MUST have been called');
    assert.equal(result.executionMode, 'NATIVE_GPU');
    assert.ok(result.result);
    assert.equal(result.result.gpuAccelerated, true);
    assert.equal(result.result.cpuFallback, false);
    assert.ok(result.result.gpuLayers > 0);
    assert.ok(result.result.peakVramBytes > 0);
  });

  // 4. Contradictory flags cannot be emitted
  it('4. Contradictory execution flags are rejected by schema and runner invariants', async () => {
    // Both cpuFallback and gpuAccelerated true
    const contradictory1 = {
      benchmarkId: crypto.randomUUID(),
      modelId: 'test-contradictory',
      quantization: 'Q4_K_M' as const,
      modelFormat: 'gguf' as const,
      hardwareProfile: {
        deviceModel: 'Ref',
        gpuName: 'NVIDIA RTX',
        totalVramBytes: 6000000000,
        totalRamBytes: 16000000000,
        cpuCores: 8,
        cpuArch: 'x64',
      },
      timeToFirstTokenMs: 25.0,
      tokensPerSecond: 40.0,
      promptTokens: 10,
      completionTokens: 20,
      totalDurationMs: 500.0,
      peakVramBytes: 2000000000,
      peakRamBytes: 4000000000,
      gpuLayers: 16,
      cpuLayers: 16,
      cpuFallback: true,
      gpuAccelerated: true, // INVARIANT VIOLATION
      timestamp: new Date().toISOString(),
    };

    assert.throws(
      () => InferenceBenchmarkResultSchema.parse(contradictory1),
      /Truthfulness invariant violation: cpuFallback and gpuAccelerated cannot both be true/,
    );

    // gpuAccelerated true with gpuLayers === 0
    const contradictory2 = {
      ...contradictory1,
      cpuFallback: false,
      gpuAccelerated: true,
      gpuLayers: 0, // INVARIANT VIOLATION
    };

    assert.throws(
      () => InferenceBenchmarkResultSchema.parse(contradictory2),
      /Truthfulness invariant violation: gpuAccelerated is true but gpuLayers is 0/,
    );
  });

  // 5. TTFT is not fabricated when token timing is unavailable
  it('5. TTFT is not fabricated when token timing is unavailable', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'no-timing-model', 'Q4_K_M');

    const adapterFactory = new ProviderAdapterFactory();
    const llama = adapterFactory.getAdapter('llamacpp') as any;
    llama.supportsTokenTiming = false; // Adapter declares timing unavailable

    const result = await runBenchmark({
      modelId: 'no-timing-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      adapterFactory,
      leaseBoundary,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'TOKEN_TIMING_UNAVAILABLE');
    assert.ok(
      (result.message || '').includes('Fabricating TTFT or tokens/sec is strictly prohibited'),
    );
  });

  // 6. token/sec derives from actual generated tokens
  it('6. generation tokens/sec derives directly from observed tokens and elapsed generation time', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'token-rate-model', 'Q4_K_M');

    const mockNativeBackend: INativeEngineBackend = {
      async *execute(request, _model, _plan) {
        // Sleep 10ms between tokens to create measurable monotonic timing
        await new Promise((r) => setTimeout(r, 10));
        yield {
          requestId: request.requestId,
          chunkIndex: 0,
          text: 'Chunk 1 ',
          tokenCount: 5,
          isFinal: false,
          finishReason: undefined,
          redacted: false,
        };
        await new Promise((r) => setTimeout(r, 20));
        yield {
          requestId: request.requestId,
          chunkIndex: 1,
          text: 'Chunk 2 final.',
          tokenCount: 5,
          isFinal: true,
          finishReason: 'stop',
          redacted: false,
        };
      },
    };

    const sampler = new MockHardwareSampler([
      {
        name: 'Mock GPU',
        vramBytes: 8 * 1024 * 1024 * 1024,
        freeVramBytes: 7 * 1024 * 1024 * 1024,
      },
    ]);
    const detector = new HardwareDetector(sampler as any);
    const adapterFactory = new ProviderAdapterFactory();
    const llama = adapterFactory.getAdapter('llamacpp') as LlamaCppAdapter;
    llama.setNativeBackend(mockNativeBackend, 'cuda');

    const result = await runBenchmark({
      modelId: 'token-rate-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      warmup: 0,
      iterations: 1,
      hardwareDetector: detector,
      adapterFactory,
      leaseBoundary,
    });

    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.ok(result.result);
    assert.equal(result.result.completionTokens, 10);
    assert.ok(result.result.tokensPerSecond > 0);
    assert.ok(result.result.timeToFirstTokenMs > 0);
  });

  // 7. resource ceilings are respected
  it('7. resource ceilings are respected: oversized model fails closed', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();

    // Create an oversized synthetic model descriptor
    const oversizedArtifact = {
      modelId: 'oversized-model',
      name: 'Oversized Model',
      provider: 'llamacpp' as const,
      sha256: 'a'.repeat(64),
      fileSizeBytes: 50 * 1024 * 1024 * 1024, // 50 GB
      format: 'gguf' as const,
      quantization: 'Q4_K_M',
      contextWindowTokens: 4096,
      state: 'Installed' as const,
      installedPath: path.join(tmpDir, 'models', 'oversized-model.gguf'),
      lastVerifiedAt: new Date().toISOString(),
    };

    // System has only 4 GB RAM and 2 GB VRAM
    const sampler = new MockHardwareSampler(
      [
        {
          name: 'Small GPU',
          vramBytes: 2 * 1024 * 1024 * 1024,
          freeVramBytes: 1.5 * 1024 * 1024 * 1024,
        },
      ],
      4 * 1024 * 1024 * 1024, // 4 GB RAM -> 70% limit is 2.8 GB
    );
    const detector = new HardwareDetector(sampler as any);

    const result = await runBenchmark({
      modelId: 'oversized-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      hardwareDetector: detector,
      customModelArtifact: oversizedArtifact,
      leaseBoundary,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'RESOURCE_LIMIT_EXCEEDED');
    assert.ok((result.message || '').includes('safety ceiling'));
  });

  // 8. benchmark metadata identifies execution mode
  it('8. benchmark result explicitly identifies execution mode as NATIVE_GPU or CPU_FALLBACK', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'mode-id-model', 'Q4_K_M');

    const sampler = new MockHardwareSampler([]);
    const detector = new HardwareDetector(sampler as any);

    const result = await runBenchmark({
      modelId: 'mode-id-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      warmup: 0,
      iterations: 1,
      hardwareDetector: detector,
      leaseBoundary,
    });

    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.equal(result.executionMode, 'CPU_FALLBACK');
  });

  // 9. missing model does not trigger an automatic download
  it('9. missing model fails closed as MODEL_NOT_FOUND without attempting network download', async () => {
    const result = await runBenchmark({
      modelId: 'completely-missing-model',
      baseDir: tmpDir,
      leaseBoundary,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'MODEL_NOT_FOUND');
    assert.ok((result.message || '').includes('Automatic downloading is strictly prohibited'));
  });

  // 10. benchmark output contains no secret material
  it('10. benchmark output contains no secret keys, raw leases, or credentials', async () => {
    const cacheManager = new ModelCacheManager(tmpDir, 100 * 1024 * 1024);
    await cacheManager.initialize();
    await createSyntheticModel(cacheManager, 'secret-audit-model', 'Q4_K_M');

    const result = await runBenchmark({
      modelId: 'secret-audit-model',
      quantization: 'Q4_K_M',
      baseDir: tmpDir,
      modelCacheManager: cacheManager,
      warmup: 0,
      iterations: 1,
      leaseBoundary,
    });

    assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    const serialized = JSON.stringify(result);

    // Verify secrets are absent
    assert.equal(serialized.includes(sampleHmacKey), false, 'HMAC signing key leaked');
    assert.equal(serialized.includes('bearer'), false, 'Bearer token leaked');
    // Ensure no raw lease header is attached to the output
    assert.equal((result.result as any)?.leaseHeader, undefined);
  });
});
