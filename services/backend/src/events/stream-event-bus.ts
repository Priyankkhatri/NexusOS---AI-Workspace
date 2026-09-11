import crypto from 'node:crypto';
import {
  type TelemetryStreamEvent,
  type TelemetryEventCategory,
  type StreamResetReason,
  type StreamResetPayload,
  createTelemetryStreamEvent,
  parseStreamCursor,
  isValidStreamCursor,
  MAX_TELEMETRY_PAYLOAD_BYTES,
  MAX_REPLAY_BUFFER_SIZE,
  MAX_REPLAY_BUFFER_AGE_MS,
  MAX_STREAMS_PER_TENANT,
} from '@nexusos/contracts';
import { RedactionFilter } from '../security/redaction-filter.js';

export { MAX_REPLAY_BUFFER_SIZE, MAX_REPLAY_BUFFER_AGE_MS, MAX_STREAMS_PER_TENANT };

/**
 * Result of evaluating a client-supplied stream cursor against the replay buffer
 */
export type ReplayEvaluationResult =
  | { type: 'NONE'; events: TelemetryStreamEvent[] }
  | { type: 'REPLAY'; events: TelemetryStreamEvent[] }
  | {
      type: 'RESET';
      reason: StreamResetReason;
      resetPayload: StreamResetPayload;
    };

/**
 * Dedicated In-Memory Bounded Ring Buffer per Tenant (067-SEC-05)
 * - Strict capacity cap (max 100 events)
 * - Strict age TTL (max 5 minutes / 300,000 ms)
 * - Zero background timers (prunes on access/push)
 */
export class StreamReplayBuffer {
  private readonly events: TelemetryStreamEvent[] = [];
  private readonly maxBufferSize: number;
  private readonly maxAgeMs: number;

  constructor(options: { maxBufferSize?: number; maxAgeMs?: number } = {}) {
    this.maxBufferSize = options.maxBufferSize ?? MAX_REPLAY_BUFFER_SIZE;
    this.maxAgeMs = options.maxAgeMs ?? MAX_REPLAY_BUFFER_AGE_MS;
  }

  /**
   * Pushes an event into the replay buffer with automatic TTL and capacity eviction
   */
  public push(event: TelemetryStreamEvent, now: number = Date.now()): void {
    this.prune(now);

    while (this.events.length >= this.maxBufferSize) {
      this.events.shift();
    }

    this.events.push(event);
  }

  /**
   * Prunes events older than maxAgeMs based on occurred_at timestamp
   */
  public prune(now: number = Date.now()): void {
    const cutoff = now - this.maxAgeMs;
    while (this.events.length > 0) {
      const eventTime = new Date(this.events[0].occurred_at).getTime();
      if (eventTime < cutoff) {
        this.events.shift();
      } else {
        break;
      }
    }
  }

  /**
   * Returns all unexpired events currently in the buffer
   */
  public getEvents(now: number = Date.now()): TelemetryStreamEvent[] {
    this.prune(now);
    return [...this.events];
  }

  /**
   * Returns unexpired events strictly newer than sequenceNumber in FIFO order
   */
  public getEventsSince(sequenceNumber: number, now: number = Date.now()): TelemetryStreamEvent[] {
    this.prune(now);
    return this.events.filter((e) => e.sequence_number > sequenceNumber);
  }

  /**
   * Returns sequence number of oldest retained event, or null if empty
   */
  public getOldestSequence(now: number = Date.now()): number | null {
    this.prune(now);
    if (this.events.length === 0) return null;
    return this.events[0].sequence_number;
  }

  /**
   * Returns sequence number of newest retained event, or null if empty
   */
  public getLatestSequence(now: number = Date.now()): number | null {
    this.prune(now);
    if (this.events.length === 0) return null;
    return this.events[this.events.length - 1].sequence_number;
  }

  /**
   * Returns current count of unexpired events
   */
  public get size(): number {
    return this.events.length;
  }

  /**
   * Returns current count of unexpired events
   */
  public getCount(now: number = Date.now()): number {
    this.prune(now);
    return this.events.length;
  }

  public clear(): void {
    this.events.length = 0;
  }
}

/**
 * Subscription parameters
 */
export interface StreamSubscriptionOptions {
  tenantId: string;
  workspaceId?: string;
  cursor?: string;
  listener: (event: TelemetryStreamEvent) => void;
  onReset?: (resetPayload: StreamResetPayload) => void;
}

/**
 * Handle returned to caller to control subscription lifecycle
 */
