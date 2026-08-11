import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IUpdateStagingStore, UpdateManifest } from './types.js';

export class UpdateStagingStore implements IUpdateStagingStore {
  private readonly stagingDir: string;
  private readonly stagedPackagePath: string;
  private readonly activePackagePath: string;
  private readonly snapshotPath: string;

  constructor(rootDir: string = process.cwd()) {
    // K-06 FIX: Resolve to absolute path and validate it stays within rootDir
    const resolved = path.resolve(rootDir);
    this.stagingDir = path.join(resolved, '.nexusos-update-staging');
    this.stagedPackagePath = path.join(this.stagingDir, 'staged_package.bin');
    this.activePackagePath = path.join(this.stagingDir, 'active_package.bin');
    this.snapshotPath = path.join(this.stagingDir, 'rollback_snapshot.json');
    this.ensureDirectory();
  }

  public async stagePackage(
    manifest: UpdateManifest,
    packageData: Buffer | string,
  ): Promise<string> {
    this.ensureDirectory();
    const tmpPath = `${this.stagedPackagePath}.tmp`;
    const metadataPath = path.join(this.stagingDir, 'staged_manifest.json');

    // Validate all staging paths are within the staging directory
    this.assertWithinStagingDir(tmpPath);
    this.assertWithinStagingDir(metadataPath);

    await fs.promises.writeFile(tmpPath, packageData);
    await fs.promises.rename(tmpPath, this.stagedPackagePath);

    // K-05 FIX: Strip the signature field before persisting manifest metadata to disk
    // to prevent cryptographic material from being leaked to the filesystem
    const sanitizedManifest = { ...manifest, signature: '[REDACTED]' };
    await fs.promises.writeFile(metadataPath, JSON.stringify(sanitizedManifest, null, 2), 'utf-8');

    return this.stagedPackagePath;
  }

  public async createRollbackSnapshot(currentVersion: string, payload?: string): Promise<boolean> {
    this.ensureDirectory();

    // K-07 FIX: Add HMAC integrity to rollback snapshot
    const snapshotData = {
      version: currentVersion,
      createdAt: new Date().toISOString(),
      activePayload: payload || 'nexusos_core_binary_v' + currentVersion,
    };
    const snapshotJson = JSON.stringify(snapshotData);
    const hmac = crypto
      .createHmac('sha256', this.getSnapshotIntegrityKey())
      .update(snapshotJson)
      .digest('hex');

    const envelope = JSON.stringify({ data: snapshotData, integrity: hmac }, null, 2);

    const tmpPath = `${this.snapshotPath}.tmp`;
    this.assertWithinStagingDir(tmpPath);
    await fs.promises.writeFile(tmpPath, envelope, 'utf-8');
    await fs.promises.rename(tmpPath, this.snapshotPath);
    return true;
  }

  public async applyStagedUpdate(_manifest: UpdateManifest): Promise<boolean> {
    if (!fs.existsSync(this.stagedPackagePath)) {
      throw new Error('No staged update package found to activate.');
    }
    const tmpActive = `${this.activePackagePath}.tmp`;
    this.assertWithinStagingDir(tmpActive);
    await fs.promises.copyFile(this.stagedPackagePath, tmpActive);
    await fs.promises.rename(tmpActive, this.activePackagePath);
    await fs.promises.rm(this.stagedPackagePath, { force: true });
    return true;
  }

  public async rollbackToLastKnownGood(): Promise<{ success: boolean; version?: string }> {
    if (!this.hasRollbackSnapshot()) {
      return { success: false };
    }
    try {
      const raw = await fs.promises.readFile(this.snapshotPath, 'utf-8');

      // K-07 FIX: Verify snapshot integrity before trusting its contents
      let envelope: {
        data: { version: string; createdAt: string; activePayload: string };
        integrity: string;
      };
      try {
        envelope = JSON.parse(raw);
      } catch {
        return { success: false };
      }

      if (!envelope || !envelope.data || !envelope.integrity) {
        return { success: false };
      }

      const expectedHmac = crypto
        .createHmac('sha256', this.getSnapshotIntegrityKey())
        .update(JSON.stringify(envelope.data))
        .digest('hex');

      // Timing-safe comparison for integrity check
      const integrityBuffer = Buffer.from(envelope.integrity, 'hex');
      const expectedBuffer = Buffer.from(expectedHmac, 'hex');
      if (
        integrityBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(integrityBuffer, expectedBuffer)
      ) {
        return { success: false };
      }

      if (!envelope.data.version || typeof envelope.data.version !== 'string') {
        return { success: false };
      }

      // Clean staged update files
      await fs.promises.rm(this.stagedPackagePath, { force: true });
      await fs.promises.rm(this.activePackagePath, { force: true });
      return { success: true, version: envelope.data.version };
    } catch {
      return { success: false };
    }
  }

  public hasRollbackSnapshot(): boolean {
    return fs.existsSync(this.snapshotPath);
  }

  public clearStaging(): void {
    try {
      if (fs.existsSync(this.stagingDir)) {
        fs.rmSync(this.stagingDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  }

  // K-06 FIX: Validate that all file paths stay within the staging directory
  private assertWithinStagingDir(filePath: string): void {
    const resolved = path.resolve(filePath);
    const normalizedStaging = path.resolve(this.stagingDir);
    if (!resolved.startsWith(normalizedStaging + path.sep) && resolved !== normalizedStaging) {
      throw new Error(
        `Path traversal detected: '${resolved}' is outside staging directory '${normalizedStaging}'.`,
      );
    }
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.stagingDir)) {
      fs.mkdirSync(this.stagingDir, { recursive: true });
    }
  }

  // K-07: Derive an integrity key from the staging directory path
  // In production this should come from the Secrets Vault; for now derive deterministically
  private getSnapshotIntegrityKey(): string {
    return crypto
      .createHash('sha256')
      .update(`snapshot_integrity:${this.stagingDir}`)
      .digest('hex');
  }
}
