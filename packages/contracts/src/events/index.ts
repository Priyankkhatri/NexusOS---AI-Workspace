import { z } from 'zod';
import { CorrelationIdSchema, UUIDSchema } from '../identity/index.js';

/**
 * Canonical Event Envelope Schema matching PRD Section 1395 and API Contract Specification
 */
export const EventEnvelopeSchema = z.object({
  schema_id: z.string().min(1),
  version: z.string().min(1),
  event_id: UUIDSchema,
  correlation_id: CorrelationIdSchema,
  occurred_at: z.string().datetime(),
  producer_id: z.string().min(1),
  payload: z.record(z.unknown()),
  payload_ref: z.string().optional(),
  trace_id: z.string().optional(),
  retention_days: z.number().int().positive().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Helper to construct a validated event envelope instance
 */
export function createEventEnvelope(
  schema_id: string,
  version: string,
  producer_id: string,
  correlation_id: string,
  payload: Record<string, unknown>,
  extra: Partial<
    Omit<
      EventEnvelope,
      | 'schema_id'
      | 'version'
      | 'producer_id'
      | 'correlation_id'
      | 'payload'
      | 'event_id'
      | 'occurred_at'
    >
  > = {},
): EventEnvelope {
  return EventEnvelopeSchema.parse({
    schema_id,
    version,
    event_id: crypto.randomUUID(),
    correlation_id,
    occurred_at: new Date().toISOString(),
    producer_id,
    payload,
    ...extra,
  });
}
