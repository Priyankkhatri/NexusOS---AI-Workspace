import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NotificationManager } from '../src/notifications/index.js';
import {
  UpdateManager,
  UpdateManifest,
  UpdateManifestVerifier,
  UpdateStagingStore,
} from '../src/updater/index.js';

describe('Task 03K Update Manager — Security Hardening Regression', () => {
  const signingKey = 'test_hardening_key_abc789_secure_enough';
  const testDir = path.join(process.cwd(), '.test-update-hardening-dir');
  let verifier: UpdateManifestVerifier;
  let stagingStore: UpdateStagingStore;
  let notificationManager: NotificationManager;
  let updateManager: UpdateManager;

  function createSignedManifest(
    manifestId: string,
    version: string,
    channel: 'stable' | 'beta' | 'nightly' | 'enterprise',
    sha256: string,
    minAntiRollbackVersion: string = '1.0.0',
    packageUrl: string = `https://updates.nexusos.dev/packages/${version}.bin`,
    publishedAt?: string,
  ): UpdateManifest {
    const pubAt = publishedAt || new Date().toISOString();
    const canonicalString = `${manifestId}:${version}:${channel}:${packageUrl}:${sha256}:${minAntiRollbackVersion}:${pubAt}`;
    const signature = crypto.createHmac('sha256', signingKey).update(canonicalString).digest('hex');
    return {
      manifestId,
      version,
      channel,
      packageUrl,
      sha256,
      signature,
      publishedAt: pubAt,
      minAntiRollbackVersion,
    };
  }

  beforeEach(() => {
    verifier = new UpdateManifestVerifier(signingKey);
    stagingStore = new UpdateStagingStore(testDir);
    notificationManager = new NotificationManager();
    updateManager = new UpdateManager(
      '1.0.0',
      'stable',
      verifier,
      stagingStore,
      notificationManager,
    );
  });

  afterEach(() => {
    try {
      stagingStore.clearStaging();
    } catch {
      /* Windows race */
    }
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      /* Windows ENOTEMPTY race */
    }
  });

  // ─── K-01: No default/empty signing key ────────────────────────────────

  it('K-01: rejects empty, whitespace-only, and absent signing keys', () => {
    assert.throws(() => new UpdateManifestVerifier(''), /non-empty signing key/i);
    assert.throws(() => new UpdateManifestVerifier('   '), /non-empty signing key/i);
  });

  // ─── K-02: Bypass checkForUpdates ──────────────────────────────────────

  it('K-02: rejects downloadAndVerifyUpdate when manifest was not verified by checkForUpdates', async () => {
    const pkgData = Buffer.from('payload_k02');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000101',
      '1.1.0',
      'stable',
      sha256,
    );

    // Skip checkForUpdates — go directly to downloadAndVerifyUpdate
    const result = await updateManager.downloadAndVerifyUpdate(manifest, pkgData);
    assert.equal(result, false);
    assert.ok(updateManager.getStatus().errorReason?.includes('not verified via checkForUpdates'));
  });

  // ─── K-03: packageUrl not in canonical string ──────────────────────────

  it('K-03: rejects manifests with tampered packageUrl (not covered by old canonical)', () => {
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000102',
      '1.1.0',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    // Tamper the packageUrl after signing
    const tamperedManifest = { ...manifest, packageUrl: 'https://evil.com/malware.bin' };
    const check = verifier.verifyManifest(tamperedManifest, '1.0.0');
    assert.equal(check.valid, false);
    assert.ok(check.reason?.includes('Cryptographic signature verification failed'));
  });

  // ─── K-04: publishedAt freshness / expiry ──────────────────────────────

  it('K-04: rejects manifests with publishedAt far in the future', () => {
    const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours ahead
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000103',
      '1.1.0',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '1.0.0',
      'https://updates.nexusos.dev/packages/1.1.0.bin',
      futureDate,
    );

    const check = verifier.verifyManifest(manifest, '1.0.0');
    assert.equal(check.valid, false);
    assert.ok(check.reason?.includes('too far in the future'));
  });

  it('K-04: rejects manifests with publishedAt older than 90 days (stale replay)', () => {
    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000104',
      '1.1.0',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '1.0.0',
      'https://updates.nexusos.dev/packages/1.1.0.bin',
      staleDate,
    );

    const check = verifier.verifyManifest(manifest, '1.0.0');
    assert.equal(check.valid, false);
    assert.ok(check.reason?.includes('expired'));
  });

  // ─── K-05: Signature redacted from persisted manifest ──────────────────

  it('K-05: redacts signature field from staged manifest metadata on disk', async () => {
    const pkgData = Buffer.from('payload_k05');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000105',
      '1.1.0',
      'stable',
      sha256,
    );

    await updateManager.checkForUpdates(manifest);
    await updateManager.downloadAndVerifyUpdate(manifest, pkgData);

    // Read the staged_manifest.json from disk
    const metadataPath = path.join(testDir, '.nexusos-update-staging', 'staged_manifest.json');
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const parsed = JSON.parse(raw);

    assert.equal(parsed.signature, '[REDACTED]');
    assert.equal(raw.includes(manifest.signature), false);
  });

  // ─── K-07: Rollback snapshot integrity ─────────────────────────────────

  it('K-07: rejects rollback when snapshot integrity has been tampered', async () => {
    const pkgData = Buffer.from('payload_k07');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000107',
      '1.1.0',
      'stable',
      sha256,
    );

    await updateManager.checkForUpdates(manifest);
    await updateManager.downloadAndVerifyUpdate(manifest, pkgData);
    await updateManager.stageAndActivateUpdate(async () => true);

    // Tamper the rollback snapshot
    const snapshotPath = path.join(testDir, '.nexusos-update-staging', 'rollback_snapshot.json');
    const raw = fs.readFileSync(snapshotPath, 'utf-8');
    const parsed = JSON.parse(raw);
    parsed.data.version = '0.0.1-malicious';
    fs.writeFileSync(snapshotPath, JSON.stringify(parsed), 'utf-8');

    const rollbackResult = await updateManager.rollback();
    assert.equal(rollbackResult, false);
    assert.ok(updateManager.getStatus().errorReason?.includes('No valid snapshot'));
  });

  // ─── K-08: Non-hex SHA-256 hash ────────────────────────────────────────

  it('K-08: rejects SHA-256 hash with non-hex characters (exactly 64 chars)', () => {
    const nonHexHash = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'; // 64 z's
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000108',
      '1.1.0',
      'stable',
      nonHexHash,
    );

    const check = verifier.verifyManifest(manifest, '1.0.0');
    assert.equal(check.valid, false);
    assert.ok(check.reason?.includes('SHA-256'));
  });

  it('K-08: rejects non-hex hash in verifyPackageIntegrity', () => {
    const result = verifier.verifyPackageIntegrity(
      Buffer.from('test'),
      'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg', // 64 non-hex
    );
    assert.equal(result, false);
  });

  // ─── K-09: No predictable default payload ──────────────────────────────

  it('K-09: rejects download without explicit package data', async () => {
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000109',
      '1.1.0',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    await updateManager.checkForUpdates(manifest);
    const result = await updateManager.downloadAndVerifyUpdate(manifest);
    assert.equal(result, false);
    assert.ok(updateManager.getStatus().errorReason?.includes('No package data'));
  });

  // ─── K-10: Malformed semver bypass ─────────────────────────────────────

  it('K-10: rejects malformed semver versions that could bypass version comparison', () => {
    // Version with trailing garbage that was previously coerced to equal value
    const manifest1 = createSignedManifest(
      '00000000-0000-4000-8000-000000000110',
      '1.0.0-malicious',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const check1 = verifier.verifyManifest(manifest1, '1.0.0');
    assert.equal(check1.valid, false);
    assert.ok(check1.reason?.includes('not valid strict semver'));

    // Extra version segments that were silently ignored
    const manifest2 = createSignedManifest(
      '00000000-0000-4000-8000-000000000111',
      '1.1.0.0.0',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const check2 = verifier.verifyManifest(manifest2, '1.0.0');
    assert.equal(check2.valid, false);
    assert.ok(check2.reason?.includes('not valid strict semver'));
  });

  // ─── Same-version replay ───────────────────────────────────────────────

  it('K-REPLAY: rejects same-version manifest as replay attack', () => {
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000112',
      '1.0.0', // Same as current
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const check = verifier.verifyManifest(manifest, '1.0.0');
    assert.equal(check.valid, false);
    assert.ok(check.reason?.includes('Downgrade attack detected'));
  });

  // ─── Channel bypass attempt ────────────────────────────────────────────

  it('K-CHANNEL: rejects cross-channel update even with valid signature', async () => {
    const pkgData = Buffer.from('payload_channel_test');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000113',
      '1.1.0',
      'nightly', // Manager is on 'stable'
      sha256,
    );

    const result = await updateManager.checkForUpdates(manifest);
    assert.equal(result, null);
    assert.ok(updateManager.getStatus().errorReason?.includes('channel mismatch'));
  });

  // ─── Activation without staging ────────────────────────────────────────

  it('K-STATE: rejects activation when not in STAGED state', async () => {
    const result = await updateManager.stageAndActivateUpdate(async () => true);
    assert.equal(result, false);
    assert.ok(updateManager.getStatus().errorReason?.includes('not staged'));
  });

  // ─── 03J Notification regression check ─────────────────────────────────

  it('REGRESSION-J: notification lock-screen privacy redaction still works after 03K changes', () => {
    const nm = new NotificationManager();
    const item = nm.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Sensitive Alert',
      message: 'Contains secret_value_12345',
    });

    assert.equal(item.isPrivacyRedacted, false);

    nm.setLockScreenActive(true);
    const pending = nm.queue.peekAll();
    assert.equal(pending[0].isPrivacyRedacted, true);
    assert.ok(pending[0].message.includes('[LOCK_SCREEN_PRIVACY]'));
    assert.equal(pending[0].message.includes('secret_value_12345'), false);
  });
});
