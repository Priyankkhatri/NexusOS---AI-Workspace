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

describe('Task 03Z — Telemetry Host Unit Tests', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-telemetry-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('StructuredLogger & RedactionFilter', () => {
    it('formats log records and redacts bearer tokens and passwords', async () => {
      let loggedOutput = '';
      const logger = new StructuredLogger(
        'TestComponent',
        new RedactionFilter(),
        new BackpressureController(),
        (msg) => {
          loggedOutput = msg;
        },
      );

      logger.info('User login successful', { token: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret' });
      await new Promise((r) => setImmediate(r));
      assert.ok(loggedOutput.length > 0);

      const parsed = JSON.parse(loggedOutput);
      assert.equal(parsed.component, 'TestComponent');
      assert.equal(parsed.level, 'info');
      assert.equal(parsed.message, 'User login successful');
      assert.equal(parsed.details.token, '[REDACTED_SENSITIVE_KEY]');
    });

    it('attaches correlation context (correlationId, taskId, stepId)', async () => {
      let loggedOutput = '';
      const logger = new StructuredLogger(
        'TestComponent',
        new RedactionFilter(),
        new BackpressureController(),
        (msg) => {
          loggedOutput = msg;
        },
      );

      logger.setCorrelationContext('cid-123', 'task-456', 'step-789');
      logger.warn('Warning event');
      await new Promise((r) => setImmediate(r));

      const parsed = JSON.parse(loggedOutput);
      assert.equal(parsed.correlationId, 'cid-123');
      assert.equal(parsed.taskId, 'task-456');
      assert.equal(parsed.stepId, 'step-789');
    });

    it('redacts error message and stack trace in logger.error', async () => {
      let loggedOutput = '';
      const logger = new StructuredLogger(
        'TestComponent',
        new RedactionFilter(),
        new BackpressureController(),
        (msg) => {
          loggedOutput = msg;
        },
      );

      const err = new Error('Database password: superSecret123 failed');
      logger.error('Database connection error', err);
      await new Promise((r) => setImmediate(r));

      const parsed = JSON.parse(loggedOutput);
      assert.equal(parsed.level, 'error');
      assert.equal(parsed.priority, 'CRITICAL');
      assert.ok(!parsed.details.errorMessage.includes('superSecret123'));
    });
  });

  describe('BackpressureController', () => {
    it('activates backpressure when warning threshold is reached', () => {
      const controller = new BackpressureController(1000, 800);
      assert.equal(controller.isBackpressureActive(), false);

      controller.recordItemAdded('NON_CRITICAL', 900);
      assert.equal(controller.isBackpressureActive(), true);
    });

    it('never samples or drops CRITICAL events or fatal/error logs', () => {
      const controller = new BackpressureController(1000, 100);
      controller.recordItemAdded('NON_CRITICAL', 500); // Trigger backpressure

      assert.equal(controller.shouldSampleLog('fatal', 'CRITICAL'), true);
      assert.equal(controller.shouldSampleLog('error', 'CRITICAL'), true);
      assert.equal(controller.shouldSampleLog('info', 'CRITICAL'), true);
    });

    it('identifies critical schema IDs correctly', () => {
      const controller = new BackpressureController();
      assert.equal(controller.isCriticalSchemaId('nexusos.events.security.alert.v1'), true);
      assert.equal(controller.isCriticalSchemaId('nexusos.events.agent.state.changed.v1'), true);
      assert.equal(controller.isCriticalSchemaId('nexusos.events.policy.evaluation.v1'), true);
      assert.equal(controller.isCriticalSchemaId('nexusos.events.config.changed.v1'), true);
      assert.equal(controller.isCriticalSchemaId('nexusos.events.recovery.manifest.v1'), true);
      assert.equal(controller.isCriticalSchemaId('custom.user.event'), false);
    });
  });

  describe('TelemetrySpool', () => {
    it('enqueues items and pops batch correctly', () => {
      const controller = new BackpressureController();
      const spool = new TelemetrySpool(controller, new RedactionFilter(), 10, tmpDir);

      const added = spool.enqueueItem({
        itemId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        timestamp: new Date().toISOString(),
        type: 'METRIC',
        name: 'cpu_usage',
        value: 42,
        attributes: { host: 'node-1' },
        priority: 'NON_CRITICAL',
      });

      assert.equal(added, true);

      const batch = spool.popBatch(10);
      assert.equal(batch.length, 1);
      assert.equal(batch[0]?.name, 'cpu_usage');
      assert.equal(batch[0]?.value, 42);
    });

    it('evicts NON_CRITICAL items when soft queue limit is reached to preserve CRITICAL items', () => {
      const controller = new BackpressureController();
      const spool = new TelemetrySpool(controller, new RedactionFilter(), 3, tmpDir);

      // Fill spool with 3 non-critical items
      for (let i = 0; i < 3; i++) {
        spool.enqueueItem({
          itemId: `00000000-0000-4000-8000-00000000000${i}`,
          timestamp: new Date().toISOString(),
          type: 'METRIC',
          name: `metric_${i}`,
          attributes: {},
          priority: 'NON_CRITICAL',
        });
      }

      // Enqueue 1 CRITICAL item
      const addedCritical = spool.enqueueItem({
        itemId: '00000000-0000-4000-8000-000000000099',
        timestamp: new Date().toISOString(),
        type: 'EVENT',
        name: 'nexusos.events.security.alert.v1',
        attributes: { alert: 'unauthorized_access' },
        priority: 'CRITICAL',
      });

      assert.equal(addedCritical, true);

      const items = spool.popBatch(10);
      assert.ok(items.some((item) => item.priority === 'CRITICAL'));
    });

    it('isolates corrupted spool file on disk during loadSpoolFromStorage', () => {
      const spoolPath = path.join(tmpDir, '.nexusos-telemetry-spool.json');
      fs.writeFileSync(spoolPath, 'CORRUPTED_JSON_DATA{{{', 'utf-8');

      const controller = new BackpressureController();
      const spool = new TelemetrySpool(controller, new RedactionFilter(), 10, tmpDir);

      // Verify corrupt spool was isolated and didn't crash
      const metrics = spool.getSpoolMetrics();
      assert.equal(metrics.totalItemsSpooled, 0);
      assert.equal(fs.existsSync(spoolPath), false);
    });
  });

  describe('TelemetryManager & HMAC Batch Integrity', () => {
    it('flushes spooled items into signed TelemetryBatch and verifies HMAC integrity', async () => {
      const tm = new TelemetryManager('agent-test-id');
      tm.trackMetric('memory_usage', 512, { unit: 'MB' });
      tm.trackTrace('task_execution', { task: 'task-100' });

      const batch = await tm.flush();
      assert.ok(batch !== null);
      assert.equal(batch.agentId, 'agent-test-id');
      assert.equal(batch.items.length, 2);
      assert.ok(batch.batchHash.length > 0);

      // Verify valid batch integrity
      const isValid = tm.verifyBatchIntegrity(batch);
      assert.equal(isValid, true);
    });

    it('rejects tampered TelemetryBatch in verifyBatchIntegrity', async () => {
      const tm = new TelemetryManager('agent-test-id');
      tm.trackMetric('memory_usage', 512);

      const batch = await tm.flush();
      assert.ok(batch !== null);

      // Tamper batch items
      batch.items[0]!.value = 999999;

      const isValid = tm.verifyBatchIntegrity(batch);
      assert.equal(isValid, false);
    });

    it('exports diagnostic bundle with valid HMAC hash', async () => {
      const tm = new TelemetryManager('agent-test-id');
      tm.trackMetric('disk_headroom', 80);

      const bundle = await tm.exportDiagnosticBundle(tmpDir);
      assert.ok(bundle.bundleId.length > 0);
      assert.equal(bundle.agentId, 'agent-test-id');
      assert.ok(bundle.hash.length > 0);

      const bundleFiles = fs.readdirSync(tmpDir).filter((f) => f.startsWith('diagnostic-bundle-'));
      assert.equal(bundleFiles.length, 1);
    });
  });
});
