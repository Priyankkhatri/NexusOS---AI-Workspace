import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CapabilityRegistry, RuntimeRegistry, RuntimeCategory } from '../src/index.js';

describe('Capability Registry', () => {
  it('registers and retrieves a capability', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({
      capabilityId: 'cap:fs:read',
      category: 'runtime',
      description: 'Read filesystem resources',
      isDangerous: false,
    });

    assert.strictEqual(registry.hasCapability('cap:fs:read'), true);
    const cap = registry.getCapability('cap:fs:read');
    assert.ok(cap);
    assert.strictEqual(cap.category, 'runtime');
  });

  it('prevents duplicate capability registration', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({
      capabilityId: 'cap:net:http',
      category: 'network',
      description: 'HTTP network access',
      isDangerous: true,
    });

    assert.throws(
      () =>
        registry.registerCapability({
          capabilityId: 'cap:net:http',
          category: 'network',
          description: 'Duplicate',
          isDangerous: false,
        }),
      /\[CapabilityRegistryError\]/,
    );
  });

  it('lists all registered capability IDs', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({
      capabilityId: 'cap:a',
      category: 'system',
      description: 'A',
      isDangerous: false,
    });
    registry.registerCapability({
      capabilityId: 'cap:b',
      category: 'device',
      description: 'B',
      isDangerous: false,
    });

    const ids = registry.listCapabilityIds();
    assert.deepStrictEqual(ids, ['cap:a', 'cap:b']);
  });

  it('returns undefined for unregistered capability', () => {
    const registry = new CapabilityRegistry();
    assert.strictEqual(registry.getCapability('nonexistent'), undefined);
    assert.strictEqual(registry.hasCapability('nonexistent'), false);
  });
});

describe('Runtime Registry — Zero-Executable Foundation Security', () => {
  it('registers a non-executable runtime descriptor', () => {
    const registry = new RuntimeRegistry();
    registry.registerRuntime({
      runtimeId: 'rt:fs-foundation',
      category: RuntimeCategory.FILESYSTEM,
      version: '0.1.0',
      isExecutable: false,
      supportedActions: ['read', 'list'],
    });

    assert.strictEqual(registry.hasRuntime('rt:fs-foundation'), true);
    const rt = registry.getRuntime('rt:fs-foundation');
    assert.ok(rt);
    assert.strictEqual(rt.isExecutable, false);
  });

  it('rejects executable runtime registration in Task 03A foundation', () => {
    const registry = new RuntimeRegistry();
    assert.throws(
      () =>
        registry.registerRuntime({
          runtimeId: 'rt:terminal-live',
          category: RuntimeCategory.TERMINAL,
          version: '0.1.0',
          isExecutable: true,
          supportedActions: ['execute'],
        }),
      /\[RuntimeRegistrySecurityError\]/,
    );
  });

  it('prevents duplicate runtime registration', () => {
    const registry = new RuntimeRegistry();
    registry.registerRuntime({
      runtimeId: 'rt:browser-stub',
      category: RuntimeCategory.BROWSER,
      version: '0.1.0',
      isExecutable: false,
      supportedActions: [],
    });

    assert.throws(
      () =>
        registry.registerRuntime({
          runtimeId: 'rt:browser-stub',
          category: RuntimeCategory.BROWSER,
          version: '0.2.0',
          isExecutable: false,
          supportedActions: [],
        }),
      /\[RuntimeRegistryError\]/,
    );
  });

  it('lists all registered runtime descriptors', () => {
    const registry = new RuntimeRegistry();
    registry.registerRuntime({
      runtimeId: 'rt:a',
      category: RuntimeCategory.CLIPBOARD,
      version: '0.1.0',
      isExecutable: false,
      supportedActions: [],
    });
    registry.registerRuntime({
      runtimeId: 'rt:b',
      category: RuntimeCategory.PLUGIN,
      version: '0.1.0',
      isExecutable: false,
      supportedActions: [],
    });

    const runtimes = registry.listRuntimes();
    assert.strictEqual(runtimes.length, 2);
    assert.strictEqual(runtimes[0]!.runtimeId, 'rt:a');
    assert.strictEqual(runtimes[1]!.runtimeId, 'rt:b');
  });
});
