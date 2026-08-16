import crypto from 'node:crypto';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { StructuredLogger } from '../telemetry/structured-logger.js';
import { TelemetryManager } from '../telemetry/telemetry-manager.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { IPCCallerAuth } from './caller-auth.js';
import { IPCEndpoint } from './ipc-endpoint.js';
import { IPCProtocolHandler } from './protocol-handler.js';
import { IPCRateLimiter } from './rate-limiter.js';
import { IPCConfigSchema } from './schemas.js';
import {
  CallerIdentity,
  IIPCClientConnection,
  IIPCEndpoint,
  IIPCManager,
  IPCConfig,
  IPCManagerStatus,
  IPCMessage,
  IPCMethodHandler,
} from './types.js';

export class IPCManager implements IIPCManager {
  private readonly config: IPCConfig;
  private readonly endpoint: IIPCEndpoint;
  private readonly protocolHandler: IPCProtocolHandler;
  private readonly callerAuth: IPCCallerAuth;
  private readonly rateLimiter: IPCRateLimiter;
  private readonly methodHandlers = new Map<string, IPCMethodHandler>();
  private readonly logger: StructuredLogger;
  private readonly redactionFilter: RedactionFilter;
  private state: 'STOPPED' | 'STARTING' | 'LISTENING' | 'STOPPING' | 'FAILED' = 'STOPPED';
  private totalRequestsProcessed = 0;
  private totalErrors = 0;

  constructor(
    customConfig?: Partial<IPCConfig>,
    leaseBoundary?: ExecutionLeaseBoundary,
    logger?: StructuredLogger,
    private readonly telemetryManager?: TelemetryManager,
  ) {
    this.config = IPCConfigSchema.parse(customConfig || {});
    this.protocolHandler = new IPCProtocolHandler(this.config.allowedProtocolVersions);
    this.endpoint = new IPCEndpoint(this.config, (msg) => this.protocolHandler.encodeMessage(msg));
    this.callerAuth = new IPCCallerAuth(leaseBoundary);
    this.rateLimiter = new IPCRateLimiter(
      this.config.maxRequestsPerWindow,
      this.config.rateLimitWindowMs,
    );
    this.logger = logger || new StructuredLogger('IPCManager');
    this.redactionFilter = new RedactionFilter();

    this.registerBuiltInHandlers();
    this.setupEndpointListeners();
  }

  public getStatus(): IPCManagerStatus {
    return {
      state: this.state,
      endpointPath: this.endpoint.getEndpointPath(),
      activeConnections: this.endpoint.getActiveConnectionsCount(),
      totalRequestsProcessed: this.totalRequestsProcessed,
      totalErrors: this.totalErrors,
    };
  }

  public registerMethodHandler(method: string, handler: IPCMethodHandler): void {
    if (!method || typeof handler !== 'function') {
      throw new Error('Method name and function handler are required.');
    }
    this.methodHandlers.set(method, handler);
  }

