import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigLayer,
  ConfigurationManager,
  ConfigurationSnapshot,
  InMemoryConfigurationStore,
  SignedConfigEnvelope,
} from '../src/config/index.js';

describe('Task 03G Configuration Manager — Security Hardening Regression', () => {
  let manager: ConfigurationManager;

  beforeEach(() => {
    manager = new ConfigurationManager();
  });

  it('FINDING-G01: prevents active configuration mutation via deepFreeze immutability', async () => {
    const active = manager.getActiveConfiguration();

    // Attempt mutation on nested settings property
    assert.throws(() => {
      (active.settings as { logLevel: string }).logLevel = 'hacked';
    }, TypeError);

    // Verify active configuration remains unmutated
    assert.equal(manager.getActiveConfiguration().settings.logLevel, 'info');
  });

  it('FINDING-G01b: prevents observer payload mutation from altering active configuration state', async () => {
    let capturedSnapshot: ConfigurationSnapshot | null = null;
    manager.observerRegistry.subscribe('malicious_obs', (snapshot) => {
      capturedSnapshot = snapshot as ConfigurationSnapshot;
      // Attempt mutation on observer payload
      assert.throws(() => {
        (snapshot.resourceBudgets as { processTimeoutMs: number }).processTimeoutMs = 1;
      }, TypeError);
    });

    await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      settings: { logLevel: 'warn' },
    });

    assert.ok(capturedSnapshot);
    assert.equal(manager.getActiveConfiguration().resourceBudgets.processTimeoutMs, 60_000);
  });

  it('FINDING-G02: rejects replay attacks using old or equal signed configuration revisions', async () => {
    // Step 1: Apply valid signed release revision 2
    const envRev2: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'debug' } },
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 2,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const res1 = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envRev2);
    assert.equal(res1.result.success, true);
    assert.equal(manager.getActiveConfiguration().revision, 2);

    // Step 2: Attempt replay of signed release revision 1 (older)
    const envReplayOld: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'info' } },
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 1,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const resReplay = await manager.applyConfigurationUpdate(
      ConfigLayer.SIGNED_RELEASE_CONFIG,
      envReplayOld,
    );

    assert.equal(resReplay.result.success, false);
    assert.equal(resReplay.result.error?.code, 'CONFIG_REVISION_REPLAY');
    assert.equal(resReplay.event.schema_id, 'nexusos.events.config.rejected.v1');
    assert.equal(manager.getActiveConfiguration().revision, 2);
  });

  it('FINDING-G03: rejects authority key to layer binding mismatch', async () => {
    // Attempting to sign Enterprise Overlay with Release Authority Key
    const enterpriseEnv: SignedConfigEnvelope = {
      payload: { settings: { logLevel: 'error' } },
      layer: ConfigLayer.ENTERPRISE_POLICY_OVERLAYS,
      revision: 2,
      signature: 'valid_sig',
      authorityKeyId: 'pubkey_release_authority_v1', // Wrong key for Enterprise layer!
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };

    const res = await manager.applyConfigurationUpdate(
      ConfigLayer.ENTERPRISE_POLICY_OVERLAYS,
      enterpriseEnv,
    );

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_SIGNATURE_INVALID');
    assert.ok(res.result.error?.message.includes('not authorized to sign layer'));
  });

  it('FINDING-G04: prevents committing a poisoned LKG snapshot with disabled security baselines', () => {
    const store = new InMemoryConfigurationStore();

    assert.throws(() => {
      store.setLKGConfig({
        version: '1.0.0',
        revision: 1,
        layer: ConfigLayer.USER_PREFERENCES,
        securityBaselines: {
          policyDenyRulesEnabled: false,
        } as unknown as ConfigurationSnapshot['securityBaselines'],
      } as ConfigurationSnapshot);
    }, /SecurityBaselineViolation/);
  });
});
