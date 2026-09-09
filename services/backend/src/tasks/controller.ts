import crypto from 'node:crypto';
import {
  TaskCreateRequest,
  TaskCreateRequestSchema,
  TaskGraphCreateRequest,
  TaskGraphCreateRequestSchema,
  WorkflowDAG,
  WorkflowExecutionReceiptSchema,
  validateDAGTopology,
  TaskLifecycleState,
  TaskRecord,
  createEventEnvelope,
  ExecutionReceiptSchema,
  TaskQuery,
  ActivityQuery,
  DashboardSummary,
  EventEnvelope,
  ApprovalPromptItem,
  ApprovalPromptRequest,
  ApprovalDecisionRequest,
  ApprovalDecisionRequestSchema,
  ApprovalDecisionResult,
  PluginSummary,
  GoalDecompositionResponse,
  AdaptiveReplanResponse,
} from '@nexusos/contracts';
import { LeaseIssuer } from '../leases/lease-issuer.js';
import { ReceiptVerifier } from '../receipts/receipt-verifier.js';
import { TaskStateMachine } from './state-machine.js';
import { EventPublisherBoundary } from '../events/publisher-boundary.js';
import { ACPDispatchBridge } from '../server/acp-dispatch-bridge.js';
import { IPlannerService, PlannerService } from '../planner/index.js';

/**
 * Authoritative Approval Authority Boundary
 * Reuses Task 052 canonical approval host authority.
 */
export interface ApprovalAuthorityBoundary {
  presentPrompt(request: ApprovalPromptRequest): Promise<ApprovalPromptItem>;
  getPrompt(promptId: string, tenantId?: string): ApprovalPromptItem | undefined;
  listPendingPrompts(tenantId?: string): ApprovalPromptItem[];
  submitDecision(request: ApprovalDecisionRequest): Promise<ApprovalDecisionResult>;
  cancelPrompt?(promptId: string, reason?: string): boolean;
}

/**
 * Authoritative Plugin Registry Authority Boundary
 * Reuses Task 045 PluginRuntime & Catalog authority structurally without circular imports.
 */
export interface PluginCatalogEntryLike {
  pluginId: string;
  package: {
    manifest: {
      pluginId: string;
      version: string;
      publisher: string;
      name: string;
      description?: string;
      trustLevel: string;
      riskTier?: string;
      requestedCapabilities: string[];
    };
  };
  tenantId?: string;
  state: string;
  installedAt: string;
  updatedAt: string;
}

export interface PluginQuarantineRecordLike {
  pluginId: string;
  quarantinedAt: string;
  reason: string;
  crashCount: number;
}

export interface PluginRegistryAuthorityBoundary {
  listEntries(tenantId?: string): PluginCatalogEntryLike[];
  getEntry(pluginId: string, tenantId?: string): PluginCatalogEntryLike | undefined;
  listQuarantined(): PluginQuarantineRecordLike[];
  isQuarantined(pluginId: string): boolean;
}

export interface AuthenticatedContextLike {
  principal: {
    type: 'USER' | 'SERVICE' | 'DEVICE' | string;
    userId?: string;
    serviceId?: string;
    deviceId?: string;
    roles?: string[];
    scopes?: string[];
  };
  tenantId: string;
  issuedAt?: string;
  expiresAt?: string;
  rawTokenHash?: string;
}

export interface PolicyDecisionResultLike {
  decisionId: string;
  effect: 'ALLOW' | 'DENY' | string;
  allowed: boolean;
  policyVersion: string;
  policyHash: string;
  reason: string;
  evaluatedAt?: string;
  requestId?: string;
  correlationId?: string;
}

export interface PolicyDecisionRequestLike {
  subject?: AuthenticatedContextLike;
  action: {
    actionName: string;
    requiredScope?: string;
    requiredRole?: string;
  };
  resource: {
    resourceType: string;
    resourceId: string;
    tenantId?: string;
  };
  context: {
    requestId: string;
    correlationId: string;
    requestTimestamp: string;
  };
}

export interface PolicyEvaluatorBoundary {
  evaluate(request: PolicyDecisionRequestLike): Promise<PolicyDecisionResultLike>;
  getSnapshot?(): unknown;
}

export interface DecisionEvidenceLike {
  evidenceId: string;
  decisionId: string;
  effect: string;
  principalId: string;
  principalType: string;
  tenantId: string;
  actionName: string;
  resourceType: string;
  resourceId: string;
  policyVersion: string;
  policyHash: string;
  requestId: string;
  correlationId: string;
  timestamp: string;
  reason: string;
}

export interface PolicyAuditLoggerBoundary {
  logDecision(evidence: DecisionEvidenceLike): void;
}

