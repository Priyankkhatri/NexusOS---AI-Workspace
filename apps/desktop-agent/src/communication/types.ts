import { EventEnvelope, ACPMessageEnvelope } from '@nexusos/contracts';
import { AgentIdentity } from '../identity/agent-identity.js';

export enum ConnectionState {
  UNPAIRED = 'UNPAIRED',
  PAIRING = 'PAIRING',
  CONNECTING = 'CONNECTING',
  REGISTERING = 'REGISTERING',
  CONNECTED_ACTIVE = 'CONNECTED_ACTIVE',
  DEGRADED = 'DEGRADED',
  OFFLINE = 'OFFLINE',
  REVOKED = 'REVOKED',
}

export interface ControlPlaneConfig {
  gatewayUrl: string;
  heartbeatIntervalMs: number;
  idleTimeoutMs: number;
  maxFrameSizeBytes: number;
  maxSpoolSizeBytes: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectMultiplier: number;
  tlsClientCertPath?: string;
  tlsClientKeyPath?: string;
  tlsCaPath?: string;
}

export interface QueueSpoolState {
  queuedEventsCount: number;
  spoolSizeBytes: number;
}

export interface ResourcePosture {
  cpuUsagePercent?: number;
  memoryWorkingSetBytes?: number;
}

export interface HeartbeatPayload {
  deviceId: string;
  tenantId: string;
  status: string;
  agentVersion: string;
  activeLeasesCount: number;
  queueSpoolState?: QueueSpoolState;
  resourcePosture?: ResourcePosture;
  timestamp: string;
}

export interface RegistrationHandshakeResult {
  accepted: boolean;
  sessionToken?: string;
  controlPlaneVersion: string;
  assignedChannel?: string;
  rejectReason?: string;
}

export interface ControlPlaneTransportAdapter {
  connect(url: string, options?: { cert?: string; key?: string; ca?: string }): Promise<void>;
  send(frame: string | Uint8Array): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  onMessage(callback: (data: string | Uint8Array) => void): void;
  onError(callback: (err: Error) => void): void;
  onClose(callback: (code: number, reason: string) => void): void;
  isConnected(): boolean;
}

export interface EventRelayResult {
  success: boolean;
  ackedSequence?: number;
  error?: string;
}

export interface ControlPlaneClient {
  start(): Promise<void>;
  registerAgent(
    identity: AgentIdentity,
    capabilities: string[],
  ): Promise<RegistrationHandshakeResult>;
  sendHeartbeat(payload: HeartbeatPayload): Promise<boolean>;
  relayEvent(envelope: EventEnvelope): Promise<EventRelayResult>;
  getConnectionState(): ConnectionState;
  registerCommandHandler?(handler: (envelope: ACPMessageEnvelope) => Promise<void>): void;
  disconnect(): Promise<void>;
}
