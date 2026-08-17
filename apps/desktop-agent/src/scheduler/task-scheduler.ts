import crypto from 'node:crypto';
import { DesktopAgentConfig } from '../config/index.js';
import { AgentIdentityProvider } from '../identity/agent-identity.js';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { StateManager } from '../state/state-manager.js';
import { TelemetrySpool } from '../telemetry/telemetry-spool.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { AgentLifecycleState } from '../lifecycle/index.js';
import { AgentOrchestrator } from '../orchestrator/agent-orchestrator.js';
import { TaskExecutionRequest, TaskExecutionResult, TaskStatus } from '../orchestrator/types.js';
import { ExecutionQueue } from './execution-queue.js';
import {
  IExecutionQueue,
  ITaskScheduler,
  QueueMetrics,
  QueuePriorityLane,
  ScheduledTaskItem,
} from './types.js';

export class TaskScheduler implements ITaskScheduler {
  private readonly queue: IExecutionQueue;
  private isProcessing = false;
  private maintenanceTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: DesktopAgentConfig,
    private readonly identityProvider: AgentIdentityProvider,
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly orchestrator: AgentOrchestrator,
    private readonly stateManager?: StateManager,
    private readonly telemetrySpool?: TelemetrySpool,
    private readonly redactionFilter?: RedactionFilter,
    private readonly notificationManager?: NotificationManager,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
    customQueue?: IExecutionQueue,
  ) {
    this.queue = customQueue || new ExecutionQueue(100, 20, 30000);
    void this.config;
    void this.redactionFilter;
    void this.notificationManager;
    this.startMaintenanceLoop();
  }

  public getQueueMetrics(): QueueMetrics {
    return {
      queuedCount: this.queue.getSize(),
      activeCount: this.orchestrator.getActiveCount(),
      maxCapacity: 100,
      perLaneCounts: {
        CRITICAL: this.queue.getLaneCount('CRITICAL'),
        INTERACTIVE: this.queue.getLaneCount('INTERACTIVE'),
        NORMAL: this.queue.getLaneCount('NORMAL'),
        RETRY: this.queue.getLaneCount('RETRY'),
        BACKGROUND: this.queue.getLaneCount('BACKGROUND'),
      },
      tenantCounts: {},
    };
  }

  public getScheduledTaskStatus(taskId: string, tenantId?: string): TaskStatus | null {
    const orchStatus = this.orchestrator.getTaskStatus(taskId, tenantId);
    if (orchStatus) {
      return orchStatus;
    }
    const item = this.queue.peek();
    if (item && item.request.task_id === taskId) {
      if (tenantId && item.tenantId !== tenantId) {
        return null; // Cross-tenant status probing denied
      }
      return 'QUEUED';
    }
    return null;
  }

  public async cancelScheduledTask(
    taskId: string,
    tenantId?: string,
    reason?: string,
  ): Promise<boolean> {
    // 1. Check if task is queued in scheduler
    const removedItem = this.queue.remove(taskId, tenantId);
    if (removedItem) {
      if (this.stateManager) {
        await this.stateManager.set(`task_checkpoint:${taskId}`, {
          taskId,
          status: 'CANCELED',
          timestamp: new Date().toISOString(),
        });
        const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
        await this.stateManager.set(
          'task_queue_index',
          index.filter((id) => id !== taskId),
        );
        await this.stateManager.delete(`task_queue:${taskId}`);
      }

      if (this.telemetrySpool?.enqueueEventEnvelope) {
        const identity = await this.identityProvider.getIdentity();
        this.telemetrySpool.enqueueEventEnvelope({
          schema_id: 'schema:nexusos:task:canceled:v1',
          version: '1.0.0',
          event_id: crypto.randomUUID(),
          correlation_id: removedItem.request.correlation_id,
          occurred_at: new Date().toISOString(),
          producer_id: identity.deviceId,
          payload: {
            taskId,
            stepId: removedItem.request.step_id,
            status: 'CANCELED',
          },
        });
      }

      return true;
    }

    // Check if task exists in queue under a different tenant
    const peekStatus = this.getScheduledTaskStatus(taskId);
    if (peekStatus === 'QUEUED' && tenantId) {
      return false; // Cross-tenant cancellation attempt on queued task
    }

    // 2. Delegate to orchestrator if already running or completed
    return this.orchestrator.cancelTask(taskId, tenantId, reason);
  }

  public async scheduleTask(request: TaskExecutionRequest): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // 1. RISK-R09: Lifecycle Admission Check
    if (this.getAgentLifecycleState) {
      const state = this.getAgentLifecycleState();
      if (
        state === AgentLifecycleState.STOPPING ||
        state === AgentLifecycleState.STOPPED ||
        state === AgentLifecycleState.FAILED
      ) {
        return {
          success: false,
          taskId: request.task_id,
          stepId: request.step_id,
          errorCode: 'LIFECYCLE_DENIED',
          errorMessage: 'Agent lifecycle state is unsafe for task admission.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // 2. RISK-R01 & R02: Lease Validation & Context Binding
    const leaseDecision = await this.leaseBoundary.validateLease(request.leaseHeader, undefined);

    if (!leaseDecision.valid) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'LEASE_DENIED',
        errorMessage: leaseDecision.reason || 'Execution lease validation failed.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    const identity = await this.identityProvider.getIdentity();
    if (
      request.leaseHeader.agent_id !== identity.deviceId ||
      request.leaseHeader.tenant_id !== identity.pairedTenantId
    ) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'TENANT_DEVICE_MISMATCH',
        errorMessage: 'Lease target device or tenant does not match agent identity.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 3. RISK-R05: Replay & Active Duplicate Task Check
    const existingStatus = this.getScheduledTaskStatus(
      request.task_id,
      request.leaseHeader.tenant_id,
    );
    if (existingStatus === 'RUNNING' || existingStatus === 'QUEUED') {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'DUPLICATE_TASK_ID',
        errorMessage: `Task ID '${request.task_id}' is already executing or queued.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 4. RISK-R03: Derive Priority (Untrusted callers cannot escalate to CRITICAL)
    let priorityLane: QueuePriorityLane = 'NORMAL';
    if (
      request.payload?.isCritical === true &&
      request.leaseHeader.scopes?.includes('agent:foundation')
    ) {
      priorityLane = 'CRITICAL';
    } else if (request.payload?.isInteractive === true) {
      priorityLane = 'INTERACTIVE';
    } else if (request.payload?.isBackground === true) {
      priorityLane = 'BACKGROUND';
    }

    const now = Date.now();
    const expiresAt = request.leaseHeader.expires_at
      ? new Date(request.leaseHeader.expires_at).getTime()
      : now + 900000;

    const item: ScheduledTaskItem = {
      request,
      priorityLane,
      tenantId: request.leaseHeader.tenant_id,
      queuedAt: now,
      expiresAt,
      retryCount: 0,
    };

    // 5. RISK-R04 & R08: Admission Control (Queue Saturation & Per-Tenant Quotas)
    const enqueued = this.queue.enqueue(item);
    if (!enqueued) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'QUEUE_SATURATED',
        errorMessage: 'Execution queue capacity or tenant quota exceeded.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 6. Durable State Checkpoint
    if (this.stateManager) {
      const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
      if (!index.includes(request.task_id)) {
        index.push(request.task_id);
        await this.stateManager.set('task_queue_index', index);
      }
      await this.stateManager.set(`task_queue:${request.task_id}`, item);
      await this.stateManager.set(`task_checkpoint:${request.task_id}`, {
        taskId: request.task_id,
        stepId: request.step_id,
        status: 'QUEUED',
        correlationId: request.correlation_id,
        timestamp: new Date().toISOString(),
      });
    }

    // 7. Telemetry Event Emission
    if (this.telemetrySpool?.enqueueEventEnvelope) {
      this.telemetrySpool.enqueueEventEnvelope({
        schema_id: 'schema:nexusos:task:queued:v1',
        version: '1.0.0',
        event_id: crypto.randomUUID(),
        correlation_id: request.correlation_id,
        occurred_at: new Date().toISOString(),
        producer_id: identity.deviceId,
        payload: {
          taskId: request.task_id,
          stepId: request.step_id,
          priorityLane,
        },
      });
    }

    // 8. Trigger Queue Processing
    return await this.processDispatch(item, startTime);
  }

  public async initialize(): Promise<void> {
    if (!this.stateManager) {
      return;
    }

    // Restore persisted queued tasks from StateManager via index
    const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
    const remainingIndex: string[] = [];
    const now = Date.now();

    for (const taskId of index) {
      try {
        const key = `task_queue:${taskId}`;
        const item = (await this.stateManager.get(key)) as ScheduledTaskItem | null;
        if (!item || !item.request || !item.request.leaseHeader) {
          await this.stateManager.delete(key);
          continue;
        }

        // Re-validate lease header upon restoration
        const leaseDecision = await this.leaseBoundary.validateLease(
          item.request.leaseHeader,
          undefined,
        );

        if (!leaseDecision.valid || now > item.expiresAt) {
          await this.stateManager.set(`task_checkpoint:${item.request.task_id}`, {
            taskId: item.request.task_id,
            status: 'EXPIRED',
            timestamp: new Date().toISOString(),
          });
          await this.stateManager.delete(key);
          continue;
        }

        this.queue.enqueue(item);
        remainingIndex.push(taskId);
      } catch {
        await this.stateManager.delete(`task_queue:${taskId}`);
      }
    }

    await this.stateManager.set('task_queue_index', remainingIndex);
    void this.processNextItem();
  }

  private async processDispatch(
    item: ScheduledTaskItem,
    startTime: number,
  ): Promise<TaskExecutionResult> {
    // If orchestrator is free, dispatch immediately
    if (this.orchestrator.getActiveCount() < 5) {
      const removed = this.queue.remove(item.request.task_id, item.tenantId);
      if (removed) {
        if (this.stateManager) {
          const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
          await this.stateManager.set(
            'task_queue_index',
            index.filter((id) => id !== item.request.task_id),
          );
          await this.stateManager.delete(`task_queue:${item.request.task_id}`);
        }
        return await this.executeTaskInOrchestrator(item, startTime);
      }
    }

    // Otherwise, task remains queued for background processing
    void this.processNextItem();
    return {
      success: true,
      taskId: item.request.task_id,
      stepId: item.request.step_id,
      output: { status: 'QUEUED', message: 'Task queued for execution.' },
      executionTimeMs: Date.now() - startTime,
    };
  }

  private async processNextItem(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      while (this.orchestrator.getActiveCount() < 5 && this.queue.getSize() > 0) {
        const item = this.queue.dequeue();
        if (!item) {
          break;
        }

        const now = Date.now();
        // RISK-R07: Queue Expiration Race Handling
        if (now > item.expiresAt) {
          if (this.stateManager) {
            await this.stateManager.set(`task_checkpoint:${item.request.task_id}`, {
              taskId: item.request.task_id,
              status: 'EXPIRED',
              timestamp: new Date().toISOString(),
            });
            const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
            await this.stateManager.set(
              'task_queue_index',
              index.filter((id) => id !== item.request.task_id),
            );
            await this.stateManager.delete(`task_queue:${item.request.task_id}`);
          }
          continue;
        }

        if (this.stateManager) {
          const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
          await this.stateManager.set(
            'task_queue_index',
            index.filter((id) => id !== item.request.task_id),
          );
          await this.stateManager.delete(`task_queue:${item.request.task_id}`);
        }

        const result = await this.executeTaskInOrchestrator(item, now);

        // Retry handling for transient retryable errors
        if (!result.success && this.isRetryableError(result.errorCode) && item.retryCount < 3) {
          await this.scheduleRetry(item, result.errorMessage);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeTaskInOrchestrator(
    item: ScheduledTaskItem,
    _startTime: number,
  ): Promise<TaskExecutionResult> {
    const result = await this.orchestrator.executeTask(item.request);

    // If concurrency limit was hit unexpectedly during dispatch, re-enqueue
    if (!result.success && result.errorCode === 'CONCURRENCY_EXCEEDED') {
      this.queue.enqueue(item);
      if (this.stateManager) {
        const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
        if (!index.includes(item.request.task_id)) {
          index.push(item.request.task_id);
          await this.stateManager.set('task_queue_index', index);
        }
        await this.stateManager.set(`task_queue:${item.request.task_id}`, item);
      }
    }

    return result;
  }

  private isRetryableError(errorCode?: string): boolean {
    return (
      errorCode === 'NETWORK_TIMEOUT' ||
      errorCode === 'RATE_LIMITED' ||
      errorCode === 'PROVIDER_CAPACITY' ||
      errorCode === 'TRANSIENT_ERROR'
    );
  }

  private async scheduleRetry(item: ScheduledTaskItem, errorMessage?: string): Promise<void> {
    item.retryCount++;
    const backoffDelay = Math.min(
      30000,
      1000 * Math.pow(2, item.retryCount - 1) * (0.8 + Math.random() * 0.4),
    );
    item.nextRetryAt = Date.now() + backoffDelay;
    item.priorityLane = 'RETRY';

    this.queue.enqueue(item);

    if (this.stateManager) {
      const index = (await this.stateManager.get<string[]>('task_queue_index')) || [];
      if (!index.includes(item.request.task_id)) {
        index.push(item.request.task_id);
        await this.stateManager.set('task_queue_index', index);
      }
      await this.stateManager.set(`task_queue:${item.request.task_id}`, item);
      await this.stateManager.set(`task_checkpoint:${item.request.task_id}`, {
        taskId: item.request.task_id,
        status: 'PAUSED',
        retryCount: item.retryCount,
        nextRetryAt: new Date(item.nextRetryAt).toISOString(),
        errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    if (this.telemetrySpool?.enqueueEventEnvelope) {
      const identity = await this.identityProvider.getIdentity();
      this.telemetrySpool.enqueueEventEnvelope({
        schema_id: 'schema:nexusos:task:retry_scheduled:v1',
        version: '1.0.0',
        event_id: crypto.randomUUID(),
        correlation_id: item.request.correlation_id,
        occurred_at: new Date().toISOString(),
        producer_id: identity.deviceId,
        payload: {
          taskId: item.request.task_id,
          retryCount: item.retryCount,
          nextRetryAt: item.nextRetryAt,
        },
      });
    }
  }

  private startMaintenanceLoop(): void {
    this.maintenanceTimer = setInterval(() => {
      const now = Date.now();
      this.queue.pruneExpired(now);
      this.queue.applyAging(now);
      void this.processNextItem();
    }, 5000);

    if (typeof this.maintenanceTimer.unref === 'function') {
      this.maintenanceTimer.unref();
    }
  }

  public shutdown(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }
  }
}
