import {
  DistanceMetric,
  MemoryClass,
  MemorySensitivity,
  MemoryStatus,
  RetrievalMode,
  SENSITIVITY_HIERARCHY,
  DEFAULT_VECTOR_DIMENSION,
  VectorSearchRequest,
  VectorSearchRequestSchema,
  VectorSearchResultItem,
  VectorSearchResponse,
  VectorSearchResponseSchema,
} from '@nexusos/contracts';
import { VectorDimensionMismatchError, VectorIndexError } from './types.js';
import { Logger } from '../observability/logger.js';

export interface StoredVectorEntry {
  id: string;
  memoryRecordId: string;
  tenantId: string;
  workspaceId: string;
  values: number[];
  dimensions: number;
  normalized?: boolean;
  metric?: DistanceMetric;
  sensitivity?: MemorySensitivity;
  status?: MemoryStatus;
  classes?: MemoryClass[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface VectorIndexOptions {
  dimensions?: number;
  maxVectorsPerWorkspace?: number;
  logger?: Logger;
}

export interface IVectorIndex {
  getDimensions(): number;
  upsert(entry: StoredVectorEntry): void;
  get(memoryRecordId: string, tenantId: string, workspaceId: string): StoredVectorEntry | null;
  delete(memoryRecordId: string, tenantId: string, workspaceId: string): boolean;
  search(request: VectorSearchRequest): Promise<VectorSearchResponse>;
  clear(tenantId?: string, workspaceId?: string): void;
  size(tenantId?: string, workspaceId?: string): number;
}

// ---------------------------------------------------------------------------
// Deterministic Distance Calculation Primitives
// ---------------------------------------------------------------------------

export function computeCosineSimilarity(
  a: number[],
  b: number[],
): { similarity: number; distance: number } {
  let dot = 0.0;
  let normASq = 0.0;
  let normBSq = 0.0;

  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normASq += va * va;
    normBSq += vb * vb;
  }

  if (normASq === 0.0 || normBSq === 0.0) {
    return { similarity: 0.0, distance: 1.0 };
  }

  const normA = Math.sqrt(normASq);
  const normB = Math.sqrt(normBSq);
  const rawCos = dot / (normA * normB);
  const clampedCos = Math.max(-1.0, Math.min(1.0, rawCos));
  const similarity = Math.max(0.0, Math.min(1.0, (clampedCos + 1.0) / 2.0));
  const distance = Math.max(0.0, 1.0 - clampedCos);

  return { similarity, distance };
}

export function computeDotProduct(
  a: number[],
  b: number[],
): { similarity: number; distance: number } {
  let dot = 0.0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  const similarity = Math.max(0.0, Math.min(1.0, dot));
  const distance = Math.max(0.0, 1.0 - similarity);
  return { similarity, distance };
}

export function computeEuclideanDistance(
  a: number[],
  b: number[],
): { similarity: number; distance: number } {
  let sumSq = 0.0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumSq += diff * diff;
  }
  const distance = Math.sqrt(sumSq);
  const similarity = 1.0 / (1.0 + distance);
  return { similarity, distance };
}

/**
 * In-Process Deterministic Vector Similarity Index
 *
 * Security & Authority Invariants:
 * - 062-SEC-01: Strict tenant and workspace partition isolation.
 * - 062-SEC-05: Bounded candidate evaluation and hard-capped result slices (topK <= 50, limit <= 100).
 * - 062-SEC-06: Sensitivity filtering executed prior to similarity calculation and ranking.
 * - 062-SEC-07: Results are ADVISORY PROJECTIONS ONLY and never confer execution authority.
 */
export class VectorIndex implements IVectorIndex {
  private readonly dimensions: number;
  private readonly maxVectorsPerWorkspace: number;

  // Composite key: `${tenantId}:::${workspaceId}` -> Map<memoryRecordId, StoredVectorEntry>
  private readonly partitions = new Map<string, Map<string, StoredVectorEntry>>();

