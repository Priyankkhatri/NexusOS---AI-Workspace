import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { TenantStreamEventBus, InMemoryEventPublisherBoundary } from '@nexusos/backend';
import {
  TelemetryStreamEvent,
  MAX_TELEMETRY_PAYLOAD_BYTES,
  MAX_REPLAY_BUFFER_SIZE,
  MAX_STREAMS_PER_TENANT,
  TelemetryStreamEventSchema,
} from '@nexusos/contracts';

describe('Task 067 — Security Hardening: Real-Time Telemetry & Live Event Bus Invariants', () => {
  let bus: TenantStreamEventBus;
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();

  beforeEach(() => {
    bus = new TenantStreamEventBus();
  });

  // 067-SEC-01: Tenant Isolation
  describe('067-SEC-01 — Tenant Isolation Invariant', () => {
    it('prevents Tenant B subscribers from observing Tenant A real-time events', async () => {
      const tenantBEvents: TelemetryStreamEvent[] = [];
      const subB = bus.subscribe({
        tenantId: tenantB,
        listener: (event) => tenantBEvents.push(event),
      });

      // Publish in Tenant A
      await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: tenantA,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'tenant-a-agent',
          previous_status: 'IDLE',
          current_status: 'RUNNING',
        },
      });

      assert.strictEqual(tenantBEvents.length, 0);
      subB.unsubscribe();
    });

    it('prevents cross-tenant replay leakage', async () => {
      // Publish in Tenant A
      for (let i = 1; i <= 3; i++) {
        await bus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: tenantA,
          payload: { metric_name: `cpu_${i}`, metric_value: i * 10 },
        });
      }

      // Tenant B requests replay using Tenant A's sequence cursor
      const cursor = `${bus.streamEpochId}:1`;
      const tenantBReplay: TelemetryStreamEvent[] = [];
      const subB = bus.subscribe({
        tenantId: tenantB,
        cursor,
        listener: (event) => tenantBReplay.push(event),
      });

      // Tenant B has 0 events published, so cursor sequence 1 is future for Tenant B!
      assert.strictEqual(subB.replay.type, 'RESET');
      if (subB.replay.type === 'RESET') {
        assert.strictEqual(subB.replay.reason, 'FUTURE_CURSOR_DETECTED');
      }
      assert.strictEqual(tenantBReplay.length, 0);
      subB.unsubscribe();
    });
  });

  // 067-SEC-02: Workspace Scoping
  describe('067-SEC-02 — Workspace Scoping Invariant', () => {
    it('prevents Workspace 2 subscribers from observing Workspace 1 specific events', async () => {
      const ws2Events: TelemetryStreamEvent[] = [];
      const subWs2 = bus.subscribe({
        tenantId: tenantA,
        workspaceId: workspaceB,
        listener: (event) => ws2Events.push(event),
      });

      // Publish in Workspace 1
      await bus.publish({
        schema_id: 'nexusos.events.task.status_changed',
        tenant_id: tenantA,
        workspace_id: workspaceA,
        payload: {
          task_id: crypto.randomUUID(),
          title: 'Workspace 1 Task',
          previous_state: 'PENDING',
          current_state: 'RUNNING',
        },
      });

      assert.strictEqual(ws2Events.length, 0);
      subWs2.unsubscribe();
    });

    it('permits tenant-wide events (unspecified workspace) to reach workspace subscribers', async () => {
      const ws2Events: TelemetryStreamEvent[] = [];
      const subWs2 = bus.subscribe({
        tenantId: tenantA,
        workspaceId: workspaceB,
        listener: (event) => ws2Events.push(event),
      });

      // Publish tenant-wide event (no workspace_id)
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantA,
        payload: { metric_name: 'system.node_count', metric_value: 4 },
      });

      assert.strictEqual(ws2Events.length, 1);
      assert.strictEqual(ws2Events[0]?.payload.metric_name, 'system.node_count');
      subWs2.unsubscribe();
    });
  });

  // 067-SEC-03: Payload Bounds
  describe('067-SEC-03 — Payload Bounds Invariant', () => {
    it('rejects oversized event payloads exceeding 16 KB fail-closed', async () => {
      const oversizedPayload = {
        metric_name: 'bloated_metric',
        metric_value: 1,
        bloat: 'B'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES + 100),
      };

      await assert.rejects(
        async () => {
          await bus.publish({
            schema_id: 'nexusos.events.telemetry.sample',
            tenant_id: tenantA,
            payload: oversizedPayload,
          });
        },
        {
          message: new RegExp(
            `067-SEC-03: Telemetry payload size .* exceeds maximum limit of ${MAX_TELEMETRY_PAYLOAD_BYTES} bytes`,
          ),
        },
      );
    });

    it('accepts payloads within the 16 KB threshold', async () => {
      const validPayload = {
        metric_name: 'healthy_metric',
        metric_value: 42,
        data: 'A'.repeat(5 * 1024), // 5 KB
      };

      const event = await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantA,
        payload: validPayload,
      });

      assert.ok(event);
      assert.strictEqual(event.sequence_number, 1);
    });
  });

  // 067-SEC-04: Cursor Monotonicity & Fail-Safe Reset
  describe('067-SEC-04 — Cursor Monotonicity & Fail-Safe Reset Invariant', () => {
    it('guarantees sequence monotonicity within an epoch', async () => {
      let previousSeq = 0;
      for (let i = 0; i < 10; i++) {
        const event = await bus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: tenantA,
          payload: { metric_name: 'seq_test', metric_value: i },
        });

        assert.ok(event.sequence_number > previousSeq);
        assert.strictEqual(event.sequence_number, previousSeq + 1);
        previousSeq = event.sequence_number;
      }
    });

    it('triggers SERVER_EPOCH_CHANGED reset when cursor epoch does not match server process epoch', async () => {
      const priorEpoch = crypto.randomUUID();
      const cursor = `${priorEpoch}:5`;

      const sub = bus.subscribe({
        tenantId: tenantA,
        cursor,
        listener: () => {},
      });

      assert.strictEqual(sub.replay.type, 'RESET');
      if (sub.replay.type === 'RESET') {
        assert.strictEqual(sub.replay.reason, 'SERVER_EPOCH_CHANGED');
        assert.strictEqual(sub.replay.resetPayload.currentEpoch, bus.streamEpochId);
        assert.strictEqual(sub.replay.resetPayload.reason, 'SERVER_EPOCH_CHANGED');
      }
      sub.unsubscribe();
    });

    it('triggers FUTURE_CURSOR_DETECTED reset when client sequence exceeds server head', async () => {
      await bus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantA,
        payload: { metric_name: 'm1', metric_value: 1 },
      });

      const futureCursor = `${bus.streamEpochId}:9999`;
      const sub = bus.subscribe({
        tenantId: tenantA,
        cursor: futureCursor,
        listener: () => {},
      });

      assert.strictEqual(sub.replay.type, 'RESET');
      if (sub.replay.type === 'RESET') {
        assert.strictEqual(sub.replay.reason, 'FUTURE_CURSOR_DETECTED');
        assert.strictEqual(sub.replay.resetPayload.currentSequence, 1);
      }
      sub.unsubscribe();
    });

    it('triggers MALFORMED_CURSOR reset on invalid cursor formats', async () => {
      const invalidCursors = [
        '',
        'not-a-cursor',
        'epoch-only-no-sequence',
        `${bus.streamEpochId}:`,
        `${bus.streamEpochId}:abc`,
        `${bus.streamEpochId}:-1`,
        `${bus.streamEpochId}:0`,
      ];

      for (const bad of invalidCursors) {
        const sub = bus.subscribe({
          tenantId: tenantA,
          cursor: bad,
          listener: () => {},
        });

        assert.strictEqual(sub.replay.type, 'RESET');
        if (sub.replay.type === 'RESET') {
          assert.strictEqual(sub.replay.reason, 'MALFORMED_CURSOR');
        }
        sub.unsubscribe();
      }
    });
  });

  // 067-SEC-05: Replay & Activity Storage Bounds
  describe('067-SEC-05 — Replay & Activity Storage Bounds Invariant', () => {
    it('strictly bounds live replay buffer to MAX_REPLAY_BUFFER_SIZE (100 events)', async () => {
      // Publish 120 events
      for (let i = 1; i <= 120; i++) {
        await bus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: tenantA,
          payload: { metric_name: `sample_${i}`, metric_value: i },
        });
      }

      const replayEvents = bus.getReplayEvents(tenantA);
      assert.strictEqual(replayEvents.length, MAX_REPLAY_BUFFER_SIZE); // Exactly 100
      assert.strictEqual(replayEvents[0]?.sequence_number, 21); // Sequences 1..20 evicted
      assert.strictEqual(replayEvents[replayEvents.length - 1]?.sequence_number, 120);
    });

    it('triggers REPLAY_BUFFER_EXPIRED reset when requesting evicted sequence', async () => {
      // Publish 105 events (sequences 1..5 evicted)
      for (let i = 1; i <= 105; i++) {
        await bus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: tenantA,
          payload: { metric_name: `m_${i}`, metric_value: i },
        });
      }

      // Client requests from sequence 3 (which was evicted)
      const cursor = `${bus.streamEpochId}:3`;
      const sub = bus.subscribe({
        tenantId: tenantA,
        cursor,
        listener: () => {},
      });

      assert.strictEqual(sub.replay.type, 'RESET');
      if (sub.replay.type === 'RESET') {
        assert.strictEqual(sub.replay.reason, 'REPLAY_BUFFER_EXPIRED');
        assert.strictEqual(sub.replay.resetPayload.currentSequence, 105);
      }
      sub.unsubscribe();
    });

    it('strictly bounds InMemoryEventPublisherBoundary to prevent REST memory leaks', async () => {
      const publisher = new InMemoryEventPublisherBoundary({ maxEvents: 50 });

      for (let i = 1; i <= 80; i++) {
        await publisher.publish({
          schema_id: 'nexusos.events.task.created',
          version: '1.0.0',
          event_id: crypto.randomUUID(),
          correlation_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          producer_id: 'test-producer',
          payload: { task_num: i },
        });
      }

      const stored = publisher.getPublishedEvents();
      assert.strictEqual(stored.length, 50);
      assert.strictEqual(stored[0]?.payload.task_num, 31); // 1..30 evicted via FIFO
      assert.strictEqual(stored[stored.length - 1]?.payload.task_num, 80);
    });
  });

  // 067-SEC-06: Subscription Lifecycle & Zero Leaks
  describe('067-SEC-06 — Subscription Lifecycle & Resource Containment', () => {
    it('safely cleans up subscribers on unsubscribe and handles repeated calls idempotently', () => {
      assert.strictEqual(bus.getSubscriberCount(tenantA), 0);

      const sub = bus.subscribe({
        tenantId: tenantA,
        listener: () => {},
      });

      assert.strictEqual(bus.getSubscriberCount(tenantA), 1);
      assert.strictEqual(sub.isSubscribed(), true);

      // First unsubscribe removes subscriber
      const result1 = sub.unsubscribe();
      assert.strictEqual(result1, true);
      assert.strictEqual(sub.isSubscribed(), false);
      assert.strictEqual(bus.getSubscriberCount(tenantA), 0);

      // Subsequent unsubscribe calls are safe no-ops
      const result2 = sub.unsubscribe();
      assert.strictEqual(result2, false);
      assert.strictEqual(sub.isSubscribed(), false);
      assert.strictEqual(bus.getSubscriberCount(tenantA), 0);
    });

    it('ensures abandoned subscribers are pruned from internal maps', () => {
      const handles = [];
      for (let i = 0; i < 5; i++) {
        handles.push(
          bus.subscribe({
            tenantId: tenantA,
            listener: () => {},
          }),
        );
      }

      assert.strictEqual(bus.getSubscriberCount(tenantA), 5);

      for (const h of handles) {
        h.unsubscribe();
      }

      assert.strictEqual(bus.getSubscriberCount(tenantA), 0);
    });
  });

  // 067-SEC-07: No Execution Authority & Connection Limits
  describe('067-SEC-07 — No Execution Authority & Connection Limits', () => {
    it('confirms telemetry event contracts are observational only and lack execution authority', async () => {
      const event = await bus.publish({
        schema_id: 'nexusos.events.approval.decided',
        tenant_id: tenantA,
        payload: {
          decision_id: crypto.randomUUID(),
          request_id: crypto.randomUUID(),
          decision: 'APPROVED',
          decided_by: 'operator-1',
          decided_at: new Date().toISOString(),
        },
      });

      // Events contain no execution leases, cryptographic signatures, or authorization grants
      assert.strictEqual((event as Record<string, unknown>).lease_id, undefined);
      assert.strictEqual((event as Record<string, unknown>).signature, undefined);
      assert.strictEqual((event as Record<string, unknown>).authorization_token, undefined);

      // Event is validated against telemetry envelope, NOT an execution grant
      const parseResult = TelemetryStreamEventSchema.safeParse(event);
      assert.strictEqual(parseResult.success, true);
    });

    it('enforces connection limit per tenant to prevent resource exhaustion', () => {
      const unsubs = [];
      for (let i = 0; i < MAX_STREAMS_PER_TENANT; i++) {
        const sub = bus.subscribe({
          tenantId: tenantA,
          listener: () => {},
        });
        unsubs.push(() => sub.unsubscribe());
      }

      assert.throws(
        () => {
          bus.subscribe({
            tenantId: tenantA,
            listener: () => {},
          });
        },
        {
          message: new RegExp(
            `067-SEC-07: Maximum concurrent stream connections \\(${MAX_STREAMS_PER_TENANT}\\) exceeded`,
          ),
        },
      );

      // Free one connection
      unsubs[0]!();
      assert.strictEqual(bus.getSubscriberCount(tenantA), MAX_STREAMS_PER_TENANT - 1);

      // Connecting succeeds
      const newSub = bus.subscribe({
        tenantId: tenantA,
        listener: () => {},
      });
      unsubs.push(() => newSub.unsubscribe());

      // Clean up
      for (const unsub of unsubs) {
        unsub();
      }
      assert.strictEqual(bus.getSubscriberCount(tenantA), 0);
    });
  });

  // 067-SEC-08: Secret Containment
  describe('067-SEC-08 — Secret Containment & Redaction', () => {
    it('automatically redacts bearer tokens, API keys, and sensitive keys in payloads', async () => {
      const dispatchedEvents: TelemetryStreamEvent[] = [];
      const sub = bus.subscribe({
        tenantId: tenantA,
        listener: (e) => dispatchedEvents.push(e),
      });

      await bus.publish({
        schema_id: 'nexusos.events.agent.status_changed',
        tenant_id: tenantA,
        payload: {
          agent_id: crypto.randomUUID(),
          agent_name: 'sensitive-agent',
          previous_status: 'IDLE',
          current_status: 'RUNNING',
          token: 'sensitive-auth-token-12345',
          password: 'super-secret-password!',
          apiKey: 'secret-api-key-99999',
        },
      });

      assert.strictEqual(dispatchedEvents.length, 1);
      const payload = dispatchedEvents[0]?.payload as Record<string, unknown>;
      assert.strictEqual(payload.token, '[REDACTED_SENSITIVE_KEY]');
      assert.strictEqual(payload.password, '[REDACTED_SENSITIVE_KEY]');
      assert.strictEqual(payload.apiKey, '[REDACTED_SENSITIVE_KEY]');

      // Also verify stored in replay buffer is redacted
      const replayEvents = bus.getReplayEvents(tenantA);
      const replayPayload = replayEvents[0]?.payload as Record<string, unknown>;
      assert.strictEqual(replayPayload.token, '[REDACTED_SENSITIVE_KEY]');
      assert.strictEqual(replayPayload.password, '[REDACTED_SENSITIVE_KEY]');
      assert.strictEqual(replayPayload.apiKey, '[REDACTED_SENSITIVE_KEY]');

      sub.unsubscribe();
    });
  });
});
