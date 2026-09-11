import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryRecord,
  MemoryClass,
  MemorySensitivity,
  MemoryStatus,
  MemorySourceType,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
} from '@nexusos/contracts';
import { GraphExtractor, MemoryExtractionPayloadExceededError } from '../../src/memory/index.js';

describe('GraphExtractor Unit Tests (Task 066 Phase 2)', () => {
  const extractor = new GraphExtractor();

  const createTestRecord = (overrides?: Partial<MemoryRecord>): MemoryRecord => {
    const now = '2026-09-11T00:00:00.000Z';
    return {
      id: 'mem-record-100',
      tenantId: 'tenant-test',
      workspaceId: 'ws-test',
      ownerId: 'owner-test',
      class: MemoryClass.SEMANTIC,
      confidence: 1.0,
      metadata: {},
      title: 'Database Architecture Overview',
      content: 'This document describes the SqliteMemoryStore and how it handles persistence.',
      tags: ['database', 'sqlite'],
      sensitivity: MemorySensitivity.INTERNAL,
      status: MemoryStatus.ACTIVE,
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        sourceId: 'src-1',
        creatorPrincipalId: 'principal-engineer-1',
        timestamp: now,
        verified: true,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  };

  describe('Entity & Concept Extraction', () => {
    it('1. extracts file paths, URLs, error codes, and code tokens', () => {
      const record = createTestRecord({
        content: `
          The service crashed with ERR_TIMEOUT when accessing https://api.nexus.internal:8080/v1.
          Inspect the log file at services/backend/src/memory/sqlite-memory-store.ts for details.
          The agent-orchestrator process handles replication via retryConnection.
        `,
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });

      const nodeLabels = result.nodes.map((n) => n.label);
      const nodeTypes = new Set(result.nodes.map((n) => n.nodeType));

      // Root atom is present
      assert.ok(nodeLabels.some((l) => l.includes('Database Architecture Overview')));

      // File path
      assert.ok(nodeLabels.includes('services/backend/src/memory/sqlite-memory-store.ts'));
      // URL
      assert.ok(nodeLabels.includes('https://api.nexus.internal:8080/v1'));
      // Error code
      assert.ok(nodeLabels.includes('ERR_TIMEOUT'));
      assert.ok(nodeTypes.has(MemoryGraphNodeType.ERROR_PATTERN));
      // Code tokens (kebab-case or camelCase)
      assert.ok(
        nodeLabels.includes('agent-orchestrator') || nodeLabels.includes('retryConnection'),
      );
    });

    it('2. extracts concepts from tags, title, and bracketed markdown markers', () => {
      const record = createTestRecord({
        title: 'Network Gateway Configuration',
        tags: ['networking', 'security'],
        content: 'System uses [Security Perimeter] and [Token Verifier] for validation.',
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const conceptNodes = result.nodes.filter((n) => n.nodeType === MemoryGraphNodeType.CONCEPT);
      const conceptLabels = conceptNodes.map((n) => n.label);

      assert.ok(conceptLabels.includes('networking'));
      assert.ok(conceptLabels.includes('security'));
      assert.ok(conceptLabels.includes('Security Perimeter'));
      assert.ok(conceptLabels.includes('Token Verifier'));
      assert.ok(conceptLabels.includes('Network Gateway Configuration'));
    });

    it('3. does not extract markdown links as bracketed concepts', () => {
      const record = createTestRecord({
        content: 'Check documentation at [NexusOS Docs](https://nexusos.internal/docs).',
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const conceptLabels = result.nodes
        .filter((n) => n.nodeType === MemoryGraphNodeType.CONCEPT)
        .map((n) => n.label);
      const allLabels = result.nodes.map((n) => n.label);

      // Should not extract 'NexusOS Docs' as a bracketed concept
      assert.ok(!conceptLabels.includes('NexusOS Docs'));
      assert.ok(allLabels.includes('https://nexusos.internal/docs'));
    });

    it('4. extracts capitalized proper nouns safely excluding stop words', () => {
      const record = createTestRecord({
        content: 'However, PostgreSQL Database must be configured before NexusOS Engine can start.',
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const labels = result.nodes.map((n) => n.label);

      assert.ok(labels.includes('PostgreSQL Database'));
      assert.ok(labels.includes('NexusOS Engine'));
      // Sentence starter 'However' should not be extracted
      assert.ok(!labels.includes('However'));
    });
  });

  describe('Relationship Extraction', () => {
    it('1. generates DERIVED_FROM edges from all extracted nodes to root atom', () => {
      const record = createTestRecord({
        content: 'Error ERR_GATEWAY occurred at https://gateway.internal/auth.',
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const rootNode = result.nodes.find((n) => n.properties.isSourceAtom === true);
      assert.ok(rootNode);

      const derivedEdges = result.edges.filter(
        (e) =>
          e.edgeType === MemoryGraphEdgeType.DERIVED_FROM &&
          e.targetNodeId === rootNode.candidateId,
      );

      // Every non-root node should have a DERIVED_FROM edge to root
      const nonRootNodes = result.nodes.filter((n) => n.candidateId !== rootNode.candidateId);
      assert.equal(derivedEdges.length, nonRootNodes.length);
    });

    it('2. derives RESOLVED_BY and EXECUTED_BY from semantic cues', () => {
      const record = createTestRecord({
        tags: [],
        content: `
          Patch hotfix-v2 fixes ERR_NULL_POINTER.
          Worker task-scheduler executed by NodeCluster.
        `,
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const edgeTypes = new Set(result.edges.map((e) => e.edgeType));

      assert.ok(edgeTypes.has(MemoryGraphEdgeType.RESOLVED_BY));
      assert.ok(edgeTypes.has(MemoryGraphEdgeType.EXECUTED_BY));
    });

    it('3. derives RELATES_TO with depends_on semantic cue', () => {
      const record = createTestRecord({
        tags: [],
        content: 'Component AuthGateway depends on TokenService for verification.',
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const dependsEdges = result.edges.filter(
        (e) =>
          e.edgeType === MemoryGraphEdgeType.RELATES_TO && e.properties.relation === 'depends_on',
      );

      assert.ok(dependsEdges.length > 0);
    });

    it('4. derives sentence-bounded co-occurrence RELATES_TO edges', () => {
      const record = createTestRecord({
        tags: [],
        content: 'Both TokenService and UserRegistry operate under the same realm.',
      });

      const result = extractor.extractSync(record, { extractedAt: '2026-09-11T00:00:00.000Z' });
      const cooccurEdges = result.edges.filter(
        (e) =>
          e.edgeType === MemoryGraphEdgeType.RELATES_TO &&
          e.properties.relation === 'co_occurrence_sentence',
      );

      assert.ok(cooccurEdges.length > 0);
    });
  });

  describe('Bounds, Clamping & Truncation', () => {
    it('1. clamps candidates to maximum 20 nodes and maximum 30 edges', () => {
      // Create content with 50 distinct identifiers
      const identifiers = Array.from({ length: 50 }, (_, i) => `service-worker-module-${i}`).join(
        ' ',
      );
      const record = createTestRecord({
        content: identifiers,
      });

      const result = extractor.extractSync(record, { maxNodes: 20, maxEdges: 30 });

      assert.ok(result.nodes.length <= 20);
      assert.ok(result.edges.length <= 30);

      // Verify edge referential integrity (no dangling edges)
      const nodeIds = new Set(result.nodes.map((n) => n.candidateId));
      for (const edge of result.edges) {
        assert.ok(nodeIds.has(edge.sourceNodeId), `Edge source ${edge.sourceNodeId} missing`);
        assert.ok(nodeIds.has(edge.targetNodeId), `Edge target ${edge.targetNodeId} missing`);
      }
    });

    it('2. safely truncates input exceeding 32 KB without error when strictSizeLimit is false', () => {
      const largeContent = 'const tokenService = true; '.repeat(2000); // > 50 KB
      assert.ok(Buffer.byteLength(largeContent, 'utf8') > 32768);

      const record = createTestRecord({ content: largeContent });
      const result = extractor.extractSync(record, { strictSizeLimit: false });

      assert.equal(result.truncated, true);
      assert.ok(result.nodes.length > 0);
    });

    it('3. throws MemoryExtractionPayloadExceededError when strictSizeLimit is true', () => {
      const largeContent = 'x'.repeat(33000);
      const record = createTestRecord({ content: largeContent });

      assert.throws(
        () => {
          extractor.extractSync(record, { strictSizeLimit: true });
        },
        (err: unknown) => {
          assert.ok(err instanceof MemoryExtractionPayloadExceededError);
          assert.equal(err.code, 'MEMORY_EXTRACTION_PAYLOAD_EXCEEDED');
          assert.ok(err.message.includes('066-SEC-05'));
          return true;
        },
      );
    });

    it('4. safe UTF-8 truncation never splits multibyte sequences', () => {
      // Create a string with multibyte characters right at the 32 KB boundary
      // '🚀' is 4 bytes in UTF-8
      const pad = 'a'.repeat(32766);
      const content = pad + '🚀🚀🚀'; // 32766 + 12 = 32778 bytes

      const record = createTestRecord({ content });
      const result = extractor.extractSync(record, {
        maxInputBytes: 32768,
        strictSizeLimit: false,
      });

      assert.equal(result.truncated, true);
      // Ensure no replacement characters (\uFFFD) from split UTF-8
      assert.ok(!result.nodes.some((n) => n.label.includes('\uFFFD')));
    });
  });

  describe('Determinism & Normalization', () => {
    it('1. produces byte-identical candidates and order across repeated runs', () => {
      const record = createTestRecord({
        content: `
          The service worker at services/backend/src/memory/graph-extractor.ts handles candidate extraction.
          It throws ERR_PAYLOAD_LIMIT when payload is exceeded.
          Refer to https://nexus.internal/docs for details.
        `,
      });

      const fixedTime = '2026-09-11T10:00:00.000Z';
      const result1 = extractor.extractSync(record, { extractedAt: fixedTime });
      const result2 = extractor.extractSync(record, { extractedAt: fixedTime });

      assert.deepEqual(result1.nodes, result2.nodes);
      assert.deepEqual(result1.edges, result2.edges);
      assert.equal(JSON.stringify(result1.nodes), JSON.stringify(result2.nodes));
      assert.equal(JSON.stringify(result1.edges), JSON.stringify(result2.edges));
    });

    it('2. collapses duplicates and preserves highest confidence', () => {
      const record = createTestRecord({
        tags: ['DatabaseModule'], // confidence 1.0
        content: 'We use DatabaseModule and database-module across services.',
      });

      const result = extractor.extractSync(record);
      // Both tag and text mention DatabaseModule; should collapse to single concept node
      const dbNodes = result.nodes.filter((n) => n.label.toLowerCase().includes('databasemodule'));
      assert.ok(dbNodes.length <= 1);
      if (dbNodes.length === 1) {
        assert.equal(dbNodes[0]!.confidence, 1.0);
      }
    });
  });

  describe('Provenance & Sensitivity Inheritance', () => {
    it('1. inherits sensitivity and enforces verified: false on all candidates', () => {
      const record = createTestRecord({
        sensitivity: MemorySensitivity.CONFIDENTIAL,
        content: 'Secret project codename ProjectApollo operates on cluster-worker-node.',
      });

      const result = extractor.extractSync(record);

      for (const node of result.nodes) {
        assert.equal(node.properties.sensitivity, MemorySensitivity.CONFIDENTIAL);
        assert.equal(node.provenance.verified, false);
        assert.equal(node.provenance.sourceId, record.id);
        assert.equal(node.tenantId, record.tenantId);
        assert.equal(node.workspaceId, record.workspaceId);
      }

      for (const edge of result.edges) {
        assert.equal(edge.properties.sensitivity, MemorySensitivity.CONFIDENTIAL);
        assert.equal(edge.provenance.verified, false);
        assert.equal(edge.provenance.sourceId, record.id);
        assert.equal(edge.tenantId, record.tenantId);
        assert.equal(edge.workspaceId, record.workspaceId);
      }
    });
  });

  describe('Malformed & Edge-Case Inputs', () => {
    it('1. handles empty content and whitespace gracefully', () => {
      const record = createTestRecord({ title: '', content: '   \n\t   ', tags: [] });
      const result = extractor.extractSync(record);

      assert.ok(result);
      assert.ok(result.nodes.length >= 1); // Only root atom
      assert.equal(result.edges.length, 0);
    });

    it('2. handles control characters and stripped glyphs safely', () => {
      const record = createTestRecord({
        content: 'Text with control \x00\x01\x02\x08\x0B\x0C chars and valid TokenValidator.',
      });
      const result = extractor.extractSync(record);
      const labels = result.nodes.map((n) => n.label);

      assert.ok(labels.includes('TokenValidator'));
      // eslint-disable-next-line no-control-regex
      assert.ok(!labels.some((l) => /[\x00-\x08]/.test(l)));
    });

    it('3. async extract wrapper matches extractSync result', async () => {
      const record = createTestRecord();
      const fixedTime = '2026-09-11T12:00:00.000Z';
      const syncResult = extractor.extractSync(record, { extractedAt: fixedTime });
      const asyncResult = await extractor.extract(record, { extractedAt: fixedTime });

      assert.deepEqual(asyncResult.nodes, syncResult.nodes);
      assert.deepEqual(asyncResult.edges, syncResult.edges);
    });
  });
});
