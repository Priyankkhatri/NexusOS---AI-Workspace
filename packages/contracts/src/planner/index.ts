import { z } from 'zod';
import { UUIDSchema, TaskIdSchema, TenantIdSchema, DeviceIdSchema } from '../identity/index.js';
import {
  TaskGraphCreateRequestSchema,
  WorkflowNodeSchema,
  validateDAGTopology,
} from '../tasks/index.js';

/**
 * Hard safety and complexity limits as established by authoritative architecture (057-SEC-03).
 */
export const PLANNER_SAFETY_LIMITS = {
  MAX_NODES: 50,
  MAX_EDGES: 100,
  MAX_DEPTH: 10,
  MAX_TIMEOUT_SECONDS: 300,
  MAX_TIMEOUT_MS: 300000,
  MAX_REPLAN_ITERATIONS: 3,
} as const;

/**
 * Planning Strategy Enum
 */
export const PlanningStrategySchema = z.enum(['SEQUENTIAL', 'PARALLEL', 'ADAPTIVE_HYBRID']);
export type PlanningStrategy = z.infer<typeof PlanningStrategySchema>;

/**
 * Plan Risk Tier Enum
 */
export const PlanRiskTierSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type PlanRiskTier = z.infer<typeof PlanRiskTierSchema>;

/**
 * Adaptive Replan Strategy Enum
 */
export const ReplanStrategySchema = z.enum([
  'RETRY_NODE_WITH_BACKOFF',
  'SUBSTITUTE_CAPABILITY',
  'REPLAN_REMAINING_NODES',
  'FAIL_AND_COMPENSATE',
]);
export type ReplanStrategy = z.infer<typeof ReplanStrategySchema>;

/**
 * Operational Planning Constraints Schema
 */
export const PlanningConstraintsSchema = z.object({
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS)
    .default(PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS),
  maxNodes: z
    .number()
    .int()
    .positive()
    .max(PLANNER_SAFETY_LIMITS.MAX_NODES)
    .default(PLANNER_SAFETY_LIMITS.MAX_NODES),
  allowedCategories: z.array(z.string().min(1)).optional(),
  forbiddenCapabilities: z.array(z.string().min(1)).optional(),
  requireHumanApprovalAbove: PlanRiskTierSchema.default('MEDIUM'),
  budgetLimitUsd: z.number().positive().optional(),
});
export type PlanningConstraints = z.infer<typeof PlanningConstraintsSchema>;

/**
 * High-Level Goal Decomposition Request Schema
 */
export const GoalDecompositionRequestSchema = z.object({
  goal: z.string().min(1).max(4096),
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema,
  targetAgentId: DeviceIdSchema,
  submittedBy: z.string().min(1).max(256),
  correlationId: z.string().optional(),
  deliverables: z.array(z.string().min(1).max(256)).optional(),
  constraints: PlanningConstraintsSchema.optional().default({}),
  contextReferences: z.array(z.string().min(1)).max(20).optional().default([]),
  parameters: z.record(z.unknown()).optional().default({}),
});
export type GoalDecompositionRequest = z.infer<typeof GoalDecompositionRequestSchema>;
export type GoalDecompositionRequestInput = z.input<typeof GoalDecompositionRequestSchema>;

/**
 * Candidate Plan Proposal Response Schema
 * Represents an untrusted, un-leased DAG proposal that MUST be evaluated by policy and lease boundaries.
 */
export const GoalDecompositionResponseSchema = z.object({
  planId: UUIDSchema,
  normalizedGoal: z.string().min(1),
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema,
  strategy: PlanningStrategySchema,
  dag: TaskGraphCreateRequestSchema,
  rationale: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string().min(1)),
  estimatedRiskTier: PlanRiskTierSchema,
  requiresHumanApproval: z.boolean().default(false),
  approvalReason: z.string().optional(),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  plannerVersion: z.string().min(1).default('1.0.0'),
  depth: z.number().int().nonnegative().max(PLANNER_SAFETY_LIMITS.MAX_DEPTH),
  nodeCount: z.number().int().positive().max(PLANNER_SAFETY_LIMITS.MAX_NODES),
  edgeCount: z.number().int().nonnegative().max(PLANNER_SAFETY_LIMITS.MAX_EDGES),
  createdAt: z.string().datetime(),
  status: z.literal('PROPOSED').default('PROPOSED'),
});
export type GoalDecompositionResponse = z.infer<typeof GoalDecompositionResponseSchema>;
export type GoalDecompositionResponseInput = z.input<typeof GoalDecompositionResponseSchema>;

