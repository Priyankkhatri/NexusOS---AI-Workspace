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
import {
  FilesystemRuntime,
  PathSecurityService,
  SnapshotManager,
} from './runtimes/filesystem/index.js';
import { TerminalRuntime, ProcessSupervisor } from './runtimes/terminal/index.js';
import { BrowserRuntime } from './runtimes/browser/index.js';
import { PluginRuntime } from './runtimes/plugin/index.js';
import { AgentOrchestrator } from './orchestrator/agent-orchestrator.js';
import { RuntimeRouter } from './orchestrator/runtime-router.js';
import { TaskExecutionRequest } from './orchestrator/types.js';
import { TaskScheduler } from './scheduler/task-scheduler.js';
import { WorkflowEngine } from './workflow/workflow-engine.js';
import { WorkflowDAG } from './workflow/types.js';
import {
  LocalAiRuntime,
  ModelRuntimeManager,
  LocalAiGenerateIPCRequestSchema,
  LocalAiListModelsIPCRequestSchema,
  LocalAiGetHardwareProfileIPCRequestSchema,
  LocalAiUnloadModelIPCRequestSchema,
} from './runtimes/local-ai/index.js';
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
import { TelemetryManager } from './telemetry/telemetry-manager.js';

export class DesktopAgent {
  public readonly lifecycle: AgentLifecycleManager;
  public readonly capabilityRegistry: CapabilityRegistry;
  public readonly runtimeRegistry: RuntimeRegistry;
  public readonly isolationBoundary: SandboxIsolationBoundary;
  public readonly ipcManager?: IPCManager;
  public readonly memoryCacheManager: MemoryCacheManager;
  public readonly deviceRuntime: DeviceRuntime;
  public readonly filesystemRuntime: FilesystemRuntime;
  public readonly terminalRuntime: TerminalRuntime;
  public readonly browserRuntime: BrowserRuntime;
  public readonly pluginRuntime: PluginRuntime;
  public readonly localAiRuntime: LocalAiRuntime;
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
  public readonly telemetryManager: TelemetryManager;
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
    customTelemetryManager?: TelemetryManager,
    customFilesystemRuntime?: FilesystemRuntime,
    customTerminalRuntime?: TerminalRuntime,
    customBrowserRuntime?: BrowserRuntime,
    customPluginRuntime?: PluginRuntime,
    customLocalAiRuntime?: LocalAiRuntime,
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

    this.logger = new AgentLogger(baseLogger);

