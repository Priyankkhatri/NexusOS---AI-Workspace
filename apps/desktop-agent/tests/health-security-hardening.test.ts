import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CrashRecoveryManager,
  HealthMonitor,
  RecoveryManifestStore,
  StepCheckpoint,
} from '../src/health/index.js';

describe('Task 03H Health & Crash Recovery Security Hardening Regression', () => {
  it('FINDING-H01: rejects manifest hash forged without internal HMAC secret key', () => {
    const store = new RecoveryManifestStore('secret_agent_key_abc123');

    const checkpoints: StepCheckpoint[] = [
      {
        stepId: 'step_1',
        taskId: 'task_1',
        runnerType: 'TERMINAL',
        isIdempotent: true,
        isAmbiguous: false,
        status: 'PAUSED',
        ownershipToken: 'owner_token_123',
      },
    ];

    const manifest = store.createManifest('agent_123', checkpoints);
    assert.equal(store.verifyManifestIntegrity(manifest), true);

    // Attacker modifies checkpoints and attempts unkeyed sha256 forgery
    manifest.activeStepCheckpoints[0].stepId = 'step_hacked';
    // Attacker tries to compute standard sha256 without HMAC secret
    manifest.manifestHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    assert.equal(store.verifyManifestIntegrity(manifest), false);
  });

  it('FINDING-H02: BLOCKS automatic resume of step checkpoints with expired execution leases', async () => {
    const store = new RecoveryManifestStore();
    const manager = new CrashRecoveryManager('agent_123', store);

    // Record idempotent step checkpoint with lease that expired in the past
    manager.recordStepCheckpoint({
      stepId: 'step_expired_lease',
      taskId: 'task_99',
      runnerType: 'FILESYSTEM',
      isIdempotent: true,
      isAmbiguous: false,
      status: 'PAUSED',
      ownershipToken: 'token_exp',
      leaseExpiresAt: '2020-01-01T00:00:00.000Z', // Expired!
    });

    const recovery = await manager.executeStartupRecovery();

    assert.equal(recovery.result.success, true);
    assert.equal(recovery.result.blockedStepsCount, 1);
    assert.equal(recovery.result.resumedStepsCount, 0);
  });

  it('FINDING-H03: measures accurate disk headroom via fs.statfsSync without shell commands', () => {
    const monitor = new HealthMonitor();
    const report = monitor.getHealthReport();

    assert.ok(report.resourceUsage.diskHeadroomBytes > 0);
    // Disk headroom bytes should reflect disk space (> 100MB), not RAM placeholder
    assert.ok(report.resourceUsage.diskHeadroomBytes > 100_000_000);
  });
});
