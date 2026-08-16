import fs from 'node:fs';
import path from 'node:path';
import { PathSecurityService } from '../runtimes/filesystem/path-security.js';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { StateCryptoVault } from './crypto-vault.js';
import { StateRecordSchema } from './schemas.js';
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
    if (!key || typeof key !== 'string') {
      throw new Error('Record key must be a valid non-empty string.');
    }

    if (this.records.size >= this.config.maxRecords && !this.records.has(key)) {
      throw new Error(
        `Storage limit exceeded: maximum allowed record count of ${this.config.maxRecords} reached.`,
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
      const lkgRaw = fs.readFileSync(this.lkgFilePath, 'utf-8');
      const envelope = JSON.parse(lkgRaw);
      const decryptedJson = this.vault.decrypt(envelope);
      const rawRecords: StateRecord<unknown>[] = JSON.parse(decryptedJson);

      this.records.clear();
      for (const rec of rawRecords) {
        const parseResult = StateRecordSchema.safeParse(rec);
        if (parseResult.success) {
          this.records.set(rec.key, rec);
        }
      }

      this.corruptedRecoveryCount++;
      await this.flush(); // Persist restored LKG as current primary state
      return true;
    } catch {
      return false;
    }
  }

  public async flush(): Promise<void> {
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

    // 3. Create LKG backup of existing valid primary file
    if (fs.existsSync(this.primaryFilePath)) {
      try {
        fs.copyFileSync(this.primaryFilePath, this.lkgFilePath);
      } catch {
        // Suppress backup copy error
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
      const rawText = fs.readFileSync(this.primaryFilePath, 'utf-8');
      const envelope = JSON.parse(rawText);
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
