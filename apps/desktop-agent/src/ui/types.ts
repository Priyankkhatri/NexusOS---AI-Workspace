import { z } from 'zod';
import {
  ApprovalDecisionChoiceSchema,
  ApprovalDecisionRequestSchema,
  ApprovalDecisionResultSchema,
  ApprovalLifecycleStateSchema,
  ApprovalPromptItemSchema,
  ApprovalPromptRequestSchema,
  ApprovalRiskTierSchema,
  computeApprovalReceiptChecksum,
  DEFAULT_PROMPT_TTL_SECONDS,
  ExecutionLeaseHeaderSchema,
  isHighRiskCapability,
  MAX_PROMPT_DESCRIPTION_BYTES,
  type ApprovalDecisionChoice,
  type ApprovalDecisionRequest,
  type ApprovalDecisionResult,
  type ApprovalLifecycleState,
  type ApprovalPromptItem,
  type ApprovalPromptRequest,
  type ApprovalRiskTier,
  type ExecutionLeaseHeader,
} from '@nexusos/contracts';

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

/** Backward-compatible type alias for prompt lifecycle state */
export type PromptLifecycleState = ApprovalLifecycleState;

export {
  MAX_PROMPT_DESCRIPTION_BYTES,
  DEFAULT_PROMPT_TTL_SECONDS,
  ApprovalRiskTierSchema,
  ApprovalLifecycleStateSchema,
  ApprovalDecisionChoiceSchema,
  ApprovalPromptRequestSchema,
  ApprovalPromptItemSchema,
  ApprovalDecisionRequestSchema,
  ApprovalDecisionResultSchema,
  computeApprovalReceiptChecksum,
  isHighRiskCapability,
  ExecutionLeaseHeaderSchema,
  type ApprovalDecisionChoice,
  type ApprovalLifecycleState,
  type ApprovalRiskTier,
  type ApprovalPromptRequest,
  type ApprovalPromptItem,
  type ApprovalDecisionRequest,
  type ApprovalDecisionResult,
  type ExecutionLeaseHeader,
};

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
