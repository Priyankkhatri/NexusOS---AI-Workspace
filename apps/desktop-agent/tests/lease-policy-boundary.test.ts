import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { ExecutionLeaseBoundary } from '../src/index.js';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';

/**
 * A stub PolicyEvaluator that always ALLOWs, for testing the lease boundary in isolation
 */
class AlwaysAllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Always allow in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

/**
 * A stub PolicyEvaluator that always DENYs
 */
class AlwaysDenyPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.DENY,
      allowed: false,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Always deny in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

function createValidLeasePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-001',
    tenant_id: crypto.randomUUID(),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    scopes: ['task:execute'],
    signature: 'test-signature-value',
    nonce: crypto.randomUUID(),
    ...overrides,
  };
}

describe('Execution Lease Boundary', () => {
  it('validates a well-formed, non-expired lease with ALLOW policy', async () => {
    const boundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator());
    const result = await boundary.validateLease(createValidLeasePayload());

    assert.strictEqual(result.valid, true);
    assert.ok(result.lease, 'Validated lease object should be returned');
    assert.ok(result.lease.lease_id);
  });

  it('rejects a malformed lease payload', async () => {
    const boundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator());
    const result = await boundary.validateLease({ invalid: 'data' });

    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('MALFORMED_LEASE'));
  });

  it('rejects an expired lease', async () => {
    const boundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator());
    const result = await boundary.validateLease(
      createValidLeasePayload({
        expires_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
      }),
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('LEASE_EXPIRED'));
  });

  it('rejects when policy evaluator denies execution', async () => {
    const boundary = new ExecutionLeaseBoundary(new AlwaysDenyPolicyEvaluator());
    const result = await boundary.validateLease(createValidLeasePayload());

    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('POLICY_DENIED'));
  });

  it('rejects a lease with missing required fields', async () => {
    const boundary = new ExecutionLeaseBoundary(new AlwaysAllowPolicyEvaluator());
    const result = await boundary.validateLease(
      createValidLeasePayload({ scopes: [] }), // Empty scopes violates min(1)
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('MALFORMED_LEASE'));
  });
});
