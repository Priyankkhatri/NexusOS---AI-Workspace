import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductionControlPlaneClient,
  MockTransportAdapter,
  ConnectionState,
  ConnectionStateMachine,
  ControlPlaneConfig,
} from '../src/communication/index.js';
import { AgentIdentity, HardwareAttestationStatus } from '../src/identity/agent-identity.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { MemoryCacheManager } from '../src/memory/memory-cache-manager.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { createEventEnvelope } from '@nexusos/contracts';

describe('Task 03P Control Plane Client — Functional & Lifecycle Verification', () => {
  const sampleIdentity: AgentIdentity = {
    deviceId: '11111111-1111-4111-8111-111111111111',
    deviceFingerprint: 'fingerprint123',
    pairedTenantId: '22222222-2222-4222-8222-222222222222',
    agentVersion: '0.1.0-sprint0',
    enrolledAt: new Date().toISOString(),
  };

  const identityProvider = {
    getIdentity: async () => sampleIdentity,
    verifyHardwareAttestation: async () => ({
      status: HardwareAttestationStatus.NOT_IMPLEMENTED,
      reason: 'Foundation level',
    }),
  };

  const mockConfig: ControlPlaneConfig = {
    gatewayUrl: 'wss://gateway.nexusos.internal/v1/stream',
    heartbeatIntervalMs: 60000,
    idleTimeoutMs: 180000,
    maxFrameSizeBytes: 1024 * 1024,
    maxSpoolSizeBytes: 50 * 1024 * 1024,
    reconnectInitialDelayMs: 100,
    reconnectMaxDelayMs: 1000,
    reconnectMultiplier: 2.0,
  };

  const mockLeaseBoundary = new ExecutionLeaseBoundary();

  it('connects, performs registration handshake, and reaches CONNECTED_ACTIVE state', async () => {
    const mockTransport = new MockTransportAdapter();
    const client = new ProductionControlPlaneClient(
      mockConfig,
      identityProvider,
      mockLeaseBoundary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTransport,
    );

    assert.equal(client.getConnectionState(), ConnectionState.UNPAIRED);

    await client.start();

    assert.equal(client.getConnectionState(), ConnectionState.CONNECTED_ACTIVE);
    assert.equal(mockTransport.isConnected(), true);

    await client.disconnect();
    assert.equal(client.getConnectionState(), ConnectionState.OFFLINE);
  });

  it('sends redacted posture heartbeats periodically', async () => {
    const mockTransport = new MockTransportAdapter();
    const redactionFilter = new RedactionFilter();
    const client = new ProductionControlPlaneClient(
      mockConfig,
      identityProvider,
      mockLeaseBoundary,
      undefined,
      undefined,
      undefined,
      undefined,
      redactionFilter,
      undefined,
      undefined,
      mockTransport,
    );

    await client.start();

    const result = await client.sendHeartbeat({
      deviceId: sampleIdentity.deviceId,
      tenantId: sampleIdentity.pairedTenantId,
      status: 'HEALTHY',
      agentVersion: '0.1.0-sprint0',
      activeLeasesCount: 1,
      queueSpoolState: { queuedEventsCount: 0, spoolSizeBytes: 0 },
      resourcePosture: { memoryWorkingSetBytes: 1048576 },
      timestamp: new Date().toISOString(),
    });

    assert.equal(result, true);

    await client.disconnect();
  });

  it('relays event envelopes and advances sequence cursor upon ACK', async () => {
    const mockTransport = new MockTransportAdapter();
    const memoryCache = new MemoryCacheManager();
    await memoryCache.start();

    const client = new ProductionControlPlaneClient(
      mockConfig,
      identityProvider,
      mockLeaseBoundary,
      undefined,
      undefined,
      memoryCache,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTransport,
    );

    await client.start();

    const sampleEvent = createEventEnvelope(
      'schema:nexusos:test:v1',
      '1.0.0',
      sampleIdentity.deviceId,
      '33333333-3333-4333-8333-333333333333',
      { key: 'value' },
    );

    const res = await client.relayEvent(sampleEvent);
    assert.equal(res.success, true);
    assert.equal(res.ackedSequence, 1);

    await client.disconnect();
    await memoryCache.stop();
  });

  it('buffers event relay requests locally when offline', async () => {
    const mockTransport = new MockTransportAdapter();
    const client = new ProductionControlPlaneClient(
      mockConfig,
      identityProvider,
      mockLeaseBoundary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTransport,
    );

    // Client not started (OFFLINE)
    const sampleEvent = createEventEnvelope(
      'schema:nexusos:test:v1',
      '1.0.0',
      sampleIdentity.deviceId,
      '33333333-3333-4333-8333-333333333333',
      { key: 'value' },
    );

    const res = await client.relayEvent(sampleEvent);
    assert.equal(res.success, false);
    assert.equal(res.error, 'OFFLINE_BUFFERED');
  });

  it('calculates exponential backoff with randomized full jitter correctly', () => {
    const stateMachine = new ConnectionStateMachine({
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      multiplier: 2.0,
    });

    const b1 = stateMachine.calculateNextBackoffMs();
    assert.ok(b1 >= 500 && b1 <= 1000, `Expected b1 within jitter range, got ${b1}`);

    const b2 = stateMachine.calculateNextBackoffMs();
    assert.ok(b2 >= 500 && b2 <= 2000, `Expected b2 within jitter range, got ${b2}`);

    assert.equal(stateMachine.getAttemptCount(), 2);
    stateMachine.resetAttempts();
    assert.equal(stateMachine.getAttemptCount(), 0);
  });
});
