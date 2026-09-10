import crypto from 'node:crypto';
import {
  ExecutionBackend,
  InferenceExecutionPlan,
  InferenceExecutionPlanSchema,
  ModelFormat,
  QuantizationType,
} from '@nexusos/contracts';
import { HardwareProfile, MAX_RAM_PERCENT, MAX_VRAM_PERCENT } from './types.js';

export interface ModelOffloadRequirements {
  modelId: string;
  fileSizeBytes: number;
  format?: ModelFormat | string;
  quantization?: QuantizationType | string;
  totalLayers?: number;
  contextWindowTokens?: number;
}

export interface OffloadPlanningOptions {
  allowCpuFallback?: boolean;
  activeReservedRamBytes?: number;
  activeReservedVramBytes?: number;
  preferredBackend?: ExecutionBackend;
  maxVramPercent?: number;
  maxRamPercent?: number;
}

export class VramOffloaderError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_HARDWARE' | 'INVALID_MODEL' | 'PLANNING_FAILED',
  ) {
    super(message);
    this.name = 'VramOffloaderError';
  }
}

/**
 * Deterministic VRAM / RAM Layer Placement Planner.
 * Computes safe distribution between GPU VRAM, system RAM, and CPU execution.
 */
export class VramOffloader {
  public static readonly DEFAULT_MAX_VRAM_PERCENT = MAX_VRAM_PERCENT; // 0.8 (80%)
  public static readonly DEFAULT_MAX_RAM_PERCENT = MAX_RAM_PERCENT; // 0.7 (70%)

