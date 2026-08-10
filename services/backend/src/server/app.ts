import http, { IncomingMessage, ServerResponse, Server } from 'node:http';
import { BackendConfig } from '../config/index.js';
import { LifecycleManager, ServiceLifecycleState } from '../lifecycle/index.js';
import { Logger } from '../observability/logger.js';
import { extractRequestContext } from '../middleware/context.js';
import { handleServerError } from '../middleware/error-handler.js';
import { DatabaseBoundary } from '../database/boundary.js';
import { NEXUSOS_CONTRACT_VERSION } from '@nexusos/contracts';

export class BackendApp {
  private server: Server | null = null;
  public readonly lifecycle: LifecycleManager;
  public readonly logger: Logger;
  public readonly database: DatabaseBoundary;

  constructor(public readonly config: BackendConfig) {
    this.lifecycle = new LifecycleManager();
    this.logger = new Logger(config.logLevel);
    this.database = new DatabaseBoundary(config);
  }

  public handleRequest(req: IncomingMessage, res: ServerResponse): void {
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

      // 3. Unhandled endpoint (404)
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

    this.server = http.createServer((req, res) => this.handleRequest(req, res));

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
