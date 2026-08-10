import { AgentIdentity } from '../identity/agent-identity.js';

export interface HeartbeatPayload {
  deviceId: string;
  tenantId: string;
  status: string;
  agentVersion: string;
  activeLeasesCount: number;
  timestamp: string;
}

export interface RegistrationHandshakeResult {
  accepted: boolean;
  sessionToken?: string;
  controlPlaneVersion: string;
  assignedChannel?: string;
  rejectReason?: string;
}

export interface ControlPlaneClient {
  registerAgent(
    identity: AgentIdentity,
    capabilities: string[],
  ): Promise<RegistrationHandshakeResult>;
  sendHeartbeat(payload: HeartbeatPayload): Promise<boolean>;
  disconnect(): Promise<void>;
}

export class MockControlPlaneClient implements ControlPlaneClient {
  private connected = false;

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

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
