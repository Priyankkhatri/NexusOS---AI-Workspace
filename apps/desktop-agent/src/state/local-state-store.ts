import { AgentLifecycleState } from '../lifecycle/index.js';

export interface LocalAgentStateSnapshot {
  deviceId: string;
  tenantId: string;
  lifecycleState: AgentLifecycleState;
  controlPlaneConnected: boolean;
  registeredCapabilities: string[];
  registeredRuntimes: string[];
  lastHeartbeatAt?: string;
}

export interface LocalStateStore {
  saveState(snapshot: LocalAgentStateSnapshot): Promise<void>;
  loadState(): Promise<LocalAgentStateSnapshot | null>;
  clearState(): Promise<void>;
}

export class InMemoryLocalStateStore implements LocalStateStore {
  private currentSnapshot: LocalAgentStateSnapshot | null = null;

  async saveState(snapshot: LocalAgentStateSnapshot): Promise<void> {
    this.currentSnapshot = Object.freeze({ ...snapshot });
  }

  async loadState(): Promise<LocalAgentStateSnapshot | null> {
    return this.currentSnapshot;
  }

  async clearState(): Promise<void> {
    this.currentSnapshot = null;
  }
}
