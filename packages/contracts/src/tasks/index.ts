import { z } from 'zod';
import {
  UUIDSchema,
  TaskIdSchema,
  TenantIdSchema,
  DeviceIdSchema,
  LeaseIdSchema,
} from '../identity/index.js';
import { ExecutionLeaseHeaderSchema } from '../permissions/index.js';

/**
 * Task Lifecycle State Enum matching Sprint 0 Blueprint Section 52/53
 */
export enum TaskLifecycleState {
  SUBMITTED = 'SUBMITTED',
  POLICY_EVALUATED = 'POLICY_EVALUATED',
  LEASED = 'LEASED',
  DISPATCHED = 'DISPATCHED',
  EXECUTING = 'EXECUTING',
  RECEIPT_VERIFIED = 'RECEIPT_VERIFIED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const TaskLifecycleStateSchema = z.nativeEnum(TaskLifecycleState);

/**
 * Task Creation Request Schema
 */
export const TaskCreateRequestSchema = z.object({
  title: z.string().min(1).max(256),
  targetAgentId: DeviceIdSchema,
  capabilityId: z.string().min(1),
  runtimeCategory: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
  requestedScope: z.string().min(1),
  metadata: z.record(z.string()).optional(),
});

export type TaskCreateRequest = z.infer<typeof TaskCreateRequestSchema>;

/**
 * Execution Receipt Schema proving runtime execution by Desktop Agent
 */
export const ExecutionReceiptSchema = z.object({
  receiptId: UUIDSchema,
  taskId: TaskIdSchema,
  leaseId: LeaseIdSchema,
  agentId: DeviceIdSchema,
  tenantId: TenantIdSchema,
  status: z.enum(['SUCCESS', 'FAILURE', 'CANCELLED']),
  exitCode: z.number().int().default(0),
  evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256
  output: z.record(z.unknown()).optional(),
  errorMessage: z.string().optional(),
  completedAt: z.string().datetime(),
  signature: z.string().min(1),
});

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;

/**
 * Workflow Node Schema matching Architecture Bible Section 6 and Desktop Agent EDD Section 24
 */
export const WorkflowNodeSchema = z.object({
  nodeId: z.string().min(1).max(64),
  capabilityId: z.string().min(1),
  runtimeCategory: z.string().min(1),
  payload: z.record(z.unknown()).optional().default({}),
  dependencies: z.array(z.string().min(1).max(64)).optional(),
  compensationPayload: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

/**
 * Workflow Edge Schema
 */
export const WorkflowEdgeSchema = z.object({
  fromNodeId: z.string().min(1).max(64),
  toNodeId: z.string().min(1).max(64),
});

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

/**
 * Validates DAG topology: uniqueness of node IDs, validity of edge references, and absence of cycles.
 */
export function validateDAGTopology(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[] = [],
): { valid: boolean; errorCode?: string; errorMessage?: string } {
  if (!nodes || nodes.length === 0) {
    return {
      valid: false,
      errorCode: 'EMPTY_WORKFLOW',
      errorMessage: 'Workflow DAG must contain at least one node.',
    };
  }

  const nodeMap = new Set<string>();
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  for (const node of nodes) {
    if (nodeMap.has(node.nodeId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_NODE_ID',
        errorMessage: `Duplicate nodeId '${node.nodeId}' found in workflow nodes.`,
      };
    }
    nodeMap.add(node.nodeId);
    inDegree.set(node.nodeId, 0);
    adjacencyList.set(node.nodeId, []);
  }

  // Process node.dependencies
  for (const node of nodes) {
    if (node.dependencies && Array.isArray(node.dependencies)) {
      for (const parentId of node.dependencies) {
        if (!nodeMap.has(parentId)) {
          return {
            valid: false,
            errorCode: 'INVALID_DEPENDENCY',
            errorMessage: `Node '${node.nodeId}' has non-existent dependency '${parentId}'.`,
          };
        }
        if (parentId === node.nodeId) {
          return {
            valid: false,
            errorCode: 'DAG_CYCLE_DETECTED',
            errorMessage: `Node '${node.nodeId}' cannot depend on itself.`,
          };
        }
        adjacencyList.get(parentId)!.push(node.nodeId);
        inDegree.set(node.nodeId, (inDegree.get(node.nodeId) || 0) + 1);
      }
    }
  }

  // Process explicit edges
  for (const edge of edges) {
    if (!nodeMap.has(edge.fromNodeId) || !nodeMap.has(edge.toNodeId)) {
      return {
        valid: false,
        errorCode: 'INVALID_EDGE',
        errorMessage: `Edge references non-existent nodes '${edge.fromNodeId}' -> '${edge.toNodeId}'.`,
      };
    }
    if (edge.fromNodeId === edge.toNodeId) {
      return {
        valid: false,
        errorCode: 'DAG_CYCLE_DETECTED',
        errorMessage: `Self-referencing edge detected on node '${edge.fromNodeId}'.`,
      };
    }
    adjacencyList.get(edge.fromNodeId)!.push(edge.toNodeId);
    inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
  }

  // Kahn's algorithm for cycle detection
  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visitedCount++;
    const children = adjacencyList.get(current) || [];
    for (const child of children) {
      const newDeg = (inDegree.get(child) || 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) {
        queue.push(child);
      }
    }
  }

  if (visitedCount !== nodes.length) {
    return {
      valid: false,
      errorCode: 'DAG_CYCLE_DETECTED',
      errorMessage: 'Circular dependency cycle detected in workflow DAG.',
    };
  }

  return { valid: true };
}

/**
 * Canonical Workflow DAG Schema
 */
export const WorkflowDAGSchema = z
  .object({
    workflowId: UUIDSchema,
    taskId: TaskIdSchema,
    leaseHeader: ExecutionLeaseHeaderSchema,
    correlationId: z.string().min(1),
    nodes: z.array(WorkflowNodeSchema).min(1).max(50),
    edges: z.array(WorkflowEdgeSchema).max(100).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    const res = validateDAGTopology(data.nodes, data.edges);
    if (!res.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: res.errorMessage || 'Invalid DAG topology',
        params: { errorCode: res.errorCode },
      });
    }
  });

