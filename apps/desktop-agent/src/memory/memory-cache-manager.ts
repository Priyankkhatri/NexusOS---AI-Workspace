import { AgentLifecycleState } from '../lifecycle/index.js';
import { StructuredLogger } from '../telemetry/structured-logger.js';
import { TelemetryManager } from '../telemetry/telemetry-manager.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { MemoryCacheStore } from './memory-cache-store.js';
import {
  MemoryCacheConfigSchema,
  MemoryCacheKeySchema,
  MemoryCacheReadContextSchema,
} from './schemas.js';
import {
  IMemoryCacheManager,
  MemoryCacheConfig,
  MemoryCacheEntry,
  MemoryCacheReadContext,
  MemoryCacheStatus,
} from './types.js';

export class MemoryCacheManager implements IMemoryCacheManager {
  private readonly config: MemoryCacheConfig;
  private readonly store: MemoryCacheStore;
  private readonly logger: StructuredLogger;
  private readonly redactionFilter: RedactionFilter;
  private cleanupTimer?: NodeJS.Timeout;
  private isStarted = false;

  constructor(
    customConfig?: Partial<MemoryCacheConfig>,
    logger?: StructuredLogger,
    private readonly telemetryManager?: TelemetryManager,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
  ) {
    this.config = MemoryCacheConfigSchema.parse(customConfig || {});
    this.logger = logger || new StructuredLogger('MemoryCacheManager');
    this.redactionFilter = new RedactionFilter();
    this.store = new MemoryCacheStore(this.config);
  }

