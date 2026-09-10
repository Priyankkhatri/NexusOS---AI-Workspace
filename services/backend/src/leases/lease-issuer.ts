import crypto from 'node:crypto';
import {
  ExecutionLeaseHeader,
  ExecutionLeaseHeaderSchema,
  DelegatedLeaseHeader,
  DelegatedLeaseHeaderSchema,
} from '@nexusos/contracts';
import { verifyScopeAttenuation } from '../agents/attenuation.js';

/**
 * Computes canonical HMAC-SHA256 signature over execution lease attributes
 */
export function computeLeaseSignature(
  lease: Omit<ExecutionLeaseHeader, 'signature'>,
  secret: string,
): string {
  const payload = [
    lease.lease_id,
    lease.task_id,
    lease.agent_id,
    lease.tenant_id,
    lease.issued_at,
    lease.expires_at,
    lease.scopes.join(','),
    lease.nonce ?? '',
    lease.policy_hash ?? '',
  ].join(':');

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies that an execution lease signature is authentic and non-tampered
 */
export function verifyLeaseSignature(lease: ExecutionLeaseHeader, secret: string): boolean {
  try {
    const expectedSignature = computeLeaseSignature(lease, secret);
    if (lease.signature.length !== expectedSignature.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(lease.signature, 'hex'),
      Buffer.from(expectedSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Computes canonical HMAC-SHA256 signature over delegated child lease attributes (060-SEC-01, 060-SEC-04)
 */
export function computeDelegatedLeaseSignature(
  lease: Omit<DelegatedLeaseHeader, 'signature'>,
  secret: string,
): string {
  const payload = [
    lease.lease_id,
    lease.task_id,
    lease.agent_id,
    lease.tenant_id,
    lease.parent_lease_id,
    lease.parent_task_id,
    lease.delegation_depth.toString(),
    lease.workspace_id,
    lease.issued_at,
    lease.expires_at,
    lease.scopes.join(','),
    lease.nonce ?? '',
    lease.policy_hash ?? '',
  ].join(':');

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies that a delegated child lease signature is authentic and non-tampered
 */
export function verifyDelegatedLeaseSignature(
  lease: DelegatedLeaseHeader,
  secret: string,
): boolean {
  try {
    const expectedSignature = computeDelegatedLeaseSignature(lease, secret);
    if (lease.signature.length !== expectedSignature.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(lease.signature, 'hex'),
      Buffer.from(expectedSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

export interface LeaseIssueParams {
  taskId: string;
  agentId: string;
  tenantId: string;
  scopes: string[];
  ttlSeconds?: number;
  policyHash?: string;
  nonce?: string;
}

export interface DelegatedLeaseIssueParams {
  parentLease: ExecutionLeaseHeader | DelegatedLeaseHeader;
  parentTaskId: string;
  childTaskId: string;
  childAgentId: string;
  tenantId: string;
  workspaceId: string;
  attenuatedScopes: string[];
  delegationDepth: number;
  ttlSeconds?: number;
  policyHash?: string;
  nonce?: string;
}

export interface LeaseIssuerOptions {
  leaseSecret: string;
  ttlSeconds?: number;
  defaultTtlSeconds?: number;
}

export class LeaseIssuer {
  private readonly secretKey: string;
  private readonly defaultTtlSeconds: number;

  constructor(secretKeyOrOptions: string | LeaseIssuerOptions, defaultTtlSeconds = 300) {
    if (typeof secretKeyOrOptions === 'object') {
      this.secretKey = secretKeyOrOptions.leaseSecret;
      this.defaultTtlSeconds =
        secretKeyOrOptions.ttlSeconds ?? secretKeyOrOptions.defaultTtlSeconds ?? 300;
    } else {
      this.secretKey = secretKeyOrOptions;
      this.defaultTtlSeconds = defaultTtlSeconds;
    }

    if (!this.secretKey || this.secretKey.length < 16) {
      throw new Error('LeaseIssuer requires a secret key of at least 16 characters.');
    }
  }

  public issueLease(params: LeaseIssueParams): ExecutionLeaseHeader {
    const now = new Date();
    const ttl = params.ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const unsignedLease: Omit<ExecutionLeaseHeader, 'signature'> = {
      lease_id: crypto.randomUUID(),
      task_id: params.taskId,
      agent_id: params.agentId,
      tenant_id: params.tenantId,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      scopes: params.scopes,
      nonce: params.nonce ?? crypto.randomUUID(),
      policy_hash: params.policyHash,
    };

    const signature = computeLeaseSignature(unsignedLease, this.secretKey);

    const fullLease: ExecutionLeaseHeader = {
      ...unsignedLease,
      signature,
    };

    return ExecutionLeaseHeaderSchema.parse(fullLease);
  }

  public verifyLease(lease: ExecutionLeaseHeader): boolean {
    return verifyLeaseSignature(lease, this.secretKey);
  }

  /**
   * Issues an attenuated delegated child execution lease (060-SEC-01, 060-SEC-02, 060-SEC-03)
   */
  public issueDelegatedLease(params: DelegatedLeaseIssueParams): DelegatedLeaseHeader {
    // 1. Verify parent lease signature
    const isParentDelegated = 'parent_lease_id' in params.parentLease;
    const isParentValid = isParentDelegated
      ? verifyDelegatedLeaseSignature(params.parentLease as DelegatedLeaseHeader, this.secretKey)
      : verifyLeaseSignature(params.parentLease, this.secretKey);

    if (!isParentValid) {
      throw new Error('Cannot issue child lease: Parent lease signature is invalid or forged.');
    }

    // 2. Verify parent expiry
    const now = new Date();
    const parentExpiresAt = new Date(params.parentLease.expires_at).getTime();
    if (now.getTime() >= parentExpiresAt) {
      throw new Error('Cannot issue child lease: Parent lease has expired.');
    }

    // 3. Verify tenant matching (060-SEC-03)
    if (params.tenantId !== params.parentLease.tenant_id) {
      throw new Error(
        `Cannot issue child lease: Tenant mismatch (parent: ${params.parentLease.tenant_id}, child: ${params.tenantId}).`,
      );
    }

    // 4. Verify task binding
    if (params.parentTaskId !== params.parentLease.task_id) {
      throw new Error(
        `Cannot issue child lease: Parent task ID mismatch (lease: ${params.parentLease.task_id}, request: ${params.parentTaskId}).`,
      );
    }

    // 5. Verify delegation depth (060-SEC-02)
    if (params.delegationDepth > 3 || params.delegationDepth < 1) {
      throw new Error(
        `Cannot issue child lease: Delegation depth ${params.delegationDepth} exceeds maximum depth limit of 3.`,
      );
    }

    // If parent is delegated, child depth must strictly equal parent.depth + 1
    if (isParentDelegated) {
      const parentDepth = (params.parentLease as DelegatedLeaseHeader).delegation_depth;
      if (params.delegationDepth !== parentDepth + 1) {
        throw new Error(
          `Cannot issue child lease: Invalid delegation depth sequence (parent depth: ${parentDepth}, child depth: ${params.delegationDepth}).`,
        );
      }
    }

    // 6. Verify scope attenuation: childScopes ⊆ parentScopes (060-SEC-01)
    const attenuation = verifyScopeAttenuation(params.parentLease.scopes, params.attenuatedScopes);
    if (!attenuation.valid) {
      throw new Error(
        `Cannot issue child lease: Scope escalation forbidden. ${attenuation.errorMessage}`,
      );
    }

    // 7. Calculate bounded child TTL (cannot exceed parent expiry)
    const requestedTtl = params.ttlSeconds ?? this.defaultTtlSeconds;
    const requestedExpiresAt = now.getTime() + requestedTtl * 1000;
    const effectiveExpiresAt = new Date(Math.min(requestedExpiresAt, parentExpiresAt));

    const unsignedChildLease: Omit<DelegatedLeaseHeader, 'signature'> = {
      lease_id: crypto.randomUUID(),
      task_id: params.childTaskId,
      agent_id: params.childAgentId,
      tenant_id: params.tenantId,
      parent_lease_id: params.parentLease.lease_id,
      parent_task_id: params.parentTaskId,
      delegation_depth: params.delegationDepth,
      workspace_id: params.workspaceId,
      issued_at: now.toISOString(),
      expires_at: effectiveExpiresAt.toISOString(),
      scopes: params.attenuatedScopes,
      nonce: params.nonce ?? crypto.randomUUID(),
      policy_hash: params.policyHash,
    };

    const signature = computeDelegatedLeaseSignature(unsignedChildLease, this.secretKey);

    const fullChildLease: DelegatedLeaseHeader = {
      ...unsignedChildLease,
      signature,
    };

    return DelegatedLeaseHeaderSchema.parse(fullChildLease);
  }

  public verifyDelegatedLease(lease: DelegatedLeaseHeader): boolean {
    return verifyDelegatedLeaseSignature(lease, this.secretKey);
  }
}
