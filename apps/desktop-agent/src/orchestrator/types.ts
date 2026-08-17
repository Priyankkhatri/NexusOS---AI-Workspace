import { ExecutionLeaseHeader } from '@nexusos/contracts';

export type TaskStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELED';

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
