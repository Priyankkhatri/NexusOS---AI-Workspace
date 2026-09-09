import crypto from 'node:crypto';
import {
  GoalDecompositionRequest,
  GoalDecompositionResponse,
  PlanRiskTier,
} from '@nexusos/contracts';
import { NormalizedGoal, ICapabilityRegistryBoundary } from './types.js';
import { DecompositionResult } from './decomposer.js';
import { DependencyAnalysisResult } from './dependency-analyzer.js';

export class PlanSynthesizer {
  constructor(private readonly capabilityRegistry: ICapabilityRegistryBoundary) {}

  /**
   * Synthesizes the validated components into a canonical GoalDecompositionResponse proposal.
   * Plan remains strictly PROPOSED and is NOT executable without policy and lease authorization (057-SEC-01).
   */
  public synthesize(
    request: GoalDecompositionRequest,
    normalizedGoal: NormalizedGoal,
    decomposition: DecompositionResult,
    analysis: DependencyAnalysisResult,
  ): GoalDecompositionResponse {
    const planId = crypto.randomUUID();
    const now = new Date().toISOString();

    // 057-SEC-04: Capability Hallucination Defense — verify all proposed capabilities are registered
    for (const node of decomposition.nodes) {
      if (!this.capabilityRegistry.isRegistered(node.capabilityId)) {
        throw new Error(
          `UNREGISTERED_CAPABILITY: Proposed capability '${node.capabilityId}' is not registered in authoritative capability registry (057-SEC-04).`,
        );
      }
    }

    // 1. Calculate overall risk tier
    const estimatedRiskTier = this.calculateGraphRiskTier(decomposition.nodes);

    // 2. Check if human approval is required (Task 052 HITL integration)
    const { requiresHumanApproval, approvalReason } = this.evaluateApprovalRequirement(
      decomposition.nodes,
      estimatedRiskTier,
      normalizedGoal.constraints.requireHumanApprovalAbove || 'MEDIUM',
    );

    // 3. Build executable DAG manifest for TaskGraphCreateRequestSchema
    const requiredCapabilities = Array.from(
      new Set(decomposition.nodes.map((n) => n.capabilityId)),
    );

    const dag = {
      title: `Plan: ${normalizedGoal.normalizedObjective.slice(0, 128)}`,
      targetAgentId: request.targetAgentId,
      nodes: decomposition.nodes,
      requestedScope: requiredCapabilities.join(','),
      metadata: {
        planId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        strategy: analysis.strategy,
        riskTier: estimatedRiskTier,
        requiresHumanApproval: String(requiresHumanApproval),
      },
    };

    return {
      planId,
      normalizedGoal: normalizedGoal.normalizedObjective,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      strategy: analysis.strategy,
      dag,
      rationale: decomposition.rationale,
      assumptions: decomposition.assumptions,
      requiredCapabilities,
      estimatedRiskTier,
      requiresHumanApproval,
      approvalReason,
      confidence: 1.0,
      plannerVersion: '1.0.0',
      depth: analysis.depth,
      nodeCount: analysis.nodeCount,
      edgeCount: analysis.edgeCount,
      createdAt: now,
      status: 'PROPOSED',
    };
  }

  private calculateGraphRiskTier(nodes: { capabilityId: string }[]): PlanRiskTier {
    const riskScores: Record<PlanRiskTier, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };

    let maxScore = 1;
    let maxTier: PlanRiskTier = 'LOW';

    for (const node of nodes) {
      const tier = this.capabilityRegistry.getRiskTier(node.capabilityId);
      const score = riskScores[tier] || 1;
      if (score > maxScore) {
        maxScore = score;
        maxTier = tier;
      }
    }

    return maxTier;
  }

  private evaluateApprovalRequirement(
    nodes: { capabilityId: string; nodeId: string }[],
    graphTier: PlanRiskTier,
    threshold: PlanRiskTier,
  ): { requiresHumanApproval: boolean; approvalReason?: string } {
    const riskScores: Record<PlanRiskTier, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };

    const highRiskCapabilities = new Set([
      'terminal.execute',
      'device.execute',
      'filesystem.deleteFile',
    ]);

    const matchingHighRisk = nodes.filter((n) => highRiskCapabilities.has(n.capabilityId));
    if (matchingHighRisk.length > 0) {
      const capList = matchingHighRisk.map((n) => `${n.capabilityId} on '${n.nodeId}'`).join(', ');
      return {
        requiresHumanApproval: true,
        approvalReason: `Plan contains high-risk operations: ${capList}.`,
      };
    }

    if (riskScores[graphTier] >= riskScores[threshold]) {
      return {
        requiresHumanApproval: true,
        approvalReason: `Graph risk tier (${graphTier}) meets or exceeds configured human approval threshold (${threshold}).`,
      };
    }

    return { requiresHumanApproval: false };
  }
}
