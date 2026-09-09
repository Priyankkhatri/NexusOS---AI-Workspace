import crypto from 'node:crypto';
import {
  AdaptiveReplanRequest,
  AdaptiveReplanResponse,
  WorkflowNode,
  PLANNER_SAFETY_LIMITS,
  PlanRiskTier,
  ReplanStrategy,
} from '@nexusos/contracts';
import { ICapabilityRegistryBoundary } from './types.js';

export class ReplanCoordinator {
  constructor(private readonly capabilityRegistry: ICapabilityRegistryBoundary) {}

  /**
   * Generates a new, immutable successor graph proposal (057-SEC-05).
   * Enforces hard 3-iteration maximum limit and preserves sealed completed node receipts.
   */
  public coordinateReplan(request: AdaptiveReplanRequest): AdaptiveReplanResponse {
    // 1. Hard maximum limit on replanning iterations (057-SEC-03 & 057-SEC-05)
    if (request.replanIteration > PLANNER_SAFETY_LIMITS.MAX_REPLAN_ITERATIONS) {
      throw new Error(
        `EXCEEDS_MAX_REPLAN_ITERATIONS: Maximum replan iterations (${PLANNER_SAFETY_LIMITS.MAX_REPLAN_ITERATIONS}) exceeded for task '${request.taskId}'. Terminal failure recorded.`,
      );
    }

    if (request.isTerminalFailure) {
      throw new Error(
        `TERMINAL_FAILURE_NO_REPLAN: Node '${request.failedNodeId}' encountered an unrecoverable terminal error: ${request.failureReason}`,
      );
    }

    const successorVersion = request.priorVersion + 1;
    const successorWorkflowId = crypto.randomUUID();
    const now = new Date().toISOString();

    // 2. Identify completed nodes to preserve and seal
    const completedSet = new Set(request.completedNodes);

    // 3. Inspect failure classification (distinguish FAILED vs UNKNOWN / NEEDS_RECONCILIATION)
    const isAmbiguousOutcome = this.isUnknownOutcome(request.failureReason);
    let chosenStrategy: ReplanStrategy = request.preferredStrategy;
    let rationale = '';

    if (isAmbiguousOutcome) {
      chosenStrategy = 'FAIL_AND_COMPENSATE';
      rationale = `NEEDS_RECONCILIATION: Execution outcome of '${request.failedNodeId}' is ambiguous. Non-idempotent mutation retry is blocked pending state reconciliation.`;
    }

    // 4. Synthesize successor nodes
    const successorNodes: WorkflowNode[] = [];
    const compensationNodes: WorkflowNode[] = [];

    if (chosenStrategy === 'FAIL_AND_COMPENSATE') {
      // Create compensation plan
      const failedNode = request.originalDAG.nodes.find((n) => n.nodeId === request.failedNodeId);
      if (failedNode?.compensationPayload) {
        compensationNodes.push({
          nodeId: `compensate-${request.failedNodeId}`,
          capabilityId: failedNode.capabilityId,
          runtimeCategory: failedNode.runtimeCategory,
          payload: failedNode.compensationPayload,
          timeoutMs: 10000,
        });
      }
      rationale += ` Compensating actions generated for rollback.`;
    } else {
      // Normal replan: keep unexecuted nodes, adapt failed node or remaining branch
      const unexecuted = request.originalDAG.nodes.filter(
        (n) => !completedSet.has(n.nodeId) && n.nodeId !== request.failedNodeId,
      );

      const failedNode = request.originalDAG.nodes.find((n) => n.nodeId === request.failedNodeId);
      const adaptedNode = this.adaptFailedNode(failedNode, request.failureReason);

      if (adaptedNode) {
        successorNodes.push(adaptedNode);
      }

      // Re-link remaining unexecuted nodes to the adapted node
      for (const node of unexecuted) {
        const newDependencies = (node.dependencies || []).map((dep) =>
          dep === request.failedNodeId && adaptedNode ? adaptedNode.nodeId : dep,
        );
        successorNodes.push({
          ...node,
          dependencies: newDependencies,
        });
      }

      rationale = `Adapted failed node '${request.failedNodeId}' to '${adaptedNode?.nodeId || 'alternative'}' with preserved completed steps: [${request.completedNodes.join(', ')}].`;
    }

    // If no successor nodes were generated and not compensating, insert a fallback diagnosis node
    if (successorNodes.length === 0 && compensationNodes.length === 0) {
      successorNodes.push({
        nodeId: `diagnose-${request.failedNodeId}-v${successorVersion}`,
        capabilityId: 'filesystem.listDirectory',
        runtimeCategory: 'filesystem',
        payload: { path: '.' },
        timeoutMs: 10000,
      });
      rationale += ' Inserted diagnostic node to inspect current workspace state.';
    }

    // 5. Evaluate risk tier of successor graph
    const allCandidateNodes = [...successorNodes, ...compensationNodes];
    let maxRisk: PlanRiskTier = 'LOW';
    let requiresApproval = false;

    for (const n of allCandidateNodes) {
      const tier = this.capabilityRegistry.getRiskTier(n.capabilityId);
      if (tier === 'HIGH' || tier === 'CRITICAL') {
        maxRisk = tier;
        requiresApproval = true;
      } else if (tier === 'MEDIUM' && maxRisk === 'LOW') {
        maxRisk = 'MEDIUM';
      }
    }

    const successorDAG = {
      title: `Replan v${successorVersion}: ${request.originalDAG.title}`,
      targetAgentId: request.originalDAG.targetAgentId,
      nodes: successorNodes.length > 0 ? successorNodes : compensationNodes,
      requestedScope: Array.from(new Set(allCandidateNodes.map((n) => n.capabilityId))).join(','),
      metadata: {
        replanVersion: String(successorVersion),
        priorWorkflowId: request.originalWorkflowId,
        replanIteration: String(request.replanIteration),
      },
    };

    return {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      successorWorkflowId,
      taskId: request.taskId,
      priorWorkflowId: request.originalWorkflowId,
      version: successorVersion,
      replanIteration: request.replanIteration,
      strategy: chosenStrategy,
      replanRationale: rationale,
      successorDAG,
      preservedCompletedNodes: request.completedNodes,
      compensationNodes: compensationNodes.length > 0 ? compensationNodes : undefined,
      estimatedRiskTier: maxRisk,
      requiresHumanApproval: requiresApproval,
      approvalReason: requiresApproval
        ? `Successor graph contains ${maxRisk} risk operations.`
        : undefined,
      createdAt: now,
      status: 'PROPOSED',
    };
  }

