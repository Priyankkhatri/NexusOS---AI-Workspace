import { z } from 'zod';
import { LeaseIdSchema, TaskIdSchema, TenantIdSchema } from '../identity/index.js';

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
