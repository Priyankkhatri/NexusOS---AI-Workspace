import { ConnectionState } from './types.js';

export interface BackoffConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

export class ConnectionStateMachine {
  private currentState: ConnectionState = ConnectionState.UNPAIRED;
  private attemptCount = 0;
  private timerHandle?: NodeJS.Timeout;

  constructor(
    private readonly backoffConfig: BackoffConfig = {
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      multiplier: 2.0,
    },
    initialState: ConnectionState = ConnectionState.UNPAIRED,
  ) {
    this.currentState = initialState;
  }

  public getState(): ConnectionState {
    return this.currentState;
  }

  public isConnected(): boolean {
    return this.currentState === ConnectionState.CONNECTED_ACTIVE;
  }

  public isOffline(): boolean {
    return (
      this.currentState === ConnectionState.OFFLINE ||
      this.currentState === ConnectionState.DEGRADED ||
      this.currentState === ConnectionState.UNPAIRED ||
      this.currentState === ConnectionState.REVOKED
    );
  }

  public transitionTo(newState: ConnectionState): void {
    if (this.currentState === newState) return;

    // Validate valid state transitions
    if (this.currentState === ConnectionState.REVOKED && newState !== ConnectionState.UNPAIRED) {
      throw new Error(`Cannot transition from REVOKED state to ${newState}. Agent trust revoked.`);
    }

    this.currentState = newState;

    if (newState === ConnectionState.CONNECTED_ACTIVE) {
      this.resetAttempts();
    }
  }

  public calculateNextBackoffMs(): number {
    const { initialDelayMs, maxDelayMs, multiplier } = this.backoffConfig;
    const baseDelay = Math.min(
      maxDelayMs,
      initialDelayMs * Math.pow(multiplier, this.attemptCount),
    );
    this.attemptCount++;

    // Randomized full jitter: Math.floor(Math.random() * baseDelay)
    // Ensures uniform distribution from 0 to baseDelay to prevent thundering herd reconnect storms
    const jitteredDelay = Math.floor(Math.random() * baseDelay);
    return Math.max(initialDelayMs / 2, jitteredDelay);
  }

  public getAttemptCount(): number {
    return this.attemptCount;
  }

  public resetAttempts(): void {
    this.attemptCount = 0;
  }

  public scheduleReconnect(callback: () => void | Promise<void>): number {
    this.cancelScheduledReconnect();
    const delayMs = this.calculateNextBackoffMs();

    this.timerHandle = setTimeout(() => {
      this.timerHandle = undefined;
      void callback();
    }, delayMs);

    // Unref timer so it does not keep Node process alive on shutdown
    if (this.timerHandle && typeof this.timerHandle.unref === 'function') {
      this.timerHandle.unref();
    }

    return delayMs;
  }

  public cancelScheduledReconnect(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }
  }
}
