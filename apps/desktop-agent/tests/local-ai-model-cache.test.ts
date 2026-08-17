import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelCacheManager } from '../src/runtimes/local-ai/model-cache-manager.js';

describe('Task 03T — ModelCacheManager Unit Tests', () => {
  let tmpDir: string;
  let cacheManager: ModelCacheManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-model-cache-test-'));
    cacheManager = new ModelCacheManager(tmpDir, 1024 * 1024); // 1 MB small test quota
    await cacheManager.initialize();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('MC-01: path traversal attempt outside base directory is blocked', () => {
    assert.throws(
      () => cacheManager.resolveSafePath('../../etc/passwd'),
      /Path traversal attack blocked/i,
    );
  });

  it('MC-02: null byte in path is rejected', () => {
    assert.throws(
      () => cacheManager.resolveSafePath('models/file\0.gguf'),
      /null byte or empty string detected/i,
    );
  });

  it('MC-03: computes SHA-256 and verifies artifact hash correctly', async () => {
    const filePath = path.join(tmpDir, 'test-artifact.bin');
    const content = Buffer.from('NexusOS local model content 12345');
    fs.writeFileSync(filePath, content);

    const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
    const isValid = await cacheManager.verifyArtifactHash(filePath, expectedHash);

    assert.equal(isValid, true, 'Hash matching content must return true');

    const isInvalid = await cacheManager.verifyArtifactHash(filePath, 'a'.repeat(64));
    assert.equal(isInvalid, false, 'Mismatched hash must return false');
  });

  it('MC-04: staging and atomic promotion moves verified model to models directory', async () => {
    const stagedFile = path.join(tmpDir, 'staging', 'temp-upload.bin');
    const content = Buffer.from('Verified GGUF model payload content');
    fs.writeFileSync(stagedFile, content);

    const sha256 = crypto.createHash('sha256').update(content).digest('hex');

    const artifact = await cacheManager.stageAndPromoteModel(stagedFile, {
      modelId: 'llama-3-8b',
      name: 'Llama 3 8B',
      provider: 'ollama',
      sha256,
      fileSizeBytes: content.length,
      format: 'gguf',
      quantization: 'q4_0',
      contextWindowTokens: 8192,
    });

    assert.equal(artifact.modelId, 'llama-3-8b');
    assert.equal(artifact.state, 'Installed');
    assert.ok(fs.existsSync(artifact.storagePath), 'Promoted model file must exist');
    assert.equal(fs.existsSync(stagedFile), false, 'Staged temporary file must be cleaned up');
  });

  it('MC-05: mismatched hash during staging deletes staged file and throws HASH_MISMATCH', async () => {
    const stagedFile = path.join(tmpDir, 'staging', 'corrupt.bin');
    fs.writeFileSync(stagedFile, Buffer.from('Corrupted payload'));

    await assert.rejects(
      () =>
        cacheManager.stageAndPromoteModel(stagedFile, {
          modelId: 'corrupt-model',
          name: 'Corrupt',
          provider: 'ollama',
          sha256: 'f'.repeat(64), // Mismatched hash
          fileSizeBytes: 100,
          format: 'gguf',
          quantization: 'q4_0',
          contextWindowTokens: 4096,
        }),
      /SHA-256 verification failed/i,
    );

    assert.equal(fs.existsSync(stagedFile), false, 'Corrupt staged file must be deleted');
  });
});
