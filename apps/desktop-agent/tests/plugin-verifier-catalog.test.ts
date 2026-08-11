import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PluginVerifier } from '../src/runtimes/plugin/verifier.js';
import { PluginCatalog } from '../src/runtimes/plugin/catalog.js';
import { PluginQuarantineStore } from '../src/runtimes/plugin/quarantine-store.js';
import { PluginPackage } from '../src/runtimes/plugin/types.js';

describe('Plugin Verifier, Catalog, & Quarantine Store', () => {
  const verifier = new PluginVerifier();
  const validPkg: PluginPackage = {
    manifest: {
      pluginId: 'plug_github_v1',
      version: '1.0.0',
      publisher: 'NexusOS Enterprise',
      name: 'GitHub Connector Plugin',
      description: 'Integrates GitHub repositories and PR workflows.',
      requestedCapabilities: ['github:pr:read', 'github:pr:comment'],
      outboundDomains: ['api.github.com'],
      trustLevel: 'VERIFIED_PUBLISHER',
    },
    packageHash: 'hash_sha256_123456789',
    signature: 'sig_valid_nexusos_official',
    bundleContent: 'MOCK_PLUGIN_BUNDLE_JAVASCRIPT_CODE',
  };

  it('verifies a valid signed plugin package', () => {
    const res = verifier.verifyPlugin(validPkg);
    assert.equal(res.valid, true);
    assert.equal(res.pluginId, 'plug_github_v1');
    assert.equal(res.trustLevel, 'VERIFIED_PUBLISHER');
  });

  it('rejects an unsigned or tampered plugin package', () => {
    const invalidPkg: PluginPackage = {
      ...validPkg,
      signature: 'invalid_forged_sig',
    };

    const res = verifier.verifyPlugin(invalidPkg);
    assert.equal(res.valid, false);
    assert.equal(res.error?.code, 'PLUGIN_SIGNATURE_INVALID');
  });

  it('registers packages in catalog and manages state transitions', () => {
    const catalog = new PluginCatalog();
    catalog.registerPackage(validPkg, 'INSTALLED');

    let entry = catalog.getEntry('plug_github_v1');
    assert.equal(entry?.state, 'INSTALLED');

    catalog.setPluginState('plug_github_v1', 'ACTIVATED');
    entry = catalog.getEntry('plug_github_v1');
    assert.equal(entry?.state, 'ACTIVATED');

    catalog.setPluginState('plug_github_v1', 'SUSPENDED');
    entry = catalog.getEntry('plug_github_v1');
    assert.equal(entry?.state, 'SUSPENDED');
  });

  it('overrides self-declared manifest trustLevel if signature authority is unverified', () => {
    const forgedManifestPkg: PluginPackage = {
      ...validPkg,
      manifest: {
        ...validPkg.manifest,
        trustLevel: 'ENTERPRISE_INTERNAL', // Self-declared claim
      },
      signature: 'unverified_third_party_sig',
    };

    const res = verifier.verifyPlugin(forgedManifestPkg);
    assert.equal(res.valid, true);
    assert.equal(res.trustLevel, 'UNVERIFIED'); // Trust level derived from signature, NOT manifest claim
  });

  it('prevents direct invalid state transitions from QUARANTINED to ACTIVATED', () => {
    const catalog = new PluginCatalog();
    catalog.registerPackage(validPkg, 'QUARANTINED');

    const transitionResult = catalog.setPluginState('plug_github_v1', 'ACTIVATED');
    assert.equal(transitionResult, false);

    const entry = catalog.getEntry('plug_github_v1');
    assert.equal(entry?.state, 'QUARANTINED');
  });

  it('quarantines suspicious plugins and queries quarantine state', () => {
    const qStore = new PluginQuarantineStore();
    assert.equal(qStore.isQuarantined('plug_malicious'), false);

    qStore.quarantinePlugin('plug_malicious', 'Signature mismatch and crash loop detected');
    assert.equal(qStore.isQuarantined('plug_malicious'), true);

    const record = qStore.getQuarantineRecord('plug_malicious');
    assert.equal(record?.reason, 'Signature mismatch and crash loop detected');

    qStore.liftQuarantine('plug_malicious');
    assert.equal(qStore.isQuarantined('plug_malicious'), false);
  });
});