export interface StreamSubscriptionHandle {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly replay: ReplayEvaluationResult;
  unsubscribe(): boolean;
  isSubscribed(): boolean;
}

interface InternalSubscriber {
  id: string;
  tenantId: string;
  workspaceId?: string;
  listener: (event: TelemetryStreamEvent) => void;
  onReset?: (resetPayload: StreamResetPayload) => void;
}

/**
 * Input for publishing an event through the TenantStreamEventBus
 */
export interface PublishTelemetryInput<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  schema_id: TelemetryEventCategory;
  tenant_id: string;
  workspace_id?: string;
  correlation_id?: string;
  producer_id?: string;
  payload: T;
  event_id?: string;
  occurred_at?: string;
  skipRedaction?: boolean;
}

/**
 * Tenant-Scoped Live Event Bus (067-SEC-01..08)
 * - In-process pub/sub without external broker dependencies
 * - Process-lifetime epoch identity (<streamEpochId>:<sequenceNumber>)
 * - Monotonic per-tenant sequence assignment at publish time
 * - Strict tenant and workspace isolation
 * - Bounded replay ring buffer (max 100 events / 5 minutes)
 * - Zero timer leaks / zero subscriber leaks
 */
export class TenantStreamEventBus {
  /**
   * Epoch ID generated once per backend process lifetime (Discovery Section 12.2)
   */
  public readonly streamEpochId: string;

  private readonly tenantSequences = new Map<string, number>();
  private readonly replayBuffers = new Map<string, StreamReplayBuffer>();
  private readonly subscribers = new Map<string, Set<InternalSubscriber>>();
  private readonly maxReplayBufferCapacity: number;
  private readonly maxReplayAgeMs: number;
  private readonly maxStreamsPerTenant: number;

  constructor(
    options: {
      streamEpochId?: string;
      maxReplayBufferCapacity?: number;
      maxReplayAgeMs?: number;
      maxStreamsPerTenant?: number;
    } = {},
  ) {
    this.streamEpochId = options.streamEpochId ?? crypto.randomUUID();
    this.maxReplayBufferCapacity = options.maxReplayBufferCapacity ?? MAX_REPLAY_BUFFER_SIZE;
    this.maxReplayAgeMs = options.maxReplayAgeMs ?? MAX_REPLAY_BUFFER_AGE_MS;
    this.maxStreamsPerTenant = options.maxStreamsPerTenant ?? MAX_STREAMS_PER_TENANT;
  }

  /**
   * Returns current latest sequence number for a tenant (0 if none published yet)
   */
  public getLatestSequence(tenantId: string): number {
    return this.tenantSequences.get(tenantId) ?? 0;
  }

  /**
   * Gets or creates replay buffer for a tenant
   */
  private getOrCreateReplayBuffer(tenantId: string): StreamReplayBuffer {
    let buffer = this.replayBuffers.get(tenantId);
    if (!buffer) {
      buffer = new StreamReplayBuffer({
        maxBufferSize: this.maxReplayBufferCapacity,
        maxAgeMs: this.maxReplayAgeMs,
      });
      this.replayBuffers.set(tenantId, buffer);
    }
    return buffer;
  }

  /**
   * Sanitizes payload fields to prevent credential or secret leakage (067-SEC-08)
   */
  private sanitizePayload<T extends Record<string, unknown>>(payload: T): T {
    try {
      const jsonStr = JSON.stringify(payload);
      const redactedStr = RedactionFilter.redactSecrets(jsonStr);
      if (redactedStr !== jsonStr) {
        return JSON.parse(redactedStr) as T;
      }
      return payload;
    } catch {
      return payload;
    }
  }

