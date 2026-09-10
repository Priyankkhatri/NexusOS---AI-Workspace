import crypto from 'node:crypto';
import { z } from 'zod';
import { TenantIdSchema } from '../identity/index.js';
import { ExecutionLeaseHeaderSchema } from '../permissions/index.js';

/**
 * Model Provider Type enum matching supported Local AI runtime engines.
 */
export const ModelProviderTypeSchema = z.enum([
  'ollama',
  'llamacpp',
  'lmstudio',
  'onnx',
  'cpu_fallback',
]);

export type ModelProviderType = z.infer<typeof ModelProviderTypeSchema>;

/**
 * Local AI Operation Identifier Enum matching Architecture Bible Section 10
 */
export enum LocalAiOperation {
  GENERATE = 'local-ai:generate',
  LIST_MODELS = 'local-ai:list-models',
  GET_HARDWARE_PROFILE = 'local-ai:get-hardware-profile',
  UNLOAD_MODEL = 'local-ai:unload-model',
}

export const LocalAiOperationSchema = z.nativeEnum(LocalAiOperation);

/**
 * Canonical capability mappings (both dot-notated and colon-notated forms supported)
 */
export const CANONICAL_LOCAL_AI_CAPABILITIES = {
  GENERATE: 'localAi.generate',
  LIST_MODELS: 'localAi.listModels',
  GET_HARDWARE_PROFILE: 'localAi.getHardwareProfile',
  UNLOAD_MODEL: 'localAi.unloadModel',
} as const;

/**
 * Resolves a capabilityId string (e.g. 'localAi.generate', 'local-ai:generate', 'localai.generate')
 * into the canonical LocalAiOperation enum, or undefined if not recognized.
 */
export function resolveLocalAiOperation(capabilityId: string): LocalAiOperation | undefined {
  if (!capabilityId || typeof capabilityId !== 'string') {
    return undefined;
  }
  const normalized = capabilityId.trim().toLowerCase();

  if (Object.values(LocalAiOperation).includes(normalized as LocalAiOperation)) {
    return normalized as LocalAiOperation;
  }

  if (
    normalized === 'generate' ||
    normalized === 'inference' ||
    normalized === 'localai.generate' ||
    normalized === 'local-ai.generate' ||
    normalized === 'localai:generate' ||
    normalized === 'ai.generate' ||
    normalized === 'capability:localai:generate' ||
    normalized === 'capability:local-ai:generate'
  ) {
    return LocalAiOperation.GENERATE;
  }

  if (
    normalized === 'list' ||
    normalized === 'listmodels' ||
    normalized === 'list_models' ||
    normalized === 'localai.listmodels' ||
    normalized === 'local-ai.listmodels' ||
    normalized === 'localai:listmodels' ||
    normalized === 'local-ai:list-models' ||
    normalized === 'ai.listmodels' ||
    normalized === 'capability:localai:listmodels'
  ) {
    return LocalAiOperation.LIST_MODELS;
  }

  if (
    normalized === 'profile' ||
    normalized === 'gethardwareprofile' ||
    normalized === 'get_hardware_profile' ||
    normalized === 'localai.gethardwareprofile' ||
    normalized === 'local-ai.gethardwareprofile' ||
    normalized === 'localai:gethardwareprofile' ||
    normalized === 'local-ai:get-hardware-profile' ||
    normalized === 'ai.gethardwareprofile' ||
    normalized === 'capability:localai:gethardwareprofile'
  ) {
    return LocalAiOperation.GET_HARDWARE_PROFILE;
  }

  if (
    normalized === 'unload' ||
    normalized === 'unloadmodel' ||
    normalized === 'unload_model' ||
    normalized === 'localai.unloadmodel' ||
    normalized === 'local-ai.unloadmodel' ||
    normalized === 'localai:unloadmodel' ||
    normalized === 'local-ai:unload-model' ||
    normalized === 'ai.unloadmodel' ||
    normalized === 'capability:localai:unloadmodel'
  ) {
    return LocalAiOperation.UNLOAD_MODEL;
  }

  return undefined;
}