export function createDecisionEvidence(
  request: PolicyDecisionRequestLike,
  result: PolicyDecisionResultLike,
): DecisionEvidenceLike {
  const principalId = request.subject
    ? request.subject.principal.type === 'USER'
      ? (request.subject.principal.userId ?? 'UNKNOWN_USER')
      : request.subject.principal.type === 'SERVICE'
        ? (request.subject.principal.serviceId ?? 'UNKNOWN_SERVICE')
        : (request.subject.principal.deviceId ?? 'UNKNOWN_DEVICE')
    : 'UNAUTHENTICATED';
  const principalType = request.subject ? request.subject.principal.type : 'NONE';
  const tenantId = request.subject ? request.subject.tenantId : 'NONE';

  return {
    evidenceId: crypto.randomUUID(),
    decisionId: result.decisionId,
    effect: result.effect,
    principalId,
    principalType,
    tenantId,
    actionName: request.action.actionName,
    resourceType: request.resource.resourceType,
    resourceId: request.resource.resourceId,
    policyVersion: result.policyVersion,
    policyHash: result.policyHash,
    requestId: request.context.requestId,
    correlationId: request.context.correlationId,
    timestamp: new Date().toISOString(),
    reason: result.reason,
  };
}

export interface TaskControllerOptions {
  leaseIssuer: LeaseIssuer;
  receiptVerifier: ReceiptVerifier;
  policyEvaluator: PolicyEvaluatorBoundary;
  policyAuditLogger?: PolicyAuditLoggerBoundary;
  eventPublisher?: EventPublisherBoundary;
  acpBridge?: ACPDispatchBridge;
  approvalHost?: ApprovalAuthorityBoundary;
  pluginRegistry?: PluginRegistryAuthorityBoundary;
  plannerService?: IPlannerService;
}

export class TaskController {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly leaseIssuer: LeaseIssuer;
  private readonly receiptVerifier: ReceiptVerifier;
  private readonly policyEvaluator: PolicyEvaluatorBoundary;
  private readonly policyAuditLogger?: PolicyAuditLoggerBoundary;
  private readonly eventPublisher?: EventPublisherBoundary;
  private readonly acpBridge?: ACPDispatchBridge;
  private approvalHost?: ApprovalAuthorityBoundary;
  private pluginRegistry?: PluginRegistryAuthorityBoundary;
  private plannerService: IPlannerService;

  constructor(options: TaskControllerOptions) {
    this.leaseIssuer = options.leaseIssuer;
    this.receiptVerifier = options.receiptVerifier;
    this.policyEvaluator = options.policyEvaluator;
    this.policyAuditLogger = options.policyAuditLogger;
    this.eventPublisher = options.eventPublisher;
    this.acpBridge = options.acpBridge;
    this.approvalHost = options.approvalHost;
    this.pluginRegistry = options.pluginRegistry;
    this.plannerService = options.plannerService || new PlannerService();

    if (this.acpBridge) {
      this.acpBridge.setReceiptSettler({
        settleReceipt: (receipt: unknown) => this.settleReceipt(receipt),
      });
    }
  }

  public setPlannerService(plannerService: IPlannerService): void {
    this.plannerService = plannerService;
  }

  public getPlannerService(): IPlannerService {
    return this.plannerService;
  }

  public async planGoal(
    rawRequest: unknown,
    context: AuthenticatedContextLike,
  ): Promise<GoalDecompositionResponse> {
    return this.plannerService.planGoal(rawRequest, context);
  }

  public async replanGoal(
    rawRequest: unknown,
    context: AuthenticatedContextLike,
  ): Promise<AdaptiveReplanResponse> {
    return this.plannerService.replanGoal(rawRequest, context);
  }

  public setApprovalHost(approvalHost: ApprovalAuthorityBoundary): void {
    this.approvalHost = approvalHost;
  }

  public getApprovalHost(): ApprovalAuthorityBoundary | undefined {
    return this.approvalHost;
  }

  public setPluginRegistry(pluginRegistry: PluginRegistryAuthorityBoundary): void {
    this.pluginRegistry = pluginRegistry;
  }

  public getPluginRegistry(): PluginRegistryAuthorityBoundary | undefined {
    return this.pluginRegistry;
  }

  /**
   * 054-SEC-03: List plugins projected from authoritative registry.
   */
  public listPlugins(tenantId?: string): PluginSummary[] {
    if (!this.pluginRegistry) {
      return [];
    }

    const entries = this.pluginRegistry.listEntries(tenantId);
    const filtered = tenantId
      ? entries.filter((e) => !e.tenantId || e.tenantId === tenantId)
      : entries;

    return filtered.map((entry) => {
      const qRec = this.pluginRegistry
        ?.listQuarantined()
        .find((q) => q.pluginId === entry.pluginId);
      return {
        pluginId: entry.pluginId,
        name: entry.package.manifest.name,
        version: entry.package.manifest.version,
        publisher: entry.package.manifest.publisher,
        state: (entry.state as any) || 'INSTALLED',
        trustLevel: (entry.package.manifest.trustLevel as any) || 'UNVERIFIED',
        riskTier: (entry.package.manifest.riskTier as any) || 'MEDIUM',
        requestedCapabilities: entry.package.manifest.requestedCapabilities || [],
        installedAt: entry.installedAt,
        updatedAt: entry.updatedAt,
        quarantineReason: qRec?.reason,
      };
    });
  }

