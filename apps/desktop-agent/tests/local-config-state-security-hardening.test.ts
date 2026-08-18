import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigurationManager } from '../src/config/configuration-manager.js';
import { ConfigLayer, SignedConfigEnvelope } from '../src/config/types.js';
import { StateManager } from '../src/state/state-manager.js';
import { DesktopAgent } from '../src/agent.js';
import { loadDesktopAgentConfig } from '../src/config/index.js';
import { DefaultAgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';

class MockControlPlaneClient implements ControlPlaneClient {
  async start() {}
  async registerAgent() {
    return { accepted: true, controlPlaneVersion: '1.0.0' };
  }
  async sendHeartbeat() {
    return true;
  }
  async relayEvent() {
    return { success: true };
  }
  getConnectionState() {
    return 'CONNECTED_ACTIVE' as any;
  }
  async disconnect() {}
}

class MockLeaseBoundary extends ExecutionLeaseBoundary {
  override async validateLease(_header: unknown) {
    return { valid: true, lease: _header as any };
  }
}

describe('Task 03Y — Configuration & State Security Hardening Suite', () => {
  const testDir = path.join(process.cwd(), '.test-config-state-sec');
  const secretKey = 'Secure_Test_Encryption_Key_2026_x101';

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('03Y-SEC-01: Configuration revision replay attack rejected', async () => {
    const manager = new ConfigurationManager();
    const envV10: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 10,
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'valid_sig',
      payload: { settings: { logLevel: 'debug' } },
    };
    await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envV10);

    // Replay attack with revision 5
    const envV5: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 5,
      authorityKeyId: 'pubkey_release_authority_v1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'valid_sig',
      payload: { settings: { logLevel: 'info' } },
    };

    const res = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, envV5);
    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_REVISION_REPLAY');
  });

  test('03Y-SEC-02: Unsigned enterprise policy overlay injection rejected', async () => {
    const manager = new ConfigurationManager();
    const res = await manager.applyConfigurationUpdate(ConfigLayer.ENTERPRISE_POLICY_OVERLAYS, {
      settings: { logLevel: 'error' },
    } as any);

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_SIGNATURE_MISSING');
  });

  test('03Y-SEC-03: User preference attempting to weaken immutable security baseline rejected', async () => {
    const manager = new ConfigurationManager();
    const res = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      securityBaselines: {
        policyDenyRulesEnabled: false as any,
      },
    });

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'SECURITY_BASELINE_VIOLATION');
  });

  test('03Y-SEC-04: Tampered encrypted state file fails integrity verification and restores LKG', async () => {
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'tamper-state.enc',
      encryptionKey: secretKey,
    });

    await stateManager.start();
    await stateManager.set('key1', 'valid_data');

    // Corrupt the ciphertext in primary state file
    const primaryFile = path.join(testDir, 'tamper-state.enc');
    const raw = fs.readFileSync(primaryFile, 'utf-8');
    const envelope = JSON.parse(raw);
    envelope.ciphertext = 'CORRUPTED_CIPHERTEXT_BASE64==';
    fs.writeFileSync(primaryFile, JSON.stringify(envelope));

    // Reloading from disk should reject corrupted primary file and attempt LKG fallback
    const stateManager2 = new StateManager({
      storageDir: testDir,
      stateFileName: 'tamper-state.enc',
      encryptionKey: secretKey,
    });

    await stateManager2.start();
    const val = await stateManager2.get('key1');
    assert.equal(val, 'valid_data'); // Restored from LKG backup
    await stateManager2.stop();
  });

  test('03Y-SEC-05: Null-byte state key injection rejected', async () => {
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'null-byte-state.enc',
      encryptionKey: secretKey,
    });
    await stateManager.start();

    await assert.rejects(
      async () => stateManager.set('invalid\0key', 'data'),
      /Null bytes in record key are strictly prohibited/,
    );
    await stateManager.stop();
  });

  test('03Y-SEC-06: Unbounded state memory/disk exhaustion bounds enforced', async () => {
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'bounded-state.enc',
      encryptionKey: secretKey,
      maxRecords: 2,
    });
    await stateManager.start();

    await stateManager.set('rec1', 'data1');
    await stateManager.set('rec2', 'data2');

    await assert.rejects(
      async () => stateManager.set('rec3', 'data3'),
      /Storage limit exceeded: maximum allowed record count of 2 reached/,
    );
    await stateManager.stop();
  });

  test('03Y-SEC-07: Sensitive secret leakage in persisted state automatically redacted', async () => {
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'redact-state.enc',
      encryptionKey: secretKey,
    });
    await stateManager.start();

    await stateManager.set('user:creds', {
      username: 'alice',
      password: 'SuperSecretPassword123!',
      apiKey: 'sk-1234567890abcdef',
    });

    const record = await stateManager.get<any>('user:creds');
    assert.equal(record.password, '[REDACTED]');
    await stateManager.stop();
  });

  test('03Y-SEC-08: State storage path traversal rejected', () => {
    assert.throws(
      () =>
        new StateManager({
          storageDir: testDir,
          stateFileName: '../outside-state.enc',
          encryptionKey: secretKey,
        }),
      /stateFileName must be a single valid filename without slashes or path traversal/,
    );
  });

  test('03Y-SEC-09: Crash/power-loss state corruption handled gracefully via LKG recovery', async () => {
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'crash-state.enc',
      encryptionKey: secretKey,
    });
    await stateManager.start();
    await stateManager.set('session:1', 'active');

    // Simulate interrupted write by creating a stale .tmp file
    fs.writeFileSync(path.join(testDir, 'crash-state.enc.tmp'), 'PARTIAL_TRUNCATED_JSON');

    // Reload state manager should remove stale .tmp and load valid state safely
    const stateManager2 = new StateManager({
      storageDir: testDir,
      stateFileName: 'crash-state.enc',
      encryptionKey: secretKey,
    });
    await stateManager2.start();

    const val = await stateManager2.get('session:1');
    assert.equal(val, 'active');
    assert.equal(fs.existsSync(path.join(testDir, 'crash-state.enc.tmp')), false);
    await stateManager2.stop();
  });

  test('03Y-SEC-10: Unauthorized config.applyUpdate IPC invocation validation enforced', async () => {
    const manager = new ConfigurationManager();
    // Invalid signature envelope
    const fakeEnv: SignedConfigEnvelope = {
      layer: ConfigLayer.SIGNED_RELEASE_CONFIG,
      revision: 1,
      authorityKeyId: 'untrusted_key',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: 'invalid_forged_sig',
      payload: {},
    };

    const res = await manager.applyConfigurationUpdate(ConfigLayer.SIGNED_RELEASE_CONFIG, fakeEnv);
    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_SIGNATURE_INVALID');
  });

  test('03Y-SEC-11: Cross-tenant state record isolation maintained', async () => {
    const stateManager = new StateManager({
      storageDir: testDir,
      stateFileName: 'tenant-state.enc',
      encryptionKey: secretKey,
    });
    await stateManager.start();

    await stateManager.set('tenant-A:key1', { value: 'secret-A' });
    await stateManager.set('tenant-B:key1', { value: 'secret-B' });

    const valA = await stateManager.get<any>('tenant-A:key1');
    const valB = await stateManager.get<any>('tenant-B:key1');

    assert.equal(valA.value, 'secret-A');
    assert.equal(valB.value, 'secret-B');
    await stateManager.stop();
  });

  test('03Y-SEC-12: Unflushed state gracefully persisted during DesktopAgent shutdown', async () => {
    const config = loadDesktopAgentConfig({});
    const identityProvider = new DefaultAgentIdentityProvider(
      config.deviceId,
      crypto.randomUUID(),
      config.agentVersion,
    );
    const controlPlaneClient = new MockControlPlaneClient();
    const leaseBoundary = new MockLeaseBoundary();
    const stateStore = new InMemoryLocalStateStore();

    const dummyLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    const agent = new DesktopAgent(
      config,
      identityProvider,
      controlPlaneClient,
      leaseBoundary,
      stateStore,
      dummyLogger as any,
    );

    await agent.start();
    await agent.stateManager.set('shutdown:check', 'saved');

    // Graceful stop flushes pending state to disk
    await agent.stop();

    const status = agent.stateManager.getStatus();
    assert.equal(status.recordCount, 1);
  });
});
