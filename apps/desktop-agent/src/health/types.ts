import { EventEnvelope } from '@nexusos/contracts';

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'FAILED';

export interface ResourceUsage {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskHeadroomBytes: number;
}

export interface HealthReport {
  state: HealthState;
  agentId: string;
  agentVersion: string;
  configRevision: number;
  uptimeSeconds: number;
  resourceUsage: ResourceUsage;
  queueBacklog: number;
  spoolBacklog: number;
  policyFreshnessSec: number;
  capabilityAvailability: Record<string, boolean>;
  checkedAt: string;
}

export interface ReadinessCheckResult {
  ready: boolean;
  state: HealthState;
  reasons: string[];
  checkedAt: string;
}

export interface StepCheckpoint {
  stepId: string;
  taskId: string;
  runnerType: 'TERMINAL' | 'BROWSER' | 'FILESYSTEM' | 'PLUGIN';
  isIdempotent: boolean;
  isAmbiguous: boolean;
  status: 'COMPLETED' | 'PAUSED' | 'FAILED' | 'IN_PROGRESS';
  ownershipToken: string;
  leaseExpiresAt?: string;
}

export interface RecoveryManifest {
  manifestId: string;
  agentId: string;
  crashedAt: string;
  exitCode?: number;
  lastActiveLeaseId?: string;
  activeStepCheckpoints: StepCheckpoint[];
  manifestHash: string;
}

export interface ProcessReconciliationResult {
  reconciledCount: number;
  orphanedTerminalProcesses: number;
  terminatedBrowserSessions: number;
  quarantinedPlugins: number;
  details: string[];
}

export interface RecoveryExecutionResult {
  success: boolean;
  action: 'RESUMED' | 'BLOCKED_AMBIGUOUS' | 'NO_MANIFEST' | 'CORRUPTED_MANIFEST_REJECTED';
  manifestId?: string;
  resumedStepsCount: number;
  blockedStepsCount: number;
  reason?: string;
}

/**
 * Interface Definitions for Task 03H
 */
export interface IHealthMonitor {
  getHealthReport(): HealthReport;
  checkLiveness(): boolean;
  checkReadiness(): ReadinessCheckResult;
}

export interface IReadinessGate {
  evaluateReadiness(): ReadinessCheckResult;
  assertReadyForLease(): void;
}

export interface IRecoveryManifestStore {
  createManifest(
    agentId: string,
    checkpoints: StepCheckpoint[],
    exitCode?: number,
  ): RecoveryManifest;
  saveManifest(manifest: RecoveryManifest): void;
  loadManifest(): RecoveryManifest | null;
  verifyManifestIntegrity(manifest: RecoveryManifest): boolean;
  clearManifest(): void;
}

export interface IProcessReconciliationEngine {
  reconcileOrphanedProcesses(
    manifest: RecoveryManifest | null,
  ): Promise<ProcessReconciliationResult>;
}

export interface ICrashRecoveryManager {
  executeStartupRecovery(): Promise<{
    result: RecoveryExecutionResult;
    event: EventEnvelope;
  }>;
  recordStepCheckpoint(checkpoint: StepCheckpoint): void;
  getRecoveryManifest(): RecoveryManifest | null;
}
