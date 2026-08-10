import crypto from 'node:crypto';
import { DeviceId, TenantId } from '@nexusos/contracts';

export interface AgentIdentity {
  deviceId: DeviceId;
  deviceFingerprint: string;
  pairedTenantId: TenantId;
  agentVersion: string;
  enrolledAt: string;
}

export interface AgentIdentityProvider {
  getIdentity(): Promise<AgentIdentity>;
  verifyHardwareAttestation?(): Promise<boolean>;
}

export class DefaultAgentIdentityProvider implements AgentIdentityProvider {
  private cachedIdentity?: AgentIdentity;

  constructor(
    private readonly deviceId: DeviceId = crypto.randomUUID(),
    private readonly tenantId: TenantId = crypto.randomUUID(),
    private readonly agentVersion: string = '0.1.0-sprint0',
  ) {}

  async getIdentity(): Promise<AgentIdentity> {
    if (!this.cachedIdentity) {
      const fingerprint = crypto
        .createHash('sha256')
        .update(`device:${this.deviceId}:nexusos-desktop-agent-v1`)
        .digest('hex');

      this.cachedIdentity = Object.freeze({
        deviceId: this.deviceId,
        deviceFingerprint: fingerprint,
        pairedTenantId: this.tenantId,
        agentVersion: this.agentVersion,
        enrolledAt: new Date().toISOString(),
      });
    }

    return this.cachedIdentity;
  }

  async verifyHardwareAttestation(): Promise<boolean> {
    // Hardware attestation boundary for Windows TPM 2.0 / Device keys
    return true;
  }
}
