import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCacheManager } from '../src/memory/memory-cache-manager.js';

describe('Task 03N Memory Cache — Functional & Lifecycle Verification', () => {
  let cacheManager: MemoryCacheManager;

  beforeEach(async () => {
    cacheManager = new MemoryCacheManager({
      maxMemoryBytes: 1048576, // 1 MB test ceiling
      maxEntries: 50,
      defaultTTLMs: 5000,
      cleanupIntervalMs: 1000,
      maxEntrySizeBytes: 102400, // 100 KB max entry
    });
    await cacheManager.start();
  });

  afterEach(async () => {
    if (cacheManager) {
      await cacheManager.stop();
    }
  });

  it('initializes cleanly and reports status metrics', async () => {
    const status = cacheManager.getStatus();
    assert.equal(status.initialized, true);
    assert.equal(status.activeEntries, 0);
    assert.equal(status.totalSizeBytes, 0);
    assert.equal(status.totalHits, 0);
    assert.equal(status.totalMisses, 0);
  });

  it('stores and retrieves task-scoped context entries', async () => {
    await cacheManager.put(
      'step:output',
      { result: 'processed_data' },
      {
        taskId: 'task-100',
        workspaceId: 'ws-200',
      },
    );

    const val = await cacheManager.get<{ result: string }>('step:output', {
      taskId: 'task-100',
      workspaceId: 'ws-200',
    });

    assert.ok(val);
    assert.equal(val.result, 'processed_data');
    assert.equal(cacheManager.getStatus().activeEntries, 1);
    assert.equal(cacheManager.getStatus().totalHits, 1);
  });

  it('removes entries cleanly', async () => {
    await cacheManager.put(
      'temp:entry',
      { data: 123 },
      {
        taskId: 'task-100',
        workspaceId: 'ws-200',
      },
    );

    const removed = await cacheManager.remove('temp:entry');
    assert.equal(removed, true);

    const val = await cacheManager.get('temp:entry', {
      taskId: 'task-100',
      workspaceId: 'ws-200',
    });

    assert.equal(val, null);
  });

  it('expires entries automatically after TTL', async () => {
    const shortTtlManager = new MemoryCacheManager({
      defaultTTLMs: 50, // 50ms TTL
    });
    await shortTtlManager.start();

    await shortTtlManager.put('short:ttl', 'expiring_value', {
      taskId: 'task-100',
      workspaceId: 'ws-200',
      ttlMs: 50,
    });

    // Wait for TTL to pass
    await new Promise((resolve) => setTimeout(resolve, 80));

    const val = await shortTtlManager.get('short:ttl', {
      taskId: 'task-100',
      workspaceId: 'ws-200',
    });

    assert.equal(val, null);
    await shortTtlManager.stop();
  });

  it('evicts LRU entries when maxEntries capacity limit is reached', async () => {
    const smallStoreManager = new MemoryCacheManager({
      maxEntries: 3,
    });
    await smallStoreManager.start();

    await smallStoreManager.put('k1', 'val1', { taskId: 't1', workspaceId: 'w1' });
    await smallStoreManager.put('k2', 'val2', { taskId: 't1', workspaceId: 'w1' });
    await smallStoreManager.put('k3', 'val3', { taskId: 't1', workspaceId: 'w1' });

    assert.equal(smallStoreManager.getStatus().activeEntries, 3);

    // Adding 4th entry triggers LRU eviction of 'k1'
    await smallStoreManager.put('k4', 'val4', { taskId: 't1', workspaceId: 'w1' });

    assert.equal(smallStoreManager.getStatus().activeEntries, 3);
    assert.equal(await smallStoreManager.get('k1', { taskId: 't1', workspaceId: 'w1' }), null);
    assert.equal(await smallStoreManager.get('k4', { taskId: 't1', workspaceId: 'w1' }), 'val4');

    await smallStoreManager.stop();
  });

  it('clears task context entries via clearTaskContext', async () => {
    await cacheManager.put('t1:k1', 'val1', { taskId: 'task-alpha', workspaceId: 'ws-1' });
    await cacheManager.put('t1:k2', 'val2', { taskId: 'task-alpha', workspaceId: 'ws-1' });
    await cacheManager.put('t2:k1', 'val3', { taskId: 'task-beta', workspaceId: 'ws-1' });

    assert.equal(cacheManager.getStatus().activeEntries, 3);

    const cleared = await cacheManager.clearTaskContext('task-alpha');
    assert.equal(cleared, 2);
    assert.equal(cacheManager.getStatus().activeEntries, 1);
  });

  it('clears workspace context entries via clearWorkspaceContext', async () => {
    await cacheManager.put('w1:k1', 'v1', { taskId: 't1', workspaceId: 'ws-dev' });
    await cacheManager.put('w2:k1', 'v2', { taskId: 't2', workspaceId: 'ws-prod' });

    const cleared = await cacheManager.clearWorkspaceContext('ws-dev');
    assert.equal(cleared, 1);
    assert.equal(await cacheManager.get('w1:k1', { taskId: 't1', workspaceId: 'ws-dev' }), null);
  });

  it('invalidates lease context via clearLeaseContext', async () => {
    await cacheManager.put('lease:entry', 'lease_data', {
      taskId: 't1',
      workspaceId: 'w1',
      leaseId: 'lease-999',
    });

    const cleared = await cacheManager.clearLeaseContext('lease-999');
    assert.equal(cleared, 1);
    assert.equal(
      await cacheManager.get('lease:entry', {
        taskId: 't1',
        workspaceId: 'w1',
        leaseId: 'lease-999',
      }),
      null,
    );
  });

  it('invalidates policy hash entries via invalidatePolicyHash', async () => {
    await cacheManager.put('pol:entry', 'policy_data', {
      taskId: 't1',
      workspaceId: 'w1',
      policyHash: 'hash-abc-123',
    });

    const cleared = await cacheManager.invalidatePolicyHash('hash-abc-123');
    assert.equal(cleared, 1);
    assert.equal(
      await cacheManager.get('pol:entry', {
        taskId: 't1',
        workspaceId: 'w1',
        policyHash: 'hash-abc-123',
      }),
      null,
    );
  });
});