  public async start(): Promise<void> {
    if (this.isStarted) return;

    this.logger.info('Starting MemoryCacheManager...', {
      maxMemoryMB: Math.round(this.config.maxMemoryBytes / 1048576),
      maxEntries: this.config.maxEntries,
    });

    this.isStarted = true;

    // Start background TTL cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.runBackgroundCleanup();
    }, this.config.cleanupIntervalMs);

    // Unref timer so it does not block process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    this.logger.info('MemoryCacheManager started successfully.');
  }

  public async stop(): Promise<void> {
    if (!this.isStarted) return;

    this.logger.info('Stopping MemoryCacheManager...');
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Flush all in-memory entries on shutdown
    await this.store.clearAll();
    this.isStarted = false;

    this.logger.info('MemoryCacheManager stopped gracefully.');
  }

  public async put<T>(
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
  ): Promise<void> {
    this.assertLifecycleAllowed('cache_put');

    // 1. Validate Cache Key
    const validatedKey = MemoryCacheKeySchema.parse(key);

    if (!context.taskId || typeof context.taskId !== 'string') {
      throw new Error('taskId is required for memory cache insertion.');
    }
    if (!context.workspaceId || typeof context.workspaceId !== 'string') {
      throw new Error('workspaceId is required for memory cache insertion.');
    }

    // 2. Secret Redaction Filtering & Security Boundary
    let sanitizedPayload: T;
    try {
      sanitizedPayload = this.redactionFilter.redactObject(payload) as T;
    } catch (err) {
      throw new Error(
        `Redaction filtering failed for key '${validatedKey}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Compute Entry Size in Bytes
    const jsonStr = JSON.stringify(sanitizedPayload);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf-8');

    const ttl = context.ttlMs && context.ttlMs > 0 ? context.ttlMs : this.config.defaultTTLMs;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl).toISOString();

    const entry: MemoryCacheEntry<T> = {
      key: validatedKey,
      payload: sanitizedPayload,
      taskId: context.taskId,
      workspaceId: context.workspaceId,
      scope: context.scope || 'task:working_memory',
      policyHash: context.policyHash,
      leaseId: context.leaseId,
      createdAt: now.toISOString(),
      expiresAt,
      accessCount: 0,
      sizeBytes,
      lastAccessedAt: now.toISOString(),
    };

    await this.store.put(entry);

    this.logger.info('Memory cache entry stored', {
      key: validatedKey,
      sizeBytes,
      ttlMs: ttl,
    });

    this.telemetryManager?.trackTrace('memory_cache_put', {
      key: validatedKey,
      sizeBytes,
    });
  }

  public async get<T>(key: string, context: MemoryCacheReadContext): Promise<T | null> {
    this.assertLifecycleAllowed('cache_get');

    const validatedKey = MemoryCacheKeySchema.parse(key);
    const readCtx = MemoryCacheReadContextSchema.parse(context);

    const entry = await this.store.get<T>(validatedKey, readCtx);
    if (!entry) {
      this.telemetryManager?.trackTrace('memory_cache_miss', { key: validatedKey });
      return null;
    }

    this.telemetryManager?.trackTrace('memory_cache_hit', { key: validatedKey });
    return entry.payload;
  }

  public async remove(key: string): Promise<boolean> {
    this.assertLifecycleAllowed('cache_remove');
    const validatedKey = MemoryCacheKeySchema.parse(key);

    const result = await this.store.remove(validatedKey);
    if (result) {
      this.logger.info('Memory cache entry removed', { key: validatedKey });
    }
    return result;
  }

  public async clearTaskContext(taskId: string): Promise<number> {
    this.assertLifecycleAllowed('clear_task');
    if (!taskId || typeof taskId !== 'string') return 0;

    const cleared = await this.store.clearTask(taskId);
    if (cleared > 0) {
      this.logger.info('Task memory context cleared', { taskId, clearedCount: cleared });
    }
    return cleared;
  }

  public async clearWorkspaceContext(workspaceId: string): Promise<number> {
    this.assertLifecycleAllowed('clear_workspace');
    if (!workspaceId || typeof workspaceId !== 'string') return 0;

    const cleared = await this.store.clearWorkspace(workspaceId);
    if (cleared > 0) {
      this.logger.info('Workspace memory context cleared', { workspaceId, clearedCount: cleared });
    }
    return cleared;
  }

  public async clearLeaseContext(leaseId: string): Promise<number> {
    this.assertLifecycleAllowed('clear_lease');
    if (!leaseId || typeof leaseId !== 'string') return 0;

    const cleared = await this.store.clearLease(leaseId);
    if (cleared > 0) {
      this.logger.info('Lease memory context invalidated', { leaseId, clearedCount: cleared });
    }
    return cleared;
  }

  public async invalidatePolicyHash(policyHash: string): Promise<number> {
    this.assertLifecycleAllowed('invalidate_policy');
    if (!policyHash || typeof policyHash !== 'string') return 0;

    const cleared = await this.store.invalidatePolicyHash(policyHash);
    if (cleared > 0) {
      this.logger.info('Policy memory context invalidated', { policyHash, clearedCount: cleared });
    }
    return cleared;
  }

  public async clearAll(): Promise<void> {
    await this.store.clearAll();
    this.logger.info('Memory cache store cleared completely.');
  }

  public getStatus(): MemoryCacheStatus {
    return this.store.getStatus();
  }

  private assertLifecycleAllowed(action: string): void {
    if (!this.isStarted) {
      // Auto-start manager on demand if not explicit
      this.isStarted = true;
    }

    if (this.getAgentLifecycleState) {
      const currentState = this.getAgentLifecycleState();
      if (
        currentState === AgentLifecycleState.STOPPING ||
        currentState === AgentLifecycleState.FAILED
      ) {
        throw new Error(
          `Memory cache operation '${action}' rejected: Agent is in non-ready lifecycle state '${currentState}'.`,
        );
      }
    }
  }

  private async runBackgroundCleanup(): Promise<void> {
    try {
      const evictedCount = await this.store.evictExpired();
      if (evictedCount > 0) {
        this.logger.info('Background memory cache TTL cleanup completed', {
          evictedCount,
        });
      }
    } catch {
      // Suppress background cleanup errors
    }
  }
}
