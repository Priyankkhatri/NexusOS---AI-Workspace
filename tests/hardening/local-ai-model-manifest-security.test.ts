import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { ModelManifest, ModelManifestSchema } from '@nexusos/contracts';
import {
  ModelCacheError,
  ModelCacheManager,
  isPrivateOrUnsafeIp,
  validateRemoteArtifactSource,
} from '../../apps/desktop-agent/src/runtimes/local-ai/model-cache-manager.js';

describe('Task 065 — Local-AI Model Manifest Security Hardening Suite', () => {
  let tmpDir: string;
  let cacheManager: ModelCacheManager;
  let server: http.Server;
  let serverUrl: string;

  const validPayload = Buffer.from('SECURE_CANONICAL_MODEL_BINARY_PAYLOAD_065_SECURITY_TEST');
  const validSha256 = crypto.createHash('sha256').update(validPayload).digest('hex');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-065-security-test-'));
    cacheManager = new ModelCacheManager(tmpDir, 50 * 1024 * 1024); // 50 MB
    await cacheManager.initialize();

    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/model.gguf') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': validPayload.length.toString(),
        });
        res.end(validPayload);
      } else if (url.pathname === '/tampered.gguf') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': validPayload.length.toString(),
        });
        res.end(Buffer.from('TAMPERED_MALICIOUS_PAYLOAD_CONTENT_DO_NOT_PROMOTE_12345'));
      } else if (url.pathname === '/redirect-to-metadata') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      } else if (url.pathname === '/redirect-to-private') {
        res.writeHead(302, { Location: 'http://192.168.1.1/model.gguf' });
        res.end();
      } else if (url.pathname === '/oversized.gguf') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.write(validPayload);
        res.write(Buffer.from('EXTRA_BYTES_EXCEEDING_SIZE'));
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const createManifest = (overrides?: Partial<ModelManifest>): ModelManifest => ({
    modelId: 'nexus/security-test-model',
    name: 'Security Test Model',
    version: '1.0.0',
    format: 'gguf',
    quantization: 'Q4_0',
    parameterSize: '1B',
    contextLength: 4096,
    byteSize: validPayload.length,
    sha256: validSha256,
    source: {
      sourceType: 'TRUSTED_HTTPS',
      url: `${serverUrl}/model.gguf`,
    },
    metadata: { license: 'Apache-2.0' },
    ...overrides,
  });

  // ============================================================
  // 065-SEC-01: Cryptographic Model Manifest Verification
  // ============================================================

  describe('065-SEC-01: Cryptographic Model Manifest Verification', () => {
    it('enforces exact 64-character hex format for manifest sha256', () => {
      // Valid SHA-256 passes
      const valid = createManifest();
      assert.doesNotThrow(() => ModelManifestSchema.parse(valid));

      // 63 hex chars rejected
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ sha256: 'a'.repeat(63) })),
        /SHA-256 hash must be exactly 64 hex characters/i,
      );

      // 65 hex chars rejected
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ sha256: 'a'.repeat(65) })),
        /SHA-256 hash must be exactly 64 hex characters/i,
      );

      // Non-hex chars rejected
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ sha256: 'z'.repeat(64) })),
        /Invalid SHA-256 hex string/i,
      );
    });

    it('rejects manifest with non-positive byteSize or contextLength', () => {
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ byteSize: 0 })),
        /byteSize must be a positive integer/i,
      );
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ byteSize: -100 })),
        /byteSize must be a positive integer/i,
      );
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ contextLength: 0 })),
        /contextLength must be a positive integer/i,
      );
    });

    it('successfully acquires and verifies artifact when manifest matches physical digest', async () => {
      const manifest = createManifest();
      const artifact = await cacheManager.downloadArtifact({
        manifest,
        allowLocalhostForTesting: true,
      });

      assert.equal(artifact.modelId, manifest.modelId);
      assert.equal(artifact.sha256, validSha256);
      assert.equal(artifact.state, 'Installed');
      assert.ok(fs.existsSync(artifact.storagePath));
    });
  });

  // ============================================================
  // 065-SEC-02: SSRF Guard on Remote Model Acquisition
  // ============================================================

  describe('065-SEC-02: SSRF Guard on Remote Model Acquisition', () => {
    it('strictly enforces HTTPS for non-localhost acquisition', async () => {
      await assert.rejects(
        () =>
          validateRemoteArtifactSource('http://models.nexusos.internal/model.gguf', {
            allowLocalhostForTesting: false,
          }),
        (err: any) =>
          err instanceof ModelCacheError &&
          err.code === 'UNSAFE_DESTINATION' &&
          /HTTPS is strictly required/i.test(err.message),
      );
    });

    it('rejects cloud metadata endpoints (AWS/GCP/Azure)', async () => {
      const metadataUrls = [
        'https://169.254.169.254/latest/meta-data',
        'https://169.254.170.2/v2/metadata',
        'https://metadata.google.internal/computeMetadata/v1/',
        'https://instance-data/latest/meta-data',
        'https://metadata.azure.com/metadata/instance',
      ];

      for (const url of metadataUrls) {
        await assert.rejects(
          () => validateRemoteArtifactSource(url),
          (err: any) =>
            err instanceof ModelCacheError &&
            err.code === 'UNSAFE_DESTINATION' &&
            /metadata destination|reserved IP/i.test(err.message),
          `Expected ${url} to be blocked as metadata endpoint`,
        );
      }
    });

    it('rejects RFC1918 private network and loopback destinations', async () => {
      const prohibitedIps = [
        '127.0.0.1',
        '127.0.0.2',
        '0.0.0.0',
        '10.0.0.1',
        '10.254.254.254',
        '172.16.0.1',
        '172.31.255.255',
        '192.168.0.1',
        '192.168.1.254',
        '100.64.0.1', // CGNAT
        '224.0.0.1', // Multicast
        '240.0.0.1', // Reserved
        '::1',
        'fe80::1', // Link-local IPv6
        'fc00::1', // Unique local IPv6
        'fd00::1', // Unique local IPv6
      ];

      for (const ip of prohibitedIps) {
        assert.equal(isPrivateOrUnsafeIp(ip), true, `Expected ${ip} to be classified as unsafe`);
        const host = ip.includes(':') ? `[${ip}]` : ip;
        await assert.rejects(
          () => validateRemoteArtifactSource(`https://${host}/model.gguf`),
          (err: any) => err instanceof ModelCacheError && err.code === 'UNSAFE_DESTINATION',
        );
      }
    });

    it('blocks embedded credentials in acquisition URLs', async () => {
      await assert.rejects(
        () => validateRemoteArtifactSource('https://admin:secretToken123@example.com/model.gguf'),
        (err: any) =>
          err instanceof ModelCacheError &&
          err.code === 'UNSAFE_DESTINATION' &&
          /Embedded credentials/i.test(err.message),
      );
    });

    it('blocks HTTP redirects that attempt to pivot to prohibited destinations', async () => {
      // 1. Redirect to cloud metadata
      const metaRedirectManifest = createManifest({
        modelId: 'nexus/ssrf-meta-redirect',
        source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/redirect-to-metadata` },
      });
      await assert.rejects(
        () =>
          cacheManager.downloadArtifact({
            manifest: metaRedirectManifest,
            allowLocalhostForTesting: true,
          }),
        (err: any) => err instanceof ModelCacheError && err.code === 'UNSAFE_DESTINATION',
      );

      // 2. Redirect to private RFC1918 IP
      const privateRedirectManifest = createManifest({
        modelId: 'nexus/ssrf-private-redirect',
        source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/redirect-to-private` },
      });
      await assert.rejects(
        () =>
          cacheManager.downloadArtifact({
            manifest: privateRedirectManifest,
            allowLocalhostForTesting: true,
          }),
        (err: any) => err instanceof ModelCacheError && err.code === 'UNSAFE_DESTINATION',
      );
    });
  });

  // ============================================================
  // 065-SEC-03: Immediate Quarantine & Destruction of Poisoned Artifacts
  // ============================================================

  describe('065-SEC-03: Immediate Quarantine & Destruction of Poisoned Artifacts', () => {
    it('immediately destroys staged file on SHA-256 mismatch and never promotes to active cache', async () => {
      const poisonedManifest = createManifest({
        modelId: 'nexus/poisoned-model',
        source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/tampered.gguf` },
        byteSize: validPayload.length,
        sha256: validSha256, // Server returns tampered bytes whose digest differs
      });

      await assert.rejects(
        () =>
          cacheManager.downloadArtifact({
            manifest: poisonedManifest,
            allowLocalhostForTesting: true,
          }),
        (err: any) => {
          assert.ok(err instanceof ModelCacheError);
          assert.equal(err.code, 'HASH_MISMATCH');
          assert.match(err.message, /SHA-256 verification failed/i);
          return true;
        },
      );

      // 1. Staging directory must contain NO residual temporary files
      const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
      assert.equal(stagingFiles.length, 0, 'Tampered staging file must be destroyed immediately');

      // 2. Models active directory must contain NO file for the poisoned model
      const modelFiles = fs.readdirSync(path.join(tmpDir, 'models'));
      assert.equal(
        modelFiles.length,
        0,
        'Poisoned model must NEVER be promoted to models directory',
      );

      // 3. Model must not exist in catalog
      assert.equal(cacheManager.getModel(poisonedManifest.modelId), undefined);
      assert.equal(cacheManager.listCatalog().length, 0);
    });
  });

  // ============================================================
  // 065-SEC-04: Strict Path Traversal & Symlink Containment
  // ============================================================

  describe('065-SEC-04: Strict Path Traversal & Symlink Containment', () => {
    it('rejects modelId containing directory traversal sequences (..)', () => {
      assert.throws(
        () => ModelManifestSchema.parse(createManifest({ modelId: '../../etc/passwd' as any })),
        /modelId cannot contain directory traversal sequence/i,
      );

      assert.throws(
        () =>
          ModelManifestSchema.parse(
            createManifest({ modelId: 'nexus/../../../escaped-model' as any }),
          ),
        /modelId cannot contain directory traversal sequence/i,
      );
    });

    it('resolveSafePath blocks relative traversal, UNC paths, and Windows device names', () => {
      // Relative traversal
      assert.throws(
        () => cacheManager.resolveSafePath('../../escaped.bin'),
        (err: any) => err instanceof ModelCacheError && err.code === 'INVALID_PATH',
      );

      // Windows drive escape
      assert.throws(
        () => cacheManager.resolveSafePath('X:\\escaped\\path.bin'),
        (err: any) => err instanceof ModelCacheError && err.code === 'INVALID_PATH',
      );

      // UNC namespace escape
      assert.throws(
        () => cacheManager.resolveSafePath('\\\\attacker-smb\\share\\payload.bin'),
        (err: any) => err instanceof ModelCacheError && err.code === 'INVALID_PATH',
      );

      // Windows device names
      const deviceNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'];
      for (const dev of deviceNames) {
        assert.throws(
          () => cacheManager.resolveSafePath(dev),
          (err: any) =>
            err instanceof ModelCacheError &&
            err.code === 'INVALID_PATH' &&
            /reserved device/i.test(err.message),
        );
      }

      // Alternate Data Streams (ADS)
      assert.throws(
        () => cacheManager.resolveSafePath('model.gguf:evil.exe'),
        (err: any) =>
          err instanceof ModelCacheError &&
          err.code === 'INVALID_PATH' &&
          /Alternate data stream/i.test(err.message),
      );
    });

    it('flattens namespaced modelIds safely without nested directory escape', async () => {
      const namespacedManifest = createManifest({
        modelId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
        name: 'DeepSeek R1 Distill Qwen 1.5B',
      });

      const artifact = await cacheManager.downloadArtifact({
        manifest: namespacedManifest,
        allowLocalhostForTesting: true,
      });

      assert.equal(artifact.modelId, namespacedManifest.modelId);
      assert.ok(fs.existsSync(artifact.storagePath));

      // Storage path must be strictly within baseDir/models
      const normalizedStorage = path.resolve(artifact.storagePath);
      const normalizedModels = path.resolve(path.join(tmpDir, 'models'));
      assert.ok(normalizedStorage.startsWith(normalizedModels + path.sep));
    });
  });

  // ============================================================
  // 065-SEC-05: Strict Stream Quota & Disk Bounding
  // ============================================================

  describe('065-SEC-05: Strict Stream Quota & Disk Bounding', () => {
    it('aborts immediately and deletes staging file if stream exceeds manifest byteSize', async () => {
      const oversizedManifest = createManifest({
        modelId: 'nexus/oversized-model',
        source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/oversized.gguf` },
        byteSize: validPayload.length, // Server attempts to send validPayload + extra
      });

      await assert.rejects(
        () =>
          cacheManager.downloadArtifact({
            manifest: oversizedManifest,
            allowLocalhostForTesting: true,
          }),
        (err: any) => {
          assert.ok(err instanceof ModelCacheError);
          assert.equal(err.code, 'QUOTA_EXCEEDED');
          assert.match(err.message, /exceeded declared manifest byteSize/i);
          return true;
        },
      );

      const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
      assert.equal(stagingFiles.length, 0, 'Oversized staging file must be destroyed');
    });

    it('rejects download when available cache quota cannot accommodate manifest byteSize', async () => {
      const limitedCache = new ModelCacheManager(tmpDir, validPayload.length - 1); // 1 byte less than required
      await limitedCache.initialize();

      const manifest = createManifest();

      await assert.rejects(
        () =>
          limitedCache.downloadArtifact({
            manifest,
            allowLocalhostForTesting: true,
          }),
        (err: any) => {
          assert.ok(err instanceof ModelCacheError);
          assert.equal(err.code, 'QUOTA_EXCEEDED');
          assert.match(err.message, /quota exceeded/i);
          return true;
        },
      );
    });
  });

  // ============================================================
  // 065-SEC-06 / 07 / 08: Future Phasing Placeholders
  // ============================================================

  describe('065-SEC-06..08: Inference & Benchmarking Invariants (Phase 3)', () => {
    it.skip('065-SEC-06: VRAM Safety Ceiling & Layer Offload Integrity [PENDING PHASE 3 BENCHMARKING]', () => {});
    it.skip('065-SEC-07: Cryptographic Lease Binding for Model Execution [PENDING PHASE 3 INFERENCE HARNESS]', () => {});
    it.skip('065-SEC-08: Non-Repudiable Evidence Integrity & Truthful Capability Reporting [PENDING PHASE 3 BENCHMARKING]', () => {});
  });
});
