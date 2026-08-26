import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

// ---------------------------------------------------------------------------
// Common Sub-Schemas
// ---------------------------------------------------------------------------

export const PluginTrustLevelSchema = z.enum([
  'UNVERIFIED',
  'VERIFIED_PUBLISHER',
  'ENTERPRISE_INTERNAL',
]);

export const PluginManifestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  version: z.string().min(1, 'version is required').max(64),
  publisher: z.string().min(1, 'publisher is required').max(256),
  name: z.string().min(1, 'name is required').max(256),
  description: z.string().max(2048),
  requestedCapabilities: z.array(z.string().min(1).max(256)).max(100),
  outboundDomains: z.array(z.string().min(1).max(512)).max(100),
  trustLevel: PluginTrustLevelSchema,
});

export const PluginPackageSchema = z.object({
  manifest: PluginManifestSchema,
  packageHash: z.string().min(1, 'packageHash is required').max(256),
  signature: z.string().min(1, 'signature is required').max(1024),
  bundleContent: z.string().max(10 * 1024 * 1024),
});

export const PluginResourceLimitsSchema = z.object({
  maxConcurrentHosts: z.number().int().nonnegative().max(100).optional(),
  hostTimeoutMs: z.number().int().positive().max(300_000).optional(),
  maxCrashAttempts: z.number().int().positive().max(20).optional(),
});

// ---------------------------------------------------------------------------
// 1. plugin.verify
// ---------------------------------------------------------------------------

export const PluginVerifyPackageIPCRequestSchema = z.object({
  pkg: PluginPackageSchema,
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  limits: PluginResourceLimitsSchema.optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginVerifyPackageIPCRequest = z.infer<typeof PluginVerifyPackageIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 2. plugin.install
// ---------------------------------------------------------------------------

export const PluginInstallIPCRequestSchema = z.object({
  pkg: PluginPackageSchema,
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  limits: PluginResourceLimitsSchema.optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginInstallIPCRequest = z.infer<typeof PluginInstallIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 3. plugin.activate
// ---------------------------------------------------------------------------

export const PluginActivateIPCRequestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  limits: PluginResourceLimitsSchema.optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginActivateIPCRequest = z.infer<typeof PluginActivateIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 4. plugin.invoke
// ---------------------------------------------------------------------------

export const PluginInvokeIPCRequestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  capability: z.string().min(1, 'capability is required').max(256),
  action: z.string().min(1, 'action is required').max(256),
  payload: z.record(z.unknown()).default({}),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  limits: PluginResourceLimitsSchema.optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginInvokeIPCRequest = z.infer<typeof PluginInvokeIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 5. plugin.suspend
// ---------------------------------------------------------------------------

export const PluginSuspendIPCRequestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  limits: PluginResourceLimitsSchema.optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginSuspendIPCRequest = z.infer<typeof PluginSuspendIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 6. plugin.quarantine
// ---------------------------------------------------------------------------

export const PluginQuarantineIPCRequestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  reason: z.string().min(1, 'reason is required').max(2048),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  limits: PluginResourceLimitsSchema.optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginQuarantineIPCRequest = z.infer<typeof PluginQuarantineIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 7. plugin.listEntries
// ---------------------------------------------------------------------------

export const PluginListEntriesIPCRequestSchema = z.object({
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginListEntriesIPCRequest = z.infer<typeof PluginListEntriesIPCRequestSchema>;

// ---------------------------------------------------------------------------
// 8. plugin.listQuarantined
// ---------------------------------------------------------------------------

export const PluginListQuarantinedIPCRequestSchema = z.object({
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type PluginListQuarantinedIPCRequest = z.infer<typeof PluginListQuarantinedIPCRequestSchema>;
