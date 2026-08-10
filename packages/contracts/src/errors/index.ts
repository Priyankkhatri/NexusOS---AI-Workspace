import { z } from 'zod';
import { RequestIdSchema, CorrelationIdSchema } from '../identity/index.js';

/**
 * Standard Error Category Taxonomy matching API Contract Specification
 */
export enum ErrorCategory {
  SYSTEM = 'SYSTEM',
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  POLICY_DENIED = 'POLICY_DENIED',
  LEASE_EXPIRED = 'LEASE_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  DEPENDENCY_FAILURE = 'DEPENDENCY_FAILURE',
}

export const ErrorCategorySchema = z.nativeEnum(ErrorCategory);

/**
 * NexusOS Error Schema Definition
 */
export const NexusOSErrorSchema = z.object({
  code: z.string().min(1),
  category: ErrorCategorySchema,
  message: z.string().min(1),
  correlationId: CorrelationIdSchema.optional(),
  requestId: RequestIdSchema.optional(),
  details: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type NexusOSError = z.infer<typeof NexusOSErrorSchema>;

/**
 * Helper to construct a validated NexusOS error payload
 */
export function createNexusOSError(
  code: string,
  category: ErrorCategory,
  message: string,
  extra: Partial<Omit<NexusOSError, 'code' | 'category' | 'message' | 'timestamp'>> = {},
): NexusOSError {
  return NexusOSErrorSchema.parse({
    code,
    category,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}
