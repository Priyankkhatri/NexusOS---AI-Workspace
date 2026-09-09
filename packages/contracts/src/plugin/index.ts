import { z } from 'zod';
import { TenantIdSchema } from '../identity/index.js';

// ---------------------------------------------------------------------------
// 1. Plugin Trust Level & Lifecycle State
// ---------------------------------------------------------------------------

export const PluginTrustLevelSchema = z.enum([
  'UNVERIFIED',
  'VERIFIED_PUBLISHER',
  'ENTERPRISE_INTERNAL',
]);
export type PluginTrustLevel = z.infer<typeof PluginTrustLevelSchema>;

export const PluginLifecycleStateSchema = z.enum([
  'DISCOVERED',
  'VERIFIED',
  'INSTALLED',
  'ACTIVATED',
  'SUSPENDED',
  'QUARANTINED',
]);
export type PluginLifecycleState = z.infer<typeof PluginLifecycleStateSchema>;

export const PluginOperationNameSchema = z.enum([
  'plugin:verify',
  'plugin:install',
  'plugin:activate',
  'plugin:invoke',
  'plugin:suspend',
  'plugin:quarantine',
]);
export type PluginOperationName = z.infer<typeof PluginOperationNameSchema>;

// ---------------------------------------------------------------------------
// 2. Canonical Plugin Manifest
// ---------------------------------------------------------------------------

export const PluginRiskTierSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type PluginRiskTier = z.infer<typeof PluginRiskTierSchema>;

export const PluginManifestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  version: z.string().min(1, 'version is required').max(64),
  publisher: z.string().min(1, 'publisher is required').max(256),
  name: z.string().min(1, 'name is required').max(256),
  description: z.string().max(2048).default(''),
  entrypoint: z.string().max(1024).optional(),
  minNexusOsVersion: z.string().max(64).optional(),
  maxNexusOsVersion: z.string().max(64).optional(),
  requestedCapabilities: z.array(z.string().min(1).max(256)).max(100).default([]),
  permissions: z.array(z.string().min(1).max(256)).max(100).optional().default([]),
  outboundDomains: z.array(z.string().min(1).max(512)).max(100).optional().default([]),
  trustLevel: PluginTrustLevelSchema.optional().default('UNVERIFIED'),
  riskTier: PluginRiskTierSchema.optional().default('MEDIUM'),
  configurationSchema: z.record(z.unknown()).optional(),
});
export interface PluginManifest {
  pluginId: string;
  version: string;
  publisher: string;
  name: string;
  description?: string;
  entrypoint?: string;
  minNexusOsVersion?: string;
  maxNexusOsVersion?: string;
  requestedCapabilities: string[];
  permissions?: string[];
  outboundDomains?: string[];
  trustLevel?: PluginTrustLevel;
  riskTier?: PluginRiskTier;
  configurationSchema?: Record<string, unknown>;
}
export type PluginManifestInput = z.input<typeof PluginManifestSchema>;

// ---------------------------------------------------------------------------
// 3. Plugin Package & Signature Integrity
// ---------------------------------------------------------------------------

export const PluginPackageSchema = z.object({
  manifest: PluginManifestSchema,
  packageHash: z.string().min(1, 'packageHash is required').max(256),
  signature: z.string().min(1, 'signature is required').max(1024),
  bundleContent: z.string().max(10 * 1024 * 1024),
});
export interface PluginPackage {
  manifest: PluginManifest;
  packageHash: string;
  signature: string;
  bundleContent: string;
}

// ---------------------------------------------------------------------------
// 4. Resource Governance Limits
// ---------------------------------------------------------------------------

export const PluginResourceLimitsSchema = z.object({
  /** Maximum concurrent sandboxed plugin hosts allowed (default: 5) */
  maxConcurrentHosts: z.number().int().nonnegative().max(100).default(5),
  /** Invocation timeout in ms (default: 30000ms) */
  hostTimeoutMs: z.number().int().positive().max(300_000).default(30_000),
  /** Maximum allowed crash count before auto-quarantine (default: 3) */
  maxCrashAttempts: z.number().int().positive().max(20).default(3),
});
export type PluginResourceLimits = z.infer<typeof PluginResourceLimitsSchema>;

export const DEFAULT_PLUGIN_RESOURCE_LIMITS: PluginResourceLimits = {
  maxConcurrentHosts: 5,
  hostTimeoutMs: 30_000,
  maxCrashAttempts: 3,
};

// ---------------------------------------------------------------------------
// 5. Plugin Invocation & Results
// ---------------------------------------------------------------------------

export const PluginInvocationRequestSchema = z.object({
  pluginId: z.string().min(1, 'pluginId is required').max(256),
  capability: z.string().min(1, 'capability is required').max(256),
  action: z.string().min(1, 'action is required').max(256),
  payload: z.record(z.unknown()).default({}),
  tenantId: TenantIdSchema.optional(),
  workspaceId: z.string().max(256).optional(),
});
export type PluginInvocationRequest = z.infer<typeof PluginInvocationRequestSchema>;

export const PluginOperationResultSchema = z.object({
  success: z.boolean(),
  operation: PluginOperationNameSchema,
  pluginId: z.string().optional(),
  data: z.unknown().optional(),
  evidenceId: z.string(),
  error: z
    .object({
      code: z.string(),
      category: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type PluginOperationResult<T = unknown> = Omit<
  z.infer<typeof PluginOperationResultSchema>,
  'data'
> & {
  data?: T;
};

// ---------------------------------------------------------------------------
// 6. Backend Projection & Catalog Contracts
// ---------------------------------------------------------------------------

export const PluginSummarySchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  version: z.string(),
  publisher: z.string(),
  state: PluginLifecycleStateSchema,
  trustLevel: PluginTrustLevelSchema,
  riskTier: PluginRiskTierSchema,
  requestedCapabilities: z.array(z.string()),
  installedAt: z.string(),
  updatedAt: z.string(),
  quarantineReason: z.string().optional(),
});
export type PluginSummary = z.infer<typeof PluginSummarySchema>;

export const PluginListResponseSchema = z.object({
  items: z.array(PluginSummarySchema),
  total: z.number().int().nonnegative(),
});
export type PluginListResponse = z.infer<typeof PluginListResponseSchema>;
