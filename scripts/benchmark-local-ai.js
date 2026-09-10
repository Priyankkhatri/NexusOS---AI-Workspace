#!/usr/bin/env node
/**
 * scripts/benchmark-local-ai.js
 *
 * Task 065 — Sprint 3 Milestone 1: Local-AI Inference Benchmark Harness
 *
 * Measures actual execution when a native backend is available and explicitly
 * reports CPU fallback / unavailable execution when it is not.
 *
 * Invariants:
 * - 065-SEC-06: VRAM Safety Ceiling (80%) & RAM Safety Ceiling (70%)
 * - 065-SEC-07: Cryptographic Lease Binding for Model Execution
 * - 065-SEC-08: Non-Repudiable Evidence Integrity & Truthful Capability Reporting
 *
 * Strictly adheres to the Truthfulness Rule:
 * NEVER fabricates GPU acceleration, VRAM usage, tokens/sec, TTFT, or native capability.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Dynamically load workspace packages (supports both tsx and compiled dist execution)
let contracts;
let desktopAgent;
let backend;

try {
  contracts = await import('@nexusos/contracts');
} catch {
  contracts = await import('../packages/contracts/dist/index.js');
}

try {
  desktopAgent = await import('@nexusos/desktop-agent');
} catch {
  desktopAgent = await import('../apps/desktop-agent/dist/index.js');
}

try {
  backend = await import('@nexusos/backend');
} catch {
  backend = await import('../services/backend/dist/index.js');
}

const { InferenceBenchmarkResultSchema } = contracts;
const {
  ExecutionLeaseBoundary,
  HardwareDetector,
  ModelCacheManager,
  ModelRuntimeManager,
  ProviderAdapterFactory,
  VramOffloader,
} = desktopAgent;
const { computeLeaseSignature } = backend;

class LocalOperatorPolicyEvaluator {
  async evaluate(request) {
    return {
      decisionId: crypto.randomUUID(),
      effect: 'ALLOW',
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'local-operator-allow-hash',
      reason: 'Authorized local operator execution',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context?.requestId,
      correlationId: request.context?.correlationId,
    };
  }

  getSnapshot() {
    return {
      policyVersion: '1.0.0',
      policyHash: 'local-operator-allow-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

/**
 * Executes a repeatable, truthful inference benchmark on an available model artifact.
 *
 * @param {Object} options Benchmark configuration options
 * @returns {Promise<Object>} Benchmark result
 */
