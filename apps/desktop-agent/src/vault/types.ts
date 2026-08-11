import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';

export enum VaultOperationName {
  RESOLVE = 'vault:resolve',
  INJECT = 'vault:inject',
  REVOKE = 'vault:revoke',
}

export type InjectionChannel = 'TERMINAL' | 'BROWSER' | 'PLUGIN';

export interface SecretReference {
  referenceId: string;
  taskId: string;
  agentId: string;
  leaseId: string;
  secretName: string;
  scope: string;
}

export interface SecretLeasePayload {
  referenceId: string;
  secretName: string;
  /** Mutable secret buffer allocated in Node memory */
  payloadBuffer: Buffer;
  fingerprintId: string;
  expiresAt: string;
  isRevoked: boolean;
}

export interface VaultOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: AuthenticatedContext;
  allowedRoots: string[];
  isOffline?: boolean;
  /**
   * Indicates whether a valid, cryptographically protected local lease exists
   * for offline secret access.
   *
   * The upstream component setting this flag MUST have verified:
   *   1. Cryptographic integrity and authenticity (e.g. HMAC or signature)
   *   2. Task/agent/device binding matches the current execution context
   *   3. Lease expiration timestamp has not passed
   *   4. Nonce is not replayed (anti-replay protection)
   *   5. Lease was not tampered with (signature verification)
   *   6. Lease is not stale (freshness check against last known control-plane state)
   *   7. Cross-task reuse is prohibited (lease is bound to a single task execution)
   *
   * A bare boolean is used because this resolver does NOT re-validate the
   * protected lease — it trusts the upstream boundary to have already verified
   * these properties.  Fail-closed: absence or false value denies access.
   *
   * IMPORTANT: Merely possessing a local cache file MUST NOT enable offline
   * secret access.  The upstream component must cryptographically verify the
   * file's contents against all the criteria listed above.
   */
  protectedLocalLeaseValid?: boolean;
}

export interface VaultOperationResult<T = unknown> {
  success: boolean;
  operation: VaultOperationName;
  referenceId?: string;
  data?: T;
  evidenceId: string;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}

export interface InjectionResult {
  injected: boolean;
  channel: InjectionChannel;
  targetId: string;
  fingerprintId: string;
  error?: string;
}

/**
 * Required EDD Interfaces (EDD Section 3.9)
 */
export interface ISecretLeaseResolver {
  resolveSecret(
    referenceString: string,
    context: VaultOperationRequestContext,
  ): Promise<SecretLeasePayload>;
}

export interface ISecretInjector {
  injectTerminalSecret(
    payload: SecretLeasePayload,
    targetProcessId: string,
    context: VaultOperationRequestContext,
  ): Promise<InjectionResult>;

  injectBrowserSecret(
    payload: SecretLeasePayload,
    targetSessionId: string,
    context: VaultOperationRequestContext,
  ): Promise<InjectionResult>;

  injectPluginSecret(
    payload: SecretLeasePayload,
    targetPluginId: string,
    context: VaultOperationRequestContext,
  ): Promise<InjectionResult>;
}

export interface ISecretRedactionRegistry {
  registerSecret(secretValue: string | Buffer, fingerprintId: string): void;
  redactText(input: string): string;
  unregisterSecret(fingerprintId: string): void;
  isRegistered(fingerprintId: string): boolean;
}

export interface ISecretRevocationHandler {
  revokeSecretLease(referenceId: string): boolean;
  isRevoked(referenceId: string): boolean;
}
