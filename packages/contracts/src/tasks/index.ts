import { z } from 'zod';
import {
  UUIDSchema,
  TaskIdSchema,
  TenantIdSchema,
  DeviceIdSchema,
  LeaseIdSchema,
} from '../identity/index.js';
import { ExecutionLeaseHeaderSchema } from '../permissions/index.js';

/**
 * Task Lifecycle State Enum matching Sprint 0 Blueprint Section 52/53
 */
export enum TaskLifecycleState {
  SUBMITTED = 'SUBMITTED',
  POLICY_EVALUATED = 'POLICY_EVALUATED',
  LEASED = 'LEASED',
  DISPATCHED = 'DISPATCHED',
  EXECUTING = 'EXECUTING',
  RECEIPT_VERIFIED = 'RECEIPT_VERIFIED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const TaskLifecycleStateSchema = z.nativeEnum(TaskLifecycleState);

/**
 * Task Creation Request Schema
 */
export const TaskCreateRequestSchema = z.object({
  title: z.string().min(1).max(256),
  targetAgentId: DeviceIdSchema,
  capabilityId: z.string().min(1),
  runtimeCategory: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
  requestedScope: z.string().min(1),
  metadata: z.record(z.string()).optional(),
});

export type TaskCreateRequest = z.infer<typeof TaskCreateRequestSchema>;

/**
 * Execution Receipt Schema proving runtime execution by Desktop Agent
 */
export const ExecutionReceiptSchema = z.object({
  receiptId: UUIDSchema,
  taskId: TaskIdSchema,
  leaseId: LeaseIdSchema,
  agentId: DeviceIdSchema,
  tenantId: TenantIdSchema,
  status: z.enum(['SUCCESS', 'FAILURE', 'CANCELLED']),
  exitCode: z.number().int().default(0),
  evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256
  output: z.record(z.unknown()).optional(),
  errorMessage: z.string().optional(),
  completedAt: z.string().datetime(),
  signature: z.string().min(1),
});

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

/**
 * Canonical Task Record Schema
 */
export const TaskRecordSchema = z.object({
  taskId: TaskIdSchema,
  tenantId: TenantIdSchema,
  submittedBy: z.string().min(1),
  title: z.string().min(1),
  targetAgentId: DeviceIdSchema,
  capabilityId: z.string().min(1),
  runtimeCategory: z.string().min(1),
  parameters: z.record(z.unknown()),
  requestedScope: z.string().min(1),
  state: TaskLifecycleStateSchema,
  lease: ExecutionLeaseHeaderSchema.optional(),
  receipt: ExecutionReceiptSchema.optional(),
  evidenceChecksum: z.string().optional(),
  policyDecision: z
    .object({
      allowed: z.boolean(),
      reason: z.string().optional(),
      policyVersion: z.string().optional(),
      policyHash: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/**
 * Task Cancellation Request Schema
 */
export const TaskCancelRequestSchema = z.object({
  reason: z.string().optional(),
});

export type TaskCancelRequest = z.infer<typeof TaskCancelRequestSchema>;
