import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CrashRecoveryManager,
  ProcessReconciliationEngine,
  RecoveryManifestStore,
  StepCheckpoint,
} from '../src/health/index.js';

describe('Task 03H Crash Recovery & Process Reconciliation Engine', () => {
  let manifestStore: RecoveryManifestStore;
  let reconciliationEngine: ProcessReconciliationEngine;
  let recoveryManager: CrashRecoveryManager;

  beforeEach(() => {
    manifestStore = new RecoveryManifestStore();
    reconciliationEngine = new ProcessReconciliationEngine();
    recoveryManager = new CrashRecoveryManager(
      '00000000-0000-4000-8000-000000000000',
      manifestStore,
      reconciliationEngine,
    );
  });

  it('generates, validates, and verifies cryptographic integrity of recovery manifests', () => {
    const checkpoints: StepCheckpoint[] = [
      {
        stepId: 'step_1',
        taskId: 'task_1',
        runnerType: 'TERMINAL',
        isIdempotent: true,
        isAmbiguous: false,
        status: 'PAUSED',
        ownershipToken: 'term_owner_123',
      },
    ];

    const manifest = manifestStore.createManifest(
      '00000000-0000-4000-8000-000000000000',
      checkpoints,
    );

    assert.ok(manifest.manifestHash);
    assert.equal(manifestStore.verifyManifestIntegrity(manifest), true);

    // Save and reload manifest
    manifestStore.saveManifest(manifest);
    const loaded = manifestStore.loadManifest();
    assert.ok(loaded);
    assert.equal(loaded?.manifestId, manifest.manifestId);
  });

  it('rejects tampered recovery manifest failing cryptographic hash verification', () => {
    const checkpoints: StepCheckpoint[] = [
      {
        stepId: 'step_1',
        taskId: 'task_1',
        runnerType: 'TERMINAL',
        isIdempotent: true,
        isAmbiguous: false,
        status: 'PAUSED',
        ownershipToken: 'term_owner_123',
      },
    ];

    const manifest = manifestStore.createManifest(
      '00000000-0000-4000-8000-000000000000',
      checkpoints,
    );

    // Tamper with checkpoint stepId
    manifest.activeStepCheckpoints[0].stepId = 'step_hacked_tampered';

    assert.equal(manifestStore.verifyManifestIntegrity(manifest), false);
    assert.throws(
      () => manifestStore.saveManifest(manifest),
      /Recovery manifest failed cryptographic hash verification/,
    );
  });

  it('reconciles orphaned Terminal, Browser, and Plugin child processes', async () => {
    const manifest = manifestStore.createManifest('00000000-0000-4000-8000-000000000000', [
      {
        stepId: 'step_term',
        taskId: 'task_1',
        runnerType: 'TERMINAL',
        isIdempotent: true,
        isAmbiguous: false,
        status: 'PAUSED',
        ownershipToken: 'term_proc_999',
      },
      {
        stepId: 'step_browser',
        taskId: 'task_1',
        runnerType: 'BROWSER',
        isIdempotent: true,
        isAmbiguous: false,
        status: 'PAUSED',
        ownershipToken: 'browser_sess_888',
      },
      {
        stepId: 'step_plugin',
        taskId: 'task_1',
        runnerType: 'PLUGIN',
        isIdempotent: true,
        isAmbiguous: false,
        status: 'PAUSED',
        ownershipToken: 'plugin_host_777',
      },
    ]);

    const res = await reconciliationEngine.reconcileOrphanedProcesses(manifest);
    assert.equal(res.reconciledCount, 3);
    assert.equal(res.orphanedTerminalProcesses, 1);
    assert.equal(res.terminatedBrowserSessions, 1);
    assert.equal(res.quarantinedPlugins, 1);
  });

  it('BLOCKS automatic resumption of non-idempotent or ambiguous step checkpoints', async () => {
    // Record checkpoint with isAmbiguous = true, isIdempotent = false
    recoveryManager.recordStepCheckpoint({
      stepId: 'step_delete_db',
      taskId: 'task_2',
      runnerType: 'TERMINAL',
      isIdempotent: false,
      isAmbiguous: true,
      status: 'PAUSED',
      ownershipToken: 'term_proc_555',
    });

    const recovery = await recoveryManager.executeStartupRecovery();

    assert.equal(recovery.result.success, true);
    assert.equal(recovery.result.action, 'BLOCKED_AMBIGUOUS');
    assert.equal(recovery.result.blockedStepsCount, 1);
    assert.equal(recovery.result.resumedStepsCount, 0);
    assert.equal(recovery.event.schema_id, 'nexusos.events.recovery.manifest_processed.v1');
    assert.equal(recovery.event.payload.status, 'SUCCESS');
  });

  it('allows safe automatic resumption of idempotent, non-ambiguous paused step checkpoints', async () => {
    recoveryManager.recordStepCheckpoint({
      stepId: 'step_read_log',
      taskId: 'task_3',
      runnerType: 'FILESYSTEM',
      isIdempotent: true,
      isAmbiguous: false,
      status: 'PAUSED',
      ownershipToken: 'fs_token_111',
    });

    const recovery = await recoveryManager.executeStartupRecovery();

    assert.equal(recovery.result.success, true);
    assert.equal(recovery.result.action, 'RESUMED');
    assert.equal(recovery.result.resumedStepsCount, 1);
    assert.equal(recovery.result.blockedStepsCount, 0);
  });
});
