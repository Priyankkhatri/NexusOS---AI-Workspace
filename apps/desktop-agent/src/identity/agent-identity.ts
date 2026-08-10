import crypto from 'node:crypto';
import { DeviceId, TenantId } from '@nexusos/contracts';

export interface AgentIdentity {
  deviceId: DeviceId;

  /**
   * Deterministic software-derived device identifier.
   * Computed as SHA-256 of the configured deviceId.
   *
   * THIS IS NOT hardware attestation. It does not prove:
   * - physical hardware identity
   * - TPM-backed key binding
   * - machine authenticity
   *
   * Future phases may introduce hardware-backed identity via
   * Windows TPM 2.0, device-bound credentials, or platform
   * attestation APIs. See `verifyHardwareAttestation()`.
   */
  deviceFingerprint: string;

  pairedTenantId: TenantId;
  agentVersion: string;
  enrolledAt: string;
}

export enum HardwareAttestationStatus {
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
}

export interface HardwareAttestationResult {
  status: HardwareAttestationStatus;
  reason: string;
}

export interface AgentIdentityProvider {
  getIdentity(): Promise<AgentIdentity>;

  /**
   * Hardware attestation boundary.
   *
   * In the foundation layer, this MUST return NOT_IMPLEMENTED.
   * Future implementations may bind to Windows TPM 2.0, device-bound
   * credentials, or platform attestation APIs.
   *
   * Callers MUST NOT treat NOT_IMPLEMENTED as equivalent to VERIFIED.
   */
  verifyHardwareAttestation(): Promise<HardwareAttestationResult>;
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
      // Software-derived fingerprint — NOT hardware attestation.
      // See AgentIdentity.deviceFingerprint documentation.
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

  async verifyHardwareAttestation(): Promise<HardwareAttestationResult> {
    // Foundation layer: hardware attestation is not yet implemented.
    // Future phases will integrate Windows TPM 2.0 / device-bound credentials.
    // Callers MUST NOT treat this as VERIFIED.
    return {
      status: HardwareAttestationStatus.NOT_IMPLEMENTED,
      reason:
        'Hardware attestation is not available in the foundation layer. TPM 2.0 integration is planned for a future phase.',
    };
  }
}
