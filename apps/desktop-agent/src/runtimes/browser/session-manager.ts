import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserSession, BrowserSessionStatus } from '@nexusos/contracts';

export interface SessionAccessValidationResult {
  valid: boolean;
  session?: BrowserSession;
  reason?: string;
  errorCode?: string;
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSession>();

  /**
   * Creates a new isolated browser session bound to task, workspace, and local profile directory.
   */
  public createSession(
    taskId: string,
    workspaceId: string,
    storageDir: string,
    tenantId?: string,
  ): BrowserSession {
    const sessionId = `sess_${crypto.randomUUID()}`;
    const profileSubdir = path.join(
      storageDir,
      '.nexusos-browser-profiles',
      `profile_${sessionId}`,
    );

    if (!fs.existsSync(profileSubdir)) {
      fs.mkdirSync(profileSubdir, { recursive: true });
    }

    const session: BrowserSession = Object.freeze({
      sessionId,
      taskId,
      workspaceId,
      tenantId: tenantId || 'default-tenant',
      profilePath: profileSubdir,
      createdAt: new Date().toISOString(),
      status: 'ACTIVE' as BrowserSessionStatus,
      cookies: {},
      history: [],
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Validates that the requesting context owns and is authorized to access the specified session.
   */
  public validateSessionAccess(
    sessionId: string,
    context: {
      taskId?: string;
      workspaceId?: string;
      tenantId?: string;
    },
  ): SessionAccessValidationResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        valid: false,
        errorCode: 'INVALID_SESSION',
        reason: `Browser session '${sessionId}' was not found or has been destroyed.`,
      };
    }

    if (session.status === 'CLEARED') {
      return {
        valid: false,
        errorCode: 'SESSION_CLEARED',
        reason: `Browser session '${sessionId}' is cleared and cannot receive further operations.`,
      };
    }

    if (context.taskId && session.taskId !== context.taskId) {
      return {
        valid: false,
        errorCode: 'CROSS_TASK_SESSION_DENIED',
        reason: `Session '${sessionId}' belongs to task '${session.taskId}', not '${context.taskId}'.`,
      };
    }

    if (
      context.tenantId &&
      session.tenantId &&
      session.tenantId !== 'default-tenant' &&
      context.tenantId !== 'default-tenant' &&
      session.tenantId !== context.tenantId
    ) {
      return {
        valid: false,
        errorCode: 'CROSS_TENANT_SESSION_DENIED',
        reason: `Session '${sessionId}' belongs to tenant '${session.tenantId}', not '${context.tenantId}'.`,
      };
    }

    if (
      context.workspaceId &&
      session.workspaceId &&
      session.workspaceId !== 'default-workspace' &&
      session.workspaceId !== 'unassigned' &&
      context.workspaceId !== 'default-workspace' &&
      context.workspaceId !== 'unassigned' &&
      session.workspaceId !== context.workspaceId
    ) {
      return {
        valid: false,
        errorCode: 'CROSS_WORKSPACE_SESSION_DENIED',
        reason: `Session '${sessionId}' belongs to workspace '${session.workspaceId}', not '${context.workspaceId}'.`,
      };
    }

    return {
      valid: true,
      session,
    };
  }

  /**
   * Updates active URL and history for an existing session.
   */
  public updateSessionUrl(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'CLEARED') return;

    const updated: BrowserSession = Object.freeze({
      ...session,
      activeUrl: url,
      history: [...(session.history || []), url],
    });

    this.sessions.set(sessionId, updated);
  }

  /**
   * Destroys and cleans up browser profile files for a session.
   */
  public clearSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.profilePath && fs.existsSync(session.profilePath)) {
      try {
        fs.rmSync(session.profilePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure
      }
    }

    this.sessions.delete(sessionId);
    return true;
  }

  public listSessions(): BrowserSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status !== 'CLEARED');
  }

  /**
   * Cleans up abandoned sessions created older than maxAgeMs.
   */
  public cleanupAbandonedSessions(maxAgeMs: number = 3600_000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const session of this.sessions.values()) {
      const createdAtMs = new Date(session.createdAt).getTime();
      if (now - createdAtMs >= maxAgeMs) {
        if (this.clearSession(session.sessionId)) {
          cleaned++;
        }
      }
    }

    return cleaned;
  }
}
