import { z } from 'zod';

export const UpdateChannelSchema = z.enum(['stable', 'beta', 'nightly', 'enterprise']);
export const UpdateStateSchema = z.enum([
  'IDLE',
  'CHECKING',
  'AVAILABLE',
  'DOWNLOADING',
  'DOWNLOADED',
  'VERIFYING',
  'STAGED',
  'ACTIVATING',
  'ACTIVATED',
  'FAILED',
  'ROLLED_BACK',
]);

export const UpdateManifestSchema = z.object({
  manifestId: z.string().uuid(),
  version: z.string().min(1),
  channel: UpdateChannelSchema,
  packageUrl: z.string().url(),
  sha256: z.string().length(64),
  signature: z.string().min(1),
  minimumOsVersion: z.string().optional(),
  releaseNotes: z.string().optional(),
  publishedAt: z.string().datetime(),
  minAntiRollbackVersion: z.string().min(1),
});

export const UpdateStatusSchema = z.object({
  state: UpdateStateSchema,
  currentVersion: z.string().min(1),
  targetVersion: z.string().optional(),
  channel: UpdateChannelSchema,
  lastCheckedAt: z.string().datetime().optional(),
  activePackageHash: z.string().optional(),
  rollbackAvailable: z.boolean(),
  errorReason: z.string().optional(),
});

export const CheckForUpdatesRequestSchema = z.object({
  customManifest: UpdateManifestSchema.optional(),
});

export const DownloadAndUpdateRequestSchema = z.object({
  manifest: UpdateManifestSchema,
  packageDataBase64: z.string().optional(),
});

export const StageAndActivateRequestSchema = z.object({
  healthCheckEnabled: z.boolean().optional(),
});