/**
 * Hardware Budget Schema for inference requests
 */
export const ModelHardwareBudgetSchema = z.object({
  maxVramBytes: z.number().nonnegative().optional(),
  maxRamBytes: z.number().nonnegative().optional(),
  allowCpuFallback: z.boolean().default(true),
});

export type ModelHardwareBudget = z.infer<typeof ModelHardwareBudgetSchema>;

/**
 * Prompt Template Isolation Policy Schema
 */
export const PromptIsolationPolicySchema = z.object({
  strictSeparation: z.boolean().default(true),
  neutralizeControlTokens: z.boolean().default(true),
});

export type PromptIsolationPolicy = z.infer<typeof PromptIsolationPolicySchema>;

/**
 * Model Inference Request Schema
 */
export const ModelInferenceRequestSchema = z.object({
  requestId: z.string().uuid(),
  taskId: z.string().min(1),
  stepId: z.string().optional(),
  correlationId: z.string().optional(),
  tenantId: TenantIdSchema,
  leaseHeader: ExecutionLeaseHeaderSchema,
  modelId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9._:\-/]+$/),
  provider: ModelProviderTypeSchema.default('onnx'),
  prompt: z.string().min(1).max(131072), // 128 KB
  systemPrompt: z.string().max(32768).optional(), // 32 KB
  contextDocuments: z.array(z.string().max(65536)).max(10).optional(),
  temperature: z.number().min(0.0).max(2.0).default(0.7),
  maxTokens: z.number().int().min(1).max(8192).default(2048),
  stopSequences: z.array(z.string().max(64)).max(8).optional(),
  hardwareBudget: ModelHardwareBudgetSchema.default({ allowCpuFallback: true }),
  isolationPolicy: PromptIsolationPolicySchema.default({
    strictSeparation: true,
    neutralizeControlTokens: true,
  }),
  streaming: z.boolean().default(false),
});

export type ModelInferenceRequest = z.infer<typeof ModelInferenceRequestSchema>;

/**
 * Model Inference Response Schema
 */
export const ModelInferenceResponseSchema = z.object({
  requestId: z.string().uuid(),
  taskId: z.string().min(1),
  modelId: z.string(),
  provider: ModelProviderTypeSchema,
  content: z.string(),
  finishReason: z.enum(['stop', 'length', 'cancel', 'error']),
  usage: z.object({
    promptTokens: z.number().nonnegative(),
    completionTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
  }),
  hardwareProfileUsed: z.object({
    gpuAccelerated: z.boolean(),
    vramAllocatedBytes: z.number().nonnegative(),
    ramAllocatedBytes: z.number().nonnegative(),
    cpuFallback: z.boolean(),
    fallbackReason: z.string().optional(),
  }),
  durationMs: z.number().nonnegative(),
  evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  redacted: z.boolean().default(false),
});

export type ModelInferenceResponse = z.infer<typeof ModelInferenceResponseSchema>;

/**
 * Computes deterministic SHA-256 evidence checksum linking inference inputs, outputs, and lease identity.
 */
export function computeModelEvidenceChecksum(params: {
  taskId: string;
  leaseId: string;
  modelId: string;
  provider: string;
  promptHash?: string;
  outputHash?: string;
  prompt?: string;
  output?: string;
  cpuFallback: boolean;
  totalTokens?: number;
}): string {
  const pHash =
    params.promptHash ??
    (params.prompt ? crypto.createHash('sha256').update(params.prompt).digest('hex') : '');
  const oHash =
    params.outputHash ??
    (params.output ? crypto.createHash('sha256').update(params.output).digest('hex') : '');
  const tokens = params.totalTokens ?? 0;

  const parts = [
    params.taskId,
    params.leaseId,
    params.modelId,
    params.provider,
    pHash,
    oHash,
    String(params.cpuFallback),
    String(tokens),
  ];
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}

export * from './native.js';
export * from './manifest.js';
