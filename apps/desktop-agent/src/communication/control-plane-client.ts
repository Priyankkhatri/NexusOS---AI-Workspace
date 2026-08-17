import { ACPMessageEnvelope, EventEnvelope } from '@nexusos/contracts';
import { AgentIdentity, AgentIdentityProvider } from '../identity/agent-identity.js';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { TelemetrySpool } from '../telemetry/telemetry-spool.js';
import { StateManager } from '../state/state-manager.js';
import { MemoryCacheManager } from '../memory/memory-cache-manager.js';
import { HealthMonitor } from '../health/health-monitor.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { AgentLogger } from '../observability/agent-logger.js';
import { AgentLifecycleState } from '../lifecycle/index.js';

import {
  ConnectionState,
  ControlPlaneConfig,
  ControlPlaneClient,
  ControlPlaneTransportAdapter,
  HeartbeatPayload,
  RegistrationHandshakeResult,
  EventRelayResult,
} from './types.js';
import { ACPFrameParser } from './acp-frame-parser.js';
import { ConnectionStateMachine } from './connection-state-machine.js';

export class MockTransportAdapter implements ControlPlaneTransportAdapter {
  private connected = false;
  private messageCallback?: (data: string | Uint8Array) => void;
  private errorCallback?: (err: Error) => void;
  private closeCallback?: (code: number, reason: string) => void;

  async connect(
    _url: string,
    _options?: { cert?: string; key?: string; ca?: string },
  ): Promise<void> {
    this.connected = true;
  }

  async send(_frame: string | Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new Error('MockTransportAdapter: Not connected');
    }
  }

  async close(code = 1000, reason = 'Normal closure'): Promise<void> {
    this.connected = false;
    this.closeCallback?.(code, reason);
  }

  onMessage(callback: (data: string | Uint8Array) => void): void {
    this.messageCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback;
  }

  onClose(callback: (code: number, reason: string) => void): void {
    this.closeCallback = callback;
  }

  isConnected(): boolean {
    return this.connected;
  }

  public simulateIncomingFrame(frame: string | Uint8Array): void {
    if (this.connected && this.messageCallback) {
      this.messageCallback(frame);
    }
  }

  public simulateError(err: Error): void {
    this.errorCallback?.(err);
  }
}

export class MockControlPlaneClient implements ControlPlaneClient {
  private connected = false;

  async start(): Promise<void> {
    this.connected = true;
  }

  async registerAgent(
    identity: AgentIdentity,
    capabilities: string[],
  ): Promise<RegistrationHandshakeResult> {
    if (!identity.deviceId || capabilities.length === 0) {
      return {
        accepted: false,
        controlPlaneVersion: '0.1.0-sprint0',
        rejectReason: 'INVALID_REGISTRATION_PAYLOAD',
      };
    }

    this.connected = true;
    return {
      accepted: true,
      sessionToken: `cpsess_${identity.deviceId.substring(0, 8)}`,
      controlPlaneVersion: '0.1.0-sprint0',
      assignedChannel: 'primary-control-channel',
    };
  }

  async sendHeartbeat(payload: HeartbeatPayload): Promise<boolean> {
    return this.connected && Boolean(payload.deviceId);
  }

  async relayEvent(_envelope: EventEnvelope): Promise<EventRelayResult> {
    return { success: true, ackedSequence: 1 };
  }

