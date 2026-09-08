import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ExecutionLeaseHeader, computeFilesystemEvidenceChecksum } from '@nexusos/contracts';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import {
  FilesystemRuntime,
  PathSecurityService,
  WorkspaceDirectoryJail,
  ExecutionLeaseBoundary,
  FilesystemOperationName,
  FilesystemOperationRequestContext,
} from '@nexusos/desktop-agent';

class AllowAllPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      reason: 'Allowed in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Task 050 — Filesystem Security Invariants (050-SEC-01 to 050-SEC-05)', () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let outsideRoot: string;
  let runtime: FilesystemRuntime;
  let pathSecurity: PathSecurityService;
  let workspaceJail: WorkspaceDirectoryJail;

  const defaultTenantId = 'a1b2c3d4-e5f6-4a1b-8c2d-1e2f3a4b5c6d';
  const otherTenantId = 'b2c3d4e5-f6a1-4b2c-9d3e-2f3a4b5c6d7e';

  function createValidLease(
    scopes: string[] = [
      'fs:read',
      'fs:write',
      'fs:list',
      'fs:stat',
      'fs:copy',
      'fs:move',
      'fs:delete',
    ],
    tenantId = defaultTenantId,
    taskId = crypto.randomUUID(),
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: 'agent-desktop-050',
      tenant_id: tenantId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      scopes,
      nonce: crypto.randomUUID(),
      signature: 'valid-test-signature',
    };
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-sec050-'));
    workspaceRoot = path.join(tmpRoot, 'workspace');
    outsideRoot = path.join(tmpRoot, 'outside');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    pathSecurity = new PathSecurityService();
    workspaceJail = new WorkspaceDirectoryJail();
    const leaseBoundary = new ExecutionLeaseBoundary(new AllowAllPolicyEvaluator() as any);
    runtime = new FilesystemRuntime(
      leaseBoundary,
      pathSecurity,
      undefined,
      undefined,
      workspaceJail,
    );

    // Register standard test workspace
    workspaceJail.registerWorkspace({
      workspaceId: 'ws-primary',
      tenantId: defaultTenantId,
      rootPath: workspaceRoot,
      isReadOnly: false,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on Windows
      }
    }
  });

  // =========================================================================
  // 050-SEC-01: Canonical Path & OS Directory Jail
  // =========================================================================
  describe('050-SEC-01: Canonical Path Enforcement & OS Directory Jail', () => {
    it('rejects relative traversal escaping jail using .. segments', async () => {
      const escapePath = path.join(workspaceRoot, '..', 'outside', 'escaped.txt');
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      const outcome = await runtime.writeFile(
        { path: escapePath, content: 'malicious payload' },
        context,
      );

      assert.strictEqual(outcome.result.success, false);
      assert.strictEqual(outcome.result.error?.code, 'PATH_OUTSIDE_SCOPE');
      assert.strictEqual(outcome.event.schema_id, 'nexusos.events.filesystem.denied.v1');
      assert.strictEqual(fs.existsSync(path.join(outsideRoot, 'escaped.txt')), false);
    });

    it('rejects absolute path pointing outside authorized workspace root', async () => {
      const targetOutside = path.join(outsideRoot, 'secret.txt');
      fs.writeFileSync(targetOutside, 'secret-data');

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      const readOutcome = await runtime.readFile({ path: targetOutside }, context);
      assert.strictEqual(readOutcome.result.success, false);
      assert.strictEqual(readOutcome.result.error?.code, 'PATH_OUTSIDE_SCOPE');
    });

    it('rejects path-prefix confusion where /workspace-evil attempts to satisfy /workspace', async () => {
      const evilWorkspace = workspaceRoot + '-evil';
      fs.mkdirSync(evilWorkspace, { recursive: true });
      const evilFile = path.join(evilWorkspace, 'evil.txt');

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      const writeOutcome = await runtime.writeFile(
        { path: evilFile, content: 'prefix-confusion' },
        context,
      );

      assert.strictEqual(writeOutcome.result.success, false);
      assert.strictEqual(writeOutcome.result.error?.code, 'PATH_OUTSIDE_SCOPE');
      assert.strictEqual(fs.existsSync(evilFile), false);
    });

    it('rejects raw NT namespace and device path forms (\\\\.\\, \\\\?\\)', async () => {
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      const devicePaths = [
        '\\\\.\\PhysicalDrive0',
        '\\\\?\\C:\\Windows\\System32',
        '//./PhysicalDrive0',
        '//?/C:/Windows',
      ];

      for (const devPath of devicePaths) {
        const res = await runtime.readFile({ path: devPath }, context);
        assert.strictEqual(res.result.success, false);
        assert.ok(
          res.result.error?.code === 'DEVICE_PATH_PROHIBITED' ||
            res.result.error?.code === 'PATH_OUTSIDE_SCOPE',
          `Expected DEVICE_PATH_PROHIBITED or PATH_OUTSIDE_SCOPE, got ${res.result.error?.code}`,
        );
      }
    });

    it('rejects paths containing null byte injection', async () => {
      const poisonPath = path.join(workspaceRoot, 'file.txt\0.exe');
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      const res = await runtime.writeFile({ path: poisonPath, content: 'test' }, context);
      assert.strictEqual(res.result.success, false);
      assert.ok(
        res.result.error?.code === 'INVALID_PATH' ||
          res.result.error?.code === 'PATH_OUTSIDE_SCOPE',
        `Expected INVALID_PATH or PATH_OUTSIDE_SCOPE, got ${res.result.error?.code}`,
      );
    });
  });

  // =========================================================================
  // 050-SEC-02: Reparse Point / Symlink / Junction Escape Prevention
  // =========================================================================
  describe('050-SEC-02: Reparse Point, Symlink & Junction Escape Prevention', () => {
    it('detects symlink pointing outside allowed root and fails closed with SYMLINK_SCOPE_ESCAPE', async () => {
      const outsideFile = path.join(outsideRoot, 'host-passwords.txt');
      fs.writeFileSync(outsideFile, 'admin:secret123');

      const symlinkPath = path.join(workspaceRoot, 'symlink-outside');
      try {
        fs.symlinkSync(outsideFile, symlinkPath);
      } catch {
        // Skip if running in an environment without Windows symlink privilege
        return;
      }

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      // 1. Read through escaping symlink
      const readRes = await runtime.readFile({ path: symlinkPath }, context);
      assert.strictEqual(readRes.result.success, false);
      assert.strictEqual(readRes.result.error?.code, 'SYMLINK_SCOPE_ESCAPE');

      // 2. Write through escaping symlink
      const writeRes = await runtime.writeFile(
        { path: symlinkPath, content: 'overwritten' },
        context,
      );
      assert.strictEqual(writeRes.result.success, false);
      assert.strictEqual(writeRes.result.error?.code, 'SYMLINK_SCOPE_ESCAPE');

      // 3. Stat through escaping symlink
      const statRes = await runtime.statFile({ path: symlinkPath }, context);
      assert.strictEqual(statRes.result.success, false);
      assert.strictEqual(statRes.result.error?.code, 'SYMLINK_SCOPE_ESCAPE');
    });

    it('rejects nested uncreated target where an ancestor directory is a symlink escaping jail', async () => {
      const outsideDir = path.join(outsideRoot, 'outside-dir');
      fs.mkdirSync(outsideDir, { recursive: true });

      const symlinkDir = path.join(workspaceRoot, 'symlink-dir');
      try {
        fs.symlinkSync(outsideDir, symlinkDir, 'junction');
      } catch {
        return;
      }

      const nestedTarget = path.join(symlinkDir, 'subfolder', 'newfile.txt');
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      const writeRes = await runtime.writeFile(
        { path: nestedTarget, content: 'escape through nested ancestor' },
        context,
      );
      assert.strictEqual(writeRes.result.success, false);
      assert.strictEqual(writeRes.result.error?.code, 'SYMLINK_SCOPE_ESCAPE');
      assert.strictEqual(fs.existsSync(path.join(outsideDir, 'subfolder', 'newfile.txt')), false);
    });
  });

  // =========================================================================
  // 050-SEC-03: Sensitive Host Paths & NTFS Alternate Data Streams (ADS)
  // =========================================================================
  describe('050-SEC-03: Sensitive Host OS Paths & NTFS Alternate Data Streams', () => {
    it('rejects NTFS Alternate Data Stream accesses with ADS_PROHIBITED', async () => {
      const validFile = path.join(workspaceRoot, 'legit.txt');
      fs.writeFileSync(validFile, 'hello world');

      const adsPath = `${validFile}:hidden_stream`;
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot],
      };

      // Write to ADS
      const writeRes = await runtime.writeFile(
        { path: adsPath, content: 'hidden malicious payload' },
        context,
      );
      assert.strictEqual(writeRes.result.success, false);
      assert.strictEqual(writeRes.result.error?.code, 'ADS_PROHIBITED');

      // Read from ADS
      const readRes = await runtime.readFile({ path: adsPath }, context);
      assert.strictEqual(readRes.result.success, false);
      assert.strictEqual(readRes.result.error?.code, 'ADS_PROHIBITED');
    });

    it('rejects sensitive Windows and Unix system paths with PROTECTED_PATH_DENIED', async () => {
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot, 'C:\\', '/'],
      };

      const sensitivePaths = [
        'C:\\Windows\\System32\\cmd.exe',
        'C:\\Program Files\\app.exe',
        'C:\\ProgramData\\secret.dat',
        '/etc/passwd',
        '/etc/shadow',
        '/var/run/docker.sock',
      ];

      for (const sensPath of sensitivePaths) {
        const res = await runtime.readFile({ path: sensPath }, context);
        assert.strictEqual(res.result.success, false);
        assert.strictEqual(
          res.result.error?.code,
          'PROTECTED_PATH_DENIED',
          `Failed to reject sensitive path: ${sensPath}`,
        );
      }
    });

    it('rejects user credential paths (.ssh, .aws, .azure) with PROTECTED_PATH_DENIED', async () => {
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        allowedRoots: [workspaceRoot, os.homedir()],
      };

      const credPaths = [
        path.join(workspaceRoot, '.ssh', 'id_rsa'),
        path.join(workspaceRoot, '.aws', 'credentials'),
        path.join(workspaceRoot, '.azure', 'tokens.json'),
        path.join(workspaceRoot, '.kube', 'config'),
      ];

      for (const credPath of credPaths) {
        const res = await runtime.readFile({ path: credPath }, context);
        assert.strictEqual(res.result.success, false);
        assert.strictEqual(
          res.result.error?.code,
          'PROTECTED_PATH_DENIED',
          `Failed to reject credential path: ${credPath}`,
        );
      }
    });
  });

  // =========================================================================
  // 050-SEC-04: Workspace Write Authorization & Cross-Tenant Binding
  // =========================================================================
  describe('050-SEC-04: Workspace Write Authorization & Cross-Tenant Binding', () => {
    it('fails closed with WRITE_NOT_AUTHORIZED when mutating read-only workspace', async () => {
      const roWorkspace = path.join(tmpRoot, 'ro-workspace');
      fs.mkdirSync(roWorkspace, { recursive: true });
      const testFile = path.join(roWorkspace, 'existing.txt');
      fs.writeFileSync(testFile, 'read-only content');

      workspaceJail.registerWorkspace({
        workspaceId: 'ws-ro',
        tenantId: defaultTenantId,
        rootPath: roWorkspace,
        isReadOnly: true,
      });

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-ro',
        allowedRoots: [roWorkspace],
      };

      // 1. Read MUST succeed
      const readRes = await runtime.readFile({ path: testFile }, context);
      assert.strictEqual(readRes.result.success, true);
      assert.strictEqual(readRes.result.data, 'read-only content');

      // 2. Write MUST fail with WRITE_NOT_AUTHORIZED
      const writeRes = await runtime.writeFile(
        { path: path.join(roWorkspace, 'new.txt'), content: 'fail' },
        context,
      );
      assert.strictEqual(writeRes.result.success, false);
      assert.strictEqual(writeRes.result.error?.code, 'WRITE_NOT_AUTHORIZED');

      // 3. Delete MUST fail with WRITE_NOT_AUTHORIZED
      const delRes = await runtime.deleteFile({ path: testFile }, context);
      assert.strictEqual(delRes.result.success, false);
      assert.strictEqual(delRes.result.error?.code, 'WRITE_NOT_AUTHORIZED');
      assert.strictEqual(fs.existsSync(testFile), true);

      // 4. Copy MUST fail with WRITE_NOT_AUTHORIZED
      const copyRes = await runtime.copyFile(
        { sourcePath: testFile, destinationPath: path.join(roWorkspace, 'copy.txt') },
        context,
      );
      assert.strictEqual(copyRes.result.success, false);
      assert.strictEqual(copyRes.result.error?.code, 'WRITE_NOT_AUTHORIZED');
    });

    it('rejects access to unregistered workspace with WORKSPACE_NOT_FOUND', async () => {
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-non-existent',
        allowedRoots: [workspaceRoot],
      };

      const res = await runtime.readFile({ path: path.join(workspaceRoot, 'file.txt') }, context);
      assert.strictEqual(res.result.success, false);
      assert.strictEqual(res.result.error?.code, 'WORKSPACE_NOT_FOUND');
    });

    it('rejects cross-tenant workspace access with TENANT_MISMATCH', async () => {
      // Lease is issued to otherTenantId, but workspace belongs to defaultTenantId
      const lease = createValidLease(undefined, otherTenantId);
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-primary',
        allowedRoots: [workspaceRoot],
      };

      const res = await runtime.readFile({ path: path.join(workspaceRoot, 'file.txt') }, context);
      assert.strictEqual(res.result.success, false);
      assert.strictEqual(res.result.error?.code, 'TENANT_MISMATCH');
    });

    it('prevents workspace A authorization from being used against workspace B paths', async () => {
      const workspaceB = path.join(tmpRoot, 'workspace-b');
      fs.mkdirSync(workspaceB, { recursive: true });
      const fileB = path.join(workspaceB, 'secret-b.txt');
      fs.writeFileSync(fileB, 'workspace-b-secret');

      workspaceJail.registerWorkspace({
        workspaceId: 'ws-b',
        tenantId: defaultTenantId,
        rootPath: workspaceB,
        isReadOnly: false,
      });

      // Request specifies workspaceId: 'ws-primary', but targets file in workspace-b
      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-primary',
        allowedRoots: [],
      };

      const res = await runtime.readFile({ path: fileB }, context);
      assert.strictEqual(res.result.success, false);
      assert.strictEqual(res.result.error?.code, 'PATH_OUTSIDE_SCOPE');
    });
  });

  // =========================================================================
  // 050-SEC-05: Cryptographically Linked Pre/Post Mutation Evidence Chaining
  // =========================================================================
  describe('050-SEC-05: Cryptographically Linked Mutation Evidence Chaining', () => {
    it('produces verified evidence chain for new file write', async () => {
      const target = path.join(workspaceRoot, 'evidence-write.txt');
      const content = 'First version content for evidence chaining';
      const expectedPostHash = crypto.createHash('sha256').update(content).digest('hex');

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-primary',
        allowedRoots: [workspaceRoot],
      };

      const outcome = await runtime.writeFile({ path: target, content }, context);

      assert.strictEqual(outcome.result.success, true);
      assert.strictEqual(outcome.result.preHash, undefined); // New file had no pre-mutation hash
      assert.strictEqual(outcome.result.postHash, expectedPostHash);
      assert.ok(outcome.result.evidenceChecksum, 'Evidence checksum must be generated');

      // Verify deterministic checksum formula
      const expectedChecksum = computeFilesystemEvidenceChecksum({
        taskId: lease.task_id,
        leaseId: lease.lease_id,
        operation: FilesystemOperationName.WRITE,
        canonicalPath: outcome.result.canonicalPath,
        postHash: expectedPostHash,
      });
      assert.strictEqual(outcome.result.evidenceChecksum, expectedChecksum);

      // Verify event envelope links evidence
      assert.strictEqual(
        (outcome.event.payload as Record<string, unknown>).evidenceChecksum,
        expectedChecksum,
      );
      assert.strictEqual(
        (outcome.event.payload as Record<string, unknown>).postHash,
        expectedPostHash,
      );
    });

    it('produces verified pre and post hashes when overwriting an existing file', async () => {
      const target = path.join(workspaceRoot, 'evidence-overwrite.txt');
      const initialContent = 'Original file content v1';
      const updatedContent = 'Modified file content v2';

      fs.writeFileSync(target, initialContent);
      const expectedPreHash = crypto.createHash('sha256').update(initialContent).digest('hex');
      const expectedPostHash = crypto.createHash('sha256').update(updatedContent).digest('hex');

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-primary',
        allowedRoots: [workspaceRoot],
      };

      const outcome = await runtime.writeFile(
        { path: target, content: updatedContent, overwrite: true },
        context,
      );

      assert.strictEqual(outcome.result.success, true);
      assert.strictEqual(outcome.result.preHash, expectedPreHash);
      assert.strictEqual(outcome.result.postHash, expectedPostHash);

      const expectedChecksum = computeFilesystemEvidenceChecksum({
        taskId: lease.task_id,
        leaseId: lease.lease_id,
        operation: FilesystemOperationName.WRITE,
        canonicalPath: outcome.result.canonicalPath,
        preHash: expectedPreHash,
        postHash: expectedPostHash,
      });
      assert.strictEqual(outcome.result.evidenceChecksum, expectedChecksum);
    });

    it('produces verified pre-hash and null post-hash when deleting a file', async () => {
      const target = path.join(workspaceRoot, 'evidence-delete.txt');
      const content = 'File to be deleted';
      fs.writeFileSync(target, content);
      const expectedPreHash = crypto.createHash('sha256').update(content).digest('hex');

      const lease = createValidLease();
      const context: FilesystemOperationRequestContext = {
        lease,
        workspaceId: 'ws-primary',
        allowedRoots: [workspaceRoot],
      };

      const outcome = await runtime.deleteFile({ path: target }, context);

      assert.strictEqual(outcome.result.success, true);
      assert.strictEqual(outcome.result.preHash, expectedPreHash);
      assert.strictEqual(outcome.result.postHash, undefined);

      const expectedChecksum = computeFilesystemEvidenceChecksum({
        taskId: lease.task_id,
        leaseId: lease.lease_id,
        operation: FilesystemOperationName.DELETE,
        canonicalPath: outcome.result.canonicalPath,
        preHash: expectedPreHash,
      });
      assert.strictEqual(outcome.result.evidenceChecksum, expectedChecksum);
    });

    it('tampering with task, lease, or hashes invalidates deterministic evidence checksum', () => {
      const params = {
        taskId: 'task-100',
        leaseId: 'lease-200',
        operation: 'fs:write',
        canonicalPath: 'C:\\workspace\\file.txt',
        preHash: 'a'.repeat(64),
        postHash: 'b'.repeat(64),
      };

      const validChecksum = computeFilesystemEvidenceChecksum(params);

      // Tamper taskId
      const tamperedTask = computeFilesystemEvidenceChecksum({ ...params, taskId: 'task-999' });
      assert.notStrictEqual(tamperedTask, validChecksum);

      // Tamper leaseId
      const tamperedLease = computeFilesystemEvidenceChecksum({ ...params, leaseId: 'lease-999' });
      assert.notStrictEqual(tamperedLease, validChecksum);

      // Tamper postHash
      const tamperedHash = computeFilesystemEvidenceChecksum({
        ...params,
        postHash: 'c'.repeat(64),
      });
      assert.notStrictEqual(tamperedHash, validChecksum);
    });
  });
});