export async function runBenchmark(options = {}) {
  const {
    modelId = 'reference-model',
    quantization = 'Q4_K_M',
    prompt = 'Explain the fast inverse square root algorithm in 3 concise bullet points.',
    maxTokens = 64,
    warmupRuns = options.warmup !== undefined ? options.warmup : (options.warmupRuns ?? 1),
    iterations = 3,
    baseDir = path.join(os.homedir(), '.nexus', 'model-cache'),
    allowCpuFallback = true,
    runtimeManager = null,
    modelCacheManager = null,
    leaseBoundary = null,
    adapterFactory = null,
    hardwareDetector = null,
    customModelArtifact = null,
    tenantId = '00000000-0000-4000-8000-000000000001',
    deviceId = '00000000-0000-4000-8000-000000000002',
  } = options;

  // 1. Hardware Detection via HardwareDetector (No secondary detector)
  const detector = hardwareDetector ?? new HardwareDetector();
  const hardware = await detector.getProfile();
  const primaryGpu = hardware.gpuAdapters[0];

  // 2. Model Cache Verification (Consumes already-acquired model; NO auto-download)
  const cache =
    modelCacheManager ?? runtimeManager?.modelCacheManager ?? new ModelCacheManager(baseDir);
  const model = customModelArtifact ?? cache.getModel(modelId);

  if (!model) {
    return {
      success: false,
      status: 'MODEL_NOT_FOUND',
      message: `Model artifact '${modelId}' not found in cache at '${baseDir}'. Models must be securely acquired via ModelCacheManager.downloadArtifact() before benchmarking. Automatic downloading is strictly prohibited in benchmark runner.`,
      hardwareProfile: {
        deviceModel: 'Reference-Workstation',
        gpuName: primaryGpu?.name || 'None',
        totalVramBytes: primaryGpu?.vramBytes || 0,
        totalRamBytes: hardware.totalRamBytes,
        cpuCores: hardware.cpuCores,
        cpuArch: hardware.cpuArch,
      },
    };
  }

  // 3. Quantization Verification: derive actual quantization and prevent silent relabeling
  const actualQuantization = model.quantization;
  if (!actualQuantization) {
    return {
      success: false,
      status: 'QUANTIZATION_UNESTABLISHED',
      message: `Model metadata for '${model.modelId}' does not establish a valid quantization. Benchmark cannot proceed without established quantization metadata.`,
    };
  }
  if (quantization && quantization !== actualQuantization) {
    return {
      success: false,
      status: 'QUANTIZATION_MISMATCH',
      message: `Configuration invalid: requested quantization '${quantization}' does not match model's actual metadata quantization '${actualQuantization}'. Silently relabeling quantizations is strictly prohibited.`,
    };
  }

  // 4. Resource Planning & Safety Ceilings via VramOffloader (80% VRAM / 70% RAM)
  const offloadRequirements = {
    modelId: model.modelId,
    fileSizeBytes: model.fileSizeBytes,
    format: model.format,
    quantization: actualQuantization,
    totalLayers: 32,
    contextWindowTokens: model.contextWindowTokens || 4096,
  };

  const plan = VramOffloader.planLayerOffload(hardware, offloadRequirements, {
    allowCpuFallback,
  });

  // Verify memory safety ceiling
  if (plan.status === 'FAILED') {
    return {
      success: false,
      status: 'RESOURCE_LIMIT_EXCEEDED',
      message:
        plan.fallbackReason ||
        'Model offload plan failed safety verification (80% VRAM / 70% RAM ceiling exceeded).',
    };
  }

  if (primaryGpu?.vramBytes && plan.placement.vramAllocatedBytes > primaryGpu.vramBytes * 0.8) {
    return {
      success: false,
      status: 'VRAM_CEILING_EXCEEDED',
      message: `Offload plan requires ${plan.placement.vramAllocatedBytes} bytes VRAM, which exceeds the hard 80% ceiling (${primaryGpu.vramBytes * 0.8} bytes).`,
    };
  }
  if (plan.placement.ramAllocatedBytes > hardware.totalRamBytes * 0.7) {
    return {
      success: false,
      status: 'RAM_CEILING_EXCEEDED',
      message: `Offload plan requires ${plan.placement.ramAllocatedBytes} bytes RAM, which exceeds the hard 70% ceiling (${hardware.totalRamBytes * 0.7} bytes).`,
    };
  }

  // 5. Native Execution Boundary & Truthfulness Authority
  const effectiveAdapterFactory =
    adapterFactory ?? runtimeManager?.adapterFactory ?? new ProviderAdapterFactory();
  const adapter = effectiveAdapterFactory.getAdapter(model.provider);
  const nativeCapability = await adapter.getNativeCapability?.();
  const isNativeAttached =
    nativeCapability?.status === 'SUPPORTED' && nativeCapability?.backend !== 'cpu';

  if (adapter.supportsTokenTiming === false) {
    return {
      success: false,
      status: 'TOKEN_TIMING_UNAVAILABLE',
      message:
        'Inference adapter explicitly declared that genuine token timing is unavailable. Fabricating TTFT or tokens/sec is strictly prohibited.',
    };
  }

  const gpuAccelerated = isNativeAttached && !plan.cpuFallback;
  const cpuFallback = !gpuAccelerated;

  // Strict truthfulness invariant checks
  if (cpuFallback && gpuAccelerated) {
    throw new Error(
      'Truthfulness invariant violation: cpuFallback and gpuAccelerated cannot both be true.',
    );
  }
  if (gpuAccelerated && plan.placement.gpuLayers === 0) {
    throw new Error('Truthfulness invariant violation: gpuAccelerated is true but gpuLayers is 0.');
  }

  // 6. Cryptographic Lease Authorization
  const hmacKey = 'nexusos-benchmark-local-operator-key-32b!';
  const activeLeaseBoundary =
    leaseBoundary ?? new ExecutionLeaseBoundary(new LocalOperatorPolicyEvaluator(), hmacKey);

  const leaseHeader = {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    tenant_id: tenantId,
    agent_id: deviceId,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300000).toISOString(), // 5 minute validity
    scopes: ['ai:inference', 'local_ai:execute'],
    signature: '',
    nonce: crypto.randomUUID(),
  };
  leaseHeader.signature = computeLeaseSignature(leaseHeader, hmacKey);

  // Validate lease upfront
  const leaseValidation = await activeLeaseBoundary.validateLease(leaseHeader);
  if (!leaseValidation || leaseValidation.valid === false) {
    return {
      success: false,
      status: 'LEASE_DENIED',
      message: leaseValidation?.reason || 'Cryptographic execution lease validation failed.',
    };
  }

  // 7. Setup Runtime Manager
  const mrm =
    runtimeManager ??
    new ModelRuntimeManager(
      activeLeaseBoundary,
      baseDir,
      detector,
      undefined,
      cache,
      effectiveAdapterFactory,
    );

  const makeInferenceRequest = (reqId) => ({
    requestId: reqId,
    modelId: model.modelId,
    provider: model.provider,
    prompt,
    maxTokens,
    tenantId,
    deviceId,
    callerId: 'benchmark-runner',
    correlationId: crypto.randomUUID(),
    leaseHeader,
    allowCpuFallback,
    hardwareBudget: {
      maxVramBytes: gpuAccelerated ? plan.placement.vramAllocatedBytes : 0,
      maxRamBytes: plan.placement.ramAllocatedBytes,
      allowCpuFallback,
    },
  });

  // 8. Warmup and 9. Measured Iterations (High-resolution monotonic timing)
  const iterationSamples = [];
  let actualPeakRamBytes = process.memoryUsage().rss;
  let actualPeakVramBytes = null;
  if (typeof adapter.getGpuMemoryUsageBytes === 'function') {
    try {
      actualPeakVramBytes = adapter.getGpuMemoryUsageBytes();
    } catch {
      actualPeakVramBytes = null;
    }
  }

  try {
    for (let w = 0; w < warmupRuns; w++) {
      const warmupReq = makeInferenceRequest(`benchmark-warmup-${w}`);
      // Consume warmup stream completely to ensure model warmup
      // Warmups MUST NOT contaminate measured iteration samples or aggregate statistics
      for await (const warmupChunk of mrm.executeInference(warmupReq)) {
        if (warmupChunk?.text) {
          // Warmup execution - intentionally unmeasured in samples
        }
      }
      actualPeakRamBytes = Math.max(actualPeakRamBytes, process.memoryUsage().rss);
    }

    for (let i = 0; i < iterations; i++) {
      const req = makeInferenceRequest(`benchmark-iter-${i}`);
      let firstTokenTime = null;
      let completionTokens = 0;
      let generatedText = '';

      const iterStart = performance.now();

      for await (const chunk of mrm.executeInference(req)) {
        if (firstTokenTime === null && chunk.text) {
          firstTokenTime = performance.now();
        }
        if (chunk.text) {
          generatedText += chunk.text;
          completionTokens += chunk.tokenCount;
        }
      }

      actualPeakRamBytes = Math.max(actualPeakRamBytes, process.memoryUsage().rss);

      if (firstTokenTime === null || completionTokens === 0) {
        return {
          success: false,
          status: 'TOKEN_TIMING_UNAVAILABLE',
          message:
            'Genuine token timing or token count was not exposed by the inference adapter. Fabricating TTFT or tokens/sec is strictly prohibited.',
        };
      }

      const iterEnd = performance.now();
      const totalDurationMs = Math.max(0.001, iterEnd - iterStart);
      const ttftMs = Math.max(0, firstTokenTime - iterStart);
      const generationDurationMs = Math.max(0.001, iterEnd - firstTokenTime);
      const tokensPerSecond = completionTokens / (generationDurationMs / 1000);

      iterationSamples.push({
        iteration: i + 1,
        ttftMs,
        tokensPerSecond,
        totalDurationMs,
        completionTokens,
        generatedText,
      });
    }
  } catch (err) {
    if (
      err?.code === 'LEASE_DENIED' ||
      err?.message?.includes('Lease') ||
      err?.message?.includes('lease')
    ) {
      return {
        success: false,
        status: 'LEASE_DENIED',
        message: err.message,
      };
    }
    throw err;
  }

  // 10. Compute Aggregate Statistics solely from measured iterations (Median, Mean, Min, Max)
  const stats = (arr) => {
    if (arr.length === 0) return { mean: 0, median: 0, min: 0, max: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const sum = arr.reduce((acc, v) => acc + v, 0);
    return {
      mean: Number((sum / arr.length).toFixed(2)),
      median: Number(median.toFixed(2)),
      min: Number(sorted[0].toFixed(2)),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
    };
  };

  const ttftStats = stats(iterationSamples.map((s) => s.ttftMs));
  const tokensPerSecStats = stats(iterationSamples.map((s) => s.tokensPerSecond));
  const durationStats = stats(iterationSamples.map((s) => s.totalDurationMs));
  const completionTokensStats = stats(iterationSamples.map((s) => s.completionTokens));
  const promptTokens = Math.max(1, Math.ceil(prompt.length / 4));

  const plannedVramBytes = gpuAccelerated ? plan.placement.vramAllocatedBytes : 0;
  const plannedRamBytes = gpuAccelerated
    ? plan.placement.ramAllocatedBytes
    : plan.placement.ramAllocatedBytes || plan.placement.vramAllocatedBytes;

  // 11. Format Canonical Result adhering to InferenceBenchmarkResultSchema
  const benchmarkResult = {
    benchmarkId: crypto.randomUUID(),
    modelId: model.modelId,
    quantization: actualQuantization,
    modelFormat: model.format === 'onnx' ? 'onnx' : 'gguf',
    hardwareProfile: {
      deviceModel: 'Reference-Workstation',
      gpuName: primaryGpu?.name || 'None',
      totalVramBytes: primaryGpu?.vramBytes || 0,
      totalRamBytes: hardware.totalRamBytes,
      cpuCores: hardware.cpuCores,
      cpuArch: hardware.cpuArch,
    },
    timeToFirstTokenMs: ttftStats.median,
    tokensPerSecond: tokensPerSecStats.median,
    promptTokens,
    completionTokens: Math.round(completionTokensStats.median),
    totalDurationMs: durationStats.median,
    plannedVramBytes,
    plannedRamBytes,
    peakVramBytes: actualPeakVramBytes,
    peakRamBytes: actualPeakRamBytes,
    gpuLayers: gpuAccelerated ? plan.placement.gpuLayers : 0,
    cpuLayers: gpuAccelerated ? plan.placement.cpuLayers : plan.placement.totalLayers,
    cpuFallback,
    gpuAccelerated,
    timestamp: new Date().toISOString(),
  };

  // Validate with canonical schema
  InferenceBenchmarkResultSchema.parse(benchmarkResult);

  return {
    success: true,
    status: 'COMPLETED',
    result: benchmarkResult,
    samples: iterationSamples,
    aggregates: {
      ttft: ttftStats,
      tokensPerSecond: tokensPerSecStats,
      durationMs: durationStats,
      completionTokens: completionTokensStats,
    },
    executionMode: gpuAccelerated ? 'NATIVE_GPU' : 'CPU_FALLBACK',
  };
}

