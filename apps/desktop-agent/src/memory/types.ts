export interface MemoryCacheEntry<T = unknown> {
  key: string;
  payload: T;
  taskId: string;
  workspaceId: string;
  scope: string;
  policyHash?: string;
  leaseId?: string;
  createdAt: string; // ISO DateTime
  expiresAt: string; // ISO DateTime
  accessCount: number;
  sizeBytes: number;
  lastAccessedAt: string; // ISO DateTime
}

export interface MemoryCacheConfig {
  maxMemoryBytes: number;
  maxEntries: number;
  defaultTTLMs: number;
  cleanupIntervalMs: number;
  maxEntrySizeBytes: number;
  memoryPressureThresholdRatio: number;
}

export interface MemoryCacheStatus {
  initialized: boolean;
  activeEntries: number;
  totalSizeBytes: number;
  totalHits: number;
  totalMisses: number;
  totalEvictions: number;
  emergencyEvictions: number;
  memoryPressureActive: boolean;
}

export interface MemoryCacheReadContext {
  taskId: string;
  workspaceId: string;
  leaseId?: string;
  policyHash?: string;
}

export interface IMemoryCacheStore {
  put<T>(entry: MemoryCacheEntry<T>): Promise<void>;
  get<T>(key: string, readContext: MemoryCacheReadContext): Promise<MemoryCacheEntry<T> | null>;
  remove(key: string): Promise<boolean>;
  clearTask(taskId: string): Promise<number>;
  clearWorkspace(workspaceId: string): Promise<number>;
  clearLease(leaseId: string): Promise<number>;
  invalidatePolicyHash(policyHash: string): Promise<number>;
  clearAll(): Promise<void>;
  getStatus(): MemoryCacheStatus;
  checkMemoryPressure(): boolean;
}

export interface IMemoryCacheManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  put<T>(
    key: string,
    payload: T,
    context: {
      taskId: string;
      workspaceId: string;
      scope?: string;
      policyHash?: string;
      leaseId?: string;
      ttlMs?: number;
    },
  ): Promise<void>;
  get<T>(key: string, context: MemoryCacheReadContext): Promise<T | null>;
  remove(key: string): Promise<boolean>;
  clearTaskContext(taskId: string): Promise<number>;
  clearWorkspaceContext(workspaceId: string): Promise<number>;
  clearLeaseContext(leaseId: string): Promise<number>;
  invalidatePolicyHash(policyHash: string): Promise<number>;
  clearAll(): Promise<void>;
  getStatus(): MemoryCacheStatus;
}
