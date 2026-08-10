import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http, { Server } from 'node:http';
import crypto from 'node:crypto';
import { loadBackendConfig } from '@nexusos/backend';
import {
  loadIdentityConfig,
  OIDCAuthenticationProvider,
  createAuthenticationMiddleware,
  AuthenticatedIncomingMessage,
  base64UrlEncode,
  PrincipalType,
} from '../src/index.js';

function createValidToken(secretKey: string): string {
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
    email: 'test@nexusos.internal',
    roles: ['user'],
  };

  const rawHeader = base64UrlEncode(JSON.stringify(header));
  const rawPayload = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secretKey).update(`${rawHeader}.${rawPayload}`).digest();
  const rawSignature = base64UrlEncode(sig);

  return `${rawHeader}.${rawPayload}.${rawSignature}`;
}

describe('HTTP Authentication Middleware & Error Envelopes', () => {
  let authServer: Server;
  let baseUrl: string;
  const secretKey = 'identity_test_secret_key_32b_long!';

  before(async () => {
    loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    const identityConfig = loadIdentityConfig({
      IDENTITY_SECRET_KEY: secretKey,
    });
    const provider = new OIDCAuthenticationProvider(identityConfig);
    const authMiddleware = createAuthenticationMiddleware(provider, identityConfig);

    // Create test HTTP server wrapping auth middleware
    authServer = http.createServer(async (req, res) => {
      const allowed = await authMiddleware(req as AuthenticatedIncomingMessage, res);
      if (allowed && !res.writableEnded) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            status: 'AUTHENTICATED',
            principal: (req as AuthenticatedIncomingMessage).authenticatedContext?.principal,
          }),
        );
      }
    });

    await new Promise<void>((resolve) => {
      authServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = authServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (authServer) {
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
    }
  });

  it('bypasses authentication for allowed anonymous endpoints like /health/liveness', async () => {
    const res = await fetch(`${baseUrl}/health/liveness`);
    assert.strictEqual(res.status, 200);
  });

  it('rejects requests without authentication credentials with structured 401 error envelope', async () => {
    const res = await fetch(`${baseUrl}/v1/protected-resource`);
    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; category: string };
    };

    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHENTICATED');
    assert.strictEqual(body.error.category, 'AUTHENTICATION');
  });

  it('rejects requests with invalid or forged bearer tokens with 401 error envelope', async () => {
    const res = await fetch(`${baseUrl}/v1/protected-resource`, {
      headers: {
        Authorization: 'Bearer invalid.forged.jwttoken',
      },
    });

    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    assert.strictEqual(body.success, false);
    assert.ok(body.error.code);
  });

  it('accepts requests with valid bearer tokens and attaches AuthenticatedContext', async () => {
    const validToken = createValidToken(secretKey);
    const res = await fetch(`${baseUrl}/v1/protected-resource`, {
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      principal: { type: string; email: string };
    };
    assert.strictEqual(body.status, 'AUTHENTICATED');
    assert.strictEqual(body.principal.type, 'USER');
    assert.strictEqual(body.principal.email, 'test@nexusos.internal');
  });
});
