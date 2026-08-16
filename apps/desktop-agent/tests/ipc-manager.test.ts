import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { IPCManager, IPCProtocolHandler, IPCMessage } from '../src/ipc/index.js';

describe('Task 03L IPC Manager — Unit & Functional Lifecycle Verification', () => {
  const pipeName = `test-nexusos-ipc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let ipcManager: IPCManager;
  let protocolHandler: IPCProtocolHandler;

  beforeEach(async () => {
    protocolHandler = new IPCProtocolHandler(['1.0']);
    ipcManager = new IPCManager({
      pipeName,
      maxConnections: 5,
      idleTimeoutMs: 5000,
    });
    await ipcManager.start();
  });

  afterEach(async () => {
    if (ipcManager) {
      await ipcManager.stop();
    }
  });

  function sendIPCRequest(socketPath: string, message: IPCMessage): Promise<IPCMessage> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath, () => {
        const encoded = protocolHandler.encodeMessage(message);
        socket.write(encoded);
      });

      let bufferState = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        bufferState = Buffer.concat([bufferState, chunk]);
        try {
          const { messages } = protocolHandler.parseFrames(bufferState, 1024 * 1024);
          if (messages.length > 0) {
            socket.end();
            resolve(messages[0]);
          }
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });

      socket.on('error', (err) => {
        reject(err);
      });
    });
  }

  it('starts and stops named-pipe server endpoint cleanly with correct status', async () => {
    const status = ipcManager.getStatus();
    assert.equal(status.state, 'LISTENING');
    assert.ok(status.endpointPath.includes(pipeName));
    assert.equal(status.activeConnections, 0);

    await ipcManager.stop();
    assert.equal(ipcManager.getStatus().state, 'STOPPED');
  });

  it('executes built-in ping RPC method and returns pong receipt', async () => {
    const correlationId = crypto.randomUUID();
    const request: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId,
      type: 'REQUEST',
      method: 'ping',
    };

    const response = await sendIPCRequest(ipcManager.getStatus().endpointPath, request);
    assert.equal(response.type, 'RESPONSE');
    assert.equal(response.correlationId, correlationId);
    assert.ok(response.result && typeof response.result === 'object');
    assert.equal((response.result as Record<string, unknown>).pong, true);
  });

  it('executes built-in agent.status RPC method', async () => {
    const correlationId = crypto.randomUUID();
    const request: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId,
      type: 'REQUEST',
      method: 'agent.status',
    };

    const response = await sendIPCRequest(ipcManager.getStatus().endpointPath, request);
    assert.equal(response.type, 'RESPONSE');
    assert.equal(response.correlationId, correlationId);
    assert.ok(response.result && typeof response.result === 'object');
  });

  it('registers custom RPC method handlers and processes requests correctly', async () => {
    ipcManager.registerMethodHandler('custom.echo', async (params, context) => {
      return {
        echo: params?.value,
        callerPid: context.caller.pid,
        correlationId: context.correlationId,
      };
    });

    const correlationId = crypto.randomUUID();
    const request: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId,
      type: 'REQUEST',
      method: 'custom.echo',
      params: { value: 'nexus_os_ipc_payload' },
    };

    const response = await sendIPCRequest(ipcManager.getStatus().endpointPath, request);
    assert.equal(response.type, 'RESPONSE');
    assert.equal(response.correlationId, correlationId);
    const result = response.result as Record<string, unknown>;
    assert.equal(result.echo, 'nexus_os_ipc_payload');
    assert.equal(result.correlationId, correlationId);
  });

  it('returns structured 404/METHOD_NOT_FOUND error for unhandled method', async () => {
    const request: IPCMessage = {
      protocolVersion: '1.0',
      messageId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      type: 'REQUEST',
      method: 'non_existent_method',
    };

    const response = await sendIPCRequest(ipcManager.getStatus().endpointPath, request);
    assert.equal(response.type, 'ERROR');
    assert.equal(response.error?.code, 'METHOD_NOT_FOUND');
    assert.ok(response.error?.message.includes('non_existent_method'));
  });
});