  private isUnknownOutcome(reason: string): boolean {
    const lower = reason.toLowerCase();
    return (
      lower.includes('unknown') ||
      lower.includes('timed out') ||
      lower.includes('unconfirmed') ||
      lower.includes('ambiguous outcome') ||
      lower.includes('network partition') ||
      lower.includes('abrupt disconnect')
    );
  }

  private adaptFailedNode(
    failedNode: WorkflowNode | undefined,
    failureReason: string,
  ): WorkflowNode | null {
    if (!failedNode) return null;

    const lower = failureReason.toLowerCase();
    const newId = `${failedNode.nodeId}-retry`;

    // If file was not found during readFile, substitute with searchFiles or listDirectory
    if (
      failedNode.capabilityId === 'filesystem.readFile' &&
      (lower.includes('not found') || lower.includes('enoent'))
    ) {
      return {
        nodeId: `${failedNode.nodeId}-search-fallback`,
        capabilityId: 'filesystem.searchFiles',
        runtimeCategory: 'filesystem',
        payload: { pattern: '*.*' },
        dependencies: failedNode.dependencies,
        timeoutMs: failedNode.timeoutMs || 30000,
      };
    }

    // If browser navigation failed, retry with screenshot/inspection
    if (failedNode.capabilityId === 'browser.navigate' && lower.includes('timeout')) {
      return {
        nodeId: `${failedNode.nodeId}-retry-nav`,
        capabilityId: 'browser.navigate',
        runtimeCategory: 'browser',
        payload: { ...failedNode.payload, retry: true },
        dependencies: failedNode.dependencies,
        timeoutMs: Math.min((failedNode.timeoutMs || 30000) * 2, 60000),
      };
    }

    // Default: safe retry with increased timeout
    return {
      ...failedNode,
      nodeId: newId,
      timeoutMs: Math.min((failedNode.timeoutMs || 10000) + 5000, 60000),
    };
  }
}
