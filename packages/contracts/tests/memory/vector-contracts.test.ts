import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DistanceMetricSchema,
  VectorEmbeddingSchema,
  VectorSearchRequestSchema,
  VectorSearchResultItemSchema,
  VectorSearchResponseSchema,
  SUPPORTED_VECTOR_DIMENSIONS,
  DEFAULT_VECTOR_DIMENSION,
  MIN_VECTOR_DIMENSION,
  MAX_VECTOR_DIMENSION,
  MemoryClass,
  MemorySensitivity,
  MemoryStatus,
} from '../../src/memory/index.js';

describe('Canonical Vector Contracts (@nexusos/contracts/memory/vector)', () => {
  describe('Dimension Constants & DistanceMetricSchema', () => {
    it('verifies standard dimension constants and canonical default', () => {
      assert.deepEqual(SUPPORTED_VECTOR_DIMENSIONS, [384, 768, 1536]);
      assert.equal(DEFAULT_VECTOR_DIMENSION, 384);
      assert.equal(MIN_VECTOR_DIMENSION, 2);
      assert.equal(MAX_VECTOR_DIMENSION, 1536);
    });

    it('validates supported distance metrics and rejects unsupported metrics', () => {
      assert.equal(DistanceMetricSchema.parse('COSINE'), 'COSINE');
      assert.equal(DistanceMetricSchema.parse('DOT'), 'DOT');
      assert.equal(DistanceMetricSchema.parse('EUCLIDEAN'), 'EUCLIDEAN');

      assert.throws(() => DistanceMetricSchema.parse('MANHATTAN'));
      assert.throws(() => DistanceMetricSchema.parse('HAMMING'));
      assert.throws(() => DistanceMetricSchema.parse(''));
    });
  });

  describe('VectorEmbeddingSchema', () => {
    it('validates a valid vector embedding with canonical defaults', () => {
      const valid = {
        id: 'emb-001',
        memoryRecordId: 'mem-100',
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        values: [0.1, 0.2, 0.3, 0.4],
        dimensions: 4,
        createdAt: new Date().toISOString(),
      };

      const parsed = VectorEmbeddingSchema.parse(valid);
      assert.equal(parsed.id, 'emb-001');
      assert.equal(parsed.dimensions, 4);
      assert.equal(parsed.normalized, false);
      assert.equal(parsed.metric, 'COSINE');
      assert.deepEqual(parsed.metadata, {});
    });

    it('validates vector embeddings with supported dimensions 384, 768, and 1536', () => {
      for (const dim of [384, 768, 1536]) {
        const values = new Array(dim).fill(0.01);
        const valid = {
          id: `emb-${dim}`,
          memoryRecordId: `mem-${dim}`,
          tenantId: 'tenant-test',
          workspaceId: 'workspace-test',
          values,
          dimensions: dim,
          normalized: true,
          metric: 'DOT' as const,
          createdAt: new Date().toISOString(),
        };
        const parsed = VectorEmbeddingSchema.parse(valid);
        assert.equal(parsed.dimensions, dim);
        assert.equal(parsed.values.length, dim);
      }
    });

    it('rejects vector embeddings with dimension mismatch between values.length and dimensions', () => {
      const invalid = {
        id: 'emb-mismatch',
        memoryRecordId: 'mem-100',
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        values: [0.1, 0.2, 0.3], // length 3
        dimensions: 4, // expected 4
        createdAt: new Date().toISOString(),
      };
      assert.throws(() => VectorEmbeddingSchema.parse(invalid), /values length must match/);
    });

    it('rejects NaN, Infinity, and -Infinity values in vector', () => {
      const base = {
        id: 'emb-adv',
        memoryRecordId: 'mem-100',
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        dimensions: 3,
        createdAt: new Date().toISOString(),
      };

      assert.throws(() => VectorEmbeddingSchema.parse({ ...base, values: [0.1, NaN, 0.3] }));
      assert.throws(() => VectorEmbeddingSchema.parse({ ...base, values: [0.1, Infinity, 0.3] }));
      assert.throws(() => VectorEmbeddingSchema.parse({ ...base, values: [0.1, -Infinity, 0.3] }));
    });

    it('rejects vectors with dimensions outside bounds [MIN_VECTOR_DIMENSION, MAX_VECTOR_DIMENSION]', () => {
      const tooShort = {
        id: 'emb-short',
        memoryRecordId: 'mem-100',
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        values: [1.0],
        dimensions: 1,
        createdAt: new Date().toISOString(),
      };
      assert.throws(() => VectorEmbeddingSchema.parse(tooShort));

      const tooLongValues = new Array(1537).fill(0.1);
      const tooLong = {
        id: 'emb-long',
        memoryRecordId: 'mem-100',
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        values: tooLongValues,
        dimensions: 1537,
        createdAt: new Date().toISOString(),
      };
      assert.throws(() => VectorEmbeddingSchema.parse(tooLong));
    });
  });

  describe('VectorSearchRequestSchema', () => {
    it('validates request with vector only and applies defaults', () => {
      const req = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        vector: [0.1, 0.2, 0.3, 0.4],
      };
      const parsed = VectorSearchRequestSchema.parse(req);
      assert.equal(parsed.topK, 10);
      assert.equal(parsed.minSimilarity, 0.0);
      assert.equal(parsed.metric, 'COSINE');
      assert.deepEqual(parsed.status, [MemoryStatus.ACTIVE]);
    });

    it('validates request with query text representation only', () => {
      const req = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        query: 'nexusos memory architecture',
      };
      const parsed = VectorSearchRequestSchema.parse(req);
      assert.equal(parsed.query, 'nexusos memory architecture');
      assert.equal(parsed.vector, undefined);
    });

    it('rejects request when neither vector nor query is provided', () => {
      const req = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
      };
      assert.throws(() => VectorSearchRequestSchema.parse(req), /At least one of vector or query/);
    });

    it('rejects empty whitespace query when vector is not provided', () => {
      const req = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        query: '   ',
      };
      assert.throws(() => VectorSearchRequestSchema.parse(req));
    });

    it('rejects topK <= 0 or topK > 50 (hard bounds)', () => {
      const base = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        query: 'search term',
      };

      assert.throws(() => VectorSearchRequestSchema.parse({ ...base, topK: 0 }));
      assert.throws(() => VectorSearchRequestSchema.parse({ ...base, topK: -5 }));
      assert.throws(() => VectorSearchRequestSchema.parse({ ...base, topK: 51 }));
      assert.equal(VectorSearchRequestSchema.parse({ ...base, topK: 50 }).topK, 50);
      assert.equal(VectorSearchRequestSchema.parse({ ...base, topK: 1 }).topK, 1);
    });

    it('rejects malformed vector elements with NaN or Infinity in query vector', () => {
      const reqWithNaN = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        vector: [0.5, NaN, 0.2],
      };
      assert.throws(() => VectorSearchRequestSchema.parse(reqWithNaN));

      const reqWithInf = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        vector: [0.5, Infinity, 0.2],
      };
      assert.throws(() => VectorSearchRequestSchema.parse(reqWithInf));
    });

    it('validates filtering parameters: maxSensitivity, classes, tags', () => {
      const req = {
        tenantId: 'tenant-test',
        workspaceId: 'workspace-test',
        query: 'test query',
        maxSensitivity: MemorySensitivity.INTERNAL,
        classes: [MemoryClass.SEMANTIC, MemoryClass.EPISODIC],
        tags: ['arch', 'vector'],
      };
      const parsed = VectorSearchRequestSchema.parse(req);
      assert.equal(parsed.maxSensitivity, MemorySensitivity.INTERNAL);
      assert.deepEqual(parsed.classes, [MemoryClass.SEMANTIC, MemoryClass.EPISODIC]);
      assert.deepEqual(parsed.tags, ['arch', 'vector']);
    });
  });

  describe('VectorSearchResultItemSchema & VectorSearchResponseSchema', () => {
    it('validates search result item and bounds score in [0, 1]', () => {
      const item = {
        memoryRecordId: 'mem-200',
        score: 0.94,
        distance: 0.06,
        metric: 'COSINE' as const,
        citationToken: 'CIT-mem-2000',
        metadata: { indexedAt: 12345 },
      };
      const parsed = VectorSearchResultItemSchema.parse(item);
      assert.equal(parsed.memoryRecordId, 'mem-200');
      assert.equal(parsed.score, 0.94);

      assert.throws(() => VectorSearchResultItemSchema.parse({ ...item, score: -0.1 }));
      assert.throws(() => VectorSearchResultItemSchema.parse({ ...item, score: 1.05 }));
      assert.throws(() => VectorSearchResultItemSchema.parse({ ...item, distance: -0.01 }));
    });

    it('validates search response schema with bounded items collection (max 100)', () => {
      const item = {
        memoryRecordId: 'mem-200',
        score: 0.85,
        distance: 0.15,
        metric: 'COSINE' as const,
        citationToken: 'CIT-mem-2000',
      };

      const resp = {
        items: [item],
        total: 1,
        metric: 'COSINE' as const,
        retrievalMode: 'HYBRID' as const,
        queryDimension: 384,
      };

      const parsed = VectorSearchResponseSchema.parse(resp);
      assert.equal(parsed.total, 1);
      assert.equal(parsed.retrievalMode, 'HYBRID');
      assert.equal(parsed.queryDimension, 384);

      // Verify max 100 items hard bound
      const oversizedItems = new Array(101).fill(item);
      assert.throws(() =>
        VectorSearchResponseSchema.parse({
          ...resp,
          items: oversizedItems,
        }),
      );
    });
  });
});
