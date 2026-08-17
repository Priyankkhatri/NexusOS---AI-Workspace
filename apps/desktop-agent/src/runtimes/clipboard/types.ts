import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

export const MAX_CLIPBOARD_TEXT_BYTES = 1048576; // 1 MB limit
export const MAX_CLIPBOARD_IMAGE_BYTES = 10485760; // 10 MB limit
export const DEFAULT_CLIPBOARD_TTL_SECONDS = 60; // 60s auto-clear

export type ClipboardContentType = 'text' | 'image' | 'html' | 'custom';
export type ClipboardSensitivityLevel = 'Public' | 'Internal' | 'Sensitive' | 'Secret';

export interface ClipboardItem {
  id: string;
  contentType: ClipboardContentType;
  text?: string;
  buffer?: Buffer;
  contentHash: string;
  sensitivity: ClipboardSensitivityLevel;
  timestamp: number;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

export const ClipboardReadRequestSchema = z.object({
  requestId: z.string().uuid(),
  tenantId: z.string().uuid(),
  deviceId: z.string().uuid(),
  callerId: z.string().min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
  maxBytes: z.number().int().positive().max(MAX_CLIPBOARD_TEXT_BYTES).optional().default(MAX_CLIPBOARD_TEXT_BYTES),
});

export type ClipboardReadRequest = z.infer<typeof ClipboardReadRequestSchema>;

export const ClipboardWriteRequestSchema = z.object({
  requestId: z.string().uuid(),
  tenantId: z.string().uuid(),
  deviceId: z.string().uuid(),
  callerId: z.string().min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
  contentType: z.enum(['text', 'image', 'html', 'custom']).default('text'),
  text: z.string().max(MAX_CLIPBOARD_TEXT_BYTES).optional(),
  buffer: z.instanceof(Buffer).optional(),
  ttlSeconds: z.number().int().positive().max(86400).optional().default(DEFAULT_CLIPBOARD_TTL_SECONDS),
  isSensitive: z.boolean().optional().default(true),
}).refine(
  (data) => data.text !== undefined || data.buffer !== undefined,
  { message: 'Either text or buffer must be provided for clipboard write' }
);

export type ClipboardWriteRequest = z.infer<typeof ClipboardWriteRequestSchema>;

export interface ClipboardReadResult {
  item?: ClipboardItem;
  redacted: boolean;
  wasTruncated: boolean;
}

export interface ClipboardWriteResult {
  success: boolean;
  itemHash: string;
  autoClearScheduled: boolean;
  ttlSeconds?: number;
}

export interface IClipboardProvider {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  clear(): Promise<void>;
}

export class DefaultSystemClipboardProvider implements IClipboardProvider {
  private inMemoryText = '';

  public async readText(): Promise<string> {
    return this.inMemoryText;
  }

  public async writeText(text: string): Promise<void> {
    this.inMemoryText = text;
  }

  public async clear(): Promise<void> {
    this.inMemoryText = '';
  }
}

export class ClipboardRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: 'READ_DENIED' | 'WRITE_DENIED' | 'INVALID_INPUT' | 'SIZE_EXCEEDED' | 'AUTO_CLEAR_FAILED' | 'PROVIDER_ERROR',
    public readonly causeError?: unknown,
  ) {
    super(message);
    this.name = 'ClipboardRuntimeError';
  }
}