  constructor(options?: VectorIndexOptions) {
    this.dimensions = options?.dimensions ?? DEFAULT_VECTOR_DIMENSION;
    this.maxVectorsPerWorkspace = options?.maxVectorsPerWorkspace ?? 10_000;
    if (options?.logger) {
      options.logger.debug(`VectorIndex initialized with dimension ${this.dimensions}`);
    }
  }

  public getDimensions(): number {
    return this.dimensions;
  }

  private getPartitionKey(tenantId: string, workspaceId: string): string {
    return `${tenantId}:::${workspaceId}`;
  }

  private getPartition(
    tenantId: string,
    workspaceId: string,
    createIfMissing = false,
  ): Map<string, StoredVectorEntry> | undefined {
    const key = this.getPartitionKey(tenantId, workspaceId);
    let partition = this.partitions.get(key);
    if (!partition && createIfMissing) {
      partition = new Map<string, StoredVectorEntry>();
      this.partitions.set(key, partition);
    }
    return partition;
  }

  /**
   * Upsert a vector embedding into the partitioned index.
   * Enforces 062-SEC-01 (Partition scoping) and dimension validation.
   */
  public upsert(entry: StoredVectorEntry): void {
    if (!entry.tenantId || !entry.workspaceId) {
      throw new VectorIndexError(
        '062-SEC-01: tenantId and workspaceId are required for vector indexing',
      );
    }
    if (!entry.memoryRecordId) {
      throw new VectorIndexError('memoryRecordId is required for vector indexing');
    }
    if (entry.values.length !== this.dimensions) {
      throw new VectorDimensionMismatchError(this.dimensions, entry.values.length);
    }

    const partition = this.getPartition(entry.tenantId, entry.workspaceId, true)!;

    // Check workspace capacity to prevent heap exhaustion (062-SEC-05)
    if (!partition.has(entry.memoryRecordId) && partition.size >= this.maxVectorsPerWorkspace) {
      // Evict oldest entry (FIFO) to enforce bounded memory
      const firstKey = partition.keys().next().value;
      if (firstKey) {
        partition.delete(firstKey);
      }
    }

    partition.set(entry.memoryRecordId, {
      ...entry,
      dimensions: this.dimensions,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Retrieve a vector entry by memoryRecordId within a tenant/workspace partition.
   */
  public get(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): StoredVectorEntry | null {
    const partition = this.getPartition(tenantId, workspaceId);
    if (!partition) return null;
    return partition.get(memoryRecordId) ?? null;
  }

  /**
   * Delete a vector embedding by memoryRecordId.
   */
  public delete(memoryRecordId: string, tenantId: string, workspaceId: string): boolean {
    const partition = this.getPartition(tenantId, workspaceId);
    if (!partition) return false;
    return partition.delete(memoryRecordId);
  }

  /**
   * Perform deterministic vector similarity search.
   */
  public async search(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    const validated = VectorSearchRequestSchema.parse(request);

    // 062-SEC-01: Scope lookup strictly to caller's tenant and workspace partition
    const partition = this.getPartition(validated.tenantId, validated.workspaceId);

    // If query vector is provided, validate dimension matches index configuration immediately
    if (validated.vector && validated.vector.length !== this.dimensions) {
      throw new VectorDimensionMismatchError(this.dimensions, validated.vector.length);
    }

    // If query vector is absent (only text query provided) or partition is empty,
    // degrade gracefully to SEMANTIC_DEGRADED mode
    if (!validated.vector || !partition || partition.size === 0) {
      return VectorSearchResponseSchema.parse({
        items: [],
        total: 0,
        metric: validated.metric ?? 'COSINE',
        retrievalMode: 'SEMANTIC_DEGRADED' as RetrievalMode,
        queryDimension: this.dimensions,
      });
    }

    // 062-SEC-06: Determine sensitivity rank boundary
    const maxSensitivityRank = validated.maxSensitivity
      ? SENSITIVITY_HIERARCHY[validated.maxSensitivity]
      : SENSITIVITY_HIERARCHY[MemorySensitivity.RESTRICTED];

    const allowedStatuses = new Set(validated.status ?? [MemoryStatus.ACTIVE]);
    const allowedClasses = validated.classes ? new Set(validated.classes) : null;
    const requiredTags = validated.tags ? new Set(validated.tags) : null;
    const metric = validated.metric ?? 'COSINE';

    const scoredCandidates: VectorSearchResultItem[] = [];

    for (const entry of partition.values()) {
      // 1. Status filter
      if (entry.status && !allowedStatuses.has(entry.status)) {
        continue;
      }

      // 2. 062-SEC-06: Sensitivity filter BEFORE distance calculation
      const entrySensitivity = entry.sensitivity ?? MemorySensitivity.INTERNAL;
      const entrySensitivityRank = SENSITIVITY_HIERARCHY[entrySensitivity] ?? 1;
      if (entrySensitivityRank > maxSensitivityRank) {
        continue;
      }

      // 3. Class filter
      if (allowedClasses && entry.classes && entry.classes.length > 0) {
        const hasClass = entry.classes.some((c) => allowedClasses.has(c));
        if (!hasClass) continue;
      }

      // 4. Tag filter
      if (requiredTags && entry.tags) {
        const hasTag = entry.tags.some((t) => requiredTags.has(t));
        if (!hasTag) continue;
      }

      // 5. Metric distance and similarity computation
      let score = 0.0;
      let distance = 0.0;

      if (metric === 'COSINE') {
        const res = computeCosineSimilarity(validated.vector, entry.values);
        score = res.similarity;
        distance = res.distance;
      } else if (metric === 'DOT') {
        const res = computeDotProduct(validated.vector, entry.values);
        score = res.similarity;
        distance = res.distance;
      } else if (metric === 'EUCLIDEAN') {
        const res = computeEuclideanDistance(validated.vector, entry.values);
        score = res.similarity;
        distance = res.distance;
      }

      // Threshold filter
      if (score < validated.minSimilarity) {
        continue;
      }

      scoredCandidates.push({
        memoryRecordId: entry.memoryRecordId,
        score,
        distance,
        metric,
        citationToken: `CIT-${entry.memoryRecordId.slice(0, 8)}`,
        metadata: entry.metadata ?? {},
      });
    }

    // 062-SEC-05: Deterministic ranking with stable tie-breaking
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score; // Primary: descending by similarity score
      }
      // Stable secondary tie-break: ascending by memoryRecordId
      return a.memoryRecordId.localeCompare(b.memoryRecordId);
    });

    const total = scoredCandidates.length;
    // Enforce hard upper bound of 100 items (062-SEC-05)
    const limitedItems = scoredCandidates.slice(0, Math.min(validated.topK, 100));

    return VectorSearchResponseSchema.parse({
      items: limitedItems,
      total,
      metric,
      retrievalMode: 'HYBRID' as RetrievalMode,
      queryDimension: this.dimensions,
    });
  }

  /**
   * Clear vectors. If tenantId and workspaceId are provided, clears that partition;
   * otherwise clears the entire index.
   */
  public clear(tenantId?: string, workspaceId?: string): void {
    if (tenantId && workspaceId) {
      const key = this.getPartitionKey(tenantId, workspaceId);
      this.partitions.delete(key);
    } else {
      this.partitions.clear();
    }
  }

  /**
   * Return count of stored vectors in a partition or across the entire index.
   */
  public size(tenantId?: string, workspaceId?: string): number {
    if (tenantId && workspaceId) {
      const partition = this.getPartition(tenantId, workspaceId);
      return partition ? partition.size : 0;
    }
    let total = 0;
    for (const partition of this.partitions.values()) {
      total += partition.size;
    }
    return total;
  }
}
