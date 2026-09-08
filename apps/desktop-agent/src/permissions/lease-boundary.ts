import { ExecutionLeaseHeaderSchema, ExecutionLeaseHeader } from '@nexusos/contracts';
import { PolicyEvaluator, ReferencePolicyEvaluator, loadPolicyConfig } from '@nexusos/policy';
import { AuthenticatedContext } from '@nexusos/identity';
import { verifyLeaseSignature } from '@nexusos/backend';

export interface LeaseValidationResult {
  valid: boolean;
  lease?: ExecutionLeaseHeader;
  reason?: string;
}

export class ExecutionLeaseBoundary {
  constructor(
    private readonly policyEvaluator: PolicyEvaluator = new ReferencePolicyEvaluator(
      loadPolicyConfig(),
    ),
    private readonly leaseSecret?: string,
  ) {}

  async validateLease(
    rawLease: unknown,
    subject?: AuthenticatedContext,
    requiredScope?: string,
  ): Promise<LeaseValidationResult> {
    // 1. Validate Schema
    let lease: ExecutionLeaseHeader;
    try {
      lease = ExecutionLeaseHeaderSchema.parse(rawLease);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid lease format.';
      return {
        valid: false,
        reason: `MALFORMED_LEASE: ${msg}`,
      };
    }

    // 2. Validate Lease Signature if leaseSecret is configured
    if (this.leaseSecret) {
      if (!verifyLeaseSignature(lease, this.leaseSecret)) {
        return {
          valid: false,
          reason:
            'INVALID_LEASE_SIGNATURE: Lease signature verification failed or signature tampered.',
        };
      }
    }

    // 3. Validate Tenant Context Binding
    if (subject && subject.tenantId && lease.tenant_id !== subject.tenantId) {
      return {
        valid: false,
        reason: `TENANT_MISMATCH: Lease tenant '${lease.tenant_id}' does not match subject tenant '${subject.tenantId}'.`,
      };
    }

    // 4. Validate Lease Expiration (expires_at is ISO datetime string)
    const expiresAtMs = new Date(lease.expires_at).getTime();
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
      return {
        valid: false,
        reason: `LEASE_EXPIRED: Lease expired at ${lease.expires_at}.`,
      };
    }

    // 5. Validate Capability / Scope Grant
    if (requiredScope && !lease.scopes.includes(requiredScope)) {
      return {
        valid: false,
        reason: `SCOPE_NOT_GRANTED: Required scope '${requiredScope}' not granted in lease scopes [${lease.scopes.join(', ')}].`,
      };
    }

    // 6. Evaluate Policy Decision
    const targetScope = requiredScope || lease.scopes[0];
    const effectiveSubject: AuthenticatedContext = subject ?? {
      principal: {
        type: 'DEVICE' as any,
        deviceId: lease.agent_id,
        tenantId: lease.tenant_id,
        scopes: lease.scopes,
      },
      tenantId: lease.tenant_id,
      issuedAt: lease.issued_at,
      expiresAt: lease.expires_at,
      rawTokenHash: lease.signature,
    };

    const decision = await this.policyEvaluator.evaluate({
      subject: effectiveSubject,
      action: {
        actionName: 'lease:execute',
        requiredScope: targetScope,
      },
      resource: {
        resourceType: 'agent-execution-plane',
        resourceId: lease.lease_id,
        tenantId: lease.tenant_id,
      },
      context: {
        requestId: lease.nonce ?? crypto.randomUUID(),
        correlationId: lease.nonce ?? crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    });

    if (!decision.allowed) {
      return {
        valid: false,
        reason: `POLICY_DENIED: ${decision.reason}`,
      };
    }

    return {
      valid: true,
      lease,
    };
  }
}
