import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { TenantStreamEventBus, StreamReplayBuffer } from '../src/events/stream-event-bus.js';
import { TelemetryStreamEvent, formatStreamCursor } from '@nexusos/contracts';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createMockEvent(overrides?: Partial<TelemetryStreamEvent>): TelemetryStreamEvent {
  const epoch = overrides?.epoch_id ?? crypto.randomUUID();
  const seq = overrides?.sequence_number ?? 1;
  return {
    schema_id: 'nexusos.events.agent.status_changed',
    version: '1.0.0',
    event_id: crypto.randomUUID(),
    tenant_id: TENANT_A,
    workspace_id: WORKSPACE_1,
    correlation_id: crypto.randomUUID(),
    producer_id: 'unit-test',
    occurred_at: new Date().toISOString(),
    epoch_id: epoch,
    sequence_number: seq,
    cursor: formatStreamCursor(epoch, seq),
    payload: {
      agent_id: crypto.randomUUID(),
      agent_name: 'test-agent',
      previous_status: 'IDLE',
      current_status: 'RUNNING',
    },
    ...overrides,
  };
}

describe('TenantStreamEventBus & StreamReplayBuffer Unit Tests', () => {
  describe('StreamReplayBuffer', () => {
    it('stores and retrieves events in insertion order', () => {
      const buffer = new StreamReplayBuffer({ maxBufferSize: 10, maxAgeMs: 60000 });
      const event1 = createMockEvent({ sequence_number: 1 });
      const event2 = createMockEvent({ sequence_number: 2 });

      buffer.push(event1);
      buffer.push(event2);

      assert.strictEqual(buffer.size, 2);
      assert.strictEqual(buffer.getOldestSequence(), 1);
      assert.strictEqual(buffer.getLatestSequence(), 2);
      assert.deepStrictEqual(buffer.getEvents(), [event1, event2]);
    });

    it('enforces FIFO eviction when capacity is exceeded', () => {
      const maxBufferSize = 3;
      const buffer = new StreamReplayBuffer({ maxBufferSize, maxAgeMs: 60000 });

      for (let i = 1; i <= 5; i++) {
        buffer.push(createMockEvent({ sequence_number: i }));
      }

      assert.strictEqual(buffer.size, 3);
      assert.strictEqual(buffer.getOldestSequence(), 3);
      assert.strictEqual(buffer.getLatestSequence(), 5);
      const sequences = buffer.getEvents().map((e) => e.sequence_number);
      assert.deepStrictEqual(sequences, [3, 4, 5]);
    });

    it('enforces TTL eviction for expired events', () => {
      const buffer = new StreamReplayBuffer({ maxBufferSize: 10, maxAgeMs: 100 });
      const oldTime = new Date(Date.now() - 500).toISOString();
      const newTime = new Date().toISOString();

      const oldEvent = createMockEvent({ sequence_number: 1, occurred_at: oldTime });
      const newEvent = createMockEvent({ sequence_number: 2, occurred_at: newTime });

      buffer.push(oldEvent);
      buffer.push(newEvent);

      // Trigger prune
      buffer.prune();

      assert.strictEqual(buffer.size, 1);
      assert.strictEqual(buffer.getOldestSequence(), 2);
      assert.strictEqual(buffer.getEvents()[0]?.sequence_number, 2);
    });

    it('replays events since given sequence correctly', () => {
      const buffer = new StreamReplayBuffer({ maxBufferSize: 10, maxAgeMs: 60000 });
      for (let i = 1; i <= 5; i++) {
        buffer.push(createMockEvent({ sequence_number: i }));
      }

      const replayed = buffer.getEventsSince(2);
      assert.strictEqual(replayed.length, 3);
      assert.deepStrictEqual(
        replayed.map((e) => e.sequence_number),
        [3, 4, 5],
      );
    });

    it('returns empty array when replaying from latest sequence', () => {
      const buffer = new StreamReplayBuffer({ maxBufferSize: 10, maxAgeMs: 60000 });
      buffer.push(createMockEvent({ sequence_number: 1 }));
      buffer.push(createMockEvent({ sequence_number: 2 }));

      const replayed = buffer.getEventsSince(2);
      assert.strictEqual(replayed.length, 0);
    });
  });

  describe('TenantStreamEventBus — Lifecycle, Epoch & Cursor', () => {
    it('creates a distinct stream epoch per bus instance', () => {
      const bus1 = new TenantStreamEventBus();
      const bus2 = new TenantStreamEventBus();

      assert.ok(bus1.streamEpochId);
      assert.ok(bus2.streamEpochId);
      assert.notStrictEqual(bus1.streamEpochId, bus2.streamEpochId);
      // Valid UUID
      assert.match(
        bus1.streamEpochId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('assigns monotonically increasing sequences per tenant starting at 1', async () => {
      const bus = new TenantStreamEventBus();

      const e1 = await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: TENANT_A,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'test-agent',
          previous_status: 'IDLE',
          current_status: 'RUNNING',
        },
      });

      const e2 = await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: TENANT_A,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'test-agent',
          previous_status: 'RUNNING',
          current_status: 'COMPLETED',
        },
      });

      assert.strictEqual(e1.sequence_number, 1);
      assert.strictEqual(e2.sequence_number, 2);
      assert.strictEqual(e1.cursor, `${bus.streamEpochId}:1`);
      assert.strictEqual(e2.cursor, `${bus.streamEpochId}:2`);
      assert.strictEqual(bus.getLatestSequence(TENANT_A), 2);
    });

    it('tracks sequences independently across different tenants', async () => {
      const bus = new TenantStreamEventBus();

      const eA1 = await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'cpu_usage', metric_value: 42 },
      });

      const eB1 = await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_B,
        payload: { metric_name: 'memory_usage', metric_value: 512 },
      });

      const eA2 = await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'cpu_usage', metric_value: 45 },
      });

      assert.strictEqual(eA1.sequence_number, 1);
      assert.strictEqual(eB1.sequence_number, 1);
      assert.strictEqual(eA2.sequence_number, 2);
      assert.strictEqual(bus.getLatestSequence(TENANT_A), 2);
      assert.strictEqual(bus.getLatestSequence(TENANT_B), 1);
    });
  });

  describe('TenantStreamEventBus — Publish & Subscribe', () => {
    it('delivers published events to active subscribers in real time', async () => {
      const bus = new TenantStreamEventBus();
      const received: TelemetryStreamEvent[] = [];

      const sub = bus.subscribe({
        tenantId: TENANT_A,
        listener: (event) => {
          received.push(event);
        },
      });

      assert.strictEqual(sub.replay.type, 'NONE');

      const published = await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'latency', metric_value: 120 },
      });

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0]?.event_id, published.event_id);

      sub.unsubscribe();
    });

    it('stops receiving events after unsubscribe and safe to unsubscribe multiple times', async () => {
      const bus = new TenantStreamEventBus();
      const received: TelemetryStreamEvent[] = [];

      const sub = bus.subscribe({
        tenantId: TENANT_A,
        listener: (event) => {
          received.push(event);
        },
      });

      assert.strictEqual(bus.getSubscriberCount(TENANT_A), 1);

      // Unsubscribe
      const unsub1 = sub.unsubscribe();
      assert.strictEqual(unsub1, true);
      assert.strictEqual(bus.getSubscriberCount(TENANT_A), 0);

      // Second unsubscribe is safe no-op returning false
      const unsub2 = sub.unsubscribe();
      assert.strictEqual(unsub2, false);

      // Publish event after unsubscribe
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'latency', metric_value: 120 },
      });

      assert.strictEqual(received.length, 0);
    });

    it('enforces connection limit per tenant', () => {
      const bus = new TenantStreamEventBus({ maxStreamsPerTenant: 3 });
      const unsubs: (() => boolean)[] = [];

      for (let i = 0; i < 3; i++) {
        const sub = bus.subscribe({
          tenantId: TENANT_A,
          listener: () => {},
        });
        unsubs.push(() => sub.unsubscribe());
      }

      assert.throws(
        () => {
          bus.subscribe({
            tenantId: TENANT_A,
            listener: () => {},
          });
        },
        {
          message: /Maximum concurrent stream connections \(3\) exceeded for tenant/,
        },
      );

      // Clean up one subscriber
      unsubs[0]!();
      assert.strictEqual(bus.getSubscriberCount(TENANT_A), 2);

      // Now subscription succeeds
      const newSub = bus.subscribe({
        tenantId: TENANT_A,
        listener: () => {},
      });
      unsubs.push(() => newSub.unsubscribe());

      // Clean up all
      for (const unsub of unsubs) {
        unsub();
      }
      assert.strictEqual(bus.getSubscriberCount(TENANT_A), 0);
    });
  });

  describe('TenantStreamEventBus — Workspace Filtering', () => {
    it('filters events by workspace_id for workspace-scoped subscribers', async () => {
      const bus = new TenantStreamEventBus();
      const ws1Events: TelemetryStreamEvent[] = [];
      const ws2Events: TelemetryStreamEvent[] = [];
      const tenantEvents: TelemetryStreamEvent[] = [];

      const subWs1 = bus.subscribe({
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_1,
        listener: (e) => ws1Events.push(e),
      });

      const subWs2 = bus.subscribe({
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_2,
        listener: (e) => ws2Events.push(e),
      });

      const subTenant = bus.subscribe({
        tenantId: TENANT_A,
        listener: (e) => tenantEvents.push(e),
      });

      // Publish to WS 1
      await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: TENANT_A,
        workspace_id: WORKSPACE_1,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'ws1-agent',
          previous_status: 'IDLE',
          current_status: 'RUNNING',
        },
      });

      // Publish to WS 2
      await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: TENANT_A,
        workspace_id: WORKSPACE_2,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'ws2-agent',
          previous_status: 'IDLE',
          current_status: 'RUNNING',
        },
      });

      // Publish tenant-wide (no workspace)
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'system_health', metric_value: 100 },
      });

      assert.strictEqual(ws1Events.length, 2); // WS1 event + tenant-wide event
      assert.strictEqual(ws2Events.length, 2); // WS2 event + tenant-wide event
      assert.strictEqual(tenantEvents.length, 3); // All 3 events

      subWs1.unsubscribe();
      subWs2.unsubscribe();
      subTenant.unsubscribe();
    });
  });

  describe('TenantStreamEventBus — Replay Decisions (Scenarios 1-6)', () => {
    it('Scenario 1: No cursor subscribes from live position with no replay', async () => {
      const bus = new TenantStreamEventBus();
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'm1', metric_value: 1 },
      });

      const sub = bus.subscribe({
        tenantId: TENANT_A,
        listener: () => {},
      });

      assert.strictEqual(sub.replay.type, 'NONE');
      assert.strictEqual(sub.replay.events.length, 0);
      sub.unsubscribe();
    });

    it('Scenario 2: Valid cursor within window replays events sequentially', async () => {
      const bus = new TenantStreamEventBus();
      for (let i = 1; i <= 5; i++) {
        await bus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: TENANT_A,
          payload: { metric_name: `m${i}`, metric_value: i },
        });
      }

      const cursor = `${bus.streamEpochId}:2`;
      const replayed: TelemetryStreamEvent[] = [];
      const sub = bus.subscribe({
        tenantId: TENANT_A,
        cursor,
        listener: (e) => replayed.push(e),
      });

      assert.strictEqual(sub.replay.type, 'REPLAY');
      assert.strictEqual(sub.replay.events.length, 3);
      assert.deepStrictEqual(
        sub.replay.events.map((e) => e.sequence_number),
        [3, 4, 5],
      );
      assert.deepStrictEqual(
        replayed.map((e) => e.sequence_number),
        [3, 4, 5],
      );
      sub.unsubscribe();
    });

    it('Scenario 3: Cursor older than retained buffer returns REPLAY_BUFFER_EXPIRED', async () => {
      const bus = new TenantStreamEventBus({ maxReplayBufferCapacity: 3 });
      for (let i = 1; i <= 5; i++) {
        await bus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: TENANT_A,
          payload: { metric_name: `m${i}`, metric_value: i },
        });
      }

      // Buffer now contains sequences 3, 4, 5. Oldest sequence is 3.
      // Requesting sequence 1 is older than retained buffer.
      const cursor = `${bus.streamEpochId}:1`;
      let resetPayload: unknown = null;
      const sub = bus.subscribe({
        tenantId: TENANT_A,
        cursor,
        listener: () => {},
        onReset: (p) => {
          resetPayload = p;
        },
      });

      assert.strictEqual(sub.replay.type, 'RESET');
      if (sub.replay.type === 'RESET') {
        assert.strictEqual(sub.replay.reason, 'REPLAY_BUFFER_EXPIRED');
        assert.strictEqual(sub.replay.resetPayload.reason, 'REPLAY_BUFFER_EXPIRED');
        assert.strictEqual(sub.replay.resetPayload.currentEpoch, bus.streamEpochId);
      }
      assert.ok(resetPayload);
      sub.unsubscribe();
    });

    it('Scenario 4: Future cursor greater than latest returns FUTURE_CURSOR_DETECTED', async () => {
      const bus = new TenantStreamEventBus();
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'm1', metric_value: 1 },
      });

      const cursor = `${bus.streamEpochId}:999`;
      const sub = bus.subscribe({
        tenantId: TENANT_A,
        cursor,
        listener: () => {},
      });

      assert.strictEqual(sub.replay.type, 'RESET');
      if (sub.replay.type === 'RESET') {
        assert.strictEqual(sub.replay.reason, 'FUTURE_CURSOR_DETECTED');
        assert.strictEqual(sub.replay.resetPayload.reason, 'FUTURE_CURSOR_DETECTED');
      }
      sub.unsubscribe();
    });

    it('Scenario 5: Different epoch cursor returns SERVER_EPOCH_CHANGED and NEVER replays', async () => {
      const bus = new TenantStreamEventBus();
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: TENANT_A,
        payload: { metric_name: 'm1', metric_value: 1 },
      });

      const priorEpoch = crypto.randomUUID();
      const cursor = `${priorEpoch}:1`;
      const sub = bus.subscribe({
        tenantId: TENANT_A,
        cursor,
        listener: () => {},
      });

      assert.strictEqual(sub.replay.type, 'RESET');
      if (sub.replay.type === 'RESET') {
        assert.strictEqual(sub.replay.reason, 'SERVER_EPOCH_CHANGED');
        assert.strictEqual(sub.replay.resetPayload.reason, 'SERVER_EPOCH_CHANGED');
        assert.strictEqual(sub.replay.resetPayload.currentEpoch, bus.streamEpochId);
      }
      sub.unsubscribe();
    });

    it('Scenario 6: Malformed cursor returns MALFORMED_CURSOR', async () => {
      const bus = new TenantStreamEventBus();
      const malformedCursors = [
        'invalid-cursor',
        '12345',
        `${bus.streamEpochId}:not-a-number`,
        `${bus.streamEpochId}:-5`,
        `${bus.streamEpochId}:0`,
        'not-a-uuid:1',
      ];

      for (const badCursor of malformedCursors) {
        const sub = bus.subscribe({
          tenantId: TENANT_A,
          cursor: badCursor,
          listener: () => {},
        });

        assert.strictEqual(sub.replay.type, 'RESET');
        if (sub.replay.type === 'RESET') {
          assert.strictEqual(sub.replay.reason, 'MALFORMED_CURSOR');
          assert.strictEqual(sub.replay.resetPayload.reason, 'MALFORMED_CURSOR');
        }
        sub.unsubscribe();
      }
    });
  });

  describe('TenantStreamEventBus — Secret Redaction & Bounds', () => {
    it('redacts sensitive fields in event payload automatically', async () => {
      const bus = new TenantStreamEventBus();
      const published = await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: TENANT_A,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'agent-secret',
          previous_status: 'IDLE',
          current_status: 'RUNNING',
          token: 'super-secret-jwt-token',
          apiKey: 'api-secret-key-12345',
        },
      });

      assert.strictEqual(
        (published.payload as Record<string, unknown>).token,
        '[REDACTED_SENSITIVE_KEY]',
      );
      assert.strictEqual(
        (published.payload as Record<string, unknown>).apiKey,
        '[REDACTED_SENSITIVE_KEY]',
      );
    });

    it('rejects oversized payloads exceeding max size', async () => {
      const bus = new TenantStreamEventBus();
      const hugeString = 'x'.repeat(20 * 1024); // 20 KB

      await assert.rejects(
        async () => {
          await bus.publish({
            schema_id: 'nexusos.events.telemetry.sample',
            tenant_id: TENANT_A,
            payload: {
              metric_name: 'huge_metric',
              metric_value: 1,
              bloat: hugeString,
            },
          });
        },
        {
          message: /067-SEC-03: Telemetry payload size/,
        },
      );
    });
  });
});
