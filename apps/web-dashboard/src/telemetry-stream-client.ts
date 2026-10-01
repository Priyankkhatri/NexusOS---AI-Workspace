/**
 * NexusOS Web Dashboard — Authenticated SSE Telemetry Stream Client
 *
 * Task 067 Phase 3A: Dashboard Real-Time Transport Foundation
 *
 * 067-SEC-01: Tenant isolation (derived strictly from authenticated context; no tenant query spoofing).
 * 067-SEC-02: Workspace scoping via X-Workspace-ID header or workspaceId parameter.
 * 067-SEC-04: Stream cursor integrity (<epochId>:<sequenceNumber>); epoch/buffer reset handling.
 * 067-SEC-05: Bounded backoff/reconnect ceilings; zero memory leakage on disconnect.
 * 067-SEC-07: Observational only (no execution authority; read-only streaming projection).
 * 067-SEC-08: Secret containment (bearer tokens in closure/header only; NEVER in URL query params or storage).
 * 067-SEC-10: Ephemeral in-memory cursor scoping (never written to localStorage or sessionStorage).
 *
 * P3A-SEC-01: Bearer token never appears in URL/query string.
 * P3A-SEC-02: Client does not fabricate tenant/workspace identity.
 * P3A-SEC-03: Malformed SSE data fails safely without throwing unhandled exceptions.
 * P3A-SEC-04: Epoch reset invalidates cursor and notifies reconciliation hook.
 * P3A-SEC-05: Expired/future/malformed resets trigger safe invalidation and reconnect.
 * P3A-SEC-06: Disconnect cleans all timers, active reader, fetch signal, and reconnect state.
 * P3A-SEC-07: No overlapping reconnect attempts.
 * P3A-SEC-08: No unbounded client-side event storage.
 * P3A-SEC-09: Event payloads are data objects, never evaluated or interpreted as HTML.
 * P3A-SEC-10: SSE/polling coordination prevents duplicate polling intervals.
 */

import {
  type TelemetryStreamEvent,
  TelemetryStreamEventSchema,
  type StreamResetPayload,
  StreamResetPayloadSchema,
  isValidStreamCursor,
} from '@nexusos/contracts';

export type ConnectionState =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'CONNECTED_STREAMING'
  | 'RECONNECTING'
  | 'DEGRADED_POLLING';

export interface TelemetryStreamClientConfig {
  baseUrl: string;
  getAuthToken: () => string | null;
  tenantId?: string;
  workspaceId?: string;
  getWorkspaceId?: () => string | undefined;
  onEvent?: (event: TelemetryStreamEvent) => void;
  onReset?: (payload: StreamResetPayload) => void;
  onStateChange?: (state: ConnectionState, detail?: string) => void;
  onError?: (error: Error) => void;

  // Resilient timing configurations
  heartbeatTimeoutMs?: number; // Default: 35,000 ms
  baseDelayMs?: number; // Default: 1,000 ms
  multiplier?: number; // Default: 1.5
  maxDelayMs?: number; // Default: 15,000 ms
  jitterFactor?: number; // Default: 0.2 (+-20%)
  maxReconnectAttempts?: number; // Default: 5 attempts before DEGRADED_POLLING
  degradedProbeIntervalMs?: number; // Default: 60,000 ms (optimistic reconnect from degraded)

  // Injectable primitives for deterministic testing
  fetchFn?: typeof fetch;
  randomFn?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

export class TelemetryStreamClient {
  private readonly config: TelemetryStreamClientConfig;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly randomFn: () => number;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (id: unknown) => void;

  private readonly heartbeatTimeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly multiplier: number;
  private readonly maxDelayMs: number;
  private readonly jitterFactor: number;
  private readonly maxReconnectAttempts: number;
  private readonly degradedProbeIntervalMs: number;

  private _state: ConnectionState = 'OFFLINE';
  private _currentCursor: string | null = null;
  private _reconnectAttempts = 0;
  private _isStopped = true;
  private _isConnecting = false;

  private _abortController: AbortController | null = null;
  private _reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _watchdogTimer: unknown = null;
  private _reconnectTimer: unknown = null;
  private _degradedProbeTimer: unknown = null;

