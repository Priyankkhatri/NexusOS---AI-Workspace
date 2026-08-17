import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  StateManager,
  StateCryptoVault,
  EncryptedStateStore,
  StateConfigSchema,
} from '../src/state/index.js';
import { AgentLifecycleState } from '../src/lifecycle/index.js';
import { MemoryCacheManager } from '../src/memory/memory-cache-manager.js';

describe('Task 03M State Manager — Security Hardening & Vulnerability Audit', () => {
  const storageDir = path.resolve('.test-state-sec-dir');
  const encKey = 'Super_Secure_Security_Test_Key_2026_x99';
  let stateManager: StateManager;

  beforeEach(async () => {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    stateManager = new StateManager({
      storageDir,
      stateFileName: 'test-sec-state.enc',
      lkgFileName: 'test-sec-state.lkg.enc',
      encryptionKey: encKey,
    });
    await stateManager.start();
  });

  afterEach(async () => {
    if (stateManager) {
      await stateManager.stop();
    }
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it('VULNERABILITY-M01: verifies encrypted-at-rest state persistence on disk', async () => {
    const sensitivePayload = 'CONFIDENTIAL_STATE_VALUE_XYZ_999';
    await stateManager.set('secret:key', { data: sensitivePayload });
    await stateManager.stop();

    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    assert.ok(fs.existsSync(stateFilePath));

    const rawFileContent = fs.readFileSync(stateFilePath, 'utf-8');
    assert.equal(rawFileContent.includes(sensitivePayload), false);
    assert.ok(rawFileContent.includes('AES-256-GCM'));
    assert.ok(rawFileContent.includes('ciphertext'));
  });

  it('VULNERABILITY-M02: fails closed on HMAC signature mismatch / file tampering', async () => {
    await stateManager.set('test:key', 'unmodified_val');
    await stateManager.stop();

    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    const rawContent = fs.readFileSync(stateFilePath, 'utf-8');
    const envelope = JSON.parse(rawContent);

    // Tamper with HMAC signature
    envelope.hmac = Buffer.from('TAMPERED_HMAC_SIGNATURE_1234567890').toString('base64');
    fs.writeFileSync(stateFilePath, JSON.stringify(envelope), 'utf-8');

    // Remove LKG file so it cannot fall back to LKG
    const lkgFilePath = path.join(storageDir, 'test-sec-state.lkg.enc');
    if (fs.existsSync(lkgFilePath)) fs.unlinkSync(lkgFilePath);

    const tamperedManager = new StateManager({
      storageDir,
      stateFileName: 'test-sec-state.enc',
      lkgFileName: 'test-sec-state.lkg.enc',
      encryptionKey: encKey,
    });

    await assert.rejects(async () => {
      await tamperedManager.start();
    }, /Integrity verification failed/);
  });

  it('VULNERABILITY-M03: recovers automatically from Last Known Good (LKG) backup snapshot', async () => {
    await stateManager.set('checkpoint:1', 'lkg_valid_checkpoint');
    await stateManager.set('checkpoint:2', 'lkg_second_checkpoint');
    await stateManager.stop();

    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    const lkgFilePath = path.join(storageDir, 'test-sec-state.lkg.enc');
    assert.ok(fs.existsSync(lkgFilePath));

    // Corrupt primary state file
    fs.writeFileSync(stateFilePath, 'CORRUPTED_PRIMARY_FILE_DATA', 'utf-8');

    const recoveredManager = new StateManager({
      storageDir,
      stateFileName: 'test-sec-state.enc',
      lkgFileName: 'test-sec-state.lkg.enc',
      encryptionKey: encKey,
    });

    await recoveredManager.start();
    const val1 = await recoveredManager.get<string>('checkpoint:1');
    assert.equal(val1, 'lkg_valid_checkpoint');
    assert.equal(recoveredManager.getStatus().corruptedRecoveryCount, 1);

    await recoveredManager.stop();
  });

  it('VULNERABILITY-M04: cleans up stale .tmp files on startup and prevents interrupted write corruption', async () => {
    const tmpFilePath = path.join(storageDir, 'fresh-test-sec-state.enc.tmp');
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(tmpFilePath, 'STALE_PARTIAL_WRITE_TMP_DATA', 'utf-8');

    assert.ok(fs.existsSync(tmpFilePath));

    const freshManager = new StateManager({
      storageDir,
      stateFileName: 'fresh-test-sec-state.enc',
      lkgFileName: 'fresh-test-sec-state.lkg.enc',
      encryptionKey: encKey,
    });

    await freshManager.start();
    assert.equal(fs.existsSync(tmpFilePath), false);
    await freshManager.stop();
  });

  it('VULNERABILITY-M05: rejects path traversal and scope escape in state file paths', async () => {
    assert.throws(() => {
      StateConfigSchema.parse({
        storageDir,
        stateFileName: '../escaped-state.enc',
        encryptionKey: encKey,
      });
    }, /stateFileName must be a single valid filename/);
  });

  it('VULNERABILITY-M06: rejects malformed record schemas fail-closed', async () => {
    const vault = new StateCryptoVault(encKey);
    const malformedRecord = {
      key: 'bad:key',
      version: '1.0.0',
      updatedAt: 'INVALID_DATE_STRING', // Invalid ISO datetime
      data: 'data',
      checksum: '123', // Invalid length checksum
    };

    const envelope = vault.encrypt(JSON.stringify([malformedRecord]));
    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify(envelope), 'utf-8');

    const corruptedManager = new StateManager({
      storageDir,
      stateFileName: 'test-sec-state.enc',
      lkgFileName: 'test-sec-state.lkg.enc',
      encryptionKey: encKey,
    });

    await assert.rejects(async () => {
      await corruptedManager.start();
    }, /Corrupted state record detected/);
  });

  it('VULNERABILITY-M07: rejects insecure or predictable default encryption keys', async () => {
    assert.throws(() => {
      new StateCryptoVault('short'); // Under 16 chars
    }, /Encryption key must be at least 16 characters/);

    assert.throws(() => {
      new StateCryptoVault('default_insecure_key_123'); // Hardcoded insecure string
    }, /Insecure or predictable default encryption key rejected/);
  });

  it('VULNERABILITY-M08: enforces maximum storage size bounds', async () => {
    const smallBoundsManager = new StateManager({
      storageDir,
      stateFileName: 'test-sec-state.enc',
      maxStorageSizeBytes: 100, // Restrictive 100 bytes limit
      encryptionKey: encKey,
    });

    await smallBoundsManager.start();

    await assert.rejects(async () => {
      await smallBoundsManager.set('large:key', {
        bigData: 'A'.repeat(500),
      });
    }, /Storage size bounds exceeded/);

    await smallBoundsManager.stop();
  });

  it('VULNERABILITY-M09: redacts plaintext API keys and secrets before saving to disk', async () => {
    await stateManager.set('vault:secret', {
      api_key: 'sk_live_secret_api_key_999',
      password: 'super_secret_password_888',
    });

    const val = await stateManager.get<{ api_key: string; password: string }>('vault:secret');
    assert.ok(val);
    assert.equal(val.api_key.includes('sk_live_secret_api_key_999'), false);
    assert.equal(val.password.includes('super_secret_password_888'), false);
    assert.ok(val.api_key.includes('[REDACTED_SENSITIVE_KEY]'));
  });

  it('VULNERABILITY-M10: rejects state mutations when agent lifecycle posture is STOPPING or FAILED', async () => {
    let lifecycleState = AgentLifecycleState.STOPPING;
    const nonWritableManager = new StateManager(
      { storageDir, stateFileName: 'test-sec-state.enc', encryptionKey: encKey },
      undefined,
      undefined,
      () => lifecycleState,
    );

    await nonWritableManager.start();

    await assert.rejects(async () => {
      await nonWritableManager.set('key', 'value');
    }, /State mutation rejected: Agent is in non-writable lifecycle state/);

    lifecycleState = AgentLifecycleState.FAILED;
    await assert.rejects(async () => {
      await nonWritableManager.delete('key');
    }, /State mutation rejected/);

    await nonWritableManager.stop();
  });

  it('VULNERABILITY-M11: authenticates formatVersion, algorithm, and createdAt metadata inside HMAC signature', async () => {
    await stateManager.set('meta:key', 'unmodified_data');
    await stateManager.stop();

    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    const rawContent = fs.readFileSync(stateFilePath, 'utf-8');
    const envelope = JSON.parse(rawContent);

    // Tamper with formatVersion metadata without altering ciphertext
    envelope.formatVersion = '2.0.0';
    fs.writeFileSync(stateFilePath, JSON.stringify(envelope), 'utf-8');

    // Remove LKG file so fallback cannot happen
    const lkgFilePath = path.join(storageDir, 'test-sec-state.lkg.enc');
    if (fs.existsSync(lkgFilePath)) fs.unlinkSync(lkgFilePath);

    const tamperedMetaManager = new StateManager({
      storageDir,
      stateFileName: 'test-sec-state.enc',
      lkgFileName: 'test-sec-state.lkg.enc',
      encryptionKey: encKey,
    });

    await assert.rejects(async () => {
      await tamperedMetaManager.start();
    }, /Failed to load encrypted state from disk|Integrity verification failed/);
  });

  it('VULNERABILITY-M12: preserves valid LKG backup when primary file is corrupted during flush', async () => {
    await stateManager.set('lkg:checkpoint', 'initial_valid_state');
    await stateManager.stop();

    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    const lkgFilePath = path.join(storageDir, 'test-sec-state.lkg.enc');

    // Create valid LKG backup explicitly
    fs.copyFileSync(stateFilePath, lkgFilePath);

    // Corrupt primary state file on disk
    fs.writeFileSync(stateFilePath, 'CORRUPTED_PRIMARY_PAYLOAD_GARBAGE', 'utf-8');

    const vault = new StateCryptoVault(encKey);
    const store = new EncryptedStateStore(
      {
        storageDir,
        stateFileName: 'test-sec-state.enc',
        lkgFileName: 'test-sec-state.lkg.enc',
        maxStorageSizeBytes: 1048576,
        maxRecords: 100,
        currentSchemaVersion: '1.0.0',
      },
      vault,
    );

    // Flush store to disk — must NOT overwrite the valid lkg.enc with corrupted primary file
    await store.saveRecord('new:record', 'new_data');

    // LKG file content must remain valid decryptable state
    const lkgRaw = fs.readFileSync(lkgFilePath, 'utf-8');
    const lkgEnvelope = JSON.parse(lkgRaw);
    const decryptedLkg = vault.decrypt(lkgEnvelope);

    assert.ok(decryptedLkg.includes('lkg:checkpoint'));
  });

  it('VULNERABILITY-M13: rejects disk state files exceeding maximum storage size bounds before reading', async () => {
    const hugeStateFilePath = path.join(storageDir, 'huge-sec-state.enc');
    fs.mkdirSync(storageDir, { recursive: true });
    // Write 500 KB file while storage limit is 100 KB
    fs.writeFileSync(hugeStateFilePath, 'A'.repeat(500000), 'utf-8');

    const tightStoreManager = new StateManager({
      storageDir,
      stateFileName: 'huge-sec-state.enc',
      maxStorageSizeBytes: 100000, // 100 KB limit
      encryptionKey: encKey,
    });

    await assert.rejects(async () => {
      await tightStoreManager.start();
    }, /exceeds maximum storage bounds/);
  });

  it('VULNERABILITY-M14: handles concurrent saveRecord operations serially without race condition file corruption', async () => {
    const concurrentPuts = Array.from({ length: 10 }).map((_, i) =>
      stateManager.set(`concurrent:key:${i}`, `value_${i}`),
    );

    await Promise.all(concurrentPuts);

    for (let i = 0; i < 10; i++) {
      const val = await stateManager.get<string>(`concurrent:key:${i}`);
      assert.equal(val, `value_${i}`);
    }
  });

  it('VULNERABILITY-M15: proves Task 03N Memory Cache operations never persist to StateManager disk storage', async () => {
    const memCache = new MemoryCacheManager();
    await memCache.start();

    await memCache.put(
      'ephemeral:secret',
      { data: 'transient_heap_only' },
      {
        taskId: 't1',
        workspaceId: 'w1',
      },
    );

    // Verify StateManager disk directory has no records of 'ephemeral:secret'
    const diskVal = await stateManager.get('ephemeral:secret');
    assert.equal(diskVal, null);

    const stateFilePath = path.join(storageDir, 'test-sec-state.enc');
    if (fs.existsSync(stateFilePath)) {
      const content = fs.readFileSync(stateFilePath, 'utf-8');
      assert.equal(content.includes('ephemeral:secret'), false);
      assert.equal(content.includes('transient_heap_only'), false);
    }

    await memCache.stop();
  });
});
