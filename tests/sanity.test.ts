import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NEXUSOS_CONTRACT_VERSION } from '../packages/contracts/src/index.js';

describe('Monorepo Foundation Sanity Verification', () => {
  it('verifies contract version can be imported across workspace boundary', () => {
    assert.ok(NEXUSOS_CONTRACT_VERSION);
    assert.strictEqual(NEXUSOS_CONTRACT_VERSION, '0.1.0-sprint0');
  });

  it('verifies Node environment meets minimum version requirement', () => {
    const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
    assert.ok(majorVersion >= 20, `Node version must be >= 20, got ${process.versions.node}`);
  });
});
