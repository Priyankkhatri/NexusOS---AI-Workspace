export class TaskRetryPolicy {
  constructor(
    private readonly maxRetries: number = 3,
    private readonly initialDelayMs: number = 1000,
    private readonly maxDelayMs: number = 30000,
    private readonly backoffMultiplier: number = 2.0,
  ) {}

  public isRetryableError(errorCode?: string): boolean {
    if (!errorCode) return false;
    return (
      errorCode === 'NETWORK_TIMEOUT' ||
      errorCode === 'RATE_LIMITED' ||
      errorCode === 'PROVIDER_CAPACITY' ||
      errorCode === 'TRANSIENT_ERROR'
    );
  }

  public shouldRetry(currentAttempts: number, errorCode?: string): boolean {
    return currentAttempts < this.maxRetries && this.isRetryableError(errorCode);
  }

  public calculateNextBackoffDelay(currentAttempts: number): number {
    const baseDelay = this.initialDelayMs * Math.pow(this.backoffMultiplier, currentAttempts - 1);
    const jitterFactor = 0.8 + Math.random() * 0.4; // Jitter between 80% and 120%
    return Math.min(this.maxDelayMs, Math.floor(baseDelay * jitterFactor));
  }
}
