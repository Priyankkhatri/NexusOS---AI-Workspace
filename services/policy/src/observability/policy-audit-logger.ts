import { Logger } from '@nexusos/backend';
import { DecisionEvidence } from '../domain/evidence.js';

export class PolicyAuditLogger {
  constructor(private readonly logger: Logger) {}

  logDecision(evidence: DecisionEvidence): void {
    const level = evidence.effect === 'ALLOW' ? 'info' : 'warn';
    this.logger[level](
      `Policy decision evaluated: ${evidence.effect} [${evidence.actionName} on ${evidence.resourceType}:${evidence.resourceId}]`,
      {
        requestId: evidence.requestId,
        correlationId: evidence.correlationId,
        details: {
          evidenceId: evidence.evidenceId,
          decisionId: evidence.decisionId,
          effect: evidence.effect,
          principalId: evidence.principalId,
          principalType: evidence.principalType,
          tenantId: evidence.tenantId,
          actionName: evidence.actionName,
          resourceType: evidence.resourceType,
          resourceId: evidence.resourceId,
          policyVersion: evidence.policyVersion,
          policyHash: evidence.policyHash,
          reason: evidence.reason,
          event: 'POLICY_DECISION',
        },
      },
    );
  }
}
