import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { TaskExecutionResult, TaskStatus } from '../orchestrator/types.js';

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

export interface WorkflowNode {
  nodeId: string;
  capabilityId: string;
  runtimeCategory: string;
  payload: Record<string, unknown>;
  dependencies?: string[]; // Array of parent nodeId dependencies
  compensationPayload?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface WorkflowEdge {
  fromNodeId: string;
  toNodeId: string;
}

export interface WorkflowDAG {
  workflowId: string;
  taskId: string;
  leaseHeader: ExecutionLeaseHeader;
  correlationId: string;
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
  expiresAt?: string;
}

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
