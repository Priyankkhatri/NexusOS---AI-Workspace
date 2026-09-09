/**
 * Secret Redaction and Containment Filter
 * Enforces Security Invariant 056-SEC-03 across backend ingestion and persistence boundaries.
 */

export interface SecretScanResult {
  found: boolean;
  secretTypes: string[];
}

export class RedactionFilter {
  private static readonly SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
    { name: 'BEARER_TOKEN', regex: /bearer\s+[A-Za-z0-9._~+/-]{16,}=*/i },
    {
      name: 'OPENAI_API_KEY',
      regex: /sk-[A-Za-z0-9]{20,T3BlbkFJ[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_-]{30,}/,
    },
    { name: 'ANTHROPIC_API_KEY', regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
    { name: 'GITHUB_TOKEN', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
    {
      name: 'AWS_ACCESS_KEY',
      regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/,
    },
    {
      name: 'AWS_SECRET_KEY',
      regex: new RegExp(
        '(?:aws_' +
          'secret_access_key|aws_secret_key|secret_key)\\s*[:=]\\s*["\']?[A-Za-z0-9/+=]{40}["\']?',
        'i',
      ),
    },
    {
      name: 'PRIVATE_KEY',
      regex:
        /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/,
    },
    {
      name: 'GENERIC_SECRET_KV',
      regex:
        /(?:api[_-]?key|client[_-]?secret|password|passwd|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>/?~]{8,}["']/i,
    },
    {
      name: 'JWT_TOKEN',
      regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    },
  ];

  /**
   * Scans text for material secrets and credentials.
   */
  public static scanForSecrets(text: string): SecretScanResult {
    if (!text || typeof text !== 'string') {
      return { found: false, secretTypes: [] };
    }

    const matchedTypes: string[] = [];
    for (const pattern of this.SECRET_PATTERNS) {
      if (pattern.regex.test(text)) {
        matchedTypes.push(pattern.name);
      }
    }

    return {
      found: matchedTypes.length > 0,
      secretTypes: matchedTypes,
    };
  }

  /**
   * Returns true if text contains any recognized secret patterns.
   */
  public static containsSecrets(text: string): boolean {
    return this.scanForSecrets(text).found;
  }

  /**
   * Sanitizes text by replacing secrets with redacted placeholders.
   */
  public static redactSecrets(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let redacted = text;
    for (const pattern of this.SECRET_PATTERNS) {
      redacted = redacted.replace(new RegExp(pattern.regex, 'gi'), `[REDACTED_${pattern.name}]`);
    }

    // Secondary pass for JSON key-value credential properties
    redacted = redacted.replace(
      /("password"|"secret"|"token"|"apiKey"|"api_key"|"authorization"|"client_secret")\s*:\s*"[^"]+"/gi,
      '$1:"[REDACTED_SENSITIVE_KEY]"',
    );

    return redacted;
  }

  /**
   * Assert that content contains zero secrets. Fails closed with descriptive, non-leaking error.
   */
  public static assertNoSecrets(text: string, contextDescription = 'Memory content'): void {
    const scan = this.scanForSecrets(text);
    if (scan.found) {
      throw new Error(
        `056-SEC-03: ${contextDescription} contains prohibited secret/credential data (${scan.secretTypes.join(', ')}). Persistent storage rejected fail-closed.`,
      );
    }
  }
}
