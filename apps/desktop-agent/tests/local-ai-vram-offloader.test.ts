import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VramOffloader, VramOffloaderError } from '../src/runtimes/local-ai/vram-offloader.js';
import { HardwareProfile } from '../src/runtimes/local-ai/types.js';

describe('Task 061: VRAM / RAM Layer Offloading Planner Tests', () => {
  const baseHardware: HardwareProfile = {
    cpuArch: 'x64',
    cpuCores: 16,
    totalRamBytes: 34359738368, // 32 GB
    freeRamBytes: 25769803776, // 24 GB
    gpuAdapters: [
      {
        name: 'NVIDIA GeForce RTX 4090',
        vramBytes: 25769803776, // 24 GB VRAM
        freeVramBytes: 21474836480, // 20 GB free
        driverVersion: '560.94',
      },
    ],
    hasNpu: false,
    thermalState: 'normal',
    sampledAt: Date.now(),
  };

  it('calculates full GPU VRAM fit when model fits comfortably under 80% ceiling', () => {
    const model = {
      modelId: 'phi-3-mini-4k-instruct-q4',
      fileSizeBytes: 2400000000, // ~2.4 GB
      format: 'gguf',
      quantization: 'Q4_K_M',
      totalLayers: 32,
    };

    const plan = VramOffloader.planLayerOffload(baseHardware, model);

    assert.equal(plan.status, 'SUPPORTED');
    assert.equal(plan.isCpuFallback, false);
    assert.equal(plan.placement.gpuLayers, 32);
    assert.equal(plan.placement.cpuLayers, 0);
    assert.equal(plan.placement.offloadRatio, 1.0);
    assert.ok(plan.placement.vramAllocatedBytes > 2400000000);
    assert.equal(plan.placement.ramAllocatedBytes, 0);
  });

  it('calculates partial VRAM placement when model exceeds safe VRAM headroom but fits across tiers', () => {
    // 16 GB VRAM GPU -> 80% ceiling = 12.8 GB
    const limitedGpuHardware: HardwareProfile = {
      ...baseHardware,
      gpuAdapters: [
        {
          name: 'NVIDIA GeForce RTX 4070 Ti',
          vramBytes: 17179869184, // 16 GB
          freeVramBytes: 15000000000,
        },
      ],
    };

    // 14 GB model -> Cannot fit in 12.8 GB VRAM, but partial offload fits in VRAM + 32GB RAM
    const model = {
      modelId: 'llama-3-70b-instruct-q2_k',
      fileSizeBytes: 15032385536, // ~14 GB
      format: 'gguf',
      quantization: 'Q4_K_M',
      totalLayers: 40,
    };

    const plan = VramOffloader.planLayerOffload(limitedGpuHardware, model);

    assert.equal(plan.status, 'SUPPORTED');
    assert.equal(plan.isCpuFallback, false);
    assert.ok(plan.placement.gpuLayers > 0 && plan.placement.gpuLayers < 40);
    assert.ok(plan.placement.cpuLayers > 0);
    assert.equal(plan.placement.gpuLayers + plan.placement.cpuLayers, 40);
    assert.ok(plan.placement.offloadRatio > 0 && plan.placement.offloadRatio < 1.0);
    // VRAM allocation must strictly stay under 80% ceiling (13743895347 bytes)
    assert.ok(plan.placement.vramAllocatedBytes <= Math.floor(17179869184 * 0.8));
    // RAM allocation must strictly stay under 70% ceiling (24051816857 bytes)
    assert.ok(plan.placement.ramAllocatedBytes <= Math.floor(34359738368 * 0.7));
  });

  it('engages CPU quantized fallback when no GPU is detected and fallback is allowed', () => {
    const cpuOnlyHardware: HardwareProfile = {
      ...baseHardware,
      gpuAdapters: [], // No GPU
    };

    const model = {
      modelId: 'tinyllama-1.1b-q4',
      fileSizeBytes: 700000000, // ~700 MB
      format: 'gguf',
      quantization: 'Q4_K_M',
      totalLayers: 22,
    };

    const plan = VramOffloader.planLayerOffload(cpuOnlyHardware, model, { allowCpuFallback: true });

    assert.equal(plan.status, 'FALLBACK');
    assert.equal(plan.isCpuFallback, true);
    assert.equal(plan.placement.gpuLayers, 0);
    assert.equal(plan.placement.cpuLayers, 22);
    assert.equal(plan.placement.vramAllocatedBytes, 0);
    assert.ok(plan.placement.ramAllocatedBytes > 700000000);
    assert.equal(plan.placement.backend, 'cpu');
    assert.match(plan.fallbackReason || '', /No physical GPU/);
  });

  it('fails closed when no GPU is detected and CPU fallback is explicitly disallowed', () => {
    const cpuOnlyHardware: HardwareProfile = {
      ...baseHardware,
      gpuAdapters: [],
    };

    const model = {
      modelId: 'phi-3-mini',
      fileSizeBytes: 2400000000,
      format: 'gguf',
      quantization: 'Q4_K_M',
    };

    const plan = VramOffloader.planLayerOffload(cpuOnlyHardware, model, {
      allowCpuFallback: false,
    });

    assert.equal(plan.status, 'FAILED');
    assert.equal(plan.isCpuFallback, false);
    assert.match(plan.fallbackReason || '', /CPU fallback is disallowed/);
    assert.equal(plan.placement.gpuLayers, 0);
  });

  it('fails closed when GPU VRAM exceeds 80% ceiling and CPU fallback is disallowed', () => {
    const smallGpuHardware: HardwareProfile = {
      ...baseHardware,
      gpuAdapters: [
        {
          name: 'NVIDIA GeForce RTX 3050 Laptop',
          vramBytes: 4294967296, // 4 GB (80% = 3.43 GB)
          freeVramBytes: 4294967296,
        },
      ],
    };

    const largeModel = {
      modelId: 'deepseek-coder-6.7b',
      fileSizeBytes: 5000000000, // ~5 GB (exceeds 3.43 GB safe VRAM)
      format: 'onnx', // ONNX does not split layers
      quantization: 'FP16',
    };

    const plan = VramOffloader.planLayerOffload(smallGpuHardware, largeModel, {
      allowCpuFallback: false,
    });

    assert.equal(plan.status, 'FAILED');
    assert.equal(plan.isCpuFallback, false);
    assert.match(plan.fallbackReason || '', /exceeds safety ceiling.*CPU fallback is disallowed/);
  });

  it('accounts for existing active reservations when computing safe headroom', () => {
    // 24 GB VRAM -> 80% ceiling = 19.2 GB
    // Active reserved VRAM = 18 GB -> Available safe VRAM = 1.2 GB
    const options = {
      activeReservedVramBytes: 19327352832, // 18 GB reserved
      allowCpuFallback: true,
    };

    const model = {
      modelId: 'phi-3-mini',
      fileSizeBytes: 2400000000, // ~2.4 GB, cannot fit in 1.2 GB VRAM
      format: 'onnx',
    };

    const plan = VramOffloader.planLayerOffload(baseHardware, model, options);

    // Should gracefully route to CPU fallback because available VRAM (1.2 GB) < 2.4 GB
    assert.equal(plan.status, 'FALLBACK');
    assert.equal(plan.isCpuFallback, true);
    assert.match(plan.fallbackReason || '', /GPU VRAM headroom.*insufficient/);
  });

  it('fails closed when model requirement exceeds 70% system RAM safety ceiling even with CPU fallback', () => {
    // 8 GB System RAM -> 70% ceiling = 5.6 GB
    const lowRamHardware: HardwareProfile = {
      ...baseHardware,
      totalRamBytes: 8589934592, // 8 GB
      gpuAdapters: [],
    };

    const oversizedModel = {
      modelId: 'llama-3-70b-q4',
      fileSizeBytes: 38000000000, // 38 GB > 5.6 GB
      format: 'gguf',
    };

    const plan = VramOffloader.planLayerOffload(lowRamHardware, oversizedModel, {
      allowCpuFallback: true,
    });

    assert.equal(plan.status, 'FAILED');
    assert.match(plan.fallbackReason || '', /System RAM requirement.*exceeds safety ceiling/);
  });

  it('rejects invalid inputs (non-positive file size or RAM)', () => {
    assert.throws(
      () =>
        VramOffloader.planLayerOffload(
          { ...baseHardware, totalRamBytes: 0 },
          { modelId: 'test', fileSizeBytes: 1000 },
        ),
      VramOffloaderError,
    );

    assert.throws(
      () => VramOffloader.planLayerOffload(baseHardware, { modelId: 'test', fileSizeBytes: -500 }),
      VramOffloaderError,
    );
  });

  it('produces deterministic output across multiple invocations with identical parameters', () => {
    const model = {
      modelId: 'phi-3-mini',
      fileSizeBytes: 2400000000,
      format: 'gguf',
      totalLayers: 32,
    };

    const plan1 = VramOffloader.planLayerOffload(baseHardware, model);
    const plan2 = VramOffloader.planLayerOffload(baseHardware, model);

    assert.equal(plan1.status, plan2.status);
    assert.equal(plan1.placement.gpuLayers, plan2.placement.gpuLayers);
    assert.equal(plan1.placement.cpuLayers, plan2.placement.cpuLayers);
    assert.equal(plan1.placement.vramAllocatedBytes, plan2.placement.vramAllocatedBytes);
    assert.equal(plan1.placement.ramAllocatedBytes, plan2.placement.ramAllocatedBytes);
    assert.equal(plan1.placement.offloadRatio, plan2.placement.offloadRatio);
  });
});
