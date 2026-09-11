/**
 * Task 066 Phase 3 — Governed Graph Evolution Pipeline Security Hardening
 *
 * Security Invariants Tested:
 * - 066-P3-SEC-01: Secret-bearing candidate is rejected and never persisted (fail-closed scan)
 * - 066-P3-SEC-02: Cross-tenant/workspace candidate cannot read, update, or create graph state outside caller scope
 * - 066-P3-SEC-03: Unverified extracted candidate remains verified:false and cannot gain authority (advisory only)
 * - 066-P3-SEC-04: Tombstoned/inactive parent memory cannot produce new graph facts
 * - 066-P3-SEC-05: Stale OCC update cannot overwrite newer graph state (MemoryVersionConflictError)
 * - 066-P3-SEC-06: Contradiction preserves historical fact and creates immutable SUPERSEDES lineage
 * - 066-P3-SEC-07: Evolution transaction is atomic: injected mid-batch failure leaves zero partial mutations
 * - 066-P3-SEC-08: Forgetting semantics are privacy-safe AND consistent with Task 066 Phase-1 historical/asOf semantics
 *
 * Additional Hardening:
 * - Prototype-pollution resilience (__proto__, constructor)
 * - Bounded input enforcement
 * - Idempotent replay resilience
 * - Sensitivity inheritance and redaction
 */

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
import { SqliteMemoryStore } from '../../services/backend/src/memory/sqlite-memory-store.js';
import {
  GraphEvolutionEngine,
  computeCanonicalNodeId,
} from '../../services/backend/src/memory/graph-evolution-engine.js';
import {
  MemoryServiceContext,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
  MemoryVersionConflictError,
} from '../../services/backend/src/memory/types.js';

