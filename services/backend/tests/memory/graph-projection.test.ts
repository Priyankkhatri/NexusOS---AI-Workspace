import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphProjectionEngine,
  InMemoryMemoryStore,
  MemoryServiceContext,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from '../../src/memory/index.js';
import {
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphQueryRequest,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  MemorySourceType,
} from '@nexusos/contracts';

describe('GraphProjectionEngine', () => {
  let store: InMemoryMemoryStore;
  let engine: GraphProjectionEngine;

  const validContext: MemoryServiceContext = {
    tenantId: 'tenant-graph-1',
    workspaceId: 'workspace-graph-1',
    principalId: 'user-graph-1',
  };

  const otherContext: MemoryServiceContext = {
    tenantId: 'tenant-other',
    workspaceId: 'workspace-other',
    principalId: 'user-other',
  };

  const defaultProvenance = {
    sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
    sourceId: 'sys-test',
    creatorPrincipalId: 'user-graph-1',
    timestamp: '2026-09-10T00:00:00.000Z',
    verified: false,
  };

  beforeEach(() => {
    store = new InMemoryMemoryStore();
    engine = new GraphProjectionEngine({ store });
  });

  describe('Node and Edge Management', () => {
    it('creates and retrieves graph nodes within workspace scope', async () => {
      const node: MemoryGraphNode = {
        id: 'node-1',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Build Workflow Task',
        memoryRecordId: 'mem-101',
        properties: {
          step: 'compilation',
        },
        confidence: 0.95,
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      const saved = await engine.upsertNode(node, validContext);
      assert.equal(saved.id, 'node-1');
      assert.equal(saved.label, 'Build Workflow Task');

      const retrieved = await store.getGraphNode('node-1', 'tenant-graph-1', 'workspace-graph-1');
      assert.ok(retrieved);
      assert.equal(retrieved?.memoryRecordId, 'mem-101');
    });

    it('creates graph edges linking nodes within workspace scope', async () => {
      const node1: MemoryGraphNode = {
        id: 'node-1',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Task 1',
        confidence: 0.95,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      };
      const node2: MemoryGraphNode = {
        id: 'node-2',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.DECISION,
        label: 'Decision 2',
        confidence: 0.9,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await engine.upsertNode(node1, validContext);
      await engine.upsertNode(node2, validContext);

      const edge: MemoryGraphEdge = {
        id: 'edge-1-2',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        weight: 1.0,
        confidence: 0.92,
        properties: { reason: 'sequential dependency' },
        provenance: defaultProvenance,
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      const savedEdge = await engine.upsertEdge(edge, validContext);
      assert.equal(savedEdge.id, 'edge-1-2');
    });
  });

  describe('058-SEC-03: Multi-tenant and Workspace Isolation', () => {
    it('fails closed when upserting node for mismatched tenant/workspace context', async () => {
      const node: MemoryGraphNode = {
        id: 'node-alien',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Infiltrate Node',
        confidence: 0.9,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await assert.rejects(
        async () => engine.upsertNode(node, otherContext),
        (err: any) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          assert.match(err.message, /058-SEC-03/);
          return true;
        },
      );
    });

    it('fails closed when upserting edge for mismatched tenant/workspace context', async () => {
      const edge: MemoryGraphEdge = {
        id: 'edge-alien',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        weight: 1.0,
        confidence: 0.85,
        properties: {},
        provenance: defaultProvenance,
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await assert.rejects(
        async () => engine.upsertEdge(edge, otherContext),
        (err: any) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          return true;
        },
      );
    });

    it('fails closed when querying graph across tenant or workspace boundary', async () => {
      const queryReq: MemoryGraphQueryRequest = {
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        startNodeId: 'node-1',
        maxDepth: 2,
      };

      await assert.rejects(
        async () => engine.query(queryReq, otherContext),
        (err: any) => {
          assert.ok(err instanceof MemorySecurityViolationError);
          assert.match(err.message, /058-SEC-03/);
          return true;
        },
      );
    });
  });

  describe('Bounded Graph Traversal', () => {
    beforeEach(async () => {
      const nodes: MemoryGraphNode[] = ['A', 'B', 'C', 'D'].map((name) => ({
        id: `node-${name}`,
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: `Task ${name}`,
        confidence: 0.95,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      }));

      for (const node of nodes) {
        await engine.upsertNode(node, validContext);
      }

      const edges: MemoryGraphEdge[] = [
        {
          id: 'edge-A-B',
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          sourceNodeId: 'node-A',
          targetNodeId: 'node-B',
          edgeType: MemoryGraphEdgeType.RELATES_TO,
          weight: 1.0,
          confidence: 0.95,
          properties: {},
          provenance: defaultProvenance,
          createdAt: '2026-09-10T00:00:00.000Z',
        },
        {
          id: 'edge-B-C',
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          sourceNodeId: 'node-B',
          targetNodeId: 'node-C',
          edgeType: MemoryGraphEdgeType.RELATES_TO,
          weight: 1.0,
          confidence: 0.85,
          properties: {},
          provenance: defaultProvenance,
          createdAt: '2026-09-10T00:00:00.000Z',
        },
        {
          id: 'edge-C-D',
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          sourceNodeId: 'node-C',
          targetNodeId: 'node-D',
          edgeType: MemoryGraphEdgeType.DERIVED_FROM,
          weight: 1.0,
          confidence: 0.75,
          properties: {},
          provenance: defaultProvenance,
          createdAt: '2026-09-10T00:00:00.000Z',
        },
      ];

      for (const edge of edges) {
        await engine.upsertEdge(edge, validContext);
      }
    });

    it('traverses with bounded depth of 1', async () => {
      const res = await engine.query(
        {
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          startNodeId: 'node-A',
          maxDepth: 1,
        },
        validContext,
      );

      assert.deepEqual(res.nodes.map((n) => n.id).sort(), ['node-A', 'node-B']);
      assert.deepEqual(
        res.edges.map((e) => e.id),
        ['edge-A-B'],
      );
      assert.equal(res.traversalDepth, 1);
    });

    it('traverses with bounded depth of 2', async () => {
      const res = await engine.query(
        {
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          startNodeId: 'node-A',
          maxDepth: 2,
        },
        validContext,
      );

      assert.deepEqual(res.nodes.map((n) => n.id).sort(), ['node-A', 'node-B', 'node-C']);
      assert.deepEqual(res.edges.map((e) => e.id).sort(), ['edge-A-B', 'edge-B-C']);
    });

    it('filters by minConfidence', async () => {
      const res = await engine.query(
        {
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          startNodeId: 'node-A',
          maxDepth: 3,
          minConfidence: 0.9,
        },
        validContext,
      );

      assert.deepEqual(res.nodes.map((n) => n.id).sort(), ['node-A', 'node-B']);
      assert.deepEqual(
        res.edges.map((e) => e.id),
        ['edge-A-B'],
      );
    });

    it('filters by edgeTypes', async () => {
      const res = await engine.query(
        {
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          startNodeId: 'node-A',
          maxDepth: 3,
          edgeTypes: [MemoryGraphEdgeType.DERIVED_FROM],
        },
        validContext,
      );

      assert.deepEqual(
        res.nodes.map((n) => n.id),
        ['node-A'],
      );
      assert.equal(res.edges.length, 0);
    });
  });

  describe('058-SEC-07: Secret Detection on Graph Projections', () => {
    it('rejects node creation with secret in label', async () => {
      const maliciousNode: MemoryGraphNode = {
        id: 'node-leak-1',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Connect with sk-proj-1234567890abcdef1234567890abcdef',
        confidence: 0.9,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await assert.rejects(
        async () => engine.upsertNode(maliciousNode, validContext),
        (err: any) => {
          assert.ok(err instanceof MemorySecretDetectedError);
          assert.match(err.message, /058-SEC-07/);
          return true;
        },
      );
    });

    it('rejects node creation with secret in properties', async () => {
      const maliciousNode: MemoryGraphNode = {
        id: 'node-leak-2',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.ARTIFACT,
        label: 'Clean Label',
        properties: {
          token: ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'].join(''),
        },
        confidence: 0.9,
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await assert.rejects(
        async () => engine.upsertNode(maliciousNode, validContext),
        (err: any) => {
          assert.ok(err instanceof MemorySecretDetectedError);
          return true;
        },
      );
    });

    it('rejects edge creation with secret in properties', async () => {
      const maliciousEdge: MemoryGraphEdge = {
        id: 'edge-leak',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        weight: 1.0,
        properties: {
          authHeader: 'Bearer 12345678901234567890',
        },
        provenance: defaultProvenance,
        confidence: 0.9,
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await assert.rejects(
        async () => engine.upsertEdge(maliciousEdge, validContext),
        (err: any) => {
          assert.ok(err instanceof MemorySecretDetectedError);
          return true;
        },
      );
    });
  });

  describe('058-SEC-05: Atomic Forgetting & Revocation', () => {
    it('revokes graph nodes and connected edges when parent memory record is tombstoned', async () => {
      const node1: MemoryGraphNode = {
        id: 'proj-node-1',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Parent Episode Projection',
        memoryRecordId: 'mem-parent-1',
        confidence: 0.95,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      const node2: MemoryGraphNode = {
        id: 'proj-node-2',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        nodeType: MemoryGraphNodeType.TASK,
        label: 'Unrelated Task',
        confidence: 0.95,
        properties: {},
        createdAt: '2026-09-10T00:00:00.000Z',
      };

      await engine.upsertNode(node1, validContext);
      await engine.upsertNode(node2, validContext);

      const edge: MemoryGraphEdge = {
        id: 'edge-1-2',
        tenantId: 'tenant-graph-1',
        workspaceId: 'workspace-graph-1',
        sourceNodeId: 'proj-node-1',
        targetNodeId: 'proj-node-2',
        edgeType: MemoryGraphEdgeType.DERIVED_FROM,
        weight: 1.0,
        confidence: 0.9,
        properties: {},
        provenance: defaultProvenance,
        createdAt: '2026-09-10T00:00:00.000Z',
      };
      await engine.upsertEdge(edge, validContext);

      const preCheck = await store.getGraphNode(
        'proj-node-1',
        'tenant-graph-1',
        'workspace-graph-1',
      );
      assert.ok(preCheck);

      const revocation = await engine.revokeProjectionsForMemory(
        'mem-parent-1',
        'tenant-graph-1',
        'workspace-graph-1',
      );

      assert.equal(revocation.revokedNodes, 1);
      assert.equal(revocation.revokedEdges, 1);

      const postNode1 = await store.getGraphNode(
        'proj-node-1',
        'tenant-graph-1',
        'workspace-graph-1',
      );
      assert.equal(postNode1, null);

      const postNode2 = await store.getGraphNode(
        'proj-node-2',
        'tenant-graph-1',
        'workspace-graph-1',
      );
      assert.ok(postNode2);

      const queryRes = await engine.query(
        {
          tenantId: 'tenant-graph-1',
          workspaceId: 'workspace-graph-1',
          startNodeId: 'proj-node-2',
          maxDepth: 1,
        },
        validContext,
      );
      assert.equal(queryRes.edges.length, 0);
    });
  });
});
