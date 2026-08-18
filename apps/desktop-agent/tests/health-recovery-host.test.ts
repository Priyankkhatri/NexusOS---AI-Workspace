import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HealthMonitor } from '../src/health/health-monitor.js';
import { ReadinessGate } from '../src/health/readiness-gate.js';
import { RecoveryManifestStore } from '../src/health/recovery-manifest-store.js';
import { ProcessReconciliationEngine } from '../src/health/process-reconciliation-engine.js';
import { CrashRecoveryManager } from '../src/health/crash-recovery-manager.js';
import type { StepCheckpoint } from '../src/health/types.js';

describe('Task 03X — Health Monitor Unit Tests', () => {
  it('generates health report with valid resource usage metrics', () => {
    const monitor = new HealthMonitor('agent-unit-01', '1.0.0');
    const report = monitor.getHealthReport();

    assert.equal(report.state, 'HEALTHY');
    assert.equal(report.agentId, 'agent-unit-01');
    assert.ok(report.resourceUsage.memoryTotalBytes > 0);
    assert.ok(report.resourceUsage.cpuUsagePercent >= 0);
  });

  it('evaluates liveness check based on heap memory ceiling', () => {
    const monitor = new HealthMonitor();
    assert.equal(monitor.checkLiveness(), true);
  });
});

describe('Task 03X — ReadinessGate Unit Tests', () => {
  it('evaluates default healthy readiness gate providers', () => {
    const gate = new ReadinessGate();
    const result = gate.evaluateReadiness();

    assert.equal(result.ready, true);
    assert.equal(result.state, 'HEALTHY');
    assert.equal(result.reasons.length, 0);
  });

  it('fails closed when critical provider check fails', () => {
    const gate = new ReadinessGate();
    gate.setProviderStatus('state_store', false);

    const result = gate.evaluateReadiness();
    assert.equal(result.ready, false);
    assert.equal(result.state, 'FAILED');
    assert.ok(result.reasons[0].includes('state_store'));

    assert.throws(
      () => gate.assertReadyForLease(),
      (err: any) => err.code === 'READINESS_CHECK_FAILED',
    );
  });

  it('enforces policy freshness age ceiling (<300s)', () => {
    const gate = new ReadinessGate();
    let policyAgeSec = 100;
    gate.bindPolicyFreshnessCheck(() => policyAgeSec);

    assert.equal(gate.evaluateReadiness().ready, true);

    policyAgeSec = 400; // Exceeds 300s threshold
    const staleResult = gate.evaluateReadiness();
    assert.equal(staleResult.ready, false);
    assert.equal(staleResult.state, 'FAILED');
  });
});

describe('Task 03X — RecoveryManifestStore Unit Tests', () => {
  it('creates and verifies cryptographic HMAC SHA-256 manifest hash integrity', () => {
    const store = new RecoveryManifestStore('test-secret-key-123');
    const checkpoint: StepCheckpoint = {
      stepId: 'step-01',
      taskId: 'task-01',
      runnerType: 'TERMINAL',
      isIdempotent: true,
      isAmbiguous: false,
      status: 'PAUSED',
      ownershipToken: 'proc-owner-101',
    };

    const manifest = store.createManifest('agent-01', [checkpoint], 0);

    assert.ok(manifest.manifestId);
    assert.ok(manifest.manifestHash);
    assert.equal(store.verifyManifestIntegrity(manifest), true);

    // Tamper with checkpoint step ID
    const tampered = JSON.parse(JSON.stringify(manifest));
    tampered.activeStepCheckpoints[0].stepId = 'step-tampered';
    assert.equal(store.verifyManifestIntegrity(tampered), false);
  });
});

describe('Task 03X — ProcessReconciliationEngine Unit Tests', () => {
  it('reconciles orphaned process trees using ownership tokens', async () => {
    let killedToken = '';
    const mockSupervisor = {
      killProcess: (token: string) => {
        killedToken = token;
        return true;
      },
    } as any;

    const engine = new ProcessReconciliationEngine(mockSupervisor);
    const checkpoint: StepCheckpoint = {
      stepId: 'step-term-01',
      taskId: 'task-term-01',
      runnerType: 'TERMINAL',
      isIdempotent: true,
      isAmbiguous: false,
      status: 'IN_PROGRESS',
      ownershipToken: 'token-orphan-999',
    };

    const store = new RecoveryManifestStore();
    const manifest = store.createManifest('agent-01', [checkpoint]);

    const res = await engine.reconcileOrphanedProcesses(manifest);
    assert.equal(res.reconciledCount, 1);
    assert.equal(res.orphanedTerminalProcesses, 1);
    assert.equal(killedToken, 'token-orphan-999');
  });
});

describe('Task 03X — CrashRecoveryManager Unit Tests', () => {
  it('blocks automatic resume if step is marked ambiguous (BLOCKED_AMBIGUOUS)', async () => {
    const store = new RecoveryManifestStore();
    const manager = new CrashRecoveryManager('agent-01', store);

    const checkpoint: StepCheckpoint = {
      stepId: 'step-ambiguous-01',
      taskId: 'task-ambiguous-01',
      runnerType: 'TERMINAL',
      isIdempotent: false,
      isAmbiguous: true,
      status: 'IN_PROGRESS',
      ownershipToken: 'token-ambiguous',
    };

    manager.recordStepCheckpoint(checkpoint);

    const { result } = await manager.executeStartupRecovery();
    assert.equal(result.action, 'BLOCKED_AMBIGUOUS');
    assert.equal(result.blockedStepsCount, 1);
    assert.equal(result.resumedStepsCount, 0);
  });
});
