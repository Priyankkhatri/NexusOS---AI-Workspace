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
import { TaskScheduler } from '../scheduler/task-scheduler.js';
import { TaskExecutionResult, TaskStatus } from '../orchestrator/types.js';
import { WorkflowDAGParser } from './dag-parser.js';
import { WorkflowStepContext } from './step-context.js';
import {
  IWorkflowEngine,
  WorkflowDAG,
  WorkflowExecutionState,
  WorkflowMetrics,
  WorkflowNode,
  WorkflowNodeExecutionState,
} from './types.js';

export type WorkflowTaskStatus = TaskStatus | 'EXPIRED' | 'RECONCILING';

export class WorkflowEngine implements IWorkflowEngine {
  private readonly dagParser: WorkflowDAGParser;
  private readonly activeWorkflows = new Map<string, WorkflowExecutionState>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly stepContexts = new Map<string, WorkflowStepContext>();

  private completedWorkflowsCount = 0;
  private failedWorkflowsCount = 0;

  private maintenanceTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: DesktopAgentConfig,
    private readonly identityProvider: AgentIdentityProvider,
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly orchestrator: AgentOrchestrator,
    private readonly taskScheduler: TaskScheduler,
    private readonly stateManager?: StateManager,
    private readonly telemetrySpool?: TelemetrySpool,
    private readonly redactionFilter?: RedactionFilter,
    private readonly notificationManager?: NotificationManager,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
    private readonly maxActiveWorkflows: number = 10,
    private readonly maxNodesPerWorkflow: number = 50,
  ) {
    this.dagParser = new WorkflowDAGParser(this.maxNodesPerWorkflow);
    void this.config;
    void this.orchestrator;
    void this.redactionFilter;
    void this.notificationManager;
    this.startMaintenanceLoop();
  }

  public getWorkflowMetrics(): WorkflowMetrics {
    return {
      activeWorkflowsCount: this.activeWorkflows.size,
      maxActiveWorkflows: this.maxActiveWorkflows,
      totalCompletedCount: this.completedWorkflowsCount,
      totalFailedCount: this.failedWorkflowsCount,
    };
  }

  public getWorkflowStatus(workflowId: string, tenantId?: string): TaskStatus | null {
    const state = this.activeWorkflows.get(workflowId);
    if (!state) {
      return null;
    }
    if (tenantId && state.tenantId !== tenantId) {
      return null; // Cross-tenant status probing denied
    }

    if (state.status === 'Completed') return 'COMPLETED';
    if (state.status === 'Failed') return 'FAILED';
    if (state.status === 'CANCELED') return 'CANCELED';
    if (state.status === 'EXPIRED' || state.status === 'Reconciling') return 'PAUSED'; // Surface for remote reconciliation
    if (state.status === 'Running' || state.status === 'Starting') return 'RUNNING';
    if (state.status === 'Queued') return 'QUEUED';
    return null;
  }

  public async cancelWorkflow(
    workflowId: string,
    tenantId?: string,
    reason?: string,
  ): Promise<boolean> {
    const state = this.activeWorkflows.get(workflowId);
    if (!state) {
      return false;
    }

    // Cross-tenant cancellation attempt rejected
    if (tenantId && state.tenantId !== tenantId) {
      return false;
    }

    // Abort running node tasks
    const controller = this.abortControllers.get(workflowId);
    if (controller) {
      controller.abort(reason || 'Workflow cancellation requested.');
    }

    state.status = 'CANCELED';
    state.updatedAt = Date.now();

    // Cancel queued nodes in TaskScheduler
    for (const nodeId of state.pendingNodes) {
      await this.taskScheduler.cancelScheduledTask(
        `${workflowId}_${nodeId}`,
        state.tenantId,
        reason,
      );
    }

    await this.persistCheckpoint(state);

    if (this.telemetrySpool?.enqueueEventEnvelope) {
      const identity = await this.identityProvider.getIdentity();
      this.telemetrySpool.enqueueEventEnvelope({
        schema_id: 'schema:nexusos:workflow:canceled:v1',
        version: '1.0.0',
        event_id: crypto.randomUUID(),
        correlation_id: state.correlationId,
        occurred_at: new Date().toISOString(),
        producer_id: identity.deviceId,
        payload: {
          workflowId,
          taskId: state.taskId,
          status: 'CANCELED',
        },
      });
    }

    return true;
  }

  public async executeWorkflow(dag: WorkflowDAG): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // 1. Lifecycle Admission Check
    if (this.getAgentLifecycleState) {
      const state = this.getAgentLifecycleState();
      if (
        state === AgentLifecycleState.STOPPING ||
        state === AgentLifecycleState.STOPPED ||
        state === AgentLifecycleState.FAILED
      ) {
        return {
          success: false,
          taskId: dag.taskId,
          stepId: dag.workflowId,
          errorCode: 'LIFECYCLE_DENIED',
          errorMessage: 'Agent lifecycle state is unsafe for workflow admission.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // 2. Lease Signature & Policy Validation
    const leaseDecision = await this.leaseBoundary.validateLease(dag.leaseHeader, undefined);
    if (!leaseDecision.valid) {
      return {
        success: false,
        taskId: dag.taskId,
        stepId: dag.workflowId,
        errorCode: 'LEASE_DENIED',
        errorMessage: leaseDecision.reason || 'Workflow lease validation failed.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 3. Tenant & Device Context Binding
    const identity = await this.identityProvider.getIdentity();
    if (
      dag.leaseHeader.agent_id !== identity.deviceId ||
      dag.leaseHeader.tenant_id !== identity.pairedTenantId
    ) {
      return {
        success: false,
        taskId: dag.taskId,
        stepId: dag.workflowId,
        errorCode: 'TENANT_DEVICE_MISMATCH',
        errorMessage: 'Workflow lease target device or tenant does not match agent identity.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 3.5 Duplicate Workflow Submission Guard
    if (this.activeWorkflows.has(dag.workflowId)) {
      const existing = this.activeWorkflows.get(dag.workflowId)!;
      // Cross-tenant attempt on an existing workflow is treated as not-found to prevent probing
      if (existing.tenantId !== identity.pairedTenantId) {
        return {
          success: false,
          taskId: dag.taskId,
          stepId: dag.workflowId,
          errorCode: 'WORKFLOW_NOT_FOUND',
          errorMessage: 'Workflow not found for this tenant.',
          executionTimeMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        taskId: dag.taskId,
        stepId: dag.workflowId,
        errorCode: 'DUPLICATE_WORKFLOW_ID',
        errorMessage: `Workflow '${dag.workflowId}' is already active or has not been cleared.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 4. Maximum Active Workflows Limit Check
    if (this.activeWorkflows.size >= this.maxActiveWorkflows) {
      return {
        success: false,
        taskId: dag.taskId,
        stepId: dag.workflowId,
        errorCode: 'WORKFLOW_CAPACITY_EXCEEDED',
        errorMessage: `Active workflows limit (${this.maxActiveWorkflows}) reached.`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 5. Parse & Validate DAG Topology
    const validation = this.dagParser.parseAndValidate(dag);
    if (!validation.valid) {
      return {
        success: false,
        taskId: dag.taskId,
        stepId: dag.workflowId,
        errorCode: validation.errorCode || 'DAG_VALIDATION_FAILED',
        errorMessage: validation.errorMessage || 'Workflow DAG validation failed.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 6. Initialize Workflow Execution State & Context
    const now = Date.now();
    const expiresAt = dag.expiresAt ? new Date(dag.expiresAt).getTime() : now + 3600000;

    const nodeStates: Record<string, WorkflowNodeExecutionState> = {};
    for (const node of dag.nodes) {
      nodeStates[node.nodeId] = {
        nodeId: node.nodeId,
        status: 'Queued',
        retryCount: 0,
      };
    }

    const workflowState: WorkflowExecutionState = {
      workflowId: dag.workflowId,
      taskId: dag.taskId,
      tenantId: dag.leaseHeader.tenant_id,
      deviceId: identity.deviceId,
      correlationId: dag.correlationId,
      status: 'Running',
      nodeStates,
      completedNodes: [],
      pendingNodes: dag.nodes.map((n) => n.nodeId),
      activeNodes: [],
      nodeOutputs: {},
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    const stepContext = new WorkflowStepContext(
      {
        workflowId: dag.workflowId,
        taskId: dag.taskId,
        tenantId: dag.leaseHeader.tenant_id,
        deviceId: identity.deviceId,
        correlationId: dag.correlationId,
        leaseHeader: dag.leaseHeader,
      },
      this.redactionFilter,
    );

    this.activeWorkflows.set(dag.workflowId, workflowState);
    this.abortControllers.set(dag.workflowId, new AbortController());
    this.stepContexts.set(dag.workflowId, stepContext);

    await this.persistCheckpoint(workflowState);

    if (this.telemetrySpool?.enqueueEventEnvelope) {
      this.telemetrySpool.enqueueEventEnvelope({
        schema_id: 'schema:nexusos:workflow:started:v1',
        version: '1.0.0',
        event_id: crypto.randomUUID(),
        correlation_id: dag.correlationId,
        occurred_at: new Date().toISOString(),
        producer_id: identity.deviceId,
        payload: {
          workflowId: dag.workflowId,
          taskId: dag.taskId,
          nodeCount: dag.nodes.length,
        },
      });
    }

    // 7. Execute DAG Tiers
    return await this.executeDAGTiers(dag, validation.executionTiers || [], startTime);
  }

  public async initialize(): Promise<void> {
    if (!this.stateManager) {
      return;
    }

    const index = (await this.stateManager.get<string[]>('workflow_index')) || [];
    const remainingIndex: string[] = [];
    const now = Date.now();

    for (const workflowId of index) {
      try {
        const key = `workflow_checkpoint:${workflowId}`;
        const state = await this.stateManager.get<WorkflowExecutionState>(key);
        if (!state) {
          await this.stateManager.delete(key);
          continue;
        }

        if (
          now > state.expiresAt ||
          state.status === 'Completed' ||
          state.status === 'Failed' ||
          state.status === 'CANCELED'
        ) {
          await this.stateManager.delete(key);
          continue;
        }

        this.activeWorkflows.set(workflowId, state);
        this.abortControllers.set(workflowId, new AbortController());
        remainingIndex.push(workflowId);
      } catch {
        await this.stateManager.delete(`workflow_checkpoint:${workflowId}`);
      }
    }

    await this.stateManager.set('workflow_index', remainingIndex);
  }

  private async executeDAGTiers(
    dag: WorkflowDAG,
    executionTiers: string[][],
    startTime: number,
  ): Promise<TaskExecutionResult> {
    const state = this.activeWorkflows.get(dag.workflowId)!;
    const stepContext = this.stepContexts.get(dag.workflowId)!;
    const nodeMap = new Map(dag.nodes.map((n) => [n.nodeId, n]));

    for (const tier of executionTiers) {
      // Check cancellation/expiration before running tier
      if (state.status === 'CANCELED' || Date.now() > state.expiresAt) {
        state.status = Date.now() > state.expiresAt ? 'EXPIRED' : 'CANCELED';
        await this.persistCheckpoint(state);
        return {
          success: false,
          taskId: dag.taskId,
          stepId: dag.workflowId,
          errorCode: state.status,
          errorMessage: `Workflow execution ${state.status.toLowerCase()}.`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Re-validate lease immediately at dispatch boundary
      const leaseDecision = await this.leaseBoundary.validateLease(dag.leaseHeader, undefined);
      if (!leaseDecision.valid) {
        state.status = 'EXPIRED';
        await this.persistCheckpoint(state);
        return {
          success: false,
          taskId: dag.taskId,
          stepId: dag.workflowId,
          errorCode: 'LEASE_DENIED',
          errorMessage:
            leaseDecision.reason || 'Lease validation failed at node dispatch boundary.',
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Execute all nodes in the current tier concurrently
      const tierResults = await Promise.all(
        tier.map((nodeId) => this.executeSingleNode(dag, nodeMap.get(nodeId)!, stepContext)),
      );

      const failedResult = tierResults.find((r) => !r.success);
      if (failedResult) {
        // Handle step failure: execute compensation for completed nodes
        state.status = 'Failed';
        this.failedWorkflowsCount++;
        await this.executeCompensation(dag, nodeMap, state, stepContext);
        await this.persistCheckpoint(state);

        return {
          success: false,
          taskId: dag.taskId,
          stepId: dag.workflowId,
          errorCode: failedResult.errorCode || 'WORKFLOW_STEP_FAILED',
          errorMessage: failedResult.errorMessage || 'Workflow step execution failed.',
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    state.status = 'Completed';
    state.updatedAt = Date.now();
    this.completedWorkflowsCount++;

    await this.persistCheckpoint(state);

    if (this.telemetrySpool?.enqueueEventEnvelope) {
      const identity = await this.identityProvider.getIdentity();
      this.telemetrySpool.enqueueEventEnvelope({
        schema_id: 'schema:nexusos:workflow:completed:v1',
        version: '1.0.0',
        event_id: crypto.randomUUID(),
        correlation_id: dag.correlationId,
        occurred_at: new Date().toISOString(),
        producer_id: identity.deviceId,
        payload: {
          workflowId: dag.workflowId,
          taskId: dag.taskId,
          status: 'Completed',
        },
      });
    }

    return {
      success: true,
      taskId: dag.taskId,
      stepId: dag.workflowId,
      output: {
        status: 'Completed',
        outputs: stepContext.getAllOutputs(),
      },
      executionTimeMs: Date.now() - startTime,
    };
  }

  private async executeSingleNode(
    dag: WorkflowDAG,
    node: WorkflowNode,
    stepContext: WorkflowStepContext,
  ): Promise<TaskExecutionResult> {
    const state = this.activeWorkflows.get(dag.workflowId)!;
    const nodeState = state.nodeStates[node.nodeId];
    nodeState.status = 'Running';
    nodeState.startedAt = Date.now();
    state.activeNodes.push(node.nodeId);
    state.pendingNodes = state.pendingNodes.filter((id) => id !== node.nodeId);

    await this.persistCheckpoint(state);

    // Build payload including dependency outputs
    const payload = stepContext.buildNodeExecutionPayload(node);

    // Schedule node via TaskScheduler / AgentOrchestrator
    const nodeResult = await this.taskScheduler.scheduleTask({
      task_id: `${dag.workflowId}_${node.nodeId}`,
      step_id: node.nodeId,
      correlation_id: dag.correlationId,
      leaseHeader: dag.leaseHeader,
      capabilityId: node.capabilityId,
      runtimeCategory: node.runtimeCategory,
      payload,
    });

    state.activeNodes = state.activeNodes.filter((id) => id !== node.nodeId);
    nodeState.completedAt = Date.now();

    if (nodeResult.success) {
      nodeState.status = 'Completed';
      const output = (nodeResult.output as Record<string, unknown>) || {};
      nodeState.output = output;
      stepContext.setNodeOutput(node.nodeId, output);
      state.nodeOutputs[node.nodeId] = stepContext.getNodeOutput(node.nodeId)!;
      state.completedNodes.push(node.nodeId);
    } else {
      if (nodeResult.errorCode === 'RECONCILING') {
        nodeState.status = 'Reconciling';
      } else {
        nodeState.status = 'Failed';
      }
      nodeState.errorCode = nodeResult.errorCode;
      nodeState.errorMessage = nodeResult.errorMessage;
    }

    await this.persistCheckpoint(state);
    return nodeResult;
  }

  private async executeCompensation(
    dag: WorkflowDAG,
    nodeMap: Map<string, WorkflowNode>,
    state: WorkflowExecutionState,
    stepContext: WorkflowStepContext,
  ): Promise<void> {
    const completedNodeIds = [...state.completedNodes].reverse(); // Reverse order compensation

    for (const nodeId of completedNodeIds) {
      const node = nodeMap.get(nodeId);
      if (node && node.compensationPayload) {
        try {
          await this.taskScheduler.scheduleTask({
            task_id: `${dag.workflowId}_comp_${nodeId}`,
            step_id: `comp_${nodeId}`,
            correlation_id: dag.correlationId,
            leaseHeader: dag.leaseHeader,
            capabilityId: node.capabilityId,
            runtimeCategory: node.runtimeCategory,
            payload: stepContext.buildNodeExecutionPayload({
              ...node,
              payload: node.compensationPayload,
            }),
          });
        } catch {
          // Ignore compensation failure to allow remaining compensations to proceed
        }
      }
    }
  }

  private async persistCheckpoint(state: WorkflowExecutionState): Promise<void> {
    if (!this.stateManager) {
      return;
    }
    const index = (await this.stateManager.get<string[]>('workflow_index')) || [];
    if (!index.includes(state.workflowId)) {
      index.push(state.workflowId);
      await this.stateManager.set('workflow_index', index);
    }
    await this.stateManager.set(`workflow_checkpoint:${state.workflowId}`, state);
  }

  private startMaintenanceLoop(): void {
    this.maintenanceTimer = setInterval(() => {
      const now = Date.now();
      for (const [workflowId, state] of this.activeWorkflows.entries()) {
        if (now > state.expiresAt) {
          void this.cancelWorkflow(workflowId, undefined, 'Workflow lease expired');
        }
      }
    }, 5000);

    if (typeof this.maintenanceTimer.unref === 'function') {
      this.maintenanceTimer.unref();
    }
  }

  public shutdown(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    for (const controller of this.abortControllers.values()) {
      controller.abort('WorkflowEngine shutdown');
    }
    this.abortControllers.clear();
  }
}
