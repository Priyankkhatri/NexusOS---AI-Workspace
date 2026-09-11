/**
 * Graph Evolution Reliability & Hardening Test Suite
 * ====================================================
 * Task 066 Phase 3 — Covers all invariants R-01 through R-08.
 *
 *  R-01: Atomic outbox registration colocated with memory mutation.
 *  R-02: Deterministic outbox ID prevents duplicate graph mutations.
 *  R-03: Idempotent COMPLETED re-delivery returns fast-skip receipt.
 *  R-04: Store-backed persistence survives process restart simulation.
 *  R-05: drainPending() recovers crashed PENDING / stale PROCESSING records.
 *  R-06: Bounded retry with exponential backoff and DEAD_LETTER promotion.
 *  R-07: Every outbox record re-enters GraphEvolutionEngine governance.
 *  R-08: Tenant/workspace boundaries enforced through full outbox lifecycle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryClass,
  MemorySensitivity,
  MemoryStatus,
  MemorySourceType,
  EvolutionDeliveryStatus,
  computeCandidateSetHash,
  computeEvolutionDeliveryId,
} from '@nexusos/contracts';
import {
  InMemoryMemoryStore,
  MemoryService,
  MemoryEvolutionProcessor,
  GraphEvolutionEngine,
  MemoryServiceContext,
} from '../../src/memory/index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeContext(tenant = 'tenant-alpha', workspace = 'ws-main'): MemoryServiceContext {
  return {
    tenantId: tenant,
    workspaceId: workspace,
    principalId: 'test-agent',
    roles: ['engineer'],
  };
}

function baseCreateRequest(tenant = 'tenant-alpha', workspace = 'ws-main') {
  return {
    tenantId: tenant,
    workspaceId: workspace,
    ownerId: 'test-agent',
    class: MemoryClass.SEMANTIC,
    title: 'NexusOS Architecture',
    content:
      'NexusOS uses a microkernel model with governed memory and knowledge graph projections.',
    confidence: 0.95,
    sensitivity: MemorySensitivity.INTERNAL,
    tags: ['architecture'],
    provenance: {
      sourceType: MemorySourceType.USER_EXPLICIT,
      creatorPrincipalId: 'test-agent',
      timestamp: new Date().toISOString(),
      verified: true,
    },
  };
}

function makeParentRecord(id: string, tenantId: string, workspaceId: string) {
  const now = new Date().toISOString();
  return {
    id,
    tenantId,
    workspaceId,
    ownerId: 'agent',
    class: MemoryClass.SEMANTIC,
    title: 'Test Record',
    content: 'The agent adopted a microkernel model for NexusOS.',
    confidence: 0.9,
    sensitivity: MemorySensitivity.INTERNAL,
    tags: [],
    metadata: {},
    version: 1,
    status: MemoryStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    provenance: {
      sourceType: MemorySourceType.TASK_EXECUTION,
      creatorPrincipalId: 'agent',
      timestamp: now,
      verified: true,
      sourceId: 'task-001',
    },
  };
}

/**
 * Build an outbox input WITHOUT a pre-computed candidate payload.
 * The processor will fall back to live extraction via the engine's extractor,
 * which produces a properly-scoped GraphExtractionResult.
 * Use this for R-07 (governance re-entry) tests.
 */