  constructor(config: TelemetryStreamClientConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.randomFn = config.randomFn ?? Math.random;
    this.setTimeoutFn = config.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn =
      config.clearTimeoutFn ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));

    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 35_000;
    this.baseDelayMs = config.baseDelayMs ?? 1_000;
    this.multiplier = config.multiplier ?? 1.5;
    this.maxDelayMs = config.maxDelayMs ?? 15_000;
    this.jitterFactor = config.jitterFactor ?? 0.2;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.degradedProbeIntervalMs = config.degradedProbeIntervalMs ?? 60_000;
  }

  public get state(): ConnectionState {
    return this._state;
  }

  public get currentCursor(): string | null {
    return this._currentCursor;
  }

  public get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  public start(): void {
    this.connect();
  }

  public connect(): void {
    if (
      !this._isStopped &&
      (this._state === 'CONNECTED_STREAMING' || this._state === 'CONNECTING')
    ) {
      return;
    }

    this._isStopped = false;
    this.clearReconnectTimer();
    this.clearDegradedProbeTimer();

    void this.attemptConnect();
  }

  public stop(): void {
    this.disconnect();
  }

  public disconnect(): void {
    this._isStopped = true;
    this._isConnecting = false;

    this.clearWatchdog();
    this.clearReconnectTimer();
    this.clearDegradedProbeTimer();

    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {
        // Ignore abort errors on explicit disconnect
      }
      this._abortController = null;
    }

    if (this._reader) {
      try {
        void this._reader.cancel();
      } catch {
        // Ignore cancellation errors
      }
      try {
        this._reader.releaseLock();
      } catch {
        // Ignore lock release errors
      }
      this._reader = null;
    }

    this.transitionTo('OFFLINE', 'Explicit disconnect');
  }

  private transitionTo(newState: ConnectionState, detail?: string): void {
    if (this._state === newState) return;
    this._state = newState;
    this.config.onStateChange?.(newState, detail);
  }

  private async attemptConnect(): Promise<void> {
    if (this._isStopped || this._isConnecting) return;
    this._isConnecting = true;

    this.transitionTo('CONNECTING');

    const token = this.config.getAuthToken();
    if (!token) {
      this._isConnecting = false;
      this.transitionTo('OFFLINE', 'No auth token available (053-SEC-05)');
      return;
    }

    // P3A-SEC-01 & 067-SEC-08: Token is NEVER in URL or query params.
    // P3A-SEC-02 & 067-SEC-01: Tenant ID derived strictly from authenticated context; NEVER sent in query.
    const url = new URL(`${this.baseUrl}/v1/telemetry/stream`);

    const workspaceId = this.config.getWorkspaceId?.() ?? this.config.workspaceId;

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    };

    if (workspaceId) {
      headers['X-Workspace-ID'] = workspaceId;
    }

    if (this._currentCursor && isValidStreamCursor(this._currentCursor)) {
      headers['Last-Event-ID'] = this._currentCursor;
    }

    this._abortController = new AbortController();

    try {
      const response = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers,
        signal: this._abortController.signal,
      });

      if (this._isStopped) return;
      this._isConnecting = false;

      // Handle HTTP status codes
      if (response.status === 401) {
        // Authentication failure — stop reconnecting, transition to OFFLINE
        this.transitionTo('OFFLINE', 'HTTP 401: Unauthorized');
        return;
      }

      if (response.status === 405) {
        // Read-only endpoint invariant violated
        this.transitionTo('OFFLINE', 'HTTP 405: Method Not Allowed');
        return;
      }

      if (response.status === 429) {
        // Max concurrent streams reached — fall back to polling
        this.transitionTo('DEGRADED_POLLING', 'HTTP 429: Concurrent stream limit exceeded');
        this.scheduleDegradedProbe();
        return;
      }

      if (!response.ok) {
        // Transient server error (500, 502, 503, 504, etc.)
        this.transitionTo('RECONNECTING', `HTTP ${response.status}`);
        this.scheduleReconnect();
        return;
      }

      if (!response.body) {
        this.transitionTo('RECONNECTING', 'Response body missing');
        this.scheduleReconnect();
        return;
      }

      // 200 OK — Connected & streaming
      this.transitionTo('CONNECTED_STREAMING');
      this._reconnectAttempts = 0;
      this.resetWatchdog();

      await this.readStream(response.body);
    } catch (err: unknown) {
      if (this._isStopped) return;
      this._isConnecting = false;

      // Check if error was caused by abort during stop()
      if (err instanceof Error && err.name === 'AbortError') {
        if (this._state === 'RECONNECTING') {
          // Aborted by watchdog timeout — schedule reconnect
          this.scheduleReconnect();
        }
        return;
      }

      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.transitionTo('RECONNECTING', err instanceof Error ? err.message : String(err));
      this.scheduleReconnect();
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    this._reader = reader;
    const decoder = new TextDecoder('utf-8');

    let lineBuffer = '';
    let currentEventName: string | undefined = undefined;
    let currentEventId: string | undefined = undefined;
    let currentDataLines: string[] = [];

    try {
      while (!this._isStopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        // Any incoming bytes reset the heartbeat watchdog
        this.resetWatchdog();

        const chunkText = decoder.decode(value, { stream: true });
        lineBuffer += chunkText;

        const lines = lineBuffer.split(/\r?\n/);
        // Retain the incomplete segment in lineBuffer
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (this._isStopped) break;

          if (line.startsWith(':')) {
            // Heartbeat comment line (e.g. ": ping")
            // Resets watchdog; MUST NOT become an application event
            this.resetWatchdog();
            continue;
          }

          if (line === '') {
            // Frame termination
            if (
              currentEventName !== undefined ||
              currentDataLines.length > 0 ||
              currentEventId !== undefined
            ) {
              this.dispatchFrame(currentEventName, currentEventId, currentDataLines);
              currentEventName = undefined;
              currentEventId = undefined;
              currentDataLines = [];
            }
            continue;
          }

          if (line.startsWith('event:')) {
            let ev = line.slice(6);
            if (ev.startsWith(' ')) ev = ev.slice(1);
            currentEventName = ev.trim();
          } else if (line.startsWith('id:')) {
            let idVal = line.slice(3);
            if (idVal.startsWith(' ')) idVal = idVal.slice(1);
            currentEventId = idVal.trim();
          } else if (line.startsWith('data:')) {
            let dataVal = line.slice(5);
            if (dataVal.startsWith(' ')) dataVal = dataVal.slice(1);
            currentDataLines.push(dataVal);
          }
        }
      }

      // Flush remaining incomplete line if any
      const remainder = decoder.decode();
      if (remainder) {
        lineBuffer += remainder;
      }
      if (
        lineBuffer &&
        (currentEventName !== undefined ||
          currentDataLines.length > 0 ||
          currentEventId !== undefined)
      ) {
        this.dispatchFrame(currentEventName, currentEventId, currentDataLines);
      }
    } catch (err: unknown) {
      if (this._isStopped) return;
      this.clearWatchdog();

      if (err instanceof Error && err.name === 'AbortError') {
        if (this._state === 'RECONNECTING') {
          this.scheduleReconnect();
        }
        return;
      }

      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.transitionTo('RECONNECTING', err instanceof Error ? err.message : String(err));
      this.scheduleReconnect();
      return;
    } finally {
      this.clearWatchdog();
      try {
        this._reader?.releaseLock();
      } catch {
        // Ignore lock release error
      }
      this._reader = null;
    }

    if (!this._isStopped) {
      // Normal EOF / server closed connection without error -> reconnect
      this.transitionTo('RECONNECTING', 'Stream closed by server');
      this.scheduleReconnect();
    }
  }

  private dispatchFrame(
    eventName: string | undefined,
    eventId: string | undefined,
    dataLines: string[],
  ): void {
    if (this._isStopped) return;

    // Stream reset frame handling
    if (eventName === 'nexusos.events.stream.reset') {
      const rawData = dataLines.join('\n');
      let resetPayload: StreamResetPayload;
      try {
        const parsed = JSON.parse(rawData);
        resetPayload = StreamResetPayloadSchema.parse(parsed);
      } catch {
        resetPayload = {
          reason: 'MALFORMED_CURSOR',
          currentEpoch: '00000000-0000-0000-0000-000000000000',
          currentSequence: 0,
          message: 'Malformed stream reset payload',
        };
      }

      // P3A-SEC-04: Invalidate current cursor on reset
      this._currentCursor = null;

      // P3A-SEC-05: Notify application reconciliation hook
      this.config.onReset?.(resetPayload);
      return;
    }

    // Application event frame handling
    if (dataLines.length > 0) {
      const rawData = dataLines.join('\n');
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawData);
      } catch (err) {
        // P3A-SEC-03: Malformed data frame fails safely without throwing
        this.config.onError?.(new Error(`Malformed JSON in SSE data: ${String(err)}`));
        return;
      }

      const parseResult = TelemetryStreamEventSchema.safeParse(parsedJson);
      if (!parseResult.success) {
        // P3A-SEC-03: Schema failure fails safely
        this.config.onError?.(
          new Error(`Invalid TelemetryStreamEvent envelope: ${parseResult.error.message}`),
        );
        return;
      }

      const event = parseResult.data as TelemetryStreamEvent;

      // Update cursor ONLY AFTER accepting the event
      if (eventId && isValidStreamCursor(eventId)) {
        this._currentCursor = eventId;
      } else if (event.cursor && isValidStreamCursor(event.cursor)) {
        this._currentCursor = event.cursor;
      }

      // P3A-SEC-08: Client does not accumulate events in an unbounded internal array
      // P3A-SEC-09: Event payloads are data objects, never HTML strings
      this.config.onEvent?.(event);
    }
  }

  private resetWatchdog(): void {
    if (this._isStopped) return;
    this.clearWatchdog();

    this._watchdogTimer = this.setTimeoutFn(() => {
      this.onWatchdogTimeout();
    }, this.heartbeatTimeoutMs);
  }

  private clearWatchdog(): void {
    if (this._watchdogTimer !== null) {
      this.clearTimeoutFn(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  private onWatchdogTimeout(): void {
    if (this._isStopped) return;
    this.clearWatchdog();

    this.config.onError?.(
      new Error(`Heartbeat watchdog timed out (${this.heartbeatTimeoutMs}ms silent)`),
    );

    this.transitionTo('RECONNECTING', 'Heartbeat watchdog timeout');

    // Abort the active stream so read loop terminates and triggers reconnect
    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {
        // Ignore
      }
    }
  }

  private scheduleReconnect(): void {
    if (this._isStopped) return;
    // P3A-SEC-07: Prevent overlapping reconnect timers
    if (this._reconnectTimer !== null) return;

    this._reconnectAttempts++;

    if (this._reconnectAttempts > this.maxReconnectAttempts) {
      // Ceiling reached -> fall back to degraded polling
      this.transitionTo(
        'DEGRADED_POLLING',
        `Max reconnect attempts (${this.maxReconnectAttempts}) exceeded`,
      );
      this.scheduleDegradedProbe();
      return;
    }

    this.transitionTo(
      'RECONNECTING',
      `Attempt ${this._reconnectAttempts}/${this.maxReconnectAttempts}`,
    );

    // Bounded exponential backoff formula:
    // delay = min(baseDelay * (multiplier ^ (attempt - 1)), maxDelay) * (1 +- jitter)
    const expDelay = Math.min(
      this.baseDelayMs * Math.pow(this.multiplier, this._reconnectAttempts - 1),
      this.maxDelayMs,
    );

    const jitter = (this.randomFn() * 2 - 1) * this.jitterFactor;
    const delay = Math.max(0, Math.round(expDelay * (1 + jitter)));

    this._reconnectTimer = this.setTimeoutFn(() => {
      this._reconnectTimer = null;
      if (!this._isStopped) {
        void this.attemptConnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this._reconnectTimer !== null) {
      this.clearTimeoutFn(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private scheduleDegradedProbe(): void {
    if (this._isStopped) return;
    this.clearDegradedProbeTimer();

    this._degradedProbeTimer = this.setTimeoutFn(() => {
      this._degradedProbeTimer = null;
      if (!this._isStopped && this._state === 'DEGRADED_POLLING') {
        // Optimistically probe SSE connection
        this._reconnectAttempts = 0;
        void this.attemptConnect();
      }
    }, this.degradedProbeIntervalMs);
  }

  private clearDegradedProbeTimer(): void {
    if (this._degradedProbeTimer !== null) {
      this.clearTimeoutFn(this._degradedProbeTimer);
      this._degradedProbeTimer = null;
    }
  }
}