  /**
   * 054-SEC-03: Get detailed plugin summary by ID.
   */
  public getPlugin(pluginId: string, tenantId?: string): PluginSummary | null {
    if (!this.pluginRegistry) {
      return null;
    }

    const entry = this.pluginRegistry.getEntry(pluginId, tenantId);
    if (!entry) {
      return null;
    }

    if (tenantId && entry.tenantId && entry.tenantId !== tenantId) {
      return null;
    }

    const qRec = this.pluginRegistry.listQuarantined().find((q) => q.pluginId === entry.pluginId);
    return {
      pluginId: entry.pluginId,
      name: entry.package.manifest.name,
      version: entry.package.manifest.version,
      publisher: entry.package.manifest.publisher,
      state: (entry.state as any) || 'INSTALLED',
      trustLevel: (entry.package.manifest.trustLevel as any) || 'UNVERIFIED',
      riskTier: (entry.package.manifest.riskTier as any) || 'MEDIUM',
      requestedCapabilities: entry.package.manifest.requestedCapabilities || [],
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
      quarantineReason: qRec?.reason,
    };
  }

  public getTask(taskId: string, context?: AuthenticatedContextLike): TaskRecord | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (context && task.tenantId !== context.tenantId) {
      // Cross-tenant access denied
      throw new Error(`Access denied: Task '${taskId}' belongs to a different tenant.`);
    }

