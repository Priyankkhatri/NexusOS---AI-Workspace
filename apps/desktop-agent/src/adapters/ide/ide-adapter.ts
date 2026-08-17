import fs from 'node:fs';
import path from 'node:path';
import type { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import type {
  IDECapabilityProfile,
  IDEContextRequest,
  IDEContextSnapshot,
  IDEDiagnosticItem,
  IDEDiffRequest,
  IDEDiffResult,
  IDEType,
} from './types.js';
import { IDEContextRequestSchema, IDEDiffRequestSchema, IDEAdapterError } from './types.js';

export class IDEIntegrationAdapter {
  private readonly profiles = new Map<IDEType, IDECapabilityProfile>();
  private readonly snapshots = new Map<IDEType, IDEContextSnapshot>();
  private readonly diagnostics = new Map<string, IDEDiagnosticItem[]>();

  constructor(private readonly leaseBoundary?: ExecutionLeaseBoundary) {
    // Register default generic IDE capability profile
    this.registerIDE({
      ideType: 'generic',
      name: 'Generic IDE Adapter Protocol',
      version: '1.0.0',
      supportedActions: ['ide.getContext', 'ide.applyDiff', 'ide.getDiagnostics'],
      workspaceRoots: [process.cwd()],
    });
  }

  /**
   * Registers an IDE extension capability profile.
   */
  public registerIDE(profile: IDECapabilityProfile): void {
    if (!profile || !profile.ideType) return;
    this.profiles.set(profile.ideType, { ...profile });
  }

  /**
   * Unregisters an IDE extension adapter.
   */
  public unregisterIDE(ideType: IDEType): boolean {
    const existed = this.profiles.has(ideType);
    this.profiles.delete(ideType);
    this.snapshots.delete(ideType);
    return existed;
  }

  /**
   * Retrieves capability profile for specified IDE type.
   */
  public getCapabilities(ideType: IDEType = 'generic'): IDECapabilityProfile | undefined {
    return this.profiles.get(ideType);
  }

  /**
   * Updates current active IDE context snapshot.
   */
  public updateContext(snapshot: IDEContextSnapshot): void {
    if (!snapshot || !snapshot.ideType) return;
    this.snapshots.set(snapshot.ideType, {
      ...snapshot,
      timestamp: Date.now(),
    });
  }

  /**
   * Retrieves IDE context snapshot for an authenticated RPC request.
   */
  public getContext(request: IDEContextRequest): IDEContextSnapshot | undefined {
    const parsed = IDEContextRequestSchema.parse(request);
    const ideType = parsed.ideType || 'generic';
    return this.snapshots.get(ideType) || this.snapshots.get('generic');
  }

  /**
   * Applies an IDE diff patch to a workspace-constrained target file under lease authorization.
   */
  public async applyDiff(request: IDEDiffRequest): Promise<IDEDiffResult> {
    const parsed = IDEDiffRequestSchema.parse(request);

    // 1. Re-validate execution lease header if leaseBoundary is injected
    if (this.leaseBoundary) {
      const leaseRes = await this.leaseBoundary.validateLease(parsed.leaseHeader);
      if (!leaseRes.valid) {
        throw new IDEAdapterError(
          'Lease re-validation failed for IDE applyDiff operation',
          'UNAUTHORIZED',
        );
      }
    }

    // 2. Resolve safe canonical target path inside workspace root
    const safeTargetPath = this.resolveSafePath(parsed.targetFilePath, parsed.workspaceRoot);

    if (parsed.dryRun) {
      return {
        success: true,
        targetFilePath: safeTargetPath,
        bytesWritten: Buffer.byteLength(parsed.diffContent, 'utf-8'),
        dryRun: true,
      };
    }

    try {
      let backupPath: string | undefined;
      if (fs.existsSync(safeTargetPath)) {
        backupPath = `${safeTargetPath}.bak`;
        await fs.promises.copyFile(safeTargetPath, backupPath);
      }

      await fs.promises.mkdir(path.dirname(safeTargetPath), { recursive: true });
      await fs.promises.writeFile(safeTargetPath, parsed.diffContent, 'utf-8');
      const bytesWritten = Buffer.byteLength(parsed.diffContent, 'utf-8');

      return {
        success: true,
        targetFilePath: safeTargetPath,
        bytesWritten,
        backupPath,
        dryRun: false,
      };
    } catch (err) {
      if (err instanceof IDEAdapterError) throw err;
      throw new IDEAdapterError(
        `Failed to apply diff to target file '${safeTargetPath}'`,
        'APPLY_FAILED',
        err,
      );
    }
  }

  /**
   * Verifies target path does not escape authorized workspace root (anti-traversal / anti-symlink escape).
   */
  public resolveSafePath(targetFilePath: string, workspaceRoot: string): string {
    if (!targetFilePath || !workspaceRoot) {
      throw new IDEAdapterError(
        'Target file path and workspace root must be specified',
        'INVALID_INPUT',
      );
    }

    if (targetFilePath.includes('\0') || workspaceRoot.includes('\0')) {
      throw new IDEAdapterError('Null bytes prohibited in file path', 'PATH_TRAVERSAL');
    }

    const normalizedWorkspace = path.resolve(workspaceRoot);
    const resolvedTarget = path.isAbsolute(targetFilePath)
      ? path.resolve(targetFilePath)
      : path.resolve(normalizedWorkspace, targetFilePath);

    if (
      !resolvedTarget.startsWith(normalizedWorkspace + path.sep) &&
      resolvedTarget !== normalizedWorkspace
    ) {
      throw new IDEAdapterError(
        `Path traversal attempt blocked: path '${targetFilePath}' escapes workspace root '${workspaceRoot}'`,
        'PATH_TRAVERSAL',
      );
    }

    // Symlink escape check if target file exists
    if (fs.existsSync(resolvedTarget)) {
      const realTarget = fs.realpathSync(resolvedTarget);
      if (
        !realTarget.startsWith(normalizedWorkspace + path.sep) &&
        realTarget !== normalizedWorkspace
      ) {
        throw new IDEAdapterError(
          `Symlink escape attempt blocked: real target '${realTarget}' escapes workspace root '${workspaceRoot}'`,
          'PATH_TRAVERSAL',
        );
      }
    }

    return resolvedTarget;
  }

  /**
   * Updates diagnostic error/warning items for a workspace file.
   */
  public updateDiagnostics(filePath: string, items: IDEDiagnosticItem[]): void {
    if (!filePath) return;
    this.diagnostics.set(filePath, items);
  }

  /**
   * Retrieves diagnostic error/warning items.
   */
  public getDiagnostics(filePath?: string): IDEDiagnosticItem[] {
    if (filePath) {
      return this.diagnostics.get(filePath) || [];
    }
    const all: IDEDiagnosticItem[] = [];
    for (const items of this.diagnostics.values()) {
      all.push(...items);
    }
    return all;
  }

  /**
   * Resets active snapshots and diagnostics.
   */
  public reset(): void {
    this.snapshots.clear();
    this.diagnostics.clear();
  }
}
