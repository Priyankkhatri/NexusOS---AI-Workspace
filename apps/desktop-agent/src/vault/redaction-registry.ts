import crypto from 'node:crypto';
import { ISecretRedactionRegistry } from './types.js';

/**
 * SecretRedactionRegistry
 *
 * Stores registered secret values as mutable Node Buffers (not JS strings) so
 * they can be zeroized on unregister.  JS strings are immutable in V8 and
 * cannot be wiped from memory; this is an explicit platform limitation
 * documented here.  The redactText() method necessarily creates temporary
 * string copies during comparison; these are short-lived and subject to V8 GC.
 *
 * The registry MUST be used BEFORE any secret payload enters a runner channel
 * or appears in logs, evidence, diagnostics, or event envelopes.
 */
export class SecretRedactionRegistry implements ISecretRedactionRegistry {
  /** fingerprintId → mutable Buffer holding the secret bytes */
  private readonly secretBuffers = new Map<string, Buffer>();
  private readonly fingerprints = new Set<string>();

  public registerSecret(secretValue: string | Buffer, fingerprintId: string): void {
    if (!secretValue || !fingerprintId) return;

    // Allocate a NEW mutable buffer that the registry owns
    const buf =
      typeof secretValue === 'string'
        ? Buffer.from(secretValue, 'utf-8')
        : Buffer.from(secretValue); // defensive copy

    if (buf.length === 0) return;

    this.secretBuffers.set(fingerprintId, buf);
    this.fingerprints.add(fingerprintId);
  }

  public redactText(input: string): string {
    if (!input || typeof input !== 'string') return input;

    let redacted = input;

    // 1. Redact registered exact secret values
    // NOTE: Converting Buffer→string is necessary for comparison; the temporary
    // string is short-lived and will be GC'd by V8.  This is an acknowledged
    // platform limitation — V8 does not provide mutable-string primitives.
    for (const [fingerprintId, secretBuf] of this.secretBuffers.entries()) {
      if (secretBuf.length > 0) {
        const secretStr = secretBuf.toString('utf-8');
        if (redacted.includes(secretStr)) {
          const replacement = `[REDACTED_SECRET_${fingerprintId.slice(0, 8)}]`;
          redacted = redacted.split(secretStr).join(replacement);
        }
      }
    }

    // 2. Pattern redaction for bearer tokens, passwords, authorization headers, and cookies
    redacted = redacted.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED_BEARER_TOKEN]');
    redacted = redacted.replace(
      /("password"|"secret"|"token"|"apiKey"|"api_key"|"authorization")\s*:\s*"[^"]+"/gi,
      '$1:"[REDACTED_SENSITIVE_KEY]"',
    );

    // 3. Redact URL-embedded credentials (e.g. https://user:pass@host)
    redacted = redacted.replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED_URL_CREDENTIAL]@');

    return redacted;
  }

  /**
   * Unregisters AND zeroizes the stored secret buffer.
   * After this call, the mutable buffer memory is overwritten with zeroes.
   */
  public unregisterSecret(fingerprintId: string): void {
    const buf = this.secretBuffers.get(fingerprintId);
    if (buf && Buffer.isBuffer(buf)) {
      // Cryptographic zeroization of mutable Buffer memory
      crypto.randomFillSync(buf); // overwrite with random before zeroing (defense-in-depth)
      buf.fill(0);
    }
    this.secretBuffers.delete(fingerprintId);
    this.fingerprints.delete(fingerprintId);
  }

  public isRegistered(fingerprintId: string): boolean {
    return this.fingerprints.has(fingerprintId);
  }
}
