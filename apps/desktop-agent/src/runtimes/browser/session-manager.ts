import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserSession } from './types.js';

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSession>();

  /**
   * Creates a new isolated browser session bound to task, workspace, and local profile directory.
   */
  public createSession(taskId: string, workspaceId: string, storageDir: string): BrowserSession {
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
      profilePath: profileSubdir,
      createdAt: new Date().toISOString(),
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
   * Updates active URL and history for an existing session.
   */
  public updateSessionUrl(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const updated: BrowserSession = Object.freeze({
      ...session,
      activeUrl: url,
      history: [...session.history, url],
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
    return Array.from(this.sessions.values());
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
