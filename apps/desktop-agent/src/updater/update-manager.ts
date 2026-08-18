import { NotificationManager } from '../notifications/notification-manager.js';
import { StructuredLogger } from '../telemetry/structured-logger.js';
import { TelemetryManager } from '../telemetry/telemetry-manager.js';
import { UpdateManifestVerifier } from './manifest-verifier.js';
import { UpdateStagingStore } from './staging-store.js';
import {
  IUpdateManager,
  IUpdateManifestVerifier,
  IUpdateStagingStore,
  UpdateChannel,
  UpdateManifest,
  UpdateStatus,
} from './types.js';

export class UpdateManager implements IUpdateManager {
  private currentVersion: string;
  private channel: UpdateChannel;
  private status: UpdateStatus;
  private currentManifest?: UpdateManifest;
  // K-02 FIX: Track the verified manifest to prevent bypass of checkForUpdates
  private verifiedManifestId?: string;

  constructor(
    initialVersion: string = '1.0.0',
    initialChannel: UpdateChannel = 'stable',
    private readonly verifier: IUpdateManifestVerifier = new UpdateManifestVerifier(
      'nexusos_release_signing_key_v1',
    ),
    private readonly stagingStore: IUpdateStagingStore = new UpdateStagingStore(),
    private readonly notificationManager?: NotificationManager,
    private readonly logger: StructuredLogger = new StructuredLogger('UpdateManager'),
    private readonly telemetryManager?: TelemetryManager,
  ) {
    this.currentVersion = initialVersion;
    this.channel = initialChannel;
    this.status = {
      state: 'IDLE',
      currentVersion: this.currentVersion,
      channel: this.channel,
      rollbackAvailable: this.stagingStore.hasRollbackSnapshot(),
    };
  }

  public getStatus(): UpdateStatus {
    return {
      ...this.status,
      rollbackAvailable: this.stagingStore.hasRollbackSnapshot(),
    };
  }

  public async checkForUpdates(customManifest?: UpdateManifest): Promise<UpdateManifest | null> {
    this.status.state = 'CHECKING';
    this.status.lastCheckedAt = new Date().toISOString();
    // K-05/K-07: Sanitize log — do not log manifest signing material
    this.logger.info('Checking for updates', {
      currentVersion: this.currentVersion,
      channel: this.channel,
    });

    if (!customManifest) {
      this.status.state = 'IDLE';
      return null;
    }

    // Enforce channel alignment
    if (customManifest.channel !== this.channel) {
      this.status.state = 'FAILED';
      this.status.errorReason = `Update channel mismatch. Manifest channel '${customManifest.channel}' does not match active channel '${this.channel}'.`;
      this.logger.warn('Channel mismatch detected', {
        manifestChannel: customManifest.channel,
        activeChannel: this.channel,
      });
      return null;
    }

    // 1. Verify Manifest Cryptographic Signature & Anti-Rollback Rules
    const verification = this.verifier.verifyManifest(customManifest, this.currentVersion);
    if (!verification.valid) {
      this.status.state = 'FAILED';
      this.status.errorReason = verification.reason;
      this.logger.warn('Update manifest verification failed', {
        manifestId: customManifest.manifestId,
        reason: verification.reason,
      });

      this.notificationManager?.notify({
        category: 'SECURITY_ALERT',
        priority: 'HIGH',
        title: 'Update Manifest Rejected',
        // Sanitize: do not include manifest hash or signature in notification
        message: verification.reason || 'Manifest verification failed.',
      });

      return null;
    }

    this.currentManifest = customManifest;
    // K-02 FIX: Record verified manifest ID
    this.verifiedManifestId = customManifest.manifestId;
    this.status.state = 'AVAILABLE';
    this.status.targetVersion = customManifest.version;

    this.notificationManager?.notify({
      category: 'SYSTEM_INFO',
      priority: 'NORMAL',
      title: 'Update Available',
      message: `NexusOS version ${customManifest.version} is available for download.`,
      coalesceKey: `update_avail_${customManifest.version}`,
    });

    return customManifest;
  }

