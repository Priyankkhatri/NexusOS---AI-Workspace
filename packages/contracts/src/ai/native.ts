import crypto from 'node:crypto';
import { z } from 'zod';
import { TenantIdSchema } from '../identity/index.js';

/**
 * Supported native engine types.
 */
export const NativeEngineTypeSchema = z.enum(['llamacpp', 'onnx', 'cpu_fallback', 'custom']);

export type NativeEngineType = z.infer<typeof NativeEngineTypeSchema>;

/**
 * Model format for native execution boundary.
 */
export const ModelFormatSchema = z.enum(['gguf', 'onnx']);

export type ModelFormat = z.infer<typeof ModelFormatSchema>;

/**
 * Supported quantization representations.
 */
export const QuantizationTypeSchema = z.enum([
  'Q4_0',
  'Q4_K_M',
  'Q5_0',
  'Q5_K_M',
  'Q8_0',
  'FP16',
  'FP32',
  'INT8',
  'INT4',
]);

export type QuantizationType = z.infer<typeof QuantizationTypeSchema>;

/**
 * Execution backends for model inference.
 */
export const ExecutionBackendSchema = z.enum([
  'cpu',
  'cuda',
  'rocm',
  'directml',
  'vulkan',
  'metal',
  'webgpu',
]);

export type ExecutionBackend = z.infer<typeof ExecutionBackendSchema>;

export const EngineCapabilityStatusSchema = z.enum([
  'SUPPORTED',
  'UNAVAILABLE',
  'FALLBACK',
  'FAILED',
]);

export type EngineCapabilityStatus = z.infer<typeof EngineCapabilityStatusSchema>;

/**
 * Hardware acceleration capability & native engine descriptor.
 */
export const HardwareAccelerationCapabilitySchema = z.object({
  engine: NativeEngineTypeSchema,
  modelFormat: ModelFormatSchema,
  backend: ExecutionBackendSchema,
  status: EngineCapabilityStatusSchema,
  maxVramBytes: z.number().nonnegative().optional(),
  supportsLayerOffloading: z.boolean().default(false),
  details: z.string().optional(),
});

export type HardwareAccelerationCapability = z.infer<typeof HardwareAccelerationCapabilitySchema>;
export const NativeEngineDescriptorSchema = HardwareAccelerationCapabilitySchema;
export type NativeEngineDescriptor = HardwareAccelerationCapability;

/**
 * Model layer placement distribution across host memory tiers.
 */
export const ModelLayerPlacementSchema = z
  .object({
    totalLayers: z.number().int().nonnegative(),
    gpuLayers: z.number().int().nonnegative(),
    cpuLayers: z.number().int().nonnegative(),
    vramAllocatedBytes: z.number().nonnegative(),
    ramAllocatedBytes: z.number().nonnegative(),
    offloadRatio: z.number().min(0).max(1),
    backend: ExecutionBackendSchema,
    quantization: QuantizationTypeSchema,
  })
  .refine((data) => data.gpuLayers + data.cpuLayers === data.totalLayers, {
    message: 'Sum of gpuLayers and cpuLayers must equal totalLayers',
  });

export type ModelLayerPlacement = z.infer<typeof ModelLayerPlacementSchema>;

/**
 * Canonical Inference Execution Plan.
 */
export const InferenceExecutionPlanSchema = z.object({
  version: z.literal('1.0.0').default('1.0.0'),
  planId: z.string().uuid(),
  modelId: z.string().min(1),
  modelFormat: ModelFormatSchema,
  placement: ModelLayerPlacementSchema,
  status: EngineCapabilityStatusSchema,
  isCpuFallback: z.boolean(),
  fallbackReason: z.string().optional(),
  estimatedVramUsageBytes: z.number().nonnegative(),
  estimatedRamUsageBytes: z.number().nonnegative(),
  createdAt: z.number().positive(),
});

export type InferenceExecutionPlan = z.infer<typeof InferenceExecutionPlanSchema>;

/**
 * Native Inference Evidence Schema binding execution facts and checksums.
 */
export const NativeInferenceEvidenceSchema = z.object({
  version: z.literal('1.0.0').default('1.0.0'),
  requestId: z.string().uuid(),
  taskId: z.string().min(1),
  leaseId: z.string().min(1),
  tenantId: TenantIdSchema,
  modelId: z.string().min(1),
  modelFormat: ModelFormatSchema,
  engine: NativeEngineTypeSchema,
  backend: ExecutionBackendSchema,
  quantization: QuantizationTypeSchema,
  promptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  tokensGenerated: z.number().int().nonnegative(),
  executionPlanId: z.string().uuid(),
  isCpuFallback: z.boolean(),
  status: EngineCapabilityStatusSchema,
  evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  durationMs: z.number().nonnegative(),
  timestamp: z.number().positive(),
});

export type NativeInferenceEvidence = z.infer<typeof NativeInferenceEvidenceSchema>;

/**
 * Computes deterministic SHA-256 evidence checksum linking native execution parameters.
 */
export function computeNativeEvidenceChecksum(params: {
  taskId: string;
  leaseId: string;
  tenantId: string;
  modelId: string;
  modelFormat: string;
  engine: string;
  backend: string;
  quantization: string;
  promptDigest: string;
  outputDigest: string;
  isCpuFallback: boolean;
  tokensGenerated: number;
  executionPlanId: string;
  timestamp: number;
}): string {
  const parts = [
    params.taskId,
    params.leaseId,
    params.tenantId,
    params.modelId,
    params.modelFormat,
    params.engine,
    params.backend,
    params.quantization,
    params.promptDigest,
    params.outputDigest,
    String(params.isCpuFallback),
    String(params.tokensGenerated),
    params.executionPlanId,
    String(params.timestamp),
  ];
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}