    this.filesystemRuntime =
      customFilesystemRuntime ||
      new FilesystemRuntime(
        this.leaseBoundary,
        new PathSecurityService(),
        new SnapshotManager(),
        this.logger,
      );
    this.runtimeRegistry.registerRuntime(this.filesystemRuntime.getDescriptor());

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
        this.filesystemRuntime,
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
    this.capabilityRegistry.registerCapability({
      capabilityId: 'telemetry.trackMetric',
      category: 'runtime',
      description: 'Records performance metrics and telemetry items',
      isDangerous: false,
      requiredScope: 'telemetry:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'telemetry.trackTrace',
      category: 'runtime',
      description: 'Records telemetry trace events',
      isDangerous: false,
      requiredScope: 'telemetry:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'telemetry.flush',
      category: 'runtime',
      description: 'Flushes spooled telemetry records into a signed batch',
      isDangerous: true,
      requiredScope: 'telemetry:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'telemetry.getMetrics',
      category: 'runtime',
      description: 'Retrieves telemetry spool health and usage metrics',
      isDangerous: false,
      requiredScope: 'telemetry:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'telemetry.exportDiagnosticBundle',
      category: 'runtime',
      description: 'Exports sanitized diagnostic bundle to disk',
      isDangerous: true,
      requiredScope: 'telemetry:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'notification.dispatch',
      category: 'runtime',
      description: 'Submit a structured notification for delivery through policy gate',
      isDangerous: false,
      requiredScope: 'notification:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'notification.listPending',
      category: 'runtime',
      description: 'Retrieve pending unread notifications from the notification queue',
      isDangerous: false,
      requiredScope: 'notification:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'notification.markRead',
      category: 'runtime',
      description: 'Mark a specific notification as read',
      isDangerous: false,
      requiredScope: 'notification:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'notification.executeAction',
      category: 'runtime',
      description: 'Execute a notification action with mandatory per-call revalidation',
      isDangerous: true,
      requiredScope: 'notification:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'notification.getMetrics',
      category: 'runtime',
      description: 'Retrieve notification queue health and delivery metrics',
      isDangerous: false,
      requiredScope: 'notification:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'notification.setLockScreen',
      category: 'runtime',
      description: 'Activate lock-screen privacy mode — retroactively redacts pending queue items',
      isDangerous: true,
      requiredScope: 'notification:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'device.queryInfo',
      category: 'runtime',
      description: 'Query device hardware and software capabilities summary',
      isDangerous: false,
      requiredScope: 'device:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'device.getPosture',
      category: 'runtime',
      description: 'Query device security posture, OS consent status, and power state',
      isDangerous: false,
      requiredScope: 'device:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'device.execute',
      category: 'runtime',
      description: 'Execute an authorized device runtime operation under valid lease authority',
      isDangerous: true,
      requiredScope: 'device:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.readFile',
      category: 'runtime',
      description: 'Read file contents within authorized filesystem scopes',
      isDangerous: false,
      requiredScope: 'filesystem:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.writeFile',
      category: 'runtime',
      description: 'Write file contents within authorized filesystem scopes',
      isDangerous: true,
      requiredScope: 'filesystem:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.listDirectory',
      category: 'runtime',
      description: 'List directory entries within authorized filesystem scopes',
      isDangerous: false,
      requiredScope: 'filesystem:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.statFile',
      category: 'runtime',
      description: 'Inspect file status and metadata within authorized filesystem scopes',
      isDangerous: false,
      requiredScope: 'filesystem:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.copyFile',
      category: 'runtime',
      description: 'Copy file to destination within authorized filesystem scopes',
      isDangerous: false,
      requiredScope: 'filesystem:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.moveFile',
      category: 'runtime',
      description: 'Move file to destination within authorized filesystem scopes',
      isDangerous: false,
      requiredScope: 'filesystem:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.deleteFile',
      category: 'runtime',
      description: 'Delete file within authorized filesystem scopes',
      isDangerous: true,
      requiredScope: 'filesystem:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'terminal.executeCommand',
      category: 'runtime',
      description: 'Execute an approved tool command within a supervised child process',
      isDangerous: true,
      requiredScope: 'terminal:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'terminal.killProcess',
      category: 'runtime',
      description: 'Kill an active managed child process',
      isDangerous: true,
      requiredScope: 'terminal:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'terminal.listProcesses',
      category: 'runtime',
      description: 'List all managed active child processes',
      isDangerous: false,
      requiredScope: 'terminal:read',
    });
    /** Task 044: Browser Runtime & Domain Security Adapter */
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.createSession',
      category: 'runtime',
      description: 'Create an isolated browser session bound to task and workspace',
      isDangerous: true,
      requiredScope: 'browser:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.navigate',
      category: 'runtime',
      description: 'Navigate browser session to an allowed domain URL',
      isDangerous: true,
      requiredScope: 'browser:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.extractContent',
      category: 'runtime',
      description: 'Extract structured page content within DOM size limits',
      isDangerous: false,
      requiredScope: 'browser:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.interactForm',
      category: 'runtime',
      description: 'Interact with page element (click/fill); pauses for sensitive/auth forms',
      isDangerous: true,
      requiredScope: 'browser:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.captureScreenshot',
      category: 'runtime',
      description: 'Capture page screenshot to authorized filesystem path',
      isDangerous: false,
      requiredScope: 'browser:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.downloadFile',
      category: 'runtime',
      description: 'Download file from allowed domain to authorized destination path',
      isDangerous: true,
      requiredScope: 'browser:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.uploadFile',
      category: 'runtime',
      description: 'Upload file from authorized source path to page',
      isDangerous: true,
      requiredScope: 'browser:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.clearSession',
      category: 'runtime',
      description: 'Clear browser session and delete profile directory',
      isDangerous: true,
      requiredScope: 'browser:write',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'browser.listSessions',
      category: 'runtime',
      description: 'List active managed browser sessions',
      isDangerous: false,
      requiredScope: 'browser:read',
    });
    /** Task 045: Plugin Runtime & Host Manager Adapter */
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.verify',
      category: 'runtime',
      description: 'Verify plugin package signature, manifest schema, and trust level',
      isDangerous: false,
      requiredScope: 'plugin:verify',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.install',
      category: 'runtime',
      description: 'Verify and install plugin package into the catalog',
      isDangerous: true,
      requiredScope: 'plugin:install',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.activate',
      category: 'runtime',
      description: 'Activate installed plugin package for invocation',
      isDangerous: true,
      requiredScope: 'plugin:activate',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.invoke',
      category: 'runtime',
      description: 'Invoke manifest-approved plugin capability within sandboxed host',
      isDangerous: true,
      requiredScope: 'plugin:invoke',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.suspend',
      category: 'runtime',
      description: 'Suspend an active plugin',
      isDangerous: true,
      requiredScope: 'plugin:suspend',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.quarantine',
      category: 'runtime',
      description: 'Quarantine a failing or suspicious plugin package',
      isDangerous: true,
      requiredScope: 'plugin:quarantine',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.listEntries',
      category: 'runtime',
      description: 'List installed plugin catalog entries',
      isDangerous: false,
      requiredScope: 'plugin:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'plugin.listQuarantined',
      category: 'runtime',
      description: 'List active quarantined plugin records',
      isDangerous: false,
      requiredScope: 'plugin:read',
    });

    /** Task 046: Local AI Capability Descriptors */
    this.capabilityRegistry.registerCapability({
      capabilityId: 'localAi.generate',
      category: 'runtime',
      description:
        'Execute local model inference with token streaming and hardware admission control',
      isDangerous: true,
      requiredScope: 'ai:inference',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'localAi.listModels',
      category: 'runtime',
      description: 'List cached and installed local AI model artifacts in model catalog',
      isDangerous: false,
      requiredScope: 'ai:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'localAi.getHardwareProfile',
      category: 'runtime',
      description: 'Retrieve host hardware profile, GPU acceleration posture, and memory budgets',
      isDangerous: false,
      requiredScope: 'ai:read',
    });
    this.capabilityRegistry.registerCapability({
      capabilityId: 'localAi.unloadModel',
      category: 'runtime',
      description:
        'Unload an active local model from memory and release reserved accelerator resources',
      isDangerous: true,
      requiredScope: 'ai:write',
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
    this.telemetryManager = customTelemetryManager || new TelemetryManager(this.config.deviceId);

    this.runtimeRegistry.registerRuntime({
      runtimeId: 'telemetry-manager',
      category: RuntimeCategory.TELEMETRY,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: [
        'trackMetric',
        'trackTrace',
        'flush',
        'getMetrics',
        'exportDiagnosticBundle',
      ],
    });
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
    this.runtimeRegistry.registerRuntime({
      runtimeId: 'notification-manager',
      category: RuntimeCategory.NOTIFICATION,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: [
        'dispatch',
        'listPending',
        'markRead',
        'executeAction',
        'getMetrics',
        'setLockScreen',
      ],
    });
    this.runtimeRegistry.registerRuntime({
      runtimeId: 'rt:device-v1',
      category: RuntimeCategory.DEVICE,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: ['queryInfo', 'getPosture', 'executeOperation'],
    });

    this.terminalRuntime =
      customTerminalRuntime ||
      new TerminalRuntime(
        this.leaseBoundary,
        new ProcessSupervisor(),
        new PathSecurityService(),
        this.logger,
      );

    this.runtimeRegistry.registerRuntime(this.terminalRuntime.getDescriptor());

    /** Task 044: Browser Runtime & Domain Security Adapter */
    this.browserRuntime =
      customBrowserRuntime ||
      new BrowserRuntime(this.leaseBoundary, undefined, undefined, undefined, this.logger);

    this.runtimeRegistry.registerRuntime(this.browserRuntime.getDescriptor());

    /** Task 045: Plugin Runtime & Host Manager Adapter */
    this.pluginRuntime =
      customPluginRuntime ||
      new PluginRuntime(
        this.leaseBoundary,
        undefined,
        undefined,
        undefined,
        undefined,
        this.logger,
      );

    this.runtimeRegistry.registerRuntime(this.pluginRuntime.getDescriptor());

    /** Task 046: Local AI Runtime & Hardware Acceleration Adapter */
    this.localAiRuntime =
      customLocalAiRuntime ||
      new LocalAiRuntime(
        this.leaseBoundary,
        this.modelRuntimeManager,
        '.nexus-local-ai',
        this.logger,
      );

    this.runtimeRegistry.registerRuntime(this.localAiRuntime.getDescriptor());

    if (this.ipcManager) {
      this.ipcManager.registerMethodHandler('device.execute', async (params) => {
        const { DeviceExecuteIPCRequestSchema } = await import('./runtimes/device/schemas.js');
        const req = DeviceExecuteIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`device.execute denied: agent lifecycle state is '${state}'.`);
        }
        const result = await this.deviceRuntime.execute(req.request as DeviceOperationRequest);
        if (!result.success) {
          this.telemetryManager.trackTrace('device_execute_denied', {
            operationName: req.request?.operationName,
            reason: result.error?.message,
          });
        } else {
          this.telemetryManager.trackTrace('device_execute_success', {
            operationName: req.request?.operationName,
          });
        }
        return result;
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
      this.ipcManager.registerMethodHandler('telemetry.trackMetric', async (params) => {
        const { TelemetryTrackMetricRequestSchema } = await import('./telemetry/schemas.js');
        const req = TelemetryTrackMetricRequestSchema.parse(params || {});
        this.telemetryManager.trackMetric(req.name, req.value, req.attributes || {});
        return { success: true };
      });
      this.ipcManager.registerMethodHandler('telemetry.trackTrace', async (params) => {
        const { TelemetryTrackTraceRequestSchema } = await import('./telemetry/schemas.js');
        const req = TelemetryTrackTraceRequestSchema.parse(params || {});
        this.telemetryManager.trackTrace(req.name, req.attributes || {});
        return { success: true };
      });
      this.ipcManager.registerMethodHandler('telemetry.flush', async (params) => {
        const { TelemetryFlushRequestSchema } = await import('./telemetry/schemas.js');
        TelemetryFlushRequestSchema.parse(params || {});
        const batch = await this.telemetryManager.flush();
        return { batch };
      });
      this.ipcManager.registerMethodHandler('telemetry.getMetrics', async (params) => {
        const { TelemetryGetMetricsRequestSchema } = await import('./telemetry/schemas.js');
        TelemetryGetMetricsRequestSchema.parse(params || {});
        return { metrics: this.telemetryManager.getHealthMetrics() };
      });
      this.ipcManager.registerMethodHandler('telemetry.exportDiagnosticBundle', async (params) => {
        const { TelemetryExportDiagnosticBundleRequestSchema } = await import(
          './telemetry/schemas.js'
        );
        const req = TelemetryExportDiagnosticBundleRequestSchema.parse(params || {});
        const bundle = await this.telemetryManager.exportDiagnosticBundle(req.outputPath);
        return { bundle };
      });
      this.ipcManager.registerMethodHandler('notification.dispatch', async (params) => {
        const { NotificationDispatchRequestSchema } = await import('./notifications/schemas.js');
        const req = NotificationDispatchRequestSchema.parse(params || {});
        // Fail-closed: reject dispatch during terminal lifecycle states
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`notification.dispatch denied: agent lifecycle state is '${state}'.`);
        }
        const item = this.notificationManager.notify({
          category: req.category,
          priority: req.priority,
          title: req.title,
          message: req.message,
          taskId: req.taskId,
          correlationId: req.correlationId,
          coalesceKey: req.coalesceKey,
          actions: req.actions,
          ttlSeconds: req.ttlSeconds,
          metadata: req.metadata,
        });
        // All notification responses MUST be sanitized via the policy gate
        const sanitized = this.notificationManager.policyGate.sanitizeAndRedact(item);
        this.telemetryManager.trackTrace('notification_dispatch_ipc', {
          notificationId: sanitized.id,
          category: sanitized.category,
          priority: sanitized.priority,
        });
        return { item: sanitized };
      });
      this.ipcManager.registerMethodHandler('notification.listPending', async (params) => {
        const { NotificationListPendingRequestSchema } = await import('./notifications/schemas.js');
        const req = NotificationListPendingRequestSchema.parse(params || {});
        const maxCount = req.maxCount ?? 50;
        const pending = this.notificationManager.queue.popPending(maxCount);
        // Sanitize every item in the response
        const sanitized = pending.map((item) =>
          this.notificationManager.policyGate.sanitizeAndRedact(item),
        );
        return { items: sanitized };
      });
      this.ipcManager.registerMethodHandler('notification.markRead', async (params) => {
        const { NotificationMarkReadRequestSchema } = await import('./notifications/schemas.js');
        const req = NotificationMarkReadRequestSchema.parse(params || {});
        const marked = this.notificationManager.queue.markRead(req.notificationId);
        return { success: marked };
      });
      this.ipcManager.registerMethodHandler('notification.executeAction', async (params) => {
        const { NotificationExecuteActionRequestSchema } = await import(
          './notifications/schemas.js'
        );
        const req = NotificationExecuteActionRequestSchema.parse(params || {});
        // Fail-closed: require non-empty authToken — Zod already enforces min(1)
        // executeNotificationAction internally calls policyGate.validateActionExecution()
        // which enforces TOCTOU revalidation (expiry check, context binding, auth token)
        const result = this.notificationManager.executeNotificationAction(
          req.notificationId,
          req.actionId,
          req.authToken,
          req.expectedTaskId,
          req.expectedCorrelationId,
        );
        if (!result.success) {
          this.telemetryManager.trackTrace('notification_action_denied', {
            notificationId: req.notificationId,
            actionId: req.actionId,
            reason: result.reason,
          });
        } else {
          this.telemetryManager.trackTrace('notification_action_executed', {
            notificationId: req.notificationId,
            actionId: req.actionId,
          });
        }
        return result;
      });
      this.ipcManager.registerMethodHandler('notification.getMetrics', async (params) => {
        const { NotificationGetMetricsRequestSchema } = await import('./notifications/schemas.js');
        NotificationGetMetricsRequestSchema.parse(params || {});
        return { metrics: this.notificationManager.getHealthMetrics() };
      });
      this.ipcManager.registerMethodHandler('notification.setLockScreen', async (params) => {
        const { NotificationSetLockScreenRequestSchema } = await import(
          './notifications/schemas.js'
        );
        const req = NotificationSetLockScreenRequestSchema.parse(params || {});
        this.notificationManager.setLockScreenActive(req.isActive);
        this.telemetryManager.trackTrace('notification_lock_screen_state_change', {
          isActive: req.isActive,
        });
        return { success: true, isActive: req.isActive };
      });
      this.ipcManager.registerMethodHandler('device.queryInfo', async (params) => {
        const { DeviceQueryInfoIPCRequestSchema } = await import('./runtimes/device/schemas.js');
        DeviceQueryInfoIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`device.queryInfo denied: agent lifecycle state is '${state}'.`);
        }
        const info = await this.deviceRuntime['capabilitiesAdapter'].queryInfo();
        const sanitizedInfo = new RedactionFilter().redactObject(info);
        this.telemetryManager.trackTrace('device_query_info_ipc', { platform: info.platform });
        return { info: sanitizedInfo };
      });
      this.ipcManager.registerMethodHandler('device.getPosture', async (params) => {
        const { DeviceGetPostureIPCRequestSchema } = await import('./runtimes/device/schemas.js');
        DeviceGetPostureIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`device.getPosture denied: agent lifecycle state is '${state}'.`);
        }
        const posture = await this.deviceRuntime['capabilitiesAdapter'].getPosture();
        const sanitizedPosture = new RedactionFilter().redactObject(posture);
        this.telemetryManager.trackTrace('device_get_posture_ipc', { platform: posture.platform });
        return { posture: sanitizedPosture };
      });
      this.ipcManager.registerMethodHandler('filesystem.readFile', async (params) => {
        const { FilesystemReadFileIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemReadFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.readFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.readFile denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.readFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const res = await this.filesystemRuntime.readFile(
            { path: req.path, encoding: req.encoding },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('filesystem_read_file_ipc', { path: req.path });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.readFile failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('filesystem.listDirectory', async (params) => {
        const { FilesystemListDirectoryIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemListDirectoryIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.listDirectory denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.listDirectory denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.listDirectory denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const res = await this.filesystemRuntime.listDirectory(
            { path: req.path, recursive: req.recursive, maxEntries: req.maxEntries },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('filesystem_list_directory_ipc', { path: req.path });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.listDirectory failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('filesystem.statFile', async (params) => {
        const { FilesystemStatFileIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemStatFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.statFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.statFile denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.statFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const res = await this.filesystemRuntime.statFile(
            { path: req.path },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('filesystem_stat_file_ipc', { path: req.path });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.statFile failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('filesystem.writeFile', async (params) => {
        const { FilesystemWriteFileIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemWriteFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.writeFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.writeFile denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.writeFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'filesystem.writeFile denied: required write scope is missing from execution lease.',
          );
        }
        try {
          const res = await this.filesystemRuntime.writeFile(
            {
              path: req.path,
              content: req.content,
              encoding: req.encoding,
              preconditions: req.preconditions,
              overwrite: req.overwrite,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('filesystem_write_file_ipc', { path: req.path });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.writeFile failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('filesystem.copyFile', async (params) => {
        const { FilesystemCopyFileIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemCopyFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.copyFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.copyFile denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.copyFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const res = await this.filesystemRuntime.copyFile(
            {
              sourcePath: req.sourcePath,
              destinationPath: req.destinationPath,
              preconditions: req.preconditions,
              overwrite: req.overwrite,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('filesystem_copy_file_ipc', {
            source: req.sourcePath,
            destination: req.destinationPath,
          });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.copyFile failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('filesystem.moveFile', async (params) => {
        const { FilesystemMoveFileIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemMoveFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.moveFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.moveFile denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.moveFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const res = await this.filesystemRuntime.moveFile(
            {
              sourcePath: req.sourcePath,
              destinationPath: req.destinationPath,
              preconditions: req.preconditions,
              overwrite: req.overwrite,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('filesystem_move_file_ipc', {
            source: req.sourcePath,
            destination: req.destinationPath,
          });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.moveFile failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('filesystem.deleteFile', async (params) => {
        const { FilesystemDeleteFileIPCRequestSchema } = await import(
          './runtimes/filesystem/schemas.js'
        );
        const req = FilesystemDeleteFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`filesystem.deleteFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.FILESYSTEM)) {
          throw new Error(
            'filesystem.deleteFile denied: FILESYSTEM category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `filesystem.deleteFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'filesystem.deleteFile denied: required write scope is missing from execution lease.',
          );
        }
        try {
          const res = await this.filesystemRuntime.deleteFile(
            {
              path: req.path,
              preconditions: req.preconditions,
              permanent: req.permanent,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('filesystem_delete_file_ipc', { path: req.path });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`filesystem.deleteFile failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('terminal.executeCommand', async (params) => {
        const { TerminalExecuteCommandIPCRequestSchema } = await import(
          './runtimes/terminal/schemas.js'
        );
        const req = TerminalExecuteCommandIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`terminal.executeCommand denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.TERMINAL)) {
          throw new Error(
            'terminal.executeCommand denied: TERMINAL category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `terminal.executeCommand denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'terminal.executeCommand denied: required write scope is missing from execution lease.',
          );
        }
        try {
          const res = await this.terminalRuntime.executeCommand(
            {
              command: req.command,
              args: req.args,
              cwd: req.cwd,
              env: req.env,
              timeoutMs: req.timeoutMs,
              maxOutputSizeBytes: req.maxOutputSizeBytes,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('terminal_execute_command_ipc', {
            command: req.command,
            cwd: req.cwd,
          });
          return new RedactionFilter().redactObject(
            res.result as unknown as Record<string, unknown>,
          );
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`terminal.executeCommand failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('terminal.killProcess', async (params) => {
        const { TerminalKillProcessIPCRequestSchema } = await import(
          './runtimes/terminal/schemas.js'
        );
        const req = TerminalKillProcessIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`terminal.killProcess denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.TERMINAL)) {
          throw new Error(
            'terminal.killProcess denied: TERMINAL category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `terminal.killProcess denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'terminal.killProcess denied: required write scope is missing from execution lease.',
          );
        }
        try {
          const res = await this.terminalRuntime.killProcess(
            { processToken: req.processToken },
            {
              lease: req.leaseHeader,
              allowedRoots: [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('terminal_kill_process_ipc', {
            processToken: req.processToken,
          });
          return new RedactionFilter().redactObject({ success: res.success } as unknown as Record<
            string,
            unknown
          >);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`terminal.killProcess failed: ${msg}`);
        }
      });
      this.ipcManager.registerMethodHandler('terminal.listProcesses', async (params) => {
        const { TerminalListProcessesIPCRequestSchema } = await import(
          './runtimes/terminal/schemas.js'
        );
        const req = TerminalListProcessesIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`terminal.listProcesses denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.TERMINAL)) {
          throw new Error(
            'terminal.listProcesses denied: TERMINAL category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `terminal.listProcesses denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const res = await this.terminalRuntime.listProcesses({
            lease: req.leaseHeader,
            allowedRoots: [process.cwd()],
          });
          this.telemetryManager.trackTrace('terminal_list_processes_ipc', {});
          return new RedactionFilter().redactObject({ processes: res } as unknown as Record<
            string,
            unknown
          >);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`terminal.listProcesses failed: ${msg}`);
        }
      });

      /** Task 044: Browser Runtime IPC Handlers */

      // -----------------------------------------------------------------------
      // browser.createSession
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.createSession', async (params) => {
        const { BrowserCreateSessionIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserCreateSessionIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.createSession denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.createSession denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.createSession denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'browser.createSession denied: required browser:write scope is missing from execution lease.',
          );
        }
        const limits = this.browserRuntime.sessionManager.listSessions().length;
        const maxSessions = req.limits?.maxConcurrentSessions ?? 3;
        if (limits >= maxSessions) {
          throw new Error(
            `browser.createSession denied: concurrent session limit (${maxSessions}) reached.`,
          );
        }
        try {
          const session = this.browserRuntime.sessionManager.createSession(
            req.taskId,
            req.workspaceId,
            req.storageDir,
          );
          this.telemetryManager.trackTrace('browser_create_session_ipc', {
            sessionId: session.sessionId,
            taskId: req.taskId,
          });
          return new RedactionFilter().redactObject({
            sessionId: session.sessionId,
            profilePath: session.profilePath,
            createdAt: session.createdAt,
          } as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.createSession failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.navigate
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.navigate', async (params) => {
        const { BrowserNavigateIPCRequestSchema } = await import('./runtimes/browser/schemas.js');
        const req = BrowserNavigateIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.navigate denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error('browser.navigate denied: BROWSER category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.navigate denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'browser.navigate denied: required browser:write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.navigate(
            {
              sessionId: req.sessionId,
              url: req.url,
              allowedDomains: req.allowedDomains,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('browser_navigate_ipc', {
            sessionId: req.sessionId,
            url: req.url,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.navigate failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.extractContent
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.extractContent', async (params) => {
        const { BrowserExtractContentIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserExtractContentIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.extractContent denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.extractContent denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.extractContent denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) => s.includes('read') || s.includes('write') || s.includes('admin') || s === '*',
          )
        ) {
          throw new Error(
            'browser.extractContent denied: required browser:read scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.extractContent(
            {
              sessionId: req.sessionId,
              selector: req.selector,
              maxSizeBytes: req.maxSizeBytes,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('browser_extract_content_ipc', {
            sessionId: req.sessionId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.extractContent failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.interactForm
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.interactForm', async (params) => {
        const { BrowserInteractFormIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserInteractFormIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.interactForm denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.interactForm denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.interactForm denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'browser.interactForm denied: required browser:write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.interactForm(
            {
              sessionId: req.sessionId,
              selector: req.selector,
              actionType: req.actionType,
              value: req.value,
              isSensitiveForm: req.isSensitiveForm,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
            },
          );
          this.telemetryManager.trackTrace('browser_interact_form_ipc', {
            sessionId: req.sessionId,
            selector: req.selector,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.interactForm failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.captureScreenshot
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.captureScreenshot', async (params) => {
        const { BrowserCaptureScreenshotIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserCaptureScreenshotIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.captureScreenshot denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.captureScreenshot denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.captureScreenshot denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) => s.includes('read') || s.includes('write') || s.includes('admin') || s === '*',
          )
        ) {
          throw new Error(
            'browser.captureScreenshot denied: required browser:read scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.captureScreenshot(
            {
              sessionId: req.sessionId,
              destinationPath: req.destinationPath,
              format: req.format,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots,
            },
          );
          this.telemetryManager.trackTrace('browser_capture_screenshot_ipc', {
            sessionId: req.sessionId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.captureScreenshot failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.downloadFile
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.downloadFile', async (params) => {
        const { BrowserDownloadFileIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserDownloadFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.downloadFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.downloadFile denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.downloadFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'browser.downloadFile denied: required browser:write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.downloadFile(
            {
              sessionId: req.sessionId,
              downloadUrl: req.downloadUrl,
              redirectUrl: req.redirectUrl,
              destinationPath: req.destinationPath,
              allowedDomains: req.allowedDomains,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots,
            },
          );
          this.telemetryManager.trackTrace('browser_download_file_ipc', {
            sessionId: req.sessionId,
            downloadUrl: req.downloadUrl,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.downloadFile failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.uploadFile
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.uploadFile', async (params) => {
        const { BrowserUploadFileIPCRequestSchema } = await import('./runtimes/browser/schemas.js');
        const req = BrowserUploadFileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.uploadFile denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error('browser.uploadFile denied: BROWSER category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.uploadFile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'browser.uploadFile denied: required browser:write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.uploadFile(
            {
              sessionId: req.sessionId,
              selector: req.selector,
              sourceFilePath: req.sourceFilePath,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots,
            },
          );
          this.telemetryManager.trackTrace('browser_upload_file_ipc', {
            sessionId: req.sessionId,
            selector: req.selector,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.uploadFile failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.clearSession
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.clearSession', async (params) => {
        const { BrowserClearSessionIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserClearSessionIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.clearSession denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.clearSession denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.clearSession denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (!scopes.some((s) => s.includes('write') || s.includes('admin') || s === '*')) {
          throw new Error(
            'browser.clearSession denied: required browser:write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.browserRuntime.clearSession(
            { sessionId: req.sessionId },
            { lease: req.leaseHeader, allowedRoots: [process.cwd()] },
          );
          this.telemetryManager.trackTrace('browser_clear_session_ipc', {
            sessionId: req.sessionId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.clearSession failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // browser.listSessions
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('browser.listSessions', async (params) => {
        const { BrowserListSessionsIPCRequestSchema } = await import(
          './runtimes/browser/schemas.js'
        );
        const req = BrowserListSessionsIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`browser.listSessions denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)) {
          throw new Error(
            'browser.listSessions denied: BROWSER category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `browser.listSessions denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const sessions = this.browserRuntime.sessionManager.listSessions();
          this.telemetryManager.trackTrace('browser_list_sessions_ipc', {
            count: sessions.length,
          });
          return new RedactionFilter().redactObject({
            sessions,
          } as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`browser.listSessions failed: ${msg}`);
        }
      });

      /** Task 045: Plugin Runtime IPC Handlers */

      // -----------------------------------------------------------------------
      // plugin.verify
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.verify', async (params) => {
        const { PluginVerifyPackageIPCRequestSchema } = await import(
          './runtimes/plugin/schemas.js'
        );
        const req = PluginVerifyPackageIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.verify denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.verify denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.verify denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const { result, event } = await this.pluginRuntime.verifyPluginPackage(req.pkg, {
            lease: req.leaseHeader,
            allowedRoots: req.allowedRoots || [process.cwd()],
            limits: req.limits,
          });
          this.telemetryManager.trackTrace('plugin_verify_ipc', {
            pluginId: req.pkg?.manifest?.pluginId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.verify failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.install
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.install', async (params) => {
        const { PluginInstallIPCRequestSchema } = await import('./runtimes/plugin/schemas.js');
        const req = PluginInstallIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.install denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.install denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.install denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) =>
              s.includes('write') ||
              s.includes('admin') ||
              s.includes('plugin:install') ||
              s === '*',
          )
        ) {
          throw new Error(
            'plugin.install denied: required plugin:install or write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.pluginRuntime.installPlugin(req.pkg, {
            lease: req.leaseHeader,
            allowedRoots: req.allowedRoots || [process.cwd()],
            limits: req.limits,
          });
          this.telemetryManager.trackTrace('plugin_install_ipc', {
            pluginId: req.pkg?.manifest?.pluginId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.install failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.activate
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.activate', async (params) => {
        const { PluginActivateIPCRequestSchema } = await import('./runtimes/plugin/schemas.js');
        const req = PluginActivateIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.activate denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.activate denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.activate denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) =>
              s.includes('write') ||
              s.includes('admin') ||
              s.includes('plugin:activate') ||
              s === '*',
          )
        ) {
          throw new Error(
            'plugin.activate denied: required plugin:activate or write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.pluginRuntime.activatePlugin(req.pluginId, {
            lease: req.leaseHeader,
            allowedRoots: req.allowedRoots || [process.cwd()],
            limits: req.limits,
          });
          this.telemetryManager.trackTrace('plugin_activate_ipc', {
            pluginId: req.pluginId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.activate failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.invoke
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.invoke', async (params) => {
        const { PluginInvokeIPCRequestSchema } = await import('./runtimes/plugin/schemas.js');
        const req = PluginInvokeIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.invoke denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.invoke denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.invoke denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) =>
              s.includes('write') ||
              s.includes('admin') ||
              s.includes('plugin:invoke') ||
              s.includes(`plugin:${req.capability}`) ||
              s === '*',
          )
        ) {
          throw new Error(
            'plugin.invoke denied: required plugin:invoke or capability scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.pluginRuntime.invokePlugin(
            {
              pluginId: req.pluginId,
              capability: req.capability,
              action: req.action,
              payload: req.payload,
            },
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('plugin_invoke_ipc', {
            pluginId: req.pluginId,
            capability: req.capability,
            action: req.action,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.invoke failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.suspend
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.suspend', async (params) => {
        const { PluginSuspendIPCRequestSchema } = await import('./runtimes/plugin/schemas.js');
        const req = PluginSuspendIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.suspend denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.suspend denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.suspend denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) =>
              s.includes('write') ||
              s.includes('admin') ||
              s.includes('plugin:suspend') ||
              s === '*',
          )
        ) {
          throw new Error(
            'plugin.suspend denied: required plugin:suspend or write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.pluginRuntime.suspendPlugin(req.pluginId, {
            lease: req.leaseHeader,
            allowedRoots: req.allowedRoots || [process.cwd()],
            limits: req.limits,
          });
          this.telemetryManager.trackTrace('plugin_suspend_ipc', {
            pluginId: req.pluginId,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.suspend failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.quarantine
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.quarantine', async (params) => {
        const { PluginQuarantineIPCRequestSchema } = await import('./runtimes/plugin/schemas.js');
        const req = PluginQuarantineIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.quarantine denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.quarantine denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.quarantine denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const scopes = req.leaseHeader.scopes || [];
        if (
          !scopes.some(
            (s) =>
              s.includes('write') ||
              s.includes('admin') ||
              s.includes('plugin:quarantine') ||
              s === '*',
          )
        ) {
          throw new Error(
            'plugin.quarantine denied: required plugin:quarantine or write scope is missing from execution lease.',
          );
        }
        try {
          const { result, event } = await this.pluginRuntime.quarantinePlugin(
            req.pluginId,
            req.reason,
            {
              lease: req.leaseHeader,
              allowedRoots: req.allowedRoots || [process.cwd()],
              limits: req.limits,
            },
          );
          this.telemetryManager.trackTrace('plugin_quarantine_ipc', {
            pluginId: req.pluginId,
            reason: req.reason,
          });
          void event;
          return new RedactionFilter().redactObject(result as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.quarantine failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.listEntries
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.listEntries', async (params) => {
        const { PluginListEntriesIPCRequestSchema } = await import('./runtimes/plugin/schemas.js');
        const req = PluginListEntriesIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.listEntries denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error('plugin.listEntries denied: PLUGIN category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.listEntries denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const entries = this.pluginRuntime.catalog.listEntries();
          this.telemetryManager.trackTrace('plugin_list_entries_ipc', {
            count: entries.length,
          });
          return new RedactionFilter().redactObject({
            entries,
          } as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.listEntries failed: ${msg}`);
        }
      });

      // -----------------------------------------------------------------------
      // plugin.listQuarantined
      // -----------------------------------------------------------------------
      this.ipcManager.registerMethodHandler('plugin.listQuarantined', async (params) => {
        const { PluginListQuarantinedIPCRequestSchema } = await import(
          './runtimes/plugin/schemas.js'
        );
        const req = PluginListQuarantinedIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`plugin.listQuarantined denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)) {
          throw new Error(
            'plugin.listQuarantined denied: PLUGIN category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `plugin.listQuarantined denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        try {
          const quarantined = this.pluginRuntime.quarantineStore.listQuarantined();
          this.telemetryManager.trackTrace('plugin_list_quarantined_ipc', {
            count: quarantined.length,
          });
          return new RedactionFilter().redactObject({
            quarantined,
          } as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`plugin.listQuarantined failed: ${msg}`);
        }
      });

      /** Task 046: Local AI Runtime IPC Handlers */
      this.ipcManager.registerMethodHandler('localAi.generate', async (params) => {
        const req = LocalAiGenerateIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`localAi.generate denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI)) {
          throw new Error('localAi.generate denied: LOCAL_AI category not authorized by policy.');
        }
        if (req.tenantId !== req.leaseHeader.tenant_id) {
          throw new Error(
            `localAi.generate denied: tenant_id mismatch. Payload tenantId '${req.tenantId}' does not match lease tenant_id '${req.leaseHeader.tenant_id}'.`,
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `localAi.generate denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const leaseScopes = Array.isArray(leaseDecision.lease?.scopes)
          ? leaseDecision.lease.scopes
          : [];
        const hasScope =
          leaseScopes.includes('*') ||
          leaseScopes.includes('admin') ||
          leaseScopes.includes('ai:write') ||
          leaseScopes.includes('ai:inference');
        if (!hasScope) {
          throw new Error(
            `localAi.generate denied: missing required 'ai:inference' or 'ai:write' scope (granted: ${JSON.stringify(leaseScopes)}).`,
          );
        }
        try {
          const chunks = [];
          for await (const chunk of this.localAiRuntime.executeInference(req)) {
            chunks.push(chunk);
          }
          this.telemetryManager.trackTrace('local_ai_generate_ipc', {
            modelId: req.modelId,
            provider: req.provider,
            chunkCount: chunks.length,
          });
          return new RedactionFilter().redactObject({ chunks });
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`localAi.generate failed: ${msg}`);
        }
      });

      this.ipcManager.registerMethodHandler('localAi.listModels', async (params) => {
        const req = LocalAiListModelsIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`localAi.listModels denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI)) {
          throw new Error('localAi.listModels denied: LOCAL_AI category not authorized by policy.');
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `localAi.listModels denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const leaseScopes = Array.isArray(leaseDecision.lease?.scopes)
          ? leaseDecision.lease.scopes
          : [];
        const hasScope =
          leaseScopes.includes('*') ||
          leaseScopes.includes('admin') ||
          leaseScopes.includes('ai:read') ||
          leaseScopes.includes('ai:inference') ||
          leaseScopes.includes('ai:write');
        if (!hasScope) {
          throw new Error(
            `localAi.listModels denied: missing required 'ai:read' scope (granted: ${JSON.stringify(leaseScopes)}).`,
          );
        }
        try {
          const models = this.localAiRuntime.listModels();
          this.telemetryManager.trackTrace('local_ai_list_models_ipc', {
            count: models.length,
          });
          return new RedactionFilter().redactObject({ models });
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`localAi.listModels failed: ${msg}`);
        }
      });

      this.ipcManager.registerMethodHandler('localAi.getHardwareProfile', async (params) => {
        const req = LocalAiGetHardwareProfileIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(
            `localAi.getHardwareProfile denied: agent lifecycle state is '${state}'.`,
          );
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI)) {
          throw new Error(
            'localAi.getHardwareProfile denied: LOCAL_AI category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `localAi.getHardwareProfile denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const leaseScopes = Array.isArray(leaseDecision.lease?.scopes)
          ? leaseDecision.lease.scopes
          : [];
        const hasScope =
          leaseScopes.includes('*') ||
          leaseScopes.includes('admin') ||
          leaseScopes.includes('ai:read') ||
          leaseScopes.includes('ai:inference') ||
          leaseScopes.includes('ai:write');
        if (!hasScope) {
          throw new Error(
            `localAi.getHardwareProfile denied: missing required 'ai:read' scope (granted: ${JSON.stringify(leaseScopes)}).`,
          );
        }
        try {
          const profile = await this.localAiRuntime.getHardwareProfile();
          this.telemetryManager.trackTrace('local_ai_get_hardware_profile_ipc', {
            cpuArch: profile.cpuArch,
            gpuCount: profile.gpuAdapters.length,
          });
          return new RedactionFilter().redactObject(profile as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`localAi.getHardwareProfile failed: ${msg}`);
        }
      });

      this.ipcManager.registerMethodHandler('localAi.unloadModel', async (params) => {
        const req = LocalAiUnloadModelIPCRequestSchema.parse(params || {});
        const state = this.lifecycle.getState();
        if (
          state === AgentLifecycleState.STOPPING ||
          state === AgentLifecycleState.STOPPED ||
          state === AgentLifecycleState.FAILED
        ) {
          throw new Error(`localAi.unloadModel denied: agent lifecycle state is '${state}'.`);
        }
        if (!new PluginExecutionPolicy().isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI)) {
          throw new Error(
            'localAi.unloadModel denied: LOCAL_AI category not authorized by policy.',
          );
        }
        const leaseDecision = await this.leaseBoundary.validateLease(req.leaseHeader);
        if (!leaseDecision.valid) {
          throw new Error(
            `localAi.unloadModel denied: lease validation failed (${leaseDecision.reason}).`,
          );
        }
        const leaseScopes = Array.isArray(leaseDecision.lease?.scopes)
          ? leaseDecision.lease.scopes
          : [];
        const hasScope =
          leaseScopes.includes('*') ||
          leaseScopes.includes('admin') ||
          leaseScopes.includes('ai:write');
        if (!hasScope) {
          throw new Error(
            `localAi.unloadModel denied: missing required 'ai:write' scope (granted: ${JSON.stringify(leaseScopes)}).`,
          );
        }
        try {
          await this.localAiRuntime.unloadModel(req.modelId);
          this.telemetryManager.trackTrace('local_ai_unload_model_ipc', {
            modelId: req.modelId,
          });
          return new RedactionFilter().redactObject({
            success: true,
            modelId: req.modelId,
          });
        } catch (err) {
          const msg = new RedactionFilter().redactString(
            err instanceof Error ? err.message : String(err),
          );
          throw new Error(`localAi.unloadModel failed: ${msg}`);
        }
      });
    }

    if (typeof this.controlPlaneClient.registerCommandHandler === 'function') {
      this.controlPlaneClient.registerCommandHandler(async (envelope) => {
        if (envelope.payload && typeof envelope.payload === 'object') {
          if (envelope.schema_id === 'schema:nexusos:acp:workflow:execute:v1') {
            const rawPayload = envelope.payload as Record<string, unknown>;
            const dag = (rawPayload.workflow ? rawPayload.workflow : rawPayload) as WorkflowDAG;
            await this.workflowEngine.executeWorkflow(dag);
          } else {
            await this.taskScheduler.scheduleTask(
              envelope.payload as unknown as TaskExecutionRequest,
            );
          }
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
      await this.localAiRuntime.initialize();
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
    this.deviceRuntime.shutdown();
    this.filesystemRuntime.shutdown();
    this.terminalRuntime.shutdown();
    this.browserRuntime.shutdown();
    this.pluginRuntime.shutdown();
    this.ideAdapter.reset();

    this.trayController.shutdown();
    this.approvalHost.shutdown();
    this.vaultClient.shutdown();
    this.updateManager.shutdown();
    await this.localAiRuntime.shutdown();
    await this.stateManager.stop();
    // Purge stale expired notification queue items on shutdown.
    // NotificationManager has no open handles or timers; it uses lazy TTL expiry.
    // Calling purgeExpired() here ensures the disk-persisted queue file is cleaned
    // of expired entries without destructively dropping unread CRITICAL notifications.
    try {
      this.notificationManager.queue.purgeExpired();
    } catch {
      // Suppress notification cleanup errors during shutdown
    }
    try {
      await this.telemetryManager.flush();
    } catch {
      // Suppress telemetry flush errors during shutdown
    }

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

  public getWorkflowEngine(): WorkflowEngine {
    return this.workflowEngine;
  }

  public async executeWorkflow(
    dag: WorkflowDAG,
  ): Promise<import('./orchestrator/types.js').TaskExecutionResult> {
    return this.workflowEngine.executeWorkflow(dag);
  }
}
