import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VectorIndex,
  computeCosineSimilarity,
  computeDotProduct,
  computeEuclideanDistance,
} from '../../src/memory/vector-index.js';
import { InMemoryMemoryStore } from '../../src/memory/memory-store.js';
import { MemoryService } from '../../src/memory/memory-service.js';
import {
  VectorDimensionMismatchError,
  VectorIndexError,
  MemorySecurityViolationError,
} from '../../src/memory/types.js';
import { MemoryClass, MemorySensitivity, MemoryStatus, VectorEmbedding } from '@nexusos/contracts';

describe('In-Process Deterministic Vector Similarity Engine (services/backend/memory/vector-index)', () => {
  describe('Distance & Similarity Math Primitives', () => {
    it('computes exact cosine similarity for identical, orthogonal, and opposing vectors', () => {
      // Identical vectors: angle 0, cos = 1.0, similarity = 1.0, distance = 0.0
      const ident = computeCosineSimilarity([1, 0, 0], [1, 0, 0]);
      assert.equal(ident.similarity, 1.0);
      assert.equal(ident.distance, 0.0);

      // Orthogonal vectors: angle 90 deg, cos = 0.0, similarity = 0.5, distance = 1.0
      const ortho = computeCosineSimilarity([1, 0], [0, 1]);
      assert.equal(ortho.similarity, 0.5);
      assert.equal(ortho.distance, 1.0);

      // Opposing vectors: angle 180 deg, cos = -1.0, similarity = 0.0, distance = 2.0
      const opp = computeCosineSimilarity([1, 0], [-1, 0]);
      assert.equal(opp.similarity, 0.0);
      assert.equal(opp.distance, 2.0);

      // Zero vector handling: returns similarity 0.0, distance 1.0 without dividing by zero or NaN
      const zero = computeCosineSimilarity([0, 0, 0], [1, 2, 3]);
      assert.equal(zero.similarity, 0.0);
      assert.equal(zero.distance, 1.0);
    });

    it('computes dot product correctly for normalized vectors', () => {
      const dp = computeDotProduct([0.6, 0.8], [0.6, 0.8]);
      assert.ok(Math.abs(dp.similarity - 1.0) < 1e-6);
      assert.ok(Math.abs(dp.distance - 0.0) < 1e-6);
    });

    it('computes euclidean distance and derived similarity monotonically', () => {
      const identical = computeEuclideanDistance([1, 2, 3], [1, 2, 3]);
      assert.equal(identical.distance, 0.0);
      assert.equal(identical.similarity, 1.0);

      const distant = computeEuclideanDistance([0, 0], [3, 4]); // distance 5
      assert.equal(distant.distance, 5.0);
      assert.equal(distant.similarity, 1 / 6);
    });
  });

  describe('VectorIndex Engine & Security Invariants', () => {
    let index: VectorIndex;

    beforeEach(() => {
      // Create a test index configured with dimension 4
      index = new VectorIndex({ dimensions: 4, maxVectorsPerWorkspace: 100 });
    });

    it('indexes vectors and performs deterministic ranking', async () => {
      index.upsert({
        id: 'v1',
        memoryRecordId: 'rec-1',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
      });

      index.upsert({
        id: 'v2',
        memoryRecordId: 'rec-2',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0.7071, 0.7071, 0.0, 0.0],
        dimensions: 4,
      });

      index.upsert({
        id: 'v3',
        memoryRecordId: 'rec-3',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0.0, 1.0, 0.0, 0.0],
        dimensions: 4,
      });

      const response = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [1.0, 0.0, 0.0, 0.0],
        topK: 10,
        metric: 'COSINE',
      });

      assert.equal(response.total, 3);
      assert.equal(response.items.length, 3);
      // rec-1 must be ranked first (identical direction)
      assert.equal(response.items[0].memoryRecordId, 'rec-1');
      assert.equal(response.items[0].score, 1.0);
      // rec-2 must be ranked second
      assert.equal(response.items[1].memoryRecordId, 'rec-2');
      // rec-3 must be ranked third
      assert.equal(response.items[2].memoryRecordId, 'rec-3');
    });

    it('performs deterministic stable tie-breaking on identical scores', async () => {
      // Insert 3 records with the EXACT same vector values
      index.upsert({
        id: 'v-b',
        memoryRecordId: 'rec-bravo',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0.5, 0.5, 0.5, 0.5],
        dimensions: 4,
      });
      index.upsert({
        id: 'v-c',
        memoryRecordId: 'rec-charlie',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0.5, 0.5, 0.5, 0.5],
        dimensions: 4,
      });
      index.upsert({
        id: 'v-a',
        memoryRecordId: 'rec-alpha',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0.5, 0.5, 0.5, 0.5],
        dimensions: 4,
      });

      const res = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [0.5, 0.5, 0.5, 0.5],
        topK: 5,
      });

      assert.equal(res.items.length, 3);
      // Scores are all identical (1.0). Stable secondary sort must be memoryRecordId ascending:
      assert.equal(res.items[0].memoryRecordId, 'rec-alpha');
      assert.equal(res.items[1].memoryRecordId, 'rec-bravo');
      assert.equal(res.items[2].memoryRecordId, 'rec-charlie');
    });

    it('enforces 062-SEC-01: strict tenant isolation', async () => {
      index.upsert({
        id: 'v-tenantA',
        memoryRecordId: 'rec-tenantA',
        tenantId: 'tenant-ALPHA',
        workspaceId: 'ws-shared',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
      });

      index.upsert({
        id: 'v-tenantB',
        memoryRecordId: 'rec-tenantB',
        tenantId: 'tenant-BETA',
        workspaceId: 'ws-shared',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
      });

      // Query from tenant-ALPHA must NEVER see tenant-BETA's vector
      const resAlpha = await index.search({
        tenantId: 'tenant-ALPHA',
        workspaceId: 'ws-shared',
        vector: [1.0, 0.0, 0.0, 0.0],
      });
      assert.equal(resAlpha.total, 1);
      assert.equal(resAlpha.items[0].memoryRecordId, 'rec-tenantA');

      // Query from tenant-BETA must NEVER see tenant-ALPHA's vector
      const resBeta = await index.search({
        tenantId: 'tenant-BETA',
        workspaceId: 'ws-shared',
        vector: [1.0, 0.0, 0.0, 0.0],
      });
      assert.equal(resBeta.total, 1);
      assert.equal(resBeta.items[0].memoryRecordId, 'rec-tenantB');
    });

    it('enforces 062-SEC-01: strict workspace isolation', async () => {
      index.upsert({
        id: 'v-ws1',
        memoryRecordId: 'rec-ws1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-DEV',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
      });

      index.upsert({
        id: 'v-ws2',
        memoryRecordId: 'rec-ws2',
        tenantId: 'tenant-1',
        workspaceId: 'ws-PROD',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
      });

      const res = await index.search({
        tenantId: 'tenant-1',
        workspaceId: 'ws-DEV',
        vector: [1.0, 0.0, 0.0, 0.0],
      });
      assert.equal(res.total, 1);
      assert.equal(res.items[0].memoryRecordId, 'rec-ws1');
    });

    it('enforces 062-SEC-06: sensitivity filtering BEFORE distance calculation and ranking', async () => {
      index.upsert({
        id: 'v-public',
        memoryRecordId: 'rec-public',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
        sensitivity: MemorySensitivity.PUBLIC,
      });

      index.upsert({
        id: 'v-confidential',
        memoryRecordId: 'rec-confidential',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
        sensitivity: MemorySensitivity.CONFIDENTIAL,
      });

      index.upsert({
        id: 'v-restricted',
        memoryRecordId: 'rec-restricted',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
        sensitivity: MemorySensitivity.RESTRICTED,
      });

      // Query with maxSensitivity = INTERNAL: confidential and restricted records are filtered out
      const resInternal = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [1.0, 0.0, 0.0, 0.0],
        maxSensitivity: MemorySensitivity.INTERNAL,
      });
      assert.equal(resInternal.total, 1);
      assert.equal(resInternal.items[0].memoryRecordId, 'rec-public');

      // Query with maxSensitivity = CONFIDENTIAL: public and confidential pass, restricted filtered
      const resConf = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [1.0, 0.0, 0.0, 0.0],
        maxSensitivity: MemorySensitivity.CONFIDENTIAL,
      });
      assert.equal(resConf.total, 2);
      assert.ok(resConf.items.some((i) => i.memoryRecordId === 'rec-public'));
      assert.ok(resConf.items.some((i) => i.memoryRecordId === 'rec-confidential'));
      assert.ok(!resConf.items.some((i) => i.memoryRecordId === 'rec-restricted'));
    });

    it('rejects dimension mismatch on upsert and search with VectorDimensionMismatchError', async () => {
      // Upsert with 3 values when index requires 4
      assert.throws(
        () =>
          index.upsert({
            id: 'v-bad',
            memoryRecordId: 'rec-bad',
            tenantId: 't1',
            workspaceId: 'w1',
            values: [1.0, 2.0, 3.0],
            dimensions: 3,
          }),
        VectorDimensionMismatchError,
      );

      // Search with 2 values when index requires 4
      await assert.rejects(
        () =>
          index.search({
            tenantId: 't1',
            workspaceId: 'w1',
            vector: [1.0, 2.0],
          }),
        VectorDimensionMismatchError,
      );
    });

    it('rejects upsert missing tenantId or memoryRecordId with VectorIndexError', () => {
      assert.throws(
        () =>
          index.upsert({
            id: 'v-no-tenant',
            memoryRecordId: 'rec-1',
            tenantId: '',
            workspaceId: 'w1',
            values: [1, 0, 0, 0],
            dimensions: 4,
          }),
        VectorIndexError,
      );

      assert.throws(
        () =>
          index.upsert({
            id: 'v-no-rec',
            memoryRecordId: '',
            tenantId: 't1',
            workspaceId: 'w1',
            values: [1, 0, 0, 0],
            dimensions: 4,
          }),
        VectorIndexError,
      );
    });

    it('handles empty index gracefully with SEMANTIC_DEGRADED fallback', async () => {
      const res = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [1.0, 0.0, 0.0, 0.0],
      });
      assert.equal(res.total, 0);
      assert.equal(res.items.length, 0);
      assert.equal(res.retrievalMode, 'SEMANTIC_DEGRADED');
    });

    it('falls back to SEMANTIC_DEGRADED when query vector is omitted', async () => {
      index.upsert({
        id: 'v1',
        memoryRecordId: 'rec-1',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
      });

      const res = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        query: 'nexusos memory',
      });
      assert.equal(res.total, 0);
      assert.equal(res.items.length, 0);
      assert.equal(res.retrievalMode, 'SEMANTIC_DEGRADED');
    });

    it('enforces bounded candidate and result processing (062-SEC-05)', async () => {
      // Upsert 25 records
      for (let i = 0; i < 25; i++) {
        index.upsert({
          id: `v-${i}`,
          memoryRecordId: `rec-${i}`,
          tenantId: 't1',
          workspaceId: 'w1',
          values: [0.1 * i, 0.2, 0.3, 0.4],
          dimensions: 4,
        });
      }

      const resTop5 = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [0.5, 0.2, 0.3, 0.4],
        topK: 5,
      });
      assert.equal(resTop5.items.length, 5);
      assert.equal(resTop5.total, 25);
    });

    it('supports delete, clear, and duplicate key upsert replacement', async () => {
      index.upsert({
        id: 'v1',
        memoryRecordId: 'rec-1',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1, 0, 0, 0],
        dimensions: 4,
      });
      assert.equal(index.size('t1', 'w1'), 1);

      // Upsert duplicate memoryRecordId replaces entry
      index.upsert({
        id: 'v1-updated',
        memoryRecordId: 'rec-1',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0, 1, 0, 0],
        dimensions: 4,
      });
      assert.equal(index.size('t1', 'w1'), 1);
      assert.deepEqual(index.get('rec-1', 't1', 'w1')?.values, [0, 1, 0, 0]);

      // Delete by memoryRecordId
      const deleted = index.delete('rec-1', 't1', 'w1');
      assert.equal(deleted, true);
      assert.equal(index.size('t1', 'w1'), 0);
      assert.equal(index.get('rec-1', 't1', 'w1'), null);

      // Clear partition
      index.upsert({
        id: 'v2',
        memoryRecordId: 'rec-2',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [0, 0, 1, 0],
        dimensions: 4,
      });
      index.clear('t1', 'w1');
      assert.equal(index.size('t1', 'w1'), 0);
    });

    it('verifies 062-SEC-07: vector search results are non-authoritative advisory projections', async () => {
      index.upsert({
        id: 'v-advisory',
        memoryRecordId: 'rec-advisory',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1, 0, 0, 0],
        dimensions: 4,
        metadata: {
          attemptedRole: 'SYSTEM_ROOT',
          attemptedLease: 'UNLIMITED_EXECUTION',
        },
      });

      const res = await index.search({
        tenantId: 't1',
        workspaceId: 'w1',
        vector: [1, 0, 0, 0],
      });

      const item = res.items[0];
      // Assert no execution authority or capability fields exist on item
      assert.equal((item as any).executionAuthority, undefined);
      assert.equal((item as any).leaseToken, undefined);
      assert.equal((item as any).capabilityGrant, undefined);
      assert.equal(item.memoryRecordId, 'rec-advisory');
    });
  });

  describe('Integration with InMemoryMemoryStore and MemoryService', () => {
    let store: InMemoryMemoryStore;
    let service: MemoryService;

    beforeEach(() => {
      store = new InMemoryMemoryStore({ vectorDimensions: 4 });
      service = new MemoryService({ store });
    });

    it('saves vector embeddings through MemoryStore and synchronizes to VectorIndex', async () => {
      const embedding: VectorEmbedding = {
        id: 'emb-1',
        memoryRecordId: 'mem-1',
        tenantId: 'tenant-test',
        workspaceId: 'ws-test',
        values: [0.5, 0.5, 0.5, 0.5],
        dimensions: 4,
        normalized: true,
        metric: 'COSINE',
        metadata: { source: 'test' },
        createdAt: new Date().toISOString(),
      };

      await store.saveVector(embedding);
      const retrieved = await store.getVector('mem-1', 'tenant-test', 'ws-test');
      assert.ok(retrieved);
      assert.equal(retrieved.id, 'emb-1');

      const searchRes = await store.searchVectors({
        tenantId: 'tenant-test',
        workspaceId: 'ws-test',
        vector: [0.5, 0.5, 0.5, 0.5],
      });
      assert.equal(searchRes.items.length, 1);
      assert.equal(searchRes.items[0].memoryRecordId, 'mem-1');
    });

    it('cascades tombstoning of memory records to remove vector embedding from VectorIndex', async () => {
      // 1. Create a memory record
      const record = await store.create({
        id: 'mem-tombstone-test',
        tenantId: 'tenant-test',
        workspaceId: 'ws-test',
        ownerId: 'user-1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: 'Protected architectural secret',
        confidence: 1.0,
        tags: ['secret'],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'user-1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 2. Save vector embedding for this record
      await store.saveVector({
        id: 'emb-tombstone',
        memoryRecordId: record.id,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        values: [1, 0, 0, 0],
        dimensions: 4,
        normalized: true,
        metric: 'COSINE',
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      // 3. Verify vector is searchable
      const beforeTombstone = await store.searchVectors({
        tenantId: 'tenant-test',
        workspaceId: 'ws-test',
        vector: [1, 0, 0, 0],
      });
      assert.equal(beforeTombstone.items.length, 1);

      // 4. Tombstone the memory record
      await store.tombstone(
        record.id,
        record.tenantId,
        record.workspaceId,
        new Date().toISOString(),
        1,
      );

      // 5. Verify vector is completely removed from index and store
      const afterTombstone = await store.searchVectors({
        tenantId: 'tenant-test',
        workspaceId: 'ws-test',
        vector: [1, 0, 0, 0],
      });
      assert.equal(afterTombstone.items.length, 0);

      const vectorInStore = await store.getVector(record.id, record.tenantId, record.workspaceId);
      assert.equal(vectorInStore, null);
    });

    it('enforces MemoryService context validation on searchVectors', async () => {
      const context = {
        tenantId: 'tenant-A',
        workspaceId: 'ws-A',
        principalId: 'agent-1',
      };

      // Mismatched tenant must be rejected
      await assert.rejects(
        () =>
          service.searchVectors(
            {
              tenantId: 'tenant-B',
              workspaceId: 'ws-A',
              vector: [1, 0, 0, 0],
            },
            context,
          ),
        MemorySecurityViolationError,
      );

      // Matching context succeeds
      const res = await service.searchVectors(
        {
          tenantId: 'tenant-A',
          workspaceId: 'ws-A',
          vector: [1, 0, 0, 0],
        },
        context,
      );
      assert.equal(res.retrievalMode, 'SEMANTIC_DEGRADED');
    });
  });
});
