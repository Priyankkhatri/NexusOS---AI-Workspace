import crypto from 'node:crypto';
import { IUpdateManifestVerifier, UpdateManifest } from './types.js';

function parseSemVer(v: string): number[] {
  const clean = v.replace(/^v/i, '').trim();
  const parts = clean.split('.').map((p) => parseInt(p, 10));
  return parts.map((n) => (Number.isNaN(n) ? 0 : n));
}

function compareSemVer(v1: string, v2: string): number {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

export class UpdateManifestVerifier implements IUpdateManifestVerifier {
  constructor(
    private readonly signingPublicKeyOrHmacKey: string = 'nexusos_release_signing_key_v1',
  ) {}

  public verifyManifest(
    manifest: UpdateManifest,
    currentVersion: string,
  ): { valid: boolean; reason?: string } {
    if (!manifest) {
      return { valid: false, reason: 'Manifest is null or undefined.' };
    }

    // 1. Validate required fields
    if (!manifest.manifestId || !manifest.version || !manifest.sha256 || !manifest.signature) {
      return { valid: false, reason: 'Manifest missing mandatory signature or hash metadata.' };
    }

    if (manifest.sha256.length !== 64) {
      return {
        valid: false,
        reason: 'Manifest SHA-256 hash format is invalid (must be 64 hex chars).',
      };
    }

    // 2. Cryptographic Signature Verification
    const canonicalString = `${manifest.manifestId}:${manifest.version}:${manifest.channel}:${manifest.sha256}:${manifest.minAntiRollbackVersion}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.signingPublicKeyOrHmacKey)
      .update(canonicalString)
      .digest('hex');

    if (manifest.signature !== expectedSignature) {
      return {
        valid: false,
        reason: 'Cryptographic signature verification failed for update manifest.',
      };
    }

    // 3. Anti-Rollback / Version Downgrade Protection
    if (compareSemVer(manifest.version, currentVersion) <= 0) {
      return {
        valid: false,
        reason: `Downgrade attack detected. Target version '${manifest.version}' <= current version '${currentVersion}'.`,
      };
    }

    if (compareSemVer(manifest.version, manifest.minAntiRollbackVersion) < 0) {
      return {
        valid: false,
        reason: `Anti-rollback policy violation. Target version '${manifest.version}' < minimum allowed anti-rollback version '${manifest.minAntiRollbackVersion}'.`,
      };
    }

    return { valid: true };
  }

  public verifyPackageIntegrity(packageData: Buffer | string, expectedSha256: string): boolean {
    if (!packageData || !expectedSha256) return false;

    const computedHash = crypto.createHash('sha256').update(packageData).digest('hex');

    return computedHash.toLowerCase() === expectedSha256.toLowerCase();
  }
}
