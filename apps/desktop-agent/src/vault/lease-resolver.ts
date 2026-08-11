import crypto from 'node:crypto';
import { ErrorCategory, createNexusOSError } from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { ISecretLeaseResolver, SecretLeasePayload, VaultOperationRequestContext } from './types.js';

export class SecretLeaseResolver implements ISecretLeaseResolver {
  private readonly mockVaultStore = new Map<string, { secretName: string; secretValue: string }>();

  constructor(private readonly leaseBoundary: ExecutionLeaseBoundary) {
    // Seed initial test secret references safely for unit testing
    this.mockVaultStore.set('vault:sec_ref_db_password', {
      secretName: 'DATABASE_PASSWORD',
      secretValue: 'P@ssw0rd123_Secret_Db_Key!',
    });
    this.mockVaultStore.set('vault:sec_ref_api_token', {
      secretName: 'GITHUB_API_TOKEN',
      secretValue: 'mock_token_1234567890abcdefghijklmnopqrstuvwxyz',
    });
  }

  public async resolveSecret(
    referenceString: string,
    context: VaultOperationRequestContext,
  ): Promise<SecretLeasePayload> {
    // 1. Opaque Reference Format Check
    if (
      !referenceString ||
      typeof referenceString !== 'string' ||
      !referenceString.startsWith('vault:sec_ref_')
    ) {
      throw createNexusOSError(
        'SECRET_REFERENCE_INVALID',
        ErrorCategory.VALIDATION,
        `Secret reference '${referenceString}' is malformed or invalid format.`,
      );
    }

    // 2. Offline Governance Check
    if (context.isOffline && !context.protectedLocalLeaseValid) {
      throw createNexusOSError(
        'OFFLINE_SECRET_UNAVAILABLE',
        ErrorCategory.AUTHORIZATION,
        'Offline secret access is unavailable without a valid protected local lease.',
      );
    }

    // 3. Execution Lease Authorization Check
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      throw createNexusOSError(
        'LEASE_OR_POLICY_INVALID',
        ErrorCategory.AUTHORIZATION,
        leaseResult.reason || 'Execution lease validation failed for secret resolution.',
      );
    }

    // 4. Secret Scope Verification
    const grantedScopes = context.lease.scopes || [];
    if (!grantedScopes.includes('secret:read') && !grantedScopes.includes(referenceString)) {
      throw createNexusOSError(
        'UNAUTHORIZED_SECRET_ACCESS',
        ErrorCategory.AUTHORIZATION,
        `Lease does not grant capability scope for secret reference '${referenceString}'.`,
      );
    }

    // 5. Vault Backend Lookup
    const entry = this.mockVaultStore.get(referenceString);
    if (!entry) {
      throw createNexusOSError(
        'SECRET_REFERENCE_INVALID',
        ErrorCategory.VALIDATION,
        `Secret reference '${referenceString}' not found in vault registry.`,
      );
    }

    // 6. Allocate Payload Buffer in Memory with TTL
    const payloadBuffer = Buffer.from(entry.secretValue, 'utf-8');
    const fingerprintId = crypto
      .createHash('sha256')
      .update(payloadBuffer)
      .digest('hex')
      .slice(0, 16);
    const expiresAt = new Date(Date.now() + 300_000).toISOString(); // 5 min TTL

    return {
      referenceId: referenceString,
      secretName: entry.secretName,
      payloadBuffer,
      fingerprintId,
      expiresAt,
      isRevoked: false,
    };
  }
}
