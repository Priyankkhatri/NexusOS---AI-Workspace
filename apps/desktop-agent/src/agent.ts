import { Logger } from '@nexusos/backend';
import { DesktopAgentConfig } from './config/index.js';
import { AgentLifecycleManager, AgentLifecycleState } from './lifecycle/index.js';
import { AgentIdentityProvider, AgentIdentity } from './identity/agent-identity.js';
import { ControlPlaneClient } from './communication/types.js';
import { CapabilityRegistry } from './registry/capability-registry.js';
import { RuntimeRegistry } from './registry/runtime-registry.js';
import { ExecutionLeaseBoundary } from './permissions/lease-boundary.js';
import { LocalStateStore } from './state/local-state-store.js';
import { AgentLogger } from './observability/agent-logger.js';
import { SandboxIsolationBoundary } from './sandbox/isolation-boundary.js';

import { PluginExecutionPolicy } from './runtimes/plugin/policy.js';
import { IPCManager } from './ipc/ipc-manager.js';
import { MemoryCacheManager } from './memory/memory-cache-manager.js';
import { DeviceRuntime, DeviceOperationRequest } from './runtimes/device/index.js';
import { AgentOrchestrator } from './orchestrator/agent-orchestrator.js';
import { RuntimeRouter } from './orchestrator/runtime-router.js';
import { TaskExecutionRequest } from './orchestrator/types.js';
import { TaskScheduler } from './scheduler/task-scheduler.js';
import { WorkflowEngine } from './workflow/workflow-engine.js';
import { WorkflowDAG } from './workflow/types.js';
import { ModelRuntimeManager } from './runtimes/local-ai/model-runtime-manager.js';

export class DesktopAgent {
  public readonly lifecycle: AgentLifecycleManager;
  public readonly capabilityRegistry: CapabilityRegistry;
  public readonly runtimeRegistry: RuntimeRegistry;
  public readonly isolationBoundary: SandboxIsolationBoundary;
  public readonly ipcManager?: IPCManager;
  public readonly memoryCacheManager: MemoryCacheManager;
  public readonly deviceRuntime: DeviceRuntime;
  public readonly orchestrator: AgentOrchestrator;
  public readonly taskScheduler: TaskScheduler;
  public readonly workflowEngine: WorkflowEngine;
  public readonly modelRuntimeManager: ModelRuntimeManager;
  private readonly logger: AgentLogger;