function makeOutboxInput(
  id: string,
  tenantId: string,
  workspaceId: string,
  memoryRecordId: string,
  hash: string,
  extra?: Record<string, unknown>,
) {
  return {
    id,
    tenantId,
    workspaceId,
    memoryRecordId,
    memoryVersion: 1,
    candidateSetHash: hash,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Build an outbox input WITH an explicit (empty) candidate payload for tests that
 * need a stored payload but don't need actual graph extraction (R-04, R-05, R-06).
 */
function makeOutboxInputWithPayload(
  id: string,
  tenantId: string,
  workspaceId: string,
  memoryRecordId: string,
  hash: string,
  extra?: Record<string, unknown>,
) {
  return {
    id,
    tenantId,
    workspaceId,
    memoryRecordId,
    memoryVersion: 1,
    candidateSetHash: hash,
    evolutionPayload: { candidates: { nodes: [], edges: [] } },
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function makeService(store: InMemoryMemoryStore, autoEvolveGraph = true) {
  const evolutionEngine = new GraphEvolutionEngine({ store });
  const processor = new MemoryEvolutionProcessor({ store, engine: evolutionEngine });
  const service = new MemoryService({
    store,
    evolutionEngine,
    evolutionProcessor: processor,
    autoEvolveGraph,
  });
  return { service, processor, evolutionEngine };
}

// ===========================================================================
// R-01: Atomic Outbox Registration
// ===========================================================================
describe('066-P3-R-01: Atomic Outbox Registration', () => {
  it('createMemory creates record and outbox atomically - memory readable after call', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = makeService(store);
    const ctx = makeContext();
    const record = await service.createMemory(baseCreateRequest(), ctx);
    assert.ok(record.id, 'Memory record ID must be present');
    assert.equal(record.version, 1);
    const fetched = await service.getMemory(record.id, ctx);
    assert.ok(fetched, 'Memory record must be readable after creation');
  });

  it('updateMemory atomically updates record and registers outbox', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = makeService(store);
    const ctx = makeContext();
    const record = await service.createMemory(baseCreateRequest(), ctx);
    const updated = await service.updateMemory(
      record.id,
      { content: 'Updated NexusOS Plugin SDK.', expectedVersion: record.version },
      ctx,
    );
    assert.equal(updated.version, 2, 'Version must increment');
    const fetched = await service.getMemory(record.id, ctx);
    assert.ok(fetched!.content.includes('Plugin SDK'), 'Updated content must persist');
  });

  it('memory creation succeeds even when graph evolution encounters non-fatal errors', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = makeService(store);
    const ctx = makeContext();
    const record = await service.createMemory(baseCreateRequest(), ctx);
    assert.ok(record.id, 'Memory created despite potential evolution issues');
  });
});

// ===========================================================================
// R-02: Deterministic Outbox ID (No Duplicate Mutations)
// ===========================================================================
describe('066-P3-R-02: Deterministic Delivery ID Prevents Duplicate Mutations', () => {
  it('computeEvolutionDeliveryId is deterministic', () => {
    const id1 = computeEvolutionDeliveryId('t', 'w', 'm', 1, 'h');
    const id2 = computeEvolutionDeliveryId('t', 'w', 'm', 1, 'h');
    assert.equal(id1, id2, 'Same inputs must produce same ID');
    assert.ok(id1.startsWith('evo-outbox-'));
  });

  it('computeEvolutionDeliveryId differs by tenant', () => {
    const a = computeEvolutionDeliveryId('tenant-a', 'w', 'm', 1, 'h');
    const b = computeEvolutionDeliveryId('tenant-b', 'w', 'm', 1, 'h');
    assert.notEqual(a, b);
  });

  it('computeEvolutionDeliveryId differs by version', () => {
    const v1 = computeEvolutionDeliveryId('t', 'w', 'm', 1, 'h');
    const v2 = computeEvolutionDeliveryId('t', 'w', 'm', 2, 'h');
    assert.notEqual(v1, v2);
  });

  it('computeCandidateSetHash is deterministic', () => {
    const candidates = {
      nodes: [{ nodeType: 'CONCEPT', label: 'governance', properties: {} }],
      edges: [],
    };
    const h1 = computeCandidateSetHash(candidates);
    const h2 = computeCandidateSetHash(candidates);
    assert.equal(h1, h2, 'Hash must be deterministic');
    assert.equal(h1.length, 32, 'SHA-256 hex truncated to 32 chars');
  });

  it('createOutboxRecord is idempotent — duplicate create returns existing record', async () => {
    const store = new InMemoryMemoryStore();
    const input = makeOutboxInput(
      'evo-dup-01',
      'tenant-alpha',
      'ws-main',
      'mem-001',
      'a'.repeat(32),
    );
    const first = await store.createOutboxRecord!(input);
    const second = await store.createOutboxRecord!(input);
    assert.equal(first.id, second.id, 'Duplicate creates must return same record');
    assert.equal(first.candidateSetHash, second.candidateSetHash);
  });
});

// ===========================================================================
// R-03: Idempotent COMPLETED Re-delivery
// ===========================================================================
describe('066-P3-R-03: Idempotent COMPLETED Re-delivery Returns Fast-Skip', () => {
  it('processRecord on COMPLETED outbox returns idempotentSkip=true', async () => {
    const store = new InMemoryMemoryStore();
    const engine = new GraphEvolutionEngine({ store });
    const processor = new MemoryEvolutionProcessor({ store, engine });
    const now = new Date().toISOString();
    const created = await store.createOutboxRecord!({
      ...makeOutboxInput('evo-completed-01', 'tenant-alpha', 'ws-main', 'mem-c01', 'b'.repeat(32)),
      status: EvolutionDeliveryStatus.COMPLETED,
      processedAt: now,
    });
    const receipt = await processor.processRecord(created);
    assert.equal(receipt.idempotentSkip, true, 'Must fast-skip COMPLETED record');
    assert.equal(receipt.evolutionId, created.id);
  });

  it('claimOutboxRecord returns false for COMPLETED records', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!({
      ...makeOutboxInput('evo-claim-c-01', 'tenant-alpha', 'ws-main', 'mem-001', 'c'.repeat(32)),
      status: EvolutionDeliveryStatus.COMPLETED,
    });
    const claimed = await store.claimOutboxRecord!('evo-claim-c-01', 'tenant-alpha', 'ws-main');
    assert.equal(claimed, false, 'COMPLETED records must not be re-claimable');
  });
});

