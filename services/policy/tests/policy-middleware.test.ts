import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http, { Server } from 'node:http';
import crypto from 'node:crypto';
import {
  createAuthenticatedContext,
  PrincipalType,
  UserIdentity,
  AuthenticatedIncomingMessage,
} from '@nexusos/identity';
import {
  ReferencePolicyEvaluator,
  loadPolicyConfig,
  createPolicyMiddleware,
  PolicyEffect,
} from '../src/index.js';

describe('HTTP Policy Middleware & 403 Error Envelopes', () => {
  let policyServer: Server;
  let baseUrl: string;

  before(async () => {
    const config = loadPolicyConfig({});
    const evaluator = new ReferencePolicyEvaluator(config, [
      {
        ruleId: 'allow-public-read',
        actionName: 'read',
        resourceType: 'public-doc',
        effect: PolicyEffect.ALLOW,
      },
      {
        ruleId: 'deny-secret-write',
        actionName: 'write',
        resourceType: 'secret-vault',
        effect: PolicyEffect.DENY,
      },
    ]);

    const policyMiddleware = createPolicyMiddleware(evaluator);

    policyServer = http.createServer(async (req, res) => {
      // Attach mock authenticated user context if header present
      const authHeader = req.headers['x-mock-role'];
      if (authHeader) {
        const user: UserIdentity = {
          type: PrincipalType.USER,
          userId: crypto.randomUUID(),
          tenantId: crypto.randomUUID(),
          email: 'test@nexusos.internal',
          roles: [String(authHeader)],
        };
        (req as AuthenticatedIncomingMessage).authenticatedContext = createAuthenticatedContext(
          user,
          new Date(),
          new Date(Date.now() + 3600000),
          'mock-token',
        );
      }

      if (req.url === '/v1/public-doc') {
        const allowed = await policyMiddleware({
          actionName: 'read',
          resourceType: 'public-doc',
        })(req as AuthenticatedIncomingMessage, res);

        if (allowed && !res.writableEnded) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ALLOWED' }));
        }
      } else if (req.url === '/v1/secret-vault') {
        const allowed = await policyMiddleware({
          actionName: 'write',
          resourceType: 'secret-vault',
        })(req as AuthenticatedIncomingMessage, res);

        if (allowed && !res.writableEnded) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ALLOWED' }));
        }
      }
    });

    await new Promise<void>((resolve) => {
      policyServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = policyServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (policyServer) {
      await new Promise<void>((resolve) => policyServer.close(() => resolve()));
    }
  });

  it('responds with 200 ALLOWED when policy evaluation permits action', async () => {
    const res = await fetch(`${baseUrl}/v1/public-doc`, {
      headers: { 'x-mock-role': 'operator' },
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.strictEqual(body.status, 'ALLOWED');
  });

  it('rejects forbidden policy requests with structured 403 error envelope', async () => {
    const res = await fetch(`${baseUrl}/v1/secret-vault`, {
      headers: { 'x-mock-role': 'operator' },
    });
    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; category: string };
    };

    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.strictEqual(body.error.category, 'AUTHORIZATION');
  });

  it('rejects requests missing authenticated context with 403 error envelope', async () => {
    const res = await fetch(`${baseUrl}/v1/public-doc`);
    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { success: boolean; error: { category: string } };
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.category, 'AUTHORIZATION');
  });
});
