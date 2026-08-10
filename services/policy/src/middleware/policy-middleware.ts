import { ServerResponse } from 'node:http';
import { AuthenticatedIncomingMessage } from '@nexusos/identity';
import { extractRequestContext } from '@nexusos/backend';
import {
  createNexusOSError,
  ErrorCategory,
  serializeContract,
  APIErrorResponseSchema,
} from '@nexusos/contracts';
import { PolicyEvaluator } from '../evaluator/provider-boundary.js';
import { PolicyAuditLogger } from '../observability/policy-audit-logger.js';
import { createDecisionEvidence } from '../domain/evidence.js';

export interface RouteAuthorizationRequirement {
  actionName: string;
  resourceType: string;
  requiredScope?: string;
  requiredRole?: string;
}

export function createPolicyMiddleware(
  evaluator: PolicyEvaluator,
  auditLogger?: PolicyAuditLogger,
) {
  return function authorizeRequest(requirement: RouteAuthorizationRequirement) {
    return async function (
      req: AuthenticatedIncomingMessage,
      res: ServerResponse,
    ): Promise<boolean> {
      const requestContext = extractRequestContext(req, res);

      const decisionRequest = {
        subject: req.authenticatedContext,
        action: {
          actionName: requirement.actionName,
          requiredScope: requirement.requiredScope,
          requiredRole: requirement.requiredRole,
        },
        resource: {
          resourceType: requirement.resourceType,
          resourceId: req.url || 'unknown-resource',
          tenantId: req.authenticatedContext?.tenantId,
        },
        context: {
          requestId: requestContext.requestId,
          correlationId: requestContext.correlationId,
          requestTimestamp: requestContext.timestamp,
        },
      };

      const result = await evaluator.evaluate(decisionRequest);

      // Log decision evidence
      if (auditLogger) {
        const evidence = createDecisionEvidence(decisionRequest, result);
        auditLogger.logDecision(evidence);
      }

      if (!result.allowed) {
        const err = createNexusOSError(
          'FORBIDDEN',
          ErrorCategory.AUTHORIZATION,
          result.reason || 'Access denied by policy decision.',
          { requestId: requestContext.requestId, correlationId: requestContext.correlationId },
        );

        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          serializeContract(APIErrorResponseSchema, {
            success: false,
            error: err,
            meta: {
              requestId: requestContext.requestId,
              correlationId: requestContext.correlationId,
              timestamp: requestContext.timestamp,
            },
          }),
        );
        return false;
      }

      return true;
    };
  };
}
