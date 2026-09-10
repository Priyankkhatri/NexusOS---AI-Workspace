import crypto from 'node:crypto';
import {
  SubAgentDelegationRequest,
  SubAgentDelegationRequestInput,
  SubAgentDelegationRequestSchema,
  SubAgentDelegationResponse,
  SubAgentDelegationResponseSchema,
  CompositeExecutionReceipt,
  CompositeExecutionReceiptSchema,
  ExecutionReceipt,
  ExecutionLeaseHeader,
  DelegatedLeaseHeader,
  DelegationStatus,
  DelegationSummary,
  DELEGATION_SAFETY_LIMITS,
} from '@nexusos/contracts';
import { AgentDirectoryService } from './agent-directory.js';
import { verifyScopeAttenuation } from './attenuation.js';
import { LeaseIssuer } from '../leases/lease-issuer.js';

export interface DelegationSession {
  delegationId: string;
  parentTaskId: string;
  parentLeaseId: string;
  childTaskId: string;
  childLease: DelegatedLeaseHeader;
  delegatorAgentId: string;
  assignedAgentId: string;
  tenantId: string;
  workspaceId: string;
  depth: number;
  status: DelegationStatus;
  requestedScopes: string[];
  expiresAt: number; // Unix timestamp ms
  idempotencyKey: string;
  correlationId: string;
  compensationPayload?: Record<string, unknown>;
  childReceipt?: ExecutionReceipt;
  rejectionReason?: string;
}

export interface DelegationCoordinatorOptions {
  agentDirectory: AgentDirectoryService;
  leaseIssuer: LeaseIssuer;
  maxDepth?: number;
  maxFanOut?: number;
}

/**
 * Autonomous Sub-Agent Delegation Coordinator (Task 060)
 * Coordinates bounded, attenuated sub-agent task delegations under strict lease & policy governance.
 */
export class DelegationCoordinator {
  private readonly agentDirectory: AgentDirectoryService;
  private readonly leaseIssuer: LeaseIssuer;
  private readonly maxDepth: number;
  private readonly maxFanOut: number;

  // Active delegation sessions indexed by delegationId
  private readonly sessions = new Map<string, DelegationSession>();
  // Index: parentTaskId -> Set of delegationIds
  private readonly parentToChildren = new Map<string, Set<string>>();
  // Index: childTaskId -> delegationId
  private readonly childToSession = new Map<string, string>();
  // Idempotency cache: `${parentTaskId}::${idempotencyKey}` -> delegationId
  private readonly idempotencyCache = new Map<string, string>();
  // Revoked parent tasks/leases (060-SEC-07)
  private readonly revokedTasks = new Set<string>();

  constructor(options: DelegationCoordinatorOptions) {
    this.agentDirectory = options.agentDirectory;
    this.leaseIssuer = options.leaseIssuer;
    this.maxDepth = options.maxDepth ?? DELEGATION_SAFETY_LIMITS.MAX_DEPTH;
    this.maxFanOut = options.maxFanOut ?? DELEGATION_SAFETY_LIMITS.MAX_FAN_OUT;
  }

