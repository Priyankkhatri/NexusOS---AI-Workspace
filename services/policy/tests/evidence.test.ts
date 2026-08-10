import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createAuthenticatedContext, PrincipalType, UserIdentity } from '@nexusos/identity';
import {
  createDecisionEvidence,
  PolicyEffect,
  PolicyDecisionResult,
  PolicyDecisionRequest,
} from '../src/index.js';

describe('Decision Evidence Boundary & Traceability', () => {
  it('creates decision evidence record matching decision result', () => {
    const tenantId = crypto.randomUUID();
    const user: UserIdentity = {
      type: PrincipalType.USER,
      userId: crypto.randomUUID(),
      tenantId,
      email: 'operator@nexusos.internal',
      roles: ['operator'],
    };
    const subject = createAuthenticatedContext(
      user,
      new Date(),
      new Date(Date.now() + 3600000),
      'raw-token',
    );

    const request: PolicyDecisionRequest = {
      subject,
      action: { actionName: 'resource:write' },
      resource: { resourceType: 'database-table', resourceId: 'table-1', tenantId },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    };

    const result: PolicyDecisionResult = {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: 'v1.0.0-sprint0',
      policyHash: 'sample_sha256_hash_value',
      reason: 'ALLOW: Action permitted.',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };

    const evidence = createDecisionEvidence(request, result);

    assert.ok(evidence.evidenceId);
    assert.strictEqual(evidence.decisionId, result.decisionId);
    assert.strictEqual(evidence.principalId, user.userId);
    assert.strictEqual(evidence.principalType, 'USER');
    assert.strictEqual(evidence.tenantId, tenantId);
    assert.strictEqual(evidence.actionName, 'resource:write');
    assert.strictEqual(evidence.policyVersion, 'v1.0.0-sprint0');
  });
});
