import {
  WorkflowNode,
  WorkflowEdge,
  validateDAGTopology,
  calculateDAGDepth,
  validatePlanSafetyLimits,
  PlanningStrategy,
} from '@nexusos/contracts';

export interface DependencyAnalysisResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  depth: number;
  nodeCount: number;
  edgeCount: number;
  strategy: PlanningStrategy;
}

export class DependencyAnalyzer {
  /**
   * Analyzes dependencies and validates topological correctness and safety limits.
   * Reuses Task 049 canonical validateDAGTopology and enforce 057-SEC-03 limits.
   */
  public analyze(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): DependencyAnalysisResult {
    // 1. Basic safety limits check (node count, edge count, timeouts, depth)
    const safetyResult = validatePlanSafetyLimits({ nodes, edges });
    if (!safetyResult.valid) {
      return {
        valid: false,
        errorCode: safetyResult.errorCode,
        errorMessage: safetyResult.errorMessage,
        depth: 0,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        strategy: 'SEQUENTIAL',
      };
    }

    // 2. Canonical DAG topology check (cycle detection via Kahn's algorithm, duplicate IDs, missing references)
    const topoResult = validateDAGTopology(nodes, edges);
    if (!topoResult.valid) {
      return {
        valid: false,
        errorCode: topoResult.errorCode,
        errorMessage: topoResult.errorMessage,
        depth: 0,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        strategy: 'SEQUENTIAL',
      };
    }

    // 3. Causal data dependency analysis (interpolation references must be predecessors)
    const causalCheck = this.validateCausalInterpolations(nodes);
    if (!causalCheck.valid) {
      return {
        valid: false,
        errorCode: causalCheck.errorCode,
        errorMessage: causalCheck.errorMessage,
        depth: 0,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        strategy: 'SEQUENTIAL',
      };
    }

    const depth = calculateDAGDepth(nodes, edges);
    const edgeKeys = new Set<string>();
    for (const e of edges) {
      edgeKeys.add(`${e.fromNodeId}->${e.toNodeId}`);
    }
    for (const n of nodes) {
      for (const d of n.dependencies || []) {
        edgeKeys.add(`${d}->${n.nodeId}`);
      }
    }
    const edgeCount = edgeKeys.size;
    const strategy = this.determineStrategy(nodes, edges);

    return {
      valid: true,
      depth,
      nodeCount: nodes.length,
      edgeCount,
      strategy,
    };
  }

  /**
   * Validates that context interpolation expressions (${{ nodes.<nodeId>.output... }})
   * only reference nodes that are declared as upstream dependencies.
   */
  private validateCausalInterpolations(nodes: WorkflowNode[]): {
    valid: boolean;
    errorCode?: string;
    errorMessage?: string;
  } {
    const ancestorsMap = this.buildAncestorsMap(nodes);

    for (const node of nodes) {
      if (!node.payload) continue;
      const referencedNodeIds = this.extractInterpolatedNodeIds(node.payload);

      const ancestors = ancestorsMap.get(node.nodeId) || new Set<string>();
      for (const refId of referencedNodeIds) {
        if (!ancestors.has(refId)) {
          return {
            valid: false,
            errorCode: 'INVALID_CAUSAL_DEPENDENCY',
            errorMessage: `Node '${node.nodeId}' interpolates output from '${refId}', but '${refId}' is not declared as a predecessor dependency.`,
          };
        }
      }
    }

    return { valid: true };
  }

  private buildAncestorsMap(nodes: WorkflowNode[]): Map<string, Set<string>> {
    const directParents = new Map<string, string[]>();
    for (const n of nodes) {
      directParents.set(n.nodeId, n.dependencies || []);
    }

    const ancestors = new Map<string, Set<string>>();

    const getAncestors = (nodeId: string, visited: Set<string>): Set<string> => {
      if (ancestors.has(nodeId)) return ancestors.get(nodeId)!;
      const set = new Set<string>();
      const parents = directParents.get(nodeId) || [];
      for (const p of parents) {
        set.add(p);
        if (!visited.has(p)) {
          visited.add(p);
          const grandParents = getAncestors(p, visited);
          for (const gp of grandParents) set.add(gp);
        }
      }
      ancestors.set(nodeId, set);
      return set;
    };

    for (const n of nodes) {
      getAncestors(n.nodeId, new Set());
    }

    return ancestors;
  }

  private extractInterpolatedNodeIds(payload: Record<string, unknown>): string[] {
    const refs: string[] = [];
    const searchString = JSON.stringify(payload);
    const regex = /\$\{\{\s*nodes\.([a-zA-Z0-9_-]+)\.output/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(searchString)) !== null) {
      refs.push(match[1]);
    }

    return refs;
  }

  private determineStrategy(nodes: WorkflowNode[], _edges: WorkflowEdge[]): PlanningStrategy {
    if (nodes.length <= 1) return 'SEQUENTIAL';

    // If any two nodes have identical dependency sets or in-degree 0 without edges between them, they can run in parallel
    const inDegreeZero = nodes.filter((n) => !n.dependencies || n.dependencies.length === 0);
    if (inDegreeZero.length > 1) {
      return 'PARALLEL';
    }

    // Check for branching (a single node has multiple children)
    const parentCount = new Map<string, number>();
    for (const n of nodes) {
      for (const dep of n.dependencies || []) {
        parentCount.set(dep, (parentCount.get(dep) || 0) + 1);
        if (parentCount.get(dep)! > 1) {
          return 'ADAPTIVE_HYBRID';
        }
      }
    }

    return 'SEQUENTIAL';
  }
}
