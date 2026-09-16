import { IncomingMessage, ServerResponse } from 'node:http';
import { TelemetryStreamEvent, StreamResetPayload } from '@nexusos/contracts';
import { StreamSubscriptionHandle } from './stream-event-bus.js';

export interface SSEConnectionOptions {
  heartbeatIntervalMs?: number;
  maxQueueSize?: number;
  maxQueueBytes?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_QUEUE_SIZE = 64;
const DEFAULT_MAX_QUEUE_BYTES = 256 * 1024; // 256 KB per connection

/**
 * Manages an individual client SSE connection (Discovery Section 11 & 14)
 * - Standards-compliant SSE framing (`event:`, `id:`, `data:`)
 * - Non-event comment heartbeats (`: ping\n\n`)
 * - Backpressure handling with bounded outbound queue and memory limits
 * - Safe lifecycle unsubscription and timer cleanup (067-SEC-06)
 */
export class SSEStreamConnection {
  private readonly req: IncomingMessage;
  private readonly res: ServerResponse;
  private readonly heartbeatIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly maxQueueBytes: number;

  private subscriptionHandle: StreamSubscriptionHandle | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private outboundQueue: string[] = [];
  private queuedBytes = 0;
  private isDraining = false;
  private isClosed = false;

  constructor(req: IncomingMessage, res: ServerResponse, options: SSEConnectionOptions = {}) {
    this.req = req;
    this.res = res;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;

    this.setupLifecycleHandlers();
    this.startHeartbeat();
  }

  /**
   * Binds the bus subscription handle to this connection
   */
  public bindSubscription(handle: StreamSubscriptionHandle): void {
    if (this.isClosed || this.res.destroyed || this.res.writableEnded) {
      handle.unsubscribe();
      return;
    }
    this.subscriptionHandle = handle;
  }

  /**
   * Serializes and writes a canonical telemetry event frame
   */
  public sendEvent(event: TelemetryStreamEvent): void {
    if (this.isClosed) return;

    const frame = this.formatEventFrame(event.schema_id, event.cursor, JSON.stringify(event));
    this.enqueueOrWrite(frame);
  }

  /**
   * Serializes and writes a canonical stream.reset control frame
   */
  public sendReset(resetPayload: StreamResetPayload): void {
    if (this.isClosed) return;

    const resetCursor = `${resetPayload.currentEpoch}:0`;
    const frame = this.formatEventFrame(
      'nexusos.events.stream.reset',
      resetCursor,
      JSON.stringify(resetPayload),
    );
    this.enqueueOrWrite(frame);
  }

  /**
   * Serializes and writes an SSE heartbeat comment frame (: ping\n\n)
   * Does NOT increment stream sequence, does NOT appear as telemetry, does NOT enter replay
   */
  public sendHeartbeat(): void {
    if (this.isClosed) return;
    this.enqueueOrWrite(': ping\n\n');
  }

  /**
   * Formats a standards-compliant SSE frame
   */
  private formatEventFrame(event: string, id: string, data: string): string {
    return `event: ${event}\nid: ${id}\ndata: ${data}\n\n`;
  }

  /**
   * Writes frame directly or buffers if socket is experiencing backpressure
   */
  private enqueueOrWrite(chunk: string): void {
    if (this.isClosed || this.res.destroyed || this.res.writableEnded) {
      this.close();
      return;
    }

    const chunkBytes = Buffer.byteLength(chunk, 'utf8');

    if (this.isDraining) {
      if (
        this.outboundQueue.length >= this.maxQueueSize ||
        this.queuedBytes + chunkBytes > this.maxQueueBytes
      ) {
        // Saturated consumer exceeding memory ceiling -> terminate safely (067-SEC-05, 067-SEC-07)
        this.close();
        return;
      }
      this.outboundQueue.push(chunk);
      this.queuedBytes += chunkBytes;
      return;
    }

    let canContinue = false;
    try {
      canContinue = this.res.write(chunk);
    } catch {
      this.close();
      return;
    }

    if (!canContinue) {
      this.isDraining = true;
      this.res.once('drain', () => this.handleDrain());
    }
  }

  /**
   * Flushes buffered outbound frames once the socket drains
   */
  private handleDrain(): void {
    if (this.isClosed || this.res.destroyed || this.res.writableEnded) return;
    this.isDraining = false;

    while (this.outboundQueue.length > 0) {
      const chunk = this.outboundQueue.shift();
      if (!chunk) continue;

      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      this.queuedBytes = Math.max(0, this.queuedBytes - chunkBytes);

      let canContinue = false;
      try {
        canContinue = this.res.write(chunk);
      } catch {
        this.close();
        return;
      }

      if (!canContinue) {
        this.isDraining = true;
        this.res.once('drain', () => this.handleDrain());
        break;
      }
    }
  }

  /**
   * Starts periodic heartbeat comment timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);

    // Unref timer so it does not block Node.js event loop shutdown
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Sets up request and response lifecycle listeners for deterministic cleanup
   */
  private setupLifecycleHandlers(): void {
    const onDisconnect = () => this.close();

    this.req.once('close', onDisconnect);
    this.req.once('aborted', onDisconnect);
    this.res.once('close', onDisconnect);
    this.res.once('error', onDisconnect);
  }

  /**
   * Terminates the connection and releases all resources (067-SEC-06)
   */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    // Clear heartbeat timer deterministically
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Unsubscribe from bus to decrement stream counter
    if (this.subscriptionHandle) {
      this.subscriptionHandle.unsubscribe();
      this.subscriptionHandle = null;
    }

    // Clear queue
    this.outboundQueue = [];
    this.queuedBytes = 0;

    // Safely end response if open
    try {
      if (!this.res.writableEnded) {
        this.res.end();
      }
    } catch {
      // Socket already closed
    }
  }

  /**
   * Returns whether connection is closed
   */
  public get closed(): boolean {
    return this.isClosed;
  }
}
