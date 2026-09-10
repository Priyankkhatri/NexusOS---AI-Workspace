import { z } from 'zod';
import {
  MemoryProvenanceSchema,
  MemorySensitivity,
  MemorySensitivitySchema,
  MemorySourceTypeSchema,
  SENSITIVITY_HIERARCHY,
} from './base.js';

// ---------------------------------------------------------------------------
// 1. Lossiness Classification & Compression Strategies
// ---------------------------------------------------------------------------

export enum LossinessClass {
  LOSSLESS = 'LOSSLESS',
  BOUNDED_LOSSY = 'BOUNDED_LOSSY',
  HIGH_LOSSY = 'HIGH_LOSSY',
}

export const LossinessClassSchema = z.nativeEnum(LossinessClass);

export enum CompressionStrategy {
  EXTRACTIVE = 'EXTRACTIVE',
  ABSTRACTIVE = 'ABSTRACTIVE',
  HIERARCHICAL_SUMMARIZATION = 'HIERARCHICAL_SUMMARIZATION',
}

export const CompressionStrategySchema = z.nativeEnum(CompressionStrategy);

// ---------------------------------------------------------------------------
// 2. Citation & Attribution Contracts (058-SEC-02)
// ---------------------------------------------------------------------------

export const MemoryCitationSchema = z.object({
  memoryId: z.string().min(1),
  citationToken: z.string().min(1),
  sourceType: MemorySourceTypeSchema,
  sourceId: z.string().optional(),
  sensitivity: MemorySensitivitySchema,
  snippet: z.string().max(1024).optional(),
  sourceHash: z.string().optional(),
});

export type MemoryCitation = z.infer<typeof MemoryCitationSchema>;

// ---------------------------------------------------------------------------
// 3. Compression Request & Response Contracts
// ---------------------------------------------------------------------------

export const MemoryCompressionRequestSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceMemoryIds: z.array(z.string().min(1)).min(1, 'At least one source memory ID is required'),
  strategy: CompressionStrategySchema.default(CompressionStrategy.EXTRACTIVE),
  maxTokens: z.number().int().positive().max(8000).default(500),
  targetLossiness: LossinessClassSchema.optional(),
  preservationDirectives: z.array(z.string()).default([]),
});

export type MemoryCompressionRequest = z.input<typeof MemoryCompressionRequestSchema>;
export type MemoryCompressionRequestOutput = z.infer<typeof MemoryCompressionRequestSchema>;

export const MemoryCompressionResponseSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  summaryContent: z.string().min(1),
  strategy: CompressionStrategySchema,
  lossinessClass: LossinessClassSchema,
  sourceMemoryIds: z.array(z.string().min(1)).min(1),
  citations: z.array(MemoryCitationSchema).min(1),
  inheritedSensitivity: MemorySensitivitySchema,
  originalTokenEstimate: z.number().int().nonnegative(),
  compressedTokenEstimate: z.number().int().nonnegative(),
  compressionRatio: z.number().min(0),
  preservedClaims: z.array(z.string()).default([]),
  provenance: MemoryProvenanceSchema,
  createdAt: z.string().datetime(),
});

export type MemoryCompressionResponse = z.infer<typeof MemoryCompressionResponseSchema>;

// ---------------------------------------------------------------------------
// 4. Sensitivity Inheritance Helper (058-SEC-04)
// ---------------------------------------------------------------------------

/**
 * Calculates the highest sensitivity level from a set of sensitivities.
 * 058-SEC-04: A derived/compressed record inherits the highest sensitivity
 * of ALL constituent source memories (PUBLIC < INTERNAL < CONFIDENTIAL < RESTRICTED).
 */
export function inheritHighestSensitivity(sensitivities: MemorySensitivity[]): MemorySensitivity {
  if (!sensitivities || sensitivities.length === 0) {
    return MemorySensitivity.INTERNAL;
  }

  let highest = MemorySensitivity.PUBLIC;
  let maxRank = -1;

  for (const s of sensitivities) {
    const rank = SENSITIVITY_HIERARCHY[s] ?? 1;
    if (rank > maxRank) {
      maxRank = rank;
      highest = s;
    }
  }

  return highest;
}
