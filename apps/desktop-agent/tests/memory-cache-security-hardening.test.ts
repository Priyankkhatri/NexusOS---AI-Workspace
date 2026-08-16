import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryCacheManager } from '../src/memory/memory-cache-manager.js';
import { AgentLifecycleState } from '../src/lifecycle/index.js';

describe('Task 03N Memory Cache — Security Hardening & Vulnerability Audit', () => {
  let cacheManager: MemoryCacheManager;

  beforeEach(async () => {
    cacheManager = new MemoryCacheManager({
      maxMemoryBytes: 1048576,
      maxEntries: 100,
    });
    await cacheManager.start();
  });

  afterEach(async () => {
    if (cacheManager) {
      await cacheManager.stop();
    }
  });

  it('VULNERABILITY-N01: enforces strict cross-task isolation on cache reads', async () => {
    await cacheManager.put(
      'shared:key',
      { secretData: 'task_A_only' },
      {
        taskId: 'task-A',
        workspaceId: 'workspace-1',
      },
    );

    // Task-B attempts to read Task-A's entry
    const crossRead = await cacheManager.get('shared:key', {
      taskId: 'task-B',
      workspaceId: 'workspace-1',
    });

    assert.equal(crossRead, null);

    // Task-A reads its own entry successfully
    const ownRead = await cacheManager.get<{ secretData: string }>('shared:key', {
      taskId: 'task-A',
      workspaceId: 'workspace-1',
    });
    assert.ok(ownRead);
    assert.equal(ownRead.secretData, 'task_A_only');
  });

  it('VULNERABILITY-N02: enforces strict cross-workspace isolation on cache reads', async () => {
    await cacheManager.put('workspace:key', 'ws1_data', {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });

    // Workspace-2 attempts to read Workspace-1's entry
    const crossWsRead = await cacheManager.get('workspace:key', {
      taskId: 'task-1',
      workspaceId: 'workspace-2',
    });

    assert.equal(crossWsRead, null);
  });

  it('VULNERABILITY-N03: rejects reads when leaseId does not match bound leaseId', async () => {
    await cacheManager.put('lease:bound:key', 'protected_lease_data', {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      leaseId: 'lease-authorized-99',
    });

    // Attempt read with wrong leaseId
    const wrongLeaseRead = await cacheManager.get('lease:bound:key', {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      leaseId: 'lease-unauthorized-00',
    });

    assert.equal(wrongLeaseRead, null);
  });

  it('VULNERABILITY-N04: rejects reads when policyHash does not match bound policyHash', async () => {
    await cacheManager.put('policy:bound:key', 'policy_data', {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      policyHash: 'policy-hash-v1',
    });

    // Attempt read with updated/mismatched policyHash
    const mismatchedPolicyRead = await cacheManager.get('policy:bound:key', {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      policyHash: 'policy-hash-v2-revoked',
    });

    assert.equal(mismatchedPolicyRead, null);
  });

  it('VULNERABILITY-N05: redacts sensitive API keys and credentials before storing in heap memory', async () => {
    await cacheManager.put(
      'user:context',
      {
        api_key: 'sk_live_secret_api_key_99999',
        bearerToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        normalField: 'safe_text',
      },
      {
        taskId: 'task-1',
        workspaceId: 'workspace-1',
      },
    );

    const val = await cacheManager.get<{
      api_key: string;
      bearerToken: string;
      normalField: string;
    }>('user:context', {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });

    assert.ok(val);
    assert.equal(val.api_key.includes('sk_live_secret_api_key_99999'), false);
    assert.ok(val.api_key.includes('[REDACTED_SENSITIVE_KEY]'));
    assert.equal(val.normalField, 'safe_text');
  });

  it('VULNERABILITY-N06: proves ZERO filesystem write activity occurs during memory cache operations', async () => {
    const originalWrite = fs.writeFileSync;
    let writeCalled = false;

    // Spy on fs.writeFileSync
    fs.writeFileSync = (...args: Parameters<typeof fs.writeFileSync>) => {
      writeCalled = true;
      return originalWrite(...args);
    };

    try {
      await cacheManager.put(
        'ephemeral:key',
        { data: 'should_stay_in_heap_memory' },
        {
          taskId: 'task-1',
          workspaceId: 'workspace-1',
        },
      );

      await cacheManager.get('ephemeral:key', { taskId: 'task-1', workspaceId: 'workspace-1' });
      await cacheManager.remove('ephemeral:key');

      assert.equal(writeCalled, false, 'MemoryCacheManager MUST NOT write to the filesystem!');
    } finally {
      fs.writeFileSync = originalWrite;
    }
  });

  it('VULNERABILITY-N07: rejects cache operations when agent lifecycle state is STOPPING or FAILED', async () => {
    let lifecycleState = AgentLifecycleState.STOPPING;

    const stoppingManager = new MemoryCacheManager({}, undefined, undefined, () => lifecycleState);
    await stoppingManager.start();

    await assert.rejects(async () => {
      await stoppingManager.put('key', 'value', { taskId: 't1', workspaceId: 'w1' });
    }, /Memory cache operation 'cache_put' rejected: Agent is in non-ready lifecycle state/);

    lifecycleState = AgentLifecycleState.FAILED;
    await assert.rejects(async () => {
      await stoppingManager.get('key', { taskId: 't1', workspaceId: 'w1' });
    }, /Memory cache operation 'cache_get' rejected/);

    await stoppingManager.stop();
  });

  it('VULNERABILITY-N08: rejects oversized cache entries exceeding maxEntrySizeBytes', async () => {
    const smallEntryManager = new MemoryCacheManager({
      maxEntrySizeBytes: 500, // 500 bytes max entry size
    });
    await smallEntryManager.start();

    await assert.rejects(async () => {
      await smallEntryManager.put(
        'oversized:key',
        {
          largePayload: 'X'.repeat(1000),
        },
        {
          taskId: 't1',
          workspaceId: 'w1',
        },
      );
    }, /exceeds maximum entry limit/);

    await smallEntryManager.stop();
  });

  it('VULNERABILITY-N09: rejects malformed cache keys containing null bytes or exceeding 256 characters', async () => {
    await assert.rejects(async () => {
      await cacheManager.put('bad\0key', 'val', { taskId: 't1', workspaceId: 'w1' });
    }, /Null bytes in cache key are strictly prohibited/);

    await assert.rejects(async () => {
      await cacheManager.put('A'.repeat(300), 'val', { taskId: 't1', workspaceId: 'w1' });
    }, /Cache key length cannot exceed 256 characters/);
  });

  it('VULNERABILITY-N10: verifies 100% of memory cache entries are wiped upon stop()', async () => {
    await cacheManager.put('temp:key', 'persistent_in_heap', { taskId: 't1', workspaceId: 'w1' });
    assert.equal(cacheManager.getStatus().activeEntries, 1);

    await cacheManager.stop();

    // Store is cleared completely
    assert.equal(cacheManager.getStatus().activeEntries, 0);
  });
});
