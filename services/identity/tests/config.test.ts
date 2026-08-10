import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadIdentityConfig } from '../src/index.js';

describe('Identity Service Configuration Boundary', () => {
  it('loads default identity configuration', () => {
    const config = loadIdentityConfig({});
    assert.strictEqual(config.issuer, 'https://auth.nexusos.internal');
    assert.strictEqual(config.audience, 'nexusos-control-plane');
    assert.strictEqual(config.tokenClockToleranceSeconds, 5);
  });

  it('parses valid environment override identity configuration', () => {
    const env = {
      IDENTITY_ISSUER: 'https://identity.enterprise.org',
      IDENTITY_AUDIENCE: 'nexusos-prod',
      IDENTITY_SECRET_KEY: 'custom_secure_secret_key_32bytes_long!',
      IDENTITY_TOKEN_CLOCK_TOLERANCE: '10',
    };
    const config = loadIdentityConfig(env);
    assert.strictEqual(config.issuer, 'https://identity.enterprise.org');
    assert.strictEqual(config.audience, 'nexusos-prod');
    assert.strictEqual(config.secretKey, 'custom_secure_secret_key_32bytes_long!');
    assert.strictEqual(config.tokenClockToleranceSeconds, 10);
  });

  it('rejects invalid issuer URL safely', () => {
    assert.throws(
      () => loadIdentityConfig({ IDENTITY_ISSUER: 'not-a-valid-url' }),
      /\[IdentityConfigError\]/,
    );
  });
});
