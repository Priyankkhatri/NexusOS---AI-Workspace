export type UpdateChannel = 'stable' | 'beta' | 'nightly' | 'enterprise';
export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'VERIFYING'
  | 'STAGED'
  | 'ACTIVATING'
  | 'ACTIVATED'
  | 'FAILED'
  | 'ROLLED_BACK';

export interface UpdateManifest {
  manifestId: string;
  version: string;
  channel: UpdateChannel;
  packageUrl: string;
  sha256: string;
  signature: string;
  minimumOsVersion?: string;
  releaseNotes?: string;
  publishedAt: string;
  minAntiRollbackVersion: string;
}

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  targetVersion?: string;
  channel: UpdateChannel;
  lastCheckedAt?: string;
  activePackageHash?: string;
  rollbackAvailable: boolean;
  errorReason?: string;
}

export interface IUpdateManifestVerifier {
  verifyManifest(
    manifest: UpdateManifest,
    currentVersion: string,
  ): { valid: boolean; reason?: string };
  verifyPackageIntegrity(packageData: Buffer | string, expectedSha256: string): boolean;
}

export interface IUpdateStagingStore {
  stagePackage(manifest: UpdateManifest, packageData: Buffer | string): Promise<string>;
  createRollbackSnapshot(currentVersion: string, payload?: string): Promise<boolean>;
  applyStagedUpdate(manifest: UpdateManifest): Promise<boolean>;
  rollbackToLastKnownGood(): Promise<{ success: boolean; version?: string }>;
  hasRollbackSnapshot(): boolean;
  clearStaging(): void;
}

export interface IUpdateManager {
  getStatus(): UpdateStatus;
  checkForUpdates(customManifest?: UpdateManifest): Promise<UpdateManifest | null>;
  downloadAndVerifyUpdate(
    manifest: UpdateManifest,
    packageData?: Buffer | string,
  ): Promise<boolean>;
  stageAndActivateUpdate(healthCheckFn?: () => boolean | Promise<boolean>): Promise<boolean>;
  rollback(): Promise<boolean>;
}
