import crypto from 'node:crypto';
import { RecoveryManifestSchema } from './schemas.js';
import { IRecoveryManifestStore, RecoveryManifest, StepCheckpoint } from './types.js';

export class RecoveryManifestStore implements IRecoveryManifestStore {
  private storedManifest: RecoveryManifest | null = null;
  private readonly hmacSecretKey: string;

  constructor(hmacSecretKey: string = 'nexusos_internal_manifest_signing_key_v1') {
    this.hmacSecretKey = hmacSecretKey;
  }

  public createManifest(
    agentId: string,
    checkpoints: StepCheckpoint[],
    exitCode?: number,
  ): RecoveryManifest {
    const manifestId = crypto.randomUUID();
    const crashedAt = new Date().toISOString();

    const canonicalString = `${manifestId}:${agentId}:${crashedAt}:${JSON.stringify(checkpoints)}`;
    const manifestHash = crypto
      .createHmac('sha256', this.hmacSecretKey)
      .update(canonicalString)
      .digest('hex');

    return {
      manifestId,
      agentId,
      crashedAt,
      exitCode,
      activeStepCheckpoints: checkpoints,
      manifestHash,
    };
  }

  public saveManifest(manifest: RecoveryManifest): void {
    if (!manifest) return;

    // Validate schema
    const parseRes = RecoveryManifestSchema.safeParse(manifest);
    if (!parseRes.success) {
      throw new Error('[RecoveryManifestError] Recovery manifest failed schema validation.');
    }

    // Verify cryptographic HMAC integrity before saving
    if (!this.verifyManifestIntegrity(manifest)) {
      throw new Error(
        '[RecoveryManifestError] Recovery manifest failed cryptographic hash verification.',
      );
    }

    this.storedManifest = JSON.parse(JSON.stringify(manifest));
  }

  public loadManifest(): RecoveryManifest | null {
    if (!this.storedManifest) return null;

    // Validate schema
    const parseRes = RecoveryManifestSchema.safeParse(this.storedManifest);
    if (!parseRes.success) {
      return null;
    }

    // Verify cryptographic HMAC integrity
    if (!this.verifyManifestIntegrity(this.storedManifest)) {
      return null;
    }

    return JSON.parse(JSON.stringify(this.storedManifest));
  }

  public verifyManifestIntegrity(manifest: RecoveryManifest): boolean {
    if (!manifest || !manifest.manifestHash) return false;

    const canonicalString = `${manifest.manifestId}:${manifest.agentId}:${manifest.crashedAt}:${JSON.stringify(manifest.activeStepCheckpoints)}`;
    const expectedHash = crypto
      .createHmac('sha256', this.hmacSecretKey)
      .update(canonicalString)
      .digest('hex');

    // Constant time string comparison to prevent timing attacks
    return (
      manifest.manifestHash.length === expectedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(manifest.manifestHash, 'utf-8'),
        Buffer.from(expectedHash, 'utf-8'),
      )
    );
  }

  public clearManifest(): void {
    this.storedManifest = null;
  }
}
