import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DefaultAgentIdentityProvider, HardwareAttestationStatus } from '../src/index.js';

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

  it('hardware attestation returns NOT_IMPLEMENTED in foundation (not VERIFIED)', async () => {
    const provider = new DefaultAgentIdentityProvider();
    const result = await provider.verifyHardwareAttestation();

    assert.strictEqual(result.status, HardwareAttestationStatus.NOT_IMPLEMENTED);
    assert.notStrictEqual(
      result.status,
      HardwareAttestationStatus.VERIFIED,
      'Foundation MUST NOT claim hardware attestation is verified',
    );
    assert.ok(result.reason.length > 0, 'Must provide a reason for NOT_IMPLEMENTED status');
  });

  it('deviceFingerprint is a software-derived SHA-256 hash, not hardware attestation', async () => {
    const deviceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const provider = new DefaultAgentIdentityProvider(deviceId);
    const identity = await provider.getIdentity();

    // Fingerprint is deterministic and derived from software deviceId
    const expected = crypto
      .createHash('sha256')
      .update(`device:${deviceId}:nexusos-desktop-agent-v1`)
      .digest('hex');
    assert.strictEqual(identity.deviceFingerprint, expected);

    // Attestation is NOT_IMPLEMENTED — fingerprint ≠ hardware proof
    const attestation = await provider.verifyHardwareAttestation();
    assert.strictEqual(attestation.status, HardwareAttestationStatus.NOT_IMPLEMENTED);
  });
});
