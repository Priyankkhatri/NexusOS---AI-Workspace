import { ServerResponse } from 'node:http';
import {
  createNexusOSError,
  ErrorCategory,
  serializeContract,
  APIErrorResponseSchema,
  NexusOSError,
} from '@nexusos/contracts';
import { RequestContext } from './context.js';

export function handleServerError(
  res: ServerResponse,
  error: unknown,
  context: RequestContext,
  isProduction = false,
): void {
  let category: ErrorCategory = ErrorCategory.SYSTEM;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected server error occurred';

  if (error instanceof Error) {
    if (error.name === 'SyntaxError') {
      category = ErrorCategory.VALIDATION;
      code = 'MALFORMED_JSON_PAYLOAD';
      message = 'Request payload must be valid JSON';
    } else if (
      error.message.includes('[ValidationError]') ||
      error.message.includes('[BackendConfigError]')
    ) {
      category = ErrorCategory.VALIDATION;
      code = 'VALIDATION_FAILED';
      message = error.message;
    } else {
      message = isProduction ? 'An unexpected server error occurred' : error.message;
    }
  }

  const nexusError: NexusOSError = createNexusOSError(code, category, message, {
    requestId: context.requestId,
    correlationId: context.correlationId,
  });

  const statusCode = category === ErrorCategory.VALIDATION ? 400 : 500;
  const envelope = {
    success: false as const,
    error: nexusError,
    meta: {
      requestId: context.requestId,
      correlationId: context.correlationId,
      timestamp: context.timestamp,
    },
  };

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(serializeContract(APIErrorResponseSchema, envelope));
}
