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
import { ClipboardRuntimeManager } from './runtimes/clipboard/clipboard-runtime.js';
import { IDEIntegrationAdapter } from './adapters/ide/ide-adapter.js';
import { TrayUIController } from './ui/tray-controller.js';
import { NativeApprovalHost } from './ui/approval-host.js';
import { RedactionFilter } from './telemetry/redaction-filter.js';
import { SecretRedactionRegistry } from './vault/redaction-registry.js';
import { SecretsVaultClient } from './vault/vault-client.js';
import { UpdateManager } from './updater/update-manager.js';
import { NotificationManager } from './notifications/notification-manager.js';
import { RuntimeCategory } from './registry/runtime-registry.js';
import {
  HealthMonitor,
  ReadinessGate,
  CrashRecoveryManager,
  ProcessReconciliationEngine,
  RecoveryManifestStore,
} from './health/index.js';
import { ConfigurationManager } from './config/configuration-manager.js';
import { StateManager } from './state/state-manager.js';

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
  public readonly clipboardRuntime: ClipboardRuntimeManager;
  public readonly ideAdapter: IDEIntegrationAdapter;
  public readonly trayController: TrayUIController;
  public readonly approvalHost: NativeApprovalHost;
  public readonly notificationManager: NotificationManager;
  public readonly vaultClient: SecretsVaultClient;
  public readonly updateManager: UpdateManager;
  public readonly readinessGate: ReadinessGate;
  public readonly healthMonitor: HealthMonitor;
  public readonly crashRecoveryManager: CrashRecoveryManager;
  public readonly configurationManager: ConfigurationManager;
  public readonly stateManager: StateManager;
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
    customClipboardRuntime?: ClipboardRuntimeManager,
    customIDEAdapter?: IDEIntegrationAdapter,
    customTrayController?: TrayUIController,
    customApprovalHost?: NativeApprovalHost,
    customVaultClient?: SecretsVaultClient,
    customUpdateManager?: UpdateManager,
    customNotificationManager?: NotificationManager,
    customHealthMonitor?: HealthMonitor,
    customCrashRecoveryManager?: CrashRecoveryManager,
    customReadinessGate?: ReadinessGate,
    customConfigurationManager?: ConfigurationManager,
    customStateManager?: StateManager,
  ) {
    this.lifecycle = new AgentLifecycleManager();
    this.capabilityRegistry = new CapabilityRegistry();
    this.capabilityRegistry.registerCapability({
      capabilityId: 'clipboard.read',
      category: 'runtime',
      description: 'Read system clipboard content under lease policy authorization',
      isDangerous: true,
      requiredScope: 'clipboard:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'clipboard.write',
      category: 'runtime',
      description: 'Write sanitized text to system clipboard with TTL auto-clear',
      isDangerous: true,
      requiredScope: 'clipboard:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'clipboard.clear',
      category: 'runtime',
      description: 'Clear system clipboard content',
      isDangerous: false,
      requiredScope: 'clipboard:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'ide.getContext',
      category: 'runtime',
      description: 'Retrieve IDE context snapshot and active editor selection',
      isDangerous: false,
      requiredScope: 'ide:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'ide.applyDiff',
      category: 'runtime',
      description: 'Apply workspace-constrained diff patch to target file',
      isDangerous: true,
      requiredScope: 'ide:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'ide.getDiagnostics',
      category: 'runtime',
      description: 'Retrieve IDE error and warning diagnostics items',
      isDangerous: false,
      requiredScope: 'ide:read',
    });
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

    this.capabilityRegistry.registerCapability({
      capabilityId: 'vault.resolve',
      category: 'runtime',
      description: 'Resolve opaque secret reference into short-lived unpersisted memory payload',
      isDangerous: true,
      requiredScope: 'vault:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'vault.inject',
      category: 'runtime',
      description: 'Inject resolved secret into authorized runner channel',
      isDangerous: true,
      requiredScope: 'vault:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'vault.revoke',
      category: 'runtime',
      description: 'Revoke active secret lease and zeroize memory buffer',
      isDangerous: false,
      requiredScope: 'vault:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'update.getStatus',
      category: 'runtime',
      description: 'Retrieve current agent update status and channel configuration',
      isDangerous: false,
      requiredScope: 'update:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'update.checkForUpdates',
      category: 'runtime',
      description:
        'Check for release updates and verify manifest signature and anti-rollback rules',
      isDangerous: false,
      requiredScope: 'update:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'update.downloadAndUpdate',
      category: 'runtime',
      description: 'Download update package and verify SHA-256 checksum integrity',
      isDangerous: true,
      requiredScope: 'update:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'update.stageAndActivate',
      category: 'runtime',
      description: 'Create LKG rollback snapshot, run health checks, and activate staged update',
      isDangerous: true,
      requiredScope: 'update:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'health.getReport',
      category: 'runtime',
      description:
        'Retrieve aggregate desktop agent system health report and resource saturation metrics',
      isDangerous: false,
      requiredScope: 'health:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'health.checkReadiness',
      category: 'runtime',
      description: 'Evaluate pre-flight startup readiness gate dependencies',
      isDangerous: false,
      requiredScope: 'health:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'recovery.execute',
      category: 'runtime',
      description: 'Execute startup recovery manifest processing and checkpoint restoration',
      isDangerous: true,
      requiredScope: 'recovery:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'recovery.reconcile',
      category: 'runtime',
      description: 'Reconcile orphaned process trees following abnormal crash exit',
      isDangerous: true,
      requiredScope: 'recovery:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'config.getActive',
      category: 'runtime',
      description: 'Retrieve active multi-layer desktop agent configuration snapshot',
      isDangerous: false,
      requiredScope: 'config:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'config.applyUpdate',
      category: 'runtime',
      description: 'Apply signed or user-preference configuration layer update',
      isDangerous: true,
      requiredScope: 'config:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'config.rollback',
      category: 'runtime',
      description: 'Rollback active configuration to last known good (LKG) snapshot',
      isDangerous: true,
      requiredScope: 'config:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'state.getRecord',
      category: 'runtime',
      description: 'Retrieve encrypted durable local state record by key',
      isDangerous: false,
      requiredScope: 'state:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'state.setRecord',
      category: 'runtime',
      description: 'Set encrypted durable local state record by key',
      isDangerous: true,
      requiredScope: 'state:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'state.deleteRecord',
      category: 'runtime',
      description: 'Delete encrypted durable local state record by key',
      isDangerous: true,
      requiredScope: 'state:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'state.getStatus',
      category: 'runtime',
      description: 'Retrieve state manager initialization and persistence status',
      isDangerous: false,
      requiredScope: 'state:read',
    });

    this.modelRuntimeManager = new ModelRuntimeManager(this.leaseBoundary, '.nexus-local-ai');
    const redactionFilter = new RedactionFilter(new SecretRedactionRegistry());
    this.clipboardRuntime =
      customClipboardRuntime || new ClipboardRuntimeManager(this.leaseBoundary, redactionFilter);
    this.ideAdapter = customIDEAdapter || new IDEIntegrationAdapter(this.leaseBoundary);
    this.trayController = customTrayController || new TrayUIController();
    this.approvalHost =
      customApprovalHost || new NativeApprovalHost(this.leaseBoundary, redactionFilter);
    this.notificationManager = customNotificationManager || new NotificationManager();
    this.vaultClient =
      customVaultClient ||
      new SecretsVaultClient(
        this.leaseBoundary,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        this.notificationManager,
      );
    this.updateManager =
      customUpdateManager ||
      new UpdateManager(
        this.config.agentVersion,
        'stable',
        undefined,
        undefined,
        this.notificationManager,
      );
    this.readinessGate = customReadinessGate || new ReadinessGate();
    this.healthMonitor =
      customHealthMonitor ||
      new HealthMonitor(
        this.config.deviceId,
        this.config.agentVersion,
        this.readinessGate,
        '.',
        this.notificationManager,
      );
    this.crashRecoveryManager =
      customCrashRecoveryManager ||
      new CrashRecoveryManager(
        this.config.deviceId,
        new RecoveryManifestStore(),
        new ProcessReconciliationEngine(),
        this.notificationManager,
      );
    this.configurationManager =
      customConfigurationManager || new ConfigurationManager(this.leaseBoundary);
    this.stateManager =
      customStateManager ||
      new StateManager(undefined, undefined, undefined, () => this.lifecycle.getState());

    this.runtimeRegistry.registerRuntime({
      runtimeId: 'vault-client',
      category: RuntimeCategory.VAULT,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: ['resolveSecret', 'injectSecret', 'revokeSecret'],
    });
    this.runtimeRegistry.registerRuntime({
      runtimeId: 'update-manager',
      category: RuntimeCategory.UPDATER,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: [
        'getStatus',
        'checkForUpdates',
        'downloadAndVerifyUpdate',
        'stageAndActivateUpdate',
      ],
    });
    this.runtimeRegistry.registerRuntime({
      runtimeId: 'health-monitor',
      category: RuntimeCategory.HEALTH,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: [
        'getHealthReport',
        'checkReadiness',
        'executeRecovery',
        'reconcileOrphanedProcesses',
      ],
    });
    this.runtimeRegistry.registerRuntime({
      runtimeId: 'config-manager',
      category: RuntimeCategory.CONFIG,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: ['getActive', 'applyUpdate', 'rollback'],
    });
    this.runtimeRegistry.registerRuntime({
      runtimeId: 'state-manager',
      category: RuntimeCategory.STATE,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: ['getRecord', 'setRecord', 'deleteRecord', 'getStatus'],
    });

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
      this.ipcManager.registerMethodHandler('clipboard.read', async (params) => {
        return this.clipboardRuntime.readClipboard(
          params as unknown as import('./runtimes/clipboard/types.js').ClipboardReadRequest,
        );
      });
      this.ipcManager.registerMethodHandler('clipboard.write', async (params) => {
        return this.clipboardRuntime.writeClipboard(
          params as unknown as import('./runtimes/clipboard/types.js').ClipboardWriteRequest,
        );
      });
      this.ipcManager.registerMethodHandler('clipboard.clear', async () => {
        await this.clipboardRuntime.clearClipboard();
        return { success: true };
      });
      this.ipcManager.registerMethodHandler('ide.getContext', async (params) => {
        return this.ideAdapter.getContext(
          params as unknown as import('./adapters/ide/types.js').IDEContextRequest,
        );
      });
      this.ipcManager.registerMethodHandler('ide.applyDiff', async (params) => {
        return this.ideAdapter.applyDiff(
          params as unknown as import('./adapters/ide/types.js').IDEDiffRequest,
        );
      });
      this.ipcManager.registerMethodHandler('ide.getDiagnostics', async (params) => {
        const { filePath } = (params || {}) as { filePath?: string };
        return this.ideAdapter.getDiagnostics(filePath);
      });
      this.ipcManager.registerMethodHandler('localAi.unloadModel', async (params) => {
        const { modelId } = params as { modelId: string };
        await this.modelRuntimeManager.unloadModel(modelId);
        return { success: true, modelId };
      });
      this.ipcManager.registerMethodHandler('tray.getStatus', async () => {
        return this.trayController.getStatus();
      });
      this.ipcManager.registerMethodHandler('vault.resolveSecret', async (params) => {
        const req = params as unknown as import('./vault/types.js').ResolveSecretRequest;
        const ctx: import('./vault/types.js').VaultOperationRequestContext = {
          lease: req.leaseHeader,
          allowedRoots: req.allowedRoots || ['.'],
          isOffline: req.isOffline,
          protectedLocalLeaseValid: req.protectedLocalLeaseValid,
        };
        const { result } = await this.vaultClient.resolveSecret(req.referenceString, ctx);
        return result;
      });
      this.ipcManager.registerMethodHandler('vault.injectSecret', async (params) => {
        const req = params as unknown as import('./vault/types.js').InjectSecretRequest;
        const ctx: import('./vault/types.js').VaultOperationRequestContext = {
          lease: req.leaseHeader,
          allowedRoots: ['.'],
        };
        const payload: import('./vault/types.js').SecretLeasePayload = {
          referenceId: req.referenceId,
          secretName: 'injected_secret',
          payloadBuffer: Buffer.from(''),
          fingerprintId: 'fp-' + req.referenceId,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          isRevoked: false,
        };
        const { result } = await this.vaultClient.injectSecret(
          payload,
          req.channel,
          req.targetId,
          ctx,
        );
        return result;
      });
      this.ipcManager.registerMethodHandler('vault.revokeSecret', async (params) => {
        const req = params as unknown as import('./vault/types.js').RevokeSecretRequest;
        const { result } = await this.vaultClient.revokeSecret(req.referenceString);
        return result;
      });
      this.ipcManager.registerMethodHandler('update.getStatus', async () => {
        return this.updateManager.getStatus();
      });
      this.ipcManager.registerMethodHandler('update.checkForUpdates', async (params) => {
        const { customManifest } = (params || {}) as {
          customManifest?: import('./updater/types.js').UpdateManifest;
        };
        return this.updateManager.checkForUpdates(customManifest);
      });
      this.ipcManager.registerMethodHandler('update.downloadAndUpdate', async (params) => {
        const { manifest, packageDataBase64 } = (params || {}) as {
          manifest: import('./updater/types.js').UpdateManifest;
          packageDataBase64?: string;
        };
        const packageData = packageDataBase64
          ? Buffer.from(packageDataBase64, 'base64')
          : undefined;
        const success = await this.updateManager.downloadAndVerifyUpdate(manifest, packageData);
        return { success, status: this.updateManager.getStatus() };
      });
      this.ipcManager.registerMethodHandler('update.stageAndActivate', async () => {
        const success = await this.updateManager.stageAndActivateUpdate();
        return { success, status: this.updateManager.getStatus() };
      });
      this.ipcManager.registerMethodHandler('health.getReport', async () => {
        return this.healthMonitor.getHealthReport();
      });
      this.ipcManager.registerMethodHandler('health.checkReadiness', async () => {
        return this.healthMonitor.checkReadiness();
      });
      this.ipcManager.registerMethodHandler('health.checkLiveness', async () => {
        return { alive: this.healthMonitor.checkLiveness() };
      });
      this.ipcManager.registerMethodHandler('recovery.loadManifest', async () => {
        return this.crashRecoveryManager.getRecoveryManifest();
      });
      this.ipcManager.registerMethodHandler('recovery.reconcile', async () => {
        const { result } = await this.crashRecoveryManager.executeStartupRecovery();
        return result;
      });
      this.ipcManager.registerMethodHandler('recovery.execute', async () => {
        const { result } = await this.crashRecoveryManager.executeStartupRecovery();
        return result;
      });
      this.ipcManager.registerMethodHandler('tray.pause', async (params) => {
        const { reason } = (params || {}) as { reason?: string };
        return this.trayController.pause(reason);
      });
      this.ipcManager.registerMethodHandler('tray.resume', async () => {
        return this.trayController.resume();
      });
      this.ipcManager.registerMethodHandler('tray.getMenuDescriptors', async () => {
        return this.trayController.getMenuDescriptors();
      });
      this.ipcManager.registerMethodHandler('approval.presentPrompt', async (params) => {
        const prompt = await this.approvalHost.presentPrompt(
          params as unknown as import('./ui/types.js').ApprovalPromptRequest,
        );
        this.trayController.setPendingApprovalCount(this.approvalHost.listPendingPrompts().length);
        return prompt;
      });
      this.ipcManager.registerMethodHandler('approval.getPrompt', async (params) => {
        const { promptId, tenantId } = (params || {}) as { promptId: string; tenantId?: string };
        return this.approvalHost.getPrompt(promptId, tenantId);
      });
      this.ipcManager.registerMethodHandler('approval.listPending', async (params) => {
        const { tenantId } = (params || {}) as { tenantId?: string };
        return this.approvalHost.listPendingPrompts(tenantId);
      });
      this.ipcManager.registerMethodHandler('approval.submitDecision', async (params) => {
        const res = await this.approvalHost.submitDecision(
          params as unknown as import('./ui/types.js').ApprovalDecisionRequest,
        );
        this.trayController.setPendingApprovalCount(this.approvalHost.listPendingPrompts().length);
        return res;
      });
      this.ipcManager.registerMethodHandler('approval.cancelPrompt', async (params) => {
        const { promptId, reason } = (params || {}) as { promptId: string; reason?: string };
        const success = this.approvalHost.cancelPrompt(promptId, reason);
        this.trayController.setPendingApprovalCount(this.approvalHost.listPendingPrompts().length);
        return { success };
      });
      this.ipcManager.registerMethodHandler('config.getActive', async (params) => {
        const { ConfigGetActiveRequestSchema } = await import('./config/schemas.js');
        ConfigGetActiveRequestSchema.parse(params || {});
        return this.configurationManager.getActiveConfiguration();
      });
      this.ipcManager.registerMethodHandler('config.applyUpdate', async (params) => {
        const { ConfigApplyUpdateRequestSchema } = await import('./config/schemas.js');
        const req = ConfigApplyUpdateRequestSchema.parse(params || {});
        const { result, event } = await this.configurationManager.applyConfigurationUpdate(
          req.layer as any,
          req.update as any,
        );
        return { result, event };
      });
      this.ipcManager.registerMethodHandler('config.rollback', async (params) => {
        const { ConfigRollbackRequestSchema } = await import('./config/schemas.js');
        ConfigRollbackRequestSchema.parse(params || {});
        const { result, event } = await this.configurationManager.rollbackToLKG();
        return { result, event };
      });
      this.ipcManager.registerMethodHandler('state.getRecord', async (params) => {
        const { StateGetRecordRequestSchema } = await import('./state/schemas.js');
        const req = StateGetRecordRequestSchema.parse(params || {});
        return { record: await this.stateManager.get(req.key) };
      });
      this.ipcManager.registerMethodHandler('state.setRecord', async (params) => {
        const { StateSetRecordRequestSchema } = await import('./state/schemas.js');
        const req = StateSetRecordRequestSchema.parse(params || {});
        await this.stateManager.set(req.key, req.data);
        return { success: true };
      });
      this.ipcManager.registerMethodHandler('state.deleteRecord', async (params) => {
        const { StateDeleteRecordRequestSchema } = await import('./state/schemas.js');
        const req = StateDeleteRecordRequestSchema.parse(params || {});
        const deleted = await this.stateManager.delete(req.key);
        return { deleted };
      });
      this.ipcManager.registerMethodHandler('state.getStatus', async (params) => {
        const { StateGetStatusRequestSchema } = await import('./state/schemas.js');
        StateGetStatusRequestSchema.parse(params || {});
        return this.stateManager.getStatus();
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
      // 0. Pre-flight Readiness Gate & Crash Recovery Execution
      this.readinessGate.assertReadyForLease();
      await this.crashRecoveryManager.executeStartupRecovery();

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
      await this.stateManager.start();
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
    this.clipboardRuntime.shutdown();
    this.ideAdapter.reset();
    this.trayController.shutdown();
    this.approvalHost.shutdown();
    this.vaultClient.shutdown();
    this.updateManager.shutdown();
    await this.modelRuntimeManager.shutdown();
    await this.stateManager.stop();

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
