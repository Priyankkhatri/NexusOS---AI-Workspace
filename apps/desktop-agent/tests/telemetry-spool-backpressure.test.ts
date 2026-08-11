import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEventEnvelope } from '@nexusos/contracts';
import {
  BackpressureController,
  RedactionFilter,
  TelemetryManager,
  TelemetrySpool,
} from '../src/telemetry/index.js';

describe('Task 03I Telemetry Spool & Backpressure Controller', () => {
  let controller: BackpressureController;
  let spool: TelemetrySpool;
  let manager: TelemetryManager;

  beforeEach(() => {
    controller = new BackpressureController(1000, 500); // 1000 bytes max capacity, 500 bytes warning
    spool = new TelemetrySpool(controller, new RedactionFilter(), 5); // 5 items max queue
    manager = new TelemetryManager(
      '00000000-0000-4000-8000-000000000000',
      controller,
      new RedactionFilter(),
      spool,
    );
  });

  it('guarantees ZERO LOSS for CRITICAL priority events under spool capacity pressure', () => {
    // Fill queue with 5 NON_CRITICAL items
    for (let i = 1; i <= 5; i++) {
      spool.enqueueItem({
        itemId: `item_${i}`,
        timestamp: new Date().toISOString(),
        type: 'METRIC',
        name: `metric_${i}`,
        attributes: {},
        priority: 'NON_CRITICAL',
      });
    }

    // Now enqueue a CRITICAL security event when queue is at max capacity (5/5)
    const criticalEnvelope = createEventEnvelope(
      'nexusos.events.security.alert.v1',
      '1.0.0',
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
      { alertType: 'UNAUTHORIZED_ACCESS' },
    );

    const enqueued = spool.enqueueEventEnvelope(criticalEnvelope);
    assert.equal(enqueued, true);

    const metrics = spool.getSpoolMetrics();
    assert.ok(metrics.evictedItemsCount >= 1); // 1 NON_CRITICAL item was evicted to preserve CRITICAL event

    const batch = spool.popBatch(10);
    assert.ok(batch.some((i) => i.name === 'nexusos.events.security.alert.v1'));
  });

  it('samples high-volume debug logs when backpressure is active', () => {
    // Create controller with warning threshold 0 bytes to force active backpressure
    const activeBpController = new BackpressureController(100, 0);

    let debugSampled = 0;
    for (let i = 0; i < 100; i++) {
      if (activeBpController.shouldSampleLog('debug', 'NON_CRITICAL')) {
        debugSampled++;
      }
    }

    // High volume debug logs should be sampled down (~10%)
    assert.ok(debugSampled < 40);

    // CRITICAL logs must ALWAYS be sampled (100%)
    let criticalSampled = 0;
    for (let i = 0; i < 100; i++) {
      if (activeBpController.shouldSampleLog('error', 'CRITICAL')) {
        criticalSampled++;
      }
    }
    assert.equal(criticalSampled, 100);
  });

  it('batches and produces cryptographically HMAC-hashed telemetry payloads on flush()', async () => {
    manager.trackMetric('cpu_usage_percent', 45.5, { host: 'node_1' });
    manager.trackTrace('exec_command', { command: 'ls' });

    const batch = await manager.flush();
    assert.ok(batch);
    assert.equal(batch?.items.length, 2);
    assert.ok(batch?.batchHash);
    assert.equal(batch?.batchHash.length, 64); // SHA-256 HMAC hex string
  });

  it('exposes spool metrics directly to Health Monitor', () => {
    manager.trackMetric('mem_bytes', 1024);
    const healthMetrics = manager.getHealthMetrics();

    assert.ok(healthMetrics.totalItemsSpooled >= 1);
    assert.ok(healthMetrics.spoolCapacityBytes > 0);
  });
});
