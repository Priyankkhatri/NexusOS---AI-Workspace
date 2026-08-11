import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ExecutionLeaseHeader } from '@nexusos/contracts';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { SecretsVaultClient } from '../src/vault/vault-client.js';

class AllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Allowed by test evaluator',
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

describe('Secrets Vault Client — Reference Validation & Authorization Boundaries', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let vaultClient: SecretsVaultClient;
  let validLease: ExecutionLeaseHeader;

  beforeEach(() => {
    leaseBoundary = new ExecutionLeaseBoundary(new AllowPolicyEvaluator());
    vaultClient = new SecretsVaultClient(leaseBoundary);

    validLease = {
      lease_id: '00000000-0000-4000-8000-000000000001',
      task_id: '00000000-0000-4000-8000-000000000002',
      agent_id: 'agent_test_1',
      tenant_id: '00000000-0000-4000-8000-000000000003',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['secret:read', 'vault:sec_ref_db_password'],
      signature: 'valid_sig',
    };
  });

  it('rejects malformed or invalid secret reference string format', async () => {
    const res = await vaultClient.resolveSecret('invalid_raw_secret_string', {
      lease: validLease,
      allowedRoots: [],
    });

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'SECRET_REFERENCE_INVALID');
    assert.equal(res.event.schema_id, 'nexusos.events.vault.denied.v1');
  });

  it('rejects expired execution lease when resolving secret', async () => {
    const expiredLease: ExecutionLeaseHeader = {
      ...validLease,
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
    };

    const res = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: expiredLease,
      allowedRoots: [],
    });

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'LEASE_OR_POLICY_INVALID');
  });

  it('rejects secret resolution when lease lacks required secret scope', async () => {
    const scopeRestrictedLease: ExecutionLeaseHeader = {
      ...validLease,
      scopes: ['fs:read'], // missing secret:read
    };

    const res = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: scopeRestrictedLease,
      allowedRoots: [],
    });

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_SECRET_ACCESS');
  });

  it('resolves valid secret reference with valid lease and attaches evidence', async () => {
    const res = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });

    assert.equal(res.result.success, true);
    assert.equal(res.result.data?.secretName, 'DATABASE_PASSWORD');
    assert.equal(res.event.schema_id, 'nexusos.events.vault.resolved.v1');
    assert.equal(res.event.payload.status, 'SUCCESS');
  });
});
