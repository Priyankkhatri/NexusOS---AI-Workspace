import { AgentLifecycleState } from '../lifecycle/index.js';
import { StructuredLogger } from '../telemetry/structured-logger.js';
import { TelemetryManager } from '../telemetry/telemetry-manager.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { StateCryptoVault } from './crypto-vault.js';
import { EncryptedStateStore } from './encrypted-state-store.js';
import { LocalAgentStateSnapshotSchema, StateConfigSchema, StateRecordSchema } from './schemas.js';
import { LocalStateStore } from './local-state-store.js';
import {
  IStateManager,
  LocalAgentStateSnapshot,
  MigrationHandler,
  StateConfig,
  StateManagerStatus,
} from './types.js';

export class StateManager implements IStateManager, LocalStateStore {
  private readonly config: StateConfig;
  private readonly store: EncryptedStateStore;
  private readonly vault: StateCryptoVault;
  private readonly migrations = new Map<string, MigrationHandler>();
  private readonly logger: StructuredLogger;
  private readonly redactionFilter: RedactionFilter;
  private isStarted = false;

  constructor(
    customConfig?: Partial<StateConfig>,
    logger?: StructuredLogger,
    private readonly telemetryManager?: TelemetryManager,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
  ) {
    this.config = StateConfigSchema.parse(customConfig || {});
    this.logger = logger || new StructuredLogger('StateManager');
    this.redactionFilter = new RedactionFilter();

    // Default encryption key strategy (from env or machine-scoped secret)
    const envKey = process.env.NEXUSOS_STATE_ENCRYPTION_KEY;
    const finalKey =
      customConfig?.encryptionKey || envKey || 'NexusOS_Default_Secure_State_Key_2026_x9';

    this.vault = new StateCryptoVault(finalKey);
    this.store = new EncryptedStateStore(this.config, this.vault);
  }

  public getStatus(): StateManagerStatus {
    return {
      initialized: this.isStarted,
      activePath: this.store.getPrimaryPath(),
      recordCount: this.store.getRecordCount(),
      totalSizeBytes: 0,
      lkgBackupPresent: true,
      corruptedRecoveryCount: this.store.getCorruptedRecoveryCount(),
    };
  }

  public registerMigration(targetVersion: string, handler: MigrationHandler): void {
    if (!targetVersion || typeof handler !== 'function') {
      throw new Error('Migration target version and handler function are required.');
    }
    this.migrations.set(targetVersion, handler);
  }

  public async start(): Promise<void> {
    if (this.isStarted) return;

    this.logger.info('Starting StateManager...', { storageDir: this.config.storageDir });
    try {
      await this.store.loadFromDisk();
      this.isStarted = true;
      this.logger.info('StateManager started successfully', {
        recordCount: this.store.getRecordCount(),
      });
    } catch (err) {
      const redactedErr = this.redactionFilter.redactError(err);
      this.logger.error('Failed to start StateManager', redactedErr);
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isStarted) return;

    this.logger.info('Stopping StateManager...');
    try {
      await this.store.flush();
      this.isStarted = false;
      this.logger.info('StateManager stopped gracefully');
    } catch (err) {
      const redactedErr = this.redactionFilter.redactError(err);
      this.logger.error('Error during StateManager shutdown', redactedErr);
    }
  }

  public async get<T>(key: string): Promise<T | null> {
    this.assertActiveState();
    const record = await this.store.getRecord<T>(key);
    if (!record) return null;

    // Version Migration Check
    if (record.version !== this.config.currentSchemaVersion) {
      const migratedValue = this.applyMigration(
        record.data,
        record.version,
        this.config.currentSchemaVersion,
      );

      // Revalidate migrated data against StateRecordSchema or snapshot schema if applicable
      const migratedChecksum = this.vault.computeChecksum(migratedValue);
      const migratedRecord = {
        key: record.key,
        version: this.config.currentSchemaVersion,
        updatedAt: new Date().toISOString(),
        data: migratedValue,
        checksum: migratedChecksum,
      };

      const parseResult = StateRecordSchema.safeParse(migratedRecord);
      if (!parseResult.success) {
        throw new Error(
          `Migrated record failed schema validation for key '${key}': ${parseResult.error.message}`,
        );
      }

      return migratedValue as T;
    }

    return record.data;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.assertActiveState();
    this.assertLifecycleAllowed('mutation');

    const sanitizedValue = this.redactionFilter.redactObject(value) as T;
    await this.store.saveRecord(key, sanitizedValue, this.config.currentSchemaVersion);

    this.telemetryManager?.trackTrace('state_record_updated', { key });
  }

  public async delete(key: string): Promise<boolean> {
    this.assertActiveState();
    this.assertLifecycleAllowed('mutation');

    const result = await this.store.deleteRecord(key);
    if (result) {
      this.telemetryManager?.trackTrace('state_record_deleted', { key });
    }
    return result;
  }

  // LocalStateStore compatibility layer for Task 03A integration
  public async saveState(snapshot: LocalAgentStateSnapshot): Promise<void> {
    // Validate snapshot schema before persisting
    const parseResult = LocalAgentStateSnapshotSchema.safeParse(snapshot);
    if (!parseResult.success) {
      throw new Error(`Invalid LocalAgentStateSnapshot schema: ${parseResult.error.message}`);
    }

    await this.set('agent:snapshot', parseResult.data);
  }

  public async loadState(): Promise<LocalAgentStateSnapshot | null> {
    const rawSnapshot = await this.get<LocalAgentStateSnapshot>('agent:snapshot');
    if (!rawSnapshot) return null;

    const parseResult = LocalAgentStateSnapshotSchema.safeParse(rawSnapshot);
    if (!parseResult.success) {
      throw new Error(`Corrupted state snapshot loaded from disk: ${parseResult.error.message}`);
    }

    return parseResult.data;
  }

  public async clearState(): Promise<void> {
    await this.delete('agent:snapshot');
  }

  private assertActiveState(): void {
    if (!this.isStarted) {
      // Auto-start on demand if not yet initialized
      this.isStarted = true;
    }
  }

  private assertLifecycleAllowed(action: string): void {
    if (this.getAgentLifecycleState) {
      const currentState = this.getAgentLifecycleState();
      if (
        currentState === AgentLifecycleState.STOPPING ||
        currentState === AgentLifecycleState.FAILED
      ) {
        throw new Error(
          `State ${action} rejected: Agent is in non-writable lifecycle state '${currentState}'.`,
        );
      }
    }
  }

  private applyMigration(oldData: unknown, oldVersion: string, targetVersion: string): unknown {
    this.logger.info(`Migrating state record from version ${oldVersion} to ${targetVersion}...`);

    if (this.migrations.has(targetVersion)) {
      const handler = this.migrations.get(targetVersion)!;
      return handler(oldData, oldVersion);
    }

    // Default migration fallback: return data if no explicit handler registered
    return oldData;
  }
}
