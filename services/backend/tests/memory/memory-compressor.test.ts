import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryClass,
  MemorySensitivity,
  MemorySourceType,
  MemoryStatus,
  LossinessClass,
  CompressionStrategy,
} from '@nexusos/contracts';
import {
  InMemoryMemoryStore,
  MemoryCompressor,
  MemoryServiceContext,
  MemoryNotFoundError,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from '../../src/memory/index.js';

describe('MemoryCompressor Subsystem', () => {
  let store: InMemoryMemoryStore;
  let compressor: MemoryCompressor;
  let ctx: MemoryServiceContext;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
    compressor = new MemoryCompressor({ store });
    ctx = {
      tenantId: 'tenant-acme',
      workspaceId: 'ws-dev',
      principalId: 'user-dev',
    };
  });

  it('performs bounded extractive compression preserving immutable citations (058-SEC-02)', async () => {
    const mem1 = await store.create({
      id: 'mem-1',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.principalId,
      class: MemoryClass.WORKING,
      status: MemoryStatus.ACTIVE,
      sensitivity: MemorySensitivity.INTERNAL,
      title: 'Database Setup',
      content:
        'Initialized Postgres database schema for tenant isolation. Created tables for tasks, runs, and artifacts. All migrations applied cleanly without errors.',
      confidence: 1.0,
      tags: ['database'],
      metadata: {},
      provenance: {
        sourceType: MemorySourceType.TASK_EXECUTION,
        sourceId: 'task-db-01',
        creatorPrincipalId: ctx.principalId,
        timestamp: new Date().toISOString(),
        verified: false,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const mem2 = await store.create({
      id: 'mem-2',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.principalId,
      class: MemoryClass.WORKING,
      status: MemoryStatus.ACTIVE,
      sensitivity: MemorySensitivity.INTERNAL,
      title: 'Cache Layer Setup',
      content:
        'Configured Redis cache with LRU eviction policy. Set maximum memory ceiling to 512MB. Health checks confirm connection latency is under 2ms.',
      confidence: 0.95,
      tags: ['cache'],
      metadata: {},
      provenance: {
        sourceType: MemorySourceType.TASK_EXECUTION,
        sourceId: 'task-cache-01',
        creatorPrincipalId: ctx.principalId,
        timestamp: new Date().toISOString(),
        verified: false,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await compressor.compress(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        sourceMemoryIds: [mem1.id, mem2.id],
        strategy: CompressionStrategy.EXTRACTIVE,
        maxTokens: 200,
      },
      ctx,
    );

    assert.ok(response.id.startsWith('comp-'));
    assert.equal(response.tenantId, ctx.tenantId);
    assert.equal(response.workspaceId, ctx.workspaceId);
    assert.equal(response.strategy, CompressionStrategy.EXTRACTIVE);
    assert.ok(response.summaryContent.length > 0);
    // 058-SEC-02: Lossiness class must be declared
    assert.ok(
      response.lossinessClass === LossinessClass.BOUNDED_LOSSY ||
        response.lossinessClass === LossinessClass.HIGH_LOSSY,
    );
    // 058-SEC-02: Citations preserved with tokens
    assert.equal(response.citations.length, 2);
    assert.equal(response.citations[0].memoryId, mem1.id);
    assert.equal(response.citations[1].memoryId, mem2.id);
    assert.ok(response.citations[0].citationToken.startsWith('CIT-'));
    assert.ok(response.citations[0].sourceHash);
  });

  it('inherits the highest sensitivity of all constituent source memories (058-SEC-04)', async () => {
    const memPublic = await store.create({
      id: 'mem-pub',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.principalId,
      class: MemoryClass.SEMANTIC,
      status: MemoryStatus.ACTIVE,
      sensitivity: MemorySensitivity.PUBLIC,
      title: 'Public Open Source Readme',
      content: 'NexusOS is an autonomous agent operating system.',
      confidence: 1.0,
      tags: ['public'],
      metadata: {},
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        creatorPrincipalId: ctx.principalId,
        timestamp: new Date().toISOString(),
        verified: false,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const memRestricted = await store.create({
      id: 'mem-rest',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.principalId,
      class: MemoryClass.SEMANTIC,
      status: MemoryStatus.ACTIVE,
      sensitivity: MemorySensitivity.RESTRICTED,
      title: 'Restricted Compliance Audit',
      content: 'Critical SOC2 compliance finding regarding encryption key rotation protocol.',
      confidence: 1.0,
      tags: ['compliance'],
      metadata: {},
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        creatorPrincipalId: ctx.principalId,
        timestamp: new Date().toISOString(),
        verified: false,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await compressor.compress(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        sourceMemoryIds: [memPublic.id, memRestricted.id],
      },
      ctx,
    );

    // 058-SEC-04: Inherited sensitivity must be RESTRICTED
    assert.equal(response.inheritedSensitivity, MemorySensitivity.RESTRICTED);
  });

  it('falls back to extractive compression if abstractive adapter fails', async () => {
    const failingAdapter = {
      async summarize(): Promise<string> {
        throw new Error('LLM model inference timed out or VRAM exhausted');
      },
    };

    const compressorWithAdapter = new MemoryCompressor({
      store,
      adapter: failingAdapter,
    });

    const mem = await store.create({
      id: 'mem-fallback',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.principalId,
      class: MemoryClass.WORKING,
      status: MemoryStatus.ACTIVE,
      sensitivity: MemorySensitivity.INTERNAL,
      title: 'Task Outcome',
      content: 'Successfully finished task verification with all 42 tests passing.',
      confidence: 1.0,
      tags: ['test'],
      metadata: {},
      provenance: {
        sourceType: MemorySourceType.TASK_EXECUTION,
        sourceId: 'task-test-01',
        creatorPrincipalId: ctx.principalId,
        timestamp: new Date().toISOString(),
        verified: false,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await compressorWithAdapter.compress(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        sourceMemoryIds: [mem.id],
        strategy: CompressionStrategy.ABSTRACTIVE,
      },
      ctx,
    );

    // Fell back to EXTRACTIVE cleanly without crashing
    assert.equal(response.strategy, CompressionStrategy.EXTRACTIVE);
    assert.ok(response.summaryContent.includes('Successfully finished task verification'));
  });

  it('rejects compression when source memory contains prohibited secrets (058-SEC-07)', async () => {
    const memWithSecret = await store.create({
      id: 'mem-leaked',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.principalId,
      class: MemoryClass.WORKING,
      status: MemoryStatus.ACTIVE,
      sensitivity: MemorySensitivity.INTERNAL,
      title: 'Database Config',
      content:
        'Database connection string: postgres://admin:password="SuperSecret123!"@localhost/db',
      confidence: 1.0,
      tags: ['db'],
      metadata: {},
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        creatorPrincipalId: ctx.principalId,
        timestamp: new Date().toISOString(),
        verified: false,
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        compressor.compress(
          {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            sourceMemoryIds: [memWithSecret.id],
          },
          ctx,
        ),
      MemorySecretDetectedError,
    );
  });

  it('rejects cross-workspace compression request fail-closed (058-SEC-03)', async () => {
    await assert.rejects(
      () =>
        compressor.compress(
          {
            tenantId: ctx.tenantId,
            workspaceId: 'other-workspace-id',
            sourceMemoryIds: ['mem-1'],
          },
          ctx,
        ),
      MemorySecurityViolationError,
    );
  });

  it('rejects compression when source memory is not found', async () => {
    await assert.rejects(
      () =>
        compressor.compress(
          {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            sourceMemoryIds: ['non-existent-memory-id'],
          },
          ctx,
        ),
      MemoryNotFoundError,
    );
  });
});