/**
 * Adaptive Replan Request Schema
 */
export const AdaptiveReplanRequestSchema = z.object({
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema.optional(),
  taskId: TaskIdSchema,
  originalWorkflowId: UUIDSchema,
  priorVersion: z.number().int().positive().default(1),
  replanIteration: z.number().int().positive().max(PLANNER_SAFETY_LIMITS.MAX_REPLAN_ITERATIONS),
  failedNodeId: z.string().min(1).max(64),
  failureReason: z.string().min(1).max(2048),
  failureEvidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256
  isTerminalFailure: z.boolean().default(false),
  completedNodes: z.array(z.string().min(1)).default([]),
  completedNodeOutputs: z.record(z.record(z.unknown())).default({}),
  originalDAG: TaskGraphCreateRequestSchema,
  preferredStrategy: ReplanStrategySchema.default('REPLAN_REMAINING_NODES'),
});
export type AdaptiveReplanRequest = z.infer<typeof AdaptiveReplanRequestSchema>;
export type AdaptiveReplanRequestInput = z.input<typeof AdaptiveReplanRequestSchema>;

/**
 * Adaptive Replan Response Schema
 */
export const AdaptiveReplanResponseSchema = z.object({
  tenantId: TenantIdSchema,
  workspaceId: UUIDSchema.optional(),
  successorWorkflowId: UUIDSchema,
  taskId: TaskIdSchema,
  priorWorkflowId: UUIDSchema,
  version: z.number().int().positive(),
  replanIteration: z.number().int().positive().max(PLANNER_SAFETY_LIMITS.MAX_REPLAN_ITERATIONS),
  strategy: ReplanStrategySchema,
  replanRationale: z.string().min(1),
  successorDAG: TaskGraphCreateRequestSchema,
  preservedCompletedNodes: z.array(z.string().min(1)),
  compensationNodes: z.array(WorkflowNodeSchema).optional(),
  estimatedRiskTier: PlanRiskTierSchema,
  requiresHumanApproval: z.boolean().default(false),
  approvalReason: z.string().optional(),
  createdAt: z.string().datetime(),
  status: z.literal('PROPOSED').default('PROPOSED'),
});
export type AdaptiveReplanResponse = z.infer<typeof AdaptiveReplanResponseSchema>;
export type AdaptiveReplanResponseInput = z.input<typeof AdaptiveReplanResponseSchema>;

/**
 * Structured Ambiguous Goal Error Schema
 */
export const AmbiguousGoalDetailsSchema = z.object({
  code: z.literal('AMBIGUOUS_GOAL'),
  message: z.string(),
  missingDeliverables: z.array(z.string()).optional(),
  clarificationPrompts: z.array(z.string()).optional(),
  suggestedAlternatives: z.array(z.string()).optional(),
});
export type AmbiguousGoalDetails = z.infer<typeof AmbiguousGoalDetailsSchema>;

/**
 * Computes maximum depth of a DAG given its nodes and explicit/implicit edges.
 * Depth is the length of the longest path from any root node (in-degree 0) to any leaf.
 */
