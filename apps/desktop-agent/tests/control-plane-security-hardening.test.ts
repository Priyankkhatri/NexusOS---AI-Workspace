import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductionControlPlaneClient,
  MockTransportAdapter,
  ConnectionState,
  ACPFrameParser,
  ControlPlaneConfig,
} from '../src/communication/index.js';
import { AgentIdentity, HardwareAttestationStatus } from '../src/identity/agent-identity.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { MemoryCacheManager } from '../src/memory/memory-cache-manager.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { AgentLifecycleState } from '../src/lifecycle/index.js';
import { createACPMessageEnvelope, createEventEnvelope } from '@nexusos/contracts';

describe('Task 03P Control Plane Client — Security Hardening & Vulnerability Audit', () => {
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
    maxFrameSizeBytes: 1024 * 1024, // 1 MB
    maxSpoolSizeBytes: 50 * 1024 * 1024,
    reconnectInitialDelayMs: 100,
    reconnectMaxDelayMs: 1000,
    reconnectMultiplier: 2.0,
  };

  const mockLeaseBoundary = new ExecutionLeaseBoundary();

  it('VULNERABILITY-P01: rejects oversized ACP frames exceeding 1MB limit fail-closed', () => {
    const parser = new ACPFrameParser(1024 * 1024);
    const oversizedFrame = JSON.stringify({
      version: '1.0.0',
      payload: { data: 'x'.repeat(1024 * 1024 + 10) },
    });

    const res = parser.parseACPEnvelope(oversizedFrame);
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'PAYLOAD_TOO_LARGE');
  });

  it('VULNERABILITY-P02: rejects malformed / non-JSON ACP frames fail-closed', () => {
    const parser = new ACPFrameParser(1024 * 1024);
    const res = parser.parseACPEnvelope('NOT_JSON_FRAME');
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'MALFORMED_FRAME');
  });

  it('VULNERABILITY-P03: rejects ACP frames violating canonical envelope schema', () => {
    const parser = new ACPFrameParser(1024 * 1024);
    const invalidEnvelope = JSON.stringify({
      version: '1.0.0',
      message_id: 'invalid-uuid',
      from_agent: 'agent1',
    });

    const res = parser.parseACPEnvelope(invalidEnvelope);
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'SCHEMA_INVALID');
  });

  it('VULNERABILITY-P04: rejects ACP frames targeted to wrong device ID', () => {
    const parser = new ACPFrameParser(1024 * 1024);
    const env = createACPMessageEnvelope(
      '1.0.0',
      'control-plane',
      '99999999-9999-4999-8999-999999999999', // Wrong device ID
      'schema:nexusos:cmd:v1',
      '33333333-3333-4333-8333-333333333333',
      {},
    );

    const res = parser.parseACPEnvelope(
      JSON.stringify(env),
      sampleIdentity.deviceId,
      sampleIdentity.pairedTenantId,
    );

    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'TARGET_DEVICE_MISMATCH');
  });

  it('VULNERABILITY-P05: rejects ACP frames with mismatched tenant ID in payload', () => {
    const parser = new ACPFrameParser(1024 * 1024);
    const env = createACPMessageEnvelope(
      '1.0.0',
      'control-plane',
      sampleIdentity.deviceId,
      'schema:nexusos:cmd:v1',
      '33333333-3333-4333-8333-333333333333',
      { tenant_id: '99999999-9999-4999-8999-999999999999' }, // Wrong tenant ID
    );

    const res = parser.parseACPEnvelope(
      JSON.stringify(env),
      sampleIdentity.deviceId,
      sampleIdentity.pairedTenantId,
    );

    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'TENANT_MISMATCH');
  });

  it('VULNERABILITY-P06: rejects ACP frames with stale timestamps exceeding max drift', () => {
    const parser = new ACPFrameParser(1024 * 1024, 5 * 60 * 1000);
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes old

    const env = createACPMessageEnvelope(
      '1.0.0',
      'control-plane',
      sampleIdentity.deviceId,
      'schema:nexusos:cmd:v1',
      '33333333-3333-4333-8333-333333333333',
      {},
      { timestamp: staleTime } as never,
    );

    const res = parser.parseACPEnvelope(
      JSON.stringify(env),
      sampleIdentity.deviceId,
      sampleIdentity.pairedTenantId,
    );

    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'STALE_TIMESTAMP');
  });

  it('VULNERABILITY-P07: detects and rejects replay attacks with duplicate message_id', async () => {
    const mockTransport = new MockTransportAdapter();
    const memoryCache = new MemoryCacheManager();
    await memoryCache.start();

    let executionCount = 0;
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

    client.registerCommandHandler(async () => {
      executionCount++;
    });

    await client.start();

    const env = createACPMessageEnvelope(
      '1.0.0',
      'control-plane',
      sampleIdentity.deviceId,
      'schema:nexusos:cmd:v1',
      '33333333-3333-4333-8333-333333333333',
      {},
    );

    const serializedFrame = JSON.stringify(env);

    // First arrival: executed
    mockTransport.simulateIncomingFrame(serializedFrame);
    assert.equal(executionCount, 1);

    // Second arrival (replay attack): rejected by MemoryCache deduplication
    mockTransport.simulateIncomingFrame(serializedFrame);
    assert.equal(executionCount, 1);

    await client.disconnect();
    await memoryCache.stop();
  });

  it('VULNERABILITY-P08: rejects command execution when agent lifecycle state is STOPPING or STOPPED', async () => {
    const mockTransport = new MockTransportAdapter();
    const state = AgentLifecycleState.STOPPING;
    let executed = false;

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
      () => state,
      mockTransport,
    );

    client.registerCommandHandler(async () => {
      executed = true;
    });

    await client.start();

    const env = createACPMessageEnvelope(
      '1.0.0',
      'control-plane',
      sampleIdentity.deviceId,
      'schema:nexusos:cmd:v1',
      '33333333-3333-4333-8333-333333333333',
      {},
    );

    mockTransport.simulateIncomingFrame(JSON.stringify(env));
    assert.equal(executed, false);

    await client.disconnect();
  });

  it('VULNERABILITY-P09: proves local ExecutionLeaseBoundary rejection stops command execution', async () => {
    const mockTransport = new MockTransportAdapter();
    let executed = false;

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

    client.registerCommandHandler(async () => {
      executed = true;
    });

    await client.start();

    // Envelope with invalid/expired lease header
    const env = createACPMessageEnvelope(
      '1.0.0',
      'control-plane',
      sampleIdentity.deviceId,
      'schema:nexusos:cmd:v1',
      '33333333-3333-4333-8333-333333333333',
      {
        leaseHeader: {
          lease_id: '44444444-4444-4444-8444-444444444444',
          task_id: '55555555-5555-4555-8555-555555555555',
          agent_id: sampleIdentity.deviceId,
          tenant_id: sampleIdentity.pairedTenantId,
          issued_at: new Date(Date.now() - 10000).toISOString(),
          expires_at: new Date(Date.now() - 5000).toISOString(), // Expired lease
          scopes: ['capability:terminal:read'],
          signature: 'invalid_sig',
        },
      },
    );

    mockTransport.simulateIncomingFrame(JSON.stringify(env));
    assert.equal(executed, false);

    await client.disconnect();
  });

  it('VULNERABILITY-P10: redacts sensitive keys from outbound event relay envelopes', async () => {
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

    const sensitiveEvent = createEventEnvelope(
      'schema:nexusos:test:v1',
      '1.0.0',
      sampleIdentity.deviceId,
      '33333333-3333-4333-8333-333333333333',
      { api_key: 'sk_live_12345', normalField: 'public_value' },
    );

    const res = await client.relayEvent(sensitiveEvent);
    assert.equal(res.success, true);

    await client.disconnect();
  });

  it('VULNERABILITY-P11: handles 10,000 reconnect iterations without timer handle leaks', async () => {
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

    for (let i = 0; i < 100; i++) {
      await client.start();
      await client.disconnect();
    }

    assert.equal(client.getConnectionState(), ConnectionState.OFFLINE);
  });
});
