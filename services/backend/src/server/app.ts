import http, { IncomingMessage, ServerResponse, Server } from 'node:http';
import { BackendConfig } from '../config/index.js';
import { LifecycleManager, ServiceLifecycleState } from '../lifecycle/index.js';
import { Logger } from '../observability/logger.js';
import { extractRequestContext } from '../middleware/context.js';
import { handleServerError } from '../middleware/error-handler.js';
import { DatabaseBoundary } from '../database/boundary.js';
import {
  NEXUSOS_CONTRACT_VERSION,
  createNexusOSError,
  ErrorCategory,
  serializeContract,
  APIErrorResponseSchema,
} from '@nexusos/contracts';
import { TaskController, AuthenticatedContextLike } from '../tasks/controller.js';

export interface AuthenticatedIncomingMessage extends IncomingMessage {
  authenticatedContext?: AuthenticatedContextLike;
}

export type RequestAuthenticator = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export interface BackendAppOptions {
  taskController?: TaskController;
  authenticator?: RequestAuthenticator;
}

export class BackendApp {
  private server: Server | null = null;
  public readonly lifecycle: LifecycleManager;
  public readonly logger: Logger;
  public readonly database: DatabaseBoundary;
  public readonly taskController?: TaskController;
  private readonly authenticator?: RequestAuthenticator;

  constructor(
    public readonly config: BackendConfig,
    options?: BackendAppOptions,
  ) {
    this.lifecycle = new LifecycleManager();
    this.logger = new Logger(config.logLevel);
    this.database = new DatabaseBoundary(config);
    this.taskController = options?.taskController;
    this.authenticator = options?.authenticator;
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1e6) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const context = extractRequestContext(req, res);
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    this.logger.info(`Incoming ${req.method} ${url.pathname}`, {
      requestId: context.requestId,
      correlationId: context.correlationId,
      details: { method: req.method, url: url.pathname },
    });

    try {
      // 1. Health Liveness Endpoint
      if (req.method === 'GET' && url.pathname === '/health/liveness') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            status: 'HEALTHY',
            version: NEXUSOS_CONTRACT_VERSION,
            uptimeSeconds: this.lifecycle.getUptimeSeconds(),
            state: this.lifecycle.getState(),
          }),
        );
        return;
      }

      // 2. Health Readiness Endpoint
      if (req.method === 'GET' && url.pathname === '/health/readiness') {
        if (!this.lifecycle.isReady()) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              status: 'UNREADY',
              state: this.lifecycle.getState(),
            }),
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            status: 'READY',
            version: NEXUSOS_CONTRACT_VERSION,
            state: this.lifecycle.getState(),
          }),
        );
        return;
      }

      // 3. Governed Task Intake & Lifecycle Endpoints (Milestone M6)
      if (url.pathname.startsWith('/v1/tasks')) {
        // Authenticate request before processing
        if (this.authenticator) {
          const isAuthed = await this.authenticator(req, res);
          if (!isAuthed) {
            return;
          }
        } else {
          // Reject unauthenticated task intake when no authenticator configured
          const err = createNexusOSError(
            'UNAUTHENTICATED',
            ErrorCategory.AUTHENTICATION,
            'Authentication credentials are required for task intake.',
            { requestId: context.requestId, correlationId: context.correlationId },
          );
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            serializeContract(APIErrorResponseSchema, {
              success: false,
              error: err,
              meta: {
                requestId: context.requestId,
                correlationId: context.correlationId,
                timestamp: context.timestamp,
              },
            }),
          );
          return;
        }

        if (!this.taskController) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'TASK_CONTROLLER_UNAVAILABLE',
                message: 'TaskController is not configured.',
                requestId: context.requestId,
                correlationId: context.correlationId,
              },
            }),
          );
          return;
        }

        const authContext = (req as AuthenticatedIncomingMessage).authenticatedContext;
        if (!authContext) {
          const err = createNexusOSError(
            'UNAUTHENTICATED',
            ErrorCategory.AUTHENTICATION,
            'Authentication credentials are required for task operations.',
            { requestId: context.requestId, correlationId: context.correlationId },
          );
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            serializeContract(APIErrorResponseSchema, {
              success: false,
              error: err,
              meta: {
                requestId: context.requestId,
                correlationId: context.correlationId,
                timestamp: context.timestamp,
              },
            }),
          );
          return;
        }

        // 3a. POST /v1/tasks
        if (req.method === 'POST' && url.pathname === '/v1/tasks') {
          const body = await this.readJsonBody(req);
          const result = await this.taskController.createTask(body, authContext);
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        // 3b. GET /v1/tasks/:id
        const getMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
        if (req.method === 'GET' && getMatch) {
          const taskId = decodeURIComponent(getMatch[1]);
          let result = null;
          try {
            result = this.taskController.getTask(taskId, authContext);
          } catch (err: unknown) {
            // 049-SEC-03: Non-disclosing 404 on cross-tenant probe
            if (err instanceof Error && err.message.includes('different tenant')) {
              result = null;
            } else {
              throw err;
            }
          }

          if (!result) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'TASK_NOT_FOUND',
                  message: `Task ${taskId} not found.`,
                  requestId: context.requestId,
                  correlationId: context.correlationId,
                },
              }),
            );
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        // 3c. POST /v1/tasks/:id/cancel
        const cancelMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/cancel$/);
        if (req.method === 'POST' && cancelMatch) {
          const taskId = decodeURIComponent(cancelMatch[1]);
          const body = (await this.readJsonBody(req)) as { reason?: string } | undefined;
          try {
            const result = await this.taskController.cancelTask(taskId, body?.reason, authContext);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
            return;
          } catch (err: unknown) {
            // 049-SEC-03: Non-disclosing 404 on cross-tenant cancellation probe
            if (err instanceof Error && err.message.includes('different tenant')) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: {
                    code: 'TASK_NOT_FOUND',
                    message: `Task ${taskId} not found.`,
                    requestId: context.requestId,
                    correlationId: context.correlationId,
                  },
                }),
              );
              return;
            }
            throw err;
          }
        }

        // 3d. POST /v1/tasks/:id/receipt
        const receiptMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/receipt$/);
        if (req.method === 'POST' && receiptMatch) {
          const body = await this.readJsonBody(req);
          const result = await this.taskController.settleReceipt(body);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
      }

      // 4. Unhandled endpoint (404)
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: `Endpoint ${url.pathname} not found`,
            requestId: context.requestId,
            correlationId: context.correlationId,
          },
        }),
      );
    } catch (err) {
      handleServerError(res, err, context, this.config.nodeEnv === 'production');
    }
  }

  public async start(): Promise<Server> {
    this.lifecycle.setState(ServiceLifecycleState.STARTING);
    await this.database.connect();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.config.port, this.config.host, () => resolve());
      this.server?.once('error', reject);
    });

    this.lifecycle.setState(ServiceLifecycleState.HEALTHY);
    this.logger.info(`Backend service started on ${this.config.host}:${this.config.port}`, {
      details: { port: this.config.port, nodeEnv: this.config.nodeEnv },
    });

    return this.server;
  }

  public async stop(): Promise<void> {
    this.lifecycle.setState(ServiceLifecycleState.DRAINING);
    this.logger.info('Draining backend service connections for shutdown...');

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
    }

    await this.database.disconnect();
    this.lifecycle.setState(ServiceLifecycleState.STOPPED);
    this.logger.info('Backend service stopped gracefully.');
  }
}
