import crypto from 'node:crypto';
import { IUpdateManifestVerifier, UpdateManifest } from './types.js';

const STRICT_SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)$/;
const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

function parseSemVer(v: string): number[] | null {
  const match = v.trim().match(STRICT_SEMVER_REGEX);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function compareSemVer(v1: string, v2: string): number | null {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  if (!p1 || !p2) return null; // Signal malformed version — fail closed
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return 1;
    if (p1[i] < p2[i]) return -1;
  }
  return 0;
}

export class UpdateManifestVerifier implements IUpdateManifestVerifier {
  constructor(private readonly signingKey: string) {
    // K-01 FIX: No default key — caller MUST supply a non-empty signing key
    if (!signingKey || signingKey.trim().length === 0) {
      throw new Error(
        'UpdateManifestVerifier requires a non-empty signing key. ' +
          'Do not use default or hardcoded keys in production.',
      );
    }
  }

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

    if (!manifest.channel || !manifest.packageUrl || !manifest.minAntiRollbackVersion) {
      return {
        valid: false,
        reason: 'Manifest missing required channel, URL, or anti-rollback fields.',
      };
    }

    // K-08 FIX: Validate SHA-256 is exactly 64 hex characters
    if (!HEX_64_REGEX.test(manifest.sha256)) {
      return {
        valid: false,
        reason: 'Manifest SHA-256 hash format is invalid (must be 64 hex chars).',
      };
    }

    // K-10 FIX: Validate version strings are strict semver before comparison
    if (!parseSemVer(manifest.version)) {
      return {
        valid: false,
        reason: `Manifest version '${manifest.version}' is not valid strict semver (MAJOR.MINOR.PATCH).`,
      };
    }
    if (!parseSemVer(currentVersion)) {
      return {
        valid: false,
        reason: `Current version '${currentVersion}' is not valid strict semver.`,
      };
    }
    if (!parseSemVer(manifest.minAntiRollbackVersion)) {
      return {
        valid: false,
        reason: `Anti-rollback version '${manifest.minAntiRollbackVersion}' is not valid strict semver.`,
      };
    }

    // K-04 FIX: Validate publishedAt is a valid ISO 8601 date and not in the future
    if (!manifest.publishedAt || isNaN(Date.parse(manifest.publishedAt))) {
      return { valid: false, reason: 'Manifest publishedAt is missing or not valid ISO 8601.' };
    }
    const publishedTime = new Date(manifest.publishedAt).getTime();
    const now = Date.now();
    const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000; // 24 hours
    if (publishedTime > now + MAX_CLOCK_SKEW_MS) {
      return {
        valid: false,
        reason: 'Manifest publishedAt is too far in the future (possible replay/forgery).',
      };
    }
    // Reject manifests older than 90 days to prevent stale replay
    const MAX_MANIFEST_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    if (now - publishedTime > MAX_MANIFEST_AGE_MS) {
      return { valid: false, reason: 'Manifest has expired (publishedAt is too old).' };
    }

    // 2. Cryptographic Signature Verification
    // K-03 FIX: Include packageUrl and publishedAt in canonical string
    const canonicalString = `${manifest.manifestId}:${manifest.version}:${manifest.channel}:${manifest.packageUrl}:${manifest.sha256}:${manifest.minAntiRollbackVersion}:${manifest.publishedAt}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.signingKey)
      .update(canonicalString)
      .digest('hex');

    // Use timing-safe comparison to prevent timing side-channel
    const sigBuffer = Buffer.from(manifest.signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return {
        valid: false,
        reason: 'Cryptographic signature verification failed for update manifest.',
      };
    }

    // 3. Anti-Rollback / Version Downgrade Protection
    const versionCmp = compareSemVer(manifest.version, currentVersion);
    if (versionCmp === null || versionCmp <= 0) {
      return {
        valid: false,
        reason: `Downgrade attack detected. Target version '${manifest.version}' <= current version '${currentVersion}'.`,
      };
    }

    const rollbackCmp = compareSemVer(manifest.version, manifest.minAntiRollbackVersion);
    if (rollbackCmp === null || rollbackCmp < 0) {
      return {
        valid: false,
        reason: `Anti-rollback policy violation. Target version '${manifest.version}' < minimum allowed anti-rollback version '${manifest.minAntiRollbackVersion}'.`,
      };
    }

    return { valid: true };
  }

  public verifyPackageIntegrity(packageData: Buffer | string, expectedSha256: string): boolean {
    if (!packageData || !expectedSha256) return false;

    // K-08 FIX: Also validate expected hash format
    if (!HEX_64_REGEX.test(expectedSha256)) return false;

    const computedHash = crypto.createHash('sha256').update(packageData).digest('hex');

    // Use timing-safe comparison
    const computed = Buffer.from(computedHash, 'hex');
    const expected = Buffer.from(expectedSha256.toLowerCase(), 'hex');
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  }
}