export type WorkflowDAG = z.infer<typeof WorkflowDAGSchema>;

/**
 * Task Graph Creation Request Schema
 */
export const TaskGraphCreateRequestSchema = z
  .object({
    title: z.string().min(1).max(256),
    targetAgentId: DeviceIdSchema,
    workflowId: UUIDSchema.optional(),
    nodes: z.array(WorkflowNodeSchema).min(1).max(50),
    edges: z.array(WorkflowEdgeSchema).max(100).optional(),
    requestedScope: z.string().min(1).optional(),
    metadata: z.record(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    const res = validateDAGTopology(data.nodes, data.edges);
    if (!res.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: res.errorMessage || 'Invalid DAG topology',
        params: { errorCode: res.errorCode },
      });
    }
  });

export type TaskGraphCreateRequest = z.infer<typeof TaskGraphCreateRequestSchema>;

/**
 * Execution Receipt Schema proving runtime execution of a multi-node workflow by Desktop Agent
 */
export const WorkflowExecutionReceiptSchema = z.object({
  receiptId: UUIDSchema,
  workflowId: UUIDSchema,
  taskId: TaskIdSchema,
  leaseId: LeaseIdSchema,
  agentId: DeviceIdSchema,
  tenantId: TenantIdSchema,
  status: z.enum(['SUCCESS', 'FAILURE', 'CANCELLED']),
  completedNodes: z.array(z.string()),
  failedNodes: z.array(z.string()).default([]),
  nodeOutputs: z.record(z.record(z.unknown())).default({}),
  evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256
  errorMessage: z.string().optional(),
  completedAt: z.string().datetime(),
  signature: z.string().min(1),
});

export type WorkflowExecutionReceipt = z.infer<typeof WorkflowExecutionReceiptSchema>;

/**
 * Canonical Task Record Schema
 */
export const TaskRecordSchema = z.object({
  taskId: TaskIdSchema,
  tenantId: TenantIdSchema,
  submittedBy: z.string().min(1),
  title: z.string().min(1),
  targetAgentId: DeviceIdSchema,
  capabilityId: z.string().min(1).default('workflow.dag'),
  runtimeCategory: z.string().min(1).default('workflow'),
  parameters: z.record(z.unknown()).default({}),
  requestedScope: z.string().min(1),
  state: TaskLifecycleStateSchema,
  lease: ExecutionLeaseHeaderSchema.optional(),
  receipt: z.union([ExecutionReceiptSchema, WorkflowExecutionReceiptSchema]).optional(),
  evidenceChecksum: z.string().optional(),
  isWorkflow: z.boolean().optional(),
  dag: WorkflowDAGSchema.optional(),
  policyDecision: z
    .object({
      allowed: z.boolean(),
      reason: z.string().optional(),
      policyVersion: z.string().optional(),
      policyHash: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/**
 * Task Cancellation Request Schema
 */
export const TaskCancelRequestSchema = z.object({
  reason: z.string().optional(),
});

export type TaskCancelRequest = z.infer<typeof TaskCancelRequestSchema>;
