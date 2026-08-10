import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadDesktopAgentConfig } from '../src/index.js';

describe('Desktop Agent Configuration Boundary', () => {
  it('loads valid default desktop agent configuration', () => {
    const config = loadDesktopAgentConfig({});
    assert.strictEqual(config.agentVersion, '0.1.0-sprint0');
    assert.strictEqual(config.environment, 'development');
    assert.strictEqual(config.heartbeatIntervalMs, 10000);
    assert.strictEqual(config.maxConcurrentLeases, 3);
  });

  it('parses valid environment overrides for desktop agent configuration', () => {
    const env = {
      AGENT_DEVICE_ID: '11111111-2222-3333-4444-555555555555',
      AGENT_VERSION: '0.2.0',
      AGENT_CONTROL_PLANE_URL: 'https://gateway.prod.nexusos.internal',
      NODE_ENV: 'production',
      AGENT_LOG_LEVEL: 'warn',
      AGENT_HEARTBEAT_INTERVAL_MS: '5000',
      AGENT_MAX_CONCURRENT_LEASES: '5',
    };

    const config = loadDesktopAgentConfig(env);
    assert.strictEqual(config.deviceId, '11111111-2222-3333-4444-555555555555');
    assert.strictEqual(config.agentVersion, '0.2.0');
    assert.strictEqual(config.controlPlaneUrl, 'https://gateway.prod.nexusos.internal');
    assert.strictEqual(config.environment, 'production');
    assert.strictEqual(config.logLevel, 'warn');
    assert.strictEqual(config.heartbeatIntervalMs, 5000);
    assert.strictEqual(config.maxConcurrentLeases, 5);
  });

  it('rejects invalid device ID safely', () => {
    assert.throws(
      () => loadDesktopAgentConfig({ AGENT_DEVICE_ID: 'invalid-uuid-format' }),
      /\[DesktopAgentConfigError\]/,
    );
  });
});
