import { WorkflowDAG, WorkflowNode } from './types.js';

export interface DAGValidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  topologicalOrder?: string[];
  executionTiers?: string[][]; // Groups of nodes that can be executed in parallel
}

export class WorkflowDAGParser {
  private readonly maxNodesPerWorkflow: number;

  constructor(maxNodesPerWorkflow: number = 50) {
    this.maxNodesPerWorkflow = maxNodesPerWorkflow;
  }

  public parseAndValidate(dag: WorkflowDAG): DAGValidationResult {
    // 1. Structure Check
    if (!dag || typeof dag !== 'object') {
      return {
        valid: false,
        errorCode: 'INVALID_DAG_STRUCTURE',
        errorMessage: 'Workflow DAG must be a non-null object.',
      };
    }

    if (!dag.workflowId || typeof dag.workflowId !== 'string') {
      return {
        valid: false,
        errorCode: 'INVALID_WORKFLOW_ID',
        errorMessage: 'Workflow DAG must contain a valid workflowId string.',
      };
    }

    if (!dag.nodes || !Array.isArray(dag.nodes)) {
      return {
        valid: false,
        errorCode: 'MISSING_NODES',
        errorMessage: 'Workflow DAG must contain a nodes array.',
      };
    }

    // 2. Node Count Boundary (Max 50 nodes)
    if (dag.nodes.length === 0) {
      return {
        valid: false,
        errorCode: 'EMPTY_WORKFLOW',
        errorMessage: 'Workflow DAG must contain at least one node.',
      };
    }

    if (dag.nodes.length > this.maxNodesPerWorkflow) {
      return {
        valid: false,
        errorCode: 'DAG_TOO_LARGE',
        errorMessage: `Workflow DAG node count (${dag.nodes.length}) exceeds maximum limit (${this.maxNodesPerWorkflow}).`,
      };
    }

    // 3. Node ID Uniqueness & Schema Validation
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of dag.nodes) {
      if (!node.nodeId || typeof node.nodeId !== 'string') {
        return {
          valid: false,
          errorCode: 'INVALID_NODE_ID',
          errorMessage: 'Workflow node must contain a non-empty nodeId string.',
        };
      }

      if (nodeMap.has(node.nodeId)) {
        return {
          valid: false,
          errorCode: 'DUPLICATE_NODE_ID',
          errorMessage: `Duplicate nodeId '${node.nodeId}' found in workflow DAG.`,
        };
      }

      if (!node.capabilityId || typeof node.capabilityId !== 'string') {
        return {
          valid: false,
          errorCode: 'INVALID_CAPABILITY_ID',
          errorMessage: `Node '${node.nodeId}' must contain a valid capabilityId.`,
        };
      }

      nodeMap.set(node.nodeId, node);
    }

    // 4. Dependency Graph Construction & Edge Validation
    const adjacencyList = new Map<string, string[]>(); // parent -> children
    const inDegree = new Map<string, number>();

    for (const nodeId of nodeMap.keys()) {
      adjacencyList.set(nodeId, []);
      inDegree.set(nodeId, 0);
    }

    // Process explicit dependencies array in nodes
    for (const node of dag.nodes) {
      if (node.dependencies && Array.isArray(node.dependencies)) {
        for (const depId of node.dependencies) {
          if (!nodeMap.has(depId)) {
            return {
              valid: false,
              errorCode: 'INVALID_NODE_DEPENDENCY',
              errorMessage: `Node '${node.nodeId}' references non-existent dependency '${depId}'.`,
            };
          }
          if (depId === node.nodeId) {
            return {
              valid: false,
              errorCode: 'DAG_CYCLE_DETECTED',
              errorMessage: `Self-referencing dependency cycle detected on node '${node.nodeId}'.`,
            };
          }
          adjacencyList.get(depId)!.push(node.nodeId);
          inDegree.set(node.nodeId, (inDegree.get(node.nodeId) || 0) + 1);
        }
      }
    }

    // Process optional explicit edges array
    if (dag.edges && Array.isArray(dag.edges)) {
      for (const edge of dag.edges) {
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
            errorMessage: `Self-referencing edge cycle detected on node '${edge.fromNodeId}'.`,
          };
        }
        adjacencyList.get(edge.fromNodeId)!.push(edge.toNodeId);
        inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
      }
    }

    // 5. Kahn's Algorithm for Topological Sort & Cycle Detection
    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }

    const topologicalOrder: string[] = [];
    const executionTiers: string[][] = [];

    while (queue.length > 0) {
      // All nodes in the current queue layer have in-degree 0 and can execute in parallel
      const currentTier = [...queue];
      executionTiers.push(currentTier);

      const nextQueue: string[] = [];

      for (const current of currentTier) {
        topologicalOrder.push(current);
        const children = adjacencyList.get(current) || [];

        for (const child of children) {
          const newDeg = (inDegree.get(child) || 0) - 1;
          inDegree.set(child, newDeg);
          if (newDeg === 0) {
            nextQueue.push(child);
          }
        }
      }

      queue.length = 0;
      queue.push(...nextQueue);
    }

    if (topologicalOrder.length !== dag.nodes.length) {
      return {
        valid: false,
        errorCode: 'DAG_CYCLE_DETECTED',
        errorMessage: 'Circular dependency cycle detected in workflow DAG.',
      };
    }

    return {
      valid: true,
      topologicalOrder,
      executionTiers,
    };
  }
}
