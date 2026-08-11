import { EventEnvelope } from '@nexusos/contracts';

export enum ConfigLayer {
  IMMUTABLE_SHIPPED_DEFAULTS = 'IMMUTABLE_SHIPPED_DEFAULTS',
  SIGNED_RELEASE_CONFIG = 'SIGNED_RELEASE_CONFIG',
  ENTERPRISE_POLICY_OVERLAYS = 'ENTERPRISE_POLICY_OVERLAYS',
  USER_PREFERENCES = 'USER_PREFERENCES',
}

export interface SecurityBaselines {
  readonly policyDenyRulesEnabled: true;
  readonly leaseValidationEnabled: true;
  readonly capabilityEnforcementEnabled: true;
  readonly filesystemPathSecurityEnabled: true;
  readonly ssrfDomainSecurityEnabled: true;
  readonly secretRedactionEnabled: true;
  readonly pluginIsolationEnabled: true;
  readonly terminalSecurityEnabled: true;
  readonly sandboxIsolationEnabled: true;
  readonly authenticationRequired: true;
}

export interface ResourceBudgets {
  processTimeoutMs: number;
  terminalMaxOutputBytes: number;
  pluginMaxConcurrentHosts: number;
  browserMaxSessions: number;
  fileMaxByteSize: number;
  maxConcurrentLeases: number;
  heartbeatIntervalMs: number;
}

export interface FeatureFlags {
  enableExperimentalRuntimes: boolean;
  enableTelemetrySpooling: boolean;
  enableDiagnosticBundleExport: boolean;
  enableLocalCaching: boolean;
}

export interface CoreSettings {
  deviceId: string;
  agentVersion: string;
  controlPlaneUrl: string;
  environment: 'development' | 'test' | 'staging' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  stateStoragePath: string;
}

export interface ConfigurationSnapshot {
  version: string;
  revision: number;
  layer: ConfigLayer;
  settings: CoreSettings;
  resourceBudgets: ResourceBudgets;
  securityBaselines: SecurityBaselines;
  featureFlags: FeatureFlags;
  customPreferences?: Record<string, unknown>;
  hash: string;
  updatedAt: string;
}

export interface DeepPartialConfigurationSnapshot {
  version?: string;
  revision?: number;
  layer?: ConfigLayer;
  settings?: Partial<CoreSettings>;
  resourceBudgets?: Partial<ResourceBudgets>;
  securityBaselines?: Partial<SecurityBaselines>;
  featureFlags?: Partial<FeatureFlags>;
  customPreferences?: Record<string, unknown>;
  hash?: string;
  updatedAt?: string;
}

export interface SignedConfigEnvelope {
  payload: DeepPartialConfigurationSnapshot;
  layer: ConfigLayer;
  revision: number;
  signature: string;
  authorityKeyId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedConfig?: ConfigurationSnapshot;
}

export interface ConfigSignatureVerificationResult {
  valid: boolean;
  reason?: string;
  authorityKeyId?: string;
}

export interface ConfigOperationResult<T = ConfigurationSnapshot> {
  success: boolean;
  action: 'UPDATE' | 'ROLLBACK' | 'REJECT';
  snapshot?: T;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}

export type ConfigObserverCallback = (snapshot: Readonly<ConfigurationSnapshot>) => void;

/**
 * Required Interfaces for Task 03G
 */
export interface IConfigSignatureVerifier {
  verifySignature(envelope: SignedConfigEnvelope): Promise<ConfigSignatureVerificationResult>;
}

export interface IConfigValidationEngine {
  validateSnapshot(raw: unknown): ConfigValidationResult;
  assertSecurityBaselinesIntact(config: Partial<ConfigurationSnapshot>): void;
  checkForPlaintextSecrets(obj: unknown): string[];
}

export interface IConfigurationStore {
  getActiveConfig(): Readonly<ConfigurationSnapshot>;
  getLKGConfig(): Readonly<ConfigurationSnapshot> | null;
  getShippedDefaults(): Readonly<ConfigurationSnapshot>;
  setActiveConfig(snapshot: ConfigurationSnapshot): void;
  setLKGConfig(snapshot: ConfigurationSnapshot): void;
}

export interface IConfigRollbackHandler {
  rollbackToLKG(
    store: IConfigurationStore,
    validationEngine: IConfigValidationEngine,
  ): ConfigurationSnapshot;
}

export interface IConfigurationObserverRegistry {
  subscribe(observerId: string, callback: ConfigObserverCallback): void;
  unsubscribe(observerId: string): void;
  notifyObservers(snapshot: Readonly<ConfigurationSnapshot>): void;
}

export interface IConfigurationManager {
  getActiveConfiguration(): Readonly<ConfigurationSnapshot>;
  applyConfigurationUpdate(
    layer: ConfigLayer,
    update: DeepPartialConfigurationSnapshot | SignedConfigEnvelope,
  ): Promise<{ result: ConfigOperationResult; event: EventEnvelope }>;
  rollbackToLKG(): Promise<{ result: ConfigOperationResult; event: EventEnvelope }>;
}
