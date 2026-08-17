import fs from 'node:fs';
import path from 'node:path';
import { PathSecurityService } from '../runtimes/filesystem/path-security.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { StateCryptoVault } from './crypto-vault.js';
import { EncryptedStateEnvelopeSchema, StateRecordSchema } from './schemas.js';
import { IEncryptedStateStore, StateConfig, StateRecord } from './types.js';

export class EncryptedStateStore implements IEncryptedStateStore {
  private readonly records = new Map<string, StateRecord<unknown>>();
  private readonly pathSecurity: PathSecurityService;
  private readonly redactionFilter: RedactionFilter;
  private primaryFilePath: string = '';
  private lkgFilePath: string = '';
  private tmpFilePath: string = '';
  private isLoaded = false;
  private corruptedRecoveryCount = 0;
  private activeFlushPromise: Promise<void> | null = null;

  constructor(
    private readonly config: StateConfig,
    private readonly vault: StateCryptoVault,
    pathSecurity?: PathSecurityService,
    redactionFilter?: RedactionFilter,
  ) {
    this.pathSecurity = pathSecurity || new PathSecurityService();
    this.redactionFilter = redactionFilter || new RedactionFilter();

    this.resolvePaths();
  }

  public getCorruptedRecoveryCount(): number {
    return this.corruptedRecoveryCount;
  }

  public getRecordCount(): number {
    return this.records.size;
  }

  public getPrimaryPath(): string {
    return this.primaryFilePath;
  }

