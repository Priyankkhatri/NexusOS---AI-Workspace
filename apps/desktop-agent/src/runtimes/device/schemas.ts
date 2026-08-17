import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';
import { DeviceOperationName } from './types.js';

export const DeviceRequestContextSchema = z.object({
  taskId: z.string().min(1).max(256),
  workspaceId: z.string().min(1).max(256),
  tenantId: z.string().min(1).max(256),
  subjectId: z.string().min(1).max(256),
  correlationId: z.string().min(1).max(256),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export const ClipboardReadRequestSchema = z.object({
  operationName: z.literal(DeviceOperationName.CLIPBOARD_READ),
  context: DeviceRequestContextSchema,
});

export const ClipboardWriteRequestSchema = z.object({
  operationName: z.literal(DeviceOperationName.CLIPBOARD_WRITE),
  text: z.string().min(0).max(1048576), // 1MB max payload size
  context: DeviceRequestContextSchema,
});

export const ClipboardClearRequestSchema = z.object({
  operationName: z.literal(DeviceOperationName.CLIPBOARD_CLEAR),
  context: DeviceRequestContextSchema,
});

export const DeviceQueryInfoRequestSchema = z.object({
  operationName: z.literal(DeviceOperationName.DEVICE_QUERY_INFO),
  context: DeviceRequestContextSchema,
});

export const DeviceGetPostureRequestSchema = z.object({
  operationName: z.literal(DeviceOperationName.DEVICE_GET_POSTURE),
  context: DeviceRequestContextSchema,
});

export const DeviceNotificationRequestSchema = z.object({
  operationName: z.literal(DeviceOperationName.DEVICE_SHOW_NOTIFICATION),
  title: z.string().min(1).max(128),
  body: z.string().min(1).max(512),
  actionId: z.string().max(128).optional(),
  context: DeviceRequestContextSchema,
});

export const DeviceOperationRequestSchema = z.discriminatedUnion('operationName', [
  ClipboardReadRequestSchema,
  ClipboardWriteRequestSchema,
  ClipboardClearRequestSchema,
  DeviceQueryInfoRequestSchema,
  DeviceGetPostureRequestSchema,
  DeviceNotificationRequestSchema,
]);

export const DeviceRuntimeConfigSchema = z.object({
  maxClipboardSizeBytes: z.number().int().min(100).max(10485760).default(1048576),
  operationTimeoutMs: z.number().int().min(100).max(60000).default(5000),
  maxConcurrentOperations: z.number().int().min(1).max(100).default(10),
});
