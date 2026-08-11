import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigLayer,
  ConfigurationManager,
  ConfigurationSnapshot,
  InMemoryConfigurationStore,
  ConfigValidationEngine,
  ConfigRollbackHandler,
} from '../src/config/index.js';

describe('Task 03G Configuration Manager — Validation, LKG, Secrets & Resource Ceilings', () => {
  let manager: ConfigurationManager;

  beforeEach(() => {
    manager = new ConfigurationManager();
  });

  it('FORBIDS overriding security baselines to false', async () => {
    const res = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      securityBaselines: {
        policyDenyRulesEnabled: false,
      } as unknown as ConfigurationSnapshot['securityBaselines'],
    });

    assert.equal(res.result.success, false);
    assert.equal(res.result.action, 'REJECT');
    assert.equal(res.result.error?.code, 'CONFIG_VALIDATION_FAILED');
    assert.equal(res.event.schema_id, 'nexusos.events.config.rejected.v1');
    assert.equal(manager.getActiveConfiguration().securityBaselines.policyDenyRulesEnabled, true);
  });

  it('REJECTS configuration updates containing plaintext passwords or credentials', async () => {
    const res = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      customPreferences: {
        dbPassword: 'MySecretPlaintextPassword123!',
      },
    });

    assert.equal(res.result.success, false);
    assert.equal(res.result.error?.code, 'CONFIG_VALIDATION_FAILED');
    assert.ok(res.result.error?.message.includes('plaintext secret material'));
  });

  it('REJECTS configuration updates containing Bearer tokens or API keys', async () => {
    const resBearer = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      customPreferences: {
        authToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret',
      },
    });
    assert.equal(resBearer.result.success, false);

    const resGhp = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      customPreferences: {
        githubToken: 'gh' + 'p_1234567890abcdefghijklmnopqrstuvwxyz',
      },
    });
    assert.equal(resGhp.result.success, false);
  });

  it('ALLOWS opaque secret references in configuration preferences', async () => {
    const res = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      customPreferences: {
        dbSecretRef: 'vault:sec_ref_db_password',
      },
    });

    assert.equal(res.result.success, true);
    assert.equal(
      (res.result.snapshot?.customPreferences as Record<string, string>)?.dbSecretRef,
      'vault:sec_ref_db_password',
    );
  });

  it('CLAMPS resource budget values exceeding hard architectural ceilings', async () => {
    const res = await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      resourceBudgets: {
        processTimeoutMs: 900_000, // 15 min > 5 min ceiling
        pluginMaxConcurrentHosts: 50, // 50 > 8 ceiling
      } as unknown as ConfigurationSnapshot['resourceBudgets'],
    });

    assert.equal(res.result.success, true);
    // Verified clamped to hard ceilings
    assert.equal(res.result.snapshot?.resourceBudgets.processTimeoutMs, 300_000);
    assert.equal(res.result.snapshot?.resourceBudgets.pluginMaxConcurrentHosts, 8);
  });

  it('maintains atomic application and notifies observers only on valid updates', async () => {
    let notifiedCount = 0;
    manager.observerRegistry.subscribe('test_obs_1', (_snapshot) => {
      notifiedCount++;
    });

    // 1. Valid Update
    await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      settings: { logLevel: 'warn' },
    });
    assert.equal(notifiedCount, 1);

    // 2. Invalid Update (plaintext secret)
    await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      customPreferences: { apiKey: 'raw_api_key_secret_value' },
    });
    // Notification count remains 1 (notified ONLY on valid update)
    assert.equal(notifiedCount, 1);
    assert.equal(manager.getActiveConfiguration().settings.logLevel, 'warn');
  });

  it('executes LKG rollback cleanly and emits rollback evidence', async () => {
    // Apply valid update
    await manager.applyConfigurationUpdate(ConfigLayer.USER_PREFERENCES, {
      settings: { logLevel: 'error' },
    });

    // Execute Rollback
    const rollbackRes = await manager.rollbackToLKG();
    assert.equal(rollbackRes.result.success, true);
    assert.equal(rollbackRes.result.action, 'ROLLBACK');
    assert.equal(rollbackRes.event.schema_id, 'nexusos.events.config.rollback.v1');
    assert.equal(rollbackRes.event.payload.status, 'SUCCESS');
  });

  it('falls back to Shipped Defaults if LKG is corrupted', () => {
    const store = new InMemoryConfigurationStore();
    const validationEngine = new ConfigValidationEngine();
    const rollbackHandler = new ConfigRollbackHandler();

    // Set schema-invalid LKG configuration
    store.setLKGConfig({
      version: 'invalid',
      settings: { deviceId: 'invalid-uuid-string' },
    } as unknown as ConfigurationSnapshot);

    const restored = rollbackHandler.rollbackToLKG(store, validationEngine);
    assert.equal(restored.layer, ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS);
    assert.equal(restored.securityBaselines.policyDenyRulesEnabled, true);
  });
});
