import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentLifecycleState } from '../src/lifecycle/index.js';
import { StateManager } from '../src/state/state-manager.js';
import { LocalAgentStateSnapshot } from '../src/state/types.js';

describe('Task 03M State Manager — Functional & Lifecycle Verification', () => {
  const storageDir = path.resolve('.test-state-mgr-dir');
  let stateManager: StateManager;

  beforeEach(async () => {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    stateManager = new StateManager({
      storageDir,
      stateFileName: 'test-agent-state.enc',
      lkgFileName: 'test-agent-state.lkg.enc',
      encryptionKey: 'Super_Secure_Test_Encryption_Key_2026_x1',
    });
    await stateManager.start();
  });

  afterEach(async () => {
    if (stateManager) {
      await stateManager.stop();
    }
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it('initializes and reports clean status', async () => {
    const status = stateManager.getStatus();
    assert.equal(status.initialized, true);
    assert.equal(status.recordCount, 0);
    assert.ok(status.activePath.includes('test-agent-state.enc'));
  });

  it('persists and retrieves key-value state records', async () => {
    await stateManager.set('setting:theme', { mode: 'dark', fontSize: 14 });
    const val = await stateManager.get<{ mode: string; fontSize: number }>('setting:theme');

    assert.ok(val);
    assert.equal(val.mode, 'dark');
    assert.equal(val.fontSize, 14);
  });

  it('deletes records successfully', async () => {
    await stateManager.set('temp:key', 'to_be_deleted');
    assert.equal(await stateManager.get<string>('temp:key'), 'to_be_deleted');

    const deleted = await stateManager.delete('temp:key');
    assert.equal(deleted, true);
    assert.equal(await stateManager.get<string>('temp:key'), null);
  });

  it('handles saveState and loadState for LocalAgentStateSnapshot compatibility', async () => {
    const snapshot: LocalAgentStateSnapshot = {
      deviceId: 'dev-1234-abcd',
      tenantId: 'tenant-5678-efgh',
      lifecycleState: AgentLifecycleState.READY,
      controlPlaneConnected: true,
      registeredCapabilities: ['agent:foundation', 'capability:filesystem'],
      registeredRuntimes: ['terminal', 'browser'],
    };

    await stateManager.saveState(snapshot);
    const loaded = await stateManager.loadState();

    assert.ok(loaded);
    assert.equal(loaded.deviceId, 'dev-1234-abcd');
    assert.equal(loaded.tenantId, 'tenant-5678-efgh');
    assert.equal(loaded.lifecycleState, 'READY');
    assert.equal(loaded.controlPlaneConnected, true);
    assert.deepEqual(loaded.registeredCapabilities, ['agent:foundation', 'capability:filesystem']);
  });

  it('applies schema version migration for outdated records', async () => {
    const oldVersionManager = new StateManager({
      storageDir,
      stateFileName: 'test-agent-state.enc',
      currentSchemaVersion: '2.0.0',
      encryptionKey: 'Super_Secure_Test_Encryption_Key_2026_x1',
    });

    oldVersionManager.registerMigration('2.0.0', (oldData) => {
      const legacy = oldData as { count: number };
      return { count: legacy.count * 10, migrated: true };
    });

    await stateManager.set('migrated:key', { count: 5 }); // Saved under version 1.0.0
    await stateManager.stop();

    await oldVersionManager.start();
    const migratedVal = await oldVersionManager.get<{ count: number; migrated: boolean }>(
      'migrated:key',
    );

    assert.ok(migratedVal);
    assert.equal(migratedVal.count, 50);
    assert.equal(migratedVal.migrated, true);

    await oldVersionManager.stop();
  });
});
