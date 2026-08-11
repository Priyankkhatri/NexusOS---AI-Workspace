import fs from 'node:fs';
import path from 'node:path';
import { IUpdateStagingStore, UpdateManifest } from './types.js';

export class UpdateStagingStore implements IUpdateStagingStore {
  private readonly stagingDir: string;
  private readonly stagedPackagePath: string;
  private readonly activePackagePath: string;
  private readonly snapshotPath: string;

  constructor(rootDir: string = process.cwd()) {
    this.stagingDir = path.join(rootDir, '.nexusos-update-staging');
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

    await fs.promises.writeFile(tmpPath, packageData);
    await fs.promises.rename(tmpPath, this.stagedPackagePath);
    await fs.promises.writeFile(metadataPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return this.stagedPackagePath;
  }

  public async createRollbackSnapshot(currentVersion: string, payload?: string): Promise<boolean> {
    this.ensureDirectory();
    const snapshot = {
      version: currentVersion,
      createdAt: new Date().toISOString(),
      activePayload: payload || 'nexusos_core_binary_v' + currentVersion,
    };
    const tmpPath = `${this.snapshotPath}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    await fs.promises.rename(tmpPath, this.snapshotPath);
    return true;
  }

  public async applyStagedUpdate(_manifest: UpdateManifest): Promise<boolean> {
    if (!fs.existsSync(this.stagedPackagePath)) {
      throw new Error('No staged update package found to activate.');
    }
    const tmpActive = `${this.activePackagePath}.tmp`;
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
      const snapshot = JSON.parse(raw);
      if (!snapshot || typeof snapshot.version !== 'string' || !snapshot.version) {
        return { success: false };
      }
      // Clean staged update files
      await fs.promises.rm(this.stagedPackagePath, { force: true });
      await fs.promises.rm(this.activePackagePath, { force: true });
      return { success: true, version: snapshot.version };
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

  private ensureDirectory(): void {
    if (!fs.existsSync(this.stagingDir)) {
      fs.mkdirSync(this.stagingDir, { recursive: true });
    }
  }
}
