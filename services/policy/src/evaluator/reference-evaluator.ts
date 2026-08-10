import crypto from 'node:crypto';
import { PolicyConfig } from '../config/index.js';
import { PolicyDecisionRequest, PolicyDecisionResult, PolicyEffect } from '../domain/types.js';
import { PolicyEvaluator, PolicySnapshot, PolicyRule } from './provider-boundary.js';

export class ReferencePolicyEvaluator implements PolicyEvaluator {
  private readonly snapshot: PolicySnapshot;

  constructor(
    private readonly config: PolicyConfig,
    initialRules: PolicyRule[] = [],
  ) {
    const version = config.defaultPolicyVersion;
    const rulesJson = JSON.stringify(initialRules);
    const hash = crypto.createHash('sha256').update(`${version}:${rulesJson}`).digest('hex');

    this.snapshot = Object.freeze({
      policyVersion: version,
      policyHash: hash,
      createdAt: new Date().toISOString(),
      rules: Object.freeze([...initialRules]),
    });
  }

  getConfig(): PolicyConfig {
    return this.config;
  }

  getSnapshot(): PolicySnapshot {
    return this.snapshot;
  }

  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    const decisionId = crypto.randomUUID();
    const evaluatedAt = new Date().toISOString();
    const requestId = request.context.requestId;
    const correlationId = request.context.correlationId;

    // 1. Fail Closed: Missing Subject
    if (!request.subject) {
      return {
        decisionId,
        effect: PolicyEffect.DENY,
        allowed: false,
        policyVersion: this.snapshot.policyVersion,
        policyHash: this.snapshot.policyHash,
        reason: 'DENY: Authenticated identity context is missing.',
        evaluatedAt,
        requestId,
        correlationId,
      };
    }

    // 2. Fail Closed: Expired Authenticated Context
    const expiresAt = new Date(request.subject.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      return {
        decisionId,
        effect: PolicyEffect.DENY,
        allowed: false,
        policyVersion: this.snapshot.policyVersion,
        policyHash: this.snapshot.policyHash,
        reason: 'DENY: Authenticated identity context has expired.',
        evaluatedAt,
        requestId,
        correlationId,
      };
    }

    // 3. Fail Closed: Tenant Isolation Violation
    if (request.resource.tenantId && request.resource.tenantId !== request.subject.tenantId) {
      return {
        decisionId,
        effect: PolicyEffect.DENY,
        allowed: false,
        policyVersion: this.snapshot.policyVersion,
        policyHash: this.snapshot.policyHash,
        reason: `DENY: Cross-tenant access violation. Subject tenant '${request.subject.tenantId}' cannot access resource tenant '${request.resource.tenantId}'.`,
        evaluatedAt,
        requestId,
        correlationId,
      };
    }

    // 4. Extract Principal Credentials
    const principal = request.subject.principal;
    const roles: string[] = principal.type === 'USER' ? principal.roles || [] : [];
    const scopes: string[] = principal.type !== 'USER' ? principal.scopes || [] : [];

    // 5. Match Applicable Rule
    const matchingRule = this.snapshot.rules.find(
      (r) =>
        (r.actionName === '*' || r.actionName === request.action.actionName) &&
        (r.resourceType === '*' || r.resourceType === request.resource.resourceType),
    );

    if (!matchingRule) {
      return {
        decisionId,
        effect: PolicyEffect.DENY,
        allowed: false,
        policyVersion: this.snapshot.policyVersion,
        policyHash: this.snapshot.policyHash,
        reason: `DENY: No matching policy rule for action '${request.action.actionName}' on resource '${request.resource.resourceType}'.`,
        evaluatedAt,
        requestId,
        correlationId,
      };
    }

    // 6. Verify Role / Scope Requirements
    const requiredRole = request.action.requiredRole || matchingRule.requiredRole;
    if (requiredRole && !roles.includes(requiredRole)) {
      return {
        decisionId,
        effect: PolicyEffect.DENY,
        allowed: false,
        policyVersion: this.snapshot.policyVersion,
        policyHash: this.snapshot.policyHash,
        reason: `DENY: Subject lacks required role '${requiredRole}'.`,
        evaluatedAt,
        requestId,
        correlationId,
      };
    }

    const requiredScope = request.action.requiredScope || matchingRule.requiredScope;
    if (
      this.config.enforceStrictScopeMatching &&
      requiredScope &&
      !scopes.includes(requiredScope)
    ) {
      return {
        decisionId,
        effect: PolicyEffect.DENY,
        allowed: false,
        policyVersion: this.snapshot.policyVersion,
        policyHash: this.snapshot.policyHash,
        reason: `DENY: Subject lacks required scope '${requiredScope}'.`,
        evaluatedAt,
        requestId,
        correlationId,
      };
    }

    // 7. Decision Result
    const isAllow = matchingRule.effect === PolicyEffect.ALLOW;
    return {
      decisionId,
      effect: matchingRule.effect,
      allowed: isAllow,
      policyVersion: this.snapshot.policyVersion,
      policyHash: this.snapshot.policyHash,
      reason: isAllow
        ? `ALLOW: Action '${request.action.actionName}' permitted by policy rule '${matchingRule.ruleId}'.`
        : `DENY: Action '${request.action.actionName}' denied by policy rule '${matchingRule.ruleId}'.`,
      evaluatedAt,
      requestId,
      correlationId,
    };
  }
}
