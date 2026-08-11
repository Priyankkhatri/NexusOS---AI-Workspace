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

describe('Secrets Vault Client — Revocation & Offline Protected Lease Governance', () => {
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

  it('revokes an active secret lease, zeroizes buffer memory, and prevents re-resolution or injection', async () => {
    const resolveRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });
    const payload = resolveRes.result.data!;

    const revokeRes = await vaultClient.revokeSecret('vault:sec_ref_db_password', payload, {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(revokeRes.result.success, true);
    assert.equal(payload.isRevoked, true);

    // Verify buffer is zeroized
    const allZeroes = payload.payloadBuffer.every((byte) => byte === 0);
    assert.equal(allZeroes, true);

    // Verify subsequent resolution fails
    const secondResolve = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(secondResolve.result.success, false);
    assert.equal(secondResolve.result.error?.code, 'SECRET_REVOKED');
  });

  it('fails closed when offline without a valid protected local lease', async () => {
    const offlineRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
      isOffline: true,
      protectedLocalLeaseValid: false,
    });

    assert.equal(offlineRes.result.success, false);
    assert.equal(offlineRes.result.error?.code, 'OFFLINE_SECRET_UNAVAILABLE');
  });

  it('allows offline secret resolution when a valid protected local lease is present', async () => {
    const offlineRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
      isOffline: true,
      protectedLocalLeaseValid: true,
    });

    assert.equal(offlineRes.result.success, true);
    assert.equal(offlineRes.result.data?.secretName, 'DATABASE_PASSWORD');
  });
});
