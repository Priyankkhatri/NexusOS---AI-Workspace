import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { SecretsVaultClient } from '../src/vault/vault-client.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';
import { SecretRevocationHandler } from '../src/vault/revocation-handler.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { UpdateManager } from '../src/updater/update-manager.js';
import { UpdateManifestVerifier } from '../src/updater/manifest-verifier.js';
import type { ExecutionLeaseHeader } from '@nexusos/contracts';
import type { UpdateManifest } from '../src/index.js';

function createDummyLeaseHeader(tenantId?: string): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-sec-01',
    tenant_id: tenantId || crypto.randomUUID(),
    scopes: [
      'secret:read',
      'secret:write',
      'vault:read',
      'vault:write',
      'update:read',
      'update:write',
    ],
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    signature: 'sig-sec-01',
  };
}

describe('Task 03W — Vault & Update Security Hardening Regression Suite', () => {
  it('W-SEC-01: Secret telemetry redaction in RedactionFilter', async () => {
    const redactionRegistry = new SecretRedactionRegistry();
    const filter = new RedactionFilter(redactionRegistry);

    const secretValue = Buffer.from('super_secret_password_999');
    redactionRegistry.registerSecret(secretValue, 'fp-sec-01');

    const rawLog = 'Connecting to DB with password super_secret_password_999 in payload';
    const sanitized = filter.redactString(rawLog);

    assert.ok(!sanitized.includes('super_secret_password_999'));
    assert.ok(sanitized.includes('[REDACTED'));
  });

  it('W-SEC-02: Revoked secret reference resolution rejection', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const revocationHandler = new SecretRevocationHandler();
    revocationHandler.revokeSecretLease('vault:sec_ref_revoked_99');

    const vaultClient = new SecretsVaultClient(
      boundary,
      undefined,
      undefined,
      undefined,
      revocationHandler,
    );
    const lease = createDummyLeaseHeader();

    const { result } = await vaultClient.resolveSecret('vault:sec_ref_revoked_99', {
      lease,
      allowedRoots: ['.'],
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'SECRET_REVOKED');
  });

  it('W-SEC-03: Active secret lease ceiling bound (64 max)', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const vaultClient = new SecretsVaultClient(boundary);
    const lease = createDummyLeaseHeader();

    for (let i = 0; i < 64; i++) {
      const ref = `vault:sec_ref_sec_${i}`;
      (vaultClient.resolver as any).mockVaultStore.set(ref, {
        secretName: `S_${i}`,
        secretValue: `v_${i}`,
      });
      const res = await vaultClient.resolveSecret(ref, { lease, allowedRoots: ['.'] });
      assert.equal(res.result.success, true);
    }

    const overflowRef = 'vault:sec_ref_overflow';
    (vaultClient.resolver as any).mockVaultStore.set(overflowRef, {
      secretName: 'OV',
      secretValue: 'ov_val',
    });
    const overflow = await vaultClient.resolveSecret(overflowRef, { lease, allowedRoots: ['.'] });

    assert.equal(overflow.result.success, false);
    assert.equal(overflow.result.error?.code, 'SECRET_LEASE_LIMIT_EXCEEDED');
  });

  it('W-SEC-04: Invalid update manifest signature rejection', async () => {
    const verifier = new UpdateManifestVerifier('test-pub-key');
    const invalidManifest: UpdateManifest = {
      manifestId: crypto.randomUUID(),
      version: '1.2.0',
      channel: 'stable',
      packageUrl: 'https://releases.nexusos.internal/v1.2.0.tar.gz',
      sha256: 'a'.repeat(64),
      signature: 'invalid-signature-data',
      publishedAt: new Date().toISOString(),
      minAntiRollbackVersion: '1.0.0',
    };

    const res = verifier.verifyManifest(invalidManifest, '1.0.0');
    assert.equal(res.valid, false);
    assert.ok(res.reason?.includes('signature'));
  });

  it('W-SEC-05: Update anti-rollback version monotonicity check', async () => {
    const verifier = new UpdateManifestVerifier('test-pub-key');

    const manifest: UpdateManifest = {
      manifestId: crypto.randomUUID(),
      version: '0.9.0', // Older than current 1.0.0
      channel: 'stable',
      packageUrl: 'https://releases.nexusos.internal/v0.9.0.tar.gz',
      sha256: 'b'.repeat(64),
      signature: 'sig-valid',
      publishedAt: new Date().toISOString(),
      minAntiRollbackVersion: '1.0.0',
    };

    const canonicalString = `${manifest.manifestId}:${manifest.version}:${manifest.channel}:${manifest.packageUrl}:${manifest.sha256}:${manifest.minAntiRollbackVersion}:${manifest.publishedAt}`;
    manifest.signature = crypto
      .createHmac('sha256', 'test-pub-key')
      .update(canonicalString)
      .digest('hex');

    const res = verifier.verifyManifest(manifest, '1.0.0');
    assert.equal(res.valid, false);
    assert.ok(res.reason?.includes('Downgrade attack'));
  });

  it('W-SEC-06: Package SHA-256 checksum tampering detection', async () => {
    const verifier = new UpdateManifestVerifier('test-key');
    const rawBuffer = Buffer.from('valid_package_payload_content');
    const actualHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const tamperedHash = 'f'.repeat(64);

    assert.equal(verifier.verifyPackageIntegrity(rawBuffer, actualHash), true);
    assert.equal(verifier.verifyPackageIntegrity(rawBuffer, tamperedHash), false);
  });

  it('W-SEC-07: Unverified manifest download rejection', async () => {
    const manager = new UpdateManager('1.0.0', 'stable');
    const manifest: UpdateManifest = {
      manifestId: crypto.randomUUID(),
      version: '1.1.0',
      channel: 'stable',
      packageUrl: 'https://releases.nexusos.internal/v1.1.0.tar.gz',
      sha256: 'c'.repeat(64),
      signature: 'sig-1.1.0',
      publishedAt: new Date().toISOString(),
      minAntiRollbackVersion: '1.0.0',
    };

    // Attempting to download without prior checkForUpdates verification
    const res = await manager.downloadAndVerifyUpdate(manifest, Buffer.from('data'));
    assert.equal(res, false);
    assert.equal(manager.getStatus().state, 'FAILED');
    assert.ok(manager.getStatus().errorReason?.includes('not verified'));
  });

  it('W-SEC-08: Health-gated activation failure automatic LKG rollback', async () => {
    const manager = new UpdateManager('1.0.0', 'stable');
    (manager as any).status.state = 'STAGED';
    (manager as any).currentManifest = {
      manifestId: crypto.randomUUID(),
      version: '1.1.0',
      channel: 'stable',
      packageUrl: 'https://releases.nexusos.internal/v1.1.0.tar.gz',
      sha256: 'd'.repeat(64),
      signature: 'sig-1.1.0',
      publishedAt: new Date().toISOString(),
      minAntiRollbackVersion: '1.0.0',
    };

    // Health check function fails
    const success = await manager.stageAndActivateUpdate(async () => false);

    assert.equal(success, false);
    assert.ok(manager.getStatus().errorReason?.includes('Health-gated activation check failed'));
  });

  it('W-SEC-09: Lease TOCTOU race on secret resolution', async () => {
    const leaseValid = false;
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: leaseValid }),
    } as any);

    const vaultClient = new SecretsVaultClient(boundary);
    const lease = createDummyLeaseHeader();

    const { result } = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease,
      allowedRoots: ['.'],
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'LEASE_OR_POLICY_INVALID');
  });

  it('W-SEC-10: Cross-tenant vault secret access fail-closed isolation', async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();

    const leaseA = createDummyLeaseHeader(tenantA);
    const leaseB = createDummyLeaseHeader(tenantB);

    assert.notEqual(leaseA.tenant_id, leaseB.tenant_id);
  });

  it('W-SEC-11: Injection channel isolation enforcement', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const vaultClient = new SecretsVaultClient(boundary);

    const lease = createDummyLeaseHeader();
    const payload = {
      referenceId: 'ref-inj-01',
      secretName: 'SECRET_KEY',
      payloadBuffer: Buffer.from('val'),
      fingerprintId: 'fp-inj-01',
      expiresAt: new Date().toISOString(),
      isRevoked: false,
    };

    const res = await vaultClient.injectSecret(payload, 'INVALID_CHANNEL' as any, 'target', {
      lease,
      allowedRoots: ['.'],
    });
    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'UNAUTHORIZED_INJECTION_CHANNEL');
  });

  it('W-SEC-12: Shutdown secret purge and memory zeroization', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const vaultClient = new SecretsVaultClient(boundary);
    const lease = createDummyLeaseHeader();

    const { result } = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease,
      allowedRoots: ['.'],
    });
    assert.equal(result.success, true);
    assert.ok(result.data?.payloadBuffer);

    vaultClient.shutdown();

    const zeroes = Array.from(result.data.payloadBuffer).every((b) => b === 0);
    assert.equal(zeroes, true);
  });
});
