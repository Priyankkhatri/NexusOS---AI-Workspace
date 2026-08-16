import { z } from 'zod';

import { AgentLifecycleState } from '../lifecycle/index.js';

export const StateRecordSchema = z.object({
  key: z.string().min(1).max(256),
  version: z.string().min(1),
  updatedAt: z.string().datetime(),
  data: z.unknown(),
  checksum: z.string().length(64), // SHA-256 hex string
});

export const EncryptedStateEnvelopeSchema = z.object({
  formatVersion: z.string().min(1),
  algorithm: z.literal('AES-256-GCM'),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  hmac: z.string().min(1),
  ciphertext: z.string().min(1),
});

export const StateConfigSchema = z.object({
  storageDir: z.string().min(1).default('.nexusos-state'),
  stateFileName: z.string().min(1).default('agent-state.enc'),
  lkgFileName: z.string().min(1).default('agent-state.lkg.enc'),
  encryptionKey: z.string().min(16).optional(),
  maxStorageSizeBytes: z.coerce.number().int().min(10).max(104857600).default(10485760), // 10MB default
  maxRecords: z.coerce.number().int().min(1).max(10000).default(1000),
  currentSchemaVersion: z.string().min(1).default('1.0.0'),
});

export const LocalAgentStateSnapshotSchema = z.object({
  deviceId: z.string().min(1),
  tenantId: z.string().min(1),
  lifecycleState: z.nativeEnum(AgentLifecycleState),
  controlPlaneConnected: z.boolean(),
  registeredCapabilities: z.array(z.string()),
  registeredRuntimes: z.array(z.string()),
  lastHeartbeatAt: z.string().datetime().optional(),
});

export type StateRecordZod = z.infer<typeof StateRecordSchema>;
export type EncryptedStateEnvelopeZod = z.infer<typeof EncryptedStateEnvelopeSchema>;
export type StateConfigZod = z.infer<typeof StateConfigSchema>;
