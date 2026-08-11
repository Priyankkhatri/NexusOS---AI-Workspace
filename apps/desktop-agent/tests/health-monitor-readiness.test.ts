import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HealthMonitor, ReadinessGate } from '../src/health/index.js';

describe('Task 03H Health Monitor & Readiness Gate', () => {
  let readinessGate: ReadinessGate;
  let healthMonitor: HealthMonitor;

  beforeEach(() => {
    readinessGate = new ReadinessGate();
    healthMonitor = new HealthMonitor(
      '00000000-0000-4000-8000-000000000000',
      '0.1.0-sprint0',
      readinessGate,
    );
  });

  it('evaluates liveness and reports true under bounded heap memory', () => {
    assert.equal(healthMonitor.checkLiveness(), true);
  });

  it('evaluates HEALTHY readiness posture when all critical dependencies pass', () => {
    const readiness = readinessGate.evaluateReadiness();
    assert.equal(readiness.ready, true);
    assert.equal(readiness.state, 'HEALTHY');
    assert.equal(readiness.reasons.length, 0);

    // assertReadyForLease should pass without throwing
    assert.doesNotThrow(() => {
      readinessGate.assertReadyForLease();
    });
  });

  it('evaluates FAILED readiness posture and blocks execution lease when critical dependency fails', () => {
    // Fail critical supervisor dependency
    readinessGate.setProviderStatus('process_supervisor', false);

    const readiness = readinessGate.evaluateReadiness();
    assert.equal(readiness.ready, false);
    assert.equal(readiness.state, 'FAILED');
    assert.ok(readiness.reasons.length > 0);

    // Fail-Closed: assertReadyForLease must throw structured READINESS_CHECK_FAILED error
    assert.throws(
      () => readinessGate.assertReadyForLease(),
      (err: unknown) =>
        typeof err === 'object' &&
        err !== null &&
        (err as { code: string }).code === 'READINESS_CHECK_FAILED',
    );
    const report = healthMonitor.getHealthReport();
    assert.equal(report.state, 'FAILED');
  });

  it('evaluates DEGRADED posture when non-critical dependency fails', () => {
    readinessGate.registerProvider({
      name: 'optional_telemetry_uploader',
      critical: false,
      check: () => false,
    });

    const readiness = readinessGate.evaluateReadiness();
    assert.equal(readiness.ready, true);
    assert.equal(readiness.state, 'DEGRADED');
    assert.equal(readiness.reasons.length, 1);
  });

  it('emits aggregate, privacy-safe health report without leaking raw paths or secrets', () => {
    const report = healthMonitor.getHealthReport();

    assert.ok(report.checkedAt);
    assert.ok(report.resourceUsage.memoryUsedBytes >= 0);
    assert.ok(report.resourceUsage.cpuUsagePercent >= 0);
    assert.equal(report.capabilityAvailability.filesystem, true);

    // Verify report object is clean JSON without secrets or paths
    const json = JSON.stringify(report);
    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('Bearer'), false);
    assert.equal(json.includes('C:\\Users'), false);
  });
});
