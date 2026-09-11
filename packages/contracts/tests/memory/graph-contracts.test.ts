import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  MemoryGraphNodeSchema,
  MemoryGraphEdgeSchema,
  MemoryGraphQueryRequestSchema,
  MemorySourceType,
} from '../../src/memory/index.js';

describe('Canonical Graph Evolution Contracts (Task 066 Phase 1)', () => {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 60000).toISOString();
  const earlier = new Date(Date.now() - 60000).toISOString();

  const validProvenance = {
    sourceType: MemorySourceType.TASK_EXECUTION,
    sourceId: 'task-123',
    creatorPrincipalId: 'principal-agent-1',
    timestamp: now,
    verified: true,
  };

  describe('MemoryGraphNodeSchema', () => {
    it('1. validates new graph node with default temporal/version fields', () => {
      const parsed = MemoryGraphNodeSchema.parse({
        id: 'node-test-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodeType: MemoryGraphNodeType.CONCEPT,
        label: 'Canonical Concept',
        createdAt: now,
      });

      assert.equal(parsed.id, 'node-test-1');
      assert.equal(parsed.version, 1);
      assert.equal(parsed.isCurrent, true);
      assert.equal(parsed.validFrom, undefined);
      assert.equal(parsed.validTo, undefined);
      assert.equal(parsed.supersededBy, undefined);
      assert.equal(parsed.provenance, undefined);
    });

    it('2. validates graph node with explicit version, temporal, and canonical provenance', () => {
      const parsed = MemoryGraphNodeSchema.parse({
        id: 'node-test-2',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodeType: MemoryGraphNodeType.ENTITY,
        label: 'Historical Entity',
        version: 3,
        isCurrent: false,
        validFrom: earlier,
        validTo: now,
        supersededBy: 'node-test-3',
        provenance: validProvenance,
        createdAt: earlier,
        updatedAt: now,
      });

      assert.equal(parsed.version, 3);
      assert.equal(parsed.isCurrent, false);
      assert.equal(parsed.validFrom, earlier);
      assert.equal(parsed.validTo, now);
      assert.equal(parsed.supersededBy, 'node-test-3');
      assert.equal(parsed.provenance?.verified, true);
    });

    it('3. 066-P1-SEC-03: rejects invalid validity window (validTo < validFrom)', () => {
      assert.throws(
        () => {
          MemoryGraphNodeSchema.parse({
            id: 'node-inv-win',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            nodeType: MemoryGraphNodeType.TASK,
            label: 'Invalid Window Task',
            isCurrent: false,
            validFrom: later,
            validTo: earlier, // validTo earlier than validFrom!
            createdAt: now,
          });
        },
        (err: Error) => {
          return err.message.includes(
            '066-P1-SEC-03: validFrom must be less than or equal to validTo',
          );
        },
      );
    });

    it('4. 066-P1-SEC-03: rejects isCurrent: true when validTo is closed', () => {
      assert.throws(
        () => {
          MemoryGraphNodeSchema.parse({
            id: 'node-inv-curr-to',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            nodeType: MemoryGraphNodeType.DECISION,
            label: 'Contradictory Decision',
            isCurrent: true,
            validTo: later, // Cannot be current if validity window has end date
            createdAt: now,
          });
        },
        (err: Error) => {
          return err.message.includes(
            '066-P1-SEC-03: Current graph node cannot have a closed validity window',
          );
        },
      );
    });

    it('5. 066-P1-SEC-03: rejects isCurrent: true when supersededBy is set', () => {
      assert.throws(
        () => {
          MemoryGraphNodeSchema.parse({
            id: 'node-inv-curr-super',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            nodeType: MemoryGraphNodeType.ARTIFACT,
            label: 'Superseded but Current',
            isCurrent: true,
            supersededBy: 'node-other', // Cannot be current if already superseded
            createdAt: now,
          });
        },
        (err: Error) => {
          return err.message.includes(
            '066-P1-SEC-03: Current graph node cannot have supersededBy set when isCurrent is true',
          );
        },
      );
    });

    it('6. rejects non-positive or float version numbers', () => {
      assert.throws(() => {
        MemoryGraphNodeSchema.parse({
          id: 'node-bad-ver-0',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          nodeType: MemoryGraphNodeType.TASK,
          label: 'Zero Version',
          version: 0,
          createdAt: now,
        });
      });

      assert.throws(() => {
        MemoryGraphNodeSchema.parse({
          id: 'node-bad-ver-neg',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          nodeType: MemoryGraphNodeType.TASK,
          label: 'Negative Version',
          version: -2,
          createdAt: now,
        });
      });

      assert.throws(() => {
        MemoryGraphNodeSchema.parse({
          id: 'node-bad-ver-float',
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          nodeType: MemoryGraphNodeType.TASK,
          label: 'Float Version',
          version: 1.5,
          createdAt: now,
        });
      });
    });

    it('7. 066-P1-SEC-04: verifies default provenance verified is false when omitted', () => {
      const parsed = MemoryGraphNodeSchema.parse({
        id: 'node-unverified',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        nodeType: MemoryGraphNodeType.CONCEPT,
        label: 'Unverified Node',
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: 'user-anon',
          timestamp: now,
        },
        createdAt: now,
      });

      assert.equal(parsed.provenance?.verified, false);
    });
  });

  describe('MemoryGraphEdgeSchema', () => {
    it('1. validates new graph edge with default temporal/version fields', () => {
      const parsed = MemoryGraphEdgeSchema.parse({
        id: 'edge-test-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        provenance: validProvenance,
        createdAt: now,
      });

      assert.equal(parsed.id, 'edge-test-1');
      assert.equal(parsed.version, 1);
      assert.equal(parsed.isCurrent, true);
      assert.equal(parsed.validFrom, undefined);
      assert.equal(parsed.validTo, undefined);
      assert.equal(parsed.supersededBy, undefined);
    });

    it('2. 066-P1-SEC-03: rejects invalid validity window on edge', () => {
      assert.throws(
        () => {
          MemoryGraphEdgeSchema.parse({
            id: 'edge-inv-win',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            sourceNodeId: 'node-1',
            targetNodeId: 'node-2',
            edgeType: MemoryGraphEdgeType.SUPERSEDES,
            provenance: validProvenance,
            isCurrent: false,
            validFrom: later,
            validTo: earlier,
            createdAt: now,
          });
        },
        (err: Error) => {
          return err.message.includes(
            '066-P1-SEC-03: validFrom must be less than or equal to validTo',
          );
        },
      );
    });

    it('3. 066-P1-SEC-03: rejects isCurrent: true when edge validTo is closed', () => {
      assert.throws(
        () => {
          MemoryGraphEdgeSchema.parse({
            id: 'edge-inv-curr-to',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            sourceNodeId: 'node-1',
            targetNodeId: 'node-2',
            edgeType: MemoryGraphEdgeType.DERIVED_FROM,
            provenance: validProvenance,
            isCurrent: true,
            validTo: later,
            createdAt: now,
          });
        },
        (err: Error) => {
          return err.message.includes(
            '066-P1-SEC-03: Current graph edge cannot have a closed validity window',
          );
        },
      );
    });

    it('4. 066-P1-SEC-03: rejects isCurrent: true when edge supersededBy is set', () => {
      assert.throws(
        () => {
          MemoryGraphEdgeSchema.parse({
            id: 'edge-inv-curr-super',
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            sourceNodeId: 'node-1',
            targetNodeId: 'node-2',
            edgeType: MemoryGraphEdgeType.DERIVED_FROM,
            provenance: validProvenance,
            isCurrent: true,
            supersededBy: 'edge-other',
            createdAt: now,
          });
        },
        (err: Error) => {
          return err.message.includes(
            '066-P1-SEC-03: Current graph edge cannot have supersededBy set when isCurrent is true',
          );
        },
      );
    });
  });

  describe('MemoryGraphQueryRequestSchema', () => {
    it('validates query request with optional asOf and includeSuperseded', () => {
      const parsed = MemoryGraphQueryRequestSchema.parse({
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        asOf: earlier,
        includeSuperseded: true,
      });

      assert.equal(parsed.tenantId, 'tenant-1');
      assert.equal(parsed.workspaceId, 'ws-1');
      assert.equal(parsed.asOf, earlier);
      assert.equal(parsed.includeSuperseded, true);
    });

    it('defaults includeSuperseded to false when omitted', () => {
      const parsed = MemoryGraphQueryRequestSchema.parse({
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
      });

      assert.equal(parsed.includeSuperseded, false);
      assert.equal(parsed.asOf, undefined);
    });
  });
});