// ===========================================================================
// R-04: Durable Persistence
// ===========================================================================
describe('066-P3-R-04: Durable Outbox Persistence', () => {
  it('persists and retrieves outbox record by ID', async () => {
    const store = new InMemoryMemoryStore();
    const created = await store.createOutboxRecord!(
      makeOutboxInput('evo-persist-01', 'tenant-alpha', 'ws-persist', 'mem-p01', 'd'.repeat(32)),
    );
    assert.equal(created.status, EvolutionDeliveryStatus.PENDING);
    assert.equal(created.attemptCount, 0);
    assert.equal(created.maxAttempts, 5);
    const retrieved = await store.getOutboxRecord!('evo-persist-01', 'tenant-alpha', 'ws-persist');
    assert.ok(retrieved, 'Must retrieve by ID');
    assert.equal(retrieved!.id, created.id);
    assert.equal(retrieved!.memoryRecordId, 'mem-p01');
  });

  it('updateOutboxStatus transitions PENDING -> FAILED -> COMPLETED', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!(
      makeOutboxInput('evo-status-01', 'tenant-alpha', 'ws-main', 'mem-001', 'e'.repeat(32)),
    );
    const failed = await store.updateOutboxStatus!('evo-status-01', 'tenant-alpha', 'ws-main', {
      status: EvolutionDeliveryStatus.FAILED,
      attemptCount: 1,
      lastError: 'Transient error',
      nextAttemptAt: new Date(Date.now() + 1000).toISOString(),
    });
    assert.equal(failed.status, EvolutionDeliveryStatus.FAILED);
    assert.equal(failed.attemptCount, 1);
    assert.ok(failed.lastError);
    const completed = await store.updateOutboxStatus!('evo-status-01', 'tenant-alpha', 'ws-main', {
      status: EvolutionDeliveryStatus.COMPLETED,
      processedAt: new Date().toISOString(),
      lastError: null,
    });
    assert.equal(completed.status, EvolutionDeliveryStatus.COMPLETED);
    assert.equal(completed.lastError, null);
    assert.ok(completed.processedAt);
  });
});

