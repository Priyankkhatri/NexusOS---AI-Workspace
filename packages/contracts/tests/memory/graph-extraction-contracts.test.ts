import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  MemorySourceType,
  GraphExtractionCandidateNodeSchema,
  GraphExtractionCandidateEdgeSchema,
  GraphExtractionResultSchema,
  GraphExtractorOptionsSchema,
} from '../../src/memory/index.js';

describe('Graph Extraction Candidate Contracts (Task 066 Phase 2)', () => {
  const now = new Date().toISOString();

  const validProvenance = {
    sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
    sourceId: 'mem-record-1',
    creatorPrincipalId: 'principal-agent-1',
    timestamp: now,
    verified: false,
  };

  describe('GraphExtractionCandidateNodeSchema', () => {
    it('1. parses valid candidate node with default properties', () => {
      const parsed = GraphExtractionCandidateNodeSchema.parse({
        candidateId: 'cand-node-abc123',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodeType: MemoryGraphNodeType.ENTITY,
        label: 'services/backend/store.ts',
        memoryRecordId: 'mem-record-1',
        confidence: 0.95,
        provenance: validProvenance,
      });

      assert.equal(parsed.candidateId, 'cand-node-abc123');
      assert.equal(parsed.tenantId, 'tenant-1');
      assert.equal(parsed.workspaceId, 'ws-1');
      assert.equal(parsed.nodeType, MemoryGraphNodeType.ENTITY);
      assert.equal(parsed.label, 'services/backend/store.ts');
      assert.equal(parsed.memoryRecordId, 'mem-record-1');
      assert.equal(parsed.confidence, 0.95);
      assert.deepEqual(parsed.properties, {});
      assert.equal(parsed.provenance.verified, false);
    });

    it('2. parses valid candidate node with custom properties', () => {
      const parsed = GraphExtractionCandidateNodeSchema.parse({
        candidateId: 'cand-node-concept-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodeType: MemoryGraphNodeType.CONCEPT,
        label: 'Authentication',
        memoryRecordId: 'mem-record-1',
        properties: { category: 'TAG', sensitivity: 'CONFIDENTIAL' },
        confidence: 1.0,
        provenance: validProvenance,
      });

      assert.equal(parsed.properties.category, 'TAG');
      assert.equal(parsed.properties.sensitivity, 'CONFIDENTIAL');
    });

    it('3. rejects candidate node with confidence outside [0, 1]', () => {
      assert.throws(() => {
        GraphExtractionCandidateNodeSchema.parse({
          candidateId: 'cand-node-invalid',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          nodeType: MemoryGraphNodeType.ENTITY,
          label: 'Test',
          memoryRecordId: 'mem-record-1',
          confidence: 1.5,
          provenance: validProvenance,
        });
      });

      assert.throws(() => {
        GraphExtractionCandidateNodeSchema.parse({
          candidateId: 'cand-node-invalid',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          nodeType: MemoryGraphNodeType.ENTITY,
          label: 'Test',
          memoryRecordId: 'mem-record-1',
          confidence: -0.1,
          provenance: validProvenance,
        });
      });
    });

    it('4. rejects candidate node missing required fields', () => {
      assert.throws(() => {
        GraphExtractionCandidateNodeSchema.parse({
          candidateId: 'cand-node-invalid',
          // missing tenantId, workspaceId, label, etc.
        });
      });
    });
  });

  describe('GraphExtractionCandidateEdgeSchema', () => {
    it('1. parses valid candidate edge with default weight', () => {
      const parsed = GraphExtractionCandidateEdgeSchema.parse({
        candidateId: 'cand-edge-xyz789',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        sourceNodeId: 'cand-node-1',
        targetNodeId: 'cand-node-2',
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        confidence: 0.7,
        provenance: validProvenance,
      });

      assert.equal(parsed.candidateId, 'cand-edge-xyz789');
      assert.equal(parsed.sourceNodeId, 'cand-node-1');
      assert.equal(parsed.targetNodeId, 'cand-node-2');
      assert.equal(parsed.edgeType, MemoryGraphEdgeType.RELATES_TO);
      assert.equal(parsed.weight, 1.0);
      assert.equal(parsed.confidence, 0.7);
      assert.deepEqual(parsed.properties, {});
    });

    it('2. parses valid candidate edge with explicit weight and properties', () => {
      const parsed = GraphExtractionCandidateEdgeSchema.parse({
        candidateId: 'cand-edge-resolved',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        sourceNodeId: 'cand-node-fix',
        targetNodeId: 'cand-node-err',
        edgeType: MemoryGraphEdgeType.RESOLVED_BY,
        weight: 2.5,
        confidence: 0.85,
        properties: { cue: 'fixes_resolved' },
        provenance: validProvenance,
      });

      assert.equal(parsed.edgeType, MemoryGraphEdgeType.RESOLVED_BY);
      assert.equal(parsed.weight, 2.5);
      assert.equal(parsed.confidence, 0.85);
      assert.equal(parsed.properties.cue, 'fixes_resolved');
    });

    it('3. rejects edge with negative weight or invalid confidence', () => {
      assert.throws(() => {
        GraphExtractionCandidateEdgeSchema.parse({
          candidateId: 'cand-edge-invalid',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          sourceNodeId: 'cand-node-1',
          targetNodeId: 'cand-node-2',
          edgeType: MemoryGraphEdgeType.DERIVED_FROM,
          weight: -1.0,
          confidence: 0.9,
          provenance: validProvenance,
        });
      });
    });
  });

  describe('GraphExtractionResultSchema', () => {
    it('1. parses complete valid extraction result', () => {
      const node = {
        candidateId: 'cand-node-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodeType: MemoryGraphNodeType.CONCEPT,
        label: 'Kernel',
        memoryRecordId: 'mem-record-1',
        confidence: 0.8,
        provenance: validProvenance,
      };

      const edge = {
        candidateId: 'cand-edge-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        sourceNodeId: 'cand-node-1',
        targetNodeId: 'cand-node-root',
        edgeType: MemoryGraphEdgeType.DERIVED_FROM,
        confidence: 1.0,
        provenance: validProvenance,
      };

      const parsed = GraphExtractionResultSchema.parse({
        memoryRecordId: 'mem-record-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodes: [node],
        edges: [edge],
        truncated: false,
        extractedAt: now,
        executionDurationMs: 12,
      });

      assert.equal(parsed.memoryRecordId, 'mem-record-1');
      assert.equal(parsed.nodes.length, 1);
      assert.equal(parsed.edges.length, 1);
      assert.equal(parsed.truncated, false);
      assert.equal(parsed.executionDurationMs, 12);
    });

    it('2. rejects extraction result with negative duration or invalid date', () => {
      assert.throws(() => {
        GraphExtractionResultSchema.parse({
          memoryRecordId: 'mem-record-1',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          nodes: [],
          edges: [],
          truncated: false,
          extractedAt: 'not-a-datetime',
          executionDurationMs: -5,
        });
      });
    });
  });

  describe('GraphExtractorOptionsSchema', () => {
    it('1. validates options with defaults and custom overrides', () => {
      const parsed = GraphExtractorOptionsSchema.parse({
        maxInputBytes: 16384,
        maxNodes: 15,
        maxEdges: 25,
        strictSizeLimit: true,
        minConfidence: 0.6,
      });

      assert.equal(parsed.maxInputBytes, 16384);
      assert.equal(parsed.maxNodes, 15);
      assert.equal(parsed.maxEdges, 25);
      assert.equal(parsed.strictSizeLimit, true);
      assert.equal(parsed.minConfidence, 0.6);
    });
  });
});
