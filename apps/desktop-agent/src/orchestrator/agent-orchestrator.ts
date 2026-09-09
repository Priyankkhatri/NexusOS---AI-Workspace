import crypto from 'node:crypto';
import {
  ApprovalDecisionResult,
  ApprovalPromptRequest,
  EventEnvelope,
  isHighRiskCapability,
} from '@nexusos/contracts';
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
import { LocalAiRuntime } from '../runtimes/local-ai/index.js';
import type { NativeApprovalHost } from '../ui/approval-host.js';
import type { TrayUIController } from '../ui/tray-controller.js';

import {
  IAgentOrchestrator,
  TaskExecutionRequest,
  TaskExecutionResult,
  TaskStatus,
} from './types.js';
import { RuntimeRouter } from './runtime-router.js';

interface TaskRecord {
  status: TaskStatus;
  tenantId: string;
}

export class AgentOrchestrator implements IAgentOrchestrator {
  private activeCount = 0;
  private readonly maxConcurrency = 5;
  private readonly maxReplayCacheSize = 10000;
  private readonly processedMessageIds = new Map<string, number>();
  private readonly taskStateMap = new Map<string, TaskRecord>();
  private readonly activeCancellations = new Map<string, AbortController>();
  private readonly taskPendingPrompts = new Map<string, string>();
  private stateMutexPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly _config: DesktopAgentConfig,
    private readonly identityProvider: AgentIdentityProvider,
    private readonly controlPlaneClient: ControlPlaneClient,
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly runtimeRouter: RuntimeRouter,
    private readonly stateManager?: StateManager,
    private readonly memoryCache?: MemoryCacheManager,
    private readonly telemetrySpool?: TelemetrySpool,
    private readonly redactionFilter?: RedactionFilter,
    private readonly notificationManager?: NotificationManager,
    private readonly _secretsVault?: SecretsVaultClient,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
    private readonly filesystemRuntime?: FilesystemRuntime,
    private readonly terminalRuntime?: TerminalRuntime,
    private readonly browserRuntime?: BrowserRuntime,
    private readonly pluginRuntime?: PluginRuntime,
    private readonly deviceRuntime?: DeviceRuntime,
    private readonly localAiRuntime?: LocalAiRuntime,
    private approvalHost?: NativeApprovalHost,
    private trayController?: TrayUIController,
  ) {
    void this._config;
    void this._secretsVault;
  }

  public setApprovalHost(approvalHost: NativeApprovalHost): void {
    this.approvalHost = approvalHost;
  }

  public setTrayController(trayController: TrayUIController): void {
    this.trayController = trayController;
  }

  public getApprovalHost(): NativeApprovalHost | undefined {
    return this.approvalHost;
  }

  public getTrayController(): TrayUIController | undefined {
    return this.trayController;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getTaskStatus(taskId: string, tenantId?: string): TaskStatus | null {
    const record = this.taskStateMap.get(taskId);
    if (!record) {
      return null;
    }
    if (tenantId && record.tenantId !== tenantId) {
      return null; // VULNERABILITY-Q08: Fail closed on cross-tenant status probing
    }
    return record.status;
  }

  public async cancelTask(
    taskId: string,
    tenantIdOrReason?: string,
    _reason?: string,
  ): Promise<boolean> {
    // Handle overload: cancelTask(taskId, tenantId, reason) vs cancelTask(taskId, reason)
    let targetTenantId: string | undefined;
    if (tenantIdOrReason && tenantIdOrReason.includes('-')) {
      targetTenantId = tenantIdOrReason;
    }

    return this.withTaskStateLock(async () => {
      const record = this.taskStateMap.get(taskId);
      if (!record) {
        return false;
      }

      // VULNERABILITY-Q07: Reject cross-tenant task cancellation
      if (targetTenantId && record.tenantId !== targetTenantId) {
        return false;
      }

      const currentStatus = record.status;
      if (
        currentStatus === 'COMPLETED' ||
        currentStatus === 'FAILED' ||
        currentStatus === 'CANCELED'
      ) {
        return false;
      }

      this.taskStateMap.set(taskId, { status: 'CANCELED', tenantId: record.tenantId });
      const controller = this.activeCancellations.get(taskId);
      if (controller) {
        controller.abort();
      }

      // Clean up any pending approval prompt
      const pendingPromptId = this.taskPendingPrompts.get(taskId);
      if (pendingPromptId && this.approvalHost) {
        this.approvalHost.cancelPrompt(pendingPromptId, 'Task cancelled');
        this.taskPendingPrompts.delete(taskId);
        if (this.trayController) {
          this.trayController.setPendingApprovalCount(
            this.approvalHost.listPendingPrompts().length,
          );
        }
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

    // 1. VULNERABILITY-Q04: Lifecycle Readiness Gate Check (Entry)
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

    // 2. VULNERABILITY-Q10: Reject Duplicate Active Task Execution (Collision Protection)
    const existingRecord = this.taskStateMap.get(request.task_id);
    if (
      existingRecord &&
      (existingRecord.status === 'RUNNING' || existingRecord.status === 'QUEUED')
    ) {
      return {
        success: false,
        taskId: request.task_id,
        stepId: request.step_id,
        errorCode: 'DUPLICATE_TASK_ID',
        errorMessage: `Task ID '${request.task_id}' is already executing.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 3. VULNERABILITY-Q02 & Q09: Bounded Replay Attack Protection (15 min TTL, Bounded Map)
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

    // 4. VULNERABILITY-Q01 & Q03: Lease Validation & Tenant/Device Binding
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

    // 5. Runtime & Capability Match Resolution
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

    // 6. Timeout Validation (Default 30s, Max 300s)
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

    // 7. VULNERABILITY-Q13: TOCTOU Lifecycle Gate Re-check Before Concurrency Reservation
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
          errorMessage: 'Agent entered shutdown state during execution setup.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // 8. Synchronous Concurrency Reservation (Prevents O11 Race)
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
      // Checkpoint RUNNING state
      await this.withTaskStateLock(async () => {
        this.taskStateMap.set(request.task_id, {
          status: 'RUNNING',
          tenantId: request.leaseHeader.tenant_id,
        });
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

      // 9. VULNERABILITY-Q11: Execute Tool Runtime with Propagated Abort Signal & Timeout
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

      // 10. Human-in-the-Loop (HITL) Approval Interception (Task 052)
      let approvalReceiptHash: string | undefined;
      const requiresApproval =
        request.requiresApproval === true ||
        (request.payload as Record<string, unknown>)?.requiresApproval === true ||
        isHighRiskCapability(request.capabilityId, request.riskTier, request.actionIdentifier);

      if (requiresApproval && !this.approvalHost && request.requiresApproval === true) {
        clearTimeout(timeoutTimer);
        return {
          success: false,
          taskId: request.task_id,
          stepId: request.step_id,
          errorCode: 'APPROVAL_REQUIRED',
          errorMessage:
            'Human approval is required for high-risk capabilities but no approval host is configured.',
          executionTimeMs: Date.now() - startTime,
        };
      }

      if (requiresApproval && this.approvalHost) {
        // Checkpoint AWAITING_APPROVAL state
        await this.withTaskStateLock(async () => {
          this.taskStateMap.set(request.task_id, {
            status: 'AWAITING_APPROVAL',
            tenantId: request.leaseHeader.tenant_id,
          });
        });

        if (this.stateManager) {
          await this.stateManager.set(`task_checkpoint:${request.task_id}`, {
            taskId: request.task_id,
            stepId: request.step_id,
            status: 'AWAITING_APPROVAL',
            correlationId: request.correlation_id,
            timestamp: new Date().toISOString(),
          });
        }

        const promptReq: ApprovalPromptRequest = {
          leaseHeader: request.leaseHeader,
          requestId: request.task_id,
          taskId: request.task_id,
          stepId: request.step_id,
          title: request.title || `Authorize Execution: ${request.capabilityId}`,
          description:
            request.description ||
            `Task '${request.task_id}' requests execution of high-risk capability '${request.capabilityId}'. Please authorize to proceed.`,
          riskTier: request.riskTier || 'HIGH',
          actionIdentifier: request.actionIdentifier || request.capabilityId,
          capabilityId: request.capabilityId,
          targetResource: request.targetResource,
          reversibility: request.reversibility,
          tenantId: request.leaseHeader.tenant_id,
          deviceId: identity.deviceId,
          ttlSeconds: 60,
        };

        const prompt = await this.approvalHost.presentPrompt(promptReq);
        this.taskPendingPrompts.set(request.task_id, prompt.promptId);

        if (this.trayController) {
          this.trayController.setPendingApprovalCount(
            this.approvalHost.listPendingPrompts().length,
          );
        }

        try {
          const decisionResult: ApprovalDecisionResult = await this.approvalHost.waitForDecision(
            prompt.promptId,
            abortController.signal,
          );

          this.taskPendingPrompts.delete(request.task_id);

          if (this.trayController) {
            this.trayController.setPendingApprovalCount(
              this.approvalHost.listPendingPrompts().length,
            );
          }

          if (decisionResult.state === 'EXPIRED') {
            clearTimeout(timeoutTimer);
            await this.withTaskStateLock(async () => {
              this.taskStateMap.set(request.task_id, {
                status: 'FAILED',
                tenantId: request.leaseHeader.tenant_id,
              });
            });
            return {
              success: false,
              taskId: request.task_id,
              stepId: request.step_id,
              errorCode: 'APPROVAL_EXPIRED',
              errorMessage: `Approval request '${prompt.promptId}' expired after 60 seconds without authorization.`,
              executionTimeMs: Date.now() - startTime,
            };
          }

          if (decisionResult.decision === 'DENY' || decisionResult.state === 'DENIED') {
            clearTimeout(timeoutTimer);
            await this.withTaskStateLock(async () => {
              this.taskStateMap.set(request.task_id, {
                status: 'FAILED',
                tenantId: request.leaseHeader.tenant_id,
              });
            });
            return {
              success: false,
              taskId: request.task_id,
              stepId: request.step_id,
              errorCode: 'APPROVAL_DENIED',
              errorMessage: `Human approval was denied for capability '${request.capabilityId}'.`,
              executionTimeMs: Date.now() - startTime,
            };
          }

          // Human approved: record receipt hash and transition back to RUNNING
          approvalReceiptHash = decisionResult.receiptHash;

          await this.withTaskStateLock(async () => {
            this.taskStateMap.set(request.task_id, {
              status: 'RUNNING',
              tenantId: request.leaseHeader.tenant_id,
            });
          });

          if (this.telemetrySpool?.enqueueEventEnvelope) {
            this.telemetrySpool.enqueueEventEnvelope({
              schema_id: 'schema:nexusos:approval:decision:v1',
              version: '1.0.0',
              event_id: crypto.randomUUID(),
              correlation_id: request.correlation_id,
              occurred_at: new Date(decisionResult.resolvedAt).toISOString(),
              producer_id: identity.deviceId,
              payload: {
                promptId: decisionResult.promptId,
                requestId: decisionResult.requestId,
                taskId: request.task_id,
                stepId: request.step_id,
                tenantId: request.leaseHeader.tenant_id,
                capabilityId: request.capabilityId,
                decision: decisionResult.decision,
                state: decisionResult.state,
                resolvedAt: decisionResult.resolvedAt,
                receiptHash: decisionResult.receiptHash,
                leaseId: request.leaseHeader.lease_id,
              },
            });
          }
        } catch (err: unknown) {
          this.taskPendingPrompts.delete(request.task_id);
          if (this.trayController) {
            this.trayController.setPendingApprovalCount(
              this.approvalHost.listPendingPrompts().length,
            );
          }

          if (abortController.signal.aborted) {
            clearTimeout(timeoutTimer);
            return {
              success: false,
              taskId: request.task_id,
              stepId: request.step_id,
              errorCode: isTimedOut ? 'TASK_TIMEOUT' : 'TASK_CANCELED',
              errorMessage: isTimedOut
                ? `Task execution timed out after ${timeoutMs}ms.`
                : 'Task execution was canceled.',
              executionTimeMs: Date.now() - startTime,
            };
          }

          throw err;
        }
      }

      let executionOutput: unknown;
      let executionError: Error | undefined;

      const rawPayload = (request.payload as Record<string, unknown>) || {};
      const runtimePayload = {
        ...rawPayload,
        signal: abortController.signal,
        leaseHeader: rawPayload.leaseHeader ?? request.leaseHeader,
        taskId: rawPayload.taskId ?? request.task_id,
        stepId: rawPayload.stepId ?? request.step_id,
        correlationId: rawPayload.correlationId ?? request.correlation_id,
        capabilityId: rawPayload.capabilityId ?? request.capabilityId,
      };

      try {
        const category = request.runtimeCategory.toLowerCase();
        if ((category === 'filesystem' || category === 'fs') && this.filesystemRuntime) {
          const fsRes = await (
            this.filesystemRuntime as unknown as { execute: (p: unknown) => Promise<unknown> }
          ).execute(runtimePayload);
          if (
            fsRes &&
            typeof fsRes === 'object' &&
            'success' in fsRes &&
            (fsRes as { success: boolean }).success === false
          ) {
            const errObj = (fsRes as { error?: { code?: string; message?: string } }).error;
            const err = new Error(errObj?.message || 'Filesystem operation failed');
            (err as unknown as { code: string }).code =
              errObj?.code || 'FILESYSTEM_OPERATION_FAILED';
            throw err;
          }
          executionOutput = fsRes;
        } else if (category === 'terminal' && this.terminalRuntime) {
          executionOutput = await (
            this.terminalRuntime as unknown as { execute: (p: unknown) => Promise<unknown> }
          ).execute(runtimePayload);
        } else if (category === 'browser' && this.browserRuntime) {
          executionOutput = await (
            this.browserRuntime as unknown as { execute: (p: unknown) => Promise<unknown> }
          ).execute(runtimePayload);
        } else if (category === 'plugin' && this.pluginRuntime) {
          executionOutput = await (
            this.pluginRuntime as unknown as { execute: (p: unknown) => Promise<unknown> }
          ).execute(runtimePayload);
        } else if (category === 'device' && this.deviceRuntime) {
          executionOutput = await this.deviceRuntime.execute(runtimePayload as never);
        } else if (
          (category === 'localai' || category === 'local-ai' || category === 'local_ai') &&
          this.localAiRuntime
        ) {
          const aiRes = await this.localAiRuntime.execute(runtimePayload as any);
          if (
            aiRes &&
            typeof aiRes === 'object' &&
            'success' in aiRes &&
            (aiRes as { success: boolean }).success === false
          ) {
            const errStr = (aiRes as { error?: string }).error || 'LOCAL_AI_EXECUTION_FAILED';
            const err = new Error(errStr);
            (err as unknown as { code: string }).code = errStr;
            throw err;
          }
          executionOutput = aiRes;
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

      // 10. VULNERABILITY-Q12: String and Object Output Redaction
      let redactedOutput: unknown = executionOutput;
      let redactedErrorMessage: string | undefined = executionError?.message;

      if (this.redactionFilter) {
        if (typeof executionOutput === 'string') {
          redactedOutput = this.redactionFilter.redactString(executionOutput);
        } else if (executionOutput && typeof executionOutput === 'object') {
          redactedOutput = this.redactionFilter.redactObject(executionOutput);
        }
        if (redactedErrorMessage) {
          redactedErrorMessage = this.redactionFilter.redactString(redactedErrorMessage);
        }
      }

      // 11. Deterministic Cancellation / Completion Resolution
      return await this.withTaskStateLock(async () => {
        const currentRecord = this.taskStateMap.get(request.task_id);
        const currentStatus = currentRecord?.status;
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
            errorCode: (executionError as { code?: string }).code || 'EXECUTION_ERROR',
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
            approvalReceiptHash,
            approvalDecision: approvalReceiptHash ? 'ALLOW' : undefined,
          };
        }

        this.taskStateMap.set(request.task_id, {
          status: finalStatus,
          tenantId: request.leaseHeader.tenant_id,
        });

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
    // 1. Delete expired entries
    for (const [key, expiresAt] of this.processedMessageIds.entries()) {
      if (now > expiresAt) {
        this.processedMessageIds.delete(key);
      }
    }
    // 2. VULNERABILITY-Q09: Hard cap size ceiling (FIFO eviction if over 10000 entries)
    if (this.processedMessageIds.size >= this.maxReplayCacheSize) {
      const keys = Array.from(this.processedMessageIds.keys());
      const toEvict = keys.slice(0, 2000);
      for (const k of toEvict) {
        this.processedMessageIds.delete(k);
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
