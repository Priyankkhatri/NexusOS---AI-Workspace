import { z } from 'zod';

export const HealthStateSchema = z.enum(['HEALTHY', 'DEGRADED', 'FAILED']);

export const ResourceUsageSchema = z.object({
  cpuUsagePercent: z.number().min(0).max(100),
  memoryUsedBytes: z.number().nonnegative(),
  memoryTotalBytes: z.number().nonnegative(),
  diskHeadroomBytes: z.number().nonnegative(),
});

export const HealthReportSchema = z.object({
  state: HealthStateSchema,
  agentId: z.string().uuid(),
  agentVersion: z.string(),
  configRevision: z.number().int().min(1),
  uptimeSeconds: z.number().nonnegative(),
  resourceUsage: ResourceUsageSchema,
  queueBacklog: z.number().int().nonnegative(),
  spoolBacklog: z.number().int().nonnegative(),
  policyFreshnessSec: z.number().int().nonnegative(),
  capabilityAvailability: z.record(z.boolean()),
  checkedAt: z.string().datetime(),
});

export const StepCheckpointSchema = z.object({
  stepId: z.string().min(1),
  taskId: z.string().min(1),
  runnerType: z.enum(['TERMINAL', 'BROWSER', 'FILESYSTEM', 'PLUGIN']),
  isIdempotent: z.boolean(),
  isAmbiguous: z.boolean(),
  status: z.enum(['COMPLETED', 'PAUSED', 'FAILED', 'IN_PROGRESS']),
  ownershipToken: z.string().min(1),
});

export const RecoveryManifestSchema = z.object({
  manifestId: z.string().uuid(),
  agentId: z.string().min(1),
  crashedAt: z.string().datetime(),
  exitCode: z.number().int().optional(),
  lastActiveLeaseId: z.string().optional(),
  activeStepCheckpoints: z.array(StepCheckpointSchema),
  manifestHash: z.string().min(1),
});
