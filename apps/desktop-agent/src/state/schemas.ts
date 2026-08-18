import { z } from 'zod';
import { AgentLifecycleState } from '../lifecycle/index.js';

export const StateRecordSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(256)
    .refine((k) => !k.includes('\0'), 'Null bytes in record key prohibited'),
  version: z.string().min(1),
  updatedAt: z.string().datetime(),
  data: z.unknown(),
  checksum: z.string().length(64), // SHA-256 hex string
});

export const EncryptedStateEnvelopeSchema = z.object({
  formatVersion: z.literal('1.0.0'),
  algorithm: z.literal('AES-256-GCM'),
  createdAt: z.string().datetime().optional(),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  hmac: z.string().min(1),
  ciphertext: z.string().min(1),
});

const filenameRegex = /^[^/\\:*?"<>|]+$/;

export const StateConfigSchema = z.object({
  storageDir: z
    .string()
    .min(1)
    .refine((val) => !val.includes('\0'), 'Null bytes in storageDir prohibited')
    .default('.nexusos-state'),
  stateFileName: z
    .string()
    .min(1)
    .regex(
      filenameRegex,
      'stateFileName must be a single valid filename without slashes or path traversal',
    )
    .refine((val) => !val.includes('\0'), 'Null bytes in stateFileName prohibited')
    .default('agent-state.enc'),
  lkgFileName: z
    .string()
    .min(1)
    .regex(
      filenameRegex,
      'lkgFileName must be a single valid filename without slashes or path traversal',
    )
    .refine((val) => !val.includes('\0'), 'Null bytes in lkgFileName prohibited')
    .default('agent-state.lkg.enc'),
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

export const StateGetRecordRequestSchema = z.object({
  key: z.string().min(1),
  tenantId: z.string().optional(),
});

export const StateSetRecordRequestSchema = z.object({
  key: z.string().min(1),
  data: z.unknown(),
  version: z.string().optional(),
  tenantId: z.string().optional(),
});

export const StateDeleteRecordRequestSchema = z.object({
  key: z.string().min(1),
  tenantId: z.string().optional(),
});

export const StateGetStatusRequestSchema = z.object({
  tenantId: z.string().optional(),
});
