import { ExecutionLeaseHeaderSchema, ExecutionLeaseHeader } from '@nexusos/contracts';
import { PolicyEvaluator, ReferencePolicyEvaluator, loadPolicyConfig } from '@nexusos/policy';
import { AuthenticatedContext } from '@nexusos/identity';

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
  ) {}

  async validateLease(
    rawLease: unknown,
    subject?: AuthenticatedContext,
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

    // 2. Validate Lease Expiration (expires_at is ISO datetime string)
    const expiresAtMs = new Date(lease.expires_at).getTime();
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
      return {
        valid: false,
        reason: `LEASE_EXPIRED: Lease expired at ${lease.expires_at}.`,
      };
    }

    // 3. Evaluate Policy Decision
    const decision = await this.policyEvaluator.evaluate({
      subject,
      action: {
        actionName: 'lease:execute',
        requiredScope: lease.scopes[0],
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
