import crypto from 'node:crypto';
import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '../permissions/index.js';

/**
 * Maximum allowed size for an approval prompt description (64 KB).
 */
export const MAX_PROMPT_DESCRIPTION_BYTES = 65536;

/**
 * Default timeout for approval prompts before auto-expiration (60 seconds).
 * Authoritative: Sprint 1 Backlog Item 5 & PRD Section 7.4.
 */
export const DEFAULT_PROMPT_TTL_SECONDS = 60;

/**
 * Approval Risk Classification Tiers matching Architecture Bible Section 5.1 & PRD 7.4
 */
export const ApprovalRiskTierSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type ApprovalRiskTier = z.infer<typeof ApprovalRiskTierSchema>;

/**
 * Approval Lifecycle State Machine
 */
export const ApprovalLifecycleStateSchema = z.enum([
  'PENDING',
  'APPROVED',
  'DENIED',
  'EXPIRED',
  'CANCELLED',
]);
export type ApprovalLifecycleState = z.infer<typeof ApprovalLifecycleStateSchema>;

/**
 * Explicit Human Decision Choices
 */
export const ApprovalDecisionChoiceSchema = z.enum(['ALLOW', 'DENY']);
export type ApprovalDecisionChoice = z.infer<typeof ApprovalDecisionChoiceSchema>;

/**
 * Canonical Approval Prompt Request Schema
 */
export const ApprovalPromptRequestSchema = z.object({
  leaseHeader: ExecutionLeaseHeaderSchema,
  requestId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128).optional(),
  stepId: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(MAX_PROMPT_DESCRIPTION_BYTES),
  riskTier: ApprovalRiskTierSchema,
  actionIdentifier: z.string().min(1).max(256),
  capabilityId: z.string().min(1).max(256).optional(),
  targetResource: z.string().max(1024).optional(),
  reversibility: z.enum(['REVERSIBLE', 'IRREVERSIBLE']).optional(),
  tenantId: z.string().optional(),
  deviceId: z.string().optional(),
  ttlSeconds: z.number().int().min(1).max(600).optional(),
  isLockScreenPrivate: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ApprovalPromptRequest = z.infer<typeof ApprovalPromptRequestSchema>;

/**
 * Canonical Approval Prompt Item Schema (Stored & Rendered Prompt)
 */
export const ApprovalPromptItemSchema = z.object({
  promptId: z.string().uuid(),
  requestId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128).optional(),
  stepId: z.string().min(1).max(128).optional(),
  leaseId: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  deviceId: z.string().optional(),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(MAX_PROMPT_DESCRIPTION_BYTES),
  riskTier: ApprovalRiskTierSchema,
  actionIdentifier: z.string().min(1).max(256),
  capabilityId: z.string().min(1).max(256).optional(),
  targetResource: z.string().max(1024).optional(),
  reversibility: z.enum(['REVERSIBLE', 'IRREVERSIBLE']).optional(),
  nonce: z.string().min(1).max(128),
  state: ApprovalLifecycleStateSchema,
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  isLockScreenPrivate: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export type ApprovalPromptItem = z.infer<typeof ApprovalPromptItemSchema>;

/**
 * Canonical Approval Decision Request Schema
 */
export const ApprovalDecisionRequestSchema = z.object({
  promptId: z.string().uuid(),
  decision: ApprovalDecisionChoiceSchema,
  nonce: z.string().min(1).max(128),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  userNotes: z.string().max(1024).optional(),
  decidedBy: z.string().max(128).optional(),
});

export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;

/**
 * Canonical Approval Decision Result Schema
 */
export const ApprovalDecisionResultSchema = z.object({
  promptId: z.string().uuid(),
  requestId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128).optional(),
  decision: ApprovalDecisionChoiceSchema,
  state: ApprovalLifecycleStateSchema,
  resolvedAt: z.number().int().positive(),
  receiptHash: z.string().length(64),
  userNotes: z.string().optional(),
  decidedBy: z.string().optional(),
});

export type ApprovalDecisionResult = z.infer<typeof ApprovalDecisionResultSchema>;

/**
 * Computes a deterministic SHA-256 evidence receipt checksum for an approval decision.
 */
export function computeApprovalReceiptChecksum(params: {
  promptId: string;
  requestId: string;
  decision: string;
  resolvedAt: number;
  nonce: string;
  tenantId?: string;
  leaseId?: string;
}): string {
  const parts = [
    params.promptId,
    params.requestId,
    params.decision,
    String(params.resolvedAt),
    params.nonce,
    params.tenantId || '',
    params.leaseId || '',
  ];
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}

/**
 * Authoritative high-risk capability detector.
 * Identifies operations requiring explicit human approval before execution.
 * (PRD Section 7.4 & Backlog Item 5)
 */
export function isHighRiskCapability(
  capabilityId?: string,
  riskTier?: ApprovalRiskTier,
  actionIdentifier?: string,
): boolean {
  if (riskTier === 'HIGH' || riskTier === 'CRITICAL') {
    return true;
  }

  const normalizedCap = (capabilityId || '').toLowerCase().trim();
  const normalizedAction = (actionIdentifier || '').toLowerCase().trim();

  // High-risk terminal execution
  if (
    normalizedCap.includes('terminal.execute') ||
    normalizedCap.includes('terminal.run') ||
    normalizedCap.includes('terminal:execute') ||
    normalizedCap.includes('terminal:run') ||
    normalizedCap.startsWith('terminal.') ||
    normalizedCap === 'localterminal.executecommand' ||
    normalizedAction.includes('terminal.execute') ||
    normalizedAction.includes('exec')
  ) {
    return true;
  }

  // Destructive filesystem actions
  if (
    normalizedCap.includes('fs.delete') ||
    normalizedCap.includes('filesystem.delete') ||
    normalizedCap === 'fs:delete' ||
    normalizedAction.includes('delete') ||
    normalizedAction.includes('format') ||
    normalizedAction.includes('destroy')
  ) {
    return true;
  }

  // Privilege escalation or security-sensitive actions
  if (
    normalizedCap.includes('vault.delete') ||
    normalizedCap.includes('vault.purge') ||
    normalizedCap.includes('security.modify') ||
    normalizedAction.includes('privilege') ||
    normalizedAction.includes('sudo')
  ) {
    return true;
  }

  return false;
}
