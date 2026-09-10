import { z } from 'zod';
import {
  UUIDSchema,
  CorrelationIdSchema,
  TenantIdSchema,
  TaskIdSchema,
} from '../identity/index.js';

/**
 * Canonical ACP Message Types matching AI Runtime EDD Section 7.2
 */
export const AcpMessageTypeSchema = z.enum([
  'REQUEST_REPLY',
  'DELEGATION',
  'NEGOTIATION',
  'HEARTBEAT',
  'PROGRESS',
  'CANCELLATION',
  'RECEIPT_SETTLEMENT',
]);
export type AcpMessageType = z.infer<typeof AcpMessageTypeSchema>;

/**
 * Federated ACP Message Envelope Schema (060-SEC-03, 060-SEC-04)
 * Strongly-typed envelope with tenant, workspace, correlation, and lineage bindings.
 */
export const AcpFederationMessageSchema = z.object({
  version: z.string().min(1),
  message_id: UUIDSchema,
  correlation_id: CorrelationIdSchema,
  causation_id: UUIDSchema.optional(),
  message_type: AcpMessageTypeSchema,
  from_agent: z.string().min(1),
  to_agent: z.string().min(1),
  tenant_id: TenantIdSchema,
  workspace_id: UUIDSchema,
  task_id: TaskIdSchema.optional(),
  delegation_lineage: z.array(UUIDSchema).default([]),
  timestamp: z.string().datetime(),
  schema_id: z.string().min(1),
  policy_snapshot_hash: z.string().optional(),
  auth_token: z.string().optional(),
  signature: z.string().optional(),
  body_ref: z.string().optional(),
  trace_hints: z.record(z.string()).optional(),
  payload: z.record(z.unknown()),
});
export type AcpFederationMessage = z.infer<typeof AcpFederationMessageSchema>;

/**
 * Helper to construct a validated Federated ACP message envelope
 */
export function createFederationMessage(params: {
  version?: string;
  correlation_id: string;
  causation_id?: string;
  message_type: AcpMessageType;
  from_agent: string;
  to_agent: string;
  tenant_id: string;
  workspace_id: string;
  task_id?: string;
  delegation_lineage?: string[];
  schema_id: string;
  payload: Record<string, unknown>;
  policy_snapshot_hash?: string;
  auth_token?: string;
  signature?: string;
  body_ref?: string;
  trace_hints?: Record<string, string>;
}): AcpFederationMessage {
  return AcpFederationMessageSchema.parse({
    version: params.version ?? '1.0.0',
    message_id: crypto.randomUUID(),
    correlation_id: params.correlation_id,
    causation_id: params.causation_id,
    message_type: params.message_type,
    from_agent: params.from_agent,
    to_agent: params.to_agent,
    tenant_id: params.tenant_id,
    workspace_id: params.workspace_id,
    task_id: params.task_id,
    delegation_lineage: params.delegation_lineage ?? [],
    timestamp: new Date().toISOString(),
    schema_id: params.schema_id,
    payload: params.payload,
    policy_snapshot_hash: params.policy_snapshot_hash,
    auth_token: params.auth_token,
    signature: params.signature,
    body_ref: params.body_ref,
    trace_hints: params.trace_hints,
  });
}
