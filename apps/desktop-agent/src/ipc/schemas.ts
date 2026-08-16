import { z } from 'zod';

export const IPCMessageTypeSchema = z.enum(['REQUEST', 'RESPONSE', 'NOTIFICATION', 'ERROR']);

export const IPCErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export const IPCMessageSchema = z.object({
  protocolVersion: z.string().min(1),
  messageId: z.string().uuid(),
  correlationId: z.string().uuid(),
  taskId: z.string().min(1).optional(),
  type: IPCMessageTypeSchema,
  method: z.string().min(1).optional(),
  params: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: IPCErrorPayloadSchema.optional(),
});

export const IPCConfigSchema = z.object({
  pipeName: z.string().min(1).default('nexusos-desktop-ipc'),
  maxConnections: z.coerce.number().int().min(1).max(64).default(16),
  maxFrameSizeBytes: z.coerce.number().int().min(1024).max(10485760).default(1048576), // Default 1MB, max 10MB
  idleTimeoutMs: z.coerce.number().int().min(1000).max(300000).default(30000), // Default 30s
  rateLimitWindowMs: z.coerce.number().int().min(100).max(60000).default(1000), // Default 1s
  maxRequestsPerWindow: z.coerce.number().int().min(1).max(1000).default(20),
  allowedProtocolVersions: z.array(z.string()).min(1).default(['1.0']),
});

export type IPCMessageZod = z.infer<typeof IPCMessageSchema>;
export type IPCConfigZod = z.infer<typeof IPCConfigSchema>;