  private identity?: AgentIdentity;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    public readonly config: DesktopAgentConfig,
    private readonly identityProvider: AgentIdentityProvider,
    private readonly controlPlaneClient: ControlPlaneClient,
    public readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly stateStore: LocalStateStore,
    baseLogger: Logger,
    customRuntimeRegistry?: RuntimeRegistry,
    customIpcManager?: IPCManager,
    customDeviceRuntime?: DeviceRuntime,
    customOrchestrator?: AgentOrchestrator,
    customScheduler?: TaskScheduler,
  ) {
    this.lifecycle = new AgentLifecycleManager();
    this.capabilityRegistry = new CapabilityRegistry();
    this.runtimeRegistry =
      customRuntimeRegistry || new RuntimeRegistry(new PluginExecutionPolicy());
    this.isolationBoundary = new SandboxIsolationBoundary();
    this.ipcManager =
      customIpcManager ||
      new IPCManager({}, this.leaseBoundary, undefined, undefined, () => this.lifecycle.getState());
    this.memoryCacheManager = new MemoryCacheManager({}, undefined, undefined, () =>
      this.lifecycle.getState(),
    );
    this.deviceRuntime =
      customDeviceRuntime ||
      new DeviceRuntime(
        this.leaseBoundary,
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        () => this.lifecycle.getState(),
      );

    const runtimeRouter = new RuntimeRouter(this.capabilityRegistry, this.runtimeRegistry);
    this.orchestrator =
      customOrchestrator ||
      new AgentOrchestrator(
        this.config,
        this.identityProvider,
        this.controlPlaneClient,
        this.leaseBoundary,
        runtimeRouter,
        undefined,
        this.memoryCacheManager,
        undefined,
        undefined,
        undefined,
        undefined,
        () => this.lifecycle.getState(),
        undefined,
        undefined,
        undefined,
        undefined,
        this.deviceRuntime,
      );

    this.taskScheduler =
      customScheduler ||
      new TaskScheduler(
        this.config,
        this.identityProvider,
        this.leaseBoundary,
        this.orchestrator,
        undefined,
        undefined,
        undefined,
        undefined,
        () => this.lifecycle.getState(),
      );

    this.workflowEngine = new WorkflowEngine(
      this.config,
      this.identityProvider,
      this.leaseBoundary,
      this.orchestrator,
      this.taskScheduler,
      undefined,
      undefined,
      undefined,
      undefined,
      () => this.lifecycle.getState(),
    );

    this.modelRuntimeManager = new ModelRuntimeManager(
      this.leaseBoundary,
      '.nexus-local-ai',
    );

    this.logger = new AgentLogger(baseLogger);

    if (this.ipcManager) {
      this.ipcManager.registerMethodHandler('device.execute', async (params) => {
        return this.deviceRuntime.execute(params as unknown as DeviceOperationRequest);
      });
      this.ipcManager.registerMethodHandler('task.execute', async (params) => {
        return this.taskScheduler.scheduleTask(params as unknown as TaskExecutionRequest);
      });
      this.ipcManager.registerMethodHandler('task.cancel', async (params) => {
        const { taskId, tenantId, reason } = params as {
          taskId: string;
          tenantId?: string;
          reason?: string;
        };
        return this.taskScheduler.cancelScheduledTask(taskId, tenantId, reason);
      });
      this.ipcManager.registerMethodHandler('task.status', async (params) => {
        const { taskId, tenantId } = params as { taskId: string; tenantId?: string };
        return this.taskScheduler.getScheduledTaskStatus(taskId, tenantId);
      });
      this.ipcManager.registerMethodHandler('workflow.execute', async (params) => {
        return this.workflowEngine.executeWorkflow(params as unknown as WorkflowDAG);
      });
      this.ipcManager.registerMethodHandler('workflow.cancel', async (params) => {
        const { workflowId, tenantId, reason } = params as {
          workflowId: string;
          tenantId?: string;
          reason?: string;
        };
        return this.workflowEngine.cancelWorkflow(workflowId, tenantId, reason);
      });
      this.ipcManager.registerMethodHandler('workflow.status', async (params) => {
        const { workflowId, tenantId } = params as { workflowId: string; tenantId?: string };
        return this.workflowEngine.getWorkflowStatus(workflowId, tenantId);
      });
      this.ipcManager.registerMethodHandler('localAi.listModels', async () => {
        return this.modelRuntimeManager['modelCacheManager'].listCatalog();
      });
      this.ipcManager.registerMethodHandler('localAi.getHardwareProfile', async () => {
        return this.modelRuntimeManager['hardwareDetector'].getProfile();
      });
      this.ipcManager.registerMethodHandler('localAi.generate', async (params) => {
        const req = params as unknown as import('./runtimes/local-ai/types.js').InferenceRequest;
        const chunks = [];
        for await (const chunk of this.modelRuntimeManager.executeInference(req)) {
          chunks.push(chunk);
        }
        return { chunks };
      });
      this.ipcManager.registerMethodHandler('localAi.unloadModel', async (params) => {
        const { modelId } = params as { modelId: string };
        await this.modelRuntimeManager.unloadModel(modelId);
        return { success: true, modelId };
      });
    }

    if (typeof this.controlPlaneClient.registerCommandHandler === 'function') {
      this.controlPlaneClient.registerCommandHandler(async (envelope) => {
        if (envelope.payload && typeof envelope.payload === 'object') {
          await this.taskScheduler.scheduleTask(
            envelope.payload as unknown as TaskExecutionRequest,
          );
        }
      });
    }
  }

  async start(): Promise<void> {
    if (this.lifecycle.getState() !== AgentLifecycleState.STOPPED) {
      throw new Error(`Cannot start DesktopAgent from state '${this.lifecycle.getState()}'.`);
    }

    this.lifecycle.transitionTo(AgentLifecycleState.STARTING, 'Agent startup initiated');
    this.logger.info('Desktop Agent starting...', { version: this.config.agentVersion });

    try {
      // 1. Resolve Identity
      this.identity = await this.identityProvider.getIdentity();
      this.logger.info('Loaded Agent identity', {
        deviceId: this.identity.deviceId,
        tenantId: this.identity.pairedTenantId,
      });

      // 2. Control-Plane Registration Handshake
      const caps = this.capabilityRegistry.listCapabilityIds();
      const regResult = await this.controlPlaneClient.registerAgent(
        this.identity,
        caps.length > 0 ? caps : ['agent:foundation'],
      );

      if (!regResult.accepted) {
        throw new Error(
          `Control-plane registration rejected: ${regResult.rejectReason || 'Unknown error'}`,
        );
      }

      // 3. Transition to READY
      this.lifecycle.transitionTo(AgentLifecycleState.READY, 'Registration handshake successful');
      this.logger.info('Desktop Agent successfully started and READY');

      // 4. Save Initial Local State
      await this.saveStateSnapshot(true);

      // 5. Start Heartbeat Timer
      this.startHeartbeat();

      // 6. Start IPC Manager if configured
      if (this.ipcManager) {
        await this.ipcManager.start();
      }
      await this.memoryCacheManager.start();
      await this.modelRuntimeManager.initialize();
    } catch (err) {
      this.lifecycle.transitionTo(
        AgentLifecycleState.FAILED,
        err instanceof Error ? err.message : 'Startup failed',
      );
      this.logger.error('Desktop Agent startup failed', { error: String(err) });
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.lifecycle.isStoppingOrStopped()) {
      return;
    }

    this.lifecycle.transitionTo(AgentLifecycleState.STOPPING, 'Shutdown requested');
    this.logger.info('Desktop Agent stopping...');

    this.stopHeartbeat();
    this.taskScheduler.shutdown();
    this.workflowEngine.shutdown();
    await this.modelRuntimeManager.shutdown();

    try {
      if (this.ipcManager) {
        await this.ipcManager.stop();
      }
      await this.memoryCacheManager.stop();
      await this.controlPlaneClient.disconnect();
      await this.saveStateSnapshot(false);
      this.lifecycle.transitionTo(AgentLifecycleState.STOPPED, 'Shutdown completed');
      this.logger.info('Desktop Agent stopped gracefully');
    } catch (err) {
      this.lifecycle.transitionTo(
        AgentLifecycleState.FAILED,
        err instanceof Error ? err.message : 'Shutdown error',
      );
      this.logger.error('Desktop Agent shutdown encountered an error', { error: String(err) });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.identity || !this.lifecycle.isReady()) return;

      const ok = await this.controlPlaneClient.sendHeartbeat({
        deviceId: this.identity.deviceId,
        tenantId: this.identity.pairedTenantId,
        status: this.lifecycle.getState(),
        agentVersion: this.config.agentVersion,
        activeLeasesCount: 0,
        timestamp: new Date().toISOString(),
      });

      if (!ok && this.lifecycle.isReady()) {
        this.lifecycle.transitionTo(
          AgentLifecycleState.DEGRADED,
          'Heartbeat failed to reach control-plane',
        );
        this.logger.warn('Heartbeat failed; transitioned agent state to DEGRADED');
      } else if (ok && this.lifecycle.getState() === AgentLifecycleState.DEGRADED) {
        this.lifecycle.transitionTo(AgentLifecycleState.READY, 'Heartbeat connection restored');
        this.logger.info('Heartbeat restored; transitioned agent state to READY');
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async saveStateSnapshot(connected: boolean): Promise<void> {
    if (!this.identity) return;

    await this.stateStore.saveState({
      deviceId: this.identity.deviceId,
      tenantId: this.identity.pairedTenantId,
      lifecycleState: this.lifecycle.getState(),
      controlPlaneConnected: connected,
      registeredCapabilities: this.capabilityRegistry.listCapabilityIds(),
      registeredRuntimes: this.runtimeRegistry.listRuntimes().map((r) => r.runtimeId),
      lastHeartbeatAt: new Date().toISOString(),
    });
  }
}
