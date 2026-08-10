import { AuthenticatedContext } from '@nexusos/identity';
import { TenantId } from '@nexusos/contracts';

export enum PolicyEffect {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
}

export interface PolicySubject {
  authenticatedContext: AuthenticatedContext;
  principalId: string;
  tenantId: TenantId;
  roles: string[];
  scopes: string[];
}

export interface PolicyResource {
  resourceType: string;
  resourceId: string;
  tenantId?: TenantId;
  attributes?: Record<string, unknown>;
}

export interface PolicyAction {
  actionName: string;
  requiredScope?: string;
  requiredRole?: string;
}

export interface PolicyEvaluationContext {
  requestId: string;
  correlationId: string;
  environmentTier?: string;
  clientIp?: string;
  requestTimestamp: string;
}

export interface PolicyDecisionRequest {
  subject?: AuthenticatedContext;
  action: PolicyAction;
  resource: PolicyResource;
  context: PolicyEvaluationContext;
  requestedPolicyVersion?: string;
}

export interface PolicyDecisionResult {
  decisionId: string;
  effect: PolicyEffect;
  allowed: boolean;
  policyVersion: string;
  policyHash: string;
  reason: string;
  evaluatedAt: string;
  requestId: string;
  correlationId: string;
}