  public async downloadAndVerifyUpdate(
    manifest: UpdateManifest,
    packageData?: Buffer | string,
  ): Promise<boolean> {
    if (!manifest) {
      this.status.state = 'FAILED';
      this.status.errorReason = 'No update manifest provided for download.';
      return false;
    }

    // K-02 FIX: Enforce that the manifest was previously verified via checkForUpdates
    if (!this.verifiedManifestId || this.verifiedManifestId !== manifest.manifestId) {
      this.status.state = 'FAILED';
      this.status.errorReason = 'Manifest was not verified via checkForUpdates. Download rejected.';
      this.logger.warn('Attempted to download unverified manifest', {
        manifestId: manifest.manifestId,
      });
      return false;
    }

    // K-09 FIX: Require explicit package data — do not generate predictable default payload
    if (!packageData) {
      this.status.state = 'FAILED';
      this.status.errorReason = 'No package data provided for integrity verification.';
      return false;
    }

    this.status.state = 'DOWNLOADING';
    const rawData = packageData;

    this.status.state = 'VERIFYING';
    // Verify Package SHA-256 Integrity
    const isIntegrityValid = this.verifier.verifyPackageIntegrity(rawData, manifest.sha256);
    if (!isIntegrityValid) {
      this.status.state = 'FAILED';
      this.status.errorReason = 'Package SHA-256 checksum verification failed.';
      // Sanitize: do not log hash values
      this.logger.error('Update package checksum mismatch', {
        version: manifest.version,
      });

      this.notificationManager?.notify({
        category: 'SECURITY_ALERT',
        priority: 'CRITICAL',
        title: 'Update Package Integrity Failure',
        message: 'Downloaded package SHA-256 hash mismatch.',
      });

      return false;
    }

    this.status.state = 'STAGED';
    await this.stagingStore.stagePackage(manifest, rawData);
    this.status.activePackageHash = manifest.sha256;

    this.logger.info('Update package staged successfully', { version: manifest.version });
    return true;
  }

  public async stageAndActivateUpdate(
    healthCheckFn?: () => boolean | Promise<boolean>,
  ): Promise<boolean> {
    if (this.status.state !== 'STAGED' || !this.currentManifest) {
      this.status.state = 'FAILED';
      this.status.errorReason = 'Cannot activate update. Package is not staged.';
      return false;
    }

    this.status.state = 'ACTIVATING';

    // 1. Create Rollback Snapshot of Last Known Good (LKG) Version
    await this.stagingStore.createRollbackSnapshot(
      this.currentVersion,
      `nexusos_core_binary_v${this.currentVersion}`,
    );

    // 2. Health-Gated Activation Check
    if (healthCheckFn) {
      const isHealthy = await healthCheckFn();
      if (!isHealthy) {
        this.logger.error('Health check failed prior to update activation');

        this.notificationManager?.notify({
          category: 'SECURITY_ALERT',
          priority: 'CRITICAL',
          title: 'Update Activation Blocked',
          message: 'Health readiness check failed. Update aborted.',
        });

        // Trigger automatic rollback safeguard
        await this.rollback();
        this.status.errorReason =
          'Health-gated activation check failed. Aborting update activation to prevent unsafe deployment.';
        return false;
      }
    }

    // 3. Apply Staged Update Atomically
    try {
      await this.stagingStore.applyStagedUpdate(this.currentManifest);
      const oldVersion = this.currentVersion;
      this.currentVersion = this.currentManifest.version;
      this.status.state = 'ACTIVATED';
      this.status.currentVersion = this.currentVersion;
      this.status.targetVersion = undefined;
      // Clear verified manifest after activation
      this.verifiedManifestId = undefined;

      this.logger.info('Update activated successfully', {
        oldVersion,
        newVersion: this.currentVersion,
      });

      this.telemetryManager?.trackTrace('update_activated', {
        oldVersion,
        newVersion: this.currentVersion,
        manifestId: this.currentManifest.manifestId,
      });

      this.notificationManager?.notify({
        category: 'SYSTEM_INFO',
        priority: 'HIGH',
        title: 'NexusOS Updated',
        message: `NexusOS successfully updated to version ${this.currentVersion}.`,
      });

      return true;
    } catch (err) {
      this.status.state = 'FAILED';
      // Sanitize error: do not expose raw error message which may contain paths/secrets
      const safeErrorMsg =
        err instanceof Error
          ? err.message.replace(/[A-Z]:\\[^\s]*/gi, '[REDACTED_PATH]')
          : 'Unknown activation error';
      this.status.errorReason = `Update activation failure: ${safeErrorMsg}`;
      this.logger.error('Failed to apply staged update', { error: safeErrorMsg });

      await this.rollback();
      return false;
    }
  }

  public async rollback(): Promise<boolean> {
    this.logger.warn('Initiating rollback to Last Known Good version snapshot');
    const result = await this.stagingStore.rollbackToLastKnownGood();

    if (result.success && result.version) {
      const oldVersion = this.currentVersion;
      this.currentVersion = result.version;
      this.status.state = 'ROLLED_BACK';
      this.status.currentVersion = this.currentVersion;
      this.status.errorReason = undefined;
      // Clear verified manifest on rollback
      this.verifiedManifestId = undefined;

      this.logger.info('Rollback executed successfully', {
        oldVersion,
        restoredVersion: this.currentVersion,
      });

      this.notificationManager?.notify({
        category: 'RECOVERY_INTERVENTION',
        priority: 'CRITICAL',
        title: 'NexusOS Update Rolled Back',
        message: `System rolled back safely to version ${this.currentVersion}.`,
      });

      return true;
    } else {
      this.status.state = 'FAILED';
      this.status.errorReason = 'Rollback failed. No valid snapshot available.';
      return false;
    }
  }

  public shutdown(): void {
    this.verifiedManifestId = undefined;
    this.currentManifest = undefined;
    this.stagingStore.clearStaging();
    this.status.state = 'IDLE';
  }
}