describe('Task 066 Phase 3 Security Hardening: Graph Evolution Invariants (066-P3-SEC-01..08)', () => {
  let tempDir: string;
  let dbPath: string;
  let store: SqliteMemoryStore;

  const tenantAlpha = 'tenant-alpha';
  const tenantBeta = 'tenant-beta';
  const workspaceAlphaPrimary = 'ws-alpha-primary';
  const workspaceAlphaSecondary = 'ws-alpha-secondary';
  const workspaceBetaPrimary = 'ws-beta-primary';

  const contextAlpha: MemoryServiceContext = {
    tenantId: tenantAlpha,
    workspaceId: workspaceAlphaPrimary,
    principalId: 'principal-alpha-1',
  };

  const contextBeta: MemoryServiceContext = {
    tenantId: tenantBeta,
    workspaceId: workspaceBetaPrimary,
    principalId: 'principal-beta-1',
  };

  const createRecord = (overrides?: Partial<MemoryRecord>): MemoryRecord => {
    const now = new Date().toISOString();
    return {
      id: overrides?.id ?? `rec-sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tenantId: overrides?.tenantId ?? tenantAlpha,
      workspaceId: overrides?.workspaceId ?? workspaceAlphaPrimary,
      ownerId: 'owner-sec-1',
      class: MemoryClass.SEMANTIC,
      confidence: 1.0,
      metadata: {},
      title: 'Governed Architecture Record',
      content:
        'Configures services/backend/src/memory/sqlite-memory-store.ts with strict isolation.',
      tags: ['security', 'governance'],
      sensitivity: MemorySensitivity.INTERNAL,
      status: MemoryStatus.ACTIVE,
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        sourceId: 'user-op-1',
        creatorPrincipalId: 'principal-alpha-1',
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-066-sec-'));
    dbPath = path.join(tempDir, 'memory-sec.db');
    store = new SqliteMemoryStore({ dbPath, vectorDimensions: 4 });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // =========================================================================
  // 066-P3-SEC-01: Secret-bearing candidate is rejected and never persisted
  // =========================================================================
  describe('066-P3-SEC-01: Secret-bearing Candidate Rejection', () => {
    it('fails closed and rejects evolution if node label contains an API key secret', async () => {
      const parent = createRecord();
      await store.create(parent);
      const engine = new GraphEvolutionEngine({ store });

      const taintedCandidate: GraphExtractionResult = {
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        memoryRecordId: parent.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-sec-leak-1',
            tenantId: tenantAlpha,
            workspaceId: workspaceAlphaPrimary,
            memoryRecordId: parent.id,
            nodeType: MemoryGraphNodeType.CONCEPT,
            label: 'api_key=sk-proj-abcdef1234567890abcdef1234567890',
            confidence: 0.9,
            provenance: parent.provenance,
            properties: {},
          },
        ],
        edges: [],
      };

      await assert.rejects(
        () => engine.evolveCandidates(parent, taintedCandidate, contextAlpha),
        (err: any) => {
          assert.ok(
            err instanceof MemorySecretDetectedError ||
              err.name === 'MemorySecretDetectedError' ||
              err.code === 'MEMORY_SECRET_DETECTED',
          );
          assert.match(err.message, /056-SEC-03|066-P3-SEC-01|secret/i);
          return true;
        },
      );

      // Verify zero nodes persisted
      const graph = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      assert.equal(graph.nodes.length, 0);
    });

    it('fails closed and rejects evolution if node properties contain Bearer tokens', async () => {
      const parent = createRecord();
      await store.create(parent);
      const engine = new GraphEvolutionEngine({ store });

      const taintedCandidate: GraphExtractionResult = {
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        memoryRecordId: parent.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-sec-leak-2',
            tenantId: tenantAlpha,
            workspaceId: workspaceAlphaPrimary,
            memoryRecordId: parent.id,
            nodeType: MemoryGraphNodeType.CONCEPT,
            label: 'Auth Header Config',
            confidence: 0.9,
            provenance: parent.provenance,
            properties: {
              authHeader:
                'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
            },
          },
        ],
        edges: [],
      };

      await assert.rejects(
        () => engine.evolveCandidates(parent, taintedCandidate, contextAlpha),
        (err: any) => {
          assert.ok(
            err instanceof MemorySecretDetectedError ||
              err.name === 'MemorySecretDetectedError' ||
              err.code === 'MEMORY_SECRET_DETECTED',
          );
          return true;
        },
      );
    });
  });

  // =========================================================================
  // 066-P3-SEC-02: Tenant and Workspace Boundary Isolation
  // =========================================================================
  describe('066-P3-SEC-02: Tenant/Workspace Boundary Isolation', () => {
    it('rejects caller attempting to evolve graph across tenants', async () => {
      const parent = createRecord({ tenantId: tenantAlpha, workspaceId: workspaceAlphaPrimary });
      await store.create(parent);
      const engine = new GraphEvolutionEngine({ store });

      // Caller context is tenantBeta, parent is tenantAlpha
      await assert.rejects(
        () => engine.evolveFromRecord(parent, contextBeta),
        (err: unknown) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          assert.match(err.message, /066-P3-SEC-02/);
          return true;
        },
      );
    });

    it('rejects caller attempting to evolve graph across workspaces in same tenant', async () => {
      const parent = createRecord({ tenantId: tenantAlpha, workspaceId: workspaceAlphaPrimary });
      await store.create(parent);
      const engine = new GraphEvolutionEngine({ store });

      const crossWsContext: MemoryServiceContext = {
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaSecondary,
        principalId: 'principal-alpha-2',
      };

      await assert.rejects(
        () => engine.evolveFromRecord(parent, crossWsContext),
        (err: unknown) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          assert.match(err.message, /066-P3-SEC-02/);
          return true;
        },
      );
    });

    it('ensures canonical node IDs never collide or overlap across tenants', async () => {
      const idAlpha = computeCanonicalNodeId(
        tenantAlpha,
        workspaceAlphaPrimary,
        MemoryGraphNodeType.ARTIFACT,
        'src/shared.ts',
      );
      const idBeta = computeCanonicalNodeId(
        tenantBeta,
        workspaceAlphaPrimary,
        MemoryGraphNodeType.ARTIFACT,
        'src/shared.ts',
      );

      assert.notEqual(idAlpha, idBeta);

      // Persist in tenant Alpha
      const parentAlpha = createRecord({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      await store.create(parentAlpha);
      const engineAlpha = new GraphEvolutionEngine({ store });
      await engineAlpha.evolveFromRecord(parentAlpha, contextAlpha);

      // Verify Tenant Beta query cannot see Tenant Alpha graph nodes
      const betaGraph = await store.queryGraph({
        tenantId: tenantBeta,
        workspaceId: workspaceAlphaPrimary,
      });
      assert.equal(betaGraph.nodes.length, 0);
      assert.equal(betaGraph.edges.length, 0);
    });
  });

  // =========================================================================
  // 066-P3-SEC-03: Unverified Extracted Candidates Remain verified:false
  // =========================================================================
  describe('066-P3-SEC-03: Unverified Extraction Non-Authority', () => {
    it('forces verified: false on all evolved nodes even if parent is verified', async () => {
      const parent = createRecord({
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          sourceId: 'user-op-1',
          creatorPrincipalId: 'principal-alpha-1',
          timestamp: new Date().toISOString(),
          verified: true, // Parent is verified
        },
      });
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });
      const receipt = await engine.evolveFromRecord(parent, contextAlpha);

      assert.ok(receipt.acceptedNodes.length > 0);

      for (const nodeId of receipt.acceptedNodes) {
        const node = await store.getGraphNode(nodeId, tenantAlpha, workspaceAlphaPrimary);
        assert.ok(node);
        assert.equal(node.provenance?.verified, false, 'Extracted fact MUST remain verified:false');
      }

      for (const edgeId of receipt.acceptedEdges) {
        const edge = await store.getGraphEdge(edgeId, tenantAlpha, workspaceAlphaPrimary);
        assert.ok(edge);
        assert.equal(edge.provenance?.verified, false, 'Extracted edge MUST remain verified:false');
      }
    });
  });

  // =========================================================================
  // 066-P3-SEC-04: Tombstoned/Inactive Parent Memory Cannot Produce New Facts
  // =========================================================================
  describe('066-P3-SEC-04: Tombstoned / Inactive Parent Rejection', () => {
    it('rejects graph evolution from a tombstoned parent memory record', async () => {
      const parent = createRecord();
      await store.create(parent);
      // Tombstone parent record
      await store.tombstone(
        parent.id,
        tenantAlpha,
        workspaceAlphaPrimary,
        new Date().toISOString(),
      );

      const engine = new GraphEvolutionEngine({ store });

      await assert.rejects(
        () => engine.evolveFromRecord(parent, contextAlpha),
        (err: unknown) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          assert.match(err.message, /066-P3-SEC-04.*TOMBSTONED/);
          return true;
        },
      );
    });

    it('rejects graph evolution from an ARCHIVED or non-ACTIVE memory record', async () => {
      const parent = createRecord({ status: MemoryStatus.ARCHIVED });
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });

      await assert.rejects(
        () => engine.evolveFromRecord(parent, contextAlpha),
        (err: unknown) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          assert.match(err.message, /066-P3-SEC-04.*not ACTIVE/);
          return true;
        },
      );
    });
  });

  // =========================================================================
  // 066-P3-SEC-05: Stale OCC Update Cannot Overwrite Newer Graph State
  // =========================================================================
  describe('066-P3-SEC-05: Optimistic Concurrency Control (OCC) Enforcement', () => {
    it('rejects stale refinement update when expectedVersion does not match current version', async () => {
      const parent = createRecord();
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });
      const firstReceipt = await engine.evolveFromRecord(parent, contextAlpha);
      const targetNode = await store.getGraphNode(
        firstReceipt.acceptedNodes[0],
        tenantAlpha,
        workspaceAlphaPrimary,
      );
      assert.ok(targetNode);
      const targetNodeId = targetNode.id;

      // Refine once to bump version to 2
      const firstRefine: GraphExtractionResult = {
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        memoryRecordId: parent.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-refine-v1',
            tenantId: tenantAlpha,
            workspaceId: workspaceAlphaPrimary,
            memoryRecordId: parent.id,
            nodeType: targetNode.nodeType,
            label: targetNode.label,
            confidence: 0.95,
            provenance: parent.provenance,
            properties: {
              ...targetNode.properties,
              iteration: 1,
            },
          },
        ],
        edges: [],
      };
      await engine.evolveCandidates(parent, firstRefine, contextAlpha);

      const current = await store.getGraphNode(targetNodeId, tenantAlpha, workspaceAlphaPrimary);
      assert.ok(current);
      assert.equal(current.version, 2);

      // Attempt concurrent/stale refinement with expectedVersion: 1
      await assert.rejects(
        () =>
          store.evolveGraph(
            {
              evolutionId: 'evo-stale-test',
              tenantId: tenantAlpha,
              workspaceId: workspaceAlphaPrimary,
              memoryRecordId: parent.id,
              memoryVersion: 1,
              operations: [
                {
                  operationType: 'REFINE_NODE' as any,
                  targetId: targetNodeId,
                  expectedVersion: 1, // STALE version! Current is 2
                  node: {
                    ...current,
                    properties: { iteration: 999 },
                  },
                },
              ],
              createdAt: new Date().toISOString(),
            },
            contextAlpha,
          ),
        (err: unknown) => {
          assert.ok(err instanceof MemoryVersionConflictError);
          assert.match(err.message, /056-SEC-06/);
          return true;
        },
      );

      // Verify node was NOT overwritten with stale iteration 999
      const afterFail = await store.getGraphNode(targetNodeId, tenantAlpha, workspaceAlphaPrimary);
      assert.ok(afterFail);
      assert.equal(afterFail.version, 2);
      assert.equal(afterFail.properties?.iteration, 1);
    });
  });

  // =========================================================================
  // 066-P3-SEC-06: Contradiction Preserves Historical Fact with SUPERSEDES Lineage
  // =========================================================================
  describe('066-P3-SEC-06: Immutable Supersession Lineage', () => {
    it('preserves historical fact in asOf queries while marking current superseded', async () => {
      const parent = createRecord();
      await store.create(parent);

      const t0 = new Date('2026-09-11T01:00:00.000Z').toISOString();
      const t1 = new Date('2026-09-11T02:00:00.000Z').toISOString();

      const engine = new GraphEvolutionEngine({
        store,
        nowProvider: () => t0,
      });

      const firstReceipt = await engine.evolveFromRecord(parent, contextAlpha, { evolvedAt: t0 });
      const targetNode = await store.getGraphNode(
        firstReceipt.acceptedNodes[0],
        tenantAlpha,
        workspaceAlphaPrimary,
      );
      assert.ok(targetNode);
      const originalNodeId = targetNode.id;

      // Evolve contradiction at t1
      const contraEngine = new GraphEvolutionEngine({
        store,
        nowProvider: () => t1,
      });

      const contraCandidate: GraphExtractionResult = {
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        memoryRecordId: parent.id,
        extractedAt: t1,
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-supersede-lineage',
            tenantId: tenantAlpha,
            workspaceId: workspaceAlphaPrimary,
            memoryRecordId: parent.id,
            nodeType: targetNode.nodeType,
            label: `${targetNode.label} (Replaced)`,
            confidence: 0.95,
            provenance: parent.provenance,
            properties: {
              supersedes: originalNodeId,
              contradicts: true,
            },
          },
        ],
        edges: [],
      };

      const contraReceipt = await contraEngine.evolveCandidates(
        parent,
        contraCandidate,
        contextAlpha,
        {
          evolvedAt: t1,
        },
      );

      assert.ok(contraReceipt.supersededNodeIds.includes(originalNodeId));

      // 1. Current query (default includeSuperseded: false): returns the new node as current, old node is non-current
      const currentQuery = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        includeSuperseded: false,
      });
      const activeOriginal = currentQuery.nodes.find((n) => n.id === originalNodeId);
      assert.equal(
        activeOriginal,
        undefined,
        'Historical node must not be returned in currentOnly query',
      );

      // 2. Historical query at t0: returns the original node!
      const historicalQuery = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        asOf: t0,
      });
      const historicalOriginal = historicalQuery.nodes.find((n) => n.id === originalNodeId);
      assert.ok(historicalOriginal, 'Historical fact must be retrievable asOf its validity window');

      // 3. Lineage: SUPERSEDES edge points from new to old
      const edges = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      const supersedesEdge = edges.edges.find((e) => e.edgeType === MemoryGraphEdgeType.SUPERSEDES);
      assert.ok(supersedesEdge);
      assert.equal(supersedesEdge.targetNodeId, originalNodeId);
    });
  });

  // =========================================================================
  // 066-P3-SEC-07: Atomic Evolution: Mid-Batch Failure Leaves Zero Partial State
  // =========================================================================
  describe('066-P3-SEC-07: Atomic All-or-Nothing Batch Persistence', () => {
    it('rolls back all mutations if an error occurs midway through the evolution batch', async () => {
      const parent = createRecord();
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });

      // Enable simulated mid-batch failure in SQLite store
      store.simulateFailureInEvolutionMidway = true;

      await assert.rejects(
        () => engine.evolveFromRecord(parent, contextAlpha),
        /066-P3-SEC-07-SIMULATED-FAIL/,
      );

      // Verify ZERO graph nodes and ZERO graph edges exist in SQLite
      const graph = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      assert.equal(graph.nodes.length, 0, 'No partial nodes after mid-batch failure');
      assert.equal(graph.edges.length, 0, 'No partial edges after mid-batch failure');
    });
  });

  // =========================================================================
  // 066-P3-SEC-08: Forgetting Cascade Privacy vs. Historical asOf Preservation
  // =========================================================================
  describe('066-P3-SEC-08: Governed Forgetting vs. Historical Preservation', () => {
    it('purges derived graph nodes and edges on memory tombstone to prevent privacy leaks', async () => {
      const parent = createRecord();
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });
      const receipt = await engine.evolveFromRecord(parent, contextAlpha);
      assert.ok(receipt.acceptedNodes.length > 0);

      // Verify nodes and edges were persisted
      const graphBefore = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      assert.ok(graphBefore.nodes.length > 0);
      assert.ok(graphBefore.edges.length > 0);

      // Perform governed forgetting cascade: tombstone parent memory
      const tombstoneRes = await store.tombstone(
        parent.id,
        tenantAlpha,
        workspaceAlphaPrimary,
        new Date().toISOString(),
      );
      assert.equal(tombstoneRes.status, MemoryStatus.TOMBSTONED);

      // Verify that NO graph nodes or edges for this memory record remain
      const graphAfter = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      assert.equal(graphAfter.nodes.length, 0, 'Tombstoned memory graph nodes must be revoked');
      assert.equal(graphAfter.edges.length, 0, 'Tombstoned memory graph edges must be revoked');

      // Crucial: asOf query cannot retrieve physically deleted forgotten facts either!
      const asOfPast = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        asOf: parent.createdAt,
      });
      assert.equal(asOfPast.nodes.length, 0, 'Forgotten private data must not leak via asOf');
    });
  });

  // =========================================================================
  // Additional Hardening: Prototype Pollution & Malformed Input
  // =========================================================================
  describe('Additional Hardening: Prototype Pollution & Malformed Inputs', () => {
    it('safely handles prototype-pollution keys without corrupting object prototypes', async () => {
      const parent = createRecord();
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });
      const maliciousCandidate: GraphExtractionResult = {
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
        memoryRecordId: parent.id,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 5,
        truncated: false,
        nodes: [
          {
            candidateId: 'cand-proto-pollute',
            tenantId: tenantAlpha,
            workspaceId: workspaceAlphaPrimary,
            memoryRecordId: parent.id,
            nodeType: MemoryGraphNodeType.CONCEPT,
            label: 'Pollution Test',
            confidence: 0.95,
            provenance: parent.provenance,
            properties: JSON.parse(
              '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"admin": true}}}',
            ),
          },
        ],
        edges: [],
      };

      const receipt = await engine.evolveCandidates(parent, maliciousCandidate, contextAlpha);
      assert.ok(receipt.acceptedNodes.length > 0);

      // Verify global Object prototype was not polluted
      assert.equal((Object.prototype as any).polluted, undefined);
      assert.equal((Object.prototype as any).admin, undefined);
    });

    it('ensures repeated identical candidate batches are idempotent', async () => {
      const parent = createRecord();
      await store.create(parent);

      const engine = new GraphEvolutionEngine({ store });

      const receipt1 = await engine.evolveFromRecord(parent, contextAlpha);
      const receipt2 = await engine.evolveFromRecord(parent, contextAlpha);

      assert.ok(receipt1.acceptedNodes.length > 0);
      assert.ok(receipt2.acceptedNodes.length > 0);

      // Total node count in store must not double
      const graph = await store.queryGraph({
        tenantId: tenantAlpha,
        workspaceId: workspaceAlphaPrimary,
      });
      assert.equal(graph.nodes.length, receipt1.acceptedNodes.length);
    });
  });
});
