import crypto from 'node:crypto';
import { EventEnvelope } from '@nexusos/contracts';
import { BackpressureController } from './backpressure-controller.js';
import { RedactionFilter } from './redaction-filter.js';
import { StructuredLogger } from './structured-logger.js';
import { TelemetrySpool } from './telemetry-spool.js';
import {
  IStructuredLogger,
  ITelemetryManager,
  ITelemetrySpool,
  SpoolMetrics,
  TelemetryBatch,
  TelemetryItem,
} from './types.js';

export class TelemetryManager implements ITelemetryManager {
  public readonly logger: IStructuredLogger;
  public readonly spool: ITelemetrySpool;

  constructor(
    private readonly agentId: string = '00000000-0000-4000-8000-000000000000',
    private readonly backpressureController: BackpressureController = new BackpressureController(),
    private readonly redactionFilter: RedactionFilter = new RedactionFilter(),
    spool?: ITelemetrySpool,
    logger?: IStructuredLogger,
    private readonly hmacSecretKey: string = 'nexusos_internal_telemetry_signing_key_v1',
  ) {
    this.spool = spool || new TelemetrySpool(this.backpressureController, this.redactionFilter);
    this.logger =
      logger ||
      new StructuredLogger('DesktopAgent', this.redactionFilter, this.backpressureController);
  }

  public trackMetric(name: string, value: number, attributes: Record<string, unknown> = {}): void {
    const item: TelemetryItem = {
      itemId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'METRIC',
      name: this.redactionFilter.redactString(name),
      value,
      attributes: this.redactionFilter.redactObject(attributes),
      priority: 'NON_CRITICAL',
    };

    this.spool.enqueueItem(item);
  }

  public trackTrace(name: string, attributes: Record<string, unknown> = {}): void {
    const item: TelemetryItem = {
      itemId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'TRACE',
      name: this.redactionFilter.redactString(name),
      attributes: this.redactionFilter.redactObject(attributes),
      priority: 'NON_CRITICAL',
    };

    this.spool.enqueueItem(item);
  }

  public trackEventEnvelope(envelope: EventEnvelope): void {
    if (!envelope) return;
    this.spool.enqueueEventEnvelope(envelope);
  }

  public async flush(): Promise<TelemetryBatch | null> {
    const items = this.spool.popBatch(100);
    if (items.length === 0) return null;

    const batchId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const canonicalString = `${batchId}:${this.agentId}:${createdAt}:${JSON.stringify(items)}`;

    const batchHash = crypto
      .createHmac('sha256', this.hmacSecretKey)
      .update(canonicalString)
      .digest('hex');

    return {
      batchId,
      agentId: this.agentId,
      createdAt,
      items,
      batchHash,
    };
  }

  public getHealthMetrics(): SpoolMetrics {
    return this.spool.getSpoolMetrics();
  }

  public async exportDiagnosticBundle(
    _targetDir?: string,
  ): Promise<import('./types.js').DiagnosticBundle> {
    const metrics = this.getHealthMetrics();
    const bundleId = crypto.randomUUID();
    const generatedAt = new Date().toISOString();
    const hash = crypto
      .createHmac('sha256', this.hmacSecretKey)
      .update(`${bundleId}:${this.agentId}:${generatedAt}:${JSON.stringify(metrics)}`)
      .digest('hex');

    return {
      bundleId,
      generatedAt,
      agentId: this.agentId,
      metrics,
      spoolItemCount: metrics.totalItemsSpooled,
      hash,
    };
  }
}
