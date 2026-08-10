import { z } from 'zod';
import { CorrelationIdSchema, UUIDSchema } from '../identity/index.js';

/**
 * Agent Communication Protocol (ACP) Message Envelope Schema matching PRD Section 1284 and API Contract Specification
 */
export const ACPMessageEnvelopeSchema = z.object({
  version: z.string().min(1),
  message_id: UUIDSchema,
  correlation_id: CorrelationIdSchema,
  causation_id: UUIDSchema.optional(),
  from_agent: z.string().min(1),
  to_agent: z.string().min(1),
  timestamp: z.string().datetime(),
  schema_id: z.string().min(1),
  policy_snapshot_hash: z.string().optional(),
  signature: z.string().optional(),
  payload: z.record(z.unknown()),
});

export type ACPMessageEnvelope = z.infer<typeof ACPMessageEnvelopeSchema>;

/**
 * Helper to construct a validated ACP message envelope
 */
export function createACPMessageEnvelope(
  version: string,
  from_agent: string,
  to_agent: string,
  schema_id: string,
  correlation_id: string,
  payload: Record<string, unknown>,
  extra: Partial<
    Omit<
      ACPMessageEnvelope,
      | 'version'
      | 'from_agent'
      | 'to_agent'
      | 'schema_id'
      | 'correlation_id'
      | 'payload'
      | 'message_id'
      | 'timestamp'
    >
  > = {},
): ACPMessageEnvelope {
  return ACPMessageEnvelopeSchema.parse({
    version,
    message_id: crypto.randomUUID(),
    correlation_id,
    from_agent,
    to_agent,
    timestamp: new Date().toISOString(),
    schema_id,
    payload,
    ...extra,
  });
}
