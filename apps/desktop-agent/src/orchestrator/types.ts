import { ApprovalRiskTier, ExecutionLeaseHeader } from '@nexusos/contracts';

export type TaskStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED';

export interface TaskExecutionRequest {
  task_id: string;
  step_id: string;
  correlation_id: string;
  leaseHeader: ExecutionLeaseHeader;
  capabilityId: string;
  runtimeCategory: string; // 'filesystem' | 'terminal' | 'browser' | 'plugin' | 'device' | 'memory'
  payload: Record<string, unknown>;
  timeoutMs?: number;
  idempotency_key?: string;
  message_id?: string;
  riskTier?: ApprovalRiskTier;
  requiresApproval?: boolean;
  actionIdentifier?: string;
  targetResource?: string;
  reversibility?: 'REVERSIBLE' | 'IRREVERSIBLE';
  title?: string;
  description?: string;
}

export interface TaskExecutionResult {
  success: boolean;
  taskId: string;
  stepId: string;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  executionTimeMs: number;
  receiptSignature?: string;
  approvalReceiptHash?: string;
  approvalDecision?: 'ALLOW' | 'DENY';
}

export interface IRuntimeRouter {
  hasCapability(capabilityId: string): boolean;
  resolveRuntimeCategory(capabilityId: string): string | null;
}

export interface IAgentOrchestrator {
  executeTask(request: TaskExecutionRequest): Promise<TaskExecutionResult>;
  cancelTask(taskId: string, tenantId?: string, reason?: string): Promise<boolean>;
  getTaskStatus(taskId: string, tenantId?: string): TaskStatus | null;
  getActiveCount(): number;
}
