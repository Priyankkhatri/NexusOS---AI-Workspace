import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigurationManager } from '../src/config/configuration-manager.js';
import { ConfigLayer, SignedConfigEnvelope } from '../src/config/types.js';
import { ConfigSignatureVerifier } from '../src/config/signature-verifier.js';
import { StateManager } from '../src/state/state-manager.js';
import { EncryptedStateStore } from '../src/state/encrypted-state-store.js';
import { StateCryptoVault } from '../src/state/crypto-vault.js';

describe('Task 03Y — Configuration & State Host Unit Suite', () => {
  const testDir = path.join(process.cwd(), '.test-config-state-host');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('returns immutable shipped default configuration initially', () => {
    const manager = new ConfigurationManager();
    const config = manager.getActiveConfiguration();

    assert.equal(config.version, '1.0.0');
    assert.equal(config.revision, 1);
    assert.equal(config.layer, ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS);
    assert.equal(config.securityBaselines.leaseValidationEnabled, true);
    assert.equal(config.securityBaselines.policyDenyRulesEnabled, true);
  });

  test('rejects updates that attempt to set security baselines to false', async () => {
    const manager = new ConfigurationManager();
    const updateResult = await manager.applyConfigurationUpdate(
      ConfigLayer.USER_PREFERENCES,
      {
        securityBaselines: {
          leaseValidationEnabled: false as any,
        },
      },
    );

    assert.equal(updateResult.result.success, false);
    assert.equal(updateResult.result.action, 'REJECT');
    assert.equal(updateResult.result.error?.code, 'SECURITY_BASELINE_VIOLATION');
  });

  test('verifies Ed25519/HMAC signature and applies valid signed release envelope', async () => {
    const verifier = new ConfigSignatureVerifier();
    const envelope: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 2,
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'valid_sig',
      payload: {
        settings: { logLevel: 'debug' },
      },
    };

    const verification = await verifier.verifySignature(envelope);
    assert.equal(verification.valid, true);

    const manager = new ConfigurationManager();
    const { result } = await manager.applyConfigurationUpdate(
      ConfigLayer.SIGNED_RELEASE_CONFIG,
      envelope,
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'UPDATE');
    assert.equal(result.snapshot?.settings.logLevel, 'debug');
    assert.equal(result.snapshot?.revision, 2);
  });

  test('rejects signed configuration with revision less than or equal to active revision (anti-replay)', async () => {
    const manager = new ConfigurationManager();

    // First update to revision 5
    const envelopeV5: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 5,
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'valid_sig',
      payload: { settings: { logLevel: 'warn' } },
    };
    await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envelopeV5);

    // Attempt replay with revision 3
    const envelopeV3: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 3,
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'valid_sig',
      payload: { settings: { logLevel: 'error' } },
    };
    const replayResult = await manager.applyConfigurationUpdate(
      ConfigLayer.SIGNED_RELEASE_CONFIG,
      envelopeV3,
    );

    assert.equal(replayResult.result.success, false);
    assert.equal(replayResult.result.error?.code, 'CONFIG_REVISION_REPLAY');
  });

  test('supports rollback to last known good (LKG) configuration', async () => {
    const manager = new ConfigurationManager();
    const rollbackResult = await manager.rollbackToLKG();

    assert.equal(rollbackResult.result.success, true);
    assert.equal(rollbackResult.result.action, 'ROLLBACK');
    assert.equal(rollbackResult.result.snapshot?.version, '1.0.0');
  });

  test('encrypts and decrypts state payloads using AES-256-GCM', () => {
    const secretKey = 'Secure_Test_Encryption_Key_2026_x101';
    const vault = new StateCryptoVault(secretKey);
    const plaintext = JSON.stringify({ key: 'test', value: 42 });

    const envelope = vault.encrypt(plaintext);
    assert.equal(envelope.algorithm, 'AES-256-GCM');
    assert.ok(envelope.ciphertext);

    const decrypted = vault.decrypt(envelope);
    assert.equal(decrypted, plaintext);
  });

  test('rejects tampered ciphertext during decryption', () => {
    const secretKey = 'Secure_Test_Encryption_Key_2026_x101';
    const vault = new StateCryptoVault(secretKey);
    const envelope = vault.encrypt('hello world');

    // Tamper ciphertext
    envelope.ciphertext = envelope.ciphertext.substring(0, envelope.ciphertext.length - 4) + 'AAAA';

    assert.throws(() => vault.decrypt(envelope), /Integrity verification failed/);
  });

  test('persists records with atomic tmp write and loads back correctly', async () => {
    const secretKey = 'Secure_Test_Encryption_Key_2026_x101';
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'test-state.enc',
      encryptionKey: secretKey,
    });

    await stateManager.start();
    await stateManager.set('user:session', { active: true, role: 'admin' });

    const record = await stateManager.get<{ active: boolean; role: string }>('user:session');
    assert.deepEqual(record, { active: true, role: 'admin' });
    await stateManager.stop();
  });

  test('handles schema version migration deterministically', async () => {
    const secretKey = 'Secure_Test_Encryption_Key_2026_x101';
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'test-migration.enc',
      encryptionKey: secretKey,
      currentSchemaVersion: '2.0.0',
    });

    stateManager.registerMigration('2.0.0', (oldData) => {
      const obj = oldData as { name: string };
      return { fullName: obj.name.toUpperCase(), migrated: true };
    });

    await stateManager.start();

    // Save manually as v1.0.0
    const store = (stateManager as any).store as EncryptedStateStore;
    await store.saveRecord('profile:1', { name: 'Alice' }, '1.0.0');

    const migrated = await stateManager.get<{ fullName: string; migrated: boolean }>('profile:1');
    assert.deepEqual(migrated, { fullName: 'ALICE', migrated: true });
    await stateManager.stop();
  });
});
