import crypto from 'node:crypto';
import {
  TaskCreateRequest,
  TaskCreateRequestSchema,
  TaskLifecycleState,
  TaskRecord,
  createEventEnvelope,
  ExecutionReceiptSchema,
} from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';
import { PolicyEvaluator, PolicyAuditLogger, createDecisionEvidence } from '@nexusos/policy';
import { LeaseIssuer } from '../leases/lease-issuer.js';
import { ReceiptVerifier } from '../receipts/receipt-verifier.js';
import { TaskStateMachine } from './state-machine.js';
import { EventPublisherBoundary } from '../events/publisher-boundary.js';
import { ACPDispatchBridge } from '../server/acp-dispatch-bridge.js';

export interface TaskControllerOptions {
  leaseIssuer: LeaseIssuer;
  receiptVerifier: ReceiptVerifier;
  policyEvaluator: PolicyEvaluator;
  policyAuditLogger?: PolicyAuditLogger;
  eventPublisher?: EventPublisherBoundary;
  acpBridge?: ACPDispatchBridge;
}

export class TaskController {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly leaseIssuer: LeaseIssuer;
  private readonly receiptVerifier: ReceiptVerifier;
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly policyAuditLogger?: PolicyAuditLogger;
  private readonly eventPublisher?: EventPublisherBoundary;
  private readonly acpBridge?: ACPDispatchBridge;

  constructor(options: TaskControllerOptions) {
    this.leaseIssuer = options.leaseIssuer;
    this.receiptVerifier = options.receiptVerifier;
    this.policyEvaluator = options.policyEvaluator;
    this.policyAuditLogger = options.policyAuditLogger;
    this.eventPublisher = options.eventPublisher;
    this.acpBridge = options.acpBridge;

    if (this.acpBridge) {
      this.acpBridge.setReceiptSettler({
        settleReceipt: (receipt: unknown) => this.settleReceipt(receipt),
      });
    }
  }

  public getTask(taskId: string, context?: AuthenticatedContext): TaskRecord | null {
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

  public async createTask(
    rawRequest: unknown,
    context: AuthenticatedContext,
  ): Promise<{ task: TaskRecord; policyAllowed: boolean; denialReason?: string }> {
    // 047-SEC-01: Authentication must be verified
    if (!context || !context.principal || !context.tenantId) {
      throw new Error('UNAUTHENTICATED: Valid user context is required to create a task.');
    }

    const principalId =
      context.principal.type === 'USER'
        ? context.principal.userId
        : context.principal.type === 'SERVICE'
          ? context.principal.serviceId
          : context.principal.deviceId;

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

  public async cancelTask(
    taskId: string,
    reason: string | undefined,
    context: AuthenticatedContext,
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
    const sensitiveKeys = /(password|secret|token|api[_-]?key|authorization|auth|jwt|bearer)/i;
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
