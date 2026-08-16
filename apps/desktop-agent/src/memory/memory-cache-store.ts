import {
  IMemoryCacheStore,
  MemoryCacheConfig,
  MemoryCacheEntry,
  MemoryCacheReadContext,
  MemoryCacheStatus,
} from './types.js';

export class MemoryCacheStore implements IMemoryCacheStore {
  private readonly entries = new Map<string, MemoryCacheEntry<unknown>>();
  private readonly taskIndex = new Map<string, Set<string>>();
  private readonly workspaceIndex = new Map<string, Set<string>>();
  private readonly leaseIndex = new Map<string, Set<string>>();
  private readonly policyIndex = new Map<string, Set<string>>();

  private totalSizeBytes = 0;
  private totalHits = 0;
  private totalMisses = 0;
  private totalEvictions = 0;
  private emergencyEvictions = 0;

  constructor(private readonly config: MemoryCacheConfig) {}

  public async put<T>(entry: MemoryCacheEntry<T>): Promise<void> {
    if (entry.sizeBytes > this.config.maxEntrySizeBytes) {
      throw new Error(
        `Entry size of ${entry.sizeBytes} bytes exceeds maximum entry limit of ${this.config.maxEntrySizeBytes} bytes.`,
      );
    }

    // Remove existing entry for the same key if present
    if (this.entries.has(entry.key)) {
      await this.remove(entry.key);
    }

    // Check memory pressure & capacity limits before storing
    this.checkMemoryPressure();
    this.ensureCapacity(entry.sizeBytes);

    this.entries.set(entry.key, entry as MemoryCacheEntry<unknown>);
    this.totalSizeBytes += entry.sizeBytes;

    // Index entry
    this.addIndex(this.taskIndex, entry.taskId, entry.key);
    this.addIndex(this.workspaceIndex, entry.workspaceId, entry.key);
    if (entry.leaseId) {
      this.addIndex(this.leaseIndex, entry.leaseId, entry.key);
    }
    if (entry.policyHash) {
      this.addIndex(this.policyIndex, entry.policyHash, entry.key);
    }
  }

