import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DefaultAgentIdentityProvider } from '../src/index.js';

describe('Desktop Agent Identity Boundary', () => {
  it('resolves a valid AgentIdentity with deterministic fingerprint', async () => {
    const deviceId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const provider = new DefaultAgentIdentityProvider(deviceId, tenantId, '0.1.0-sprint0');

    const identity = await provider.getIdentity();

    assert.strictEqual(identity.deviceId, deviceId);
    assert.strictEqual(identity.pairedTenantId, tenantId);
    assert.strictEqual(identity.agentVersion, '0.1.0-sprint0');
    assert.ok(identity.deviceFingerprint.length > 0, 'Fingerprint must be non-empty');
    assert.ok(identity.enrolledAt.length > 0, 'enrolledAt must be set');
  });

  it('returns the same cached identity on subsequent calls', async () => {
    const provider = new DefaultAgentIdentityProvider();
    const first = await provider.getIdentity();
    const second = await provider.getIdentity();

    assert.strictEqual(first, second, 'Identity must be referentially identical (cached)');
  });

  it('produces an immutable (frozen) identity object', async () => {
    const provider = new DefaultAgentIdentityProvider();
    const identity = await provider.getIdentity();

    assert.ok(Object.isFrozen(identity), 'Identity object must be frozen');
  });

  it('calculates a sha256 device fingerprint', async () => {
    const deviceId = '11111111-2222-3333-4444-555555555555';
    const provider = new DefaultAgentIdentityProvider(deviceId);
    const identity = await provider.getIdentity();

    const expected = crypto
      .createHash('sha256')
      .update(`device:${deviceId}:nexusos-desktop-agent-v1`)
      .digest('hex');

    assert.strictEqual(identity.deviceFingerprint, expected);
  });

  it('hardware attestation boundary returns true (foundation placeholder)', async () => {
    const provider = new DefaultAgentIdentityProvider();
    const result = await provider.verifyHardwareAttestation();
    assert.strictEqual(result, true);
  });
});
