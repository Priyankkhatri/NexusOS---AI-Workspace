import { z } from 'zod';
import {
  UUIDSchema,
  TaskIdSchema,
  TenantIdSchema,
  CorrelationIdSchema,
} from '../identity/index.js';
import { AgentRoleSchema, AgentStatusSchema } from '../acp/directory.js';
import { DelegationStatusSchema } from '../acp/delegation.js';
import {
  ApprovalRiskTierSchema,
  ApprovalLifecycleStateSchema,
  ApprovalDecisionChoiceSchema,
} from '../approval/index.js';

/**
 * Task 067 Hardened Telemetry Limits
 */
export const MAX_TELEMETRY_PAYLOAD_BYTES = 16384; // 16 KB (067-SEC-03)
export const MAX_REPLAY_BUFFER_SIZE = 100; // Max events retained per tenant (067-SEC-05)
export const MAX_REPLAY_BUFFER_AGE_MS = 300_000; // 5 minutes retention TTL (067-SEC-05)
export const MAX_STREAMS_PER_TENANT = 10; // Max concurrent SSE streams per tenant (067-SEC-07)
export const TELEMETRY_STREAM_VERSION = '1.0.0' as const;

/**
 * Canonical Event Schema Categories (Discovery Section 9.1)
 */
export const TelemetryEventCategorySchema = z.enum([
  'nexusos.events.agent.status_changed',
  'nexusos.events.delegation.created',
  'nexusos.events.delegation.progress',
  'nexusos.events.delegation.completed',
  'nexusos.events.delegation.failed',
  'nexusos.events.delegation.cancelled',
  'nexusos.events.task.status_changed',
  'nexusos.events.approval.requested',
  'nexusos.events.approval.decided',
  'nexusos.events.graph.evolved',
  'nexusos.events.telemetry.sample',
  'nexusos.events.stream.reset',
]);
export type TelemetryEventCategory = z.infer<typeof TelemetryEventCategorySchema>;

/**
 * Stream Reset Reasons (Discovery Section 12.3)
 */
export const StreamResetReasonSchema = z.enum([
  'SERVER_EPOCH_CHANGED',
  'REPLAY_BUFFER_EXPIRED',
  'FUTURE_CURSOR_DETECTED',
  'MALFORMED_CURSOR',
]);
export type StreamResetReason = z.infer<typeof StreamResetReasonSchema>;

// ============================================================
// Event Payload Schemas
// ============================================================

export const AgentStatusChangedPayloadSchema = z.object({
  agentId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  workspaceScope: z.array(z.string().min(1)).optional(),
  role: AgentRoleSchema,
  status: AgentStatusSchema,
  currentLoad: z.number().min(0).max(1),
  activeTaskCount: z.number().int().nonnegative(),
  lastHeartbeat: z.string().datetime().optional(),
});
export type AgentStatusChangedPayload = z.infer<typeof AgentStatusChangedPayloadSchema>;

export const DelegationCreatedPayloadSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  childTaskId: TaskIdSchema,
  delegatorAgentId: z.string().min(1).max(128),
  assignedAgentId: z.string().min(1).max(128),
  depth: z.number().int().min(0).max(3),
  requestedScopes: z.array(z.string().min(1)),
  workspaceId: z.string().optional(),
});
export type DelegationCreatedPayload = z.infer<typeof DelegationCreatedPayloadSchema>;

export const DelegationProgressPayloadSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  childTaskId: TaskIdSchema,
  status: DelegationStatusSchema,
  progressPercent: z.number().min(0).max(100).optional(),
  message: z.string().max(1024).optional(),
  workspaceId: z.string().optional(),
});
export type DelegationProgressPayload = z.infer<typeof DelegationProgressPayloadSchema>;

export const DelegationCompletedPayloadSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  childTaskId: TaskIdSchema,
  status: z.literal('COMPLETED'),
  receiptHash: z.string().min(1),
  durationMs: z.number().nonnegative().optional(),
  workspaceId: z.string().optional(),
});
export type DelegationCompletedPayload = z.infer<typeof DelegationCompletedPayloadSchema>;