export function calculateDAGDepth(
  nodes: { nodeId: string; dependencies?: string[] }[],
  edges: { fromNodeId: string; toNodeId: string }[] = [],
): number {
  if (!nodes || nodes.length === 0) return 0;

  const nodeSet = new Set(nodes.map((n) => n.nodeId));
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adjacencyList.set(n.nodeId, []);
    inDegree.set(n.nodeId, 0);
  }

  // Add dependency edges
  for (const n of nodes) {
    if (n.dependencies) {
      for (const parentId of n.dependencies) {
        if (nodeSet.has(parentId) && parentId !== n.nodeId) {
          adjacencyList.get(parentId)!.push(n.nodeId);
          inDegree.set(n.nodeId, (inDegree.get(n.nodeId) || 0) + 1);
        }
      }
    }
  }

  // Add explicit edges
  for (const e of edges) {
    if (nodeSet.has(e.fromNodeId) && nodeSet.has(e.toNodeId) && e.fromNodeId !== e.toNodeId) {
      adjacencyList.get(e.fromNodeId)!.push(e.toNodeId);
      inDegree.set(e.toNodeId, (inDegree.get(e.toNodeId) || 0) + 1);
    }
  }

  // Topological processing to find longest path
  const distances = new Map<string, number>();
  const queue: string[] = [];

  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
      distances.set(nodeId, 1);
    } else {
      distances.set(nodeId, 0);
    }
  }

  let maxDepth = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currDist = distances.get(curr) || 1;
    if (currDist > maxDepth) {
      maxDepth = currDist;
    }

    const children = adjacencyList.get(curr) || [];
    for (const child of children) {
      const existingDist = distances.get(child) || 0;
      if (currDist + 1 > existingDist) {
        distances.set(child, currDist + 1);
      }
      const newDeg = (inDegree.get(child) || 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) {
        queue.push(child);
      }
    }
  }

  return maxDepth;
}

/**
 * Validates graph against safety limits (057-SEC-03).
 */
export function validatePlanSafetyLimits(dag: {
  nodes: { nodeId: string; timeoutMs?: number; dependencies?: string[] }[];
  edges?: { fromNodeId: string; toNodeId: string }[];
}): { valid: boolean; errorCode?: string; errorMessage?: string } {
  if (dag.nodes.length > PLANNER_SAFETY_LIMITS.MAX_NODES) {
    return {
      valid: false,
      errorCode: 'EXCEEDS_MAX_NODES',
      errorMessage: `Graph node count (${dag.nodes.length}) exceeds maximum limit (${PLANNER_SAFETY_LIMITS.MAX_NODES}).`,
    };
  }

  const edgeKeys = new Set<string>();
  if (dag.edges) {
    for (const e of dag.edges) {
      edgeKeys.add(`${e.fromNodeId}->${e.toNodeId}`);
    }
  }
  for (const n of dag.nodes) {
    for (const d of n.dependencies || []) {
      edgeKeys.add(`${d}->${n.nodeId}`);
    }
  }
  const edgeCount = edgeKeys.size;
  if (edgeCount > PLANNER_SAFETY_LIMITS.MAX_EDGES) {
    return {
      valid: false,
      errorCode: 'EXCEEDS_MAX_EDGES',
      errorMessage: `Graph edge count (${edgeCount}) exceeds maximum limit (${PLANNER_SAFETY_LIMITS.MAX_EDGES}).`,
    };
  }

  for (const node of dag.nodes) {
    if (node.timeoutMs && node.timeoutMs > PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS) {
      return {
        valid: false,
        errorCode: 'EXCEEDS_MAX_TIMEOUT',
        errorMessage: `Node '${node.nodeId}' timeout (${node.timeoutMs}ms) exceeds maximum limit (${PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS}ms).`,
      };
    }
  }

  const depth = calculateDAGDepth(dag.nodes, dag.edges);
  if (depth > PLANNER_SAFETY_LIMITS.MAX_DEPTH) {
    return {
      valid: false,
      errorCode: 'EXCEEDS_MAX_DEPTH',
      errorMessage: `Graph dependency depth (${depth}) exceeds maximum limit (${PLANNER_SAFETY_LIMITS.MAX_DEPTH}).`,
    };
  }

  // Also reuse canonical DAG topology check
  const topo = validateDAGTopology(dag.nodes as WorkflowNode[], dag.edges);
  if (!topo.valid) {
    return topo;
  }

  return { valid: true };
}
