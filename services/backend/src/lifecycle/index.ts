/**
 * Backend Service Lifecycle States matching Backend EDD Section 3.1
 */
export enum ServiceLifecycleState {
  PROVISIONED = 'PROVISIONED',
  STARTING = 'STARTING',
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  DRAINING = 'DRAINING',
  STOPPED = 'STOPPED',
}

export class LifecycleManager {
  private state: ServiceLifecycleState = ServiceLifecycleState.PROVISIONED;
  private readonly startedAt: Date = new Date();

  getState(): ServiceLifecycleState {
    return this.state;
  }

  setState(newState: ServiceLifecycleState): void {
    this.state = newState;
  }

  isHealthy(): boolean {
    return this.state === ServiceLifecycleState.HEALTHY;
  }

  isReady(): boolean {
    return (
      this.state === ServiceLifecycleState.HEALTHY || this.state === ServiceLifecycleState.DEGRADED
    );
  }

  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
  }
}
