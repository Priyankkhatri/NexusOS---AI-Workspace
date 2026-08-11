import { EventEnvelope } from '@nexusos/contracts';
import { BackpressureController } from './backpressure-controller.js';
import { RedactionFilter } from './redaction-filter.js';
import { ITelemetrySpool, SpoolMetrics, TelemetryItem } from './types.js';

export class TelemetrySpool implements ITelemetrySpool {
  private readonly items: TelemetryItem[] = [];

  constructor(
    private readonly backpressureController: BackpressureController = new BackpressureController(),
    private readonly redactionFilter: RedactionFilter = new RedactionFilter(),
    private readonly maxQueueLength: number = 5000,
  ) {}

  public enqueueItem(item: TelemetryItem): boolean {
    if (!item) return false;

    // Apply mandatory redaction filter on item attributes and name
    const sanitizedItem: TelemetryItem = {
      ...item,
      name: this.redactionFilter.redactString(item.name),
      attributes: this.redactionFilter.redactObject(item.attributes),
    };

    const estBytes = JSON.stringify(sanitizedItem).length;

    // Zero-loss guarantee for CRITICAL events under queue capacity pressure
    if (this.items.length >= this.maxQueueLength) {
      if (sanitizedItem.priority === 'CRITICAL') {
        // Evict oldest NON_CRITICAL item to make room for CRITICAL event
        const nonCriticalIdx = this.items.findIndex((i) => i.priority === 'NON_CRITICAL');
        if (nonCriticalIdx !== -1) {
          this.items.splice(nonCriticalIdx, 1);
          this.backpressureController.recordItemEvicted(1);
        } else {
          // If queue is 100% full of CRITICAL events, expand or append safely
        }
      } else {
        // Drop new NON_CRITICAL item when capacity is full
        this.backpressureController.recordItemEvicted(1);
        return false;
      }
    }

    this.items.push(sanitizedItem);
    this.backpressureController.recordItemAdded(sanitizedItem.priority, estBytes);
    return true;
  }

  public enqueueEventEnvelope(envelope: EventEnvelope): boolean {
    if (!envelope) return false;

    // Determine priority: Security, state changes, policy decisions, audit evidence are CRITICAL!
    const isCritical =
      envelope.schema_id.startsWith('nexusos.events.security') ||
      envelope.schema_id.startsWith('nexusos.events.agent.state') ||
      envelope.schema_id.startsWith('nexusos.events.policy') ||
      envelope.schema_id.startsWith('nexusos.events.config') ||
      envelope.schema_id.startsWith('nexusos.events.recovery');

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
    return this.items.splice(0, count);
  }

  public getSpoolMetrics(): SpoolMetrics {
    return this.backpressureController.getMetrics();
  }

  public clearSpool(): void {
    this.items.length = 0;
    this.backpressureController.resetSpoolUsage();
  }
}
