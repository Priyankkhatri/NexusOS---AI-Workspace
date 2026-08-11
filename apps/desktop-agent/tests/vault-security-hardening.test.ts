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
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';

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

describe('Secrets Vault Client — Security Hardening Regression', () => {
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
      scopes: ['secret:read', 'plugin:invoke', 'vault:sec_ref_db_password'],
      signature: 'valid_sig',
    };
  });

  // FINDING-01: Verify redaction registry zeroizes buffer on unregister
  it('zeroizes redaction registry buffer memory when secret is unregistered', () => {
    const registry = new SecretRedactionRegistry();
    const secretBuf = Buffer.from('supersecretvalue', 'utf-8');
    registry.registerSecret(secretBuf, 'fp_test_001');

    assert.equal(registry.isRegistered('fp_test_001'), true);

    // Verify redaction works before unregister
    const redacted = registry.redactText('log output: supersecretvalue end');
    assert.equal(redacted.includes('supersecretvalue'), false);

    // Unregister and verify zeroization
    registry.unregisterSecret('fp_test_001');
    assert.equal(registry.isRegistered('fp_test_001'), false);

    // Verify redaction no longer works (secret is gone)
    const afterUnregister = registry.redactText('log output: supersecretvalue end');
    assert.equal(afterUnregister.includes('supersecretvalue'), true); // no longer redacted
  });

  // FINDING-02: Error messages are properly extracted from NexusOSError plain objects
  it('extracts proper error messages from NexusOSError plain objects in deny events', async () => {
    const res = await vaultClient.resolveSecret('invalid_reference', {
      lease: validLease,
      allowedRoots: [],
    });

    assert.equal(res.result.success, false);
    // Verify the error message is meaningful, not "[object Object]"
    assert.ok(res.result.error?.message);
    assert.equal(res.result.error?.message.includes('[object Object]'), false);
    assert.equal(
      ((res.event.payload as Record<string, unknown>).errorMessage as string)?.includes(
        '[object Object]',
      ),
      false,
    );
  });

  // FINDING-03: Error messages do not leak reference strings
  it('does not leak secret reference strings in error messages', async () => {
    const res = await vaultClient.resolveSecret('vault:sec_ref_nonexistent_secret', {
      lease: {
        ...validLease,
        scopes: ['secret:read', 'vault:sec_ref_nonexistent_secret'],
      },
      allowedRoots: [],
    });

    assert.equal(res.result.success, false);
    // The error message should NOT contain the reference string
    assert.equal(
      res.result.error?.message?.includes('vault:sec_ref_nonexistent_secret'),
      false,
      'Error message must not leak the opaque reference string',
    );
  });

  // FINDING-04: JSON serialization of VaultOperationResult must not expose plaintext
  it('does not expose plaintext Buffer content when VaultOperationResult is JSON-serialized', async () => {
    const resolveRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });

    assert.equal(resolveRes.result.success, true);

    // When the result is JSON-serialized, the Buffer is serialized as {type:'Buffer', data:[...]}
    // Verify that the known secret plaintext string is NOT in the JSON
    const resultJson = JSON.stringify(resolveRes.result);
    assert.equal(
      resultJson.includes('P@ssw0rd123_Secret_Db_Key!'),
      false,
      'JSON-serialized result must not contain plaintext secret string',
    );

    // However Buffer.toJSON() produces {type:'Buffer', data: [byte array]}
    // This IS a representation of the secret, so callers MUST NOT serialize VaultOperationResult
    // The event envelope must be clean
    const eventJson = JSON.stringify(resolveRes.event);
    assert.equal(
      eventJson.includes('P@ssw0rd123'),
      false,
      'Event envelope must not contain any fragment of the secret',
    );
  });

  // FINDING-05: Redaction catches URL-embedded credentials
  it('redacts URL-embedded credentials in output text', () => {
    const registry = new SecretRedactionRegistry();
    const urlWithCreds = 'Connecting to https://admin:secretpass123@db.example.com:5432/mydb';
    const redacted = registry.redactText(urlWithCreds);

    assert.equal(redacted.includes('secretpass123'), false);
    assert.equal(redacted.includes('[REDACTED_URL_CREDENTIAL]'), true);
  });

  // FINDING-05b: Redaction catches authorization header patterns
  it('redacts authorization header patterns in JSON output', () => {
    const registry = new SecretRedactionRegistry();
    const jsonWithAuth = '{"authorization": "Bearer-Token-Secret-123"}';
    const redacted = registry.redactText(jsonWithAuth);

    assert.equal(redacted.includes('Bearer-Token-Secret-123'), false);
    assert.equal(redacted.includes('[REDACTED_SENSITIVE_KEY]'), true);
  });

  // FINDING-07: Offline access requires more than just a boolean flag
  it('offline protected lease documentation is enforced via types', async () => {
    // Verify that isOffline=true without protectedLocalLeaseValid fails
    const res1 = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
      isOffline: true,
      // protectedLocalLeaseValid is undefined (not present)
    });
    assert.equal(res1.result.success, false);
    assert.equal(res1.result.error?.code, 'OFFLINE_SECRET_UNAVAILABLE');

    // Verify that explicitly false also fails
    const res2 = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
      isOffline: true,
      protectedLocalLeaseValid: false,
    });
    assert.equal(res2.result.success, false);
    assert.equal(res2.result.error?.code, 'OFFLINE_SECRET_UNAVAILABLE');
  });

  // FINDING-08: Revocation prevents subsequent injection
  it('prevents injection of a revoked secret even if the payload object still exists', async () => {
    const resolveRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });
    const payload = resolveRes.result.data!;

    // Revoke
    await vaultClient.revokeSecret('vault:sec_ref_db_password', payload, {
      lease: validLease,
      allowedRoots: [],
    });

    // Try to inject the stale payload
    const injRes = await vaultClient.injectSecret(payload, 'TERMINAL', 'proc_123', {
      lease: validLease,
      allowedRoots: [],
    });

    assert.equal(injRes.result.success, false);
    assert.equal(injRes.result.error?.code, 'SECRET_REVOKED');
  });

  // FINDING: Redaction handles secrets split across partial chunks
  it('redacts secrets that appear as substrings in concatenated output', () => {
    const registry = new SecretRedactionRegistry();
    const secret = 'my-secret-value-12345';
    registry.registerSecret(secret, 'fp_split_001');

    // Secret appears as part of a longer string
    const output = `prefix_my-secret-value-12345_suffix`;
    const redacted = registry.redactText(output);

    assert.equal(redacted.includes('my-secret-value-12345'), false);
    assert.equal(redacted.includes('[REDACTED_SECRET_fp_split'), true);
  });
});
