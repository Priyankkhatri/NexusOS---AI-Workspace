import { z } from 'zod';
import { RequestIdSchema, CorrelationIdSchema } from '../identity/index.js';
import { NexusOSErrorSchema } from '../errors/index.js';

/**
 * Base API Request Metadata Schema
 */
export const APIRequestMetaSchema = z.object({
  requestId: RequestIdSchema,
  correlationId: CorrelationIdSchema,
  timestamp: z.string().datetime(),
  clientVersion: z.string().optional(),
});

export type APIRequestMeta = z.infer<typeof APIRequestMetaSchema>;

/**
 * Base API Success Response Envelope Schema
 */
export const APISuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: APIRequestMetaSchema,
  });

/**
 * Base API Error Response Envelope Schema
 */
export const APIErrorResponseSchema = z.object({
  success: z.literal(false),
  error: NexusOSErrorSchema,
  meta: APIRequestMetaSchema,
});

export type APIErrorResponse = z.infer<typeof APIErrorResponseSchema>;

/**
 * Contract Serialization / Deserialization Boundaries
 */
export function serializeContract<T>(schema: z.ZodType<T>, data: T): string {
  const parsed = schema.parse(data);
  return JSON.stringify(parsed);
}

export function deserializeContract<T>(schema: z.ZodType<T>, jsonString: string): T {
  const raw = JSON.parse(jsonString);
  return schema.parse(raw);
}
