import { z } from 'zod';
import {
  MemoryClassSchema,
  MemorySensitivitySchema,
  MemoryStatus,
  MemoryStatusSchema,
  RetrievalModeSchema,
  MemoryRecordSchema,
} from './base.js';

// ---------------------------------------------------------------------------
// 1. Vector Dimension Standards & Strategy
// ---------------------------------------------------------------------------

/**
 * Supported embedding dimensions across NexusOS model providers:
 * - 384: Compact / on-device models (e.g., all-MiniLM-L6-v2, bge-small-en-v1.5) [CANONICAL DEFAULT]
 * - 768: Mid-sized models (e.g., bge-base-en-v1.5, nomic-embed-text)
 * - 1536: High-dimensional models (e.g., OpenAI text-embedding-3-small, standard cloud embeddings)
 */
export const SUPPORTED_VECTOR_DIMENSIONS = [384, 768, 1536] as const;
export type SupportedVectorDimension = (typeof SUPPORTED_VECTOR_DIMENSIONS)[number];

export const DEFAULT_VECTOR_DIMENSION = 384;
export const MIN_VECTOR_DIMENSION = 2; // Allows lightweight test fixtures and 2D/3D projections
export const MAX_VECTOR_DIMENSION = 1536;

// ---------------------------------------------------------------------------
// 2. Distance Metrics
// ---------------------------------------------------------------------------

export const DistanceMetricSchema = z.enum(['COSINE', 'DOT', 'EUCLIDEAN']);
export type DistanceMetric = z.infer<typeof DistanceMetricSchema>;

// Helper schema for finite numbers (rejects NaN, Infinity, -Infinity)
const FiniteNumberSchema = z.number().refine((n) => Number.isFinite(n), {
  message: 'Vector elements must be finite numbers (NaN, Infinity, and -Infinity are forbidden)',
});

// ---------------------------------------------------------------------------
// 3. Canonical Vector Embedding Record
// ---------------------------------------------------------------------------

export const VectorEmbeddingSchema = z
  .object({
    id: z.string().min(1),
    memoryRecordId: z.string().min(1),
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    values: z.array(FiniteNumberSchema).min(MIN_VECTOR_DIMENSION).max(MAX_VECTOR_DIMENSION),
    dimensions: z.number().int().positive(),
    normalized: z.boolean().default(false),
    metric: DistanceMetricSchema.default('COSINE'),
    metadata: z.record(z.unknown()).default({}),
    createdAt: z.string().datetime(),
  })
  .refine((data) => data.values.length === data.dimensions, {
    message: 'Vector values length must match declared dimensions count',
    path: ['values'],
  });

export type VectorEmbedding = z.infer<typeof VectorEmbeddingSchema>;

// ---------------------------------------------------------------------------
// 4. Vector Search Request Contract
// ---------------------------------------------------------------------------

export const VectorSearchRequestSchema = z
  .object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    vector: z
      .array(FiniteNumberSchema)
      .min(MIN_VECTOR_DIMENSION)
      .max(MAX_VECTOR_DIMENSION)
      .optional(),
    query: z.string().min(1).optional(),
    topK: z.number().int().positive().max(50).default(10),
    minSimilarity: z.number().min(0).max(1).default(0.0),
    metric: DistanceMetricSchema.default('COSINE'),
    maxSensitivity: MemorySensitivitySchema.optional(),
    classes: z.array(MemoryClassSchema).optional(),
    status: z.array(MemoryStatusSchema).default([MemoryStatus.ACTIVE]),
    tags: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (data) =>
      data.vector !== undefined || (data.query !== undefined && data.query.trim().length > 0),
    {
      message: 'At least one of vector or query must be provided for vector search',
      path: ['vector'],
    },
  );

export type VectorSearchRequest = z.input<typeof VectorSearchRequestSchema>;
export type VectorSearchRequestOutput = z.infer<typeof VectorSearchRequestSchema>;

// ---------------------------------------------------------------------------
// 5. Vector Search Result Item & Response Contracts
// ---------------------------------------------------------------------------

export const VectorSearchResultItemSchema = z.object({
  memoryRecordId: z.string().min(1),
  score: z.number().min(0).max(1),
  distance: z.number().min(0),
  metric: DistanceMetricSchema,
  citationToken: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  record: MemoryRecordSchema.optional(),
});

export type VectorSearchResultItem = z.infer<typeof VectorSearchResultItemSchema>;

export const VectorSearchResponseSchema = z.object({
  items: z.array(VectorSearchResultItemSchema).max(100),
  total: z.number().int().nonnegative(),
  metric: DistanceMetricSchema,
  retrievalMode: RetrievalModeSchema,
  queryDimension: z.number().int().positive().optional(),
});

export type VectorSearchResponse = z.infer<typeof VectorSearchResponseSchema>;