  public async saveRecord<T>(key: string, data: T, version = '1.0.0'): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim().length === 0 || key.length > 256) {
      throw new Error('Record key must be a non-empty string under 256 characters.');
    }

    if (key.includes('\0')) {
      throw new Error('Null bytes in record key are strictly prohibited.');
    }

    if (this.records.size >= this.config.maxRecords && !this.records.has(key)) {
      throw new Error(
        `Storage limit exceeded: maximum allowed record count of ${this.config.maxRecords} reached.`,
      );
    }

    // Quick size bound check before redacting/allocating memory
    const estimatedSize = Buffer.byteLength(JSON.stringify(data || ''), 'utf-8');
    if (estimatedSize > this.config.maxStorageSizeBytes) {
      throw new Error(
        `Storage size bounds exceeded: state size exceeds limit of ${this.config.maxStorageSizeBytes} bytes.`,
      );
    }

    // Redact sensitive values before payload checksum computation & storage
    const sanitizedData = this.redactionFilter.redactObject(data) as T;
    const checksum = this.vault.computeChecksum(sanitizedData);

    const record: StateRecord<T> = {
      key,
      version,
      updatedAt: new Date().toISOString(),
      data: sanitizedData,
      checksum,
    };

    // Validate record against Zod schema
    const parseResult = StateRecordSchema.safeParse(record);
    if (!parseResult.success) {
      throw new Error(`Invalid state record schema for key '${key}': ${parseResult.error.message}`);
    }

    this.records.set(key, record as StateRecord<unknown>);
    await this.flush();
  }

  public async getRecord<T>(key: string): Promise<StateRecord<T> | null> {
    if (!this.isLoaded) {
      await this.loadFromDisk();
    }
    const record = this.records.get(key);
    if (!record) return null;

    // Verify record integrity
    const computedChecksum = this.vault.computeChecksum(record.data);
    if (record.checksum !== computedChecksum) {
      throw new Error(
        `Integrity verification failed for record key '${key}': checksum mismatch on disk.`,
      );
    }

    return record as StateRecord<T>;
  }

  public async deleteRecord(key: string): Promise<boolean> {
    if (!this.records.has(key)) return false;
    this.records.delete(key);
    await this.flush();
    return true;
  }

  public async listKeys(): Promise<string[]> {
    if (!this.isLoaded) {
      await this.loadFromDisk();
    }
    return Array.from(this.records.keys());
  }

  public async clearAll(): Promise<void> {
    this.records.clear();
    await this.flush();
  }

  public async restoreLKG(): Promise<boolean> {
    if (!fs.existsSync(this.lkgFilePath)) {
      return false;
    }

    try {
      this.validatePathConfinement(this.lkgFilePath);
      const lkgRaw = fs.readFileSync(this.lkgFilePath, 'utf-8');
      const envelopeParse = EncryptedStateEnvelopeSchema.safeParse(JSON.parse(lkgRaw));
      if (!envelopeParse.success) {
        return false;
      }

      const decryptedJson = this.vault.decrypt(envelopeParse.data);
      const rawRecords: unknown = JSON.parse(decryptedJson);

      if (!Array.isArray(rawRecords)) {
        return false;
      }

      this.records.clear();
      for (const rec of rawRecords) {
        const parseResult = StateRecordSchema.safeParse(rec);
        if (parseResult.success) {
          const validRecord = parseResult.data as StateRecord<unknown>;
          const computedChecksum = this.vault.computeChecksum(validRecord.data);
          if (validRecord.checksum === computedChecksum) {
            this.records.set(validRecord.key, validRecord);
          }
        }
      }

      this.corruptedRecoveryCount++;
      await this.flushInternal(); // Persist restored LKG as current primary state
      return true;
    } catch {
      return false;
    }
  }

  public async flush(): Promise<void> {
    // Serialization lock to prevent race conditions on atomic write
    while (this.activeFlushPromise) {
      await this.activeFlushPromise;
    }

    this.activeFlushPromise = this.flushInternal().finally(() => {
      this.activeFlushPromise = null;
    });

    return this.activeFlushPromise;
  }

  private async flushInternal(): Promise<void> {
    const rawRecords = Array.from(this.records.values());
    const jsonStr = JSON.stringify(rawRecords);

    if (Buffer.byteLength(jsonStr, 'utf-8') > this.config.maxStorageSizeBytes) {
      throw new Error(
        `Storage size bounds exceeded: state size exceeds limit of ${this.config.maxStorageSizeBytes} bytes.`,
      );
    }

    const envelope = this.vault.encrypt(jsonStr);
    const envelopeJson = JSON.stringify(envelope, null, 2);

    // 1. Path confinement security validation before write
    this.validatePathConfinement(this.tmpFilePath);
    this.validatePathConfinement(this.primaryFilePath);

    // 2. Ensure parent directory exists with 0o700 permissions
    const parentDir = path.dirname(this.primaryFilePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    }

    // 3. Create LKG backup of existing primary file ONLY if valid
    if (fs.existsSync(this.primaryFilePath)) {
      try {
        const existingRaw = fs.readFileSync(this.primaryFilePath, 'utf-8');
        const envelopeParse = EncryptedStateEnvelopeSchema.safeParse(JSON.parse(existingRaw));
        if (envelopeParse.success) {
          this.vault.decrypt(envelopeParse.data); // Test decrypt & HMAC
          fs.copyFileSync(this.primaryFilePath, this.lkgFilePath);
        }
      } catch {
        // Primary file corrupted or tampered: DO NOT overwrite LKG backup!
      }
    }

    // 4. Atomic write pattern: Write to .tmp file, then atomic rename to primary
    fs.writeFileSync(this.tmpFilePath, envelopeJson, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(this.tmpFilePath, this.primaryFilePath);
    this.isLoaded = true;
  }

  public async loadFromDisk(): Promise<void> {
    this.isLoaded = true;

    // Clean up stale interrupted write file if present
    if (fs.existsSync(this.tmpFilePath)) {
      try {
        this.validatePathConfinement(this.tmpFilePath);
        fs.unlinkSync(this.tmpFilePath);
      } catch {
        // Ignore unlink error
      }
    }

    if (!fs.existsSync(this.primaryFilePath)) {
      // Primary state file missing, check LKG backup
      const restored = await this.restoreLKG();
      if (!restored) {
        this.records.clear();
      }
      return;
    }

    try {
      this.validatePathConfinement(this.primaryFilePath);

      // Stat file size on disk BEFORE reading into memory
      const stat = fs.statSync(this.primaryFilePath);
      if (stat.size > this.config.maxStorageSizeBytes * 2) {
        throw new Error(
          `Primary state file size (${stat.size} bytes) exceeds maximum storage bounds (${this.config.maxStorageSizeBytes * 2} bytes).`,
        );
      }

      const rawText = fs.readFileSync(this.primaryFilePath, 'utf-8');
      const envelope = EncryptedStateEnvelopeSchema.parse(JSON.parse(rawText));
      const decryptedJson = this.vault.decrypt(envelope);
      const rawRecords: unknown = JSON.parse(decryptedJson);

      if (!Array.isArray(rawRecords)) {
        throw new Error('Encrypted state payload is not a valid JSON array.');
      }

      this.records.clear();
      for (const rec of rawRecords) {
        const parseResult = StateRecordSchema.safeParse(rec);
        if (!parseResult.success) {
          throw new Error(`Corrupted state record detected: ${parseResult.error.message}`);
        }

        const validRecord = parseResult.data as StateRecord<unknown>;

        // Checksum verification
        const computedChecksum = this.vault.computeChecksum(validRecord.data);
        if (validRecord.checksum !== computedChecksum) {
          throw new Error(
            `Tampered state record detected for key '${validRecord.key}': checksum mismatch.`,
          );
        }

        this.records.set(validRecord.key, validRecord);
      }
    } catch (err) {
      // Primary file corrupted or tampered: fail closed or attempt LKG restore
      const restored = await this.restoreLKG();
      if (!restored) {
        this.records.clear();
        throw new Error(
          `Failed to load encrypted state from disk (primary corrupted, LKG unavailable): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private resolvePaths(): void {
    const resolvedDir = path.resolve(this.config.storageDir);
    this.primaryFilePath = path.join(resolvedDir, this.config.stateFileName);
    this.lkgFilePath = path.join(resolvedDir, this.config.lkgFileName);
    this.tmpFilePath = path.join(resolvedDir, `${this.config.stateFileName}.tmp`);

    // Immediate path confinement validation on initialization
    this.validatePathConfinement(this.primaryFilePath);
    this.validatePathConfinement(this.lkgFilePath);
    this.validatePathConfinement(this.tmpFilePath);
  }

  private validatePathConfinement(targetPath: string): void {
    const resolvedDir = path.resolve(this.config.storageDir);
    const result = this.pathSecurity.validatePath(targetPath, [resolvedDir]);
    if (!result.valid) {
      throw new Error(
        `Path traversal / scope escape detected for state path '${targetPath}': ${result.error?.message || 'Access denied'}`,
      );
    }
  }
}
