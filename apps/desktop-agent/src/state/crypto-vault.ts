import crypto from 'node:crypto';
import { EncryptedStateEnvelopeSchema } from './schemas.js';
import { EncryptedStateEnvelope } from './types.js';

export class StateCryptoVault {
  private readonly derivedKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor(secretKey: string) {
    if (!secretKey || secretKey.trim().length < 16) {
      throw new Error('Encryption key must be at least 16 characters long.');
    }

    if (secretKey.includes('default_insecure_key') || secretKey === '0000000000000000') {
      throw new Error('Insecure or predictable default encryption key rejected.');
    }

    // Derive 256-bit AES key and 256-bit HMAC key via HKDF / PBKDF2
    const masterKey = crypto.pbkdf2Sync(secretKey, 'NexusOS_State_Salt_v1', 10000, 64, 'sha256');

    this.derivedKey = masterKey.subarray(0, 32);
    this.hmacKey = masterKey.subarray(32, 64);
  }

  public encrypt(plaintext: string): EncryptedStateEnvelope {
    if (typeof plaintext !== 'string') {
      throw new Error('Plaintext payload must be a string.');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.derivedKey, iv);

    const encryptedBuffer = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    const ivB64 = iv.toString('base64');
    const authTagB64 = authTag.toString('base64');
    const ciphertextB64 = encryptedBuffer.toString('base64');

    const canonicalSigString = `AES-256-GCM:${ivB64}:${authTagB64}:${ciphertextB64}`;
    const hmacB64 = crypto
      .createHmac('sha256', this.hmacKey)
      .update(canonicalSigString)
      .digest('base64');

    return {
      formatVersion: '1.0.0',
      algorithm: 'AES-256-GCM',
      iv: ivB64,
      authTag: authTagB64,
      hmac: hmacB64,
      ciphertext: ciphertextB64,
    };
  }

  public decrypt(envelope: EncryptedStateEnvelope): string {
    const parseResult = EncryptedStateEnvelopeSchema.safeParse(envelope);
    if (!parseResult.success) {
      throw new Error(`Malformed encrypted state envelope: ${parseResult.error.message}`);
    }

    const { iv, authTag, hmac, ciphertext } = parseResult.data;

    // 1. Verify HMAC Signature (Timing-Safe)
    const canonicalSigString = `AES-256-GCM:${iv}:${authTag}:${ciphertext}`;
    const expectedHmacB64 = crypto
      .createHmac('sha256', this.hmacKey)
      .update(canonicalSigString)
      .digest('base64');

    const hmacBuf = Buffer.from(hmac, 'base64');
    const expectedHmacBuf = Buffer.from(expectedHmacB64, 'base64');

    if (
      hmacBuf.length !== expectedHmacBuf.length ||
      !crypto.timingSafeEqual(hmacBuf, expectedHmacBuf)
    ) {
      throw new Error(
        'Integrity verification failed: HMAC signature mismatch / tampered envelope.',
      );
    }

    // 2. Decrypt AES-256-GCM Payload
    const ivBuf = Buffer.from(iv, 'base64');
    const authTagBuf = Buffer.from(authTag, 'base64');
    const ciphertextBuf = Buffer.from(ciphertext, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.derivedKey, ivBuf);
    decipher.setAuthTag(authTagBuf);

    try {
      const decryptedBuf = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]);
      return decryptedBuf.toString('utf-8');
    } catch {
      throw new Error(
        'Decryption failed: GCM authentication tag mismatch or corrupted ciphertext.',
      );
    }
  }

  public computeChecksum(payload: unknown): string {
    const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(jsonStr).digest('hex');
  }
}
