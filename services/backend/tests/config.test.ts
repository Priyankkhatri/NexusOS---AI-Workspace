import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadBackendConfig } from '../src/index.js';

describe('Backend Service Configuration Boundary', () => {
  it('loads valid default configuration', () => {
    const config = loadBackendConfig({});
    assert.strictEqual(config.port, 3000);
    assert.strictEqual(config.host, '0.0.0.0');
    assert.strictEqual(config.nodeEnv, 'development');
    assert.strictEqual(config.logLevel, 'info');
  });

  it('parses valid environment override configuration', () => {
    const env = {
      PORT: '8080',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/nexusos',
    };
    const config = loadBackendConfig(env);
    assert.strictEqual(config.port, 8080);
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.nodeEnv, 'test');
    assert.strictEqual(config.logLevel, 'debug');
    assert.strictEqual(config.databaseUrl, env.DATABASE_URL);
  });

  it('rejects invalid configuration safely without exposing credentials', () => {
    const invalidEnv = {
      PORT: 'not-a-number',
      NODE_ENV: 'invalid-env',
    };
    assert.throws(() => loadBackendConfig(invalidEnv), /\[BackendConfigError\]/);
  });
});
