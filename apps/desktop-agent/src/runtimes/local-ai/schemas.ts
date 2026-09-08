import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';
import { MAX_OUTPUT_TOKENS, MAX_PROMPT_BYTES, ModelIdPattern } from './types.js';

// ============================================================
// 1. localAi.generate
// ============================================================

export const LocalAiGenerateIPCRequestSchema = z.object({
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
  maxTokens: z
    .number()
    .int()
    .positive()
    .max(
      MAX_OUTPUT_TOKENS,
      `Output tokens exceed maximum allowable ceiling of ${MAX_OUTPUT_TOKENS}`,
    )
    .optional(),
  maxOutputTokens: z
    .number()
    .int()
    .positive()
    .max(
      MAX_OUTPUT_TOKENS,
      `Output tokens exceed maximum allowable ceiling of ${MAX_OUTPUT_TOKENS}`,
    )
    .optional(),
  stopSequences: z.array(z.string()).max(10).optional(),
  tenantId: z.string().min(1, 'tenantId cannot be empty'),
  deviceId: z.string().min(1, 'deviceId cannot be empty'),
  callerId: z.string().min(1, 'callerId cannot be empty'),
  leaseHeader: ExecutionLeaseHeaderSchema,
  correlationId: z.string().min(1, 'correlationId cannot be empty'),
  taskId: z.string().optional(),
  workflowId: z.string().optional(),
});

export type LocalAiGenerateIPCRequest = z.infer<typeof LocalAiGenerateIPCRequestSchema>;

// ============================================================
// 2. localAi.listModels
// ============================================================

export const LocalAiListModelsIPCRequestSchema = z.object({
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type LocalAiListModelsIPCRequest = z.infer<typeof LocalAiListModelsIPCRequestSchema>;

// ============================================================
// 3. localAi.getHardwareProfile
// ============================================================

export const LocalAiGetHardwareProfileIPCRequestSchema = z.object({
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type LocalAiGetHardwareProfileIPCRequest = z.infer<
  typeof LocalAiGetHardwareProfileIPCRequestSchema
>;

// ============================================================
// 4. localAi.unloadModel
// ============================================================

export const LocalAiUnloadModelIPCRequestSchema = z.object({
  modelId: z
    .string()
    .min(1, 'modelId cannot be empty')
    .max(128, 'modelId too long')
    .regex(ModelIdPattern, 'modelId contains invalid characters'),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type LocalAiUnloadModelIPCRequest = z.infer<typeof LocalAiUnloadModelIPCRequestSchema>;
