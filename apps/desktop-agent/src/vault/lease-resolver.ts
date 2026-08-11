import crypto from 'node:crypto';
import { ErrorCategory, createNexusOSError } from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { ISecretLeaseResolver, SecretLeasePayload, VaultOperationRequestContext } from './types.js';

/**
 * SecretLeaseResolver
 *
 * Resolves opaque secret references to short-lived, lease-bound, in-memory
 * payloads.  The resolved payload uses a mutable Node Buffer for the secret
 * value so it can be zeroized on revocation.
 *
 * ## Mock Vault Provider Boundary
 *
 * The internal `mockVaultStore` is a development/test-only substitute for a
 * real Secrets Vault backend (e.g. HashiCorp Vault, AWS Secrets Manager, or
 * the NexusOS Secrets Service).  It MUST NOT be used in production.
 *
 * A production implementation would replace the `mockVaultStore.get()` lookup
 * with an authenticated, TLS-protected call to the vault backend, receiving
 * an encrypted payload bound to the requesting agent and lease.
 *
 * ## V8 / Node.js Memory Limitations
 *
 * `Buffer.from(string)` creates a mutable copy in V8 external memory that CAN
 * be overwritten with `buffer.fill(0)`.  However, the source `entry.secretValue`
 * string is immutable in V8's intern pool and cannot be erased.  This is an
 * inherent platform limitation.  A production vault backend would deliver the
 * secret as a Buffer directly, avoiding the intermediate string representation.
 */
export class SecretLeaseResolver implements ISecretLeaseResolver {
  /**
   * MOCK ONLY — Development/test vault store.
   * Production implementations MUST replace this with a vault backend client.
   * @internal
   */
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
        'Secret reference is malformed or uses an invalid format.',
      );
    }

    // 2. Offline Governance Check
    //
    // The `protectedLocalLeaseValid` flag is set by an upstream component that
    // is responsible for verifying:
    //   - cryptographic integrity and authenticity of the cached lease
    //   - task/agent/device binding matches the current execution context
    //   - lease expiration has not passed
    //   - nonce is not replayed (anti-replay protection)
    //   - lease was not tampered with (signature verification)
    //
    // This resolver does NOT re-verify those properties; it trusts the upstream
    // boundary to have already done so before setting the flag.  A false value
    // or absence of the flag causes fail-closed denial.
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
        'Lease does not grant capability scope for the requested secret reference.',
      );
    }

    // 5. Vault Backend Lookup (MOCK — see class-level documentation)
    const entry = this.mockVaultStore.get(referenceString);
    if (!entry) {
      throw createNexusOSError(
        'SECRET_REFERENCE_INVALID',
        ErrorCategory.VALIDATION,
        'Secret reference not found in vault registry.',
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
