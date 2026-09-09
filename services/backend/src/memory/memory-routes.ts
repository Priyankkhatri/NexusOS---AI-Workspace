import { IncomingMessage, ServerResponse } from 'node:http';
import { MemoryController } from './memory-controller.js';
import { AuthenticatedContextLike } from '../tasks/controller.js';

export interface MemoryRouteContext {
  requestId: string;
  correlationId: string;
  timestamp: string;
}

export async function handleMemoryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  controller: MemoryController,
  authContext: AuthenticatedContextLike,
  context: MemoryRouteContext,
  readJsonBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const workspaceHeader = req.headers['x-workspace-id'] as string | undefined;

  try {
    // 1. POST /v1/memory/proposals/:id/decision
    const decisionMatch = url.pathname.match(/^\/v1\/memory\/proposals\/([^/]+)\/decision$/);
    if (req.method === 'POST' && decisionMatch) {
      const proposalId = decodeURIComponent(decisionMatch[1]);
      const body = await readJsonBody(req);
      const result = await controller.resolveProposal(
        proposalId,
        body,
        authContext,
        workspaceHeader,
      );
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 2. POST /v1/memory/proposals
    if (req.method === 'POST' && url.pathname === '/v1/memory/proposals') {
      const body = await readJsonBody(req);
      const result = await controller.proposeMemory(body, authContext, workspaceHeader);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 3. GET /v1/memory/search
    if (req.method === 'GET' && url.pathname === '/v1/memory/search') {
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams.entries()) {
        query[k] = v;
      }
      const result = await controller.searchMemory(query, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 4. POST /v1/memory (create direct)
    if (req.method === 'POST' && url.pathname === '/v1/memory') {
      const body = await readJsonBody(req);
      const result = await controller.createMemory(body, authContext, workspaceHeader);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 5. GET /v1/memory/:id
    const idMatch = url.pathname.match(/^\/v1\/memory\/([^/]+)$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);

      if (req.method === 'GET') {
        const result = await controller.getMemory(id, authContext, workspaceHeader);
        if (!result) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'MEMORY_NOT_FOUND',
                message: `Memory record '${id}' not found.`,
                requestId: context.requestId,
                correlationId: context.correlationId,
              },
            }),
          );
          return true;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return true;
      }

      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const result = await controller.updateMemory(id, body, authContext, workspaceHeader);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return true;
      }

      if (req.method === 'DELETE') {
        const expectedVersionStr = url.searchParams.get('expectedVersion');
        const expectedVersion = expectedVersionStr ? parseInt(expectedVersionStr, 10) : undefined;
        const result = await controller.tombstoneMemory(
          id,
          authContext,
          workspaceHeader,
          expectedVersion,
        );
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return true;
      }
    }

    return false;
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string; name?: string };
    const message = err instanceof Error ? err.message : String(err);
    const code = errorObj?.code || 'MEMORY_ERROR';

    let statusCode = 400;
    if (code === 'MEMORY_NOT_FOUND') {
      statusCode = 404;
    } else if (code === 'MEMORY_SECURITY_VIOLATION' || message.includes('056-SEC-02')) {
      statusCode = 403;
    } else if (code === 'MEMORY_VERSION_CONFLICT' || message.includes('056-SEC-06')) {
      statusCode = 409;
    } else if (code === 'MEMORY_SECRET_DETECTED' || message.includes('056-SEC-03')) {
      statusCode = 422;
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
    return true;
  }
}
