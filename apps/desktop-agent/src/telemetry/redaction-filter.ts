import { SecretRedactionRegistry } from '../vault/redaction-registry.js';
import { IRedactionFilter } from './types.js';

export class RedactionFilter implements IRedactionFilter {
  private static readonly SENSITIVE_KEY_REGEX =
    /^(password|passwd|pwd|secret|token|api_key|apikey|authorization|auth|private_key)$/i;

  constructor(
    private readonly redactionRegistry: SecretRedactionRegistry = new SecretRedactionRegistry(),
  ) {}

  public redactString(text: string): string {
    if (!text) return '';
    try {
      // 1. Redact via SecretRedactionRegistry
      let sanitized = this.redactionRegistry.redactText(text);

      // 2. Extra regex patterns for Bearer tokens, private keys, passwords, API keys
      sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]');
      sanitized = sanitized.replace(
        new RegExp(
          '-----BEGIN' +
            '\\s+PRIVATE\\s+KEY-----' +
            '[\\s\\S]*?' +
            '-----END' +
            '\\s+PRIVATE\\s+KEY-----',
          'g',
        ),
        '[REDACTED_PRIVATE_KEY]',
      );
      sanitized = sanitized.replace(
        /(password|passwd|pwd|secret|api_key|token)["']?\s*[:=]\s*["']?(?!(?:Bearer|\[REDACTED))([^"'\s]+)/gi,
        '$1: [REDACTED]',
      );

      return sanitized;
    } catch {
      // Fail closed on redaction error
      return '[SECURITY_ALERT] Redaction pipeline error; record suppressed.';
    }
  }

  public redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      return this.redactString(obj) as unknown as T;
    }
    if (typeof obj !== 'object') {
      return obj;
    }

    try {
      if (Array.isArray(obj)) {
        return obj.map((item) => this.redactObject(item)) as unknown as T;
      }

      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        const cleanKey = this.redactString(key);

        // If property key is a known sensitive key name, force value redaction
        if (RedactionFilter.SENSITIVE_KEY_REGEX.test(key.trim())) {
          result[cleanKey] = '[REDACTED_SENSITIVE_KEY]';
        } else if (typeof val === 'string') {
          result[cleanKey] = this.redactString(val);
        } else if (typeof val === 'object' && val !== null) {
          result[cleanKey] = this.redactObject(val);
        } else {
          result[cleanKey] = val;
        }
      }
      return result as T;
    } catch {
      return {
        alert: '[SECURITY_ALERT] Redaction pipeline error; record suppressed.',
      } as unknown as T;
    }
  }

  public redactError(err: Error | unknown): { message: string; stack?: string; code?: string } {
    if (!err) {
      return { message: 'Unknown error' };
    }

    try {
      if (err instanceof Error) {
        return {
          message: this.redactString(err.message),
          stack: err.stack ? this.redactString(err.stack) : undefined,
          code: (err as { code?: string }).code
            ? this.redactString((err as { code?: string }).code!)
            : undefined,
        };
      }

      return {
        message: this.redactString(String(err)),
      };
    } catch {
      return {
        message: '[SECURITY_ALERT] Redaction pipeline error; error record suppressed.',
      };
    }
  }
}
