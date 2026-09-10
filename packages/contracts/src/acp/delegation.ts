import { z } from 'zod';
import {
  UUIDSchema,
  TaskIdSchema,
  TenantIdSchema,
  LeaseIdSchema,
  CorrelationIdSchema,
} from '../identity/index.js';
import { ExecutionReceiptSchema } from '../tasks/index.js';
export type { ExecutionReceipt } from '../tasks/index.js';

/**
 * Hard Delegation Safety Bounds (060-SEC-02)
 */
export const DELEGATION_SAFETY_LIMITS = {
  MAX_DEPTH: 3,
  MAX_FAN_OUT: 5,
  MAX_TIMEOUT_MS: 300000,
  DEFAULT_TIMEOUT_MS: 60000,
} as const;

/**
 * Delegation Status Enum
 */
export const DelegationStatusSchema = z.enum([
  'ACCEPTED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

/**
 * Sub-Agent Delegation Request Contract (060-SEC-01, 060-SEC-02, 060-SEC-03)
 */
export const SubAgentDelegationRequestSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  parentLeaseId: LeaseIdSchema,
  delegatorAgentId: z.string().min(1).max(128),
  targetAgentId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema,
  subGoal: z.string().min(1).max(4096),
  capabilityId: z.string().min(1).max(128),
  requestedScopes: z.array(z.string().min(1)).min(1),
  parameters: z.record(z.unknown()).optional().default({}),
  delegationDepth: z.number().int().min(1).max(DELEGATION_SAFETY_LIMITS.MAX_DEPTH),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(DELEGATION_SAFETY_LIMITS.MAX_TIMEOUT_MS)
    .default(DELEGATION_SAFETY_LIMITS.DEFAULT_TIMEOUT_MS),
  idempotencyKey: z.string().min(1).max(128),
  correlationId: CorrelationIdSchema,
  compensationPayload: z.record(z.unknown()).optional(),
});
export type SubAgentDelegationRequest = z.infer<typeof SubAgentDelegationRequestSchema>;
export type SubAgentDelegationRequestInput = z.input<typeof SubAgentDelegationRequestSchema>;

/**
 * Sub-Agent Delegation Response Contract
 */
export const SubAgentDelegationResponseSchema = z.object({
  delegationId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  childTaskId: TaskIdSchema,
  childLeaseId: LeaseIdSchema,
  assignedAgentId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema,
  status: DelegationStatusSchema,
  delegationDepth: z.number().int().min(1).max(DELEGATION_SAFETY_LIMITS.MAX_DEPTH),
  acceptedAt: z.string().datetime(),
  rejectionReason: z.string().optional(),
});
export type SubAgentDelegationResponse = z.infer<typeof SubAgentDelegationResponseSchema>;

/**
 * Composite Execution Receipt Schema (060-SEC-06)
 * Aggregates parent receipt with independently verified child receipts
 */
export const CompositeExecutionReceiptSchema = z.object({
  receiptId: UUIDSchema,
  parentTaskId: TaskIdSchema,
  parentLeaseId: LeaseIdSchema,
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema,
  coordinatorAgentId: z.string().min(1).max(128),
  status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED', 'PARTIAL_COMPENSATION']),
  childReceipts: z.array(ExecutionReceiptSchema).default([]),
  evidenceTreeHash: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256 Merkle / roll-up checksum
  output: z.record(z.unknown()).optional(),
  errorMessage: z.string().optional(),
  completedAt: z.string().datetime(),
  signature: z.string().min(1), // HMAC signature covering composite evidence
});
export type CompositeExecutionReceipt = z.infer<typeof CompositeExecutionReceiptSchema>;
