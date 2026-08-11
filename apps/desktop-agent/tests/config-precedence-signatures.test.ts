import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigLayer, ConfigurationManager, SignedConfigEnvelope } from '../src/config/index.js';

describe('Task 03G Configuration Manager — Precedence & Signature Verification', () => {
  let manager: ConfigurationManager;

  beforeEach(() => {
    manager = new ConfigurationManager();
  });

  it('initializes with Immutable Shipped Defaults at level 1', () => {
    const active = manager.getActiveConfiguration();
    assert.equal(active.layer, ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS);
    assert.equal(active.revision, 1);
    assert.equal(active.securityBaselines.policyDenyRulesEnabled, true);
    assert.equal(active.securityBaselines.secretRedactionEnabled, true);
  });

  it('rejects unsigned release configuration envelope', async () => {
    const res = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, {
      payload: { settings: { logLevel: 'warn' } },
    } as unknown as SignedConfigEnvelope);

    assert.equal(res.result.success, false);
    assert.equal(res.result.action, 'REJECT');
    assert.equal(res.result.error?.code, 'CONFIG_SIGNATURE_MISSING');
    assert.equal(res.event.schema_id, 'nexusos.events.config.rejected.v1');
  });

  it('rejects release configuration with untrusted or forged authority key', async () => {
    const envelope: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'warn' } },
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 2,
      signature: 'valid_sig',
      authorityKeyId: 'untrusted_forged_key_123',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };

    const res = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envelope);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_SIGNATURE_INVALID');
  });

  it('rejects release configuration with expired signature', async () => {
    const envelope: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'warn' } },
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 2,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    };

    const res = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envelope);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_SIGNATURE_INVALID');
  });

  it('applies valid signed release configuration and updates precedence', async () => {
    const envelope: SignedConfigEnvelope = {
      payload: {
        settings: { logLevel: 'debug' },
        resourceBudgets: { heartbeatIntervalMs: 5000 },
      },
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 2,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };

    const res = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envelope);

    assert.equal(res.result.success, true);
    assert.equal(res.result.action, 'UPDATE');
    assert.equal(res.result.snapshot?.layer, ConfigLayer.SIGNED_RELEASE_CONFIG);
    assert.equal(res.result.snapshot?.settings.logLevel, 'debug');
    assert.equal(res.event.schema_id, 'nexusos.events.config.updated.v1');
  });

  it('enforces layer precedence: Enterprise Overlays override Release Config & Shipped Defaults', async () => {
    // Step 1: Signed Release Config
    const releaseEnv: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'debug' } },
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 2,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, releaseEnv);

    // Step 2: Enterprise Overlay
    const enterpriseEnv: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'error' } },
      layer: ConfigLayer.ENTERPRISE_POLICY_OVERLAYS,
      revision: 3,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_enterprise_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const res = await manager.applyConfigurationUpdate(
      ConfigLayer.ENTERPRISE_POLICY_OVERLAYS,
      enterpriseEnv,
    );

    assert.equal(res.result.success, true);
    assert.equal(res.result.snapshot?.layer, ConfigLayer.ENTERPRISE_POLICY_OVERLAYS);
    assert.equal(res.result.snapshot?.settings.logLevel, 'error');
  });
});
