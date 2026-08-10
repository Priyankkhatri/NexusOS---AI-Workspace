import { Logger } from '@nexusos/backend';

export class SecurityLogger {
  constructor(private readonly logger: Logger) {}

  logAuthSuccess(
    principalId: string,
    tenantId: string,
    requestId: string,
    correlationId: string,
  ): void {
    this.logger.info('Authentication succeeded', {
      requestId,
      correlationId,
      details: {
        principalId,
        tenantId,
        event: 'AUTH_SUCCESS',
      },
    });
  }

  logAuthFailure(
    reason: string,
    requestId: string,
    correlationId: string,
    extraDetails: Record<string, unknown> = {},
  ): void {
    this.logger.warn(`Authentication failed: ${reason}`, {
      requestId,
      correlationId,
      details: {
        reason,
        event: 'AUTH_FAILURE',
        ...extraDetails,
      },
    });
  }
}
