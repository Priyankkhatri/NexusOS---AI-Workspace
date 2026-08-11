import { ISecretRedactionRegistry } from './types.js';

export class SecretRedactionRegistry implements ISecretRedactionRegistry {
  private readonly secretValues = new Map<string, string>(); // fingerprintId -> string value
  private readonly fingerprints = new Set<string>();

  public registerSecret(secretValue: string | Buffer, fingerprintId: string): void {
    if (!secretValue || !fingerprintId) return;

    const valueStr = typeof secretValue === 'string' ? secretValue : secretValue.toString('utf-8');

    if (valueStr.trim().length === 0) return;

    this.secretValues.set(fingerprintId, valueStr);
    this.fingerprints.add(fingerprintId);
  }

  public redactText(input: string): string {
    if (!input || typeof input !== 'string') return input;

    let redacted = input;

    // 1. Redact registered exact secret strings
    for (const [fingerprintId, secretValue] of this.secretValues.entries()) {
      if (secretValue && secretValue.length > 0 && redacted.includes(secretValue)) {
        const replacement = `[REDACTED_SECRET_${fingerprintId.slice(0, 8)}]`;
        redacted = redacted.split(secretValue).join(replacement);
      }
    }

    // 2. Pattern redaction for bearer tokens, passwords, authorization headers, and cookies
    redacted = redacted.replace(
      /(Bearer\s+)[A-Za-z0-9._~+/]+=*/gi,
      '$1[REDACTED_BEARER_TOKEN]',
    );
    redacted = redacted.replace(
      /("password"|"secret"|"token"|"apiKey"|"api_key")\s*:\s*"[^"]+"/gi,
      '$1:"[REDACTED_SENSITIVE_KEY]"',
    );

    return redacted;
  }

  public unregisterSecret(fingerprintId: string): void {
    this.secretValues.delete(fingerprintId);
    this.fingerprints.delete(fingerprintId);
  }

  public isRegistered(fingerprintId: string): boolean {
    return this.fingerprints.has(fingerprintId);
  }
}
