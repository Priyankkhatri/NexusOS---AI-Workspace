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
  TaskQuerySchema,
  ActivityQuerySchema,
  AgentQuerySchema,
  DelegationQuerySchema,
} from '@nexusos/contracts';
import { TaskController, AuthenticatedContextLike } from '../tasks/controller.js';
import { MemoryController } from '../memory/memory-controller.js';
import { MemoryService } from '../memory/memory-service.js';
import { IMemoryStore } from '../memory/types.js';
import { handleMemoryRoutes } from '../memory/memory-routes.js';
import { AmbiguousGoalException } from '../planner/index.js';
import { AgentDirectoryService } from '../agents/agent-directory.js';
import { DelegationCoordinator } from '../agents/delegation-coordinator.js';

export interface AuthenticatedIncomingMessage extends IncomingMessage {
  authenticatedContext?: AuthenticatedContextLike;
}

export type RequestAuthenticator = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export interface BackendAppOptions {
  taskController?: TaskController;
  memoryController?: MemoryController;
  memoryService?: MemoryService;
  memoryStore?: IMemoryStore;
  agentDirectory?: AgentDirectoryService;
  delegationCoordinator?: DelegationCoordinator;
  authenticator?: RequestAuthenticator;
}

export class BackendApp {
  private server: Server | null = null;
  public readonly lifecycle: LifecycleManager;
  public readonly logger: Logger;
  public readonly database: DatabaseBoundary;
  public readonly taskController?: TaskController;
  public readonly memoryController?: MemoryController;
  public readonly agentDirectory?: AgentDirectoryService;
  public readonly delegationCoordinator?: DelegationCoordinator;
  private readonly authenticator?: RequestAuthenticator;

