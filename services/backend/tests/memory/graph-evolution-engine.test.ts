import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  MemoryRecord,
  MemoryClass,
  MemorySensitivity,
  MemoryStatus,
  MemorySourceType,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  GraphExtractionResult,
} from '@nexusos/contracts';
import { SqliteMemoryStore } from '../../src/memory/sqlite-memory-store.js';
import { InMemoryMemoryStore } from '../../src/memory/memory-store.js';
import {
  GraphEvolutionEngine,
  computeCanonicalNodeId,
  computeCanonicalEdgeId,
} from '../../src/memory/graph-evolution-engine.js';
import { MemoryServiceContext } from '../../src/memory/types.js';

describe('GraphEvolutionEngine (Task 066 Phase 3 Unit Tests)', () => {
  let tempDir: string;
  let dbPath: string;
  let sqliteStore: SqliteMemoryStore;
  let inMemoryStore: InMemoryMemoryStore;

  const tenantId = 'tenant-evo-1';
  const workspaceId = 'workspace-evo-1';
  const context: MemoryServiceContext = {
    tenantId,
    workspaceId,
    principalId: 'user-tester',
  };

  const createBaseRecord = (overrides?: Partial<MemoryRecord>): MemoryRecord => {
    const now = new Date().toISOString();
    return {
      id: overrides?.id ?? 'rec-evo-parent-1',
      tenantId,
      workspaceId,
      ownerId: 'owner-evo-1',
      class: MemoryClass.SEMANTIC,
      confidence: 1.0,
      metadata: {},
      title: 'Graph Evolution Target',
      content: 'Configures sqlite-memory-store.ts and graph-evolution-engine.ts subsystems.',
      tags: ['graph', 'evolution'],
      sensitivity: MemorySensitivity.INTERNAL,
      status: MemoryStatus.ACTIVE,
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        sourceId: 'user-src-1',
        creatorPrincipalId: 'creator-1',
        timestamp: now,
        verified: true,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-task066-engine-'));
    dbPath = path.join(tempDir, 'memory-test.db');
    sqliteStore = new SqliteMemoryStore({ dbPath, vectorDimensions: 4 });
    inMemoryStore = new InMemoryMemoryStore();
  });

  afterEach(() => {
    sqliteStore.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Deterministic Canonical Identity Computation', () => {
    it('produces identical canonical node ID for same tenant, workspace, type, and key', () => {
      const id1 = computeCanonicalNodeId(
        tenantId,
        workspaceId,
        MemoryGraphNodeType.ARTIFACT,
        'src/index.ts',
      );
      const id2 = computeCanonicalNodeId(
        tenantId,
        workspaceId,
        MemoryGraphNodeType.ARTIFACT,
        'src/index.ts',
      );
      assert.equal(id1, id2);
      assert.match(id1, /^node-[a-f0-9]{16}$/);
    });

    it('produces distinct canonical node IDs across tenants or workspaces', () => {
      const idTenantA = computeCanonicalNodeId(
        'tenant-a',
        workspaceId,
        MemoryGraphNodeType.ARTIFACT,
        'src/index.ts',
      );
      const idTenantB = computeCanonicalNodeId(
        'tenant-b',
        workspaceId,
        MemoryGraphNodeType.ARTIFACT,
        'src/index.ts',
      );
      assert.notEqual(idTenantA, idTenantB);

      const idWsA = computeCanonicalNodeId(
        tenantId,
        'workspace-a',
        MemoryGraphNodeType.ARTIFACT,
        'src/index.ts',
      );
      const idWsB = computeCanonicalNodeId(
        tenantId,
        'workspace-b',
        MemoryGraphNodeType.ARTIFACT,
        'src/index.ts',
      );
      assert.notEqual(idWsA, idWsB);
    });

    it('produces deterministic canonical edge IDs', () => {
      const id1 = computeCanonicalEdgeId(
        tenantId,
        workspaceId,
        'node-1',
        'node-2',
        MemoryGraphEdgeType.RELATES_TO,
      );
      const id2 = computeCanonicalEdgeId(
        tenantId,
        workspaceId,
        'node-1',
        'node-2',
        MemoryGraphEdgeType.RELATES_TO,
      );
      assert.equal(id1, id2);
      assert.match(id1, /^edge-[a-f0-9]{16}$/);
    });
  });

  describe('Candidate Ingestion & Atomic Evolution (SQLite Store)', () => {
    it('creates new canonical nodes and edges from extraction candidates', async () => {
      const parentRecord = createBaseRecord();
      await sqliteStore.create(parentRecord);

      const engine = new GraphEvolutionEngine({ store: sqliteStore });
      const receipt = await engine.evolveFromRecord(parentRecord, context);

      assert.ok(receipt.evolutionId);
      assert.equal(receipt.acceptedNodes.length > 0, true);
      assert.equal(receipt.rejectedNodes.length, 0);
      assert.equal(receipt.rejectedEdges.length, 0);

      // Verify that all persisted nodes have verified=false (066-P3-SEC-03)
      for (const nodeId of receipt.acceptedNodes) {
        const node = await sqliteStore.getGraphNode(nodeId, tenantId, workspaceId);
        assert.ok(node, `Node ${nodeId} must exist`);
        assert.equal(node.provenance?.verified, false, 'Extracted node facts must not be verified');
        assert.equal(node.isCurrent, true);
      }
    });

    it('refines compatible existing facts in place with version increment', async () => {
      const parentRecord = createBaseRecord();
      await sqliteStore.create(parentRecord);

      const engine = new GraphEvolutionEngine({ store: sqliteStore });
      const firstReceipt = await engine.evolveFromRecord(parentRecord, context);
      assert.ok(firstReceipt.evolutionId);
      assert.ok(firstReceipt.acceptedNodes.length > 0);

      const canonicalNodeId = firstReceipt.acceptedNodes[0];
      const initialNode = await sqliteStore.getGraphNode(canonicalNodeId, tenantId, workspaceId);
      assert.ok(initialNode);
      assert.equal(initialNode.version, 1);

      // Provide candidate that refines the same canonical entity with compatible properties
      const refinementCandidate: GraphExtractionResult = {
        tenantId,
        workspaceId,
        memoryRecordId: parentRecord.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-refine-1',
            tenantId,
            workspaceId,
            memoryRecordId: parentRecord.id,
            nodeType: initialNode.nodeType,
            label: initialNode.label,
            confidence: 0.95,
            provenance: initialNode.provenance ?? parentRecord.provenance,
            properties: {
              ...initialNode.properties,
              lastRefinedBy: 'test-runner',
            },
          },
        ],
        edges: [],
      };

      const secondReceipt = await engine.evolveCandidates(
        parentRecord,
        refinementCandidate,
        context,
      );
      assert.ok(secondReceipt.evolutionId);
      assert.ok(secondReceipt.acceptedNodes.includes(canonicalNodeId));

      const refinedNode = await sqliteStore.getGraphNode(canonicalNodeId, tenantId, workspaceId);
      assert.ok(refinedNode);
      assert.equal(refinedNode.version, 2, 'Version must be incremented on refinement');
      assert.equal(refinedNode.properties?.lastRefinedBy, 'test-runner');
      assert.equal(refinedNode.isCurrent, true);
    });

    it('handles contradictory assertions via immutable supersession and SUPERSEDES edge', async () => {
      const parentRecord = createBaseRecord();
      await sqliteStore.create(parentRecord);

      const engine = new GraphEvolutionEngine({ store: sqliteStore });
      const firstReceipt = await engine.evolveFromRecord(parentRecord, context);
      assert.ok(firstReceipt.evolutionId);
      assert.ok(firstReceipt.acceptedNodes.length > 0);

      const originalNodeId = firstReceipt.acceptedNodes[0];
      const originalNode = await sqliteStore.getGraphNode(originalNodeId, tenantId, workspaceId);
      assert.ok(originalNode);

      // Create a contradictory candidate (explicit contradictory status / assertion)
      const contradictoryCandidate: GraphExtractionResult = {
        tenantId,
        workspaceId,
        memoryRecordId: parentRecord.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-contra-1',
            tenantId,
            workspaceId,
            memoryRecordId: parentRecord.id,
            nodeType: originalNode.nodeType,
            label: `${originalNode.label} (Deprecated)`,
            confidence: 0.92,
            provenance: originalNode.provenance ?? parentRecord.provenance,
            properties: {
              status: 'DEPRECATED',
              contradicts: true,
              supersedes: originalNodeId,
            },
          },
        ],
        edges: [],
      };

      const contraReceipt = await engine.evolveCandidates(
        parentRecord,
        contradictoryCandidate,
        context,
      );
      assert.ok(contraReceipt.evolutionId);
      assert.ok(contraReceipt.supersededNodeIds.includes(originalNodeId));

      // Verify old node state
      const oldNodeAfter = await sqliteStore.getGraphNode(originalNodeId, tenantId, workspaceId);
      assert.ok(oldNodeAfter);
      assert.equal(oldNodeAfter.isCurrent, false, 'Old node must no longer be current');
      assert.ok(oldNodeAfter.validTo, 'Old node validTo must be populated');
      assert.ok(oldNodeAfter.supersededBy, 'Old node must reference new supersededBy');

      // Verify new node state
      const newNodeId = oldNodeAfter.supersededBy!;
      const newNode = await sqliteStore.getGraphNode(newNodeId, tenantId, workspaceId);
      assert.ok(newNode);
      assert.equal(newNode.isCurrent, true);
      assert.equal(newNode.version, 1);

      // Verify SUPERSEDES edge
      const queryRes = await sqliteStore.queryGraph({ tenantId, workspaceId });
      const supersedesEdge = queryRes.edges.find(
        (e) => e.edgeType === MemoryGraphEdgeType.SUPERSEDES,
      );
      assert.ok(supersedesEdge, 'Must create a SUPERSEDES edge');
      assert.equal(supersedesEdge.sourceNodeId, newNodeId);
      assert.equal(supersedesEdge.targetNodeId, originalNodeId);
    });

    it('rejects candidates with confidence below 0.50 into rejectedNodes', async () => {
      const parentRecord = createBaseRecord();
      await sqliteStore.create(parentRecord);

      const engine = new GraphEvolutionEngine({ store: sqliteStore });
      const lowConfidenceCandidate: GraphExtractionResult = {
        tenantId,
        workspaceId,
        memoryRecordId: parentRecord.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-low-conf-1',
            tenantId,
            workspaceId,
            memoryRecordId: parentRecord.id,
            nodeType: MemoryGraphNodeType.CONCEPT,
            label: 'Low Confidence Concept',
            confidence: 0.45,
            provenance: parentRecord.provenance,
            properties: {},
          },
        ],
        edges: [],
      };

      const receipt = await engine.evolveCandidates(parentRecord, lowConfidenceCandidate, context);
      assert.ok(receipt.evolutionId);
      assert.equal(receipt.rejectedNodes.length, 1);
      assert.ok(receipt.rejectedNodes[0].reason.startsWith('LOW_CONFIDENCE'));
      assert.equal(receipt.acceptedNodes.length, 0);
    });

    it('rejects edges referencing missing endpoints into rejectedEdges', async () => {
      const parentRecord = createBaseRecord();
      await sqliteStore.create(parentRecord);

      const engine = new GraphEvolutionEngine({ store: sqliteStore });
      const brokenEdgeCandidate: GraphExtractionResult = {
        tenantId,
        workspaceId,
        memoryRecordId: parentRecord.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [],
        edges: [
          {
            candidateId: 'cand-broken-edge',
            tenantId,
            workspaceId,
            sourceNodeId: 'cand-non-existent-1',
            targetNodeId: 'cand-non-existent-2',
            edgeType: MemoryGraphEdgeType.RELATES_TO,
            confidence: 0.85,
            provenance: parentRecord.provenance,
            properties: {},
            weight: 1.0,
          },
        ],
      };

      const receipt = await engine.evolveCandidates(parentRecord, brokenEdgeCandidate, context);
      assert.ok(receipt.evolutionId);
      assert.equal(receipt.rejectedEdges.length, 1);
      assert.ok(receipt.rejectedEdges[0].reason.startsWith('DANGLING_ENDPOINT'));
    });
  });

  describe('In-Memory Store Parity', () => {
    it('executes identical evolution operations on InMemoryMemoryStore', async () => {
      const parentRecord = createBaseRecord();
      await inMemoryStore.create(parentRecord);

      const engine = new GraphEvolutionEngine({ store: inMemoryStore });
      const receipt = await engine.evolveFromRecord(parentRecord, context);

      assert.ok(receipt.evolutionId);
      assert.equal(receipt.acceptedNodes.length > 0, true);

      for (const nodeId of receipt.acceptedNodes) {
        const node = await inMemoryStore.getGraphNode(nodeId, tenantId, workspaceId);
        assert.ok(node);
        assert.equal(node.isCurrent, true);
        assert.equal(node.provenance?.verified, false);
      }
    });
  });
});
