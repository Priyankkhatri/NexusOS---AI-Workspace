import { Logger } from '@nexusos/backend';
import { DesktopAgentConfig } from './config/index.js';
import { AgentLifecycleManager, AgentLifecycleState } from './lifecycle/index.js';
import { AgentIdentityProvider, AgentIdentity } from './identity/agent-identity.js';
import { ControlPlaneClient } from './communication/control-plane-client.js';
import { CapabilityRegistry } from './registry/capability-registry.js';
import { RuntimeRegistry } from './registry/runtime-registry.js';
import { ExecutionLeaseBoundary } from './permissions/lease-boundary.js';
import { LocalStateStore } from './state/local-state-store.js';
import { AgentLogger } from './observability/agent-logger.js';
import { SandboxIsolationBoundary } from './sandbox/isolation-boundary.js';

export class DesktopAgent {
  public readonly lifecycle: AgentLifecycleManager;
  public readonly capabilityRegistry: CapabilityRegistry;
  public readonly runtimeRegistry: RuntimeRegistry;
  public readonly isolationBoundary: SandboxIsolationBoundary;
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
  ) {
    this.lifecycle = new AgentLifecycleManager();
    this.capabilityRegistry = new CapabilityRegistry();
    this.runtimeRegistry = new RuntimeRegistry();
    this.isolationBoundary = new SandboxIsolationBoundary();
    this.logger = new AgentLogger(baseLogger);
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

    try {
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