  constructor(
    public readonly config: BackendConfig,
    options?: BackendAppOptions,
  ) {
    this.lifecycle = new LifecycleManager();
    this.logger = new Logger(config.logLevel);
    this.database = new DatabaseBoundary(config);
    this.taskController = options?.taskController;
    this.memoryController =
      options?.memoryController ??
      (options?.memoryService
        ? new MemoryController(options.memoryService)
        : options?.memoryStore
          ? new MemoryController(new MemoryService({ store: options.memoryStore }))
          : undefined);
    this.agentDirectory = options?.agentDirectory;
    this.delegationCoordinator = options?.delegationCoordinator;
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

  /**
   * Authenticate request for dashboard projection endpoints.
   * Returns the authenticated context or null if authentication fails (response already sent).
   */
  private async authenticateForDashboard(
    req: IncomingMessage,
    res: ServerResponse,
    context: { requestId: string; correlationId: string; timestamp: string },
  ): Promise<AuthenticatedContextLike | null> {
    if (this.authenticator) {
      const isAuthed = await this.authenticator(req, res);
      if (!isAuthed) return null;
    } else {
      const err = createNexusOSError(
        'UNAUTHENTICATED',
        ErrorCategory.AUTHENTICATION,
        'Authentication credentials are required.',
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
      return null;
    }

    const authContext = (req as AuthenticatedIncomingMessage).authenticatedContext;
    if (!authContext) {
      const err = createNexusOSError(
        'UNAUTHENTICATED',
        ErrorCategory.AUTHENTICATION,
        'Authentication credentials are required.',
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
      return null;
    }

    return authContext;
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

        // 3a. GET /v1/tasks — Paginated tenant-filtered task listing (053-SEC-02)
        if (req.method === 'GET' && url.pathname === '/v1/tasks') {
          const rawQuery: Record<string, string> = {};
          for (const [k, v] of url.searchParams) {
            rawQuery[k] = v;
          }
          const query = TaskQuerySchema.parse(rawQuery);
          const result = this.taskController.getTasksByTenant(authContext.tenantId, query);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        // 3b. POST /v1/tasks — Single-task creation
        if (req.method === 'POST' && url.pathname === '/v1/tasks') {
          const body = await this.readJsonBody(req);
          const result = await this.taskController.createTask(body, authContext);
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        // 3c. POST /v1/tasks/plan — Autonomous Goal Decomposition Plan Proposal (Task 057)
        if (req.method === 'POST' && url.pathname === '/v1/tasks/plan') {
          const body = await this.readJsonBody(req);
          try {
            const result = await this.taskController.planGoal(body, authContext);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
            return;
          } catch (err: unknown) {
            if (err instanceof AmbiguousGoalException) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.details }));
              return;
            }
            throw err;
          }
        }

        // 3d. POST /v1/tasks/replan — Adaptive Replanning upon Node Failure (Task 057)
        if (req.method === 'POST' && url.pathname === '/v1/tasks/replan') {
          const body = await this.readJsonBody(req);
          const result = await this.taskController.replanGoal(body, authContext);
          res.statusCode = 200;
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

      // 4. Activity Stream Endpoint — GET /v1/activity (053-SEC-02)
      if (req.method === 'GET' && url.pathname === '/v1/activity') {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.taskController) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ items: [], total: 0 }));
          return;
        }

        const rawQuery: Record<string, string> = {};
        for (const [k, v] of url.searchParams) {
          rawQuery[k] = v;
        }
        const query = ActivityQuerySchema.parse(rawQuery);
        const result = this.taskController.getActivityByTenant(dashAuth.tenantId, query);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return;
      }

      // 5. Dashboard Summary Endpoint — GET /v1/dashboard/summary (053-SEC-02)
      if (req.method === 'GET' && url.pathname === '/v1/dashboard/summary') {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.taskController) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              tenantId: dashAuth.tenantId,
              activeTaskCount: 0,
              pendingApprovalCount: 0,
              completedTaskCount: 0,
              failedTaskCount: 0,
              connectedDeviceCount: 0,
              healthStatus: 'HEALTHY',
              updatedAt: new Date().toISOString(),
            }),
          );
          return;
        }

        const result = this.taskController.getDashboardSummary(dashAuth.tenantId);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return;
      }

      // 6. Approval Listing Endpoint — GET /v1/approvals (053-SEC-01 & 053-SEC-02)
      if (req.method === 'GET' && url.pathname === '/v1/approvals') {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.taskController) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ items: [], total: 0 }));
          return;
        }

        const items = this.taskController.listPendingApprovals(dashAuth.tenantId);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items, total: items.length }));
        return;
      }

      // 7. Authoritative Approval Decision Endpoint — POST /v1/approvals/:id/decision (053-SEC-01 & 053-SEC-03)
      const approvalDecisionMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/decision$/);
      if (req.method === 'POST' && approvalDecisionMatch) {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

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

        const promptId = decodeURIComponent(approvalDecisionMatch[1]);
        const body = (await this.readJsonBody(req)) as Record<string, unknown>;

        if (body && typeof body === 'object') {
          if (!body['promptId']) {
            body['promptId'] = promptId;
          } else if (body['promptId'] !== promptId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: `Path promptId '${promptId}' does not match body promptId '${body['promptId']}'.`,
                  requestId: context.requestId,
                  correlationId: context.correlationId,
                },
              }),
            );
            return;
          }
        }

        try {
          const result = await this.taskController.submitApprovalDecision(body, dashAuth);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        } catch (err: unknown) {
          const errObj = err as { code?: string; message?: string } | undefined;
          const message = err instanceof Error ? err.message : String(err);
          let code = errObj?.code || 'APPROVAL_ERROR';
          let statusCode = 400;

          if (code === 'PROMPT_NOT_FOUND' || message.includes('not found')) {
            statusCode = 404;
            code = 'PROMPT_NOT_FOUND';
          } else if (code === 'TENANT_MISMATCH' || message.includes('TENANT_MISMATCH')) {
            statusCode = 403;
            code = 'TENANT_MISMATCH';
          } else if (code === 'PROMPT_ALREADY_RESOLVED' || message.includes('already resolved')) {
            statusCode = 409;
            code = 'PROMPT_ALREADY_RESOLVED';
          } else if (code === 'NONCE_MISMATCH' || message.includes('Nonce mismatch')) {
            statusCode = 400;
            code = 'NONCE_MISMATCH';
          } else if (
            code === 'PROMPT_EXPIRED' ||
            message.includes('EXPIRED') ||
            message.includes('expired')
          ) {
            statusCode = 410;
            code = 'PROMPT_EXPIRED';
          } else if (
            code === 'APPROVAL_HOST_UNAVAILABLE' ||
            message.includes('APPROVAL_HOST_UNAVAILABLE')
          ) {
            statusCode = 503;
            code = 'APPROVAL_HOST_UNAVAILABLE';
          }

          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code,
                message,
                requestId: context.requestId,
                correlationId: context.correlationId,
              },
            }),
          );
          return;
        }
      }

      // 8. Governed Plugin Registry & Projection Endpoints (Milestone M6 / Task 054)
      if (req.method === 'GET' && url.pathname === '/v1/plugins') {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.taskController) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ plugins: [], total: 0 }));
          return;
        }

        const plugins = this.taskController.listPlugins(dashAuth.tenantId);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ plugins, total: plugins.length }));
        return;
      }

      const pluginDetailMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)$/);
      if (req.method === 'GET' && pluginDetailMatch) {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.taskController) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'PLUGIN_NOT_FOUND',
                message: 'Plugin registry not configured.',
                requestId: context.requestId,
                correlationId: context.correlationId,
              },
            }),
          );
          return;
        }

        const pluginId = decodeURIComponent(pluginDetailMatch[1]);
        const plugin = this.taskController.getPlugin(pluginId, dashAuth.tenantId);
        if (!plugin) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'PLUGIN_NOT_FOUND',
                message: `Plugin '${pluginId}' not found or access denied for tenant '${dashAuth.tenantId}'.`,
                requestId: context.requestId,
                correlationId: context.correlationId,
              },
            }),
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(plugin));
        return;
      }

      // 8a. Agent Directory Listing Endpoint — GET /v1/agents (Task 060 / Task 063)
      if (req.method === 'GET' && url.pathname === '/v1/agents') {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.agentDirectory) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ items: [], total: 0 }));
          return;
        }

        const rawQuery: Record<string, string> = {};
        for (const [k, v] of url.searchParams) {
          rawQuery[k] = v;
        }
        const query = AgentQuerySchema.parse(rawQuery);
        const workspaceId =
          (req.headers['x-workspace-id'] as string | undefined) ?? query.workspaceId;

        // 063-SEC-01: listAgents strictly scopes to dashAuth.tenantId
        const allAgents = this.agentDirectory.listAgents(dashAuth.tenantId);
        let filtered = allAgents;

        if (workspaceId) {
          filtered = filtered.filter(
            (a) => a.workspaceScope.includes('*') || a.workspaceScope.includes(workspaceId),
          );
        }
        if (query.role) {
          filtered = filtered.filter((a) => a.role === query.role);
        }
        if (query.status) {
          filtered = filtered.filter((a) => a.status === query.status);
        }

        const total = filtered.length;
        const bounded = filtered.slice(0, query.limit);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items: bounded, total }));
        return;
      }

      // 8b. Delegation Sessions Listing Endpoint — GET /v1/delegations (Task 060 / Task 063)
      if (req.method === 'GET' && url.pathname === '/v1/delegations') {
        const dashAuth = await this.authenticateForDashboard(req, res, context);
        if (!dashAuth) return;

        if (!this.delegationCoordinator) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ items: [], total: 0 }));
          return;
        }

        const rawQuery: Record<string, string> = {};
        for (const [k, v] of url.searchParams) {
          rawQuery[k] = v;
        }
        const query = DelegationQuerySchema.parse(rawQuery);
        const workspaceId =
          (req.headers['x-workspace-id'] as string | undefined) ?? query.workspaceId;

        // 063-SEC-02: listSessions strictly scopes to dashAuth.tenantId
        const sessions = this.delegationCoordinator.listSessions(dashAuth.tenantId, {
          parentTaskId: query.parentTaskId,
          workspaceId,
          status: query.status,
          limit: query.limit,
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items: sessions, total: sessions.length }));
        return;
      }

      // 9. Governed Persistent Memory Endpoints (Milestone M8 / Task 056)
      if (url.pathname.startsWith('/v1/memory')) {
        const authCtx = await this.authenticateForDashboard(req, res, context);
        if (!authCtx) return;

        if (!this.memoryController) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'MEMORY_SERVICE_UNAVAILABLE',
                message: 'MemoryController is not configured.',
                requestId: context.requestId,
                correlationId: context.correlationId,
              },
            }),
          );
          return;
        }

        const handled = await handleMemoryRoutes(
          req,
          res,
          url,
          this.memoryController,
          authCtx,
          context,
          (r) => this.readJsonBody(r),
        );
        if (handled) return;
      }

      // 10. Unhandled endpoint (404)
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

    if (this.memoryController) {
      const store = (this.memoryController.getService() as any)?.store;
      if (store && typeof store.close === 'function') {
        store.close();
      }
    }

    await this.database.disconnect();
    this.lifecycle.setState(ServiceLifecycleState.STOPPED);
    this.logger.info('Backend service stopped gracefully.');
  }
}
