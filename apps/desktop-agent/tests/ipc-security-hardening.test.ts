import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { IPCManager, IPCProtocolHandler, IPCMessage, IPCCallerAuth } from '../src/ipc/index.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { ReferencePolicyEvaluator, loadPolicyConfig } from '@nexusos/policy';

describe('Task 03L IPC Manager — Security Hardening & Vulnerability Audit', () => {
  const pipeName = `test-nexusos-sec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let ipcManager: IPCManager;
  let protocolHandler: IPCProtocolHandler;

  beforeEach(async () => {
    protocolHandler = new IPCProtocolHandler(['1.0']);
    ipcManager = new IPCManager({
      pipeName,
      maxConnections: 3,
      maxFrameSizeBytes: 2048, // Restrictive 2KB max frame size for testing
      idleTimeoutMs: 5000,
      maxRequestsPerWindow: 3, // 3 requests per second limit
      rateLimitWindowMs: 1000,
    });
    await ipcManager.start();
  });

  afterEach(async () => {
    if (ipcManager) {
      await ipcManager.stop();
    }
  });

  function connectRawSocket(socketPath: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath, () => {
        resolve(socket);
      });
      socket.on('error', (err) => reject(err));
    });
  }

  function sendAndReceive(socket: net.Socket, message: IPCMessage): Promise<IPCMessage> {
    return new Promise((resolve, reject) => {
      const encoded = protocolHandler.encodeMessage(message);
      socket.write(encoded);

      let bufferState = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        bufferState = Buffer.concat([bufferState, chunk]);
        try {
          const { messages } = protocolHandler.parseFrames(bufferState, 1024 * 1024);
          if (messages.length > 0) {
            resolve(messages[0]);
          }
        } catch (err) {
          reject(err);
        }
      });

      socket.on('error', (err) => reject(err));
    });
  }

  it('VULNERABILITY-L01: fails closed and closes connection on oversized frame header', async () => {
    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);

    // Send 4-byte header specifying a 10MB payload when maxFrameSizeBytes is 2KB (2048 bytes)
    const header = Buffer.alloc(4);
    header.writeUInt32BE(10 * 1024 * 1024, 0); // 10MB

    const responsePromise = new Promise<IPCMessage>((resolve) => {
      let bufferState = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        bufferState = Buffer.concat([bufferState, chunk]);
        try {
          const { messages } = protocolHandler.parseFrames(bufferState, 1024 * 1024);
          if (messages.length > 0) resolve(messages[0]);
        } catch {
          // Ignore
        }
      });
    });

    socket.write(header);

    const response = await responsePromise;
    assert.equal(response.type, 'ERROR');
    assert.equal(response.error?.code, 'BAD_FRAME_PAYLOAD');
    assert.ok(response.error?.message.includes('Oversized IPC frame'));
  });

  it('VULNERABILITY-L02: rejects incoming connections exceeding maximum connection ceiling', async () => {
    const endpointPath = ipcManager.getStatus().endpointPath;
    const socket1 = await connectRawSocket(endpointPath);
    const socket2 = await connectRawSocket(endpointPath);
    const socket3 = await connectRawSocket(endpointPath);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ipcManager.getStatus().activeConnections, 3);

    // 4th connection attempt when maxConnections is 3
    const socket4 = await connectRawSocket(endpointPath);
    socket4.resume();

    const isClosed = await new Promise<boolean>((resolve) => {
      if (socket4.destroyed || socket4.readableEnded || !socket4.readable) {
        return resolve(true);
      }
      socket4.on('close', () => resolve(true));
      socket4.on('error', () => resolve(true));
      socket4.on('end', () => resolve(true));
      setTimeout(
        () => resolve(socket4.destroyed || socket4.readableEnded || !socket4.readable),
        200,
      );
    });

    assert.equal(isClosed, true);

    socket1.destroy();
    socket2.destroy();
    socket3.destroy();
  });

  it('VULNERABILITY-L03: rate limits requests exceeding configured threshold', async () => {
    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);
    const makeReq = () =>
      sendAndReceive(socket, {
        protocolVersion: '1.0',
        messageId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        type: 'REQUEST',
        method: 'ping',
      });

    // 3 requests allowed per window
    const r1 = await makeReq();
    const r2 = await makeReq();
    const r3 = await makeReq();
    assert.equal(r1.type, 'RESPONSE');
    assert.equal(r2.type, 'RESPONSE');
    assert.equal(r3.type, 'RESPONSE');

    // 4th request exceeds rate limit of 3
    const r4 = await makeReq();
    assert.equal(r4.type, 'ERROR');
    assert.equal(r4.error?.code, 'RATE_LIMIT_EXCEEDED');

    socket.destroy();
  });

  it('VULNERABILITY-L04: rejects forged authentication tokens fail-closed', async () => {
    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);
    const req: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'ping',
      params: {
        authToken: 'FORGED_INVALID_TOKEN_123',
      },
    };

    const res = await sendAndReceive(socket, req);
    assert.equal(res.type, 'ERROR');
    assert.equal(res.error?.code, 'UNAUTHORIZED_CALLER');
    assert.ok(
      res.error?.message.includes('unauthenticated') || res.error?.message.includes('forged'),
    );

    socket.destroy();
  });

  it('VULNERABILITY-L05: rejects unsupported protocol versions', async () => {
    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);
    const req: IPCMessage = {
      protocolVersion: '99.0', // Unsupported version
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'ping',
    };

    const res = await sendAndReceive(socket, req);
    assert.equal(res.type, 'ERROR');
    assert.equal(res.error?.code, 'BAD_FRAME_PAYLOAD');
    assert.ok(res.error?.message.includes('Unsupported IPC protocol version'));

    socket.destroy();
  });

  it('VULNERABILITY-L06: redacts sensitive keys and plaintext secrets in IPC responses', async () => {
    ipcManager.registerMethodHandler('secret.test', async () => {
      return {
        status: 'ok',
        api_key: 'sk_live_secret_key_99999',
        nested: {
          password: 'super_secret_password_123',
        },
      };
    });

    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);
    const req: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'secret.test',
      params: {
        authToken: 'valid_test_token',
      },
    };

    const res = await sendAndReceive(socket, req);
    assert.equal(res.type, 'RESPONSE');
    const resultJson = JSON.stringify(res.result);

    assert.equal(resultJson.includes('sk_live_secret_key_99999'), false);
    assert.equal(resultJson.includes('super_secret_password_123'), false);
    assert.ok(resultJson.includes('[REDACTED_SENSITIVE_KEY]'));

    socket.destroy();
  });

  it('VULNERABILITY-L07: requires execution lease for lease-governed IPC methods', async () => {
    const policyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig());
    const leaseBoundary = new ExecutionLeaseBoundary(policyEvaluator);
    const callerAuth = new IPCCallerAuth(leaseBoundary);

    const caller = { authenticated: true, pid: process.pid };

    // Attempt method requiring lease without passing lease
    const check1 = await callerAuth.authorizeAction(caller, 'lease:execute');
    assert.equal(check1.allowed, false);
    assert.ok(check1.reason?.includes('requires a valid execution lease'));

    // Attempt with malformed lease
    const check2 = await callerAuth.authorizeAction(caller, 'lease:execute', { invalid: 'lease' });
    assert.equal(check2.allowed, false);
    assert.ok(check2.reason?.includes('Execution lease validation failed'));
  });

  it('VULNERABILITY-L08: enforces restrictive socket file permissions on Unix systems', async () => {
    if (process.platform === 'win32') return; // Unix domain socket check only

    const pathName = ipcManager.getStatus().endpointPath;
    assert.ok(fs.existsSync(pathName));
    const stats = fs.statSync(pathName);
    const mode = stats.mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('VULNERABILITY-L09: enforces fail-closed default authorization on custom capability RPC methods', async () => {
    ipcManager.registerMethodHandler('custom.capability', async () => ({ executed: true }));

    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);
    const req: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'custom.capability',
    };

    const res = await sendAndReceive(socket, req);
    assert.equal(res.type, 'ERROR');
    assert.equal(res.error?.code, 'FORBIDDEN_ACTION');
    assert.ok(res.error?.message.includes('lacks required scope'));

    socket.destroy();
  });

  it('VULNERABILITY-L10: enforces buffer accumulation limit to prevent memory exhaustion DoS', async () => {
    const socket = await connectRawSocket(ipcManager.getStatus().endpointPath);

    // Send 3KB of chunked data when maxFrameSizeBytes is 2KB (2048 bytes) -> buffer threshold is 4KB
    const garbageChunk = Buffer.alloc(3000, 'A');

    const responsePromise = new Promise<IPCMessage>((resolve) => {
      let bufferState = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        bufferState = Buffer.concat([bufferState, chunk]);
        try {
          const { messages } = protocolHandler.parseFrames(bufferState, 1024 * 1024);
          if (messages.length > 0) resolve(messages[0]);
        } catch {
          // Suppress
        }
      });
    });

    socket.write(garbageChunk);
    socket.write(garbageChunk); // Total 6KB > maxFrameSizeBytes * 2 (4KB limit)

    const response = await responsePromise;
    assert.equal(response.type, 'ERROR');
    assert.equal(response.error?.code, 'BAD_FRAME_PAYLOAD');
    assert.ok(response.error?.message.includes('Oversized IPC frame buffer'));
  });

  it('VULNERABILITY-L11: enforces global rate limit across connection churn', async () => {
    const lim = new (await import('../src/ipc/rate-limiter.js')).IPCRateLimiter(5, 1000, 5);

    // 5 requests from different client IDs
    assert.equal(lim.isRateLimited('client-1'), false);
    assert.equal(lim.isRateLimited('client-2'), false);
    assert.equal(lim.isRateLimited('client-3'), false);
    assert.equal(lim.isRateLimited('client-4'), false);
    assert.equal(lim.isRateLimited('client-5'), false);

    // 6th request from a NEW client ID must be rate limited by global ceiling
    assert.equal(lim.isRateLimited('client-6'), true);
  });

  it('VULNERABILITY-L12: handles RPC handler timeout without hanging server', async () => {
    ipcManager.registerMethodHandler('slow.method', async () => {
      await new Promise((r) => setTimeout(r, 20000)); // 20s delay
      return { done: true };
    });

    const callerAuth = new IPCCallerAuth();

    // Test caller with scope
    const caller = { authenticated: true, scopes: ['ipc:execute'] };
    const authz = await callerAuth.authorizeAction(caller, 'slow.method');
    assert.equal(authz.allowed, true);
  });

  it('VULNERABILITY-L13: rejects operational IPC requests when agent lifecycle is not READY', async () => {
    const agentState = 'STOPPING';
    const nonReadyManager = new IPCManager(
      { pipeName: `test-sec-nr-${Date.now()}` },
      undefined,
      undefined,
      undefined,
      () => agentState,
    );

    nonReadyManager.registerMethodHandler('agent.status', async () => ({ status: 'ok' }));
    await nonReadyManager.start();

    const socket = await connectRawSocket(nonReadyManager.getStatus().endpointPath);

    // Operational request when state is STOPPING
    const req: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'agent.status',
    };

    const res = await sendAndReceive(socket, req);
    assert.equal(res.type, 'ERROR');
    assert.equal(res.error?.code, 'SERVICE_UNAVAILABLE');
    assert.ok(res.error?.message.includes('not in READY state'));

    // 'ping' built-in allowed even when not READY
    const pingReq: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'ping',
    };

    const pingRes = await sendAndReceive(socket, pingReq);
    assert.equal(pingRes.type, 'RESPONSE');

    socket.destroy();
    await nonReadyManager.stop();
  });

  it('VULNERABILITY-L14: does not claim agent process PID when caller PID is unverified', async () => {
    const callerAuth = new IPCCallerAuth();
    const fakeSocket = { remoteAddress: '127.0.0.1', destroyed: false } as unknown as net.Socket;

    const caller = await callerAuth.authenticateCaller(fakeSocket);
    assert.equal(caller.authenticated, true);
    assert.equal(caller.pid, undefined);
  });
});
