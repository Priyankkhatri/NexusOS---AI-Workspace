export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
];

/**
 * Redacts sensitive fields from objects or headers
 */
export function redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactSensitiveData(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export class Logger {
  constructor(private readonly minLevel: LogLevel = 'info') {}

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  log(
    level: LogLevel,
    message: string,
    meta: { requestId?: string; correlationId?: string; details?: Record<string, unknown> } = {},
  ): LogEntry | null {
    if (!this.shouldLog(level)) return null;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: meta.requestId,
      correlationId: meta.correlationId,
      details: meta.details ? redactSensitiveData(meta.details) : undefined,
    };

    // Print JSON log output to stdout/stderr
    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      console.error(serialized);
    } else {
      console.log(serialized);
    }

    return entry;
  }

  debug(
    message: string,
    meta?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> },
  ) {
    return this.log('debug', message, meta);
  }

  info(
    message: string,
    meta?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> },
  ) {
    return this.log('info', message, meta);
  }

  warn(
    message: string,
    meta?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> },
  ) {
    return this.log('warn', message, meta);
  }

  error(
    message: string,
    meta?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> },
  ) {
    return this.log('error', message, meta);
  }
}
