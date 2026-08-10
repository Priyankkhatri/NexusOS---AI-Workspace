import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PathSecurityService } from '../src/index.js';

describe('Path Security Service — Traversal, Scope, & Symlink Security', () => {
  let tmpRootDir: string;
  let allowedSubDir: string;
  let forbiddenSubDir: string;
  const pathSecurity = new PathSecurityService();

  before(() => {
    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-fs-sec-test-'));
    allowedSubDir = path.join(tmpRootDir, 'allowed-workspace');
    forbiddenSubDir = path.join(tmpRootDir, 'forbidden-secrets');

    fs.mkdirSync(allowedSubDir, { recursive: true });
    fs.mkdirSync(forbiddenSubDir, { recursive: true });

    fs.writeFileSync(path.join(allowedSubDir, 'sample.txt'), 'allowed content');
    fs.writeFileSync(path.join(forbiddenSubDir, 'secret.pem'), 'TOP_SECRET');
  });

  after(() => {
    if (fs.existsSync(tmpRootDir)) {
      fs.rmSync(tmpRootDir, { recursive: true, force: true });
    }
  });

  it('validates a normal path inside an allowed root', () => {
    const target = path.join(allowedSubDir, 'sample.txt');
    const result = pathSecurity.validatePath(target, [allowedSubDir]);

    assert.strictEqual(result.valid, true);
    assert.ok(result.canonicalPath.length > 0);
    assert.strictEqual(result.isSymlink, false);
  });

  it('rejects path traversal attempting to escape using .. relative segments', () => {
    const traversalPath = path.join(allowedSubDir, '..', 'forbidden-secrets', 'secret.pem');
    const result = pathSecurity.validatePath(traversalPath, [allowedSubDir]);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error?.code, 'PATH_OUTSIDE_SCOPE');
  });

  it('rejects path traversal using multiple nested .. segments', () => {
    const traversalPath = path.join(allowedSubDir, 'subdir', '..', '..', '..', 'etc', 'passwd');
    const result = pathSecurity.validatePath(traversalPath, [allowedSubDir]);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error?.code, 'PATH_OUTSIDE_SCOPE');
  });

  it('rejects absolute path pointing outside allowed root', () => {
    const absoluteEscape = path.join(forbiddenSubDir, 'secret.pem');
    const result = pathSecurity.validatePath(absoluteEscape, [allowedSubDir]);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error?.code, 'PATH_OUTSIDE_SCOPE');
  });

  it('rejects paths containing null bytes', () => {
    const nullBytePath = path.join(allowedSubDir, 'sample.txt\0.exe');
    const result = pathSecurity.validatePath(nullBytePath, [allowedSubDir]);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error?.code, 'INVALID_PATH');
  });

  it('rejects raw device paths (\\\\.\\ or \\\\?\\)', () => {
    const devicePath = '\\\\.\\PhysicalDrive0';
    const result = pathSecurity.validatePath(devicePath, [allowedSubDir]);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error?.code, 'DEVICE_PATH_PROHIBITED');
  });

  it('detects symlink pointing outside allowed root and rejects with SYMLINK_SCOPE_ESCAPE', () => {
    const symlinkPath = path.join(allowedSubDir, 'symlink-to-secrets.txt');
    const targetFile = path.join(forbiddenSubDir, 'secret.pem');

    try {
      fs.symlinkSync(targetFile, symlinkPath);
    } catch {
      // Symlink creation might fail on Windows if unprivileged, skip gracefully if OS denies symlink creation
      return;
    }

    const result = pathSecurity.validatePath(symlinkPath, [allowedSubDir]);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.isSymlink, true);
    assert.strictEqual(result.error?.code, 'SYMLINK_SCOPE_ESCAPE');

    fs.unlinkSync(symlinkPath);
  });

  it('fails closed if allowedRoots list is empty', () => {
    const target = path.join(allowedSubDir, 'sample.txt');
    const result = pathSecurity.validatePath(target, []);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error?.code, 'PATH_OUTSIDE_SCOPE');
  });
});
