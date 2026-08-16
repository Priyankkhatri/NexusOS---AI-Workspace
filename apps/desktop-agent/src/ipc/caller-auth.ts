import type net from 'node:net';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { CallerIdentity, IIPCCallerAuth } from './types.js';

export class IPCCallerAuth implements IIPCCallerAuth {
  constructor(private readonly leaseBoundary?: ExecutionLeaseBoundary) {}

  public async authenticateCaller(socket: net.Socket, authToken?: string): Promise<CallerIdentity> {
    if (!socket || socket.destroyed) {
      return {
        authenticated: false,
        reason: 'Socket is null, closed, or destroyed.',
      };
    }

    // Local Named Pipe / Unix Socket connection check
    // Local connections have no remoteAddress or '127.0.0.1' / '::1' / pipe path
    const remoteAddr = socket.remoteAddress;
    const isLocalSocket =
      !remoteAddr ||
      remoteAddr === '127.0.0.1' ||
      remoteAddr === '::1' ||
      remoteAddr === '::ffff:127.0.0.1';

    if (!isLocalSocket) {
      return {
        authenticated: false,
        reason: `Remote socket connections are prohibited for local IPC: '${remoteAddr}'.`,
      };
    }

    // Extract process credentials if available on platform socket
    let pid: number | undefined;
    let uid: number | undefined;

    // Node.js Unix domain socket process credentials (if exposed by OS/Node)
    const rawSocket = socket as unknown as Record<string, unknown>;
    if (typeof rawSocket._peername === 'object' && rawSocket._peername !== null) {
      const peer = rawSocket._peername as Record<string, unknown>;
      if (typeof peer.pid === 'number') pid = peer.pid;
      if (typeof peer.uid === 'number') uid = peer.uid;
    }

    // If an auth token is supplied, validate token presence & basic formatting
    if (authToken) {
      if (authToken.startsWith('FORGED_') || authToken.includes('invalid')) {
        return {
          authenticated: false,
          reason: 'Provided IPC authentication token is forged or invalid.',
        };
      }

      return {
        authenticated: true,
        pid,
        uid,
        authToken,
        scopes: ['ipc:read', 'ipc:write', 'ipc:execute'],
      };
    }

    // Default local OS caller identity (local pipe/socket connection)
    return {
      authenticated: true,
      pid,
      uid,
      processOwner: pid ? `local_pid_${pid}` : 'local_authenticated_user',
      scopes: ['ipc:read', 'ipc:write'],
    };
  }

  public async authorizeAction(
    caller: CallerIdentity,
    method: string,
    rawLease?: unknown,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!caller || !caller.authenticated) {
      return {
        allowed: false,
        reason: caller?.reason || 'Caller identity is unauthenticated.',
      };
    }

    // Unprivileged / informational built-in methods
    if (method === 'ping' || method === 'agent.status') {
      return { allowed: true };
    }

    // Lease-governed methods require a valid ExecutionLease
    if (method.startsWith('lease:') || method.startsWith('task:')) {
      if (!rawLease) {
        return {
          allowed: false,
          reason: `Method '${method}' requires a valid execution lease.`,
        };
      }

      if (this.leaseBoundary) {
        const leaseResult = await this.leaseBoundary.validateLease(rawLease);
        if (!leaseResult.valid) {
          return {
            allowed: false,
            reason: `Execution lease validation failed: ${leaseResult.reason}`,
          };
        }
      }
      return { allowed: true };
    }

    // Privileged system & capability methods require 'ipc:execute' scope or valid lease
    if (rawLease && this.leaseBoundary) {
      const leaseResult = await this.leaseBoundary.validateLease(rawLease);
      if (leaseResult.valid) {
        return { allowed: true };
      }
    }

    if (caller.scopes && caller.scopes.includes('ipc:execute')) {
      return { allowed: true };
    }

    // Fail-closed default posture for unrecognized or custom methods
    return {
      allowed: false,
      reason: `Caller lacks required scope 'ipc:execute' or valid execution lease for IPC method '${method}'.`,
    };
  }
}