  public async start(): Promise<void> {
    if (this.state === 'LISTENING') return;

    this.state = 'STARTING';
    this.logger.info('Starting IPC Manager endpoint...', {
      endpointPath: this.endpoint.getEndpointPath(),
    });

    try {
      await this.endpoint.start();
      this.state = 'LISTENING';
      this.logger.info('IPC Manager listening successfully', {
        endpointPath: this.endpoint.getEndpointPath(),
      });
    } catch (err) {
      this.state = 'FAILED';
      this.logger.error('Failed to start IPC Manager endpoint', err);
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (this.state === 'STOPPED') return;

    this.state = 'STOPPING';
    this.logger.info('Stopping IPC Manager endpoint...');

    try {
      await this.endpoint.stop();
      this.rateLimiter.reset();
      this.state = 'STOPPED';
      this.logger.info('IPC Manager stopped gracefully');
    } catch (err) {
      this.state = 'FAILED';
      this.logger.error('Error during IPC Manager shutdown', err);
    }
  }

  public async handleRequest(
    client: IIPCClientConnection,
    request: IPCMessage,
  ): Promise<IPCMessage> {
    this.totalRequestsProcessed++;

    const correlationId = request.correlationId || crypto.randomUUID();
    const taskId = request.taskId;
    this.logger.setCorrelationContext(correlationId, taskId);

    // 1. Check Rate Limiting
    if (this.rateLimiter.isRateLimited(client.id)) {
      this.totalErrors++;
      this.logger.warn('IPC request rate limit exceeded', { clientId: client.id });
      return this.createErrorResponse(
        request,
        'RATE_LIMIT_EXCEEDED',
        'IPC request rate limit exceeded. Please slow down connection requests.',
      );
    }

    // 2. Caller Authentication
    let caller: CallerIdentity;
    try {
      const authToken =
        typeof request.params?.authToken === 'string' ? request.params.authToken : undefined;
      caller = await this.callerAuth.authenticateCaller(client.socket, authToken);
      client.caller = caller;
    } catch {
      this.totalErrors++;
      return this.createErrorResponse(
        request,
        'UNAUTHORIZED_CALLER',
        'Failed to authenticate local IPC caller identity.',
      );
    }

    if (!caller.authenticated) {
      this.totalErrors++;
      this.logger.warn('Unauthenticated IPC connection rejected', {
        reason: caller.reason,
      });
      return this.createErrorResponse(
        request,
        'UNAUTHORIZED_CALLER',
        caller.reason || 'Caller identity is unauthenticated.',
      );
    }

    // 3. Method Availability Check
    const method = request.method;
    if (!method || !this.methodHandlers.has(method)) {
      this.totalErrors++;
      return this.createErrorResponse(
        request,
        'METHOD_NOT_FOUND',
        `IPC method '${method || ''}' is not supported.`,
      );
    }

    // 4. Authorization Check
    const rawLease = request.params?.lease;
    const authz = await this.callerAuth.authorizeAction(caller, method, rawLease);
    if (!authz.allowed) {
      this.totalErrors++;
      this.logger.warn('IPC method authorization denied', {
        method,
        reason: authz.reason,
      });
      return this.createErrorResponse(
        request,
        'FORBIDDEN_ACTION',
        authz.reason || `Authorization denied for IPC method '${method}'.`,
      );
    }

    // 5. Execute Method Handler
    try {
      const handler = this.methodHandlers.get(method)!;
      const rawResult = await handler(request.params, {
        caller,
        correlationId,
        taskId,
      });

      // Redact result metadata before sending response
      const sanitizedResult = this.redactionFilter.redactObject(rawResult);

      this.telemetryManager?.trackTrace('ipc_request_success', {
        method,
        correlationId,
        taskId,
      });

      return {
        protocolVersion: request.protocolVersion,
        messageId: crypto.randomUUID(),
        correlationId,
        taskId,
        type: 'RESPONSE',
        result: sanitizedResult,
      };
    } catch (err) {
      this.totalErrors++;
      const redactedErr = this.redactionFilter.redactError(err);
      this.logger.error(`Error executing IPC method '${method}'`, err);

      return this.createErrorResponse(
        request,
        'INTERNAL_ERROR',
        `Execution error in method '${method}': ${redactedErr.message}`,
      );
    }
  }

  private setupEndpointListeners(): void {
    this.endpoint.on('connection', (client: IIPCClientConnection) => {
      let bufferState = Buffer.alloc(0);

      client.socket.on('data', async (chunk: Buffer) => {
        bufferState = Buffer.concat([bufferState, chunk]);

        try {
          const { messages, remainder } = this.protocolHandler.parseFrames(
            bufferState,
            this.config.maxFrameSizeBytes,
          );
          bufferState = remainder;

          for (const req of messages) {
            const response = await this.handleRequest(client, req);
            client.send(response);
          }
        } catch (err) {
          // Fail closed on frame parsing / size / version errors: send error & close connection
          this.totalErrors++;
          const redactedErr = this.redactionFilter.redactError(err);
          const errFrame: IPCMessage = {
            protocolVersion: '1.0',
            messageId: crypto.randomUUID(),
            correlationId: crypto.randomUUID(),
            type: 'ERROR',
            error: {
              code: 'BAD_FRAME_PAYLOAD',
              message: redactedErr.message,
            },
          };
          client.send(errFrame);
          client.close();
        }
      });
    });
  }

  private registerBuiltInHandlers(): void {
    // Ping RPC
    this.registerMethodHandler('ping', async () => ({
      pong: true,
      timestamp: new Date().toISOString(),
    }));

    // Agent Status RPC
    this.registerMethodHandler('agent.status', async () => ({
      status: this.getStatus(),
    }));
  }

  private createErrorResponse(
    req: IPCMessage,
    code: string,
    message: string,
    details?: unknown,
  ): IPCMessage {
    const sanitizedMsg = this.redactionFilter.redactString(message);
    const sanitizedDetails = details ? this.redactionFilter.redactObject(details) : undefined;

    return {
      protocolVersion: req.protocolVersion || '1.0',
      messageId: crypto.randomUUID(),
      correlationId: req.correlationId || crypto.randomUUID(),
      taskId: req.taskId,
      type: 'ERROR',
      error: {
        code,
        message: sanitizedMsg,
        details: sanitizedDetails,
      },
    };
  }
}
