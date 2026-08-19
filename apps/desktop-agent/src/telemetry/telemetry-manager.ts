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

  public verifyBatchIntegrity(batch: TelemetryBatch): boolean {
    if (!batch || !batch.batchId || !batch.batchHash || !Array.isArray(batch.items)) {
      return false;
    }
    try {
      const canonicalString = `${batch.batchId}:${batch.agentId}:${batch.createdAt}:${JSON.stringify(batch.items)}`;
      const expectedHash = crypto
        .createHmac('sha256', this.hmacSecretKey)
        .update(canonicalString)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedHash, 'hex');
      const actualBuf = Buffer.from(batch.batchHash, 'hex');

      if (expectedBuf.length !== actualBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  public getHealthMetrics(): SpoolMetrics {
    return this.spool.getSpoolMetrics();
  }

  public async exportDiagnosticBundle(
    targetDir?: string,
  ): Promise<import('./types.js').DiagnosticBundle> {
    const metrics = this.getHealthMetrics();
    const bundleId = crypto.randomUUID();
    const generatedAt = new Date().toISOString();
    const hash = crypto
      .createHmac('sha256', this.hmacSecretKey)
      .update(`${bundleId}:${this.agentId}:${generatedAt}:${JSON.stringify(metrics)}`)
      .digest('hex');

    const bundle: import('./types.js').DiagnosticBundle = {
      bundleId,
      generatedAt,
      agentId: this.agentId,
      metrics,
      spoolItemCount: metrics.totalItemsSpooled,
      hash,
    };

    if (targetDir) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const { PathSecurityService } = await import('../runtimes/filesystem/path-security.js');
      const pathService = new PathSecurityService();

      const normalizedDir = pathService.normalizePath(targetDir);
      const filePath = path.join(normalizedDir, `diagnostic-bundle-${bundleId}.json`);

      // Enforce path confinement within process working directory or temporary directory
      const allowedRoots = [process.cwd(), os.tmpdir()];
      const validation = pathService.validatePath(filePath, allowedRoots);
      if (!validation.valid) {
        throw new Error(
          `[SECURITY_ERROR] Path security validation failed for diagnostic export: ${validation.error?.message || 'Path outside allowed scope'}`,
        );
      }

      if (!fs.existsSync(normalizedDir)) {
        fs.mkdirSync(normalizedDir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf-8');
    }

    return bundle;
  }
}