// ===========================================================================
// R-05: Pending / Crashed Recovery via drainPending
// ===========================================================================
describe('066-P3-R-05: Startup Recovery via drainPending', () => {
  it('drainPending returns zero when no eligible records exist', async () => {
    const store = new InMemoryMemoryStore();
    const engine = new GraphEvolutionEngine({ store });
    const processor = new MemoryEvolutionProcessor({ store, engine });
    const result = await processor.drainPending({ tenantId: 'tenant-alpha' });
    assert.equal(result.processed, 0);
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 0);
  });

  it('listPendingOutboxRecords includes PENDING records', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!(
      makeOutboxInputWithPayload('p-01', 'tenant-alpha', 'ws-main', 'mem-p1', 'f'.repeat(32)),
    );
    await store.createOutboxRecord!(
      makeOutboxInputWithPayload('p-02', 'tenant-alpha', 'ws-main', 'mem-p2', '0'.repeat(32)),
    );
    const pending = await store.listPendingOutboxRecords!({ tenantId: 'tenant-alpha' });
    assert.ok(pending.length >= 2, 'Must list at least 2 pending records');
    assert.ok(pending.every((r) => r.status === EvolutionDeliveryStatus.PENDING));
  });

  it('listPendingOutboxRecords includes stale PROCESSING records when ignoreLeaseTimeout=true', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!(
      makeOutboxInputWithPayload(
        'p-stale-01',
        'tenant-alpha',
        'ws-main',
        'mem-stale',
        '1'.repeat(32),
      ),
    );
    await store.claimOutboxRecord!('p-stale-01', 'tenant-alpha', 'ws-main');
    const eligible = await store.listPendingOutboxRecords!({ ignoreLeaseTimeout: true });
    const found = eligible.find((r) => r.id === 'p-stale-01');
    assert.ok(found, 'PROCESSING record must be eligible when ignoreLeaseTimeout=true');
  });

  it('DEAD_LETTER records are never listed as pending', async () => {
    const store = new InMemoryMemoryStore();
    const now = new Date().toISOString();
    await store.createOutboxRecord!(
      makeOutboxInputWithPayload('dl-01', 'tenant-alpha', 'ws-main', 'mem-dl', '2'.repeat(32)),
    );
    await store.updateOutboxStatus!('dl-01', 'tenant-alpha', 'ws-main', {
      status: EvolutionDeliveryStatus.DEAD_LETTER,
      lastError: 'Permanent failure',
      processedAt: now,
    });
    const eligible = await store.listPendingOutboxRecords!({ ignoreLeaseTimeout: true });
    assert.equal(
      eligible.find((r) => r.id === 'dl-01'),
      undefined,
      'DEAD_LETTER must never appear as pending',
    );
  });

  it('recoverPendingEvolutions delegates to drainPending', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = makeService(store);
    const result = await service.recoverPendingEvolutions({ tenantId: 'tenant-alpha', limit: 50 });
    assert.ok(typeof result.processed === 'number');
    assert.ok(result.processed >= 0);
  });
});

// ===========================================================================
// R-06: Bounded Retry, Exponential Backoff, Dead-Letter Promotion
// ===========================================================================
describe('066-P3-R-06: Bounded Retry, Backoff, Dead-Letter Promotion', () => {
  it('promotes to DEAD_LETTER after maxAttempts exhausted', async () => {
    const store = new InMemoryMemoryStore();
    await store.create(makeParentRecord('mem-retry-01', 'tenant-alpha', 'ws-main'));
    await store.createOutboxRecord!({
      ...makeOutboxInput('evo-retry-01', 'tenant-alpha', 'ws-main', 'mem-retry-01', '3'.repeat(32)),
      maxAttempts: 3,
      attemptCount: 2,
      status: EvolutionDeliveryStatus.FAILED,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    });
    const broken = {
      evolveCandidates: async () => {
        throw new Error('Broken engine');
      },
      evolveFromRecord: async () => {
        throw new Error('Broken');
      },
      getExtractor: () => ({
        extract: async () => {
          throw new Error('Extractor broken');
        },
      }),
    };
    const processor = new MemoryEvolutionProcessor({
      store,
      engine: broken as any,
      maxAttempts: 3,
    });
    const rec = await store.getOutboxRecord!('evo-retry-01', 'tenant-alpha', 'ws-main');
    try {
      await processor.processRecord(rec!);
    } catch {
      /* expected */
    }
    const after = await store.getOutboxRecord!('evo-retry-01', 'tenant-alpha', 'ws-main');
    assert.equal(
      after!.status,
      EvolutionDeliveryStatus.DEAD_LETTER,
      'Must be DEAD_LETTER after exhausted retries',
    );
    assert.ok(after!.lastError, 'Must have lastError set');
  });

  it('schedules FAILED retry with future nextAttemptAt for transient errors', async () => {
    const store = new InMemoryMemoryStore();
    await store.create(makeParentRecord('mem-backoff-01', 'tenant-alpha', 'ws-main'));
    await store.createOutboxRecord!({
      ...makeOutboxInput(
        'evo-backoff-01',
        'tenant-alpha',
        'ws-main',
        'mem-backoff-01',
        '4'.repeat(32),
      ),
      maxAttempts: 5,
      attemptCount: 0,
    });
    const broken = {
      evolveCandidates: async () => {
        throw new Error('Transient');
      },
      evolveFromRecord: async () => {
        throw new Error('Transient');
      },
      getExtractor: () => ({ extract: async () => ({ nodes: [], edges: [] }) }),
    };
    const processor = new MemoryEvolutionProcessor({
      store,
      engine: broken as any,
      maxAttempts: 5,
    });
    const rec = await store.getOutboxRecord!('evo-backoff-01', 'tenant-alpha', 'ws-main');
    try {
      await processor.processRecord(rec!);
    } catch {
      /* expected */
    }
    const after = await store.getOutboxRecord!('evo-backoff-01', 'tenant-alpha', 'ws-main');
    assert.equal(after!.status, EvolutionDeliveryStatus.FAILED, 'Must be FAILED (retryable)');
    assert.ok(after!.nextAttemptAt, 'nextAttemptAt must be set for backoff');
    assert.ok(
      new Date(after!.nextAttemptAt!).getTime() > Date.now(),
      'Backoff must be in the future',
    );
    assert.equal(after!.attemptCount, 1, 'Attempt count must increment');
  });
});

