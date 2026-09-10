import { z } from 'zod';
import { LeaseIdSchema, TaskIdSchema, TenantIdSchema, UUIDSchema } from '../identity/index.js';

/**
 * Execution Lease Header Schema matching Architecture Bible Section 5.6 and Desktop Agent EDD Section 22
 */
export const ExecutionLeaseHeaderSchema = z.object({
  lease_id: LeaseIdSchema,
  task_id: TaskIdSchema,
  agent_id: z.string().min(1),
  tenant_id: TenantIdSchema,
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  scopes: z.array(z.string()).min(1),
  signature: z.string().min(1),
  nonce: z.string().optional(),
  policy_hash: z.string().optional(),
});

export type ExecutionLeaseHeader = z.infer<typeof ExecutionLeaseHeaderSchema>;

/**
 * Delegated Child Lease Header Schema (060-SEC-01, 060-SEC-02)
 * Explicitly binds child execution lease to parent lease authority and recursion depth.
 */
export const DelegatedLeaseHeaderSchema = ExecutionLeaseHeaderSchema.extend({
  parent_lease_id: LeaseIdSchema,
  parent_task_id: TaskIdSchema,
  delegation_depth: z.number().int().min(1).max(3),
  workspace_id: UUIDSchema,
});

export type DelegatedLeaseHeader = z.infer<typeof DelegatedLeaseHeaderSchema>;
