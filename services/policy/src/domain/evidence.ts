import { PolicyDecisionResult, PolicyDecisionRequest } from './types.js';
import crypto from 'node:crypto';

export interface DecisionEvidence {
  evidenceId: string;
  decisionId: string;
  effect: string;
  principalId: string;
  principalType: string;
  tenantId: string;
  actionName: string;
  resourceType: string;
  resourceId: string;
  policyVersion: string;
  policyHash: string;
  requestId: string;
  correlationId: string;
  timestamp: string;
  reason: string;
}

export function createDecisionEvidence(
  request: PolicyDecisionRequest,
  result: PolicyDecisionResult,
): DecisionEvidence {
  const principalId = request.subject
    ? request.subject.principal.type === 'USER'
      ? request.subject.principal.userId
      : request.subject.principal.type === 'SERVICE'
        ? request.subject.principal.serviceId
        : request.subject.principal.deviceId
    : 'UNAUTHENTICATED';
  const principalType = request.subject ? request.subject.principal.type : 'NONE';
  const tenantId = request.subject ? request.subject.tenantId : 'NONE';

  return {
    evidenceId: crypto.randomUUID(),
    decisionId: result.decisionId,
    effect: result.effect,
    principalId,
    principalType,
    tenantId,
    actionName: request.action.actionName,
    resourceType: request.resource.resourceType,
    resourceId: request.resource.resourceId,
    policyVersion: result.policyVersion,
    policyHash: result.policyHash,
    requestId: result.requestId,
    correlationId: result.correlationId,
    timestamp: result.evaluatedAt,
    reason: result.reason,
  };
}
