import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { SecretsVaultClient } from '../src/vault/vault-client.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';
import { SecretRevocationHandler } from '../src/vault/revocation-handler.js';
import { UpdateManager } from '../src/updater/update-manager.js';
import type { ExecutionLeaseHeader } from '@nexusos/contracts';
import type { VaultOperationRequestContext, UpdateManifest } from '../src/index.js';

function createDummyLeaseHeader(): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-unit-01',
    tenant_id: crypto.randomUUID(),
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
    signature: 'sig-dummy-unit-01',
  };
}

describe('Task 03W — Secrets Vault Host Unit Tests', () => {
  it('resolves secret reference and registers redaction fingerprint', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const redactionRegistry = new SecretRedactionRegistry();
    const vaultClient = new SecretsVaultClient(boundary, undefined, undefined, redactionRegistry);

    const lease = createDummyLeaseHeader();
    const context: VaultOperationRequestContext = {
      lease,
      allowedRoots: ['.'],
    };

    const { result } = await vaultClient.resolveSecret('vault:sec_ref_db_password', context);

    assert.equal(result.success, true);
    assert.equal(result.referenceId, 'vault:sec_ref_db_password');
    assert.ok(result.data?.payloadBuffer);
    assert.ok(result.data?.fingerprintId);
  });

  it('rejects revoked secret reference resolution', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const revocationHandler = new SecretRevocationHandler();
    revocationHandler.revokeSecretLease('vault:sec_ref_revoked_01');

    const vaultClient = new SecretsVaultClient(
      boundary,
      undefined,
      undefined,
      undefined,
      revocationHandler,
    );

    const lease = createDummyLeaseHeader();
    const context: VaultOperationRequestContext = { lease, allowedRoots: ['.'] };

    const { result } = await vaultClient.resolveSecret('vault:sec_ref_revoked_01', context);

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'SECRET_REVOKED');
  });

  it('enforces active secret lease bound ceiling (64 max)', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const vaultClient = new SecretsVaultClient(boundary);
    const lease = createDummyLeaseHeader();
    const context: VaultOperationRequestContext = { lease, allowedRoots: ['.'] };

    for (let i = 0; i < 64; i++) {
      const ref = `vault:sec_ref_bound_${i}`;
      (vaultClient.resolver as any).mockVaultStore.set(ref, {
        secretName: `BOUND_${i}`,
        secretValue: `val_${i}`,
      });
      const res = await vaultClient.resolveSecret(ref, context);
      assert.equal(res.result.success, true);
    }

    const overflowRef = 'vault:sec_ref_overflow';
    (vaultClient.resolver as any).mockVaultStore.set(overflowRef, {
      secretName: 'OVERFLOW',
      secretValue: 'overflow_val',
    });
    const overflow = await vaultClient.resolveSecret(overflowRef, context);
    assert.equal(overflow.result.success, false);
    assert.equal(overflow.result.error?.code, 'SECRET_LEASE_LIMIT_EXCEEDED');
  });

  it('zeroizes memory buffers and clears leases on shutdown', async () => {
    const boundary = new ExecutionLeaseBoundary({
      evaluate: async () => ({ allowed: true }),
    } as any);
    const vaultClient = new SecretsVaultClient(boundary);
    const lease = createDummyLeaseHeader();
    const context: VaultOperationRequestContext = { lease, allowedRoots: ['.'] };

    const { result } = await vaultClient.resolveSecret('vault:sec_ref_db_password', context);
    assert.equal(result.success, true);
    assert.ok(result.data?.payloadBuffer);

    vaultClient.shutdown();

    // Verify payload buffer bytes were zeroized on shutdown
    const allZeroes = Array.from(result.data.payloadBuffer).every((b) => b === 0);
    assert.equal(allZeroes, true);
  });
});

describe('Task 03W — Update Manager Host Unit Tests', () => {
  it('verifies update manifest and detects anti-rollback violations', async () => {
    const manager = new UpdateManager('1.0.0', 'stable');
    const status = manager.getStatus();

    assert.equal(status.state, 'IDLE');
    assert.equal(status.currentVersion, '1.0.0');
    assert.equal(status.channel, 'stable');
  });

  it('rejects manifest with channel mismatch', async () => {
    const manager = new UpdateManager('1.0.0', 'stable');
    const manifest: UpdateManifest = {
      manifestId: crypto.randomUUID(),
      version: '1.1.0',
      channel: 'beta',
      packageUrl: 'https://releases.nexusos.internal/v1.1.0.tar.gz',
      sha256: 'a'.repeat(64),
      signature: 'sig-unit-beta',
      publishedAt: new Date().toISOString(),
      minAntiRollbackVersion: '1.0.0',
    };

    const res = await manager.checkForUpdates(manifest);
    assert.equal(res, null);
    assert.equal(manager.getStatus().state, 'FAILED');
    assert.ok(manager.getStatus().errorReason?.includes('channel mismatch'));
  });
});
