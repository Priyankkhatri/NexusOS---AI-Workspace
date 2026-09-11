import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStreamCursor,
  formatStreamCursor,
  isValidStreamCursor,
  createTelemetryStreamEvent,
  TelemetryStreamEventSchema,
  AgentStatusChangedPayloadSchema,
  DelegationCreatedPayloadSchema,
  DelegationProgressPayloadSchema,
  DelegationCompletedPayloadSchema,
  DelegationFailedPayloadSchema,
  DelegationCancelledPayloadSchema,
  TaskStatusChangedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  ApprovalDecidedPayloadSchema,
  GraphEvolvedPayloadSchema,
  TelemetrySamplePayloadSchema,
  StreamResetPayloadSchema,
  MAX_TELEMETRY_PAYLOAD_BYTES,
} from '../src/events/index.js';

describe('Task 067 Phase 1A/1B: Telemetry Stream Contracts & Cursor', () => {
  const sampleEpoch = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
  const sampleTenant = '11111111-2222-4333-8444-555555555555';
  const sampleTask = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const sampleParentTask = '22222222-3333-4444-8555-666666666666';
  const sampleChildTask = '33333333-4444-4555-8666-777777777777';
  const sampleDelegation = '44444444-5555-4666-8777-888888888888';
  const samplePrompt = '55555555-6666-4777-8888-999999999999';
  const sampleCorrelation = '66666666-7777-4888-8999-000000000000';

  describe('Stream Cursor Formatting & Parsing', () => {
    it('formats a valid stream cursor', () => {
      const cursor = formatStreamCursor(sampleEpoch, 42);
      assert.equal(cursor, `${sampleEpoch}:42`);
    });

    it('rejects invalid epoch in formatStreamCursor', () => {
      assert.throws(() => formatStreamCursor('not-a-uuid', 1), /must be a valid UUID/);
    });

    it('rejects invalid sequenceNumber in formatStreamCursor', () => {
      assert.throws(() => formatStreamCursor(sampleEpoch, 0), /positive safe integer/);
      assert.throws(() => formatStreamCursor(sampleEpoch, -5), /positive safe integer/);
      assert.throws(() => formatStreamCursor(sampleEpoch, 1.5), /positive safe integer/);
      assert.throws(() => formatStreamCursor(sampleEpoch, NaN), /positive safe integer/);
    });

    it('validates and parses valid stream cursors', () => {
      const valid1 = `${sampleEpoch}:1`;
      const valid2 = `${sampleEpoch}:999999`;

      assert.equal(isValidStreamCursor(valid1), true);
      assert.equal(isValidStreamCursor(valid2), true);

      const parsed1 = parseStreamCursor(valid1);
      assert.deepEqual(parsed1, { epochId: sampleEpoch, sequenceNumber: 1 });

      const parsed2 = parseStreamCursor(valid2);
      assert.deepEqual(parsed2, { epochId: sampleEpoch, sequenceNumber: 999999 });
    });

    it('rejects malformed stream cursors', () => {
      const invalidCursors = [
        '',
        'null',
        'undefined',
        123,
        null,
        undefined,
        `${sampleEpoch}:0`, // non-positive sequence
        `${sampleEpoch}:-1`, // negative sequence
        `${sampleEpoch}:1.5`, // non-integer
        `${sampleEpoch}:abc`, // NaN
        `${sampleEpoch}:`, // missing sequence
        `:42`, // missing epoch
        'invalid-epoch:42', // not a uuid
        `${sampleEpoch}:01`, // leading zero not permitted
        ` ${sampleEpoch}:42 `, // leading/trailing spaces
        `${sampleEpoch}:42:extra`, // extra segment
      ];

      for (const invalid of invalidCursors) {
        assert.equal(isValidStreamCursor(invalid), false, `Expected invalid: ${invalid}`);
        assert.equal(parseStreamCursor(invalid), null, `Expected parse to return null: ${invalid}`);
      }
    });
  });

  describe('Telemetry Event Payload Schemas', () => {
    it('validates AgentStatusChangedPayload', () => {
      const payload = {
        agentId: 'agent-worker-01',
        tenantId: sampleTenant,
        role: 'WORKER',
        status: 'AVAILABLE',
        currentLoad: 0.25,
        activeTaskCount: 1,
      };
      const result = AgentStatusChangedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates DelegationCreatedPayload', () => {
      const payload = {
        delegationId: sampleDelegation,
        parentTaskId: sampleParentTask,
        childTaskId: sampleChildTask,
        delegatorAgentId: 'agent-coordinator',
        assignedAgentId: 'agent-specialist',
        depth: 1,
        requestedScopes: ['fs:read'],
      };
      const result = DelegationCreatedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates DelegationProgressPayload', () => {
      const payload = {
        delegationId: sampleDelegation,
        parentTaskId: sampleParentTask,
        childTaskId: sampleChildTask,
        status: 'EXECUTING',
        progressPercent: 65,
        message: 'Processing batch 2 of 3',
      };
      const result = DelegationProgressPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates DelegationCompletedPayload', () => {
      const payload = {
        delegationId: sampleDelegation,
        parentTaskId: sampleParentTask,
        childTaskId: sampleChildTask,
        status: 'COMPLETED',
        receiptHash: 'sha256:abc123',
        durationMs: 1450,
      };
      const result = DelegationCompletedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates DelegationFailedPayload', () => {
      const payload = {
        delegationId: sampleDelegation,
        parentTaskId: sampleParentTask,
        childTaskId: sampleChildTask,
        status: 'FAILED',
        rejectionReason: 'Child agent timed out after 60s',
        errorCode: 'DELEGATION_TIMEOUT',
      };
      const result = DelegationFailedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates DelegationCancelledPayload', () => {
      const payload = {
        delegationId: sampleDelegation,
        parentTaskId: sampleParentTask,
        status: 'CANCELLED',
        reason: 'Parent task was revoked by operator',
      };
      const result = DelegationCancelledPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates TaskStatusChangedPayload', () => {
      const payload = {
        taskId: sampleTask,
        tenantId: sampleTenant,
        title: 'Analyze Repository Security',
        state: 'EXECUTING',
        previousState: 'SUBMITTED',
        targetAgentId: 'agent-security-auditor',
      };
      const result = TaskStatusChangedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates ApprovalRequestedPayload', () => {
      const payload = {
        promptId: samplePrompt,
        requestId: '12345678-1234-4234-8234-123456789abc',
        taskId: sampleTask,
        tenantId: sampleTenant,
        title: 'Approve Outbound Network Request',
        riskTier: 'HIGH',
        actionIdentifier: 'net:outbound:request',
        expiresAt: Date.now() + 60000,
      };
      const result = ApprovalRequestedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates ApprovalDecidedPayload', () => {
      const payload = {
        promptId: samplePrompt,
        taskId: sampleTask,
        decision: 'ALLOW',
        state: 'APPROVED',
        receiptHash: 'sha256:dec123',
        decidedBy: 'user:operator-alice',
      };
      const result = ApprovalDecidedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates GraphEvolvedPayload', () => {
      const payload = {
        deliveryId: 'del-evolve-01',
        recordId: 'rec-mem-01',
        tenantId: sampleTenant,
        workspaceId: 'ws-main',
        nodeCount: 3,
        edgeCount: 2,
        operationType: 'MERGE',
      };
      const result = GraphEvolvedPayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates TelemetrySamplePayload', () => {
      const payload = {
        tenantId: sampleTenant,
        activeTaskCount: 2,
        pendingApprovalCount: 1,
        completedTaskCount: 15,
        failedTaskCount: 0,
        connectedDeviceCount: 1,
        vramAlert: false,
        healthStatus: 'HEALTHY',
      };
      const result = TelemetrySamplePayloadSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('validates StreamResetPayload with all defined reset reasons', () => {
      const reasons = [
        'SERVER_EPOCH_CHANGED',
        'REPLAY_BUFFER_EXPIRED',
        'FUTURE_CURSOR_DETECTED',
        'MALFORMED_CURSOR',
      ] as const;

      for (const reason of reasons) {
        const payload = {
          reason,
          currentEpoch: sampleEpoch,
          currentSequence: 100,
          requestedCursor: `${sampleEpoch}:50`,
          message: 'Reset triggered',
        };
        const result = StreamResetPayloadSchema.safeParse(payload);
        assert.equal(result.success, true);
      }
    });
  });

  describe('TelemetryStreamEvent Envelope Construction & Size Bounds (067-SEC-03)', () => {
    it('creates a validated TelemetryStreamEvent', () => {
      const event = createTelemetryStreamEvent({
        schema_id: 'nexusos.events.task.status_changed',
        epoch_id: sampleEpoch,
        sequence_number: 1,
        tenant_id: sampleTenant,
        workspace_id: 'ws-default',
        correlation_id: sampleCorrelation,
        producer_id: 'task-controller',
        payload: {
          taskId: sampleTask,
          tenantId: sampleTenant,
          title: 'Compile Monorepo',
          state: 'EXECUTING',
          targetAgentId: 'agent-build',
        },
      });

      assert.equal(event.schema_id, 'nexusos.events.task.status_changed');
      assert.equal(event.version, '1.0.0');
      assert.equal(event.epoch_id, sampleEpoch);
      assert.equal(event.sequence_number, 1);
      assert.equal(event.cursor, `${sampleEpoch}:1`);
      assert.equal(event.tenant_id, sampleTenant);
      assert.equal(event.workspace_id, 'ws-default');
      assert.equal(event.correlation_id, sampleCorrelation);
    });

    it('rejects oversized payload exceeding MAX_TELEMETRY_PAYLOAD_BYTES (067-SEC-03)', () => {
      const oversizedData = 'x'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES + 100);
      const invalidEvent = {
        schema_id: 'nexusos.events.task.status_changed',
        version: '1.0.0',
        event_id: 'b1c2d3e4-f5a6-4b1c-8d2e-3f4a5b6c7d8e',
        epoch_id: sampleEpoch,
        sequence_number: 2,
        cursor: `${sampleEpoch}:2`,
        tenant_id: sampleTenant,
        correlation_id: sampleCorrelation,
        occurred_at: new Date().toISOString(),
        producer_id: 'task-controller',
        payload: { largeData: oversizedData },
      };

      const result = TelemetryStreamEventSchema.safeParse(invalidEvent);
      assert.equal(result.success, false);
      assert.match(result.error.issues[0].message, /exceeds maximum allowed size of 16384 bytes/);
    });

    it('rejects event with mismatch between sequence number and cursor', () => {
      const mismatchedEvent = {
        schema_id: 'nexusos.events.task.status_changed',
        version: '1.0.0',
        event_id: 'b1c2d3e4-f5a6-4b1c-8d2e-3f4a5b6c7d8e',
        epoch_id: sampleEpoch,
        sequence_number: 5,
        cursor: `${sampleEpoch}:10`, // cursor sequence (10) !== sequence_number (5)
        tenant_id: sampleTenant,
        correlation_id: sampleCorrelation,
        occurred_at: new Date().toISOString(),
        producer_id: 'task-controller',
        payload: { ok: true },
      };

      const result = TelemetryStreamEventSchema.safeParse(mismatchedEvent);
      assert.equal(result.success, false);
      assert.match(result.error.issues[0].message, /cursor must strictly match/);
    });
  });
});
