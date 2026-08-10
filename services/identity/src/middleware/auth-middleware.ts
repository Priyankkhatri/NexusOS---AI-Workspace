import { IncomingMessage, ServerResponse } from 'node:http';
import { IdentityProviderBoundary } from '../auth/provider-boundary.js';
import { IdentityConfig } from '../config/index.js';
import { AuthenticatedContext } from '../domain/types.js';
import { extractRequestContext } from '@nexusos/backend';
import {
  createNexusOSError,
  ErrorCategory,
  serializeContract,
  APIErrorResponseSchema,
} from '@nexusos/contracts';

export interface AuthenticatedIncomingMessage extends IncomingMessage {
  authenticatedContext?: AuthenticatedContext;
}

export function createAuthenticationMiddleware(
  provider: IdentityProviderBoundary,
  config: IdentityConfig,
) {
  return async function authenticateRequest(
    req: AuthenticatedIncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const context = extractRequestContext(req, res);
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Allow anonymous access for explicit health/readiness endpoints
    if (config.allowAnonymousEndpoints.includes(url.pathname)) {
      return true;
    }

    // Extract Bearer token from Authorization header or X-Device-JWT header
    const authHeader = req.headers.authorization;
    const deviceHeader = req.headers['x-device-jwt'];

    let rawToken: string | undefined;
    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      rawToken = authHeader.substring(7).trim();
    } else if (typeof deviceHeader === 'string') {
      rawToken = deviceHeader.trim();
    }

    if (!rawToken) {
      const err = createNexusOSError(
        'UNAUTHENTICATED',
        ErrorCategory.AUTHENTICATION,
        'Authentication credentials are required to access this resource.',
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
      return false;
    }

    const authResult = await provider.authenticateToken(rawToken);
    if (!authResult.success || !authResult.context) {
      const err = createNexusOSError(
        authResult.errorCode || 'INVALID_CREDENTIALS',
        ErrorCategory.AUTHENTICATION,
        authResult.errorMessage || 'Invalid or expired authentication credentials.',
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
      return false;
    }

    // Attach immutable authenticated context to request
    req.authenticatedContext = authResult.context;
    return true;
  };
}
