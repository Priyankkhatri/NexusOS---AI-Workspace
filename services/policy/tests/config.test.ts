import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadPolicyConfig } from '../src/index.js';

describe('Policy Service Configuration Boundary', () => {
  it('loads default policy configuration', () => {
    const config = loadPolicyConfig({});
    assert.strictEqual(config.defaultPolicyVersion, 'v1.0.0-sprint0');
    assert.strictEqual(config.enforceStrictScopeMatching, true);
    assert.strictEqual(config.failClosedOnMissingPolicy, true);
    assert.strictEqual(config.auditEvidenceEnabled, true);
  });

  it('parses valid environment overrides for policy configuration', () => {
    const env = {
      POLICY_DEFAULT_VERSION: 'v2.1.0',
      POLICY_ENFORCE_STRICT_SCOPES: 'false',
      POLICY_FAIL_CLOSED: 'true',
      POLICY_AUDIT_ENABLED: 'true',
    };
    const config = loadPolicyConfig(env);
    assert.strictEqual(config.defaultPolicyVersion, 'v2.1.0');
    assert.strictEqual(config.enforceStrictScopeMatching, false);
    assert.strictEqual(config.failClosedOnMissingPolicy, true);
  });
});
