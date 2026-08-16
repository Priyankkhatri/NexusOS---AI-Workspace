import { z } from 'zod';

export const MemoryCacheConfigSchema = z.object({
  maxMemoryBytes: z
    .number()
    .int()
    .min(1024, 'maxMemoryBytes must be at least 1 KB')
    .max(524288000, 'maxMemoryBytes cannot exceed 500 MB')
    .default(52428800), // 50 MB default
  maxEntries: z
    .number()
    .int()
    .min(1, 'maxEntries must be at least 1')
    .max(100000, 'maxEntries cannot exceed 100,000')
    .default(1000),
  defaultTTLMs: z
    .number()
    .int()
    .min(10, 'defaultTTLMs must be at least 10 ms')
    .max(86400000, 'defaultTTLMs cannot exceed 24 hours')
    .default(900000), // 15 minutes default
  cleanupIntervalMs: z
    .number()
    .int()
    .min(1000, 'cleanupIntervalMs must be at least 1,000 ms')
    .max(3600000, 'cleanupIntervalMs cannot exceed 1 hour')
    .default(30000), // 30 seconds default
  maxEntrySizeBytes: z
    .number()
    .int()
    .min(100, 'maxEntrySizeBytes must be at least 100 bytes')
    .max(52428800, 'maxEntrySizeBytes cannot exceed 50 MB')
    .default(5242880), // 5 MB default
  memoryPressureThresholdRatio: z
    .number()
    .min(0.5, 'memoryPressureThresholdRatio must be at least 0.5')
    .max(0.95, 'memoryPressureThresholdRatio cannot exceed 0.95')
    .default(0.85),
});

export const MemoryCacheKeySchema = z
  .string()
  .min(1, 'Cache key cannot be empty')
  .max(256, 'Cache key length cannot exceed 256 characters')
  .refine((key) => !key.includes('\0'), 'Null bytes in cache key are strictly prohibited.');

export const MemoryCacheReadContextSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  workspaceId: z.string().min(1, 'workspaceId is required'),
  leaseId: z.string().optional(),
  policyHash: z.string().optional(),
});

export type MemoryCacheConfigZod = z.infer<typeof MemoryCacheConfigSchema>;
export type MemoryCacheReadContextZod = z.infer<typeof MemoryCacheReadContextSchema>;
