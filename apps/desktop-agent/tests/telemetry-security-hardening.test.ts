import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ReadinessGate } from '../src/health/readiness-gate.js';
import {
  BackpressureController,
  RedactionFilter,
  StructuredLogger,
  TelemetrySpool,
} from '../src/telemetry/index.js';

describe('Task 03I Telemetry Security Hardening & Zero-Loss Correctness', () => {
  const testStorageDir = path.join(process.cwd(), '.test-telemetry-spool-dir');

  it('FINDING-I01: fails closed and blocks new execution leases when CRITICAL spool is saturated without dropping events', () => {
    const controller = new BackpressureController(1000, 500);
    const spool = new TelemetrySpool(controller, new RedactionFilter(), 5, testStorageDir); // soft max 5, hard max 10
    const readinessGate = new ReadinessGate();
    readinessGate.bindTelemetrySpool(spool);

    // Enqueue 10 CRITICAL items to saturate hard capacity
    for (let i = 1; i <= 10; i++) {
      spool.enqueueItem({
        itemId: `00000000-0000-4000-8000-00000000000${i % 9}`,
        timestamp: new Date().toISOString(),
        type: 'EVENT',
        name: `critical_event_${i}`,
        attributes: {},
        priority: 'CRITICAL',
      });
    }

    // 11th CRITICAL item cannot be enqueued because hard spool capacity is full
    const enqueued11 = spool.enqueueItem({
      itemId: '00000000-0000-4000-8000-000000000099',
      timestamp: new Date().toISOString(),
      type: 'EVENT',
      name: 'critical_event_11',
      attributes: {},
      priority: 'CRITICAL',
    });

    assert.equal(enqueued11, false);
    assert.equal(spool.getSpoolMetrics().isCriticalSpoolFull, true);

    // VERIFY FAIL-CLOSED READINESS GATE: Readiness check fails and assertReadyForLease throws!
    const readiness = readinessGate.evaluateReadiness();
    assert.equal(readiness.ready, false);
    assert.equal(readiness.state, 'FAILED');
    assert.ok(readiness.reasons.some((r) => r.includes("'telemetry_spool' failed health check")));

    assert.throws(
      () => readinessGate.assertReadyForLease(),
      (err: unknown) => (err as { code?: string }).code === 'READINESS_CHECK_FAILED',
    );

    // Popping batch clears spool saturation and unblocks readiness gate!
    spool.popBatch(10);
    assert.equal(spool.getSpoolMetrics().isCriticalSpoolFull, false);
    assert.equal(readinessGate.evaluateReadiness().ready, true);

    // Clean up
    spool.clearSpool();
  });

  it('FINDING-I02: persists spooled CRITICAL items to local file storage across process restarts', () => {
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }

    const spool1 = new TelemetrySpool(
      new BackpressureController(),
      new RedactionFilter(),
      10,
      testStorageDir,
    );
    spool1.enqueueItem({
      itemId: '00000000-0000-4000-8000-000000000099',
      timestamp: new Date().toISOString(),
      type: 'EVENT',
      name: 'nexusos.events.security.alert.v1',
      attributes: { detail: 'survives_restart' },
      priority: 'CRITICAL',
    });

    // Instantiate new spool reading from same storage directory
    const spool2 = new TelemetrySpool(
      new BackpressureController(),
      new RedactionFilter(),
      10,
      testStorageDir,
    );
    const batch = spool2.popBatch(10);

    assert.ok(batch.length >= 1);
    assert.equal(batch[0].name, 'nexusos.events.security.alert.v1');
    assert.equal(batch[0].attributes.detail, 'survives_restart');

    // Clean up
    spool2.clearSpool();
  });

  it('FINDING-I03: handles corrupted spool storage files safely on startup', () => {
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    const spoolFile = path.join(testStorageDir, '.nexusos-telemetry-spool.json');
    fs.writeFileSync(spoolFile, 'CORRUPTED_NON_JSON_DATA{{{', 'utf-8');

    assert.doesNotThrow(() => {
      const spool3 = new TelemetrySpool(
        new BackpressureController(),
        new RedactionFilter(),
        10,
        testStorageDir,
      );
      assert.equal(spool3.popBatch(10).length, 0);
    });
  });

  it('sanitizes multi-line log string injections and control characters', async () => {
    const emitted: string[] = [];
    const logger = new StructuredLogger(
      'TestComponent',
      new RedactionFilter(),
      new BackpressureController(),
      (msg) => emitted.push(msg),
    );

    logger.info('Line 1\r\nLine 2\x00Injection');
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(emitted.length, 1);
    const parsed = JSON.parse(emitted[0]);
    assert.equal(parsed.message.includes('\n'), false);
    assert.equal(parsed.message.includes('\r'), false);
    assert.equal(parsed.message.includes('\x00'), false);
  });
});
