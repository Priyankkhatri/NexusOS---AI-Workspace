import { IncomingMessage, ServerResponse } from 'node:http';
import { RequestIdSchema, CorrelationIdSchema } from '@nexusos/contracts';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  timestamp: string;
}

/**
 * Extracts or generates x-request-id and x-correlation-id from HTTP headers.
 * Attaches validated headers to context and response.
 */
export function extractRequestContext(req: IncomingMessage, res: ServerResponse): RequestContext {
  const reqHeader = req.headers['x-request-id'];
  const corrHeader = req.headers['x-correlation-id'];

  const rawReqId = typeof reqHeader === 'string' ? reqHeader : crypto.randomUUID();
  const rawCorrId = typeof corrHeader === 'string' ? corrHeader : rawReqId;

  const parsedReq = RequestIdSchema.safeParse(rawReqId);
  const parsedCorr = CorrelationIdSchema.safeParse(rawCorrId);

  const requestId = parsedReq.success ? parsedReq.data : crypto.randomUUID();
  const correlationId = parsedCorr.success ? parsedCorr.data : requestId;

  const context: RequestContext = {
    requestId,
    correlationId,
    timestamp: new Date().toISOString(),
  };

  // Set response headers
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', correlationId);

  return context;
}
