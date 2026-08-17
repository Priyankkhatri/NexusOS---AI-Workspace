import type {
  IDECapabilityProfile,
  IDEContextRequest,
  IDEContextSnapshot,
  IDEDiagnosticItem,
  IDEType,
} from './types.js';
import { IDEContextRequestSchema } from './types.js';

export class IDEIntegrationAdapter {
  private readonly profiles = new Map<IDEType, IDECapabilityProfile>();
  private readonly snapshots = new Map<IDEType, IDEContextSnapshot>();
  private readonly diagnostics = new Map<string, IDEDiagnosticItem[]>();

  constructor() {
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
