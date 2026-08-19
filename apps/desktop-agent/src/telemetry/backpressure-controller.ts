import { EventPriority, IBackpressureController, LogLevel, SpoolMetrics } from './types.js';

export class BackpressureController implements IBackpressureController {
  private totalItemsSpooled = 0;
  private criticalItemsCount = 0;
  private nonCriticalItemsCount = 0;
  private evictedItemsCount = 0;
  private spoolUsedBytes = 0;
  private isCriticalFull = false;

  constructor(
    private readonly maxCapacityBytes: number = 50_000_000, // 50 MB Max Spool Limit
    private readonly warningThresholdBytes: number = 40_000_000, // 40 MB Warning Limit (80%)
    private samplingRateNonCritical: number = 1.0,
  ) {}

  public isBackpressureActive(): boolean {
    return this.isCriticalFull || this.spoolUsedBytes >= this.warningThresholdBytes;
  }

  public setCriticalSpoolFull(isFull: boolean): void {
    this.isCriticalFull = isFull;
  }

  public isCriticalSchemaId(schemaId: string): boolean {
    if (!schemaId || typeof schemaId !== 'string') return false;
    // Attacker prevention: Must strictly start with authorized nexusos.events namespace!
    if (!schemaId.startsWith('nexusos.events.')) return false;
    return (
      schemaId.startsWith('nexusos.events.security') ||
      schemaId.startsWith('nexusos.events.agent.state') ||
      schemaId.startsWith('nexusos.events.policy') ||
      schemaId.startsWith('nexusos.events.config') ||
      schemaId.startsWith('nexusos.events.recovery')
    );
  }

  public shouldSampleLog(level: LogLevel, priority: EventPriority): boolean {
    // CRITICAL events must NEVER be sampled or dropped!
    if (priority === 'CRITICAL' || level === 'fatal' || level === 'error') {
      return true;
    }

    // Under backpressure, non-critical debug/info logs are sampled
    if (this.isBackpressureActive()) {
      if (level === 'debug') {
        return Math.random() < 0.1; // Sample 10% of debug logs under backpressure
      }
      if (level === 'info') {
        return Math.random() < 0.5; // Sample 50% of info logs under backpressure
      }
    }

    return Math.random() < this.samplingRateNonCritical;
  }

  public recordItemAdded(priority: EventPriority, estimatedBytes: number): void {
    this.totalItemsSpooled++;
    this.spoolUsedBytes += estimatedBytes;

    if (priority === 'CRITICAL') {
      this.criticalItemsCount++;
    } else {
      this.nonCriticalItemsCount++;
    }
  }

  public recordItemEvicted(count: number = 1): void {
    this.evictedItemsCount += count;
    if (this.nonCriticalItemsCount >= count) {
      this.nonCriticalItemsCount -= count;
    }
  }

  public resetSpoolUsage(): void {
    this.totalItemsSpooled = 0;
    this.criticalItemsCount = 0;
    this.nonCriticalItemsCount = 0;
    this.spoolUsedBytes = 0;
    this.isCriticalFull = false;
  }

  public getMetrics(): SpoolMetrics {
    return {
      totalItemsSpooled: this.totalItemsSpooled,
      criticalItemsCount: this.criticalItemsCount,
      nonCriticalItemsCount: this.nonCriticalItemsCount,
      evictedItemsCount: this.evictedItemsCount,
      spoolCapacityBytes: this.maxCapacityBytes,
      spoolUsedBytes: this.spoolUsedBytes,
      isBackpressureActive: this.isBackpressureActive(),
      isCriticalSpoolFull: this.isCriticalFull,
    };
  }
}