  /**
   * Delegates a sub-goal to a specialized child agent with an attenuated lease (060-SEC-01..04)
   */
  public async delegateSubTask(
    request: SubAgentDelegationRequest | SubAgentDelegationRequestInput,
    parentLease: ExecutionLeaseHeader | DelegatedLeaseHeader,
  ): Promise<SubAgentDelegationResponse> {
    const validatedReq = SubAgentDelegationRequestSchema.parse(request);

    // 0. Check for parent task revocation (060-SEC-07)
    if (this.revokedTasks.has(validatedReq.parentTaskId)) {
      throw new Error(
        `Cannot delegate: Parent task ${validatedReq.parentTaskId} has been cancelled or revoked.`,
      );
    }

    // 1. Idempotency Check
    const idempotencyKey = `${validatedReq.parentTaskId}::${validatedReq.idempotencyKey}`;
    const existingSessionId = this.idempotencyCache.get(idempotencyKey);
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId);
      if (existing) {
        return SubAgentDelegationResponseSchema.parse({
          delegationId: existing.delegationId,
          parentTaskId: existing.parentTaskId,
          childTaskId: existing.childTaskId,
          childLeaseId: existing.childLease.lease_id,
          assignedAgentId: existing.assignedAgentId,
          tenantId: existing.tenantId,
          workspaceId: existing.workspaceId,
          status: existing.status,
          delegationDepth: existing.depth,
          acceptedAt: new Date(existing.childLease.issued_at).toISOString(),
        });
      }
    }

    // 2. Parent Lease Verification (060-SEC-04)
    const isParentDelegated = 'parent_lease_id' in parentLease;
    const isParentSigValid = isParentDelegated
      ? this.leaseIssuer.verifyDelegatedLease(parentLease as DelegatedLeaseHeader)
      : this.leaseIssuer.verifyLease(parentLease);

    if (!isParentSigValid) {
      throw new Error('Cannot delegate: Parent execution lease signature is invalid or forged.');
    }

    // 3. Parent Expiry & Task Binding Check
    const now = Date.now();
    const parentExpiresAt = new Date(parentLease.expires_at).getTime();
    if (now >= parentExpiresAt) {
      throw new Error('Cannot delegate: Parent execution lease has expired.');
    }
    if (parentLease.task_id !== validatedReq.parentTaskId) {
      throw new Error(
        `Cannot delegate: Parent task ID mismatch (lease: ${parentLease.task_id}, request: ${validatedReq.parentTaskId}).`,
      );
    }

    // 4. Strict Tenant Isolation (060-SEC-03)
    if (validatedReq.tenantId !== parentLease.tenant_id) {
      throw new Error(
        `Cross-tenant delegation forbidden: Parent tenant ${parentLease.tenant_id} does not match request tenant ${validatedReq.tenantId}.`,
      );
    }

    // 5. Delegation Depth Limit Check (060-SEC-02)
    if (validatedReq.delegationDepth > this.maxDepth) {
      throw new Error(
        `Recursive delegation limit exceeded: Depth ${validatedReq.delegationDepth} exceeds maximum allowed depth of ${this.maxDepth}.`,
      );
    }

    if (isParentDelegated) {
      const parentDepth = (parentLease as DelegatedLeaseHeader).delegation_depth;
      if (validatedReq.delegationDepth !== parentDepth + 1) {
        throw new Error(
          `Invalid delegation depth sequence: Parent depth ${parentDepth}, child requested depth ${validatedReq.delegationDepth}.`,
        );
      }
    } else if (validatedReq.delegationDepth !== 1) {
      throw new Error(
        `Root delegation must have depth 1 (requested: ${validatedReq.delegationDepth}).`,
      );
    }

    // 6. Fan-Out Concurrency Limit Check (Atomic check to prevent race conditions) (060-SEC-02)
    const existingChildren = this.parentToChildren.get(validatedReq.parentTaskId) ?? new Set();
    // Count active non-terminal children
    let activeChildCount = 0;
    for (const childDelegationId of existingChildren) {
      const session = this.sessions.get(childDelegationId);
      if (
        session &&
        session.status !== 'COMPLETED' &&
        session.status !== 'FAILED' &&
        session.status !== 'CANCELLED' &&
        session.status !== 'TIMED_OUT'
      ) {
        activeChildCount++;
      }
    }

    if (activeChildCount >= this.maxFanOut) {
      throw new Error(
        `Child fan-out limit exceeded: Parent task ${validatedReq.parentTaskId} already has ${activeChildCount} active child tasks (max: ${this.maxFanOut}).`,
      );
    }

    // 7. Scope Attenuation Verification (060-SEC-01)
    const attenuation = verifyScopeAttenuation(parentLease.scopes, validatedReq.requestedScopes);
    if (!attenuation.valid) {
      throw new Error(
        `Privilege escalation forbidden: Child scopes must be a subset of parent scopes. ${attenuation.errorMessage}`,
      );
    }

    // 8. Target Agent Discovery & Health Check (060-SEC-03)
    const targetAgent = this.agentDirectory.getAgent(
      validatedReq.tenantId,
      validatedReq.targetAgentId,
    );
    if (!targetAgent) {
      throw new Error(
        `Target agent ${validatedReq.targetAgentId} is not registered or not in tenant ${validatedReq.tenantId}.`,
      );
    }

    const hasWorkspaceAccess =
      targetAgent.workspaceScope.includes('*') ||
      targetAgent.workspaceScope.includes(validatedReq.workspaceId);
    if (!hasWorkspaceAccess) {
      throw new Error(
        `Target agent ${validatedReq.targetAgentId} does not have authorized access to workspace ${validatedReq.workspaceId}.`,
      );
    }

    // 9. Issue Attenuated Child Lease
    const childTaskId = crypto.randomUUID();
    const childLease = this.leaseIssuer.issueDelegatedLease({
      parentLease,
      parentTaskId: validatedReq.parentTaskId,
      childTaskId,
      childAgentId: validatedReq.targetAgentId,
      tenantId: validatedReq.tenantId,
      workspaceId: validatedReq.workspaceId,
      attenuatedScopes: validatedReq.requestedScopes,
      delegationDepth: validatedReq.delegationDepth,
      ttlSeconds: Math.floor(validatedReq.timeoutMs / 1000),
    });

    // 10. Record Delegation Session
    const session: DelegationSession = {
      delegationId: validatedReq.delegationId,
      parentTaskId: validatedReq.parentTaskId,
      parentLeaseId: parentLease.lease_id,
      childTaskId,
      childLease,
      delegatorAgentId: validatedReq.delegatorAgentId,
      assignedAgentId: validatedReq.targetAgentId,
      tenantId: validatedReq.tenantId,
      workspaceId: validatedReq.workspaceId,
      depth: validatedReq.delegationDepth,
      status: 'ACCEPTED',
      requestedScopes: validatedReq.requestedScopes,
      expiresAt: new Date(childLease.expires_at).getTime(),
      idempotencyKey: validatedReq.idempotencyKey,
      correlationId: validatedReq.correlationId,
      compensationPayload: validatedReq.compensationPayload,
    };

    this.sessions.set(session.delegationId, session);
    existingChildren.add(session.delegationId);
    this.parentToChildren.set(validatedReq.parentTaskId, existingChildren);
    this.childToSession.set(childTaskId, session.delegationId);
    this.idempotencyCache.set(idempotencyKey, session.delegationId);

    return SubAgentDelegationResponseSchema.parse({
      delegationId: session.delegationId,
      parentTaskId: session.parentTaskId,
      childTaskId: session.childTaskId,
      childLeaseId: session.childLease.lease_id,
      assignedAgentId: session.assignedAgentId,
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      status: session.status,
      delegationDepth: session.depth,
      acceptedAt: new Date(session.childLease.issued_at).toISOString(),
    });
  }

  /**
   * Settles a child execution receipt into the delegation session (060-SEC-06)
   */
  public settleChildReceipt(childReceipt: ExecutionReceipt): {
    valid: boolean;
    error?: string;
  } {
    const delegationId = this.childToSession.get(childReceipt.taskId);
    if (!delegationId) {
      return {
        valid: false,
        error: `No active delegation session found for child task ${childReceipt.taskId}.`,
      };
    }

    const session = this.sessions.get(delegationId);
    if (!session) {
      return { valid: false, error: `Delegation session ${delegationId} not found.` };
    }

    // Check if parent or session was cancelled / revoked (060-SEC-07)
    if (this.revokedTasks.has(session.parentTaskId) || session.status === 'CANCELLED') {
      return {
        valid: false,
        error: 'Late child receipt rejected: Parent task or delegation was cancelled.',
      };
    }

    // Verify lease ID matches
    if (childReceipt.leaseId !== session.childLease.lease_id) {
      return {
        valid: false,
        error: 'Child receipt lease ID mismatch with issued child lease.',
      };
    }

    // Verify tenant matches
    if (childReceipt.tenantId !== session.tenantId) {
      return { valid: false, error: 'Child receipt tenant ID mismatch.' };
    }

    // Verify child receipt signature is present and not empty
    if (!childReceipt.signature || childReceipt.signature.trim() === '') {
      return { valid: false, error: 'Child receipt is unsigned or missing signature.' };
    }

    // Verify timeout
    if (Date.now() > session.expiresAt) {
      session.status = 'TIMED_OUT';
      return { valid: false, error: 'Child task timed out before receipt settlement.' };
    }

    session.childReceipt = childReceipt;
    session.status = childReceipt.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED';

    return { valid: true };
  }

  /**
   * Generates a verified composite execution receipt rolling up all child receipts (060-SEC-06)
   */
  public generateCompositeReceipt(params: {
    parentTaskId: string;
    parentLeaseId: string;
    tenantId: string;
    workspaceId: string;
    coordinatorAgentId: string;
    output?: Record<string, unknown>;
    errorMessage?: string;
  }): CompositeExecutionReceipt {
    const childDelegationIds = this.parentToChildren.get(params.parentTaskId) ?? new Set();
    const verifiedChildReceipts: ExecutionReceipt[] = [];

    let hasFailure = false;
    let hasCompensation = false;

    for (const delegationId of childDelegationIds) {
      const session = this.sessions.get(delegationId);
      if (session?.childReceipt) {
        verifiedChildReceipts.push(session.childReceipt);
        if (session.childReceipt.status !== 'SUCCESS') {
          hasFailure = true;
          if (session.compensationPayload) {
            hasCompensation = true;
          }
        }
      } else if (session?.status === 'FAILED' || session?.status === 'TIMED_OUT') {
        hasFailure = true;
        if (session.compensationPayload) {
          hasCompensation = true;
        }
      }
    }

    // Calculate Merkle / roll-up checksum over child receipts (060-SEC-06)
    const receiptChecksums = verifiedChildReceipts
      .map((r) => `${r.taskId}:${r.status}:${r.evidenceChecksum}`)
      .sort()
      .join('|');
    const evidenceTreeHash = crypto
      .createHash('sha256')
      .update(`${params.parentTaskId}:${evidenceTreeHashPayload(receiptChecksums, params.output)}`)
      .digest('hex');

    let compositeStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PARTIAL_COMPENSATION' = 'SUCCESS';
    if (this.revokedTasks.has(params.parentTaskId)) {
      compositeStatus = 'CANCELLED';
    } else if (hasFailure) {
      compositeStatus = hasCompensation ? 'PARTIAL_COMPENSATION' : 'FAILED';
    }

    const receiptId = crypto.randomUUID();
    const completedAt = new Date().toISOString();

    // Compute composite HMAC signature
    const signaturePayload = [
      receiptId,
      params.parentTaskId,
      params.parentLeaseId,
      params.tenantId,
      compositeStatus,
      evidenceTreeHash,
      completedAt,
    ].join(':');

    // Use leaseIssuer secret to sign composite receipt
    const signature = crypto
      .createHmac('sha256', (this.leaseIssuer as unknown as { secretKey: string }).secretKey)
      .update(signaturePayload)
      .digest('hex');

    return CompositeExecutionReceiptSchema.parse({
      receiptId,
      parentTaskId: params.parentTaskId,
      parentLeaseId: params.parentLeaseId,
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      coordinatorAgentId: params.coordinatorAgentId,
      status: compositeStatus,
      childReceipts: verifiedChildReceipts,
      evidenceTreeHash,
      output: params.output,
      errorMessage: params.errorMessage,
      completedAt,
      signature,
    });
  }

  /**
   * Cascade cancellation of parent task and all descendants (060-SEC-07)
   */
  public cancelDelegation(parentTaskId: string): {
    cancelledChildTaskIds: string[];
  } {
    this.revokedTasks.add(parentTaskId);
    const cancelledChildTaskIds: string[] = [];

    const queue = [parentTaskId];
    while (queue.length > 0) {
      const currentParentId = queue.shift()!;
      const childDelegationIds = this.parentToChildren.get(currentParentId) ?? new Set();

      for (const delId of childDelegationIds) {
        const session = this.sessions.get(delId);
        if (session && session.status !== 'COMPLETED' && session.status !== 'CANCELLED') {
          session.status = 'CANCELLED';
          cancelledChildTaskIds.push(session.childTaskId);
          // Revoke the child task as well so any sub-children are cancelled
          this.revokedTasks.add(session.childTaskId);
          queue.push(session.childTaskId);
        }
      }
    }

    return { cancelledChildTaskIds };
  }

  /**
   * Handles child failure and returns localized compensation payload (if defined)
   */
  public handleChildFailure(
    childTaskId: string,
    error: string,
  ): {
    compensated: boolean;
    compensationPayload?: Record<string, unknown>;
  } {
    const delegationId = this.childToSession.get(childTaskId);
    if (!delegationId) {
      return { compensated: false };
    }

    const session = this.sessions.get(delegationId);
    if (!session) {
      return { compensated: false };
    }

    session.status = 'FAILED';
    session.rejectionReason = error;

    if (session.compensationPayload) {
      return {
        compensated: true,
        compensationPayload: session.compensationPayload,
      };
    }

    return { compensated: false };
  }

  public getSession(delegationId: string): DelegationSession | undefined {
    const session = this.sessions.get(delegationId);
    return session ? { ...session } : undefined;
  }

  public getSessionByChildTask(childTaskId: string): DelegationSession | undefined {
    const delegationId = this.childToSession.get(childTaskId);
    if (!delegationId) return undefined;
    return this.getSession(delegationId);
  }

  public getActiveChildCount(parentTaskId: string): number {
    const children = this.parentToChildren.get(parentTaskId) ?? new Set();
    let count = 0;
    for (const delId of children) {
      const s = this.sessions.get(delId);
      if (
        s &&
        s.status !== 'COMPLETED' &&
        s.status !== 'FAILED' &&
        s.status !== 'CANCELLED' &&
        s.status !== 'TIMED_OUT'
      ) {
        count++;
      }
    }
    return count;
  }

  /**
   * Lists delegation sessions for a tenant (Dashboard read projection, strictly isolated)
   * 063-SEC-02: Scoped to tenantId and optional workspaceId.
   * 063-SEC-04: Excludes HMAC lease signatures and private credentials.
   */
  public listSessions(
    tenantId: string,
    options?: {
      parentTaskId?: string;
      workspaceId?: string;
      status?: DelegationStatus;
      limit?: number;
    },
  ): DelegationSummary[] {
    const results: DelegationSummary[] = [];
    const limit = Math.min(options?.limit ?? 50, 100);

    for (const session of this.sessions.values()) {
      if (session.tenantId !== tenantId) {
        continue;
      }
      if (options?.workspaceId && session.workspaceId !== options.workspaceId) {
        continue;
      }
      if (options?.parentTaskId && session.parentTaskId !== options.parentTaskId) {
        continue;
      }
      if (options?.status && session.status !== options.status) {
        continue;
      }

      results.push({
        delegationId: session.delegationId,
        parentTaskId: session.parentTaskId,
        parentLeaseId: session.parentLeaseId,
        childTaskId: session.childTaskId,
        childLeaseId: session.childLease.lease_id,
        delegatorAgentId: session.delegatorAgentId,
        assignedAgentId: session.assignedAgentId,
        tenantId: session.tenantId,
        workspaceId: session.workspaceId,
        depth: session.depth,
        status: session.status,
        requestedScopes: session.requestedScopes,
        expiresAt: session.expiresAt,
        correlationId: session.correlationId,
        rejectionReason: session.rejectionReason,
        hasCompensation: Boolean(session.compensationPayload),
        hasChildReceipt: Boolean(session.childReceipt),
      });

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  public clear(): void {
    this.sessions.clear();
    this.parentToChildren.clear();
    this.childToSession.clear();
    this.idempotencyCache.clear();
    this.revokedTasks.clear();
  }
}

function evidenceTreeHashPayload(
  receiptChecksums: string,
  output?: Record<string, unknown>,
): string {
  const outputStr = output ? JSON.stringify(output) : '';
  return `${receiptChecksums}#${outputStr}`;
}