export const DelegationFailedPayloadSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  childTaskId: TaskIdSchema,
  status: z.literal('FAILED'),
  rejectionReason: z.string().max(2048),
  errorCode: z.string().max(128).optional(),
  workspaceId: z.string().optional(),
});
export type DelegationFailedPayload = z.infer<typeof DelegationFailedPayloadSchema>;

export const DelegationCancelledPayloadSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  status: z.literal('CANCELLED'),
  reason: z.string().max(1024),
  workspaceId: z.string().optional(),
});
export type DelegationCancelledPayload = z.infer<typeof DelegationCancelledPayloadSchema>;

export const TaskStatusChangedPayloadSchema = z.object({
  taskId: TaskIdSchema,
  tenantId: TenantIdSchema,
  workspaceId: z.string().optional(),
  title: z.string().max(256),
  state: z.string().min(1).max(64),
  previousState: z.string().min(1).max(64).optional(),
  targetAgentId: z.string().min(1).max(128),
  error: z
    .object({
      code: z.string().max(128),
      message: z.string().max(2048),
    })
    .optional(),
});
export type TaskStatusChangedPayload = z.infer<typeof TaskStatusChangedPayloadSchema>;

export const ApprovalRequestedPayloadSchema = z.object({
  promptId: UUIDSchema,
  requestId: z.string().min(1).max(128),
  taskId: TaskIdSchema.optional(),
  stepId: z.string().max(128).optional(),
  tenantId: TenantIdSchema,
  title: z.string().max(256),
  description: z.string().max(4096).optional(),
  riskTier: ApprovalRiskTierSchema,
  actionIdentifier: z.string().min(1).max(256),
  expiresAt: z.number().int().positive(),
  workspaceId: z.string().optional(),
});
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayloadSchema>;

export const ApprovalDecidedPayloadSchema = z.object({
  promptId: UUIDSchema,
  requestId: z.string().min(1).max(128).optional(),
  taskId: TaskIdSchema.optional(),
  decision: ApprovalDecisionChoiceSchema,
  state: ApprovalLifecycleStateSchema,
  receiptHash: z.string().min(1),
  decidedBy: z.string().max(128).optional(),
  userNotes: z.string().max(2048).optional(),
  workspaceId: z.string().optional(),
});
export type ApprovalDecidedPayload = z.infer<typeof ApprovalDecidedPayloadSchema>;

export const GraphEvolvedPayloadSchema = z.object({
  deliveryId: z.string().min(1).max(128),
  recordId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  workspaceId: z.string().min(1).max(128),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  operationType: z.string().min(1).max(64),
  candidateSetHash: z.string().max(128).optional(),
});
export type GraphEvolvedPayload = z.infer<typeof GraphEvolvedPayloadSchema>;

export const TelemetrySamplePayloadSchema = z.object({
  tenantId: TenantIdSchema,
  activeTaskCount: z.number().int().nonnegative(),
  pendingApprovalCount: z.number().int().nonnegative(),
  completedTaskCount: z.number().int().nonnegative(),
  failedTaskCount: z.number().int().nonnegative(),
  connectedDeviceCount: z.number().int().nonnegative(),
  vramAlert: z.boolean().optional(),
  healthStatus: z.enum(['HEALTHY', 'READY', 'DEGRADED', 'UNREADY']),
  workspaceId: z.string().optional(),
});
export type TelemetrySamplePayload = z.infer<typeof TelemetrySamplePayloadSchema>;

export const StreamResetPayloadSchema = z.object({
  reason: StreamResetReasonSchema,
  currentEpoch: UUIDSchema,
  currentSequence: z.number().int().nonnegative(),
  requestedCursor: z.string().max(128).optional(),
  message: z.string().max(512).optional(),
});
export type StreamResetPayload = z.infer<typeof StreamResetPayloadSchema>;

// ============================================================
// Canonical Stream Cursor (Discovery Section 12.2)
// ============================================================

/**
 * Regex enforcing strict cursor format: `<streamEpochId>:<sequenceNumber>`
 * - epoch: UUIDv4 format
 * - sequence: positive integer (>= 1) without leading zeros or floating point
 */
export const STREAM_CURSOR_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9][0-9]*$/i;

export interface ParsedStreamCursor {
  epochId: string;
  sequenceNumber: number;
}

