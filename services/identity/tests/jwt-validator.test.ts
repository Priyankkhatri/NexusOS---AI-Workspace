import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { verifyJWT, base64UrlEncode, PrincipalType } from '../src/index.js';

function createTestJWT(
  payloadOverrides: Record<string, unknown> = {},
  secretKey = 'test_secret_key_32bytes_long_key!',
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://auth.nexusos.internal',
    aud: 'nexusos-control-plane',
    sub: crypto.randomUUID(),
    tenant_id: crypto.randomUUID(),
    principal_type: PrincipalType.USER,
    iat: now,
    exp: now + 3600,
    email: 'user@nexusos.internal',
    roles: ['admin'],
    ...payloadOverrides,
  };

  const rawHeader = base64UrlEncode(JSON.stringify(header));
  const rawPayload = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secretKey).update(`${rawHeader}.${rawPayload}`).digest();
  const rawSignature = base64UrlEncode(sig);

  return `${rawHeader}.${rawPayload}.${rawSignature}`;
}

describe('JWT Validator & Signature Verification', () => {
  const secretKey = 'test_secret_key_32bytes_long_key!';
  const defaultOpts = {
    issuer: 'https://auth.nexusos.internal',
    audience: 'nexusos-control-plane',
    secretKey,
    clockToleranceSeconds: 5,
  };

  it('validates a valid signed JWT token', () => {
    const token = createTestJWT({}, secretKey);
    const verified = verifyJWT(token, defaultOpts);

    assert.strictEqual(verified.iss, defaultOpts.issuer);
    assert.strictEqual(verified.aud, defaultOpts.audience);
    assert.strictEqual(verified.principal_type, PrincipalType.USER);
    assert.strictEqual(verified.email, 'user@nexusos.internal');
  });

  it('rejects JWT with invalid signature', () => {
    const token = createTestJWT({}, 'different_wrong_secret_key_32b!');
    assert.throws(() => verifyJWT(token, defaultOpts), /INVALID_SIGNATURE/);
  });

  it('rejects expired JWT token', () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = createTestJWT({ exp: now - 3600 }, secretKey);
    assert.throws(() => verifyJWT(expiredToken, defaultOpts), /TOKEN_EXPIRED/);
  });

  it('rejects JWT with mismatched issuer', () => {
    const wrongIssuerToken = createTestJWT({ iss: 'https://evil.attacker.org' }, secretKey);
    assert.throws(() => verifyJWT(wrongIssuerToken, defaultOpts), /ISSUER_MISMATCH/);
  });

  it('rejects JWT with mismatched audience', () => {
    const wrongAudienceToken = createTestJWT({ aud: 'wrong-audience' }, secretKey);
    assert.throws(() => verifyJWT(wrongAudienceToken, defaultOpts), /AUDIENCE_MISMATCH/);
  });

  it('rejects malformed token strings', () => {
    assert.throws(() => verifyJWT('not.a.valid.jwt.format', defaultOpts), /MALFORMED_JWT/);
  });
});
