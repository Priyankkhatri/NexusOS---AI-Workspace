import { z } from 'zod';
import { LeaseHeaderSchema, type LeaseHeader } from '../permissions/lease-boundary.js';

export type TrayState =
  | 'CONNECTED'
  | 'WORKING'
  | 'AWAITING_APPROVAL'
  | 'OFFLINE'
  | 'ERROR'
  | 'PAUSED';

export interface TrayStatus {
  state: TrayState;
  isPaused: boolean;
  activeTaskCount: number;
  pendingApprovalCount: number;
  lastUpdated: number;
  statusMessage?: string;
}

export type TrayMenuAction =
  | 'open_dashboard'
  | 'pause_agent'
  | 'resume_agent'
  | 'view_active_task'
  | 'open_diagnostics'
  | 'emergency_stop'
  | 'quit';

export interface TrayMenuDescriptor {
  id: TrayMenuAction;
  label: string;
  enabled: boolean;
  shortcut?: string;
}

export type PromptLifecycleState = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';

export type ApprovalRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const MAX_PROMPT_DESCRIPTION_BYTES = 65536; // 64 KB limit
export const DEFAULT_PROMPT_TTL_SECONDS = 60; // 60s default timeout

export interface ApprovalPromptRequest {
  leaseHeader: LeaseHeader;
  requestId: string;
  title: string;
  description: string;
  riskTier: ApprovalRiskTier;
  actionIdentifier: string;
  tenantId?: string;
  deviceId?: string;
  ttlSeconds?: number;
  isLockScreenPrivate?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ApprovalPromptItem {
  promptId: string;
  requestId: string;
  leaseId: string;
  tenantId: string;
  deviceId?: string;
  title: string;
  description: string;
  riskTier: ApprovalRiskTier;
  actionIdentifier: string;
  nonce: string;
  state: PromptLifecycleState;
  createdAt: number;
  expiresAt: number;
  isLockScreenPrivate: boolean;
  metadata?: Record<string, unknown>;
}

export interface ApprovalDecisionRequest {
  promptId: string;
  decision: 'ALLOW' | 'DENY';
  nonce: string;
  leaseHeader: LeaseHeader;
  tenantId?: string;
  userNotes?: string;
}

export interface ApprovalDecisionResult {
  promptId: string;
  requestId: string;
  decision: 'ALLOW' | 'DENY';
  state: PromptLifecycleState;
  resolvedAt: number;
  receiptHash: string;
}

// --- Zod Schemas ---

export const ApprovalPromptRequestSchema = z.object({
  leaseHeader: LeaseHeaderSchema,
  requestId: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(MAX_PROMPT_DESCRIPTION_BYTES),
  riskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  actionIdentifier: z.string().min(1).max(256),
  tenantId: z.string().optional(),
  deviceId: z.string().optional(),
  ttlSeconds: z.number().int().min(1).max(600).optional(),
  isLockScreenPrivate: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ApprovalDecisionRequestSchema = z.object({
  promptId: z.string().uuid(),
  decision: z.enum(['ALLOW', 'DENY']),
  nonce: z.string().min(1).max(128),
  leaseHeader: LeaseHeaderSchema,
  tenantId: z.string().optional(),
  userNotes: z.string().max(1024).optional(),
});

export const TrayStatusRequestSchema = z.object({
  tenantId: z.string().optional(),
});

export class UIError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_INPUT'
      | 'UNAUTHORIZED'
      | 'PROMPT_NOT_FOUND'
      | 'PROMPT_EXPIRED'
      | 'PROMPT_ALREADY_RESOLVED'
      | 'NONCE_MISMATCH'
      | 'TENANT_MISMATCH'
      | 'SIZE_EXCEEDED'
      | 'INTERNAL_ERROR',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'UIError';
  }
}
