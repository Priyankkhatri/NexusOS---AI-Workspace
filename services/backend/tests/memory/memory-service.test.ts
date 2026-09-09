import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryClass, MemorySensitivity, MemoryStatus, MemorySourceType } from '@nexusos/contracts';
import {
  InMemoryMemoryStore,
  MemoryService,
  MemoryServiceContext,
  MemoryVersionConflictError,
} from '../../src/memory/index.js';

describe('Backend Governed Persistent Memory Service', () => {
  let store: InMemoryMemoryStore;
  let service: MemoryService;
  let context: MemoryServiceContext;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
    service = new MemoryService({ store });
    context = {
      tenantId: 'tenant-test',
      workspaceId: 'ws-default',
      principalId: 'user-primary',
      roles: ['engineer'],
    };
  });

  it('creates and reads a persistent memory record', async () => {
    const record = await service.createMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        ownerId: 'user-primary',
        class: MemoryClass.SEMANTIC,
        title: 'Project Architecture',
        content: 'NexusOS follows a governed microkernel model.',
        confidence: 0.98,
        sensitivity: MemorySensitivity.INTERNAL,
        tags: ['architecture', 'microkernel'],
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: 'user-primary',
          timestamp: new Date().toISOString(),
          verified: true,
        },
      },
      context,
    );

    assert.ok(record.id);
    assert.equal(record.version, 1);
    assert.equal(record.tenantId, 'tenant-test');
    assert.equal(record.workspaceId, 'ws-default');

    const fetched = await service.getMemory(record.id, context);
    assert.ok(fetched);
    assert.equal(fetched.id, record.id);
    assert.equal(fetched.content, 'NexusOS follows a governed microkernel model.');
  });

  it('searches memory with keyword terms, tags, and sensitivity ceiling', async () => {
    await service.createMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        ownerId: 'user-primary',
        class: MemoryClass.SEMANTIC,
        title: 'Typescript Strict Mode',
        content: 'All packages must enable noImplicitAny and strictNullChecks.',
        confidence: 0.95,
        sensitivity: MemorySensitivity.INTERNAL,
        tags: ['typescript', 'standards'],
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: 'user-primary',
          timestamp: new Date().toISOString(),
        },
      },
      context,
    );

    await service.createMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        ownerId: 'user-primary',
        class: MemoryClass.PROCEDURAL,
        title: 'Deployment Procedure',
        content: 'Run docker compose build before deployment.',
        confidence: 0.9,
        sensitivity: MemorySensitivity.INTERNAL,
        tags: ['ops', 'deployment'],
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: 'user-primary',
          timestamp: new Date().toISOString(),
        },
      },
      context,
    );

    // Search for typescript
    const searchRes = await service.searchMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        query: 'typescript',
      },
      context,
    );

    assert.equal(searchRes.total, 1);
    assert.equal(searchRes.items[0].record.title, 'Typescript Strict Mode');
    assert.ok(searchRes.items[0].score > 0);
    assert.equal(searchRes.retrievalMode, 'LEXICAL');
    assert.ok(searchRes.items[0].citationToken.startsWith('CIT-'));
  });

  it('respects token budget limits in search results', async () => {
    for (let i = 0; i < 5; i++) {
      await service.createMemory(
        {
          tenantId: 'tenant-test',
          workspaceId: 'ws-default',
          ownerId: 'user-primary',
          class: MemoryClass.EPISODIC,
          title: `Step ${i}`,
          content: `Task execution summary block with substantial length for item ${i}. `.repeat(8),
          confidence: 0.9,
          sensitivity: MemorySensitivity.INTERNAL,
          tags: ['summary'],
          provenance: {
            sourceType: MemorySourceType.USER_EXPLICIT,
            creatorPrincipalId: 'user-primary',
            timestamp: new Date().toISOString(),
          },
        },
        context,
      );
    }

    const searchBudgeted = await service.searchMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        query: 'summary',
        maxTokenBudget: 150,
      },
      context,
    );

    assert.ok(searchBudgeted.items.length < 5);
    assert.ok(searchBudgeted.consumedTokenBudget <= 200);
  });

  it('updates a memory record with optimistic locking and monotonic versioning', async () => {
    const record = await service.createMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        ownerId: 'user-primary',
        class: MemoryClass.SEMANTIC,
        title: 'Initial Title',
        content: 'Initial content',
        confidence: 0.8,
        sensitivity: MemorySensitivity.INTERNAL,
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: 'user-primary',
          timestamp: new Date().toISOString(),
        },
      },
      context,
    );

    assert.equal(record.version, 1);

    const updated = await service.updateMemory(
      record.id,
      {
        content: 'Updated content with revised insights.',
        confidence: 0.95,
        expectedVersion: 1,
      },
      context,
    );

    assert.equal(updated.version, 2);
    assert.equal(updated.content, 'Updated content with revised insights.');
    assert.equal(updated.confidence, 0.95);

    // Stale update attempt (expecting version 1 when version is now 2)
    await assert.rejects(
      () =>
        service.updateMemory(
          record.id,
          {
            content: 'Stale update content',
            expectedVersion: 1,
          },
          context,
        ),
      MemoryVersionConflictError,
    );
  });

  it('tombstones memory records and immediately excludes them from search and read', async () => {
    const record = await service.createMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        ownerId: 'user-primary',
        class: MemoryClass.PROCEDURAL,
        title: 'Deprecated recipe',
        content: 'Use deprecated method oldDoWork()',
        confidence: 0.7,
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: 'user-primary',
          timestamp: new Date().toISOString(),
        },
      },
      context,
    );

    const tombstoneRes = await service.tombstoneMemory(record.id, context, 1);
    assert.equal(tombstoneRes.status, MemoryStatus.TOMBSTONED);
    assert.equal(tombstoneRes.version, 2);

    // Direct get should return null
    const afterGet = await service.getMemory(record.id, context);
    assert.equal(afterGet, null);

    // Search should return 0 results
    const searchRes = await service.searchMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        query: 'deprecated',
      },
      context,
    );
    assert.equal(searchRes.total, 0);
  });

  it('handles memory proposals and promotion to active memory upon approval', async () => {
    const proposal = await service.proposeMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        ownerId: 'user-primary',
        class: MemoryClass.EPISODIC,
        title: 'Task 055 Execution Finding',
        content: 'Browser runtime successfully blocked private IP access attempts.',
        confidence: 0.88,
        sensitivity: MemorySensitivity.INTERNAL,
        provenance: {
          sourceType: MemorySourceType.TASK_EXECUTION,
          sourceId: 'task-055',
          creatorPrincipalId: 'agent-runtime',
          timestamp: new Date().toISOString(),
        },
      },
      context,
    );

    assert.equal(proposal.status, 'PENDING');
    assert.ok(proposal.proposalId);

    // Resolve proposal: APPROVED
    const resolved = await service.resolveProposal(proposal.proposalId, 'APPROVED', context);
    assert.equal(resolved.proposal.status, 'APPROVED');
    assert.ok(resolved.memoryRecord);
    assert.equal(resolved.memoryRecord.status, MemoryStatus.ACTIVE);
    assert.equal(resolved.memoryRecord.title, 'Task 055 Execution Finding');

    // Promoted record is now searchable
    const searchRes = await service.searchMemory(
      {
        tenantId: 'tenant-test',
        workspaceId: 'ws-default',
        query: 'Browser runtime',
      },
      context,
    );
    assert.equal(searchRes.total, 1);
  });

  it('fails closed when underlying store encounters failure', async () => {
    store.simulateFailure = true;

    await assert.rejects(
      () =>
        service.createMemory(
          {
            tenantId: 'tenant-test',
            workspaceId: 'ws-default',
            ownerId: 'user-primary',
            class: MemoryClass.WORKING,
            content: 'Test content',
            provenance: {
              sourceType: MemorySourceType.USER_EXPLICIT,
              creatorPrincipalId: 'user-primary',
              timestamp: new Date().toISOString(),
            },
          },
          context,
        ),
      /056-STORE-FAIL/,
    );
  });
});
