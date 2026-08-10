import { PolicyDecisionRequest, PolicyDecisionResult, PolicyEffect } from '../domain/types.js';

export interface PolicyRule {
  ruleId: string;
  actionName: string;
  resourceType: string;
  requiredRole?: string;
  requiredScope?: string;
  effect: PolicyEffect;
}

export interface PolicySnapshot {
  policyVersion: string;
  policyHash: string;
  createdAt: string;
  rules: readonly PolicyRule[];
}

export interface PolicyEvaluator {
  evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult>;
  getSnapshot(): PolicySnapshot;
}