/**
 * Validates whether a string is a strictly formatted stream cursor.
 */
export function isValidStreamCursor(cursor: unknown): cursor is string {
  if (typeof cursor !== 'string') return false;
  if (!STREAM_CURSOR_REGEX.test(cursor)) return false;
  const parts = cursor.split(':');
  if (parts.length !== 2) return false;
  const seq = Number(parts[1]);
  return Number.isSafeInteger(seq) && seq > 0;
}

/**
 * Parses a stream cursor into epochId and sequenceNumber.
 * Returns null if the cursor is malformed, invalid, or out of safe integer bounds.
 */
export function parseStreamCursor(cursor: unknown): ParsedStreamCursor | null {
  if (!isValidStreamCursor(cursor)) {
    return null;
  }
  const [epochId, seqStr] = cursor.split(':');
  const sequenceNumber = Number(seqStr);
  return { epochId, sequenceNumber };
}

/**
 * Formats an epoch ID and sequence number into a canonical stream cursor.
 */
export function formatStreamCursor(epochId: string, sequenceNumber: number): string {
  if (!UUIDSchema.safeParse(epochId).success) {
    throw new Error(`Invalid stream epochId '${epochId}': must be a valid UUID.`);
  }
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error(`Invalid sequenceNumber '${sequenceNumber}': must be a positive safe integer.`);
  }
  return `${epochId}:${sequenceNumber}`;
}

// ============================================================
// Canonical Stream Event Envelope
// ============================================================

export const TelemetryStreamEventSchema = z
  .object({
    schema_id: TelemetryEventCategorySchema,
    version: z.literal(TELEMETRY_STREAM_VERSION),
    event_id: UUIDSchema,
    epoch_id: UUIDSchema,
    sequence_number: z.number().int().positive(),
    cursor: z.string().refine(isValidStreamCursor, {
      message: 'cursor must be valid <epochId>:<sequenceNumber>',
    }),
    tenant_id: TenantIdSchema,
    workspace_id: z.string().optional(),
    correlation_id: CorrelationIdSchema,
    occurred_at: z.string().datetime(),
    producer_id: z.string().min(1).max(128),
    payload: z.record(z.unknown()).refine(
      (p) => {
        try {
          const bytes = Buffer.byteLength(JSON.stringify(p), 'utf-8');
          return bytes <= MAX_TELEMETRY_PAYLOAD_BYTES;
        } catch {
          return false;
        }
      },
      {
        message: `Telemetry payload exceeds maximum allowed size of ${MAX_TELEMETRY_PAYLOAD_BYTES} bytes.`,
      },
    ),
  })
  .refine((e) => e.cursor === `${e.epoch_id}:${e.sequence_number}`, {
    message: 'cursor must strictly match epoch_id:sequence_number',
    path: ['cursor'],
  });

export type TelemetryStreamEvent<T = Record<string, unknown>> = Omit<
  z.infer<typeof TelemetryStreamEventSchema>,
  'payload'
> & {
  payload: T;
};

/**
 * Factory helper to construct and validate a TelemetryStreamEvent instance
 */
export function createTelemetryStreamEvent<T extends Record<string, unknown>>(params: {
  schema_id: TelemetryEventCategory;
  epoch_id: string;
  sequence_number: number;
  tenant_id: string;
  workspace_id?: string;
  correlation_id: string;
  producer_id: string;
  payload: T;
  event_id?: string;
  occurred_at?: string;
}): TelemetryStreamEvent<T> {
  const cursor = formatStreamCursor(params.epoch_id, params.sequence_number);
  const event = {
    schema_id: params.schema_id,
    version: TELEMETRY_STREAM_VERSION,
    event_id: params.event_id ?? crypto.randomUUID(),
    epoch_id: params.epoch_id,
    sequence_number: params.sequence_number,
    cursor,
    tenant_id: params.tenant_id,
    workspace_id: params.workspace_id,
    correlation_id: params.correlation_id,
    occurred_at: params.occurred_at ?? new Date().toISOString(),
    producer_id: params.producer_id,
    payload: params.payload,
  };

  return TelemetryStreamEventSchema.parse(event) as TelemetryStreamEvent<T>;
}
