import { Logger } from '@nexusos/backend';

export class AgentLogger {
  constructor(private readonly logger: Logger) {}

  info(message: string, details?: Record<string, unknown>): void {
    this.logger.info(message, { details: this.sanitizeDetails(details) });
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.logger.warn(message, { details: this.sanitizeDetails(details) });
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.logger.error(message, { details: this.sanitizeDetails(details) });
  }

  private sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details) return undefined;
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('secret') ||
        lower.includes('token') ||
        lower.includes('password') ||
        lower.includes('key')
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
