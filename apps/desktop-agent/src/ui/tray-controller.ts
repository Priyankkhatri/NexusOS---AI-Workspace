import type { TrayMenuDescriptor, TrayState, TrayStatus } from './types.js';

export class TrayUIController {
  private currentState: TrayState = 'CONNECTED';
  private isPaused = false;
  private activeTaskCount = 0;
  private pendingApprovalCount = 0;
  private statusMessage?: string;
  private lastUpdated = Date.now();

  constructor() {
    this.reevaluateState();
  }

  /**
   * Returns current status snapshot of System Tray UI.
   */
  public getStatus(): TrayStatus {
    return {
      state: this.currentState,
      isPaused: this.isPaused,
      activeTaskCount: this.activeTaskCount,
      pendingApprovalCount: this.pendingApprovalCount,
      lastUpdated: this.lastUpdated,
      statusMessage: this.statusMessage,
    };
  }

  /**
   * Pauses the desktop agent from System Tray action menu.
   */
  public pause(reason = 'User paused from System Tray'): TrayStatus {
    this.isPaused = true;
    this.statusMessage = reason;
    this.reevaluateState();
    return this.getStatus();
  }

  /**
   * Resumes normal desktop agent operation from System Tray action menu.
   */
  public resume(): TrayStatus {
    this.isPaused = false;
    this.statusMessage = undefined;
    this.reevaluateState();
    return this.getStatus();
  }

  /**
   * Updates active task counter and reevaluates tray state posture.
   */
  public setActiveTaskCount(count: number): void {
    this.activeTaskCount = Math.max(0, count);
    this.reevaluateState();
  }

  /**
   * Updates pending approval prompt counter and reevaluates tray state posture.
   */
  public setPendingApprovalCount(count: number): void {
    this.pendingApprovalCount = Math.max(0, count);
    this.reevaluateState();
  }

  /**
   * Sets explicit agent error or offline status message.
   */
  public setStatusOverride(state: TrayState, message?: string): void {
    this.currentState = state;
    this.statusMessage = message;
    this.lastUpdated = Date.now();
  }

  /**
   * Returns available System Tray context menu items and enabled states.
   */
  public getMenuDescriptors(): TrayMenuDescriptor[] {
    return [
      {
        id: 'open_dashboard',
        label: 'Open NexusOS Dashboard',
        enabled: true,
        shortcut: 'Ctrl+Shift+D',
      },
      {
        id: this.isPaused ? 'resume_agent' : 'pause_agent',
        label: this.isPaused ? 'Resume Agent' : 'Pause Agent',
        enabled: true,
      },
      {
        id: 'view_active_task',
        label: `Active Tasks (${this.activeTaskCount})`,
        enabled: this.activeTaskCount > 0,
      },
      {
        id: 'open_diagnostics',
        label: 'Agent Diagnostics',
        enabled: true,
      },
      {
        id: 'emergency_stop',
        label: 'Emergency Stop All Runtimes',
        enabled: true,
      },
      {
        id: 'quit',
        label: 'Exit Desktop Agent',
        enabled: true,
      },
    ];
  }

  /**
   * Reevaluates current state machine posture based on flags and counters.
   */
  private reevaluateState(): void {
    if (this.isPaused) {
      this.currentState = 'PAUSED';
    } else if (this.pendingApprovalCount > 0) {
      this.currentState = 'AWAITING_APPROVAL';
    } else if (this.activeTaskCount > 0) {
      this.currentState = 'WORKING';
    } else {
      this.currentState = 'CONNECTED';
    }
    this.lastUpdated = Date.now();
  }

  /**
   * Deterministic shutdown wiping state.
   */
  public shutdown(): void {
    this.isPaused = false;
    this.activeTaskCount = 0;
    this.pendingApprovalCount = 0;
    this.statusMessage = undefined;
    this.currentState = 'OFFLINE';
    this.lastUpdated = Date.now();
  }
}
