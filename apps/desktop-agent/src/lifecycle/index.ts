export enum AgentLifecycleState {
  STARTING = 'STARTING',
  READY = 'READY',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
}

const VALID_TRANSITIONS: Record<AgentLifecycleState, AgentLifecycleState[]> = {
  [AgentLifecycleState.STARTING]: [
    AgentLifecycleState.READY,
    AgentLifecycleState.FAILED,
    AgentLifecycleState.STOPPING,
  ],
  [AgentLifecycleState.READY]: [
    AgentLifecycleState.DEGRADED,
    AgentLifecycleState.STOPPING,
    AgentLifecycleState.FAILED,
  ],
  [AgentLifecycleState.DEGRADED]: [
    AgentLifecycleState.READY,
    AgentLifecycleState.STOPPING,
    AgentLifecycleState.FAILED,
  ],
  [AgentLifecycleState.STOPPING]: [AgentLifecycleState.STOPPED, AgentLifecycleState.FAILED],
  [AgentLifecycleState.STOPPED]: [AgentLifecycleState.STARTING],
  [AgentLifecycleState.FAILED]: [AgentLifecycleState.STARTING, AgentLifecycleState.STOPPED],
};

export class AgentLifecycleManager {
  private currentState: AgentLifecycleState = AgentLifecycleState.STOPPED;

  getState(): AgentLifecycleState {
    return this.currentState;
  }

  isReady(): boolean {
    return this.currentState === AgentLifecycleState.READY;
  }

  isStoppingOrStopped(): boolean {
    return (
      this.currentState === AgentLifecycleState.STOPPING ||
      this.currentState === AgentLifecycleState.STOPPED
    );
  }

  transitionTo(nextState: AgentLifecycleState, reason?: string): void {
    const allowed = VALID_TRANSITIONS[this.currentState];
    if (!allowed.includes(nextState)) {
      throw new Error(
        `[InvalidLifecycleTransition] Cannot transition from '${this.currentState}' to '${nextState}'. Allowed transitions: [${allowed.join(', ')}]. Reason: ${reason || 'unspecified'}`,
      );
    }

    this.currentState = nextState;
  }
}