  /**
   * Publishes an event to the tenant-scoped event bus (067-SEC-01, 067-SEC-04)
   */
  public async publish<T extends Record<string, unknown>>(
    input: PublishTelemetryInput<T>,
  ): Promise<TelemetryStreamEvent<T>> {
    // 067-SEC-03: Validate payload size bounds fail-closed before processing
    const payloadBytes = Buffer.byteLength(JSON.stringify(input.payload), 'utf-8');
    if (payloadBytes > MAX_TELEMETRY_PAYLOAD_BYTES) {
      throw new Error(
        `067-SEC-03: Telemetry payload size (${payloadBytes} bytes) exceeds maximum limit of ${MAX_TELEMETRY_PAYLOAD_BYTES} bytes.`,
      );
    }

    // 067-SEC-08: Secret containment pass
    const sanitizedPayload = input.skipRedaction
      ? input.payload
      : this.sanitizePayload(input.payload);

    // Atomically increment tenant sequence
    const currentSeq = (this.tenantSequences.get(input.tenant_id) ?? 0) + 1;
    this.tenantSequences.set(input.tenant_id, currentSeq);

    // Construct validated event envelope
    const event = createTelemetryStreamEvent<T>({
      schema_id: input.schema_id,
      epoch_id: this.streamEpochId,
      sequence_number: currentSeq,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      correlation_id: input.correlation_id ?? crypto.randomUUID(),
      producer_id: input.producer_id ?? 'backend.stream-bus',
      payload: sanitizedPayload,
      event_id: input.event_id,
      occurred_at: input.occurred_at,
    });

    // Store in tenant bounded replay buffer (067-SEC-05)
    const buffer = this.getOrCreateReplayBuffer(input.tenant_id);
    buffer.push(event as TelemetryStreamEvent);

    // Dispatch to active subscribers matching tenant and workspace scope
    this.dispatchToSubscribers(event as TelemetryStreamEvent);

    return event;
  }

  /**
   * Evaluates a client cursor against the replay buffer (Discovery Section 12.3)
   */
  public evaluateReplay(
    tenantId: string,
    cursor?: string,
    now: number = Date.now(),
  ): ReplayEvaluationResult {
    // Scenario 0: No cursor provided -> no replay
    if (cursor === undefined) {
      return { type: 'NONE', events: [] };
    }

    // Scenario 5: Malformed cursor
    if (!isValidStreamCursor(cursor)) {
      return {
        type: 'RESET',
        reason: 'MALFORMED_CURSOR',
        resetPayload: {
          reason: 'MALFORMED_CURSOR',
          currentEpoch: this.streamEpochId,
          currentSequence: this.getLatestSequence(tenantId),
          requestedCursor: String(cursor),
          message: 'Supplied Last-Event-ID format is invalid. Must match <uuid>:<positive-int>.',
        },
      };
    }

    const parsed = parseStreamCursor(cursor);
    if (!parsed) {
      return {
        type: 'RESET',
        reason: 'MALFORMED_CURSOR',
        resetPayload: {
          reason: 'MALFORMED_CURSOR',
          currentEpoch: this.streamEpochId,
          currentSequence: this.getLatestSequence(tenantId),
          requestedCursor: cursor,
        },
      };
    }

    // Scenario 4: Server epoch changed (process restart / cross-epoch confusion)
    if (parsed.epochId !== this.streamEpochId) {
      return {
        type: 'RESET',
        reason: 'SERVER_EPOCH_CHANGED',
        resetPayload: {
          reason: 'SERVER_EPOCH_CHANGED',
          currentEpoch: this.streamEpochId,
          currentSequence: this.getLatestSequence(tenantId),
          requestedCursor: cursor,
          message: 'Server process has restarted. Stored stream cursor belongs to a prior epoch.',
        },
      };
    }

    const latestSeq = this.getLatestSequence(tenantId);

    // Scenario 3: Future or corrupted cursor ahead of server sequence
    if (parsed.sequenceNumber > latestSeq) {
      return {
        type: 'RESET',
        reason: 'FUTURE_CURSOR_DETECTED',
        resetPayload: {
          reason: 'FUTURE_CURSOR_DETECTED',
          currentEpoch: this.streamEpochId,
          currentSequence: latestSeq,
          requestedCursor: cursor,
          message: 'Supplied sequence number is ahead of current server head.',
        },
      };
    }

    // If client is already up-to-date with head
    if (parsed.sequenceNumber === latestSeq) {
      return { type: 'REPLAY', events: [] };
    }

    // Buffer inspection
    const buffer = this.getOrCreateReplayBuffer(tenantId);
    buffer.prune(now);
    const oldestSeq = buffer.getOldestSequence(now);

    // Scenario 2: Cursor older than retained buffer window (evicted / expired)
    if (oldestSeq === null || parsed.sequenceNumber < oldestSeq) {
      return {
        type: 'RESET',
        reason: 'REPLAY_BUFFER_EXPIRED',
        resetPayload: {
          reason: 'REPLAY_BUFFER_EXPIRED',
          currentEpoch: this.streamEpochId,
          currentSequence: latestSeq,
          requestedCursor: cursor,
          message: 'Requested stream cursor has expired from the bounded replay buffer.',
        },
      };
    }

    // Scenario 1: Valid replay
    const replayed = buffer.getEventsSince(parsed.sequenceNumber, now);
    return { type: 'REPLAY', events: replayed };
  }

