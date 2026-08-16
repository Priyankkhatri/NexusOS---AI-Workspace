import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  CallerIdentity,
  IIPCClientConnection,
  IIPCEndpoint,
  IPCConfig,
  IPCMessage,
} from './types.js';

export class IPCClientConnection implements IIPCClientConnection {
  public readonly id: string;
  public caller?: CallerIdentity;
  public readonly connectedAt: string;
  public lastActivityAt: string;
  private isClosed = false;

  constructor(
    public readonly socket: net.Socket,
    private readonly encoder: (msg: IPCMessage) => Buffer,
  ) {
    this.id = crypto.randomUUID();
    this.connectedAt = new Date().toISOString();
    this.lastActivityAt = this.connectedAt;
  }

  public send(msg: IPCMessage): void {
    if (this.isClosed || this.socket.destroyed) return;
    try {
      const buffer = this.encoder(msg);
      this.socket.write(buffer);
      this.lastActivityAt = new Date().toISOString();
    } catch {
      this.close();
    }
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    try {
      if (!this.socket.destroyed) {
        this.socket.end();
        this.socket.destroy();
      }
    } catch {
      // Suppress socket destroy errors
    }
  }
}

export class IPCEndpoint extends EventEmitter implements IIPCEndpoint {
  private server?: net.Server;
  private readonly clients = new Map<string, IPCClientConnection>();
  private endpointPath: string = '';
  private listening = false;

  constructor(
    private readonly config: IPCConfig,
    private readonly encoder: (msg: IPCMessage) => Buffer,
  ) {
    super();
    this.endpointPath = this.resolveEndpointPath(config.pipeName);
  }

  public getEndpointPath(): string {
    return this.endpointPath;
  }

  public isListening(): boolean {
    return this.listening;
  }

  public getActiveConnectionsCount(): number {
    return this.clients.size;
  }

  public async start(): Promise<void> {
    if (this.listening) return;

    // Clean up pre-existing stale socket file on POSIX with symlink validation
    if (process.platform !== 'win32' && fs.existsSync(this.endpointPath)) {
      try {
        const lstat = fs.lstatSync(this.endpointPath);
        if (lstat.isSymbolicLink()) {
          // If it's a symlink, remove the symlink itself without following target
          fs.unlinkSync(this.endpointPath);
        } else {
          fs.unlinkSync(this.endpointPath);
        }
      } catch {
        // Suppress unlink error
      }
    }

    // Ensure parent directory exists with restrictive 0o700 permissions
    if (process.platform !== 'win32') {
      const parentDir = path.dirname(this.endpointPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
      } else {
        try {
          fs.chmodSync(parentDir, 0o700);
        } catch {
          // Suppress chmod error if not owned
        }
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleNewConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', err);
        if (!this.listening) {
          reject(err);
        }
      });

      this.server.listen(this.endpointPath, () => {
        this.listening = true;

        // Enforce restrictive OS permissions (0o600) on Unix domain socket file
        if (process.platform !== 'win32' && fs.existsSync(this.endpointPath)) {
          try {
            fs.chmodSync(this.endpointPath, 0o600);
          } catch {
            // Ignore chmod error on platforms that don't support it
          }
        }

        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.listening && !this.server) return;

    // Close all connected clients
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.listening = false;
          this.cleanUpSocketFile();
          resolve();
        });
      } else {
        this.listening = false;
        this.cleanUpSocketFile();
        resolve();
      }
    });
  }

  private handleNewConnection(socket: net.Socket): void {
    // 1. Connection Ceiling Enforcement
    if (this.clients.size >= this.config.maxConnections) {
      try {
        const errorMsg: IPCMessage = {
          protocolVersion: '1.0',
          messageId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
          type: 'ERROR',
          error: {
            code: 'MAX_CONNECTIONS_EXCEEDED',
            message: `Connection rejected: maximum IPC connection ceiling of ${this.config.maxConnections} reached.`,
          },
        };
        socket.write(this.encoder(errorMsg));
      } catch {
        // Suppress write error
      }
      socket.destroy();
      return;
    }

    // 2. Wrap Connection
    const client = new IPCClientConnection(socket, this.encoder);
    this.clients.set(client.id, client);

    // 3. Set Socket Timeout (Idle Timeout)
    socket.setTimeout(this.config.idleTimeoutMs);
    socket.on('timeout', () => {
      client.close();
      this.clients.delete(client.id);
    });

    socket.on('close', () => {
      this.clients.delete(client.id);
    });

    socket.on('error', () => {
      client.close();
      this.clients.delete(client.id);
    });

    // Notify IPCManager listener
    this.emit('connection', client);
  }

  private resolveEndpointPath(pipeName: string): string {
    if (process.platform === 'win32') {
      if (pipeName.startsWith('\\\\.\\pipe\\')) {
        return pipeName;
      }
      return `\\\\.\\pipe\\${pipeName}`;
    }

    // POSIX domain socket path
    if (pipeName.startsWith('/')) {
      return pipeName;
    }
    const tmpDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
    return path.join(tmpDir, `${pipeName}.sock`);
  }

  private cleanUpSocketFile(): void {
    if (process.platform !== 'win32' && fs.existsSync(this.endpointPath)) {
      try {
        fs.unlinkSync(this.endpointPath);
      } catch {
        // Ignore unlink error
      }
    }
  }
}
