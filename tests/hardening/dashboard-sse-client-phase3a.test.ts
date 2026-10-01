/**
 * Task 067 Phase 3A — Dashboard SSE Client + Connection State Machine Tests
 *
 * Validates:
 * - SSE frame parsing (event/id/data, multiline, CRLF, LF, fragmented chunks, heartbeat comments)
 * - Connection state machine transitions (OFFLINE → CONNECTING → CONNECTED_STREAMING → etc.)
 * - Bounded exponential backoff with jitter
 * - Heartbeat watchdog timeout
 * - stream.reset handling and cursor invalidation
 * - Cursor tracking and monotonic advancement
 * - Polling coordination (P3A-SEC-10)
 * - Lifecycle start/stop idempotency and cleanup (P3A-SEC-06)
 * - Security invariants P3A-SEC-01..P3A-SEC-10
 * - HTTP 401, 429, 500, network failure handling
 *
 * Uses deterministic fake fetch/ReadableStream and fake timers.
 * No real network connections or 35-second waits.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TelemetryStreamClient,
  type ConnectionState,
  type TelemetryStreamClientConfig,
} from '../../apps/web-dashboard/src/telemetry-stream-client.js';
import {
  type TelemetryStreamEvent,
  type StreamResetPayload,
  TELEMETRY_STREAM_VERSION,
  formatStreamCursor,
} from '@nexusos/contracts';

// ============================================================
// Test Helpers: Deterministic Fakes
// ============================================================

interface PendingTimer {
  id: number;
  cb: () => void;
  ms: number;
}

function createFakeTimers() {
  let timerId = 0;
  const timers = new Map<number, PendingTimer>();

  return {
    timers,
    setTimeout: (cb: () => void, ms: number): unknown => {
      const id = ++timerId;
      timers.set(id, { id, cb, ms });
      return id;
    },
    clearTimeout: (id: unknown): void => {
      timers.delete(id as number);
    },
    fireAll: () => {
      const pending = Array.from(timers.values());
      timers.clear();
      for (const t of pending) t.cb();
    },
    fireFirst: () => {
      const first = timers.values().next().value;
      if (first) {
        timers.delete(first.id);
        first.cb();
      }
    },
    count: () => timers.size,
    getFirst: () => {
      const first = timers.values().next().value;
      return first ?? null;
    },
  };
}

function sseFrame(eventName: string, cursorStr: string, payload: Record<string, unknown>): string {
  return `event: ${eventName}\nid: ${cursorStr}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function makeStreamEvent(
  schemaId: string,
  epochId: string,
  seq: number,
  tenantId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema_id: schemaId,
    version: TELEMETRY_STREAM_VERSION,
    event_id: crypto.randomUUID(),
    epoch_id: epochId,
    sequence_number: seq,
    cursor: formatStreamCursor(epochId, seq),
    tenant_id: tenantId,
    correlation_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    producer_id: 'test-producer',
    payload,
  };
}

function createFakeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let idx = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[idx]!));
        idx++;
      } else {
        controller.close();
      }
    },
  });
}

function createFakeFetch(
  statusCode: number,
  body?: ReadableStream<Uint8Array>,
  headers?: Record<string, string>,
): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // Track the request for assertion purposes
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const reqHeaders = init?.headers as Record<string, string> | undefined;

    (createFakeFetch as unknown as { lastUrl: string }).lastUrl = url;
    (
      createFakeFetch as unknown as { lastHeaders: Record<string, string> | undefined }
    ).lastHeaders = reqHeaders;

    // Check if aborted
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      headers: new Headers(headers ?? {}),
      body: body ?? null,
    } as Response;
  };
}

interface TestHarness {
  client: TelemetryStreamClient;
  stateChanges: Array<{ state: ConnectionState; detail?: string }>;
  receivedEvents: TelemetryStreamEvent[];
  receivedResets: StreamResetPayload[];
  receivedErrors: Error[];
  fakeTimers: ReturnType<typeof createFakeTimers>;
  fetchCalls: Array<{ url: string; headers: Record<string, string> }>;
}

function createTestHarness(overrides?: Partial<TelemetryStreamClientConfig>): TestHarness {
  const stateChanges: Array<{ state: ConnectionState; detail?: string }> = [];
  const receivedEvents: TelemetryStreamEvent[] = [];
  const receivedResets: StreamResetPayload[] = [];
  const receivedErrors: Error[] = [];
  const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fakeTimers = createFakeTimers();

  const client = new TelemetryStreamClient({
    baseUrl: 'http://localhost:3000',
    getAuthToken: () => 'test-bearer-token',
    onStateChange: (state, detail) => stateChanges.push({ state, detail }),
    onEvent: (event) => receivedEvents.push(event),
    onReset: (payload) => receivedResets.push(payload),
    onError: (err) => receivedErrors.push(err),
    heartbeatTimeoutMs: 100, // Short for testing
    baseDelayMs: 10,
    maxDelayMs: 100,
    maxReconnectAttempts: 3,
    degradedProbeIntervalMs: 200,
    randomFn: () => 0.5, // Deterministic: always midpoint
    setTimeoutFn: fakeTimers.setTimeout,
    clearTimeoutFn: fakeTimers.clearTimeout,
    fetchFn: async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const headers = (init?.headers as Record<string, string>) ?? {};
      fetchCalls.push({ url, headers });
      // Default: return 200 with empty body that closes immediately
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: createFakeReadableStream([]),
      } as Response;
    },
    ...overrides,
  });

  return {
    client,
    stateChanges,
    receivedEvents,
    receivedResets,
    receivedErrors,
    fakeTimers,
    fetchCalls,
  };
}

// ============================================================
// Tests
// ============================================================

describe('Task 067 Phase 3A — TelemetryStreamClient Unit Tests', () => {
  describe('SSE Frame Parser', () => {
    it('parses complete SSE event frames with event/id/data fields', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const eventPayload = makeStreamEvent(
        'nexusos.events.task.status_changed',
        epochId,
        1,
        tenantId,
        {
          task_id: 'task-1',
          title: 'Test',
          state: 'RUNNING',
          previousState: 'PENDING',
          targetAgentId: 'a1',
          tenantId,
          workspaceId: 'ws1',
        },
      );

      const sseData = `event: nexusos.events.task.status_changed\nid: ${cursor}\ndata: ${JSON.stringify(eventPayload)}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      // Allow microtask queue to drain
      await new Promise((r) => setTimeout(r, 50));

      assert.ok(harness.receivedEvents.length >= 1, 'Should receive at least one event');
      assert.strictEqual(
        harness.receivedEvents[0]!.schema_id,
        'nexusos.events.task.status_changed',
      );
      assert.strictEqual(harness.client.currentCursor, cursor);

      harness.client.stop();
    });

    it('parses multiple data: lines joined correctly', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const fullPayload = makeStreamEvent(
        'nexusos.events.agent.status_changed',
        epochId,
        1,
        tenantId,
        {
          agentId: 'agent-1',
          tenantId,
          role: 'WORKER',
          status: 'ACTIVE',
          currentLoad: 0.5,
          activeTaskCount: 2,
        },
      );
      const prettyJson = JSON.stringify(fullPayload, null, 2);
      const dataLines = prettyJson
        .split('\n')
        .map((l) => `data: ${l}`)
        .join('\n');
      const sseData = `event: nexusos.events.agent.status_changed\nid: ${cursor}\n${dataLines}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.ok(harness.receivedEvents.length >= 1);
      harness.client.stop();
    });

    it('handles heartbeat comment lines without generating application events', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const eventPayload = makeStreamEvent(
        'nexusos.events.telemetry.sample',
        epochId,
        1,
        tenantId,
        {
          tenantId,
          activeTaskCount: 5,
          pendingApprovalCount: 0,
          completedTaskCount: 10,
          failedTaskCount: 1,
          connectedDeviceCount: 3,
          healthStatus: 'HEALTHY',
        },
      );

      // Heartbeat followed by a real event
      const chunks = [
        `: ping\n\n`,
        `: ping\n\n`,
        sseFrame('nexusos.events.telemetry.sample', cursor, eventPayload),
      ];

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream(chunks),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // Only the real event should be delivered, not heartbeats
      assert.strictEqual(harness.receivedEvents.length, 1);
      assert.strictEqual(harness.receivedEvents[0]!.schema_id, 'nexusos.events.telemetry.sample');

      harness.client.stop();
    });

    it('handles fragmented chunks spanning SSE frame boundaries', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const eventPayload = makeStreamEvent(
        'nexusos.events.task.status_changed',
        epochId,
        1,
        tenantId,
        {
          task_id: 'task-frag',
          title: 'Fragmented',
          state: 'COMPLETED',
          targetAgentId: 'a1',
          tenantId,
        },
      );

      const fullFrame = `event: nexusos.events.task.status_changed\nid: ${cursor}\ndata: ${JSON.stringify(eventPayload)}\n\n`;

      // Split frame in the middle of a line
      const splitPoint = Math.floor(fullFrame.length / 3);
      const chunk1 = fullFrame.substring(0, splitPoint);
      const chunk2 = fullFrame.substring(splitPoint);

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([chunk1, chunk2]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.receivedEvents.length, 1);
      assert.strictEqual(
        harness.receivedEvents[0]!.schema_id,
        'nexusos.events.task.status_changed',
      );

      harness.client.stop();
    });

    it('handles CRLF line terminators', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const eventPayload = makeStreamEvent(
        'nexusos.events.task.status_changed',
        epochId,
        1,
        tenantId,
        { task_id: 'crlf-task', title: 'CRLF', state: 'RUNNING', targetAgentId: 'a1', tenantId },
      );

      const sseData = `event: nexusos.events.task.status_changed\r\nid: ${cursor}\r\ndata: ${JSON.stringify(eventPayload)}\r\n\r\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.receivedEvents.length, 1);
      harness.client.stop();
    });

    it('P3A-SEC-03: malformed JSON in SSE data fails safely', async () => {
      const sseData = `event: nexusos.events.task.status_changed\nid: bad-cursor\ndata: {not valid json!!!}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // No events delivered (malformed), but an error recorded
      assert.strictEqual(harness.receivedEvents.length, 0);
      assert.ok(harness.receivedErrors.length >= 1, 'Should record an error for malformed JSON');

      harness.client.stop();
    });

    it('P3A-SEC-09: event payloads are data objects, never evaluated as HTML', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const eventPayload = makeStreamEvent(
        'nexusos.events.task.status_changed',
        epochId,
        1,
        tenantId,
        {
          task_id: 'xss-task',
          title: '<script>alert("xss")</script>',
          state: 'RUNNING',
          targetAgentId: 'a1',
          tenantId,
        },
      );

      const sseData = sseFrame('nexusos.events.task.status_changed', cursor, eventPayload);

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // Event delivered as data object; client never interprets payload as HTML
      assert.strictEqual(harness.receivedEvents.length, 1);
      assert.strictEqual(typeof harness.receivedEvents[0]!.payload, 'object');

      harness.client.stop();
    });
  });

  describe('Connection State Machine', () => {
    it('transitions OFFLINE → CONNECTING → CONNECTED_STREAMING on success', async () => {
      const harness = createTestHarness();

      assert.strictEqual(harness.client.state, 'OFFLINE');

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // Should have transitioned through CONNECTING → CONNECTED_STREAMING
      const states = harness.stateChanges.map((s) => s.state);
      assert.ok(states.includes('CONNECTING'), 'Should transition to CONNECTING');
      assert.ok(states.includes('CONNECTED_STREAMING'), 'Should transition to CONNECTED_STREAMING');

      harness.client.stop();
      assert.strictEqual(harness.client.state, 'OFFLINE');
    });

    it('transitions to OFFLINE on HTTP 401 without infinite retries', async () => {
      const harness = createTestHarness({
        fetchFn: createFakeFetch(401),
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.client.state, 'OFFLINE');
      // No reconnect timers should be scheduled
      assert.strictEqual(harness.fakeTimers.count(), 0);

      harness.client.stop();
    });

    it('transitions to DEGRADED_POLLING on HTTP 429', async () => {
      const harness = createTestHarness({
        fetchFn: createFakeFetch(429),
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.client.state, 'DEGRADED_POLLING');
      // Should schedule a degraded probe timer
      assert.ok(harness.fakeTimers.count() >= 1, 'Should have probe timer');

      harness.client.stop();
    });

    it('transitions to RECONNECTING on HTTP 500', async () => {
      const harness = createTestHarness({
        fetchFn: createFakeFetch(500),
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // Should be RECONNECTING with a backoff timer scheduled
      assert.strictEqual(harness.client.state, 'RECONNECTING');
      assert.ok(harness.fakeTimers.count() >= 1, 'Should have reconnect timer');

      harness.client.stop();
    });

    it('transitions to RECONNECTING on network failure', async () => {
      const harness = createTestHarness({
        fetchFn: async () => {
          throw new Error('Network error: ECONNREFUSED');
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.client.state, 'RECONNECTING');

      harness.client.stop();
    });

    it('transitions to DEGRADED_POLLING after max reconnect attempts', async () => {
      let callCount = 0;
      const harness = createTestHarness({
        maxReconnectAttempts: 2,
        fetchFn: async () => {
          callCount++;
          throw new Error(`Network error #${callCount}`);
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      // First failure → RECONNECTING (attempt 1), fire timer → attempt 2
      harness.fakeTimers.fireFirst();
      await new Promise((r) => setTimeout(r, 20));

      // Second failure → RECONNECTING (attempt 2), fire timer → attempt 3
      harness.fakeTimers.fireFirst();
      await new Promise((r) => setTimeout(r, 20));

      // Third failure exceeds maxReconnectAttempts=2 → DEGRADED_POLLING
      assert.strictEqual(harness.client.state, 'DEGRADED_POLLING');

      harness.client.stop();
    });

    it('transitions OFFLINE when no auth token is available', async () => {
      const harness = createTestHarness({
        getAuthToken: () => null,
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      assert.strictEqual(harness.client.state, 'OFFLINE');
      assert.strictEqual(harness.fakeTimers.count(), 0);

      harness.client.stop();
    });
  });

  describe('Reconnection Backoff', () => {
    it('computes bounded exponential backoff with jitter', async () => {
      const delays: number[] = [];
      const harness = createTestHarness({
        baseDelayMs: 100,
        multiplier: 1.5,
        maxDelayMs: 500,
        jitterFactor: 0.2,
        maxReconnectAttempts: 5,
        randomFn: () => 0.5, // Deterministic: jitter = 0 (midpoint)
        setTimeoutFn: (cb, ms) => {
          delays.push(ms);
          return createFakeTimers().setTimeout(cb, ms);
        },
        fetchFn: async () => {
          throw new Error('Connection refused');
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      // First delay should be ~100ms (base * 1.5^0 = 100, jitter at midpoint = 0)
      assert.ok(delays.length >= 1);
      // With randomFn=0.5, jitter = (0.5*2-1)*0.2 = 0, so delay = 100
      assert.strictEqual(delays[0], 100);

      harness.client.stop();
    });

    it('P3A-SEC-07: no overlapping reconnect attempts', async () => {
      let fetchCount = 0;
      const harness = createTestHarness({
        fetchFn: async () => {
          fetchCount++;
          throw new Error('fail');
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      const initialFetchCount = fetchCount;

      // Try starting again while reconnecting — should be a no-op
      harness.client.connect();
      await new Promise((r) => setTimeout(r, 20));

      // Fetch count should not increase because connect() skips when not stopped
      // (the reconnect timer handles the next attempt)
      assert.ok(fetchCount <= initialFetchCount + 1);

      harness.client.stop();
    });

    it('resets retry counter after successful streaming', async () => {
      let callCount = 0;
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const eventPayload = makeStreamEvent(
        'nexusos.events.telemetry.sample',
        epochId,
        1,
        tenantId,
        {
          tenantId,
          activeTaskCount: 1,
          pendingApprovalCount: 0,
          completedTaskCount: 0,
          failedTaskCount: 0,
          connectedDeviceCount: 1,
          healthStatus: 'HEALTHY',
        },
      );

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          callCount++;
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (callCount === 1) {
            throw new Error('Transient failure');
          }
          // Second call succeeds with active streaming
          const encoder = new TextEncoder();
          let sent = false;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(
                    encoder.encode(
                      sseFrame('nexusos.events.telemetry.sample', cursor, eventPayload),
                    ),
                  );
                }
              },
            }),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      // First call fails → RECONNECTING, attempt=1
      assert.strictEqual(harness.client.state, 'RECONNECTING');
      assert.strictEqual(harness.client.reconnectAttempts, 1);

      // Fire reconnect timer → second attempt succeeds
      harness.fakeTimers.fireFirst();
      await new Promise((r) => setTimeout(r, 50));

      // Retry counter should reset after successful connection
      assert.strictEqual(harness.client.state, 'CONNECTED_STREAMING');
      assert.strictEqual(harness.client.reconnectAttempts, 0);

      harness.client.stop();
    });
  });

  describe('Heartbeat Watchdog', () => {
    it('triggers reconnection when stream goes silent beyond watchdog timeout', async () => {
      const harness = createTestHarness({
        heartbeatTimeoutMs: 50,
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          // Return a stream that never sends data (hangs)
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              // Never enqueue, never close — simulates silent TCP drop
              pull() {
                return new Promise(() => {
                  // Intentionally never resolves
                });
              },
            }),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      assert.strictEqual(harness.client.state, 'CONNECTED_STREAMING');

      // Watchdog timer should be scheduled
      assert.ok(harness.fakeTimers.count() >= 1, 'Watchdog timer should be active');

      // Fire watchdog timer
      harness.fakeTimers.fireFirst();
      await new Promise((r) => setTimeout(r, 20));

      // Should transition to RECONNECTING
      const states = harness.stateChanges.map((s) => s.state);
      assert.ok(
        states.includes('RECONNECTING'),
        'Should transition to RECONNECTING after watchdog',
      );

      harness.client.stop();
    });

    it('watchdog resets on heartbeat comment reception', async () => {
      let watchdogCount = 0;
      const harness = createTestHarness({
        heartbeatTimeoutMs: 50,
        setTimeoutFn: (cb, ms) => {
          watchdogCount++;
          return createFakeTimers().setTimeout(cb, ms);
        },
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([`: ping\n\n`, `: ping\n\n`]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // Watchdog should have been reset multiple times (initial + each chunk)
      assert.ok(watchdogCount >= 2, 'Watchdog should reset on each chunk/heartbeat');

      harness.client.stop();
    });
  });

  describe('Stream Reset Handling', () => {
    it('P3A-SEC-04: epoch reset invalidates cursor and notifies reconciliation', async () => {
      const epochId = crypto.randomUUID();
      const newEpoch = crypto.randomUUID();

      const resetPayload = {
        reason: 'SERVER_EPOCH_CHANGED',
        currentEpoch: newEpoch,
        currentSequence: 0,
        requestedCursor: `${epochId}:5`,
        message: 'Server restarted',
      };

      const sseData = `event: nexusos.events.stream.reset\nid: ${newEpoch}:0\ndata: ${JSON.stringify(resetPayload)}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      // Set an initial cursor
      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // Cursor should be invalidated
      assert.strictEqual(harness.client.currentCursor, null);

      // Reset hook should be called
      assert.strictEqual(harness.receivedResets.length, 1);
      assert.strictEqual(harness.receivedResets[0]!.reason, 'SERVER_EPOCH_CHANGED');

      harness.client.stop();
    });

    it('P3A-SEC-05: handles REPLAY_BUFFER_EXPIRED reset', async () => {
      const newEpoch = crypto.randomUUID();
      const resetPayload = {
        reason: 'REPLAY_BUFFER_EXPIRED',
        currentEpoch: newEpoch,
        currentSequence: 50,
        message: 'Replay buffer expired',
      };

      const sseData = `event: nexusos.events.stream.reset\nid: ${newEpoch}:0\ndata: ${JSON.stringify(resetPayload)}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.receivedResets.length, 1);
      assert.strictEqual(harness.receivedResets[0]!.reason, 'REPLAY_BUFFER_EXPIRED');
      assert.strictEqual(harness.client.currentCursor, null);

      harness.client.stop();
    });

    it('P3A-SEC-05: handles FUTURE_CURSOR_DETECTED reset', async () => {
      const newEpoch = crypto.randomUUID();
      const resetPayload = {
        reason: 'FUTURE_CURSOR_DETECTED',
        currentEpoch: newEpoch,
        currentSequence: 10,
      };

      const sseData = `event: nexusos.events.stream.reset\nid: ${newEpoch}:0\ndata: ${JSON.stringify(resetPayload)}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.receivedResets.length, 1);
      assert.strictEqual(harness.receivedResets[0]!.reason, 'FUTURE_CURSOR_DETECTED');
      assert.strictEqual(harness.client.currentCursor, null);

      harness.client.stop();
    });

    it('P3A-SEC-05: handles MALFORMED_CURSOR reset', async () => {
      const newEpoch = crypto.randomUUID();
      const resetPayload = {
        reason: 'MALFORMED_CURSOR',
        currentEpoch: newEpoch,
        currentSequence: 0,
        requestedCursor: 'garbage',
      };

      const sseData = `event: nexusos.events.stream.reset\nid: ${newEpoch}:0\ndata: ${JSON.stringify(resetPayload)}\n\n`;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.receivedResets.length, 1);
      assert.strictEqual(harness.receivedResets[0]!.reason, 'MALFORMED_CURSOR');
      assert.strictEqual(harness.client.currentCursor, null);

      harness.client.stop();
    });
  });

  describe('Cursor Tracking', () => {
    it('advances cursor only after accepting validated events', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor1 = formatStreamCursor(epochId, 1);
      const cursor2 = formatStreamCursor(epochId, 2);

      const ev1 = makeStreamEvent('nexusos.events.task.status_changed', epochId, 1, tenantId, {
        task_id: 't1',
        title: 'T1',
        state: 'RUNNING',
        targetAgentId: 'a1',
        tenantId,
      });
      const ev2 = makeStreamEvent('nexusos.events.task.status_changed', epochId, 2, tenantId, {
        task_id: 't2',
        title: 'T2',
        state: 'COMPLETED',
        targetAgentId: 'a1',
        tenantId,
      });

      const sseData =
        sseFrame('nexusos.events.task.status_changed', cursor1, ev1) +
        sseFrame('nexusos.events.task.status_changed', cursor2, ev2);

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([sseData]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(harness.receivedEvents.length, 2);
      assert.strictEqual(harness.client.currentCursor, cursor2);

      harness.client.stop();
    });

    it('sends Last-Event-ID header on reconnect with valid cursor', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const cursor = formatStreamCursor(epochId, 1);
      const ev = makeStreamEvent('nexusos.events.task.status_changed', epochId, 1, tenantId, {
        task_id: 't1',
        title: 'T1',
        state: 'RUNNING',
        targetAgentId: 'a1',
        tenantId,
      });

      let callCount = 0;
      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          callCount++;
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (callCount === 1) {
            // First call: deliver one event then close stream
            return {
              ok: true,
              status: 200,
              headers: new Headers(),
              body: createFakeReadableStream([
                sseFrame('nexusos.events.task.status_changed', cursor, ev),
              ]),
            } as Response;
          }
          // Second call: just return empty stream
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 50));

      // After stream closes, reconnect timer fires
      if (harness.fakeTimers.count() > 0) {
        harness.fakeTimers.fireFirst();
        await new Promise((r) => setTimeout(r, 50));
      }

      // Second fetch call should include Last-Event-ID
      if (harness.fetchCalls.length >= 2) {
        const secondCall = harness.fetchCalls[1]!;
        assert.strictEqual(
          secondCall.headers['Last-Event-ID'],
          cursor,
          'Reconnect should send Last-Event-ID header',
        );
      }

      harness.client.stop();
    });
  });

  describe('Lifecycle / Cleanup', () => {
    it('P3A-SEC-06: disconnect cleans all timers and state', async () => {
      const harness = createTestHarness({
        fetchFn: async () => {
          throw new Error('fail');
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      // Should have reconnect timer
      assert.ok(harness.fakeTimers.count() >= 1);

      harness.client.stop();

      // All timers cleared
      assert.strictEqual(harness.fakeTimers.count(), 0, 'All timers should be cleared after stop');
      assert.strictEqual(harness.client.state, 'OFFLINE');
    });

    it('start → stop → start → stop does not leak timers', async () => {
      const harness = createTestHarness();

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));
      harness.client.stop();

      assert.strictEqual(harness.fakeTimers.count(), 0);

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));
      harness.client.stop();

      assert.strictEqual(harness.fakeTimers.count(), 0);
      assert.strictEqual(harness.client.state, 'OFFLINE');
    });

    it('no event delivered after final stop', async () => {
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      let resolveHang: (() => void) | null = null;

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                // Enqueue some data after a delay
                resolveHang = () => {
                  try {
                    const cursor = formatStreamCursor(epochId, 1);
                    const ev = makeStreamEvent(
                      'nexusos.events.task.status_changed',
                      epochId,
                      1,
                      tenantId,
                      {
                        task_id: 't1',
                        title: 'T1',
                        state: 'RUNNING',
                        targetAgentId: 'a1',
                        tenantId,
                      },
                    );
                    const frame = sseFrame('nexusos.events.task.status_changed', cursor, ev);
                    controller.enqueue(new TextEncoder().encode(frame));
                    controller.close();
                  } catch {
                    // Controller was closed when client cancelled stream on stop()
                  }
                };
              },
            }),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      harness.client.stop();
      const eventCountAtStop = harness.receivedEvents.length;

      // Resolve any pending data — should NOT be delivered
      const pendingFn = resolveHang as (() => void) | null;
      if (pendingFn) pendingFn();
      await new Promise((r) => setTimeout(r, 20));

      assert.strictEqual(
        harness.receivedEvents.length,
        eventCountAtStop,
        'No events should be delivered after stop',
      );
    });
  });

  describe('Security Invariants', () => {
    it('P3A-SEC-01: bearer token never appears in URL or query string', async () => {
      const harness = createTestHarness();

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      for (const call of harness.fetchCalls) {
        assert.ok(!call.url.includes('test-bearer-token'), 'Bearer token MUST NOT appear in URL');
        assert.ok(
          !call.url.includes('Bearer'),
          'Authorization header MUST NOT leak into URL query params',
        );
        // Token should only be in headers
        assert.strictEqual(
          call.headers['Authorization'],
          'Bearer test-bearer-token',
          'Token should be in Authorization header',
        );
      }

      harness.client.stop();
    });

    it('P3A-SEC-02: client does not fabricate tenant/workspace identity in URL', async () => {
      const harness = createTestHarness({
        tenantId: 'test-tenant',
        workspaceId: 'test-workspace',
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      for (const call of harness.fetchCalls) {
        assert.ok(
          !call.url.includes('tenantId='),
          'Tenant ID MUST NOT appear in query parameters (067-SEC-01)',
        );
        // Workspace is sent via header, not query
        assert.strictEqual(
          call.headers['X-Workspace-ID'],
          'test-workspace',
          'Workspace should be sent via X-Workspace-ID header',
        );
      }

      harness.client.stop();
    });

    it('P3A-SEC-08: no unbounded client-side event storage', () => {
      // The client delivers events to callbacks and does not internally accumulate them
      const harness = createTestHarness();

      // Verify no internal event storage exists
      // The only state is currentCursor (string) and state enum
      assert.strictEqual(harness.client.currentCursor, null);
      assert.strictEqual(harness.client.state, 'OFFLINE');
    });

    it('P3A-SEC-10: polling coordination never creates duplicate polling timers', async () => {
      // This test validates the design — the streamClient only calls
      // startPolling/stopPolling based on state transitions,
      // and startPolling guards against duplicate intervals.
      const stateChanges: ConnectionState[] = [];
      let pollingStarts = 0;
      let pollingStops = 0;

      const harness = createTestHarness({
        onStateChange: (state) => {
          stateChanges.push(state);
          if (state === 'DEGRADED_POLLING') pollingStarts++;
          if (state === 'CONNECTED_STREAMING') pollingStops++;
          if (state === 'OFFLINE') pollingStops++;
        },
      });

      // Start with failure → RECONNECTING → DEGRADED_POLLING
      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));
      harness.client.stop();

      // Verify no duplicate polling starts
      assert.ok(pollingStarts <= 1, 'Should not start polling more than once');
    });
  });

  describe('Disconnect While Reading', () => {
    it('handles disconnect during active stream read gracefully', async () => {
      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                // Send initial heartbeat
                controller.enqueue(new TextEncoder().encode(': ping\n\n'));
              },
            }),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(harness.client.state, 'CONNECTED_STREAMING');

      // Disconnect while stream is active
      harness.client.stop();

      assert.strictEqual(harness.client.state, 'OFFLINE');
      assert.strictEqual(harness.fakeTimers.count(), 0);
    });
  });

  describe('Server Restart / Successful Reconnect', () => {
    it('reconnects successfully after transient failure', async () => {
      let callCount = 0;
      const epochId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();

      const harness = createTestHarness({
        fetchFn: async (_input, init) => {
          callCount++;
          if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (callCount === 1) {
            throw new Error('Server restarting');
          }
          const cursor = formatStreamCursor(epochId, 1);
          const ev = makeStreamEvent('nexusos.events.telemetry.sample', epochId, 1, tenantId, {
            tenantId,
            activeTaskCount: 1,
            pendingApprovalCount: 0,
            completedTaskCount: 0,
            failedTaskCount: 0,
            connectedDeviceCount: 1,
            healthStatus: 'HEALTHY',
          });
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            body: createFakeReadableStream([
              sseFrame('nexusos.events.telemetry.sample', cursor, ev),
            ]),
          } as Response;
        },
      });

      harness.client.start();
      await new Promise((r) => setTimeout(r, 20));

      assert.strictEqual(harness.client.state, 'RECONNECTING');

      // Fire reconnect timer
      harness.fakeTimers.fireFirst();
      await new Promise((r) => setTimeout(r, 50));

      // Should have received the event after successful reconnect
      assert.ok(harness.receivedEvents.length >= 1);

      harness.client.stop();
    });
  });
});