  /**
   * Plans layer placement across GPU and CPU memory tiers based on hardware headroom.
   */
  public static planLayerOffload(
    hardware: HardwareProfile,
    model: ModelOffloadRequirements,
    options: OffloadPlanningOptions = {},
  ): InferenceExecutionPlan {
    // 1. Input sanitization and validation
    if (
      !hardware ||
      typeof hardware.totalRamBytes !== 'number' ||
      hardware.totalRamBytes <= 0 ||
      !Number.isFinite(hardware.totalRamBytes)
    ) {
      throw new VramOffloaderError(
        'Invalid hardware profile: totalRamBytes must be a positive finite number.',
        'INVALID_HARDWARE',
      );
    }

    if (
      !model ||
      typeof model.fileSizeBytes !== 'number' ||
      model.fileSizeBytes <= 0 ||
      !Number.isFinite(model.fileSizeBytes)
    ) {
      throw new VramOffloaderError(
        'Invalid model requirements: fileSizeBytes must be a positive finite number.',
        'INVALID_MODEL',
      );
    }

    const maxVramPercent = options.maxVramPercent ?? this.DEFAULT_MAX_VRAM_PERCENT;
    const maxRamPercent = options.maxRamPercent ?? this.DEFAULT_MAX_RAM_PERCENT;
    const allowCpuFallback = options.allowCpuFallback !== false;
    const reservedRam = Math.max(0, options.activeReservedRamBytes ?? 0);
    const reservedVram = Math.max(0, options.activeReservedVramBytes ?? 0);

    const totalLayers = Math.max(
      1,
      model.totalLayers && model.totalLayers > 0 ? Math.floor(model.totalLayers) : 32,
    );
    const modelFormat: ModelFormat = model.format === 'onnx' ? 'onnx' : 'gguf';
    const quantization: QuantizationType =
      model.quantization &&
      ['Q4_0', 'Q4_K_M', 'Q5_0', 'Q5_K_M', 'Q8_0', 'FP16', 'FP32', 'INT8', 'INT4'].includes(
        model.quantization,
      )
        ? (model.quantization as QuantizationType)
        : 'Q4_K_M';

    // Estimate model footprint: weight size + KV cache / working context
    const modelWeightBytes = Math.floor(model.fileSizeBytes);
    const contextTokens = model.contextWindowTokens ?? 2048;
    const kvCacheBytes = Math.max(33554432, Math.floor(contextTokens * 16384)); // e.g. ~32MB minimum for KV cache
    const totalRequiredMemory = modelWeightBytes + kvCacheBytes;
    const perLayerWeightBytes = Math.ceil(modelWeightBytes / totalLayers);

    // Compute hardware safety ceilings
    const primaryGpu =
      hardware.gpuAdapters && hardware.gpuAdapters.length > 0 ? hardware.gpuAdapters[0] : null;
    const totalGpuVram = primaryGpu ? Math.max(0, primaryGpu.vramBytes) : 0;
    const maxAllowedVram = Math.floor(totalGpuVram * maxVramPercent);
    const availableVram = Math.max(0, maxAllowedVram - reservedVram);

    const maxAllowedRam = Math.floor(hardware.totalRamBytes * maxRamPercent);
    const availableRam = Math.max(0, maxAllowedRam - reservedRam);

    const planId = crypto.randomUUID();
    const createdAt = Date.now();

    // Determine GPU acceleration eligibility
    if (totalGpuVram > 0 && availableVram > 0) {
      const backend: ExecutionBackend = options.preferredBackend ?? 'cuda';

      // Scenario 1: Model fits entirely in GPU VRAM
      if (totalRequiredMemory <= availableVram) {
        return InferenceExecutionPlanSchema.parse({
          version: '1.0.0',
          planId,
          modelId: model.modelId,
          modelFormat,
          placement: {
            totalLayers,
            gpuLayers: totalLayers,
            cpuLayers: 0,
            vramAllocatedBytes: totalRequiredMemory,
            ramAllocatedBytes: 0,
            offloadRatio: 1.0,
            backend,
            quantization,
          },
          status: 'SUPPORTED',
          isCpuFallback: false,
          estimatedVramUsageBytes: totalRequiredMemory,
          estimatedRamUsageBytes: 0,
          createdAt,
        });
      }

      // Scenario 2: Partial layer offloading (GGUF supports split layers across VRAM/RAM)
      if (modelFormat === 'gguf' && availableVram > kvCacheBytes + perLayerWeightBytes) {
        const fittingLayers = Math.min(
          totalLayers - 1,
          Math.floor((availableVram - kvCacheBytes) / perLayerWeightBytes),
        );

        if (fittingLayers > 0) {
          const remainingCpuLayers = totalLayers - fittingLayers;
          const neededCpuRam = remainingCpuLayers * perLayerWeightBytes;

          if (neededCpuRam <= availableRam) {
            const vramAllocated = fittingLayers * perLayerWeightBytes + kvCacheBytes;
            const offloadRatio = Number((fittingLayers / totalLayers).toFixed(4));

            return InferenceExecutionPlanSchema.parse({
              version: '1.0.0',
              planId,
              modelId: model.modelId,
              modelFormat,
              placement: {
                totalLayers,
                gpuLayers: fittingLayers,
                cpuLayers: remainingCpuLayers,
                vramAllocatedBytes: vramAllocated,
                ramAllocatedBytes: neededCpuRam,
                offloadRatio,
                backend,
                quantization,
              },
              status: 'SUPPORTED',
              isCpuFallback: false,
              estimatedVramUsageBytes: vramAllocated,
              estimatedRamUsageBytes: neededCpuRam,
              createdAt,
            });
          }
        }
      }
    }

    // Scenario 3: GPU is unavailable or insufficient -> Evaluate CPU Fallback
    if (!allowCpuFallback) {
      // Fail closed when CPU fallback is disallowed
      return InferenceExecutionPlanSchema.parse({
        version: '1.0.0',
        planId,
        modelId: model.modelId,
        modelFormat,
        placement: {
          totalLayers,
          gpuLayers: 0,
          cpuLayers: totalLayers,
          vramAllocatedBytes: 0,
          ramAllocatedBytes: 0,
          offloadRatio: 0,
          backend: 'cpu',
          quantization,
        },
        status: 'FAILED',
        isCpuFallback: false,
        fallbackReason:
          totalGpuVram === 0
            ? 'No GPU hardware detected and CPU fallback is disallowed.'
            : `VRAM requirement (${totalRequiredMemory} bytes) exceeds safety ceiling (${availableVram} bytes available at 80% VRAM ceiling) and CPU fallback is disallowed.`,
        estimatedVramUsageBytes: 0,
        estimatedRamUsageBytes: 0,
        createdAt,
      });
    }

    // Check if total memory fits in available system RAM (<= 70% ceiling)
    if (totalRequiredMemory <= availableRam) {
      return InferenceExecutionPlanSchema.parse({
        version: '1.0.0',
        planId,
        modelId: model.modelId,
        modelFormat,
        placement: {
          totalLayers,
          gpuLayers: 0,
          cpuLayers: totalLayers,
          vramAllocatedBytes: 0,
          ramAllocatedBytes: totalRequiredMemory,
          offloadRatio: 0,
          backend: 'cpu',
          quantization,
        },
        status: 'FALLBACK',
        isCpuFallback: true,
        fallbackReason:
          totalGpuVram === 0
            ? 'No physical GPU detected; executing in CPU quantized fallback mode.'
            : `GPU VRAM headroom (${availableVram} bytes) insufficient for model footprint (${totalRequiredMemory} bytes); executing in CPU quantized fallback mode.`,
        estimatedVramUsageBytes: 0,
        estimatedRamUsageBytes: totalRequiredMemory,
        createdAt,
      });
    }

    // Total memory exceeds 70% system RAM safety ceiling -> Fail closed
    return InferenceExecutionPlanSchema.parse({
      version: '1.0.0',
      planId,
      modelId: model.modelId,
      modelFormat,
      placement: {
        totalLayers,
        gpuLayers: 0,
        cpuLayers: totalLayers,
        vramAllocatedBytes: 0,
        ramAllocatedBytes: 0,
        offloadRatio: 0,
        backend: 'cpu',
        quantization,
      },
      status: 'FAILED',
      isCpuFallback: true,
      fallbackReason: `System RAM requirement (${totalRequiredMemory} bytes) exceeds safety ceiling (${availableRam} bytes available at 70% system RAM ceiling).`,
      estimatedVramUsageBytes: 0,
      estimatedRamUsageBytes: 0,
      createdAt,
    });
  }
}