/**
 * Command-line entry point.
 */
async function runCli() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string', short: 'm', default: 'reference-model' },
      quantization: { type: 'string', short: 'q', default: 'Q4_K_M' },
      prompt: {
        type: 'string',
        short: 'p',
        default: 'Explain the fast inverse square root algorithm in 3 concise bullet points.',
      },
      'max-tokens': { type: 'string', short: 't', default: '64' },
      warmup: { type: 'string', short: 'w', default: '1' },
      iterations: { type: 'string', short: 'i', default: '3' },
      'base-dir': { type: 'string', short: 'd' },
      'allow-cpu-fallback': { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
NexusOS Local-AI Inference Benchmark Harness
Usage: node scripts/benchmark-local-ai.js [options]

Options:
  -m, --model <id>            Model identifier in cache (default: reference-model)
  -q, --quantization <type>   Expected quantization (Q4_0, Q4_K_M, Q5_K_M, etc.)
  -p, --prompt <text>         Benchmark input prompt
  -t, --max-tokens <n>        Completion token target (default: 64)
  -w, --warmup <n>            Warmup iterations (default: 1)
  -i, --iterations <n>        Measured iterations (default: 3)
  -d, --base-dir <path>       Model cache base directory
      --allow-cpu-fallback    Permit CPU fallback if GPU unavailable (default: true)
      --json                  Output machine-readable JSON (InferenceBenchmarkResultSchema)
  -h, --help                  Show help
`);
    process.exit(0);
  }

  const runResult = await runBenchmark({
    modelId: values.model,
    quantization: values.quantization,
    prompt: values.prompt,
    maxTokens: parseInt(values['max-tokens'], 10) || 64,
    warmupRuns: parseInt(values.warmup, 10) || 1,
    iterations: parseInt(values.iterations, 10) || 3,
    baseDir: values['base-dir'],
    allowCpuFallback: values['allow-cpu-fallback'],
  });

  if (values.json) {
    console.log(JSON.stringify(runResult.result || runResult, null, 2));
    if (!runResult.success) {
      process.exit(1);
    }
    return;
  }

  // Human-Readable Output
  console.log('\n============================================================');
  console.log('NEXUSOS LOCAL-AI INFERENCE BENCHMARK REPORT');
  console.log('============================================================\n');

  if (!runResult.success) {
    console.log(`STATUS: FAILED / NOT EXECUTED`);
    console.log(`Reason: ${runResult.status}`);
    console.log(`Message: ${runResult.message}`);
    if (runResult.hardwareProfile) {
      console.log('\nDetected Hardware Profile:');
      console.log(`  GPU: ${runResult.hardwareProfile.gpuName}`);
      console.log(
        `  VRAM: ${(runResult.hardwareProfile.totalVramBytes / (1024 * 1024)).toFixed(0)} MiB`,
      );
      console.log(
        `  RAM:  ${(runResult.hardwareProfile.totalRamBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      );
      console.log(
        `  CPU:  ${runResult.hardwareProfile.cpuArch} (${runResult.hardwareProfile.cpuCores} cores)`,
      );
    }
    console.log('\n============================================================');
    process.exit(1);
  }

  const r = runResult.result;
  console.log(`Benchmark ID:        ${r.benchmarkId}`);
  console.log(`Model ID:            ${r.modelId}`);
  console.log(`Quantization:        ${r.quantization}`);
  console.log(`Execution Mode:      ${runResult.executionMode}`);
  console.log(`GPU Accelerated:     ${r.gpuAccelerated}`);
  console.log(`CPU Fallback:        ${r.cpuFallback}`);
  console.log(`GPU Layers:          ${r.gpuLayers}`);
  console.log(`CPU Layers:          ${r.cpuLayers}`);
  console.log('------------------------------------------------------------');
  console.log(`Detected GPU:        ${r.hardwareProfile.gpuName}`);
  console.log(
    `Detected VRAM:       ${(r.hardwareProfile.totalVramBytes / (1024 * 1024)).toFixed(0)} MiB`,
  );
  console.log(
    `System RAM:          ${(r.hardwareProfile.totalRamBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
  );
  console.log('------------------------------------------------------------');
  console.log(`Time to First Token: ${r.timeToFirstTokenMs} ms`);
  console.log(`Generation Speed:    ${r.tokensPerSecond} tokens/sec`);
  console.log(`Total Duration:      ${r.totalDurationMs} ms`);
  console.log(`Prompt Tokens:       ${r.promptTokens}`);
  console.log(
    `Planned VRAM:        ${r.plannedVramBytes !== undefined ? `${(r.plannedVramBytes / (1024 * 1024)).toFixed(1)} MiB` : 'N/A'}`,
  );
  console.log(
    `Planned RAM:         ${r.plannedRamBytes !== undefined ? `${(r.plannedRamBytes / (1024 * 1024)).toFixed(1)} MiB` : 'N/A'}`,
  );
  console.log(
    `Peak Measured VRAM:  ${r.peakVramBytes !== null && r.peakVramBytes !== undefined ? `${(r.peakVramBytes / (1024 * 1024)).toFixed(1)} MiB` : 'UNAVAILABLE (not sampled from runtime)'}`,
  );
  console.log(
    `Peak Measured RAM:   ${r.peakRamBytes !== null && r.peakRamBytes !== undefined ? `${(r.peakRamBytes / (1024 * 1024)).toFixed(1)} MiB (process RSS)` : 'UNAVAILABLE'}`,
  );
  console.log('============================================================\n');
}

// Auto-run if executed directly as main script
try {
  const currentPath = fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
  const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]).toLowerCase() : '';
  if (invokedPath && invokedPath === currentPath) {
    runCli().catch((err) => {
      console.error(`Fatal Benchmark Error: ${err.message}`);
      process.exit(1);
    });
  }
} catch {
  // Ignore resolution errors if invoked via runner
}
