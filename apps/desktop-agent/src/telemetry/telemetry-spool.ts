import fs from 'node:fs';
import path from 'node:path';
import { EventEnvelope } from '@nexusos/contracts';
import { BackpressureController } from './backpressure-controller.js';
import { RedactionFilter } from './redaction-filter.js';
import { ITelemetrySpool, SpoolMetrics, TelemetryItem } from './types.js';

export class TelemetrySpool implements ITelemetrySpool {
  private readonly items: TelemetryItem[] = [];
  private readonly hardMaxCapacity: number;
  private readonly spoolFilePath?: string;

  constructor(
    private readonly backpressureController: BackpressureController = new BackpressureController(),
    private readonly redactionFilter: RedactionFilter = new RedactionFilter(),
    private readonly maxQueueLength: number = 5000,
    storageDir?: string,
  ) {
    this.hardMaxCapacity = maxQueueLength * 2;
    if (storageDir) {
      this.spoolFilePath = path.join(storageDir, '.nexusos-telemetry-spool.json');
      this.loadSpoolFromStorage();
    }
  }

  public enqueueItem(item: TelemetryItem): boolean {
    if (!item) return false;

    // Apply mandatory redaction filter on item attributes and name
    const sanitizedItem: TelemetryItem = {
      ...item,
      name: this.redactionFilter.redactString(item.name),
      attributes: this.redactionFilter.redactObject(item.attributes),
    };

    const estBytes = JSON.stringify(sanitizedItem).length;

    // Capacity Management & Fail-Closed Protection
    if (this.items.length >= this.maxQueueLength) {
      if (sanitizedItem.priority === 'CRITICAL') {
        // Step 1: Evict oldest NON_CRITICAL item to preserve CRITICAL event
        const nonCriticalIdx = this.items.findIndex((i) => i.priority === 'NON_CRITICAL');
        if (nonCriticalIdx !== -1) {
          this.items.splice(nonCriticalIdx, 1);
          this.backpressureController.recordItemEvicted(1);
        } else if (this.items.length >= this.hardMaxCapacity) {
          // Step 2: Queue is 100% full of CRITICAL events up to hard capacity ceiling!
          // FAIL CLOSED: Never silently discard critical events!
          // Signal critical spool saturation so ReadinessGate / ExecutionLease blocks new work.
          this.backpressureController.setCriticalSpoolFull(true);
          return false;
        }
      } else {
        // Drop new NON_CRITICAL item when soft capacity is full
        this.backpressureController.recordItemEvicted(1);
        return false;
      }
    }

    this.items.push(sanitizedItem);
    this.backpressureController.recordItemAdded(sanitizedItem.priority, estBytes);
    this.persistSpoolToStorage();
    return true;
  }

  public enqueueEventEnvelope(envelope: EventEnvelope): boolean {
    if (!envelope) return false;

    // Determine priority: Security, state changes, policy decisions, audit evidence are CRITICAL!
    const isCritical = this.backpressureController.isCriticalSchemaId(envelope.schema_id);

    const item: TelemetryItem = {
      itemId: envelope.event_id,
      timestamp: envelope.occurred_at,
      type: 'EVENT',
      name: envelope.schema_id,
      attributes: envelope.payload || {},
      priority: isCritical ? 'CRITICAL' : 'NON_CRITICAL',
    };

    return this.enqueueItem(item);
  }

  public popBatch(maxItems: number = 100): TelemetryItem[] {
    if (this.items.length === 0) return [];
    const count = Math.min(maxItems, this.items.length);
    const popped = this.items.splice(0, count);
    if (this.items.length < this.hardMaxCapacity) {
      this.backpressureController.setCriticalSpoolFull(false);
    }
    this.persistSpoolToStorage();
    return popped;
  }

  public getSpoolMetrics(): SpoolMetrics {
    return this.backpressureController.getMetrics();
  }

  public clearSpool(): void {
    this.items.length = 0;
    this.backpressureController.resetSpoolUsage();
    this.persistSpoolToStorage();
  }

  /**
   * Atomically persists spooled items to local storage file to survive process restart.
   */
  private persistSpoolToStorage(): void {
    if (!this.spoolFilePath) return;
    try {
      const dir = path.dirname(this.spoolFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.spoolFilePath}.tmp`;
      const data = JSON.stringify(this.items);
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.spoolFilePath);
    } catch {
      // Disk write failure triggers critical spool full backpressure signal
      this.backpressureController.setCriticalSpoolFull(true);
    }
  }

  /**
   * Loads persisted spooled items on process startup.
   */
  private loadSpoolFromStorage(): void {
    if (!this.spoolFilePath) return;
    try {
      if (fs.existsSync(this.spoolFilePath)) {
        const raw = fs.readFileSync(this.spoolFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as TelemetryItem[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.itemId && item.priority) {
              this.items.push(item);
              this.backpressureController.recordItemAdded(
                item.priority,
                JSON.stringify(item).length,
              );
            }
          }
        }
      }
    } catch {
      // Isolate corrupted spool file to prevent infinite crash loop
      try {
        if (fs.existsSync(this.spoolFilePath)) {
          fs.renameSync(this.spoolFilePath, `${this.spoolFilePath}.corrupted.${Date.now()}`);
        }
      } catch {
        // Suppress secondary cleanup failure
      }
    }
  }
}
