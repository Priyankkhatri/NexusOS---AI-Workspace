import { z } from 'zod';
import { ConfigLayer, ConfigurationSnapshot, SecurityBaselines } from './types.js';

/**
 * Immutable Security Baselines — Cannot be overridden or weakened by any config layer
 */
export const DEFAULT_SECURITY_BASELINES: SecurityBaselines = Object.freeze({
  policyDenyRulesEnabled: true,
  leaseValidationEnabled: true,
  capabilityEnforcementEnabled: true,
  filesystemPathSecurityEnabled: true,
  ssrfDomainSecurityEnabled: true,
  secretRedactionEnabled: true,
  pluginIsolationEnabled: true,
  terminalSecurityEnabled: true,
  sandboxIsolationEnabled: true,
  authenticationRequired: true,
});

/**
 * Hard Architectural Resource Ceilings — User/Release/Enterprise config cannot exceed these
 */
export const HARD_RESOURCE_CEILINGS = Object.freeze({
  maxProcessTimeoutMs: 300_000, // 5 min
  maxTerminalOutputBytes: 10_485_760, // 10 MB
  maxPluginConcurrentHosts: 8,
  maxBrowserSessions: 5,
  maxFileByteSize: 104_857_600, // 100 MB
  maxConcurrentLeases: 10,
  minHeartbeatIntervalMs: 1_000,
  maxHeartbeatIntervalMs: 60_000,
});

export const SecurityBaselinesSchema = z.object({
  policyDenyRulesEnabled: z.literal(true),
  leaseValidationEnabled: z.literal(true),
  capabilityEnforcementEnabled: z.literal(true),
  filesystemPathSecurityEnabled: z.literal(true),
  ssrfDomainSecurityEnabled: z.literal(true),
  secretRedactionEnabled: z.literal(true),
  pluginIsolationEnabled: z.literal(true),
  terminalSecurityEnabled: z.literal(true),
  sandboxIsolationEnabled: z.literal(true),
  authenticationRequired: z.literal(true),
});

export const ResourceBudgetsSchema = z.object({
  processTimeoutMs: z.number().int().min(1000).default(60_000),
  terminalMaxOutputBytes: z.number().int().min(1024).default(1_048_576),
  pluginMaxConcurrentHosts: z.number().int().min(1).default(4),
  browserMaxSessions: z.number().int().min(1).default(3),
  fileMaxByteSize: z.number().int().min(1024).default(52_428_800),
  maxConcurrentLeases: z.number().int().min(1).default(3),
  heartbeatIntervalMs: z
    .number()
    .int()
    .min(HARD_RESOURCE_CEILINGS.minHeartbeatIntervalMs)
    .max(HARD_RESOURCE_CEILINGS.maxHeartbeatIntervalMs)
    .default(10_000),
});

export const FeatureFlagsSchema = z.object({
  enableExperimentalRuntimes: z.boolean().default(false),
  enableTelemetrySpooling: z.boolean().default(true),
  enableDiagnosticBundleExport: z.boolean().default(true),
  enableLocalCaching: z.boolean().default(true),
});

export const CoreSettingsSchema = z.object({
  deviceId: z.string().uuid().default('00000000-0000-0000-0000-000000000000'),
  agentVersion: z.string().default('0.1.0-sprint0'),
  controlPlaneUrl: z.string().url().default('https://device-gateway.nexusos.internal'),
  environment: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  stateStoragePath: z.string().default('.nexusos/agent-state.json'),
});

export const ConfigurationSnapshotSchema = z.object({
  version: z.string().default('1.0.0'),
  revision: z.number().int().min(1).default(1),
  layer: z.nativeEnum(ConfigLayer).default(ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS),
  settings: CoreSettingsSchema,
  resourceBudgets: ResourceBudgetsSchema,
  securityBaselines: SecurityBaselinesSchema,
  featureFlags: FeatureFlagsSchema,
  customPreferences: z.record(z.unknown()).optional(),
  hash: z.string().default('shipped_default_hash'),
  updatedAt: z.string().datetime().default('1970-01-01T00:00:00.000Z'),
});

export const SignedConfigEnvelopeSchema = z.object({
  payload: z.record(z.unknown()),
  layer: z.nativeEnum(ConfigLayer),
  revision: z.number().int().min(1),
  signature: z.string().min(1),
  authorityKeyId: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const IMMUTABLE_SHIPPED_SNAPSHOT: ConfigurationSnapshot = Object.freeze({
  version: '1.0.0',
  revision: 1,
  layer: ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS,
  settings: {
    deviceId: '00000000-0000-0000-0000-000000000000',
    agentVersion: '0.1.0-sprint0',
    controlPlaneUrl: 'https://device-gateway.nexusos.internal',
    environment: 'development' as const,
    logLevel: 'info' as const,
    stateStoragePath: '.nexusos/agent-state.json',
  },
  resourceBudgets: {
    processTimeoutMs: 60_000,
    terminalMaxOutputBytes: 1_048_576,
    pluginMaxConcurrentHosts: 4,
    browserMaxSessions: 3,
    fileMaxByteSize: 52_428_800,
    maxConcurrentLeases: 3,
    heartbeatIntervalMs: 10_000,
  },
  securityBaselines: DEFAULT_SECURITY_BASELINES,
  featureFlags: {
    enableExperimentalRuntimes: false,
    enableTelemetrySpooling: true,
    enableDiagnosticBundleExport: true,
    enableLocalCaching: true,
  },
  hash: 'shipped_default_hash_000000000000',
  updatedAt: '1970-01-01T00:00:00.000Z',
});

export const ConfigGetActiveRequestSchema = z.object({
  tenantId: z.string().optional(),
});

export const ConfigApplyUpdateRequestSchema = z.object({
  layer: z.nativeEnum(ConfigLayer),
  update: z.record(z.unknown()),
  tenantId: z.string().optional(),
});

export const ConfigRollbackRequestSchema = z.object({
  targetRevision: z.number().int().optional(),
  tenantId: z.string().optional(),
});