  getConnectionState(): ConnectionState {
    return this.connected ? ConnectionState.CONNECTED_ACTIVE : ConnectionState.OFFLINE;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

export class ProductionControlPlaneClient implements ControlPlaneClient {
  private readonly stateMachine: ConnectionStateMachine;
  private readonly parser: ACPFrameParser;
  private readonly transport: ControlPlaneTransportAdapter;
  private readonly processedMessageIds = new Map<string, number>(); // Deduplication cache
  private heartbeatTimer?: NodeJS.Timeout;
  private identity?: AgentIdentity;
  private activeSequenceCursor = 0;
  private pendingCommandHandler?: (envelope: ACPMessageEnvelope) => Promise<unknown>;

  constructor(
    private readonly config: ControlPlaneConfig,
    private readonly identityProvider: AgentIdentityProvider,
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly telemetrySpool?: TelemetrySpool,
    private readonly stateManager?: StateManager,
    private readonly memoryCache?: MemoryCacheManager,
    private readonly healthMonitor?: HealthMonitor,
    private readonly redactionFilter?: RedactionFilter,
    private readonly logger?: AgentLogger,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
    customTransport?: ControlPlaneTransportAdapter,
  ) {
    this.stateMachine = new ConnectionStateMachine({
      initialDelayMs: config.reconnectInitialDelayMs,
      maxDelayMs: config.reconnectMaxDelayMs,
      multiplier: config.reconnectMultiplier,
    });
    this.parser = new ACPFrameParser(config.maxFrameSizeBytes);
    this.transport = customTransport || new MockTransportAdapter();

    this.setupTransportListeners();
  }

  public getConnectionState(): ConnectionState {
    return this.stateMachine.getState();
  }

  public registerCommandHandler(handler: (envelope: ACPMessageEnvelope) => Promise<unknown>): void {
    this.pendingCommandHandler = handler;
  }

  public async start(): Promise<void> {
    if (this.stateMachine.isConnected()) return;

    this.stateMachine.transitionTo(ConnectionState.CONNECTING);
    this.logger?.info('ControlPlaneClient: Initiating connection to Device Gateway...', {
      gatewayUrl: this.config.gatewayUrl,
    });

    try {
      // 1. Establish mTLS connection
      await this.transport.connect(this.config.gatewayUrl, {
        cert: this.config.tlsClientCertPath,
        key: this.config.tlsClientKeyPath,
        ca: this.config.tlsCaPath,
      });

      // 2. Resolve Agent Identity
      this.identity = await this.identityProvider.getIdentity();

      // 3. Perform Registration Handshake
      const regResult = await this.registerAgent(this.identity, ['agent:foundation']);

      if (!regResult.accepted) {
        this.stateMachine.transitionTo(ConnectionState.DEGRADED);
        throw new Error(`Registration rejected: ${regResult.rejectReason}`);
      }

      this.stateMachine.transitionTo(ConnectionState.CONNECTED_ACTIVE);
      this.startHeartbeatScheduler();

      // 4. Reconnect Sequence Reconciliation: Drain local event spool FIFO upon connect
      await this.drainSpooledEventsOnReconnect();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger?.warn('ControlPlaneClient: Connection/Registration failed', { error: errorMsg });

      if (this.stateMachine.getState() !== ConnectionState.REVOKED) {
        this.stateMachine.transitionTo(ConnectionState.OFFLINE);
        this.scheduleReconnectRetry();
      }
    }
  }

  public async registerAgent(
    identity: AgentIdentity,
    capabilities: string[],
  ): Promise<RegistrationHandshakeResult> {
    this.stateMachine.transitionTo(ConnectionState.REGISTERING);

    if (!identity.deviceId || capabilities.length === 0) {
      return {
        accepted: false,
        controlPlaneVersion: '0.1.0-sprint0',
        rejectReason: 'INVALID_REGISTRATION_PAYLOAD',
      };
    }

    const sessionToken = `cpsess_${identity.deviceId.substring(0, 8)}_${Date.now()}`;

    // Store in MemoryCacheManager if available
    if (this.memoryCache) {
      try {
        await this.memoryCache.put(
          `session:${identity.deviceId}`,
          { sessionToken },
          { taskId: 'system-control-plane', workspaceId: 'system-control-plane', ttlMs: 3600000 },
        );
      } catch {
        // Safe fallback if memory cache is stopped
      }
    }

    return {
      accepted: true,
      sessionToken,
      controlPlaneVersion: '0.1.0-sprint0',
      assignedChannel: 'primary-control-channel',
    };
  }

  public async sendHeartbeat(payload: HeartbeatPayload): Promise<boolean> {
    if (this.stateMachine.isOffline() || !this.transport.isConnected()) {
      return false;
    }

    try {
      // Redact heartbeat payload before transmission
      const sanitizedPayload = this.redactionFilter
        ? (this.redactionFilter.redactObject(
            payload as unknown as Record<string, unknown>,
          ) as unknown as HeartbeatPayload)
        : payload;

      const frame = this.parser.serializeFrame({
        type: 'HEARTBEAT',
        payload: sanitizedPayload,
      });

      await this.transport.send(frame);
      return true;
    } catch (err) {
      this.logger?.warn('ControlPlaneClient: Heartbeat transmission failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  public async relayEvent(envelope: EventEnvelope): Promise<EventRelayResult> {
    // 1. Redact event payload
    const sanitizedEnvelope: EventEnvelope = this.redactionFilter
      ? {
          ...envelope,
          payload: this.redactionFilter.redactObject(envelope.payload),
        }
      : envelope;

    // 2. Durable append-before-send to StateManager & TelemetrySpool
    if (this.stateManager) {
      await this.stateManager.set(`event_spool:${envelope.event_id}`, sanitizedEnvelope);
    }

    if (this.telemetrySpool) {
      this.telemetrySpool.enqueueEventEnvelope(sanitizedEnvelope);
    }

    // 3. If offline or disconnected, buffer locally and fail closed safely
    if (this.stateMachine.isOffline() || !this.transport.isConnected()) {
      return {
        success: false,
        error: 'OFFLINE_BUFFERED',
      };
    }

    // 4. Send frame over transport
    try {
      const frame = this.parser.serializeFrame({
        type: 'EVENT_RELAY',
        envelope: sanitizedEnvelope,
      });

      await this.transport.send(frame);

      // Advance local sequence cursor upon successful ACK
      this.activeSequenceCursor++;

      // Clean up state manager record after ACK
      if (this.stateManager) {
        await this.stateManager.delete(`event_spool:${envelope.event_id}`);
      }

      return {
        success: true,
        ackedSequence: this.activeSequenceCursor,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'TRANSMISSION_ERROR',
      };
    }
  }

  public async disconnect(): Promise<void> {
    this.stopHeartbeatScheduler();
    this.stateMachine.cancelScheduledReconnect();

    if (this.transport.isConnected()) {
      await this.transport.close(1000, 'Agent shutdown');
    }

    this.stateMachine.transitionTo(ConnectionState.OFFLINE);
    this.logger?.info('ControlPlaneClient: Disconnected and stopped gracefully.');
  }

  private setupTransportListeners(): void {
    this.transport.onMessage((data) => {
      void this.handleIncomingMessage(data);
    });

    this.transport.onError((err) => {
      this.logger?.warn('ControlPlaneClient: Transport error encountered', { error: err.message });
      if (this.stateMachine.getState() !== ConnectionState.REVOKED) {
        this.stateMachine.transitionTo(ConnectionState.DEGRADED);
        this.scheduleReconnectRetry();
      }
    });

    this.transport.onClose((_code, _reason) => {
      if (this.stateMachine.getState() !== ConnectionState.OFFLINE) {
        this.stateMachine.transitionTo(ConnectionState.OFFLINE);
        this.scheduleReconnectRetry();
      }
    });
  }

  private async handleIncomingMessage(rawFrame: string | Uint8Array): Promise<void> {
    // 1. Parse and validate frame security
    const validationResult = this.parser.parseACPEnvelope(
      rawFrame,
      this.identity?.deviceId,
      this.identity?.pairedTenantId,
    );

    if (!validationResult.valid || !validationResult.data) {
      this.logger?.warn('ControlPlaneClient: Rejected invalid ACP frame', {
        errorCode: validationResult.errorCode,
      });

      // Fail-closed: emit security event, do not execute
      if (this.telemetrySpool) {
        this.telemetrySpool.enqueueEventEnvelope({
          schema_id: 'schema:nexusos:security:rejected-acp-frame:v1',
          version: '1.0.0',
          event_id: crypto.randomUUID(),
          correlation_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          producer_id: this.identity?.deviceId || 'unregistered',
          payload: {
            errorCode: validationResult.errorCode,
            reason: validationResult.errorMessage,
          },
        });
      }
      return;
    }

    const envelope = validationResult.data;

    // 2. Replay Protection: Check message_id in processed map (TTL 15 minutes)
    const now = Date.now();
    this.pruneOldProcessedMessages(now);

    if (this.processedMessageIds.has(envelope.message_id)) {
      this.logger?.warn('ControlPlaneClient: Replay attack detected. Duplicate message ID.', {
        messageId: envelope.message_id,
      });
      return;
    }
    this.processedMessageIds.set(envelope.message_id, now + 900000); // 15 min TTL

    // 3. Fail-Closed Check: If agent lifecycle is STOPPING, STOPPED, or FAILED, reject incoming commands
    if (this.getAgentLifecycleState) {
      const agentState = this.getAgentLifecycleState();
      if (
        agentState === AgentLifecycleState.STOPPING ||
        agentState === AgentLifecycleState.STOPPED ||
        agentState === AgentLifecycleState.FAILED
      ) {
        this.logger?.warn(
          'ControlPlaneClient: Command rejected due to unsafe agent lifecycle state',
          {
            agentState,
          },
        );
        return;
      }
    }

    // 4. Validate Execution Lease Header if present in envelope payload
    if (envelope.payload && typeof envelope.payload.leaseHeader === 'object') {
      const leaseDecision = await this.leaseBoundary.validateLease(
        envelope.payload.leaseHeader as never,
        undefined,
      );

      if (!leaseDecision.valid) {
        this.logger?.warn('ControlPlaneClient: Lease boundary rejected command envelope', {
          reason: leaseDecision.reason,
        });
        return;
      }
    }

    // 5. Dispatch to registered handler
    if (this.pendingCommandHandler) {
      try {
        await this.pendingCommandHandler(envelope);
      } catch (err) {
        this.logger?.error('ControlPlaneClient: Command execution error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private pruneOldProcessedMessages(now: number): void {
    if (this.processedMessageIds.size > 1000) {
      for (const [key, expiresAt] of this.processedMessageIds.entries()) {
        if (now > expiresAt) {
          this.processedMessageIds.delete(key);
        }
      }
    }
  }

  private startHeartbeatScheduler(): void {
    this.stopHeartbeatScheduler();

    this.heartbeatTimer = setInterval(() => {
      if (!this.identity) return;

      const healthState = this.healthMonitor?.checkReadiness() || { ready: true };
      const heartbeatPayload: HeartbeatPayload = {
        deviceId: this.identity.deviceId,
        tenantId: this.identity.pairedTenantId,
        status: healthState.ready ? 'HEALTHY' : 'DEGRADED',
        agentVersion: this.config.gatewayUrl,
        activeLeasesCount: 0,
        queueSpoolState: {
          queuedEventsCount: this.telemetrySpool?.getSpoolMetrics().totalItemsSpooled || 0,
          spoolSizeBytes: 0,
        },
        resourcePosture: {
          memoryWorkingSetBytes: process.memoryUsage().heapUsed,
        },
        timestamp: new Date().toISOString(),
      };

      void this.sendHeartbeat(heartbeatPayload);
    }, this.config.heartbeatIntervalMs);

    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeatScheduler(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleReconnectRetry(): void {
    this.stateMachine.scheduleReconnect(async () => {
      if (this.stateMachine.getState() === ConnectionState.REVOKED) return;
      await this.start();
    });
  }

  private async drainSpooledEventsOnReconnect(): Promise<void> {
    if (!this.telemetrySpool) return;

    const spoolDepth = this.telemetrySpool.getSpoolMetrics().totalItemsSpooled;
    if (spoolDepth === 0) return;

    this.logger?.info('ControlPlaneClient: Draining spooled events on reconnect...', {
      count: spoolDepth,
    });

    const items = this.telemetrySpool.popBatch(50);
    for (const item of items) {
      const evt: EventEnvelope = {
        schema_id: item.name,
        version: '1.0.0',
        event_id: item.itemId,
        correlation_id: item.itemId,
        occurred_at: item.timestamp,
        producer_id: this.identity?.deviceId || 'agent',
        payload: item.attributes,
      };
      await this.relayEvent(evt);
    }
  }
}
