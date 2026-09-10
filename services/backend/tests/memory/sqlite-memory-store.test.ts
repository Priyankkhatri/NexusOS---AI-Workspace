import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteMemoryStore } from '../../src/memory/sqlite-memory-store.js';
import {
  MemoryNotFoundError,
  MemoryVersionConflictError,
  VectorDimensionMismatchError,
} from '../../src/memory/types.js';
import {
  MemoryClass,
  MemorySensitivity,
  MemoryStatus,
  MemoryRecord,
  VectorEmbedding,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  MemorySourceType,
} from '@nexusos/contracts';

describe('Authoritative Disk-Backed SQLite Persistent Memory Store (Task 062 Phase 2)', () => {
  let tempDir: string;
  let dbFilePath: string;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-sqlite-test-'));
    dbFilePath = path.join(tempDir, 'memory.db');
    store = new SqliteMemoryStore({
      dbPath: dbFilePath,
      vectorDimensions: 4, // 4D vectors for isolated test speed
    });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Migrations, Startup & Reopen Durability', () => {
    it('initializes fresh database and applies schema migrations idempotently', () => {
      const db = store.getDatabase();
      const migrationRow = db
        .prepare('SELECT version, description FROM schema_migrations WHERE version = 1;')
        .get() as { version: number; description: string } | undefined;

      assert.ok(migrationRow);
      assert.equal(migrationRow.version, 1);
      assert.match(migrationRow.description, /Task 062/);

      // Re-running migration check is idempotent
      assert.doesNotThrow(() => {
        new SqliteMemoryStore({ dbPath: dbFilePath, vectorDimensions: 4 }).close();
      });
    });

    it('reopens existing database across process/store recreation and restores vector index', async () => {
      // 1. Ingest memory record in store 1
      const record: MemoryRecord = {
        id: 'mem-persistent-1',
        tenantId: 'tenant-acme',
        workspaceId: 'ws-prod',
        ownerId: 'agent-1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        title: 'Architecture Blueprint',
        content: 'NexusOS disk persistence with SQLite',
        confidence: 0.95,
        tags: ['arch', 'sqlite'],
        metadata: { env: 'production' },
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'user-admin',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(record);

      // 2. Persist vector embedding in store 1
      const vector: VectorEmbedding = {
        id: 'emb-persistent-1',
        memoryRecordId: record.id,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        values: [1.0, 0.0, 0.0, 0.0],
        dimensions: 4,
        normalized: true,
        metric: 'COSINE',
        metadata: { indexed: true },
        createdAt: new Date().toISOString(),
      };
      await store.saveVector(vector);

      // Close store 1
      store.close();

      // 3. Open store 2 pointing to the same file
      const store2 = new SqliteMemoryStore({ dbPath: dbFilePath, vectorDimensions: 4 });
      try {
        // Verify memory record restored
        const loaded = await store2.getById('mem-persistent-1', 'tenant-acme', 'ws-prod');
        assert.ok(loaded);
        assert.equal(loaded.content, 'NexusOS disk persistence with SQLite');
        assert.deepEqual(loaded.tags, ['arch', 'sqlite']);

        // Verify vector embedding restored and searchable in hydrated VectorIndex
        const loadedVec = await store2.getVector('mem-persistent-1', 'tenant-acme', 'ws-prod');
        assert.ok(loadedVec);
        assert.deepEqual(loadedVec.values, [1.0, 0.0, 0.0, 0.0]);

        const searchRes = await store2.searchVectors({
          tenantId: 'tenant-acme',
          workspaceId: 'ws-prod',
          vector: [1.0, 0.0, 0.0, 0.0],
        });
        assert.equal(searchRes.items.length, 1);
        assert.equal(searchRes.items[0].memoryRecordId, 'mem-persistent-1');
      } finally {
        store2.close();
      }
    });
  });

  describe('CRUD Operations & Version Monotonicity', () => {
    it('creates, reads, and updates memory record with monotonic version increment', async () => {
      const record: MemoryRecord = {
        id: 'mem-crud-1',
        tenantId: 't1',
        workspaceId: 'w1',
        ownerId: 'u1',
        class: MemoryClass.WORKING,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.PUBLIC,
        content: 'Initial state content',
        confidence: 0.9,
        tags: ['v1'],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const created = await store.create(record);
      assert.equal(created.version, 1);

      const read = await store.getById('mem-crud-1', 't1', 'w1');
      assert.ok(read);
      assert.equal(read.content, 'Initial state content');

      // Update with expectedVersion = 1 -> version becomes 2
      const updated = await store.update(
        'mem-crud-1',
        't1',
        'w1',
        { content: 'Updated state content' },
        1,
      );
      assert.equal(updated.version, 2);
      assert.equal(updated.content, 'Updated state content');

      // Update again with expectedVersion = 2 -> version becomes 3
      const updated2 = await store.update('mem-crud-1', 't1', 'w1', { confidence: 0.99 }, 2);
      assert.equal(updated2.version, 3);
      assert.equal(updated2.confidence, 0.99);
    });

    it('rejects stale-write update with MemoryVersionConflictError (056-SEC-06)', async () => {
      const record: MemoryRecord = {
        id: 'mem-conflict-1',
        tenantId: 't1',
        workspaceId: 'w1',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: 'Base content',
        confidence: 1.0,
        tags: [],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(record);

      // Attempt update with wrong expectedVersion (5 instead of 1)
      await assert.rejects(
        () => store.update('mem-conflict-1', 't1', 'w1', { content: 'Stale write' }, 5),
        MemoryVersionConflictError,
      );
    });
  });

  describe('Security Invariants & Multi-Tenant Partitioning (062-SEC-01, 062-SEC-02, 062-SEC-04)', () => {
    it('enforces 062-SEC-01: strict tenant and workspace isolation', async () => {
      const recA: MemoryRecord = {
        id: 'shared-id',
        tenantId: 'tenant-ALPHA',
        workspaceId: 'ws-shared',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: 'ALPHA secret data',
        confidence: 1.0,
        tags: ['alpha'],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(recA);

      // Query from tenant-BETA must return null
      const betaRead = await store.getById('shared-id', 'tenant-BETA', 'ws-shared');
      assert.equal(betaRead, null);

      // Search from tenant-BETA returns zero results
      const betaSearch = await store.search({
        tenantId: 'tenant-BETA',
        workspaceId: 'ws-shared',
      });
      assert.equal(betaSearch.total, 0);

      // Cross-tenant update must fail with MemoryNotFoundError
      await assert.rejects(
        () => store.update('shared-id', 'tenant-BETA', 'ws-shared', { content: 'tamper' }, 1),
        MemoryNotFoundError,
      );

      // Cross-tenant tombstone must fail with MemoryNotFoundError
      await assert.rejects(
        () => store.tombstone('shared-id', 'tenant-BETA', 'ws-shared', new Date().toISOString(), 1),
        MemoryNotFoundError,
      );
    });

    it('enforces 062-SEC-02: SQL injection resistance with adversarial malicious strings', async () => {
      const sqlInjectionPayload = "'; DROP TABLE memory_records; --";

      const record: MemoryRecord = {
        id: `inject-${Date.now()}`,
        tenantId: 'tenant-sec',
        workspaceId: 'ws-sec',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: `Searchable content with malicious suffix ${sqlInjectionPayload}`,
        confidence: 1.0,
        tags: [sqlInjectionPayload],
        metadata: { maliciousKey: sqlInjectionPayload },
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Safely inserted via parameterized query
      await store.create(record);

      // Search with SQL injection payload in query
      const searchRes = await store.search({
        tenantId: 'tenant-sec',
        workspaceId: 'ws-sec',
        query: sqlInjectionPayload,
      });
      assert.equal(searchRes.total, 1);

      // Verify table was NOT dropped
      const tableCheck = store
        .getDatabase()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_records';")
        .get();
      assert.ok(tableCheck);
    });

    it('enforces 062-SEC-04: secret sanitization before persistence', async () => {
      const secretPayload = 'Authorization: Bearer sk-live-secret-key-1234567890abcdef';

      const invalidRecord: MemoryRecord = {
        id: 'mem-secret-leak',
        tenantId: 't1',
        workspaceId: 'w1',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: secretPayload,
        confidence: 1.0,
        tags: [],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Attempting to persist plaintext secret must fail closed
      await assert.rejects(() => store.create(invalidRecord));

      // Attempting to update with plaintext secret must fail closed
      const cleanRecord: MemoryRecord = {
        ...invalidRecord,
        id: 'mem-clean',
        content: 'Clean initial content',
      };
      await store.create(cleanRecord);

      await assert.rejects(() =>
        store.update('mem-clean', 't1', 'w1', { content: secretPayload }, 1),
      );
    });
  });

  describe('Atomic Cascade Tombstoning & Transaction Rollback (062-SEC-03)', () => {
    it('executes atomic cascade tombstone: record tombstoned, vector removed, graph projections revoked', async () => {
      const record: MemoryRecord = {
        id: 'mem-cascade-target',
        tenantId: 't-casc',
        workspaceId: 'w-casc',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: 'Content that will be forgotten',
        confidence: 1.0,
        tags: ['target'],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(record);

      // 2. Attach vector embedding
      await store.saveVector({
        id: 'vec-target',
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

      // 3. Attach graph node & edge referencing memory record
      await store.saveGraphNode({
        id: 'node-target',
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        nodeType: MemoryGraphNodeType.CONCEPT,
        label: 'Forgotten Concept',
        confidence: 1.0,
        memoryRecordId: record.id,
        properties: {},
        createdAt: new Date().toISOString(),
      });

      await store.saveGraphEdge({
        id: 'edge-target',
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        sourceNodeId: 'node-target',
        targetNodeId: 'other-node',
        confidence: 1.0,
        weight: 1.0,
        properties: {},
        provenance: {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: 'agent-1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        createdAt: new Date().toISOString(),
      });

      // Verify all components exist before cascade
      assert.ok(await store.getById(record.id, record.tenantId, record.workspaceId));
      assert.ok(await store.getVector(record.id, record.tenantId, record.workspaceId));
      assert.ok(await store.getGraphNode('node-target', record.tenantId, record.workspaceId));
      assert.ok(await store.getGraphEdge('edge-target', record.tenantId, record.workspaceId));

      // Tombstone record
      const tombstoned = await store.tombstone(
        record.id,
        record.tenantId,
        record.workspaceId,
        new Date().toISOString(),
        1,
      );
      assert.equal(tombstoned.status, MemoryStatus.TOMBSTONED);
      assert.equal(tombstoned.version, 2);

      // Verify record is excluded from normal get and search
      assert.equal(await store.getById(record.id, record.tenantId, record.workspaceId), null);
      // Verify vector embedding is completely deleted from SQLite and vectorIndex
      assert.equal(await store.getVector(record.id, record.tenantId, record.workspaceId), null);
      const vecSearch = await store.searchVectors({
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        vector: [1, 0, 0, 0],
      });
      assert.equal(vecSearch.total, 0);

      // Verify graph node and edge referencing record were atomically revoked
      assert.equal(
        await store.getGraphNode('node-target', record.tenantId, record.workspaceId),
        null,
      );
      assert.equal(
        await store.getGraphEdge('edge-target', record.tenantId, record.workspaceId),
        null,
      );
    });

    it('proves genuine transaction rollback on cascade failure: pre-transaction state completely restored (062-SEC-03)', async () => {
      const record: MemoryRecord = {
        id: 'mem-rollback-target',
        tenantId: 't-rollback',
        workspaceId: 'w-rollback',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        content: 'Critical memory that must not be partially corrupted',
        confidence: 1.0,
        tags: ['critical'],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(record);

      await store.saveVector({
        id: 'vec-rollback',
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

      await store.saveGraphNode({
        id: 'node-rollback',
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        nodeType: MemoryGraphNodeType.ENTITY,
        label: 'Rollback Entity',
        confidence: 1.0,
        memoryRecordId: record.id,
        properties: {},
        createdAt: new Date().toISOString(),
      });

      // SIMULATE TRANSACTION FAILURE MID-CASCADE
      store.simulateFailureInCascade = true;

      // Attempt tombstone: must throw injected failure
      await assert.rejects(
        () =>
          store.tombstone(
            record.id,
            record.tenantId,
            record.workspaceId,
            new Date().toISOString(),
            1,
          ),
        /062-SEC-03-SIMULATED-FAIL/,
      );

      // VERIFY ROLLBACK: All entities MUST remain in pre-transaction state
      // 1. Record must STILL be ACTIVE with version 1
      const db = store.getDatabase();
      const rawRecord = db
        .prepare('SELECT status, version FROM memory_records WHERE id = ?;')
        .get(record.id) as { status: string; version: number };
      assert.equal(rawRecord.status, MemoryStatus.ACTIVE);
      assert.equal(rawRecord.version, 1);

      // 2. Vector embedding must STILL exist in SQLite
      const rawVector = db
        .prepare('SELECT id FROM vector_embeddings WHERE memory_record_id = ?;')
        .get(record.id);
      assert.ok(rawVector);

      // 3. Graph node must STILL exist in SQLite
      const rawNode = db.prepare('SELECT id FROM graph_nodes WHERE id = ?;').get('node-rollback');
      assert.ok(rawNode);

      // Reset failure simulation and verify normal atomic tombstone now succeeds
      store.simulateFailureInCascade = false;
      const success = await store.tombstone(
        record.id,
        record.tenantId,
        record.workspaceId,
        new Date().toISOString(),
        1,
      );
      assert.equal(success.status, MemoryStatus.TOMBSTONED);
      assert.equal(success.version, 2);

      // Now all projections are cleanly deleted
      assert.equal(
        db.prepare('SELECT id FROM vector_embeddings WHERE memory_record_id = ?;').get(record.id),
        undefined,
      );
      assert.equal(
        db.prepare('SELECT id FROM graph_nodes WHERE id = ?;').get('node-rollback'),
        undefined,
      );
    });
  });

  describe('Bounded Graph Traversal (062-SEC-05)', () => {
    it('enforces traversal limits (maxDepth <= 4, limit <= 100) and clamps inputs', async () => {
      const tenantId = 't-graph';
      const workspaceId = 'w-graph';

      // Create a chain of 6 nodes: N0 -> N1 -> N2 -> N3 -> N4 -> N5
      for (let i = 0; i <= 5; i++) {
        await store.saveGraphNode({
          id: `node-${i}`,
          tenantId,
          workspaceId,
          nodeType: MemoryGraphNodeType.TASK,
          label: `Step ${i}`,
          confidence: 1.0,
          properties: {},
          createdAt: new Date().toISOString(),
        });

        if (i > 0) {
          await store.saveGraphEdge({
            id: `edge-${i - 1}-${i}`,
            tenantId,
            workspaceId,
            edgeType: MemoryGraphEdgeType.DERIVED_FROM,
            sourceNodeId: `node-${i - 1}`,
            targetNodeId: `node-${i}`,
            confidence: 1.0,
            weight: 1.0,
            properties: {},
            provenance: {
              sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
              creatorPrincipalId: 'agent-1',
              timestamp: new Date().toISOString(),
              verified: true,
            },
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Query starting at node-0 with maxDepth = 2
      const depth2Res = await store.queryGraph({
        tenantId,
        workspaceId,
        startNodeId: 'node-0',
        maxDepth: 2,
      });
      // Should reach node-0, node-1, node-2 (depth 2)
      assert.equal(depth2Res.nodes.length, 3);
      assert.equal(depth2Res.traversalDepth, 2);

      // Requesting excessive depth (e.g. 100) must be clamped to maxDepth 4
      const depthClampedRes = await store.queryGraph({
        tenantId,
        workspaceId,
        startNodeId: 'node-0',
        maxDepth: 100, // Clamped to 4
      });
      assert.equal(depthClampedRes.traversalDepth, 4);
      assert.equal(depthClampedRes.nodes.length, 5); // node-0,1,2,3,4
    });
  });

  describe('Vector Embeddings & Dimension Validation (062-SEC-05, 062-SEC-06)', () => {
    it('rejects dimension mismatch on saveVector with VectorDimensionMismatchError', async () => {
      // Store configured with dimension 4; supplying 3 values
      const badVec: VectorEmbedding = {
        id: 'vec-dim-bad',
        memoryRecordId: 'mem-100',
        tenantId: 't1',
        workspaceId: 'w1',
        values: [1, 2, 3], // 3 values instead of 4
        dimensions: 3,
        normalized: true,
        metric: 'COSINE',
        metadata: {},
        createdAt: new Date().toISOString(),
      };

      await assert.rejects(() => store.saveVector(badVec), VectorDimensionMismatchError);
    });

    it('enforces 062-SEC-06: vector similarity search sensitivity filtering', async () => {
      // Ingest memory records with different sensitivities
      const publicRec: MemoryRecord = {
        id: 'mem-pub',
        tenantId: 't-sec',
        workspaceId: 'w-sec',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.PUBLIC,
        content: 'Public data',
        confidence: 1.0,
        tags: [],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(publicRec);

      const restRec: MemoryRecord = {
        id: 'mem-rest',
        tenantId: 't-sec',
        workspaceId: 'w-sec',
        ownerId: 'u1',
        class: MemoryClass.SEMANTIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.RESTRICTED,
        content: 'Restricted data',
        confidence: 1.0,
        tags: [],
        metadata: {},
        provenance: {
          sourceType: 'USER_EXPLICIT' as any,
          creatorPrincipalId: 'u1',
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.create(restRec);

      // Save vector embeddings for both
      await store.saveVector({
        id: 'v-pub',
        memoryRecordId: 'mem-pub',
        tenantId: 't-sec',
        workspaceId: 'w-sec',
        values: [1, 0, 0, 0],
        dimensions: 4,
        normalized: true,
        metric: 'COSINE',
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      await store.saveVector({
        id: 'v-rest',
        memoryRecordId: 'mem-rest',
        tenantId: 't-sec',
        workspaceId: 'w-sec',
        values: [1, 0, 0, 0],
        dimensions: 4,
        normalized: true,
        metric: 'COSINE',
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      // Search with maxSensitivity = INTERNAL: only public should be returned
      const searchRes = await store.searchVectors({
        tenantId: 't-sec',
        workspaceId: 'w-sec',
        vector: [1, 0, 0, 0],
        maxSensitivity: MemorySensitivity.INTERNAL,
      });

      assert.equal(searchRes.items.length, 1);
      assert.equal(searchRes.items[0].memoryRecordId, 'mem-pub');
    });
  });
});