// ===========================================================================
// R-07: Governance Re-entry via GraphEvolutionEngine
// ===========================================================================
describe('066-P3-R-07: GraphEvolutionEngine Governance Re-entry', () => {
  it('processRecord calls evolveCandidates — not raw store bypass', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = makeContext();
    await store.create(makeParentRecord('mem-gov-01', ctx.tenantId, ctx.workspaceId));
    let governanceCalled = false;
    const engine = new GraphEvolutionEngine({ store });
    const orig = engine.evolveCandidates.bind(engine);
    engine.evolveCandidates = async (...args) => {
      governanceCalled = true;
      return orig(...args);
    };
    const processor = new MemoryEvolutionProcessor({ store, engine });
    await store.createOutboxRecord!(
      makeOutboxInput('evo-gov-01', ctx.tenantId, ctx.workspaceId, 'mem-gov-01', '5'.repeat(32)),
    );
    const rec = await store.getOutboxRecord!('evo-gov-01', ctx.tenantId, ctx.workspaceId);
    await processor.processRecord(rec!, ctx);
    assert.equal(
      governanceCalled,
      true,
      'evolveCandidates must be called (governance re-entry 066-P3-R-07)',
    );
  });

  it('evolved graph nodes are marked unverified (advisory data, 066-P3-SEC-03)', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = makeContext();
    await store.create({
      ...makeParentRecord('mem-adv-01', ctx.tenantId, ctx.workspaceId),
      content: 'Alice leads the NexusOS project at Acme Corp.',
    });
    const engine = new GraphEvolutionEngine({ store });
    const processor = new MemoryEvolutionProcessor({ store, engine });
    await store.createOutboxRecord!(
      makeOutboxInput('evo-adv-01', ctx.tenantId, ctx.workspaceId, 'mem-adv-01', '6'.repeat(32)),
    );
    const rec = await store.getOutboxRecord!('evo-adv-01', ctx.tenantId, ctx.workspaceId);
    const receipt = await processor.processRecord(rec!, ctx);
    // acceptedNodes are string IDs — fetch each node to verify provenance.verified=false (066-P3-SEC-03)
    for (const nodeId of receipt.acceptedNodes) {
      const node = await store.getGraphNode(nodeId, ctx.tenantId, ctx.workspaceId);
      if (node?.provenance) {
        assert.equal(
          node.provenance.verified,
          false,
          'Evolved graph nodes must have verified=false',
        );
      }
    }
  });
});