    return task;
  }

  public getAllTasks(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks filtered by tenant with cursor-based pagination.
   * 053-SEC-02: Strict tenant isolation — only returns tasks owned by tenantId.
   * 053-SEC-05: Invalid or cross-tenant cursors fail safely.
   */
  public getTasksByTenant(
    tenantId: string,
    query: TaskQuery,
  ): { items: TaskRecord[]; nextCursor?: string; total: number } {
    let filtered = Array.from(this.tasks.values()).filter((t) => t.tenantId === tenantId);

    // Status filter
    if (query.status) {
      filtered = filtered.filter((t) => t.state === query.status);
    }

    // Sort by createdAt descending (most recent first)
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = filtered.length;

    // Cursor-based pagination: cursor is the taskId of the last seen item
    if (query.cursor) {
      const cursorIndex = filtered.findIndex((t) => t.taskId === query.cursor);
      if (cursorIndex >= 0) {
        filtered = filtered.slice(cursorIndex + 1);
      } else {
        // 053-SEC-05: Invalid/manipulated or cross-tenant cursor fails safely
        return { items: [], nextCursor: undefined, total };
      }
    }

    const limit = query.limit ?? 50;
    const page = filtered.slice(0, limit);
    const nextCursor =
      page.length === limit && filtered.length > limit ? page[limit - 1].taskId : undefined;

    return { items: page, nextCursor, total };
  }

  /**
   * Get activity events filtered by tenant with cursor-based pagination.
   * Events are filtered by tenantId from the payload or correlationId.
   * 053-SEC-02: Strict tenant isolation.
   * 053-SEC-05: Event deduplication and fail-safe cursor integrity.
   */
  public getActivityByTenant(
    tenantId: string,
    query: ActivityQuery,
  ): { items: EventEnvelope[]; nextCursor?: string; total: number } {
    if (!this.eventPublisher) {
      return { items: [], total: 0 };
    }

    const allEvents = (
      this.eventPublisher as unknown as { getPublishedEvents(): EventEnvelope[] }
    ).getPublishedEvents();

    // Filter events by tenantId (checking payload.tenantId or matching task ownership)
    let filtered = allEvents.filter((ev) => {
      const payload = ev.payload as Record<string, unknown> | undefined;
      if (payload && payload['tenantId'] === tenantId) return true;

      // Also check if event's correlationId maps to a task owned by this tenant
      if (ev.correlation_id) {
        const task = this.tasks.get(ev.correlation_id);
        if (task && task.tenantId === tenantId) return true;
      }

      return false;
    });

    // Filter by taskId if specified
    if (query.taskId) {
      filtered = filtered.filter((ev) => {
        const payload = ev.payload as Record<string, unknown> | undefined;
        return payload && payload['taskId'] === query.taskId;
      });
    }

    // 053-SEC-05: Event ID deduplication — keep first occurrence
    const seenEventIds = new Set<string>();
    const deduplicated: EventEnvelope[] = [];
    for (const ev of filtered) {
      if (!seenEventIds.has(ev.event_id)) {
        seenEventIds.add(ev.event_id);
        deduplicated.push(ev);
      }
    }
    filtered = deduplicated;

    // Sort deterministically by timestamp descending (most recent first) with event_id tie-breaker
    filtered.sort(
      (a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.event_id.localeCompare(a.event_id),
    );

    const total = filtered.length;

    // Cursor-based pagination: cursor is the event_id of the last seen item
    if (query.cursor) {
      const cursorIndex = filtered.findIndex((ev) => ev.event_id === query.cursor);
      if (cursorIndex >= 0) {
        filtered = filtered.slice(cursorIndex + 1);
      } else {
        // 053-SEC-05: Invalid/manipulated cursor fails safely
        return { items: [], nextCursor: undefined, total };
      }
    }

    const limit = query.limit ?? 50;
    const page = filtered.slice(0, limit);
    const nextCursor =
      page.length === limit && filtered.length > limit ? page[limit - 1].event_id : undefined;

    return { items: page, nextCursor, total };
  }

  /**
   * List pending approvals for a tenant.
   * 053-SEC-02: Scoped strictly to the caller tenant.
   * Reuses canonical Task 052 approval authority.
   */
  public listPendingApprovals(tenantId: string): ApprovalPromptItem[] {
    if (this.approvalHost) {
      return this.approvalHost.listPendingPrompts(tenantId);
    }
    return [];
  }

  /**
   * Submit an authoritative approval decision (ALLOW or DENY).
   * 053-SEC-01 & 053-SEC-03: Server-side authorization — reuses Task 052 approval authority.
   * Performs nonce, tenant, lease, and expiry validation via the authoritative host.
   */
  public async submitApprovalDecision(
    rawDecision: unknown,
    context: AuthenticatedContextLike,
  ): Promise<ApprovalDecisionResult> {
    if (!context || !context.principal || !context.tenantId) {
      throw new Error(
        'UNAUTHENTICATED: Valid credentials are required to submit an approval decision.',
      );
    }

    if (!this.approvalHost) {
      throw new Error('APPROVAL_HOST_UNAVAILABLE: Approval host is not configured.');
    }

    const decisionReq = ApprovalDecisionRequestSchema.parse(rawDecision);

    // 053-SEC-02: Strict tenant isolation — block cross-tenant decision injection
    if (decisionReq.tenantId && decisionReq.tenantId !== context.tenantId) {
      throw new Error(
        `TENANT_MISMATCH: Cross-tenant approval decision rejected for prompt '${decisionReq.promptId}'.`,
      );
    }

    // Bind authenticated tenant and caller principal
    const scopedReq: ApprovalDecisionRequest = {
      ...decisionReq,
      tenantId: context.tenantId,
      decidedBy:
        context.principal.type === 'USER'
          ? context.principal.userId
          : context.principal.serviceId || 'UNKNOWN_PRINCIPAL',
    };

    // Authoritative execution via Task 052 approval authority
    const result = await this.approvalHost.submitDecision(scopedReq);

    // Authoritative state reconciliation: update task state if tracked in tasks map
    const prompt = this.approvalHost.getPrompt(result.promptId, context.tenantId);
    const targetTaskId = result.taskId || prompt?.taskId;
    if (targetTaskId) {
      const task = this.tasks.get(targetTaskId);
      if (task && task.tenantId === context.tenantId) {
        if (result.decision === 'ALLOW') {
          if (task.state === TaskLifecycleState.AWAITING_APPROVAL) {
            const updated = TaskStateMachine.transition(
              task,
              TaskLifecycleState.EXECUTING,
              'Approval granted by human decision.',
            );
            this.tasks.set(task.taskId, updated);
          }
        } else if (result.decision === 'DENY') {
          if (task.state === TaskLifecycleState.AWAITING_APPROVAL) {
            const updated = TaskStateMachine.transition(
              task,
              TaskLifecycleState.FAILED,
              'Approval denied by human decision.',
            );
            updated.error = {
              code: 'APPROVAL_DENIED',
              message: 'Human operator denied approval for task execution.',
            };
            this.tasks.set(task.taskId, updated);
          }
        }
      }
    }

    // Emit canonical audit event
    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.approval.decision',
          '1.0.0',
          'control-plane-backend',
          targetTaskId || result.promptId,
          {
            promptId: result.promptId,
            taskId: targetTaskId,
            decision: result.decision,
            state: result.state,
            receiptHash: result.receiptHash,
            tenantId: context.tenantId,
          },
        ),
      );
    }

    return result;
  }

  /**
   * Get aggregated dashboard summary for a tenant.
   * 053-SEC-02: Strict tenant isolation.
   */
  public getDashboardSummary(tenantId: string): DashboardSummary {
    const allTasks = Array.from(this.tasks.values()).filter((t) => t.tenantId === tenantId);

    const activeStates = new Set([
      TaskLifecycleState.SUBMITTED,
      TaskLifecycleState.POLICY_EVALUATED,
      TaskLifecycleState.LEASED,
      TaskLifecycleState.DISPATCHED,
      TaskLifecycleState.EXECUTING,
      TaskLifecycleState.AWAITING_APPROVAL,
    ]);

    const activeTaskCount = allTasks.filter((t) => activeStates.has(t.state)).length;
    const pendingApprovalCount = this.approvalHost
      ? this.approvalHost.listPendingPrompts(tenantId).length
      : allTasks.filter((t) => t.state === TaskLifecycleState.AWAITING_APPROVAL).length;
    const completedTaskCount = allTasks.filter(
      (t) => t.state === TaskLifecycleState.COMPLETED,
    ).length;
    const failedTaskCount = allTasks.filter((t) => t.state === TaskLifecycleState.FAILED).length;

    return {
      tenantId,
      activeTaskCount,
      pendingApprovalCount,
      completedTaskCount,
      failedTaskCount,
      connectedDeviceCount: 0, // Production: populated by device registry
      healthStatus: 'HEALTHY',
      updatedAt: new Date().toISOString(),
    };
  }

  public async createTask(
    rawRequest: unknown,
    context: AuthenticatedContextLike,
  ): Promise<{ task: TaskRecord; policyAllowed: boolean; denialReason?: string }> {
    if (rawRequest && typeof rawRequest === 'object' && 'nodes' in rawRequest) {
      return this.createTaskGraph(rawRequest, context);
    }

    // 047-SEC-01: Authentication must be verified
    if (!context || !context.principal || !context.tenantId) {
      throw new Error('UNAUTHENTICATED: Valid user context is required to create a task.');
    }

    const principalId =
      (context.principal.type === 'USER'
        ? context.principal.userId
        : context.principal.type === 'SERVICE'
          ? context.principal.serviceId
          : context.principal.deviceId) || 'UNKNOWN_PRINCIPAL';

    // Parse and validate schema
    const req: TaskCreateRequest = TaskCreateRequestSchema.parse(rawRequest);
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();

    let task: TaskRecord = {
      taskId,
      tenantId: context.tenantId,
      submittedBy: principalId,
      title: req.title,
      targetAgentId: req.targetAgentId,
      capabilityId: req.capabilityId,
      runtimeCategory: req.runtimeCategory,
      parameters: this.redactSensitiveData(req.parameters),
      requestedScope: req.requestedScope,
      state: TaskLifecycleState.SUBMITTED,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);

    // 047-SEC-02: Authorize via Policy Evaluator before issuing lease
    const isUser = context.principal.type === 'USER';
    const decisionRequest = {
      subject: context,
      action: {
        actionName: 'task:execute',
        ...(isUser ? { requiredRole: 'operator' } : { requiredScope: req.requestedScope }),
      },
      resource: {
        resourceType: 'task',
        resourceId: taskId,
        tenantId: context.tenantId,
      },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: taskId,
        requestTimestamp: now,
      },
    };

    const decision = await this.policyEvaluator.evaluate(decisionRequest);

    if (this.policyAuditLogger) {
      const evidence = createDecisionEvidence(decisionRequest, decision);
      this.policyAuditLogger.logDecision(evidence);
    }

    task.policyDecision = {
      allowed: decision.allowed,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
      policyHash: decision.policyHash,
    };

    if (!decision.allowed) {
      task = TaskStateMachine.transition(task, TaskLifecycleState.FAILED, decision.reason);
      task.error = {
        code: 'POLICY_DENIED',
        message: decision.reason || 'Task execution denied by policy decision.',
      };
      this.tasks.set(taskId, task);

      if (this.eventPublisher) {
        await this.eventPublisher.publish(
          createEventEnvelope(
            'nexusos.events.policy.denial',
            '1.0.0',
            'control-plane-backend',
            taskId,
            {
              taskId,
              reason: decision.reason,
              tenantId: context.tenantId,
            },
          ),
        );
      }

      return { task, policyAllowed: false, denialReason: decision.reason };
    }

    // Policy Allowed: Transition to POLICY_EVALUATED
    task = TaskStateMachine.transition(task, TaskLifecycleState.POLICY_EVALUATED);
    this.tasks.set(taskId, task);

    // Issue Execution Lease
    const lease = this.leaseIssuer.issueLease({
      taskId,
      agentId: req.targetAgentId,
      tenantId: context.tenantId,
      scopes: [req.requestedScope],
      policyHash: decision.policyHash,
    });

    task.lease = lease;
    task = TaskStateMachine.transition(task, TaskLifecycleState.LEASED);
    this.tasks.set(taskId, task);

    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.task.created',
          '1.0.0',
          'control-plane-backend',
          taskId,
          {
            taskId,
            tenantId: context.tenantId,
            capabilityId: req.capabilityId,
          },
        ),
      );
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.task.leased',
          '1.0.0',
          'control-plane-backend',
          taskId,
          {
            taskId,
            leaseId: lease.lease_id,
            scopes: lease.scopes,
            expiresAt: lease.expires_at,
          },
        ),
      );
    }

    // ACP Dispatch
    if (this.acpBridge) {
      task = TaskStateMachine.transition(task, TaskLifecycleState.DISPATCHED);
      this.tasks.set(taskId, task);

      if (this.eventPublisher) {
        await this.eventPublisher.publish(
          createEventEnvelope(
            'nexusos.events.task.dispatched',
            '1.0.0',
            'control-plane-backend',
            taskId,
            {
              taskId,
              targetAgentId: req.targetAgentId,
            },
          ),
        );
      }

      await this.acpBridge.dispatchTask(task);
    }

    return { task, policyAllowed: true };
  }

  /**
   * Governed Multi-Node Workflow Graph Intake (Sprint 1 Milestone 1 / Task 049)
   */
  public async createTaskGraph(
    rawRequest: unknown,
    context: AuthenticatedContextLike,
  ): Promise<{ task: TaskRecord; policyAllowed: boolean; denialReason?: string }> {
    // 047-SEC-01 & 049-SEC-01: Authentication must be verified
    if (!context || !context.principal || !context.tenantId) {
      throw new Error('UNAUTHENTICATED: Valid user context is required to create a task graph.');
    }

    const principalId =
      (context.principal.type === 'USER'
        ? context.principal.userId
        : context.principal.type === 'SERVICE'
          ? context.principal.serviceId
          : context.principal.deviceId) || 'UNKNOWN_PRINCIPAL';

    // Parse and validate DAG schema and topology
    const req: TaskGraphCreateRequest = TaskGraphCreateRequestSchema.parse(rawRequest);
    const topoResult = validateDAGTopology(req.nodes, req.edges);
    if (!topoResult.valid) {
      throw new Error(`DAG validation failed: ${topoResult.errorMessage}`);
    }

    const taskId = crypto.randomUUID();
    const workflowId = req.workflowId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const requiredCapabilities = Array.from(new Set(req.nodes.map((n) => n.capabilityId)));
    const canonicalScopes = requiredCapabilities.flatMap((cap) => [
      cap,
      `capability:${cap.replace(/\./g, ':')}`,
      `capability:${cap}`,
    ]);
    const requiredScopes = Array.from(
      new Set([...canonicalScopes, req.requestedScope].filter(Boolean) as string[]),
    );

    let task: TaskRecord = {
      taskId,
      tenantId: context.tenantId,
      submittedBy: principalId,
      title: req.title,
      targetAgentId: req.targetAgentId,
      capabilityId: 'workflow.dag',
      runtimeCategory: 'workflow',
      parameters: {
        nodeCount: req.nodes.length,
        requiredCapabilities,
      },
      requestedScope: req.requestedScope || requiredCapabilities.join(','),
      state: TaskLifecycleState.SUBMITTED,
      isWorkflow: true,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);

    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.task.created',
          '1.0.0',
          'control-plane-backend',
          taskId,
          {
            taskId,
            tenantId: context.tenantId,
            submittedBy: principalId,
            capabilityId: task.capabilityId,
            targetAgentId: req.targetAgentId,
          },
        ),
      );
    }

    // 049-SEC-01: Multi-node policy check. Evaluate policy for EVERY capability/node before execution.
    const isUser = context.principal.type === 'USER';
    const topDecisionRequest = {
      subject: context,
      action: {
        actionName: 'task:execute',
        ...(isUser ? { requiredRole: 'operator' } : { requiredScope: requiredScopes[0] }),
      },
      resource: {
        resourceType: 'task',
        resourceId: taskId,
        tenantId: context.tenantId,
      },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: taskId,
        requestTimestamp: now,
      },
    };

    const topDecision = await this.policyEvaluator.evaluate(topDecisionRequest);
    if (this.policyAuditLogger) {
      this.policyAuditLogger.logDecision(createDecisionEvidence(topDecisionRequest, topDecision));
    }

    if (!topDecision.allowed) {
      task = TaskStateMachine.transition(task, TaskLifecycleState.FAILED, topDecision.reason);
      task.error = {
        code: 'POLICY_DENIED',
        message: topDecision.reason || 'Workflow execution denied by policy decision.',
      };
      task.policyDecision = {
        allowed: false,
        reason: topDecision.reason,
        policyVersion: topDecision.policyVersion,
        policyHash: topDecision.policyHash,
      };
      this.tasks.set(taskId, task);
      return { task, policyAllowed: false, denialReason: topDecision.reason };
    }

    // Evaluate policy for EVERY node in the DAG
    let deniedNode: (typeof req.nodes)[0] | undefined;
    let denialReason: string | undefined;

    for (const node of req.nodes) {
      const nodeScope = `capability:${node.capabilityId.replace(/\./g, ':')}`;
      const nodeDecisionRequest = {
        subject: context,
        action: {
          actionName: 'task:execute',
          ...(isUser ? { requiredRole: 'operator' } : { requiredScope: nodeScope }),
        },
        resource: {
          resourceType: 'task',
          resourceId: `${taskId}:${node.nodeId}`,
          tenantId: context.tenantId,
        },
        context: {
          requestId: crypto.randomUUID(),
          correlationId: taskId,
          requestTimestamp: now,
          details: {
            nodeId: node.nodeId,
            capabilityId: node.capabilityId,
            requiredScope: nodeScope,
            runtimeCategory: node.runtimeCategory,
          },
        },
      };

      const nodeDecision = await this.policyEvaluator.evaluate(nodeDecisionRequest);
      if (this.policyAuditLogger) {
        this.policyAuditLogger.logDecision(
          createDecisionEvidence(nodeDecisionRequest, nodeDecision),
        );
      }

      if (!nodeDecision.allowed) {
        deniedNode = node;
        denialReason =
          nodeDecision.reason ||
          `Policy denied capability '${node.capabilityId}' on node '${node.nodeId}'.`;
        break;
      }
    }

    if (deniedNode) {
      // 049-SEC-01 Fail closed: a single denied node prevents the entire workflow from executing
      task = TaskStateMachine.transition(task, TaskLifecycleState.FAILED, denialReason);
      task.error = {
        code: 'POLICY_DENIED',
        message: denialReason || 'Workflow execution denied by policy.',
      };
      task.policyDecision = {
        allowed: false,
        reason: denialReason,
        policyVersion: topDecision.policyVersion,
        policyHash: topDecision.policyHash,
      };
      this.tasks.set(taskId, task);

      if (this.eventPublisher) {
        await this.eventPublisher.publish(
          createEventEnvelope(
            'nexusos.events.policy.denial',
            '1.0.0',
            'control-plane-backend',
            taskId,
            {
              taskId,
              workflowId,
              deniedNodeId: deniedNode.nodeId,
              deniedCapability: deniedNode.capabilityId,
              reason: denialReason,
              tenantId: context.tenantId,
            },
          ),
        );
      }

      return { task, policyAllowed: false, denialReason };
    }

    // All nodes allowed: Transition to POLICY_EVALUATED
    task.policyDecision = {
      allowed: true,
      reason: 'All workflow DAG nodes permitted by policy',
      policyVersion: topDecision.policyVersion,
      policyHash: topDecision.policyHash,
    };
    task = TaskStateMachine.transition(task, TaskLifecycleState.POLICY_EVALUATED);
    this.tasks.set(taskId, task);

    // 049-SEC-02: Issue Composite Execution Lease binding all workflow capability scopes
    const lease = this.leaseIssuer.issueLease({
      taskId,
      agentId: req.targetAgentId,
      tenantId: context.tenantId,
      scopes: requiredScopes,
      policyHash: topDecision.policyHash,
    });

    const dag: WorkflowDAG = {
      workflowId,
      taskId,
      leaseHeader: lease,
      correlationId: taskId,
      nodes: req.nodes.map((n) => ({
        ...n,
        payload: this.redactSensitiveData(n.payload || {}),
      })),
      edges: req.edges ?? [],
      expiresAt: lease.expires_at,
    };

    task.lease = lease;
    task.dag = dag;
    task = TaskStateMachine.transition(task, TaskLifecycleState.LEASED);
    this.tasks.set(taskId, task);

    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.workflow.created',
          '1.0.0',
          'control-plane-backend',
          taskId,
          {
            taskId,
            workflowId,
            tenantId: context.tenantId,
            nodeCount: req.nodes.length,
          },
        ),
      );
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.task.leased',
          '1.0.0',
          'control-plane-backend',
          taskId,
          {
            taskId,
            leaseId: lease.lease_id,
            scopes: lease.scopes,
            expiresAt: lease.expires_at,
          },
        ),
      );
    }

    // ACP Workflow Dispatch
    if (this.acpBridge) {
      task = TaskStateMachine.transition(task, TaskLifecycleState.DISPATCHED);
      this.tasks.set(taskId, task);

      if (this.eventPublisher) {
        await this.eventPublisher.publish(
          createEventEnvelope(
            'nexusos.events.workflow.dispatched',
            '1.0.0',
            'control-plane-backend',
            taskId,
            {
              taskId,
              workflowId,
              targetAgentId: req.targetAgentId,
            },
          ),
        );
        await this.eventPublisher.publish(
          createEventEnvelope(
            'nexusos.events.task.dispatched',
            '1.0.0',
            'control-plane-backend',
            taskId,
            {
              taskId,
              targetAgentId: req.targetAgentId,
            },
          ),
        );
      }

      await this.acpBridge.dispatchWorkflow(task, dag);
    }

    return { task, policyAllowed: true };
  }

  public async cancelTask(
    taskId: string,
    reason: string | undefined,
    context: AuthenticatedContextLike,
  ): Promise<TaskRecord> {
    const task = this.getTask(taskId, context);
    if (!task) {
      throw new Error(`Task '${taskId}' not found.`);
    }

    if (task.state === TaskLifecycleState.COMPLETED) {
      throw new Error(`Cannot cancel task '${taskId}': task is already COMPLETED.`);
    }
    if (task.state === TaskLifecycleState.FAILED) {
      throw new Error(`Cannot cancel task '${taskId}': task has already FAILED.`);
    }
    if (task.state === TaskLifecycleState.CANCELLED) {
      return task;
    }

    const updatedTask = TaskStateMachine.transition(
      task,
      TaskLifecycleState.CANCELLED,
      reason ?? 'User cancellation requested.',
    );
    this.tasks.set(taskId, updatedTask);

    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        createEventEnvelope(
          'nexusos.events.task.canceled',
          '1.0.0',
          'control-plane-backend',
          taskId,
          {
            taskId,
            reason: reason ?? 'User cancellation requested.',
            tenantId: context.tenantId,
          },
        ),
      );
    }

    return updatedTask;
  }

  public async settleReceipt(rawReceipt: unknown): Promise<TaskRecord> {
    // Check if rawReceipt is a WorkflowExecutionReceipt
    const workflowParseResult = WorkflowExecutionReceiptSchema.safeParse(rawReceipt);
    if (workflowParseResult.success) {
      const parsedReceipt = workflowParseResult.data;
      const task = this.tasks.get(parsedReceipt.taskId);

      if (!task) {
        throw new Error(
          `Task '${parsedReceipt.taskId}' not found for workflow receipt settlement.`,
        );
      }

      if (task.state === TaskLifecycleState.CANCELLED) {
        throw new Error(
          `Cannot settle receipt for task '${task.taskId}': task is already CANCELLED.`,
        );
      }

      if (!task.lease) {
        throw new Error(
          `Cannot settle receipt for task '${task.taskId}': task has no recorded lease.`,
        );
      }

      // 049-SEC-02 & Phase 7: Verify workflow receipt authenticity, evidence hash, lease binding, tenant consistency
      const verification = this.receiptVerifier.verifyWorkflowReceipt(parsedReceipt, {
        expectedTaskId: task.taskId,
        expectedWorkflowId: parsedReceipt.workflowId,
        expectedLeaseId: task.lease.lease_id,
        expectedAgentId: task.targetAgentId,
        expectedTenantId: task.tenantId,
      });

      if (!verification.valid) {
        const failedTask = TaskStateMachine.transition(
          task,
          TaskLifecycleState.FAILED,
          verification.errorMessage,
        );
        failedTask.error = {
          code: verification.errorCode || 'RECEIPT_VERIFICATION_FAILED',
          message: verification.errorMessage || 'Workflow receipt verification failed.',
        };
        this.tasks.set(task.taskId, failedTask);
        throw new Error(`Workflow receipt verification failed: ${verification.errorMessage}`);
      }

      let currentTask = task;
      if (currentTask.state === TaskLifecycleState.LEASED) {
        currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.DISPATCHED);
      }
      if (currentTask.state === TaskLifecycleState.DISPATCHED) {
        currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.EXECUTING);
      }

      currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.RECEIPT_VERIFIED);

      if (parsedReceipt.status === 'SUCCESS') {
        currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.COMPLETED);
      } else if (parsedReceipt.status === 'CANCELLED') {
        currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.CANCELLED);
      } else {
        currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.FAILED);
        currentTask.error = {
          code: 'WORKFLOW_EXECUTION_FAILED',
          message: parsedReceipt.errorMessage || 'Workflow execution reported failure.',
        };
      }

      currentTask.receipt = parsedReceipt;
      currentTask.evidenceChecksum = parsedReceipt.evidenceChecksum;
      this.tasks.set(currentTask.taskId, currentTask);

      if (this.eventPublisher) {
        await this.eventPublisher.publish(
          createEventEnvelope(
            `nexusos.events.workflow.${currentTask.state.toLowerCase()}`,
            '1.0.0',
            'control-plane-backend',
            currentTask.taskId,
            {
              taskId: currentTask.taskId,
              workflowId: parsedReceipt.workflowId,
              tenantId: currentTask.tenantId,
              status: currentTask.state,
              evidenceChecksum: currentTask.evidenceChecksum,
            },
          ),
        );
        await this.eventPublisher.publish(
          createEventEnvelope(
            `nexusos.events.task.${currentTask.state.toLowerCase()}`,
            '1.0.0',
            'control-plane-backend',
            currentTask.taskId,
            {
              taskId: currentTask.taskId,
              status: currentTask.state,
              evidenceChecksum: currentTask.evidenceChecksum,
            },
          ),
        );
      }

      return currentTask;
    }

    // Single-task execution receipt settlement
    const parsedReceipt = ExecutionReceiptSchema.parse(rawReceipt);
    const task = this.tasks.get(parsedReceipt.taskId);

    if (!task) {
      throw new Error(`Task '${parsedReceipt.taskId}' not found for receipt settlement.`);
    }

    // 047-SEC-10: Stale receipt cannot transition a CANCELLED task to COMPLETED
    if (task.state === TaskLifecycleState.CANCELLED) {
      throw new Error(
        `Cannot settle receipt for task '${task.taskId}': task is already CANCELLED.`,
      );
    }

    if (!task.lease) {
      throw new Error(
        `Cannot settle receipt for task '${task.taskId}': task has no recorded lease.`,
      );
    }

    // Verify receipt authenticity, evidence hash, lease binding, tenant consistency
    const verification = this.receiptVerifier.verify(parsedReceipt, {
      expectedTaskId: task.taskId,
      expectedLeaseId: task.lease.lease_id,
      expectedAgentId: task.targetAgentId,
      expectedTenantId: task.tenantId,
    });

    if (!verification.valid) {
      const failedTask = TaskStateMachine.transition(
        task,
        TaskLifecycleState.FAILED,
        verification.errorMessage,
      );
      failedTask.error = {
        code: verification.errorCode || 'RECEIPT_VERIFICATION_FAILED',
        message: verification.errorMessage || 'Receipt verification failed.',
      };
      this.tasks.set(task.taskId, failedTask);
      throw new Error(`Receipt verification failed: ${verification.errorMessage}`);
    }

    // Transition: EXECUTING (if not already) -> RECEIPT_VERIFIED -> COMPLETED (or FAILED if status was FAILURE)
    let currentTask = task;
    if (currentTask.state === TaskLifecycleState.LEASED) {
      currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.DISPATCHED);
    }
    if (currentTask.state === TaskLifecycleState.DISPATCHED) {
      currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.EXECUTING);
    }

    currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.RECEIPT_VERIFIED);

    if (parsedReceipt.status === 'SUCCESS') {
      currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.COMPLETED);
    } else if (parsedReceipt.status === 'CANCELLED') {
      currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.CANCELLED);
    } else {
      currentTask = TaskStateMachine.transition(currentTask, TaskLifecycleState.FAILED);
      currentTask.error = {
        code: 'EXECUTION_FAILED',
        message: parsedReceipt.errorMessage || 'Task execution reported failure.',
      };
    }

    currentTask.receipt = parsedReceipt;
    currentTask.evidenceChecksum = parsedReceipt.evidenceChecksum;
    this.tasks.set(currentTask.taskId, currentTask);

    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        createEventEnvelope(
          `nexusos.events.task.${currentTask.state.toLowerCase()}`,
          '1.0.0',
          'control-plane-backend',
          currentTask.taskId,
          {
            taskId: currentTask.taskId,
            tenantId: currentTask.tenantId,
            status: currentTask.state,
            evidenceChecksum: currentTask.evidenceChecksum,
          },
        ),
      );
    }

    return currentTask;
  }

  private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys =
      /(password|secret|token|api[_-]?key|authorization|auth|jwt|bearer|private[_-]?key|hmac|credential)/i;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.test(key)) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'string' && /Bearer\s+[A-Za-z0-9._~+/-]+/i.test(value)) {
        result[key] = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED_TOKEN]');
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactSensitiveData(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
