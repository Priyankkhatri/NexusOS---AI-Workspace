import { AgentIdentityProvider } from '../identity/agent-identity.js';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { AgentLifecycleState } from '../lifecycle/index.js';
import { TaskExecutionRequest } from '../orchestrator/types.js';

export interface AdmissionDecision {
  admitted: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export class TaskAdmissionController {
  constructor(
    private readonly identityProvider: AgentIdentityProvider,
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
  ) {}

  public async evaluateAdmission(request: TaskExecutionRequest): Promise<AdmissionDecision> {
    // 1. Lifecycle Gate Check
    if (this.getAgentLifecycleState) {
      const state = this.getAgentLifecycleState();
      if (
        state === AgentLifecycleState.STOPPING ||
        state === AgentLifecycleState.STOPPED ||
        state === AgentLifecycleState.FAILED
      ) {
        return {
          admitted: false,
          errorCode: 'LIFECYCLE_DENIED',
          errorMessage: 'Agent lifecycle state is unsafe for task admission.',
        };
      }
    }

    // 2. Lease Signature & Policy Validation
    const leaseDecision = await this.leaseBoundary.validateLease(request.leaseHeader, undefined);

    if (!leaseDecision.valid) {
      return {
        admitted: false,
        errorCode: 'LEASE_DENIED',
        errorMessage: leaseDecision.reason || 'Execution lease validation failed.',
      };
    }

    // 3. Tenant & Device Context Binding
    const identity = await this.identityProvider.getIdentity();
    if (
      request.leaseHeader.agent_id !== identity.deviceId ||
      request.leaseHeader.tenant_id !== identity.pairedTenantId
    ) {
      return {
        admitted: false,
        errorCode: 'TENANT_DEVICE_MISMATCH',
        errorMessage: 'Lease target device or tenant does not match agent identity.',
      };
    }

    return { admitted: true };
  }
}
