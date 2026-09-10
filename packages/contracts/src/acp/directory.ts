import { z } from 'zod';
import { TenantIdSchema } from '../identity/index.js';

/**
 * Logical Agent Roles matching AI Runtime EDD Section 6
 */
export const AgentRoleSchema = z.enum(['COORDINATOR', 'SPECIALIST', 'SUPERVISOR', 'WORKER']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

/**
 * Agent Lifecycle / Health Status
 */
export const AgentStatusSchema = z.enum([
  'REGISTERED',
  'AVAILABLE',
  'BUSY',
  'UNHEALTHY',
  'RETIRED',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Agent Registration Contract (060-SEC-03: binds tenant & workspace isolation)
 */
export const AgentRegistrationSchema = z.object({
  agentId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  workspaceScope: z.array(z.string().min(1)).min(1),
  role: AgentRoleSchema,
  capabilities: z.array(z.string().min(1)).min(1),
  version: z.string().min(1).max(64),
  metadata: z.record(z.string()).optional().default({}),
  registeredAt: z.string().datetime(),
});
export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;
export type AgentRegistrationInput = z.input<typeof AgentRegistrationSchema>;

/**
 * Agent Heartbeat Contract
 */
export const AgentHeartbeatSchema = z.object({
  agentId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  status: AgentStatusSchema,
  currentLoad: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
  activeTaskIds: z.array(z.string()).default([]),
});
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;
