import fs from 'node:fs';
import path from 'node:path';
import {
  WorkspaceDirectoryJailConfig,
  WorkspaceDirectoryJailConfigSchema,
} from '@nexusos/contracts';

export interface WorkspaceAccessValidationResult {
  allowed: boolean;
  workspace?: WorkspaceDirectoryJailConfig;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Workspace Directory Jail Manager
 * Enforces per-workspace filesystem isolation, tenant binding, and read-only boundaries.
 */
export class WorkspaceDirectoryJail {
  private readonly workspaces = new Map<string, WorkspaceDirectoryJailConfig>();

  /**
   * Registers a workspace directory jail.
   */
  public registerWorkspace(config: WorkspaceDirectoryJailConfig): void {
    const validated = WorkspaceDirectoryJailConfigSchema.parse(config);

    // Normalize and canonicalize rootPath if directory exists
    let canonicalRoot = path.normalize(validated.rootPath);
    if (process.platform === 'win32' && /^[a-z]:/i.test(canonicalRoot)) {
      canonicalRoot = canonicalRoot[0]!.toUpperCase() + canonicalRoot.substring(1);
    }
    try {
      if (fs.existsSync(canonicalRoot)) {
        canonicalRoot = fs.realpathSync(canonicalRoot);
      }
    } catch {
      // Retain normalized path if realpathSync fails
    }

    this.workspaces.set(validated.workspaceId, {
      ...validated,
      rootPath: canonicalRoot,
    });
  }

  /**
   * Unregisters a workspace jail.
   */
  public unregisterWorkspace(workspaceId: string): boolean {
    return this.workspaces.delete(workspaceId);
  }

  /**
   * Retrieves a registered workspace jail configuration.
   */
  public getWorkspace(workspaceId: string): WorkspaceDirectoryJailConfig | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Lists all registered workspace IDs.
   */
  public listWorkspaceIds(): string[] {
    return Array.from(this.workspaces.keys());
  }

  /**
   * Validates access to a workspace against tenant identity and write permission.
   */
  public validateWorkspaceAccess(
    workspaceId: string,
    tenantId: string,
    isMutating: boolean,
  ): WorkspaceAccessValidationResult {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return {
        allowed: false,
        error: {
          code: 'WORKSPACE_NOT_FOUND',
          message: `Workspace '${workspaceId}' is not registered. Access is fail-closed.`,
        },
      };
    }

    // Tenant Isolation
    if (workspace.tenantId !== tenantId) {
      return {
        allowed: false,
        error: {
          code: 'TENANT_MISMATCH',
          message: `Lease tenant '${tenantId}' does not match workspace tenant '${workspace.tenantId}'.`,
        },
      };
    }

    // Read-Only Enforcement
    if (isMutating && workspace.isReadOnly) {
      return {
        allowed: false,
        error: {
          code: 'WRITE_NOT_AUTHORIZED',
          message: `Workspace '${workspaceId}' is configured as read-only. Mutation operations are prohibited.`,
        },
      };
    }

    return {
      allowed: true,
      workspace,
    };
  }

  /**
   * Clears all registered workspaces.
   */
  public clear(): void {
    this.workspaces.clear();
  }
}
