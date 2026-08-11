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

describe('Task 03K Update Manager & Security Verification', () => {
  const signingKey = 'test_release_signing_key_secret_123';
  const testDir = path.join(process.cwd(), '.test-update-staging-dir');
  let verifier: UpdateManifestVerifier;
  let stagingStore: UpdateStagingStore;
  let notificationManager: NotificationManager;
  let updateManager: UpdateManager;

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
    // K-03 FIX: Include packageUrl and publishedAt in canonical string
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

  it('verifies cryptographically signed manifests and detects tampered signatures', () => {
    const validManifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000001',
      '1.1.0',
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const check1 = verifier.verifyManifest(validManifest, '1.0.0');
    assert.equal(check1.valid, true);

    const tamperedManifest = {
      ...validManifest,
      signature: 'bad_signature_hash_bad_signature_hash_bad_signature_hash_bad_sign',
    };
    const check2 = verifier.verifyManifest(tamperedManifest, '1.0.0');
    assert.equal(check2.valid, false);
    assert.ok(check2.reason?.includes('Cryptographic signature verification failed'));
  });

  it('blocks downgrade and anti-rollback attacks safely', () => {
    const downgradeManifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000002',
      '0.9.0', // Target 0.9.0 is less than current 1.0.0
      'stable',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const check = verifier.verifyManifest(downgradeManifest, '1.0.0');
    assert.equal(check.valid, false);
    assert.ok(check.reason?.includes('Downgrade attack detected'));
  });

  it('verifies package SHA-256 checksum integrity', () => {
    const pkgData = Buffer.from('nexusos_release_binary_payload_v1.1.0');
    const expectedSha256 = crypto.createHash('sha256').update(pkgData).digest('hex');

    const valid = verifier.verifyPackageIntegrity(pkgData, expectedSha256);
    assert.equal(valid, true);

    const corruptData = Buffer.from('nexusos_corrupted_payload');
    const invalid = verifier.verifyPackageIntegrity(corruptData, expectedSha256);
    assert.equal(invalid, false);
  });

  it('completes update lifecycle: check -> verify -> stage -> health-gated activate', async () => {
    const pkgData = Buffer.from('nexusos_release_binary_payload_v1.1.0');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000003',
      '1.1.0',
      'stable',
      sha256,
    );

    // 1. Check for updates
    const discovered = await updateManager.checkForUpdates(manifest);
    assert.ok(discovered);
    assert.equal(updateManager.getStatus().state, 'AVAILABLE');

    // 2. Download and verify package
    const verified = await updateManager.downloadAndVerifyUpdate(manifest, pkgData);
    assert.equal(verified, true);
    assert.equal(updateManager.getStatus().state, 'STAGED');

    // 3. Stage and activate update with health gate
    const activated = await updateManager.stageAndActivateUpdate(async () => true); // health check passes
    assert.equal(activated, true);
    assert.equal(updateManager.getStatus().state, 'ACTIVATED');
    assert.equal(updateManager.getStatus().currentVersion, '1.1.0');
  });

  it('fails closed and rolls back automatically when health-gated activation fails', async () => {
    const pkgData = Buffer.from('nexusos_release_binary_payload_v1.2.0');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000004',
      '1.2.0',
      'stable',
      sha256,
    );

    await updateManager.checkForUpdates(manifest);
    await updateManager.downloadAndVerifyUpdate(manifest, pkgData);

    // Stage and activate with failing health check
    const activated = await updateManager.stageAndActivateUpdate(async () => false); // health check FAILS
    assert.equal(activated, false);
    assert.equal(updateManager.getStatus().state, 'ROLLED_BACK');
    assert.equal(updateManager.getStatus().currentVersion, '1.0.0');
  });

  it('supports explicit rollback to Last Known Good version snapshot', async () => {
    const pkgData = Buffer.from('nexusos_release_binary_payload_v1.1.0');
    const sha256 = crypto.createHash('sha256').update(pkgData).digest('hex');
    const manifest = createSignedManifest(
      '00000000-0000-4000-8000-000000000005',
      '1.1.0',
      'stable',
      sha256,
    );

    await updateManager.checkForUpdates(manifest);
    await updateManager.downloadAndVerifyUpdate(manifest, pkgData);
    await updateManager.stageAndActivateUpdate(async () => true);

    assert.equal(updateManager.getStatus().currentVersion, '1.1.0');

    // Explicit rollback call
    const rolledBack = await updateManager.rollback();
    assert.equal(rolledBack, true);
    assert.equal(updateManager.getStatus().state, 'ROLLED_BACK');
    assert.equal(updateManager.getStatus().currentVersion, '1.0.0');
  });
});
