import { WorkflowNode, WorkflowEdge, WorkflowDAG } from '@nexusos/contracts';
import { TaskExecutionResult, TaskStatus } from '../orchestrator/types.js';

export type { WorkflowNode, WorkflowEdge, WorkflowDAG };

export type WorkflowNodeStatus =
  | 'Received'
  | 'Validating'
  | 'Queued'
  | 'Starting'
  | 'Running'
  | 'Reconciling'
  | 'Completed'
  | 'Failed'
  | 'CANCELED'
  | 'EXPIRED';

export interface WorkflowNodeExecutionState {
  nodeId: string;
  status: WorkflowNodeStatus;
  startedAt?: number;
  completedAt?: number;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
}

export interface WorkflowExecutionState {
  workflowId: string;
  taskId: string;
  tenantId: string;
  deviceId: string;
  correlationId: string;
  status: WorkflowNodeStatus;
  nodeStates: Record<string, WorkflowNodeExecutionState>;
  completedNodes: string[];
  pendingNodes: string[];
  activeNodes: string[];
  nodeOutputs: Record<string, Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** Idempotency flag: set to true when compensation has been triggered to prevent duplicate execution */
  compensationTriggered?: boolean;
}

export interface WorkflowMetrics {
  activeWorkflowsCount: number;
  maxActiveWorkflows: number;
  totalCompletedCount: number;
  totalFailedCount: number;
}

export interface IWorkflowEngine {
  executeWorkflow(dag: WorkflowDAG): Promise<TaskExecutionResult>;
  cancelWorkflow(workflowId: string, tenantId?: string, reason?: string): Promise<boolean>;
  getWorkflowStatus(workflowId: string, tenantId?: string): TaskStatus | null;
  getWorkflowMetrics(): WorkflowMetrics;
  initialize(): Promise<void>;
  shutdown(): void;
}
