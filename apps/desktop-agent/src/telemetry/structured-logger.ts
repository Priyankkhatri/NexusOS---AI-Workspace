import crypto from 'node:crypto';
import { BackpressureController } from './backpressure-controller.js';
import { RedactionFilter } from './redaction-filter.js';
import { EventPriority, IStructuredLogger, LogLevel, LogRecord } from './types.js';

export class StructuredLogger implements IStructuredLogger {
  private correlationId?: string;
  private taskId?: string;
  private stepId?: string;

  constructor(
    private readonly component: string = 'DesktopAgent',
    private readonly redactionFilter: RedactionFilter = new RedactionFilter(),
    private readonly backpressureController: BackpressureController = new BackpressureController(),
    private readonly outputHandler: (jsonString: string) => void = (msg) => console.log(msg),
  ) {}

  public setCorrelationContext(correlationId?: string, taskId?: string, stepId?: string): void {
    this.correlationId = correlationId;
    this.taskId = taskId;
    this.stepId = stepId;
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.emitLog('debug', message, undefined, context, 'NON_CRITICAL');
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.emitLog('info', message, undefined, context, 'NON_CRITICAL');
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.emitLog('warn', message, undefined, context, 'NON_CRITICAL');
  }

  public error(message: string, err?: Error | unknown, context?: Record<string, unknown>): void {
    this.emitLog('error', message, err, context, 'CRITICAL');
  }

  public fatal(message: string, err?: Error | unknown, context?: Record<string, unknown>): void {
    this.emitLog('fatal', message, err, context, 'CRITICAL');
  }

  private emitLog(
    level: LogLevel,
    message: string,
    err?: Error | unknown,
    context?: Record<string, unknown>,
    priority: EventPriority = 'NON_CRITICAL',
  ): void {
    // 1. Backpressure Sampling Check
    if (!this.backpressureController.shouldSampleLog(level, priority)) {
      return;
    }

    try {
      // 2. Prevent Log/JSON Injection: Sanitize message string
      const sanitizedMessage = this.redactionFilter.redactString(
        this.sanitizeString(message || ''),
      );

      // 3. Process Error Stack Trace / Message safely
      let errorDetails: Record<string, unknown> | undefined;
      if (err) {
        const redactedErr = this.redactionFilter.redactError(err);
        errorDetails = {
          errorMessage: redactedErr.message,
          stack: redactedErr.stack,
          errorCode: redactedErr.code,
        };
      }

      // 4. Process Context Metadata safely (never dump raw process/env objects!)
      let sanitizedDetails: Record<string, unknown> | undefined;
      if (context || errorDetails) {
        const merged = { ...context, ...errorDetails };
        sanitizedDetails = this.redactionFilter.redactObject(merged);
      }

      const logRecord: LogRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level,
        component: this.component,
        message: sanitizedMessage,
        correlationId: this.correlationId,
        taskId: this.taskId,
        stepId: this.stepId,
        details: sanitizedDetails,
        priority,
      };

      const jsonOutput = JSON.stringify(logRecord);

      // Emit asynchronously via output handler
      setImmediate(() => {
        try {
          this.outputHandler(jsonOutput);
        } catch {
          // Suppress handler errors
        }
      });
    } catch {
      // Fail closed on logging error
      setImmediate(() => {
        this.outputHandler(
          JSON.stringify({
            level: 'error',
            message: '[SECURITY_ALERT] Logger failed closed due to redaction or processing error.',
          }),
        );
      });
    }
  }

  /**
   * Prevents log forging/JSON line injection by escaping newlines and control characters.
   */
  private sanitizeString(str: string): string {
    return str.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replaceAll(String.fromCharCode(0), '');
  }
}
