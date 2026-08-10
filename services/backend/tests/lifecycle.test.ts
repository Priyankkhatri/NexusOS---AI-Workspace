import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BackendApp, loadBackendConfig, ServiceLifecycleState } from '../src/index.js';

describe('Backend Service Lifecycle & Graceful Shutdown', () => {
  it('transitions lifecycle state correctly through start and stop', async () => {
    const config = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    const app = new BackendApp(config);

    assert.strictEqual(app.lifecycle.getState(), ServiceLifecycleState.PROVISIONED);

    const server = await app.start();
    assert.strictEqual(app.lifecycle.getState(), ServiceLifecycleState.HEALTHY);

    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Verify readiness while healthy
    const res1 = await fetch(`${baseUrl}/health/readiness`);
    assert.strictEqual(res1.status, 200);

    // Stop app
    await app.stop();
    assert.strictEqual(app.lifecycle.getState(), ServiceLifecycleState.STOPPED);
  });
});