  public async get<T>(
    key: string,
    readContext: MemoryCacheReadContext,
  ): Promise<MemoryCacheEntry<T> | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      this.totalMisses++;
      return null;
    }

    // 1. Check TTL Expiration
    if (new Date().toISOString() > entry.expiresAt) {
      await this.remove(key);
      this.totalMisses++;
      return null;
    }

    // 2. Strict Task Isolation Validation
    if (entry.taskId !== readContext.taskId) {
      this.totalMisses++;
      return null;
    }

    // 3. Strict Workspace Isolation Validation
    if (entry.workspaceId !== readContext.workspaceId) {
      this.totalMisses++;
      return null;
    }

    // 4. Lease Binding Validation
    if (entry.leaseId && entry.leaseId !== readContext.leaseId) {
      this.totalMisses++;
      return null;
    }

    // 5. Policy Hash Binding Validation
    if (entry.policyHash && entry.policyHash !== readContext.policyHash) {
      this.totalMisses++;
      return null;
    }

    // Update access metrics
    entry.accessCount++;
    entry.lastAccessedAt = new Date().toISOString();
    this.totalHits++;

    return entry as MemoryCacheEntry<T>;
  }

  public async remove(key: string): Promise<boolean> {
    const entry = this.entries.get(key);
    if (!entry) return false;

    this.entries.delete(key);
    this.totalSizeBytes -= entry.sizeBytes;
    if (this.totalSizeBytes < 0) this.totalSizeBytes = 0;

    // Remove from indices
    this.removeIndex(this.taskIndex, entry.taskId, key);
    this.removeIndex(this.workspaceIndex, entry.workspaceId, key);
    if (entry.leaseId) {
      this.removeIndex(this.leaseIndex, entry.leaseId, key);
    }
    if (entry.policyHash) {
      this.removeIndex(this.policyIndex, entry.policyHash, key);
    }

    return true;
  }

  public async clearTask(taskId: string): Promise<number> {
    const keys = this.taskIndex.get(taskId);
    if (!keys) return 0;

    let cleared = 0;
    for (const key of Array.from(keys)) {
      if (await this.remove(key)) cleared++;
    }
    this.taskIndex.delete(taskId);
    return cleared;
  }

  public async clearWorkspace(workspaceId: string): Promise<number> {
    const keys = this.workspaceIndex.get(workspaceId);
    if (!keys) return 0;

    let cleared = 0;
    for (const key of Array.from(keys)) {
      if (await this.remove(key)) cleared++;
    }
    this.workspaceIndex.delete(workspaceId);
    return cleared;
  }

  public async clearLease(leaseId: string): Promise<number> {
    const keys = this.leaseIndex.get(leaseId);
    if (!keys) return 0;

    let cleared = 0;
    for (const key of Array.from(keys)) {
      if (await this.remove(key)) cleared++;
    }
    this.leaseIndex.delete(leaseId);
    return cleared;
  }

  public async invalidatePolicyHash(policyHash: string): Promise<number> {
    const keys = this.policyIndex.get(policyHash);
    if (!keys) return 0;

    let cleared = 0;
    for (const key of Array.from(keys)) {
      if (await this.remove(key)) cleared++;
    }
    this.policyIndex.delete(policyHash);
    return cleared;
  }

  public async clearAll(): Promise<void> {
    this.entries.clear();
    this.taskIndex.clear();
    this.workspaceIndex.clear();
    this.leaseIndex.clear();
    this.policyIndex.clear();
    this.totalSizeBytes = 0;
  }

  public getStatus(): MemoryCacheStatus {
    return {
      initialized: true,
      activeEntries: this.entries.size,
      totalSizeBytes: this.totalSizeBytes,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      totalEvictions: this.totalEvictions,
      emergencyEvictions: this.emergencyEvictions,
      memoryPressureActive: this.checkMemoryPressure(),
    };
  }

  public checkMemoryPressure(): boolean {
    const memory = process.memoryUsage();
    if (!memory.heapTotal || memory.heapTotal === 0) return false;

    const ratio = memory.heapUsed / memory.heapTotal;
    if (ratio >= this.config.memoryPressureThresholdRatio) {
      this.performEmergencyEviction();
      return true;
    }
    return false;
  }

  public async evictExpired(): Promise<number> {
    const nowISO = new Date().toISOString();
    let count = 0;
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (nowISO > entry.expiresAt) {
        if (await this.remove(key)) {
          count++;
          this.totalEvictions++;
        }
      }
    }
    return count;
  }

  private ensureCapacity(incomingSizeBytes: number): void {
    // 1. Evict expired entries first
    this.evictExpired();

    // 2. Check if under bounds
    if (
      this.entries.size < this.config.maxEntries &&
      this.totalSizeBytes + incomingSizeBytes <= this.config.maxMemoryBytes
    ) {
      return;
    }

    // 3. LRU Eviction: Sort entries by lastAccessedAt (oldest first), then accessCount
    const sortedEntries = Array.from(this.entries.values()).sort((a, b) => {
      if (a.lastAccessedAt === b.lastAccessedAt) {
        return a.accessCount - b.accessCount;
      }
      return a.lastAccessedAt.localeCompare(b.lastAccessedAt);
    });

    for (const lruEntry of sortedEntries) {
      if (
        this.entries.size < this.config.maxEntries &&
        this.totalSizeBytes + incomingSizeBytes <= this.config.maxMemoryBytes
      ) {
        break;
      }
      this.remove(lruEntry.key);
      this.totalEvictions++;
    }

    // 4. Fail closed if memory ceiling cannot be met after LRU eviction
    if (this.totalSizeBytes + incomingSizeBytes > this.config.maxMemoryBytes) {
      throw new Error(
        `Memory cache ceiling exceeded: cannot allocate ${incomingSizeBytes} bytes without exceeding maximum allowed ceiling of ${this.config.maxMemoryBytes} bytes.`,
      );
    }
  }

  private performEmergencyEviction(): void {
    // Evict 50% of least-recently-used entries during high heap pressure
    const targetEvictCount = Math.ceil(this.entries.size * 0.5);
    if (targetEvictCount === 0) return;

    const sortedEntries = Array.from(this.entries.values()).sort((a, b) =>
      a.lastAccessedAt.localeCompare(b.lastAccessedAt),
    );

    for (let i = 0; i < targetEvictCount && i < sortedEntries.length; i++) {
      this.remove(sortedEntries[i]!.key);
      this.emergencyEvictions++;
      this.totalEvictions++;
    }
  }

  private addIndex(map: Map<string, Set<string>>, indexKey: string, cacheKey: string): void {
    let set = map.get(indexKey);
    if (!set) {
      set = new Set<string>();
      map.set(indexKey, set);
    }
    set.add(cacheKey);
  }

  private removeIndex(map: Map<string, Set<string>>, indexKey: string, cacheKey: string): void {
    const set = map.get(indexKey);
    if (set) {
      set.delete(cacheKey);
      if (set.size === 0) {
        map.delete(indexKey);
      }
    }
  }
}
