import { z } from 'zod';
import { TenantIdSchema, UUIDSchema } from '../identity/index.js';
import { ModelFormatSchema, QuantizationTypeSchema } from './native.js';

/**
 * Supported artifact source classifications.
 */
export const ModelArtifactSourceTypeSchema = z.enum([
  'HUGGING_FACE',
  'OLLAMA_REGISTRY',
  'LOCAL_STORAGE',
  'TRUSTED_HTTPS',
]);

export type ModelArtifactSourceType = z.infer<typeof ModelArtifactSourceTypeSchema>;

/**
 * Model artifact origin definition.
 * Note: Contract validates URL shape only; SSRF/network policy enforcement belongs to the runtime acquisition layer.
 */
export const ModelArtifactSourceSchema = z.object({
  sourceType: ModelArtifactSourceTypeSchema,
  url: z.string().url().max(2048),
  mirrors: z.array(z.string().url().max(2048)).optional(),
});

export type ModelArtifactSource = z.infer<typeof ModelArtifactSourceSchema>;

/**
 * Model Identifier Regex pattern allowing alphanumeric names with namespace separators,
 * strictly forbidding path traversal characters.
 */
export const ModelIdPattern = new RegExp('^[a-zA-Z0-9_.:/-]+$');

export const ModelIdSchema = z
  .string()
  .min(1, 'modelId cannot be empty')
  .max(128, 'modelId exceeds maximum length of 128')
  .regex(ModelIdPattern, 'modelId contains invalid characters')
  .refine((id) => !id.includes('..'), {
    message: 'modelId cannot contain directory traversal sequence (..)',
  });

export type ModelId = z.infer<typeof ModelIdSchema>;

/**
 * Canonical Local-AI Model Manifest Schema.
 * Represents immutable artifact metadata required for acquisition, verification, and layer offloading.
 */
export const ModelManifestSchema = z.object({
  modelId: ModelIdSchema,
  name: z.string().min(1, 'name cannot be empty').max(256),
  version: z.string().min(1, 'version cannot be empty').max(64),
  format: ModelFormatSchema,
  quantization: QuantizationTypeSchema,
  parameterSize: z.string().min(1, 'parameterSize cannot be empty').max(32),
  contextLength: z
    .number()
    .int()
    .positive('contextLength must be a positive integer')
    .max(2097152, 'contextLength exceeds maximum allowable window'),
  byteSize: z.number().int().positive('byteSize must be a positive integer'),
  sha256: z
    .string()
    .length(64, 'SHA-256 hash must be exactly 64 hex characters')
    .regex(/^[a-fA-F0-9]{64}$/, 'Invalid SHA-256 hex string'),
  source: ModelArtifactSourceSchema,
  metadata: z.record(z.unknown()).default({}),
  signature: z.string().optional(),
});

export type ModelManifest = z.infer<typeof ModelManifestSchema>;

/**
 * Model Download Request Schema.
 * Represents a request to acquire a manifest-described artifact.
 */
export const ModelDownloadRequestSchema = z.object({
  manifest: ModelManifestSchema,
  tenantId: TenantIdSchema,
  workspaceId: z.string().min(1, 'workspaceId cannot be empty').max(128),
  maxBandwidthBytesPerSec: z.number().int().positive().optional(),
});

export type ModelDownloadRequest = z.infer<typeof ModelDownloadRequestSchema>;

/**
 * Download Lifecycle Status Enum.
 */
export const DownloadStatusSchema = z.enum([
  'PENDING',
  'DOWNLOADING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
]);

export type DownloadStatus = z.infer<typeof DownloadStatusSchema>;

/**
 * Model Download Progress Schema.
 * Enforces non-negative numbers and bytesTransferred <= totalBytes.
 */
export const ModelDownloadProgressSchema = z
  .object({
    modelId: ModelIdSchema,
    bytesTransferred: z.number().int().nonnegative('bytesTransferred must be non-negative'),
    totalBytes: z.number().int().positive('totalBytes must be positive'),
    transferRateBytesPerSec: z.number().nonnegative('transferRateBytesPerSec must be non-negative'),
    estimatedRemainingMs: z
      .number()
      .int()
      .nonnegative('estimatedRemainingMs must be non-negative')
      .optional(),
    status: DownloadStatusSchema.default('DOWNLOADING'),
  })
  .refine((data) => data.bytesTransferred <= data.totalBytes, {
    message: 'bytesTransferred cannot exceed totalBytes',
    path: ['bytesTransferred'],
  });

export type ModelDownloadProgress = z.infer<typeof ModelDownloadProgressSchema>;

/**
 * Hardware profile captured during inference benchmarking.
 */
export const BenchmarkHardwareProfileSchema = z
  .object({
    deviceModel: z.string().min(1).default('Reference-Workstation'),
    gpuName: z.string().optional(),
    totalVramBytes: z.number().int().nonnegative().optional(),
    totalRamBytes: z.number().int().nonnegative(),
    cpuCores: z.number().int().positive().optional(),
    cpuArch: z.string().min(1).optional(),
  })
  .passthrough();

export type BenchmarkHardwareProfile = z.infer<typeof BenchmarkHardwareProfileSchema>;

/**
 * Canonical Inference Benchmark Result Schema.
 * Captures empirical benchmark evidence and enforces the truthfulness invariant:
 * cpuFallback and gpuAccelerated cannot simultaneously be true.
 */
export const InferenceBenchmarkResultSchema = z
  .object({
    benchmarkId: UUIDSchema,
    modelId: ModelIdSchema,
    quantization: QuantizationTypeSchema,
    modelFormat: ModelFormatSchema.default('gguf'),
    hardwareProfile: BenchmarkHardwareProfileSchema,
    timeToFirstTokenMs: z.number().nonnegative('timeToFirstTokenMs must be non-negative'),
    tokensPerSecond: z.number().nonnegative('tokensPerSecond must be non-negative'),
    promptTokens: z.number().int().nonnegative('promptTokens must be non-negative'),
    completionTokens: z.number().int().nonnegative('completionTokens must be non-negative'),
    totalDurationMs: z.number().nonnegative('totalDurationMs must be non-negative'),
    peakVramBytes: z.number().int().nonnegative('peakVramBytes must be non-negative'),
    peakRamBytes: z.number().int().nonnegative('peakRamBytes must be non-negative'),
    gpuLayers: z.number().int().nonnegative('gpuLayers must be non-negative'),
    cpuLayers: z.number().int().nonnegative('cpuLayers must be non-negative'),
    cpuFallback: z.boolean(),
    gpuAccelerated: z.boolean(),
    timestamp: z.union([z.string().datetime(), z.number().positive()]),
  })
  .refine((data) => !(data.cpuFallback && data.gpuAccelerated), {
    message: 'Truthfulness invariant violation: cpuFallback and gpuAccelerated cannot both be true',
    path: ['gpuAccelerated'],
  })
  .refine((data) => !(data.gpuAccelerated && data.gpuLayers === 0), {
    message: 'Truthfulness invariant violation: gpuAccelerated is true but gpuLayers is 0',
    path: ['gpuLayers'],
  });

export type InferenceBenchmarkResult = z.infer<typeof InferenceBenchmarkResultSchema>;