  /**
   * Subscribes a listener to a tenant stream with deterministic replay and workspace filtering
   */
  public subscribe(options: StreamSubscriptionOptions): StreamSubscriptionHandle {
    // 067-SEC-07: Enforce connection limit per tenant
    const tenantSubs = this.subscribers.get(options.tenantId) ?? new Set<InternalSubscriber>();
    if (tenantSubs.size >= this.maxStreamsPerTenant) {
      throw new Error(
        `067-SEC-07: Maximum concurrent stream connections (${this.maxStreamsPerTenant}) exceeded for tenant '${options.tenantId}'.`,
      );
    }

    const subId = crypto.randomUUID();
    let isSubscribed = true;

    const subscriber: InternalSubscriber = {
      id: subId,
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      listener: options.listener,
      onReset: options.onReset,
    };

    // 1. Evaluate replay / reset if cursor provided (Discovery Section 12.3)
    const replayResult: ReplayEvaluationResult =
      options.cursor !== undefined
        ? this.evaluateReplay(options.tenantId, options.cursor)
        : { type: 'NONE', events: [] };

    if (replayResult.type === 'RESET') {
      // Notify reset callback
      if (options.onReset) {
        options.onReset(replayResult.resetPayload);
      }
    } else if (replayResult.type === 'REPLAY') {
      // Deliver replayed events in strict sequence order before live events
      for (const event of replayResult.events) {
        if (this.matchesWorkspace(subscriber, event)) {
          options.listener(event);
        }
      }
    }

    // 2. Register subscriber
    if (!this.subscribers.has(options.tenantId)) {
      this.subscribers.set(options.tenantId, new Set());
    }
    this.subscribers.get(options.tenantId)!.add(subscriber);

    // 3. Return lifecycle handle (067-SEC-06)
    return {
      id: subId,
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      replay: replayResult,
      unsubscribe: () => {
        if (!isSubscribed) return false;
        isSubscribed = false;
        const subs = this.subscribers.get(options.tenantId);
        if (subs) {
          subs.delete(subscriber);
          if (subs.size === 0) {
            this.subscribers.delete(options.tenantId);
          }
        }
        return true;
      },
      isSubscribed: () => isSubscribed,
    };
  }

  /**
   * Workspace scoping check (067-SEC-02)
   */
  private matchesWorkspace(sub: InternalSubscriber, event: TelemetryStreamEvent): boolean {
    // If subscriber has no workspace filter or wildcard '*', receives all tenant events
    if (!sub.workspaceId || sub.workspaceId === '*') {
      return true;
    }
    // Tenant-wide event (no workspaceId on event) is visible to all workspaces in tenant
    if (!event.workspace_id || event.workspace_id === '*') {
      return true;
    }
    // Exact workspace match
    return event.workspace_id === sub.workspaceId;
  }

  /**
   * Dispatches live event to all active matching subscribers
   */
  private dispatchToSubscribers(event: TelemetryStreamEvent): void {
    const tenantSubs = this.subscribers.get(event.tenant_id);
    if (!tenantSubs || tenantSubs.size === 0) return;

    for (const sub of tenantSubs) {
      if (this.matchesWorkspace(sub, event)) {
        try {
          sub.listener(event);
        } catch (err) {
          // Prevent a faulty subscriber from crashing the event loop or other subscribers
          console.error(`[TenantStreamEventBus] Error in subscriber ${sub.id}:`, err);
        }
      }
    }
  }

  /**
   * Returns active subscriber count for a tenant
   */
  public getSubscriberCount(tenantId: string): number {
    return this.subscribers.get(tenantId)?.size ?? 0;
  }

  /**
   * Returns copy of current replay events for a tenant
   */
  public getReplayEvents(tenantId: string, now: number = Date.now()): TelemetryStreamEvent[] {
    const buffer = this.replayBuffers.get(tenantId);
    if (!buffer) return [];
    return buffer.getEvents(now);
  }

  /**
   * Cleans up tenant state (for testing and lifecycle teardown)
   */
  public clear(tenantId?: string): void {
    if (tenantId) {
      this.tenantSequences.delete(tenantId);
      this.replayBuffers.get(tenantId)?.clear();
      this.replayBuffers.delete(tenantId);
      this.subscribers.delete(tenantId);
    } else {
      this.tenantSequences.clear();
      for (const buf of this.replayBuffers.values()) {
        buf.clear();
      }
      this.replayBuffers.clear();
      this.subscribers.clear();
    }
  }
}
