import crypto from 'node:crypto';
import { EventEnvelope, createEventEnvelope } from '@nexusos/contracts';
import { ProcessReconciliationEngine } from './process-reconciliation-engine.js';
import { RecoveryManifestStore } from './recovery-manifest-store.js';
import {
  ICrashRecoveryManager,
  IProcessReconciliationEngine,
  IRecoveryManifestStore,
  RecoveryExecutionResult,
  RecoveryManifest,
  StepCheckpoint,
} from './types.js';

export class CrashRecoveryManager implements ICrashRecoveryManager {
  private readonly checkpoints: StepCheckpoint[] = [];

  constructor(
    private readonly agentId: string = '00000000-0000-4000-8000-000000000000',
    private readonly manifestStore: IRecoveryManifestStore = new RecoveryManifestStore(),
    private readonly reconciliationEngine: IProcessReconciliationEngine = new ProcessReconciliationEngine(),
  ) {}

  public recordStepCheckpoint(checkpoint: StepCheckpoint): void {
    if (!checkpoint) return;
    this.checkpoints.push(checkpoint);

    // Update stored manifest
    const manifest = this.manifestStore.createManifest(this.agentId, this.checkpoints);
    this.manifestStore.saveManifest(manifest);
  }

  public getRecoveryManifest(): RecoveryManifest | null {
    return this.manifestStore.loadManifest();
  }

  public async executeStartupRecovery(): Promise<{
    result: RecoveryExecutionResult;
    event: EventEnvelope;
  }> {
    const correlationId = crypto.randomUUID();

    // 1. Load Recovery Manifest
    const manifest = this.manifestStore.loadManifest();

    if (!manifest) {
      const result: RecoveryExecutionResult = {
        success: true,
        action: 'NO_MANIFEST',
        resumedStepsCount: 0,
        blockedStepsCount: 0,
      };

      const event = createEventEnvelope(
        'nexusos.events.recovery.manifest_processed.v1',
        '1.0.0',
        this.agentId,
        correlationId,
        {
          action: 'NO_MANIFEST',
          status: 'SUCCESS',
          resumedStepsCount: 0,
          blockedStepsCount: 0,
        },
      );

      return { result, event };
    }

    // 2. Cryptographic & Schema Integrity Check
    if (!this.manifestStore.verifyManifestIntegrity(manifest)) {
      const result: RecoveryExecutionResult = {
        success: false,
        action: 'CORRUPTED_MANIFEST_REJECTED',
        manifestId: manifest.manifestId,
        resumedStepsCount: 0,
        blockedStepsCount: manifest.activeStepCheckpoints?.length || 0,
        reason: 'Recovery manifest failed cryptographic integrity verification.',
      };

      const event = createEventEnvelope(
        'nexusos.events.recovery.manifest_processed.v1',
        '1.0.0',
        this.agentId,
        correlationId,
        {
          action: 'CORRUPTED_MANIFEST_REJECTED',
          manifestId: manifest.manifestId,
          status: 'REJECTED',
          reason: 'Cryptographic hash verification failed.',
        },
      );

      return { result, event };
    }

    // 3. Reconcile Orphaned Process Trees
    const reconResult = await this.reconciliationEngine.reconcileOrphanedProcesses(manifest);

    // 4. Audit Step Checkpoints — Block Non-Idempotent / Ambiguous Work
    let resumedStepsCount = 0;
    let blockedStepsCount = 0;

    for (const cp of manifest.activeStepCheckpoints || []) {
      // RULE: Ambiguous or non-idempotent work MUST NOT be replayed automatically!
      if (cp.isAmbiguous || !cp.isIdempotent) {
        blockedStepsCount++;
      } else if (cp.isIdempotent && !cp.isAmbiguous && cp.status === 'PAUSED') {
        resumedStepsCount++;
      } else {
        blockedStepsCount++;
      }
    }

    const action =
      blockedStepsCount > 0 && resumedStepsCount === 0 ? 'BLOCKED_AMBIGUOUS' : 'RESUMED';

    // 5. Clear Processed Manifest
    this.manifestStore.clearManifest();

    const result: RecoveryExecutionResult = {
      success: true,
      action,
      manifestId: manifest.manifestId,
      resumedStepsCount,
      blockedStepsCount,
    };

    const event = createEventEnvelope(
      'nexusos.events.recovery.manifest_processed.v1',
      '1.0.0',
      this.agentId,
      correlationId,
      {
        action,
        manifestId: manifest.manifestId,
        status: 'SUCCESS',
        resumedStepsCount,
        blockedStepsCount,
        reconciledProcessCount: reconResult.reconciledCount,
      },
    );

    return { result, event };
  }
}
