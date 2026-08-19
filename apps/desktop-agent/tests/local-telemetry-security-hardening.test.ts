import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TelemetryManager } from '../src/telemetry/telemetry-manager.js';
import { TelemetrySpool } from '../src/telemetry/telemetry-spool.js';
import { BackpressureController } from '../src/telemetry/backpressure-controller.js';
import { StructuredLogger } from '../src/telemetry/structured-logger.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { TelemetryTrackMetricRequestSchema } from '../src/telemetry/schemas.js';

describe('Task 03Z — Adversarial Security Regression Suite (03Z-SEC-01 to 03Z-SEC-12)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-telemetry-sec-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('03Z-SEC-01: Log injection attack sanitization', async () => {
    let output = '';
    const logger = new StructuredLogger(
      'SecComp',
      new RedactionFilter(),
      new BackpressureController(),
      (msg) => {
        output = msg;
      },
    );

    const malformedMessage = 'User login\n\r"extra_injected_json": true,\n"admin": true';
    logger.info(malformedMessage);
    await new Promise((r) => setImmediate(r));

    assert.ok(output.length > 0);
    const parsed = JSON.parse(output);
    assert.equal(typeof parsed, 'object');
    // Ensure newlines/quotes did not break JSON boundary structure
    assert.equal(parsed.component, 'SecComp');
  });

  it('03Z-SEC-02: Secret leakage in telemetry and stack traces', async () => {
    let output = '';
    const logger = new StructuredLogger(
      'SecComp',
      new RedactionFilter(),
      new BackpressureController(),
      (msg) => {
        output = msg;
      },
    );

    const err = new Error('Connection failed with api_key: secret_key_123456');
    logger.error('Error occurred', err, { password: 'myPassword99', token: 'Bearer xyz' });
    await new Promise((r) => setImmediate(r));

    const parsed = JSON.parse(output);
    assert.ok(!JSON.stringify(parsed).includes('secret_key_123456'));
    assert.ok(!JSON.stringify(parsed).includes('myPassword99'));
  });

  it('03Z-SEC-03: Unbounded queue memory exhaustion attack', () => {
    const controller = new BackpressureController();
    const spool = new TelemetrySpool(controller, new RedactionFilter(), 10, tmpDir);

    // Enqueue 100 non-critical items
    for (let i = 0; i < 100; i++) {
      spool.enqueueItem({
        itemId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        timestamp: new Date().toISOString(),
        type: 'METRIC',
        name: `metric_${i}`,
        attributes: { payload: 'X'.repeat(500) },
        priority: 'NON_CRITICAL',
      });
    }

    const metrics = spool.getSpoolMetrics();
    // Capacity must be bounded to soft limit
    assert.ok(metrics.totalItemsSpooled <= 10);
  });

  it('03Z-SEC-04: CRITICAL security event eviction preservation under backpressure', () => {
    const controller = new BackpressureController();
    const spool = new TelemetrySpool(controller, new RedactionFilter(), 2, tmpDir);

    // Enqueue non-critical items to fill queue
    spool.enqueueItem({
      itemId: '00000000-0000-4000-8000-000000000001',
      timestamp: new Date().toISOString(),
      type: 'METRIC',
      name: 'debug_metric_1',
      attributes: {},
      priority: 'NON_CRITICAL',
    });
    spool.enqueueItem({
      itemId: '00000000-0000-4000-8000-000000000002',
      timestamp: new Date().toISOString(),
      type: 'METRIC',
      name: 'debug_metric_2',
      attributes: {},
      priority: 'NON_CRITICAL',
    });

    // Enqueue CRITICAL security event
    const added = spool.enqueueEventEnvelope({
      schema_id: 'nexusos.events.security.alert.v1',
      version: '1.0.0',
      event_id: '00000000-0000-4000-8000-000000000099',
      correlation_id: 'corr-1',
      occurred_at: new Date().toISOString(),
      producer_id: 'prod-1',
      payload: { alert: 'unauthorized_execution' },
    });

    assert.equal(added, true);
    const popped = spool.popBatch(10);
    assert.ok(popped.some((item) => item.name === 'nexusos.events.security.alert.v1'));
  });

  it('03Z-SEC-05: Telemetry batch forgery and HMAC tampering rejection', async () => {
    const tm = new TelemetryManager('sec-agent-1');
    tm.trackMetric('latency', 12);
    const batch = await tm.flush();

    assert.ok(batch !== null);
    assert.equal(tm.verifyBatchIntegrity(batch), true);

    // Tamper hash digest
    batch.batchHash = 'deadbeef'.repeat(8);
    assert.equal(tm.verifyBatchIntegrity(batch), false);
  });

  it('03Z-SEC-06: Diagnostic path traversal attempt rejection', async () => {
    const tm = new TelemetryManager('sec-agent-1');
    const forbiddenPath =
      process.platform === 'win32' ? 'C:\\Windows\\System32\\ForbiddenDir' : '/etc/forbidden_dir';

    await assert.rejects(async () => {
      await tm.exportDiagnosticBundle(forbiddenPath);
    }, /SECURITY_ERROR/);
  });

  it('03Z-SEC-07: TelemetryTrackMetricRequestSchema oversized payload rejection', () => {
    const oversizedName = 'A'.repeat(500); // Max is 256
    assert.throws(() => {
      TelemetryTrackMetricRequestSchema.parse({
        name: oversizedName,
        value: 100,
      });
    });
  });

  it('03Z-SEC-08: Cross-tenant telemetry data isolation', () => {
    const tm1 = new TelemetryManager('tenant-1-agent');
    const tm2 = new TelemetryManager('tenant-2-agent');

    tm1.trackMetric('cpu', 10);
    tm2.trackMetric('cpu', 20);

    const metrics1 = tm1.getHealthMetrics();
    const metrics2 = tm2.getHealthMetrics();

    assert.equal(metrics1.totalItemsSpooled, 1);
    assert.equal(metrics2.totalItemsSpooled, 1);
  });

  it('03Z-SEC-09: Corrupted spool file recovery on disk', () => {
    const spoolFile = path.join(tmpDir, '.nexusos-telemetry-spool.json');
    fs.writeFileSync(spoolFile, 'NOT_VALID_JSON{{{', 'utf-8');

    const controller = new BackpressureController();
    const spool = new TelemetrySpool(controller, new RedactionFilter(), 10, tmpDir);

    // Must not crash
    assert.equal(spool.getSpoolMetrics().totalItemsSpooled, 0);
  });

  it('03Z-SEC-10: Shutdown flush guarantees remaining spool persistence', async () => {
    const tm = new TelemetryManager(
      'sec-agent-1',
      undefined,
      undefined,
      new TelemetrySpool(new BackpressureController(), new RedactionFilter(), 10, tmpDir),
    );
    tm.trackMetric('shutdown_metric', 42);

    const batch = await tm.flush();
    assert.ok(batch !== null);
    assert.equal(batch.items[0]?.name, 'shutdown_metric');
  });

  it('03Z-SEC-11: Dynamic backpressure log sampling rules', () => {
    const controller = new BackpressureController(1000, 500);
    controller.recordItemAdded('NON_CRITICAL', 600); // Exceed warning threshold (500)

    assert.equal(controller.isBackpressureActive(), true);
    // Critical logs always sample
    assert.equal(controller.shouldSampleLog('fatal', 'CRITICAL'), true);
    assert.equal(controller.shouldSampleLog('error', 'CRITICAL'), true);
  });

  it('03Z-SEC-12: Schema ID spoofing to bypass backpressure rules', () => {
    const controller = new BackpressureController();
    // Spoofed schema ID without authorized nexusos.events namespace
    assert.equal(controller.isCriticalSchemaId('malicious.fake.nexusos.events.security'), false);
    assert.equal(controller.isCriticalSchemaId('nexusos.events.security.alert.v1'), true);
  });
});
