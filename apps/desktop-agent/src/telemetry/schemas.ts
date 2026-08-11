import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export const EventPrioritySchema = z.enum(['CRITICAL', 'NON_CRITICAL']);
export const TelemetryItemTypeSchema = z.enum(['METRIC', 'TRACE', 'EVENT', 'DIAGNOSTIC']);

export const LogRecordSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  level: LogLevelSchema,
  component: z.string().min(1),
  message: z.string(),
  correlationId: z.string().optional(),
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  errorCode: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  priority: EventPrioritySchema,
});

export const TelemetryItemSchema = z.object({
  itemId: z.string().uuid(),
  timestamp: z.string().datetime(),
  type: TelemetryItemTypeSchema,
  name: z.string().min(1),
  value: z.number().optional(),
  attributes: z.record(z.unknown()),
  priority: EventPrioritySchema,
});

export const TelemetryBatchSchema = z.object({
  batchId: z.string().uuid(),
  agentId: z.string().min(1),
  createdAt: z.string().datetime(),
  items: z.array(TelemetryItemSchema),
  batchHash: z.string().min(1),
});