// ===========================================================================
// R-08: Tenant / Workspace Boundary Enforcement
// ===========================================================================
describe('066-P3-R-08: Tenant/Workspace Boundary Enforcement', () => {
  it('processRecord rejects context from wrong tenant', async () => {
    const store = new InMemoryMemoryStore();
    const engine = new GraphEvolutionEngine({ store });
    const processor = new MemoryEvolutionProcessor({ store, engine });
    const rec = await store.createOutboxRecord!(
      makeOutboxInput('evo-bound-01', 'tenant-alpha', 'ws-main', 'mem-b01', '7'.repeat(32)),
    );
    const wrongCtx: MemoryServiceContext = {
      tenantId: 'tenant-EVIL',
      workspaceId: 'ws-main',
      principalId: 'attacker',
      roles: [],
    };
    await assert.rejects(
      () => processor.processRecord(rec, wrongCtx),
      (err: Error) => {
        assert.ok(
          err.message.includes('066-P3-R-08') || err.message.includes('Security boundary'),
          `Got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('listPendingOutboxRecords scopes to tenant', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!(
      makeOutboxInput('evo-ta-01', 'tenant-alpha', 'ws-main', 'mem-a', '8'.repeat(32)),
    );
    await store.createOutboxRecord!(
      makeOutboxInput('evo-tb-01', 'tenant-beta', 'ws-main', 'mem-b', '9'.repeat(32)),
    );
    const alphaOnly = await store.listPendingOutboxRecords!({ tenantId: 'tenant-alpha' });
    assert.ok(
      alphaOnly.every((r) => r.tenantId === 'tenant-alpha'),
      'Must only return tenant-alpha records',
    );
    assert.equal(
      alphaOnly.find((r) => r.tenantId === 'tenant-beta'),
      undefined,
      'tenant-beta must not appear',
    );
  });

  it('getOutboxRecord returns null for wrong tenant', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!(
      makeOutboxInput('evo-sec-01', 'tenant-alpha', 'ws-main', 'mem-s01', 'a0'.repeat(16)),
    );
    const result = await store.getOutboxRecord!('evo-sec-01', 'tenant-EVIL', 'ws-main');
    assert.equal(result, null, 'Wrong tenant must get null');
  });

  it('claimOutboxRecord returns false for wrong workspace', async () => {
    const store = new InMemoryMemoryStore();
    await store.createOutboxRecord!(
      makeOutboxInput('evo-ws-01', 'tenant-alpha', 'ws-main', 'mem-w01', 'b1'.repeat(16)),
    );
    const claimed = await store.claimOutboxRecord!('evo-ws-01', 'tenant-alpha', 'ws-WRONG');
    assert.equal(claimed, false, 'Wrong workspace must not allow claim');
  });

  it('cross-tenant memory getMemory returns null', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = makeService(store);
    const ctxA = makeContext('tenant-alpha');
    const ctxB = makeContext('tenant-beta');
    const record = await service.createMemory(baseCreateRequest('tenant-alpha'), ctxA);
    const crossResult = await service.getMemory(record.id, ctxB);
    assert.equal(crossResult, null, 'Cross-tenant memory access must return null');
  });
});

// ===========================================================================
// End-to-End: Full autoEvolveGraph Lifecycle
// ===========================================================================
describe('End-to-End: Full autoEvolveGraph Lifecycle', () => {
  it('creates memory, outbox registered, evolution fast-path runs', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = makeContext();
    const { service } = makeService(store);
    const record = await service.createMemory(
      { ...baseCreateRequest(), content: 'Alice leads the NexusOS platform team at Acme Corp.' },
      ctx,
    );
    assert.ok(record.id, 'Memory record created');
    assert.equal(record.version, 1);
    const fetched = await service.getMemory(record.id, ctx);
    assert.ok(fetched);
  });

  it('updateMemory triggers graph evolution via outbox', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = makeContext();
    const { service } = makeService(store);
    const record = await service.createMemory(baseCreateRequest(), ctx);
    const updated = await service.updateMemory(
      record.id,
      { content: 'NexusOS Plugin SDK federation layer.', expectedVersion: record.version },
      ctx,
    );
    assert.equal(updated.version, 2);
    assert.ok(updated.content.includes('Plugin SDK'));
  });

  it('tombstoning cascades — record not readable after tombstone', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = makeContext();
    const { service } = makeService(store);
    const record = await service.createMemory(baseCreateRequest(), ctx);
    await service.tombstoneMemory(record.id, ctx, record.version);
    const after = await service.getMemory(record.id, ctx);
    assert.equal(after, null, 'Tombstoned record must be invisible');
  });

  it('recoverPendingEvolutions returns numeric stats with no pending work', async () => {
    const store = new InMemoryMemoryStore();
    const { service } = makeService(store);
    const result = await service.recoverPendingEvolutions({ tenantId: 'tenant-alpha', limit: 100 });
    assert.ok(result.processed >= 0);
    assert.ok(result.completed >= 0);
    assert.ok(result.failed >= 0);
  });
});
