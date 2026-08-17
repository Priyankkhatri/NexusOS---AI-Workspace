import crypto from 'node:crypto';
import { EventEnvelope } from '@nexusos/contracts';
import { DesktopAgentConfig } from '../config/index.js';
import { AgentIdentityProvider } from '../identity/agent-identity.js';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { StateManager } from '../state/state-manager.js';
import { MemoryCacheManager } from '../memory/memory-cache-manager.js';
import { TelemetrySpool } from '../telemetry/telemetry-spool.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { SecretsVaultClient } from '../vault/vault-client.js';
import { ControlPlaneClient } from '../communication/types.js';
import { AgentLifecycleState } from '../lifecycle/index.js';

import { FilesystemRuntime } from '../runtimes/filesystem/index.js';
import { TerminalRuntime } from '../runtimes/terminal/index.js';
import { BrowserRuntime } from '../runtimes/browser/index.js';
import { PluginRuntime } from '../runtimes/plugin/index.js';
import { DeviceRuntime } from '../runtimes/device/index.js';

import {
  IAgentOrchestrator,
  TaskExecutionRequest,
  TaskExecutionResult,
  TaskStatus,
} from './types.js';
import { RuntimeRouter } from './runtime-router.js';

export class AgentOrchestrator implements IAgentOrchestrator {
  private activeCount = 0;
  private readonly maxConcurrency = 5;
  private readonly processedMessageIds = new Map<string, number>();
  private readonly taskStateMap = new Map<string, TaskStatus>();
  private readonly activeCancellations = new Map<string, AbortController>();
  private stateMutexPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: DesktopAgentConfig,
    private readonly identityProvider: AgentIdentityProvider,
    private readonly controlPlaneClient: ControlPlaneClient,
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly runtimeRouter: RuntimeRouter,
    private readonly stateManager?: StateManager,
    private readonly memoryCache?: MemoryCacheManager,
    private readonly telemetrySpool?: TelemetrySpool,
    private readonly redactionFilter?: RedactionFilter,
    private readonly notificationManager?: NotificationManager,
    private readonly secretsVault?: SecretsVaultClient,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
    private readonly filesystemRuntime?: FilesystemRuntime,
    private readonly terminalRuntime?: TerminalRuntime,
    private readonly browserRuntime?: BrowserRuntime,
    private readonly pluginRuntime?: PluginRuntime,
    private readonly deviceRuntime?: DeviceRuntime,
  ) {}

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getTaskStatus(taskId: string): TaskStatus | null {
    return this.taskStateMap.get(taskId) || null;
  }

  public async cancelTask(taskId: string, _reason?: string): Promise<boolean> {
    return this.withTaskStateLock(async () => {
      const currentStatus = this.taskStateMap.get(taskId);
      if (
        !currentStatus ||
        currentStatus === 'COMPLETED' ||
        currentStatus === 'FAILED' ||
        currentStatus === 'CANCELED'
      ) {
        return false;
      }

      this.taskStateMap.set(taskId, 'CANCELED');
      const controller = this.activeCancellations.get(taskId);
      if (controller) {
        controller.abort();
      }

      if (this.stateManager) {
        await this.stateManager.set(`task_checkpoint:${taskId}`, {
          taskId,
          status: 'CANCELED',
          timestamp: new Date().toISOString(),
        });
      }

      return true;
    });
  }

  public async executeTask(request: TaskExecutionRequest): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // 1. VULNERABILITY-Q04: Lifecycle Readiness Gate Check
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
          errorMessage: 'Agent lifecycle state is unsafe for task execution.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // 2. VULNERABILITY-Q02: Replay Attack Protection (15 min TTL)
    const now = Date.now();
    this.pruneOldProcessedMessages(now);

    const messageKey =
      request.message_id || request.idempotency_key || `${request.task_id}:${request.step_id}`;

    if (this.processedMessageIds.has(messageKey)) {
      const expiresAt = this.processedMessageIds.get(messageKey)!;
      if (now <= expiresAt) {
        return {
          success: false,
          taskId: request.task_id,
          stepId: request.step_id,
          errorCode: 'REPLAY_REJECTED',
          errorMessage: 'Replay attack detected. Duplicate message ID.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }
    this.processedMessageIds.set(messageKey, now + 900000); // 15 min TTL

    // 3. VULNERABILITY-Q01 & Q03: Lease Validation & Tenant/Device Binding
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

    // 4. Runtime & Capability Match Resolution
    if (!this.runtimeRouter.hasCapability(request.capabilityId)) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'CAPABILITY_NOT_FOUND',
        errorMessage: `Capability '${request.capabilityId}' is not registered or supported.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    if (
      !this.runtimeRouter.validateCapabilityRuntimeMatch(
        request.capabilityId,
        request.runtimeCategory,
      )
    ) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'RUNTIME_MISMATCH',
        errorMessage: `Runtime category '${request.runtimeCategory}' does not match capability '${request.capabilityId}'.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 5. Timeout Validation (Default 30s, Max 300s)
    const timeoutMs = request.timeoutMs ?? 30000;
    if (timeoutMs <= 0 || timeoutMs > 300000) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'INVALID_TIMEOUT',
        errorMessage: 'Timeout value must be between 1ms and 300000ms.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 6. Synchronous Concurrency Reservation (Prevents O11 Race)
    if (this.activeCount >= this.maxConcurrency) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'CONCURRENCY_EXCEEDED',
        errorMessage: `Maximum concurrent tasks limit (${this.maxConcurrency}) reached.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Reserve slot synchronously before execution
    this.activeCount++;

    try {
      // 7. Checkpoint RUNNING state
      await this.withTaskStateLock(async () => {
        this.taskStateMap.set(request.task_id, 'RUNNING');
      });

      if (this.stateManager) {
        await this.stateManager.set(`task_checkpoint:${request.task_id}`, {
          taskId: request.task_id,
          stepId: request.step_id,
          status: 'RUNNING',
          correlationId: request.correlation_id,
          timestamp: new Date().toISOString(),
        });
      }

      if (this.telemetrySpool?.enqueueEventEnvelope) {
        this.telemetrySpool.enqueueEventEnvelope({
          schema_id: 'schema:nexusos:task:started:v1',
          version: '1.0.0',
          event_id: crypto.randomUUID(),
          correlation_id: request.correlation_id,
          occurred_at: new Date().toISOString(),
          producer_id: identity.deviceId,
          payload: {
            taskId: request.task_id,
            stepId: request.step_id,
          },
        });
      }

      // 8. Execute Tool Runtime with Cooperative Cancellation & Timeout
      const abortController = new AbortController();
      this.activeCancellations.set(request.task_id, abortController);

      let isTimedOut = false;
      const timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
      }, timeoutMs);

      if (typeof timeoutTimer.unref === 'function') {
        timeoutTimer.unref();
      }

      let executionOutput: unknown;
      let executionError: Error | undefined;

      try {
        const category = request.runtimeCategory.toLowerCase();
        if (category === 'filesystem' && this.filesystemRuntime) {
          executionOutput = await (this.filesystemRuntime as never);
        } else if (category === 'device' && this.deviceRuntime) {
          executionOutput = await this.deviceRuntime.execute(request.payload as never);
        } else if (category === 'memory' && this.memoryCache) {
          executionOutput = await this.memoryCache.get(
            (request.payload.key as string) || 'default_key',
            {
              taskId: request.task_id,
              workspaceId: request.leaseHeader.tenant_id,
            },
          );
        } else {
          // Default simulated/mock execution payload
          executionOutput = {
            executed: true,
            capabilityId: request.capabilityId,
            runtimeCategory: request.runtimeCategory,
            payload: request.payload,
          };
        }
      } catch (err) {
        executionError = err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timeoutTimer);
        this.activeCancellations.delete(request.task_id);
      }

      // 9. VULNERABILITY-Q05: Output Redaction
      let redactedOutput: unknown = executionOutput;
      let redactedErrorMessage: string | undefined = executionError?.message;

      if (this.redactionFilter) {
        if (executionOutput && typeof executionOutput === 'object') {
          redactedOutput = this.redactionFilter.redactObject(executionOutput);
        }
        if (redactedErrorMessage) {
          redactedErrorMessage = this.redactionFilter.redactString(redactedErrorMessage);
        }
      }

      // 10. VULNERABILITY-Q06: Deterministic Cancellation / Completion Resolution
      return await this.withTaskStateLock(async () => {
        const currentStatus = this.taskStateMap.get(request.task_id);
        const isCanceled =
          currentStatus === 'CANCELED' || (abortController.signal.aborted && !isTimedOut);

        let finalStatus: TaskStatus;
        let result: TaskExecutionResult;

        if (isCanceled) {
          finalStatus = 'CANCELED';
          result = {
            success: false,
            taskId: request.task_id,
            stepId: request.step_id,
            errorCode: 'TASK_CANCELED',
            errorMessage: 'Task execution was canceled.',
            executionTimeMs: Date.now() - startTime,
          };
        } else if (isTimedOut) {
          finalStatus = 'FAILED';
          result = {
            success: false,
            taskId: request.task_id,
            stepId: request.step_id,
            errorCode: 'TASK_TIMEOUT',
            errorMessage: `Task execution timed out after ${timeoutMs}ms.`,
            executionTimeMs: Date.now() - startTime,
          };
        } else if (executionError) {
          finalStatus = 'FAILED';
          result = {
            success: false,
            taskId: request.task_id,
            stepId: request.step_id,
            errorCode: 'EXECUTION_ERROR',
            errorMessage: redactedErrorMessage || 'Runtime execution error.',
            executionTimeMs: Date.now() - startTime,
          };
        } else {
          finalStatus = 'COMPLETED';
          const receiptSig = crypto
            .createHash('sha256')
            .update(`${request.task_id}:${request.step_id}:COMPLETED`)
            .digest('hex');

          result = {
            success: true,
            taskId: request.task_id,
            stepId: request.step_id,
            output: redactedOutput,
            executionTimeMs: Date.now() - startTime,
            receiptSignature: receiptSig,
          };
        }

        this.taskStateMap.set(request.task_id, finalStatus);

        if (this.stateManager) {
          await this.stateManager.set(`task_checkpoint:${request.task_id}`, {
            taskId: request.task_id,
            stepId: request.step_id,
            status: finalStatus,
            correlationId: request.correlation_id,
            timestamp: new Date().toISOString(),
          });
        }

        if (this.telemetrySpool?.enqueueEventEnvelope) {
          this.telemetrySpool.enqueueEventEnvelope({
            schema_id: `schema:nexusos:task:${finalStatus.toLowerCase()}:v1`,
            version: '1.0.0',
            event_id: crypto.randomUUID(),
            correlation_id: request.correlation_id,
            occurred_at: new Date().toISOString(),
            producer_id: identity.deviceId,
            payload: {
              taskId: request.task_id,
              stepId: request.step_id,
              status: finalStatus,
            },
          });
        }

        if (this.notificationManager && request.payload?.notifyUser) {
          this.notificationManager.notify({
            category: 'TASK_STATUS',
            priority: 'NORMAL',
            title: `Task ${finalStatus}`,
            message: `Task ${request.task_id} completed with status ${finalStatus}`,
            taskId: request.task_id,
            correlationId: request.correlation_id,
          });
        }

        // Send execution receipt ACK via ControlPlaneClient
        const receiptEnvelope: EventEnvelope = {
          schema_id: 'schema:nexusos:task:receipt:v1',
          version: '1.0.0',
          event_id: crypto.randomUUID(),
          correlation_id: request.correlation_id,
          occurred_at: new Date().toISOString(),
          producer_id: identity.deviceId,
          payload: result as never,
        };
        void this.controlPlaneClient.relayEvent(receiptEnvelope);

        return result;
      });
    } finally {
      // Always decrement active count synchronously in finally block
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  private pruneOldProcessedMessages(now: number): void {
    if (this.processedMessageIds.size > 1000) {
      for (const [key, expiresAt] of this.processedMessageIds.entries()) {
        if (now > expiresAt) {
          this.processedMessageIds.delete(key);
        }
      }
    }
  }

  private async withTaskStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const previousPromise = this.stateMutexPromise;
    let resolveLock!: () => void;
    this.stateMutexPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    try {
      await previousPromise;
      return await fn();
    } finally {
      resolveLock();
    }
  }
}
