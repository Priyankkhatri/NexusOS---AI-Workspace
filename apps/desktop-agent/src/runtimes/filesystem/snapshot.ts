import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FileSnapshot {
  snapshotId: string;
  originalPath: string;
  canonicalPath: string;
  sha256Hash?: string;
  size: number;
  createdAt: string;
  backupPath?: string;
  taskCorrelationId?: string;
}

export class SnapshotManager {
  private readonly snapshots = new Map<string, FileSnapshot>();

  /**
   * Captures snapshot metadata and optionally creates a local backup copy
   * before mutating or deleting an existing file.
   */
  public async createSnapshot(
    canonicalPath: string,
    storageDir: string,
    taskCorrelationId?: string,
  ): Promise<FileSnapshot | undefined> {
    if (!fs.existsSync(canonicalPath)) {
      return undefined;
    }

    const stat = fs.statSync(canonicalPath);
    if (!stat.isFile()) {
      return undefined;
    }

    const snapshotId = `snap_${crypto.randomUUID()}`;
    const fileBuffer = fs.readFileSync(canonicalPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Store backup copy inside local snapshot directory
    const snapshotSubdir = path.join(storageDir, '.nexusos-snapshots');
    if (!fs.existsSync(snapshotSubdir)) {
      fs.mkdirSync(snapshotSubdir, { recursive: true });
    }

    const backupPath = path.join(snapshotSubdir, `${snapshotId}.bak`);
    fs.writeFileSync(backupPath, fileBuffer);

    const snapshot: FileSnapshot = Object.freeze({
      snapshotId,
      originalPath: canonicalPath,
      canonicalPath,
      sha256Hash: hash,
      size: stat.size,
      createdAt: new Date().toISOString(),
      backupPath,
      taskCorrelationId,
    });

    this.snapshots.set(snapshotId, snapshot);
    return snapshot;
  }

  public getSnapshot(snapshotId: string): FileSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Restores a file from a snapshot if available.
   */
  public async restoreSnapshot(snapshotId: string): Promise<boolean> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || !snapshot.backupPath || !fs.existsSync(snapshot.backupPath)) {
      return false;
    }

    const backupBuffer = fs.readFileSync(snapshot.backupPath);
    fs.writeFileSync(snapshot.canonicalPath, backupBuffer);
    return true;
  }

  /**
   * Cleanup backup file for a snapshot
   */
  public cleanupSnapshot(snapshotId: string): void {
    const snapshot = this.snapshots.get(snapshotId);
    if (snapshot?.backupPath && fs.existsSync(snapshot.backupPath)) {
      try {
        fs.unlinkSync(snapshot.backupPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    this.snapshots.delete(snapshotId);
  }

  public clearAllSnapshots(): void {
    for (const snapshotId of Array.from(this.snapshots.keys())) {
      this.cleanupSnapshot(snapshotId);
    }
  }
}
