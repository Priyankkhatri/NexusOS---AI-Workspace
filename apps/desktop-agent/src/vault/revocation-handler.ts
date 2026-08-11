import { ISecretRevocationHandler, SecretLeasePayload } from './types.js';

export class SecretRevocationHandler implements ISecretRevocationHandler {
  private readonly revokedReferences = new Set<string>();

  public revokeSecretLease(referenceId: string): boolean {
    if (!referenceId) return false;
    this.revokedReferences.add(referenceId);
    return true;
  }

  public isRevoked(referenceId: string): boolean {
    return this.revokedReferences.has(referenceId);
  }

  /**
   * Overwrites/zeroizes mutable Node Buffer memory allocated for secret payloads.
   */
  public zeroizePayloadBuffer(payload: SecretLeasePayload): void {
    if (payload && payload.payloadBuffer && Buffer.isBuffer(payload.payloadBuffer)) {
      payload.payloadBuffer.fill(0);
      payload.isRevoked = true;
    }
  }
}
