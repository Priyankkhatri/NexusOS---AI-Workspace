import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { BackendApp, loadBackendConfig, ServiceLifecycleState } from '../src/index.js';

describe('Backend HTTP Server & Context Propagation', () => {
  let app: BackendApp;
  let baseUrl: string;

  before(async () => {
    const config = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    app = new BackendApp(config);
    const server = await app.start();
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (app) {
      await app.stop();
    }
  });

  it('responds to GET /health/liveness with 200 OK', async () => {
    const res = await fetch(`${baseUrl}/health/liveness`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(body.status, 'HEALTHY');
    assert.strictEqual(body.state, ServiceLifecycleState.HEALTHY);
    assert.ok(typeof body.uptimeSeconds === 'number');
  });

  it('responds to GET /health/readiness with 200 OK when ready', async () => {
    const res = await fetch(`${baseUrl}/health/readiness`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(body.status, 'READY');
  });

  it('propagates x-request-id and x-correlation-id headers', async () => {
    const reqId = crypto.randomUUID();
    const corrId = crypto.randomUUID();

    const res = await fetch(`${baseUrl}/health/liveness`, {
      headers: {
        'x-request-id': reqId,
        'x-correlation-id': corrId,
      },
    });

    assert.strictEqual(res.headers.get('x-request-id'), reqId);
    assert.strictEqual(res.headers.get('x-correlation-id'), corrId);
  });

  it('generates fallback UUIDs for missing context headers', async () => {
    const res = await fetch(`${baseUrl}/health/liveness`);
    const respReqId = res.headers.get('x-request-id');
    const respCorrId = res.headers.get('x-correlation-id');

    assert.ok(respReqId && respReqId.length > 0);
    assert.ok(respCorrId && respCorrId.length > 0);
  });

  it('returns structured 404 for unhandled endpoints', async () => {
    const res = await fetch(`${baseUrl}/v1/unknown-endpoint`);
    assert.strictEqual(res.status, 404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    assert.strictEqual(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.requestId);
  });
});
