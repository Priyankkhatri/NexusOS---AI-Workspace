import type net from 'node:net';

export type IPCMessageType = 'REQUEST' | 'RESPONSE' | 'NOTIFICATION' | 'ERROR';

export interface IPCErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface IPCMessage {
  protocolVersion: string;
  messageId: string;
  correlationId: string;
  taskId?: string;
  type: IPCMessageType;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: IPCErrorPayload;
}

export interface IPCConfig {
  pipeName: string;
  maxConnections: number;
  maxFrameSizeBytes: number;
  idleTimeoutMs: number;
  rateLimitWindowMs: number;
  maxRequestsPerWindow: number;
  allowedProtocolVersions: string[];
}

export interface CallerIdentity {
  authenticated: boolean;
  pid?: number;
  uid?: number;
  processOwner?: string;
  tenantId?: string;
  scopes?: string[];
  authToken?: string;
  reason?: string;
}

export interface IIPCCallerAuth {
  authenticateCaller(socket: net.Socket, authToken?: string): Promise<CallerIdentity>;
  authorizeAction(
    caller: CallerIdentity,
    method: string,
    rawLease?: unknown,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export interface IIPCRateLimiter {
  isRateLimited(clientId: string): boolean;
  reset(clientId?: string): void;
}

export interface IIPCProtocolHandler {
  encodeMessage(msg: IPCMessage): Buffer;
  parseFrames(
    bufferState: Buffer,
    maxFrameSizeBytes: number,
  ): { messages: IPCMessage[]; remainder: Buffer };
  validateProtocolVersion(version: string): boolean;
}

export interface IIPCClientConnection {
  id: string;
  socket: net.Socket;
  caller?: CallerIdentity;
  connectedAt: string;
  lastActivityAt: string;
  send(msg: IPCMessage): void;
  close(): void;
}

export interface IIPCEndpoint {
  start(): Promise<void>;
  stop(): Promise<void>;
  isListening(): boolean;
  getEndpointPath(): string;
  getActiveConnectionsCount(): number;
  on(event: 'connection', listener: (client: IIPCClientConnection) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

export type IPCMethodHandler = (
  params: Record<string, unknown> | undefined,
  context: {
    caller: CallerIdentity;
    correlationId: string;
    taskId?: string;
  },
) => Promise<unknown>;

export interface IPCManagerStatus {
  state: 'STOPPED' | 'STARTING' | 'LISTENING' | 'STOPPING' | 'FAILED';
  endpointPath: string;
  activeConnections: number;
  totalRequestsProcessed: number;
  totalErrors: number;
}

export interface IIPCManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): IPCManagerStatus;
  registerMethodHandler(method: string, handler: IPCMethodHandler): void;
  handleRequest(client: IIPCClientConnection, request: IPCMessage): Promise<IPCMessage>;
}
