import type { AgentLifecycleState } from '../lifecycle/index.js';

export interface StateRecord<T = unknown> {
  key: string;
  version: string;
  updatedAt: string;
  data: T;
  checksum: string;
}

export interface EncryptedStateEnvelope {
  formatVersion: string;
  algorithm: 'AES-256-GCM';
  createdAt?: string;
  iv: string; // Base64 12-byte IV
  authTag: string; // Base64 16-byte Auth Tag
  hmac: string; // Base64 HMAC-SHA256 over ciphertext
  ciphertext: string; // Base64 ciphertext
}

export interface StateConfig {
  storageDir: string;
  stateFileName: string;
  lkgFileName: string;
  encryptionKey?: string;
  maxStorageSizeBytes: number;
  maxRecords: number;
  currentSchemaVersion: string;
}

export type MigrationHandler = (oldData: unknown, oldVersion: string) => unknown;

export interface StateManagerStatus {
  initialized: boolean;
  activePath: string;
  recordCount: number;
  totalSizeBytes: number;
  lastPersistedAt?: string;
  lkgBackupPresent: boolean;
  corruptedRecoveryCount: number;
}

export interface IEncryptedStateStore {
  saveRecord<T>(key: string, data: T, version?: string): Promise<void>;
  getRecord<T>(key: string): Promise<StateRecord<T> | null>;
  deleteRecord(key: string): Promise<boolean>;
  listKeys(): Promise<string[]>;
  flush(): Promise<void>;
  restoreLKG(): Promise<boolean>;
  clearAll(): Promise<void>;
}

export interface IStateManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): StateManagerStatus;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  registerMigration(targetVersion: string, handler: MigrationHandler): void;
}

export interface LocalAgentStateSnapshot {
  deviceId: string;
  tenantId: string;
  lifecycleState: AgentLifecycleState;
  controlPlaneConnected: boolean;
  registeredCapabilities: string[];
  registeredRuntimes: string[];
  lastHeartbeatAt?: string;
}
