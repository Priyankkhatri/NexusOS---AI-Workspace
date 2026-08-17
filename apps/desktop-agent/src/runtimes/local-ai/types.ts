import { z } from 'zod';

// ============================================================
// Enums and Discriminated Union Types
// ============================================================

export type ModelLifecycleState =
  | 'Discovered'
  | 'Requested'
  | 'Downloading'
  | 'Verifying'
  | 'Installed'
  | 'Compatible'
  | 'Warming'
  | 'Ready'
  | 'Draining'
  | 'Inactive'
  | 'Quarantined'
  | 'Deleted';

export type InferenceState =
  | 'Idle'
  | 'Admitting'
  | 'LoadingModel'
  | 'Generating'
  | 'Completed'
  | 'Denied'
  | 'Failed'
  | 'Canceled';

export type ProviderType = 'ollama' | 'llamacpp' | 'lmstudio' | 'onnx' | 'cpu_fallback';

export const MAX_PROMPT_BYTES = 131072; // 128 KB prompt limit
export const MAX_OUTPUT_TOKENS = 8192; // 8,192 token limit
export const MAX_OUTPUT_BYTES = 1048576; // 1 MB text output limit
export const INFERENCE_TIMEOUT_MS = 120000; // 120 seconds default timeout
export const MAX_CONCURRENT_INFERENCES = 2; // Maximum concurrent inferences
export const MAX_VRAM_PERCENT = 0.8; // Max 80% physical VRAM
export const MAX_RAM_PERCENT = 0.7; // Max 70% physical RAM

// ============================================================
// Domain Interfaces
// ============================================================

export interface GpuAdapterInfo {
  name: string;
  vramBytes: number;
  freeVramBytes: number;
  driverVersion?: string;
}

export interface HardwareProfile {
  cpuArch: string;
  cpuCores: number;
  totalRamBytes: number;
  freeRamBytes: number;
  gpuAdapters: GpuAdapterInfo[];
  hasNpu: boolean;
  thermalState: 'normal' | 'throttled' | 'critical';
  sampledAt: number;
}

export interface ResourceReservation {
  reservationId: string;
  ramBytes: number;
  vramBytes: number;
  cpuCores: number;
  acquiredAt: number;
  isReleased: boolean;
}

export interface ModelArtifact {
  modelId: string;
  name: string;
  provider: ProviderType;
  sha256: string;
  fileSizeBytes: number;
  format: 'gguf' | 'onnx' | 'safetensors' | 'bin';
  quantization: string;
  contextWindowTokens: number;
  storagePath: string;
  state: ModelLifecycleState;
  signature?: string;
  license?: string;
  lastUsedTimestamp?: number;
}

export interface InferenceRequest {
  requestId: string;
  modelId: string;
  provider: ProviderType;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tenantId: string;
  deviceId: string;
  callerId: string;
  leaseHeader?: Record<string, unknown>;
  correlationId: string;
  taskId?: string;
  workflowId?: string;
}

export interface InferenceStreamChunk {
  requestId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  isFinal: boolean;
  finishReason?: 'stop' | 'length' | 'error' | 'cancel';
  redacted: boolean;
}

export interface ProviderHealth {
  ready: boolean;
  providerType: ProviderType;
  activeModels: string[];
  endpoint?: string;
}

export interface ILocalModelProvider {
  readonly providerType: ProviderType;
  isAvailable(): Promise<boolean>;
  loadModel(model: ModelArtifact): Promise<void>;
  unloadModel(modelId: string): Promise<void>;
  generateStream(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk>;
  getHealth(): Promise<ProviderHealth>;
}

// ============================================================
// Zod Validation Schemas
// ============================================================

export const ModelIdPattern = /^[a-zA-Z0-9_.:-]+$/;

export const InferenceRequestSchema = z.object({
  requestId: z.string().min(1, 'requestId cannot be empty'),
  modelId: z
    .string()
    .min(1, 'modelId cannot be empty')
    .max(128, 'modelId too long')
    .regex(ModelIdPattern, 'modelId contains invalid characters'),
  provider: z.enum(['ollama', 'llamacpp', 'lmstudio', 'onnx', 'cpu_fallback']),
  prompt: z
    .string()
    .min(1, 'prompt cannot be empty')
    .refine(
      (val) => Buffer.byteLength(val, 'utf8') <= MAX_PROMPT_BYTES,
      `prompt exceeds maximum boundary of ${MAX_PROMPT_BYTES} bytes (128 KB)`,
    ),
  systemPrompt: z
    .string()
    .optional()
    .refine(
      (val) => !val || Buffer.byteLength(val, 'utf8') <= MAX_PROMPT_BYTES,
      `systemPrompt exceeds maximum boundary of ${MAX_PROMPT_BYTES} bytes`,
    ),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional(),
  stopSequences: z.array(z.string()).max(10).optional(),
  tenantId: z.string().min(1, 'tenantId cannot be empty'),
  deviceId: z.string().min(1, 'deviceId cannot be empty'),
  callerId: z.string().min(1, 'callerId cannot be empty'),
  leaseHeader: z.record(z.unknown()).optional(),
  correlationId: z.string().min(1, 'correlationId cannot be empty'),
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
});

export const ModelArtifactSchema = z.object({
  modelId: z
    .string()
    .min(1)
    .max(128)
    .regex(ModelIdPattern, 'modelId contains invalid characters'),
  name: z.string().min(1).max(256),
  provider: z.enum(['ollama', 'llamacpp', 'lmstudio', 'onnx', 'cpu_fallback']),
  sha256: z
    .string()
    .length(64, 'SHA-256 hash must be exactly 64 hex characters')
    .regex(/^[a-fA-F0-9]{64}$/, 'Invalid SHA-256 hex string'),
  fileSizeBytes: z.number().positive(),
  format: z.enum(['gguf', 'onnx', 'safetensors', 'bin']),
  quantization: z.string().min(1),
  contextWindowTokens: z.number().int().positive(),
  storagePath: z.string().min(1),
  state: z.enum([
    'Discovered',
    'Requested',
    'Downloading',
    'Verifying',
    'Installed',
    'Compatible',
    'Warming',
    'Ready',
    'Draining',
    'Inactive',
    'Quarantined',
    'Deleted',
  ]),
  signature: z.string().optional(),
  license: z.string().optional(),
  lastUsedTimestamp: z.number().positive().optional(),
});
