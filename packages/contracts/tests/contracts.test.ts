import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NEXUSOS_CONTRACT_VERSION, ErrorCategory, createNexusOSError } from '../src/index.js';

describe('@nexusos/contracts Foundation', () => {
  it('exposes a valid contract version string', () => {
    assert.strictEqual(typeof NEXUSOS_CONTRACT_VERSION, 'string');
    assert.strictEqual(NEXUSOS_CONTRACT_VERSION, '0.1.0-sprint0');
  });

  it('creates structured NexusOS errors matching specification taxonomy', () => {
    const err = createNexusOSError(
      'POLICY_VIOLATION_01',
      ErrorCategory.POLICY_DENIED,
      'Access denied by policy engine',
      { correlationId: 'test-corr-123' },
    );

    assert.strictEqual(err.code, 'POLICY_VIOLATION_01');
    assert.strictEqual(err.category, ErrorCategory.POLICY_DENIED);
    assert.strictEqual(err.correlationId, 'test-corr-123');
    assert.ok(err.timestamp);
  });
});
