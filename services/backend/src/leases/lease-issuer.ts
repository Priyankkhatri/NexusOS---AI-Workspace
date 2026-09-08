import crypto from 'node:crypto';
import { ExecutionLeaseHeader, ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

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

export interface LeaseIssueParams {
  taskId: string;
  agentId: string;
  tenantId: string;
  scopes: string[];
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
}
