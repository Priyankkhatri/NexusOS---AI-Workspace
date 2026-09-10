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

    // -----------------------------------------------------------------------
    // Task 058 Routes
    // -----------------------------------------------------------------------

    // 5. POST /v1/memory/compress
    if (req.method === 'POST' && url.pathname === '/v1/memory/compress') {
      const body = await readJsonBody(req);
      const result = await controller.compressMemories(body, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 6. POST & GET /v1/memory/episodes
    if (req.method === 'POST' && url.pathname === '/v1/memory/episodes') {
      const body = await readJsonBody(req);
      const result = await controller.recordEpisode(body, authContext, workspaceHeader);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/v1/memory/episodes') {
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams.entries()) {
        query[k] = v;
      }
      const result = await controller.listEpisodes(query, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 7. GET /v1/memory/episodes/:id
    const epMatch = url.pathname.match(/^\/v1\/memory\/episodes\/([^/]+)$/);
    if (req.method === 'GET' && epMatch) {
      const epId = decodeURIComponent(epMatch[1]);
      const result = await controller.getEpisode(epId, authContext, workspaceHeader);
      if (!result) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: {
              code: 'EPISODE_NOT_FOUND',
              message: `Episode '${epId}' not found.`,
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

    // 8. POST & GET /v1/memory/playbooks
    if (req.method === 'POST' && url.pathname === '/v1/memory/playbooks') {
      const body = await readJsonBody(req);
      const result = await controller.proposePlaybook(body, authContext, workspaceHeader);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/v1/memory/playbooks') {
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams.entries()) {
        query[k] = v;
      }
      const result = await controller.listPlaybooks(query, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 9. POST /v1/memory/playbooks/:id/approve
    const pbApproveMatch = url.pathname.match(/^\/v1\/memory\/playbooks\/([^/]+)\/approve$/);
    if (req.method === 'POST' && pbApproveMatch) {
      const pbId = decodeURIComponent(pbApproveMatch[1]);
      const body = await readJsonBody(req);
      const result = await controller.approvePlaybook(pbId, body, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 10. POST /v1/memory/graph/query
    if (req.method === 'POST' && url.pathname === '/v1/memory/graph/query') {
      const body = await readJsonBody(req);
      const result = await controller.queryGraph(body, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 10a. POST /v1/memory/vectors/search
    if (req.method === 'POST' && url.pathname === '/v1/memory/vectors/search') {
      const body = await readJsonBody(req);
      const result = await controller.searchVectors(body, authContext, workspaceHeader);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 10b. POST /v1/memory/vectors
    if (req.method === 'POST' && url.pathname === '/v1/memory/vectors') {
      const body = await readJsonBody(req);
      const result = await controller.saveVector(body, authContext, workspaceHeader);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    // 10c. GET or DELETE /v1/memory/vectors/:id
    const vecMatch = url.pathname.match(/^\/v1\/memory\/vectors\/([^/]+)$/);
    if (vecMatch) {
      const memoryRecordId = decodeURIComponent(vecMatch[1]);
      if (req.method === 'GET') {
        const result = await controller.getVector(memoryRecordId, authContext, workspaceHeader);
        if (!result) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'VECTOR_NOT_FOUND',
                message: `Vector for memory record '${memoryRecordId}' not found.`,
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

      if (req.method === 'DELETE') {
        const result = await controller.deleteVector(memoryRecordId, authContext, workspaceHeader);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return true;
      }
    }

    // 11. GET /v1/memory/:id
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
    let message = err instanceof Error ? err.message : String(err);
    let code = errorObj?.code || 'MEMORY_ERROR';

    let statusCode = 400;
    if (code === 'MEMORY_NOT_FOUND') {
      statusCode = 404;
    } else if (
      code === 'MEMORY_SECURITY_VIOLATION' ||
      message.includes('056-SEC-02') ||
      message.includes('062-SEC-01')
    ) {
      statusCode = 403;
      code = 'MEMORY_SECURITY_VIOLATION';
    } else if (code === 'MEMORY_VERSION_CONFLICT' || message.includes('056-SEC-06')) {
      statusCode = 409;
    } else if (
      code === 'MEMORY_SECRET_DETECTED' ||
      message.includes('056-SEC-03') ||
      message.includes('062-SEC-04')
    ) {
      statusCode = 422;
      code = 'MEMORY_SECRET_DETECTED';
    } else if (
      code === 'VECTOR_DIMENSION_MISMATCH' ||
      errorObj?.name === 'VectorDimensionMismatchError'
    ) {
      statusCode = 400;
      code = 'VECTOR_DIMENSION_MISMATCH';
    } else if (errorObj?.name === 'ZodError') {
      statusCode = 400;
      code = 'INVALID_INPUT';
    } else if (
      message.includes('SQLITE') ||
      message.includes('sqlite') ||
      message.includes('syntax error') ||
      message.includes('table ')
    ) {
      // 062-SEC-02: Prevent leaking internal database errors, sql syntax, or filesystem paths
      statusCode = 500;
      code = 'INTERNAL_PERSISTENCE_ERROR';
      message = 'An internal database error occurred while processing the request.';
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
