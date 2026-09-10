import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { ModelDownloadProgress, ModelManifest } from '@nexusos/contracts';
import {
  ModelCacheError,
  ModelCacheManager,
} from '../src/runtimes/local-ai/model-cache-manager.js';

describe('Task 065 — Phase 2: Secure Model Artifact Acquisition & Cache Lifecycle', () => {
  let tmpDir: string;
  let cacheManager: ModelCacheManager;
  let server: http.Server;
  let serverUrl: string;

  const validPayload = Buffer.from(
    'GGUF_SYNTHETIC_MODEL_VALID_PAYLOAD_TEST_DATA_NEXUS_OS_065_2026',
  );
  const validSha256 = crypto.createHash('sha256').update(validPayload).digest('hex');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-model-download-test-'));
    cacheManager = new ModelCacheManager(tmpDir, 10 * 1024 * 1024); // 10 MB quota
    await cacheManager.initialize();

    // Start synthetic loopback HTTP server
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      if (url.pathname === '/valid-model.gguf') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': validPayload.length.toString(),
        });
        res.end(validPayload);
      } else if (url.pathname === '/corrupt-hash.gguf') {
        const corruptPayload = Buffer.from('CORRUPTED_PAYLOAD_HASH_MISMATCH_SIMULATION');
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': corruptPayload.length.toString(),
        });
        res.end(corruptPayload);
      } else if (url.pathname === '/mismatched-content-length.gguf') {
        // Send Content-Length header that contradicts manifest byteSize
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '999999',
        });
        res.end(validPayload);
      } else if (url.pathname === '/oversized-stream.gguf') {
        // Stream more bytes than manifest byteSize (without sending Content-Length)
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
        });
        res.write(validPayload);
        res.write(Buffer.from('_EXTRA_UNAUTHORIZED_OVERSIZED_BYTES'));
        res.end();
      } else if (url.pathname === '/premature-eof.gguf') {
        // Send fewer bytes than manifest expects and close stream (premature EOF)
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
        });
        res.end(validPayload.subarray(0, 10));
      } else if (url.pathname === '/redirect-safe') {
        res.writeHead(302, { Location: '/valid-model.gguf' });
        res.end();
      } else if (url.pathname === '/redirect-unsafe-metadata') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      } else if (url.pathname === '/redirect-private-ip') {
        res.writeHead(302, { Location: 'http://10.0.0.1/model.gguf' });
        res.end();
      } else if (url.pathname === '/server-error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
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
    modelId: 'test-org/test-model-q4',
    name: 'Test Model Q4',
    version: '1.0.0',
    format: 'gguf',
    quantization: 'Q4_0',
    parameterSize: '1B',
    contextLength: 4096,
    byteSize: validPayload.length,
    sha256: validSha256,
    source: {
      sourceType: 'TRUSTED_HTTPS',
      url: `${serverUrl}/valid-model.gguf`,
    },
    metadata: { license: 'Apache-2.0' },
    ...overrides,
  });

  // ============================================================
  // Requirement 1 & 2 & 13: Successful Streamed Download, Hash Match, Atomic Promotion
  // ============================================================

  it('1. successful streamed download with SHA-256 match and atomic promotion', async () => {
    const manifest = createManifest();
    const progressEvents: ModelDownloadProgress[] = [];

    const artifact = await cacheManager.downloadArtifact({
      manifest,
      allowLocalhostForTesting: true,
      onProgress: (p) => progressEvents.push(p),
    });

    assert.equal(artifact.modelId, manifest.modelId);
    assert.equal(artifact.state, 'Installed');
    assert.equal(artifact.fileSizeBytes, validPayload.length);
    assert.equal(artifact.sha256, validSha256);

    // Verify storagePath is inside modelsDir and exists
    assert.ok(fs.existsSync(artifact.storagePath));
    const storageContent = fs.readFileSync(artifact.storagePath);
    assert.ok(storageContent.equals(validPayload));

    // Staging directory must be empty after promotion
    const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
    assert.equal(stagingFiles.length, 0, 'Staging directory must be empty after promotion');

    // Verify progress events
    assert.ok(progressEvents.length >= 2, 'Must emit download and completion progress');
    assert.equal(progressEvents[0].status, 'DOWNLOADING');
    assert.equal(progressEvents[progressEvents.length - 1].status, 'COMPLETED');
  });

  // ============================================================
  // Requirement 3 & 12 & 17: SHA-256 Mismatch Quarantines/Deletes Staged File
  // ============================================================

  it('2. SHA-256 mismatch deletes staged file and rejects with HASH_MISMATCH', async () => {
    const manifest = createManifest({
      source: {
        sourceType: 'TRUSTED_HTTPS',
        url: `${serverUrl}/corrupt-hash.gguf`,
      },
      byteSize: Buffer.from('CORRUPTED_PAYLOAD_HASH_MISMATCH_SIMULATION').length,
      sha256: 'a'.repeat(64), // Incorrect hash
    });

    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest,
          allowLocalhostForTesting: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'HASH_MISMATCH');
        assert.match(err.message, /SHA-256 verification failed/i);
        return true;
      },
    );

    // Verify staging directory is clean (corrupt file deleted)
    const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
    assert.equal(stagingFiles.length, 0, 'Corrupt staged file must be removed immediately');

    // Verify models directory has no artifact
    const modelFiles = fs.readdirSync(path.join(tmpDir, 'models'));
    assert.equal(modelFiles.length, 0, 'No artifact may be placed in models directory');

    // Model must not be discoverable in catalog
    assert.equal(cacheManager.getModel(manifest.modelId), undefined);
  });

  // ============================================================
  // Requirement 4: Mismatched Manifest byteSize (Pre-flight Content-Length)
  // ============================================================

  it('3. Content-Length mismatch against manifest byteSize fails before downloading', async () => {
    const manifest = createManifest({
      source: {
        sourceType: 'TRUSTED_HTTPS',
        url: `${serverUrl}/mismatched-content-length.gguf`,
      },
      byteSize: validPayload.length, // Server reports 999999
    });

    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest,
          allowLocalhostForTesting: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'INCOMPLETE_DOWNLOAD');
        assert.match(err.message, /contradicts manifest byteSize/i);
        return true;
      },
    );

    const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
    assert.equal(stagingFiles.length, 0);
  });

  // ============================================================
  // Requirement 5: Stream Exceeds Manifest byteSize
  // ============================================================

  it('4. stream exceeding manifest byteSize aborts immediately and cleans staging', async () => {
    const manifest = createManifest({
      source: {
        sourceType: 'TRUSTED_HTTPS',
        url: `${serverUrl}/oversized-stream.gguf`,
      },
      byteSize: validPayload.length, // Stream delivers validPayload + extra bytes
    });

    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest,
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
    assert.equal(stagingFiles.length, 0, 'Oversized partial staging file must be deleted');
  });

  // ============================================================
  // Requirement 6: Premature EOF Detection
  // ============================================================

  it('5. premature EOF is detected, cleans staging, and rejects with INCOMPLETE_DOWNLOAD', async () => {
    const manifest = createManifest({
      source: {
        sourceType: 'TRUSTED_HTTPS',
        url: `${serverUrl}/premature-eof.gguf`,
      },
      byteSize: validPayload.length, // Stream delivers only 10 bytes then destroys connection
    });

    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest,
          allowLocalhostForTesting: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'INCOMPLETE_DOWNLOAD');
        assert.match(err.message, /Incomplete download/i);
        return true;
      },
    );

    const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
    assert.equal(stagingFiles.length, 0, 'Truncated staging file must be cleaned up');
  });

  // ============================================================
  // Requirement 7: Cache Quota Exhaustion
  // ============================================================

  it('6. cache quota exhaustion rejects before download begins', async () => {
    // Cache manager with tiny quota smaller than payload
    const tinyCache = new ModelCacheManager(tmpDir, 10); // 10 bytes quota
    await tinyCache.initialize();

    const manifest = createManifest();

    await assert.rejects(
      () =>
        tinyCache.downloadArtifact({
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

  // ============================================================
  // Requirement 8: Unsafe URL Rejected (SSRF & Scheme)
  // ============================================================

  it('7. unsafe URLs and non-HTTPS protocols are rejected', async () => {
    // Non-HTTPS without testing allowance
    const httpManifest = createManifest({
      source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/valid-model.gguf` },
    });
    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({ manifest: httpManifest, allowLocalhostForTesting: false }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'UNSAFE_DESTINATION');
        assert.match(err.message, /HTTPS is strictly required/i);
        return true;
      },
    );

    // Private IPv4 endpoint
    const rfc1918Manifest = createManifest({
      source: { sourceType: 'TRUSTED_HTTPS', url: 'https://10.0.0.1/model.gguf' },
    });
    await assert.rejects(
      () => cacheManager.downloadArtifact({ manifest: rfc1918Manifest }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'UNSAFE_DESTINATION');
        assert.match(err.message, /private, loopback, or reserved IP/i);
        return true;
      },
    );

    // Cloud metadata endpoint
    const metadataManifest = createManifest({
      source: { sourceType: 'TRUSTED_HTTPS', url: 'https://169.254.169.254/latest/meta-data' },
    });
    await assert.rejects(
      () => cacheManager.downloadArtifact({ manifest: metadataManifest }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'UNSAFE_DESTINATION');
        assert.match(err.message, /metadata destination/i);
        return true;
      },
    );

    // Embedded credentials in URL
    const credentialsManifest = createManifest({
      source: { sourceType: 'TRUSTED_HTTPS', url: 'https://admin:secret@example.com/model.gguf' },
    });
    await assert.rejects(
      () => cacheManager.downloadArtifact({ manifest: credentialsManifest }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'UNSAFE_DESTINATION');
        assert.match(err.message, /Embedded credentials/i);
        return true;
      },
    );
  });

  // ============================================================
  // Requirement 9: Unsafe Redirect Rejected
  // ============================================================

  it('8. safe redirects are followed, but redirects to unsafe destinations are blocked', async () => {
    // 1. Safe redirect to valid model
    const safeRedirectManifest = createManifest({
      source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/redirect-safe` },
    });
    const artifact = await cacheManager.downloadArtifact({
      manifest: safeRedirectManifest,
      allowLocalhostForTesting: true,
    });
    assert.equal(artifact.state, 'Installed');

    // 2. Unsafe redirect to cloud metadata (must be blocked even if testing allowed)
    const unsafeRedirectManifest = createManifest({
      modelId: 'test-org/unsafe-redirect-model',
      source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/redirect-unsafe-metadata` },
    });
    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest: unsafeRedirectManifest,
          allowLocalhostForTesting: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'UNSAFE_DESTINATION');
        return true;
      },
    );

    // 3. Unsafe redirect to RFC1918 private IP
    const privateRedirectManifest = createManifest({
      modelId: 'test-org/private-redirect-model',
      source: { sourceType: 'TRUSTED_HTTPS', url: `${serverUrl}/redirect-private-ip` },
    });
    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest: privateRedirectManifest,
          allowLocalhostForTesting: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'UNSAFE_DESTINATION');
        return true;
      },
    );
  });

  // ============================================================
  // Requirement 10 & 11: Path Traversal & Windows Device Escape Rejected
  // ============================================================

  it('9. path traversal and reserved device paths are rejected', () => {
    assert.throws(
      () => cacheManager.resolveSafePath('../../etc/passwd'),
      (err: any) => err instanceof ModelCacheError && err.code === 'INVALID_PATH',
    );

    assert.throws(
      () => cacheManager.resolveSafePath('COM1'),
      (err: any) =>
        err instanceof ModelCacheError &&
        err.code === 'INVALID_PATH' &&
        /reserved device/i.test(err.message),
    );

    assert.throws(
      () => cacheManager.resolveSafePath('NUL'),
      (err: any) =>
        err instanceof ModelCacheError &&
        err.code === 'INVALID_PATH' &&
        /reserved device/i.test(err.message),
    );

    assert.throws(
      () => cacheManager.resolveSafePath('models/artifact.bin:stream'),
      (err: any) =>
        err instanceof ModelCacheError &&
        err.code === 'INVALID_PATH' &&
        /Alternate data stream/i.test(err.message),
    );
  });

  // ============================================================
  // Requirement 14: Progress Reporting Never Exceeds Total
  // ============================================================

  it('10. progress reporting strictly bounds bytesTransferred <= totalBytes', async () => {
    const manifest = createManifest();
    const progressLog: ModelDownloadProgress[] = [];

    await cacheManager.downloadArtifact({
      manifest,
      allowLocalhostForTesting: true,
      onProgress: (p) => {
        progressLog.push(p);
        assert.ok(
          p.bytesTransferred <= p.totalBytes,
          `Progress bytesTransferred (${p.bytesTransferred}) cannot exceed totalBytes (${p.totalBytes})`,
        );
        assert.ok(p.bytesTransferred >= 0);
      },
    });

    assert.ok(progressLog.length > 0);
    const lastProgress = progressLog[progressLog.length - 1];
    assert.equal(lastProgress.bytesTransferred, manifest.byteSize);
    assert.equal(lastProgress.totalBytes, manifest.byteSize);
    assert.equal(lastProgress.status, 'COMPLETED');
  });

  // ============================================================
  // Requirement 15: Concurrent Same-Model Download Behavior
  // ============================================================

  it('11. concurrent downloads for the same model are deduplicated deterministically', async () => {
    const manifest = createManifest({ modelId: 'test-org/concurrent-model' });

    // Launch two concurrent download requests simultaneously
    const [result1, result2] = await Promise.all([
      cacheManager.downloadArtifact({ manifest, allowLocalhostForTesting: true }),
      cacheManager.downloadArtifact({ manifest, allowLocalhostForTesting: true }),
    ]);

    assert.equal(result1.modelId, manifest.modelId);
    assert.equal(result2.modelId, manifest.modelId);
    assert.equal(result1.storagePath, result2.storagePath);
    assert.ok(fs.existsSync(result1.storagePath));

    // Models directory should contain only one artifact file
    const modelFiles = fs.readdirSync(path.join(tmpDir, 'models'));
    assert.equal(modelFiles.length, 1);
  });

  // ============================================================
  // Requirement 16 & 18: Vertical Slice (Manifest -> Download -> Verify -> Cache Lookup)
  // ============================================================

  it('12. vertical slice: valid manifest -> secure download -> SHA verification -> cache promotion -> cache lookup', async () => {
    const manifest = createManifest({
      modelId: 'meta-llama/Llama-3.2-1B-Instruct',
      name: 'Llama 3.2 1B Instruct',
      format: 'gguf',
      quantization: 'Q4_0',
    });

    // 1. Initial state: model not in cache
    assert.equal(cacheManager.getModel(manifest.modelId), undefined);

    // 2. Download and verify
    const installed = await cacheManager.downloadArtifact({
      manifest,
      allowLocalhostForTesting: true,
    });

    assert.equal(installed.modelId, manifest.modelId);
    assert.equal(installed.state, 'Installed');

    // 3. Existing cache lookup
    const retrieved = cacheManager.getModel(manifest.modelId);
    assert.ok(retrieved !== undefined);
    assert.equal(retrieved.modelId, manifest.modelId);
    assert.equal(retrieved.storagePath, installed.storagePath);
    assert.equal(retrieved.state, 'Installed');

    // 4. Subsequent download returns cached artifact without network call
    const cachedResult = await cacheManager.downloadArtifact({
      manifest,
      allowLocalhostForTesting: true,
    });
    assert.equal(cachedResult.storagePath, installed.storagePath);
  });

  // ============================================================
  // AbortSignal Cancellation
  // ============================================================

  it('13. AbortSignal aborts download cleanly and removes staging file', async () => {
    const manifest = createManifest({ modelId: 'test-org/aborted-model' });
    const controller = new AbortController();

    // Abort before download or during initial handshake
    controller.abort();

    await assert.rejects(
      () =>
        cacheManager.downloadArtifact({
          manifest,
          signal: controller.signal,
          allowLocalhostForTesting: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ModelCacheError);
        assert.equal(err.code, 'ABORTED');
        return true;
      },
    );

    const stagingFiles = fs.readdirSync(path.join(tmpDir, 'staging'));
    assert.equal(stagingFiles.length, 0);
  });
});
