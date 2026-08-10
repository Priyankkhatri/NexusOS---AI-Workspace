import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  NEXUSOS_CONTRACT_VERSION,
  ErrorCategory,
  createNexusOSError,
  NexusOSErrorSchema,
  EventEnvelopeSchema,
  createEventEnvelope,
  ACPMessageEnvelopeSchema,
  createACPMessageEnvelope,
  ExecutionLeaseHeaderSchema,
  APISuccessResponseSchema,
  serializeContract,
  deserializeContract,
  TenantIdSchema,
} from '../src/index.js';
import { z } from 'zod';

describe('@nexusos/contracts Foundation & Schema Validation Audit', () => {
  it('exposes a valid contract version string', () => {
    assert.strictEqual(typeof NEXUSOS_CONTRACT_VERSION, 'string');
    assert.strictEqual(NEXUSOS_CONTRACT_VERSION, '0.1.0-sprint0');
  });

  describe('Identity & UUID Validation', () => {
    it('accepts valid UUID strings', () => {
      const validUuid = crypto.randomUUID();
      assert.strictEqual(TenantIdSchema.parse(validUuid), validUuid);
    });

    it('rejects invalid UUID strings', () => {
      assert.throws(() => TenantIdSchema.parse('not-a-uuid'), /Invalid uuid/i);
    });
  });

  describe('Error Taxonomy & Schema Validation', () => {
    it('creates structured NexusOS errors matching specification taxonomy', () => {
      const corrId = crypto.randomUUID();
      const reqId = crypto.randomUUID();
      const err = createNexusOSError(
        'POLICY_VIOLATION_01',
        ErrorCategory.POLICY_DENIED,
        'Access denied by policy engine',
        { correlationId: corrId, requestId: reqId, details: { scope: 'desktop' } },
      );

      assert.strictEqual(err.code, 'POLICY_VIOLATION_01');
      assert.strictEqual(err.category, ErrorCategory.POLICY_DENIED);
      assert.strictEqual(err.correlationId, corrId);
      assert.strictEqual(err.requestId, reqId);
      assert.deepStrictEqual(err.details, { scope: 'desktop' });
      assert.ok(err.timestamp);
    });

    it('rejects errors with invalid categories or missing fields', () => {
      assert.throws(() => {
        NexusOSErrorSchema.parse({
          code: 'ERR_01',
          category: 'INVALID_CATEGORY',
          message: 'Error message',
          timestamp: new Date().toISOString(),
        });
      });
    });
  });

  describe('Event Envelope Schema Audit & Validation', () => {
    it('validates a valid event envelope with payload_ref and trace_id', () => {
      const corrId = crypto.randomUUID();
      const env = createEventEnvelope(
        'nexusos.system.task.created',
        '1.0',
        'orchestrator-service',
        corrId,
        { taskId: 'task-123', status: 'PENDING' },
        { payload_ref: 'art-99128', trace_id: 'tr-1102' },
      );

      assert.strictEqual(env.schema_id, 'nexusos.system.task.created');
      assert.strictEqual(env.version, '1.0');
      assert.strictEqual(env.producer_id, 'orchestrator-service');
      assert.strictEqual(env.correlation_id, corrId);
      assert.strictEqual(env.payload_ref, 'art-99128');
      assert.strictEqual(env.trace_id, 'tr-1102');
      assert.ok(EventEnvelopeSchema.safeParse(env).success);
    });

    it('rejects event envelope with invalid UUIDs or missing payload', () => {
      assert.throws(() => {
        EventEnvelopeSchema.parse({
          schema_id: 'nexusos.test',
          version: '1.0',
          event_id: 'invalid-id',
          correlation_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          producer_id: 'prod-1',
          payload: {},
        });
      });
    });
  });

  describe('ACP Message Envelope Schema Audit & Validation', () => {
    it('validates a valid ACP message envelope with auth_token, body_ref, and trace_hints', () => {
      const corrId = crypto.randomUUID();
      const acpMsg = createACPMessageEnvelope(
        '1.0',
        'agent-desktop-win01',
        'device-gateway',
        'acp.heartbeat.v1',
        corrId,
        { status: 'HEALTHY', battery: 100 },
        {
          auth_token: 'bearer_token_xyz',
          body_ref: 'art-88219',
          trace_hints: { parent_span: 'span-01' },
        },
      );

      assert.strictEqual(acpMsg.from_agent, 'agent-desktop-win01');
      assert.strictEqual(acpMsg.to_agent, 'device-gateway');
      assert.strictEqual(acpMsg.schema_id, 'acp.heartbeat.v1');
      assert.strictEqual(acpMsg.auth_token, 'bearer_token_xyz');
      assert.strictEqual(acpMsg.body_ref, 'art-88219');
      assert.deepStrictEqual(acpMsg.trace_hints, { parent_span: 'span-01' });
      assert.ok(ACPMessageEnvelopeSchema.safeParse(acpMsg).success);
    });

    it('rejects ACP envelope with missing to_agent or invalid timestamp', () => {
      assert.throws(() => {
        ACPMessageEnvelopeSchema.parse({
          version: '1.0',
          message_id: crypto.randomUUID(),
          correlation_id: crypto.randomUUID(),
          from_agent: 'agent-1',
          timestamp: 'invalid-date',
          schema_id: 'acp.test',
          payload: {},
        });
      });
    });
  });

  describe('Execution Lease Header Schema Audit & Validation', () => {
    it('validates a signed execution lease header with nonce and policy_hash', () => {
      const lease = {
        lease_id: crypto.randomUUID(),
        task_id: crypto.randomUUID(),
        agent_id: 'agent-desktop-01',
        tenant_id: crypto.randomUUID(),
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        scopes: ['file:read', 'terminal:exec'],
        signature: 'sig_ecdsa_sample_123',
        nonce: 'nonce-7712',
        policy_hash: 'sha256:abc123def456',
      };

      const parsed = ExecutionLeaseHeaderSchema.parse(lease);
      assert.strictEqual(parsed.agent_id, 'agent-desktop-01');
      assert.strictEqual(parsed.nonce, 'nonce-7712');
      assert.strictEqual(parsed.policy_hash, 'sha256:abc123def456');
      assert.strictEqual(parsed.scopes.length, 2);
    });

    it('rejects execution lease without scopes or signature', () => {
      assert.throws(() => {
        ExecutionLeaseHeaderSchema.parse({
          lease_id: crypto.randomUUID(),
          task_id: crypto.randomUUID(),
          agent_id: 'agent-01',
          tenant_id: crypto.randomUUID(),
          issued_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          scopes: [], // Must have at least 1 scope
          signature: 'sig',
        });
      });
    });
  });

  describe('Serialization and Deserialization Boundaries', () => {
    it('serializes and deserializes contracts accurately', () => {
      const meta = {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        clientVersion: '0.1.0',
      };

      const PayloadSchema = z.object({ taskName: z.string() });
      const ResponseSchema = APISuccessResponseSchema(PayloadSchema);

      const resInstance = {
        success: true as const,
        data: { taskName: 'Analyze repository' },
        meta,
      };

      const serialized = serializeContract(ResponseSchema, resInstance);
      assert.strictEqual(typeof serialized, 'string');

      const deserialized = deserializeContract(ResponseSchema, serialized);
      assert.strictEqual(deserialized.success, true);
      assert.strictEqual(deserialized.data.taskName, 'Analyze repository');
      assert.strictEqual(deserialized.meta.requestId, meta.requestId);
    });
  });
});
