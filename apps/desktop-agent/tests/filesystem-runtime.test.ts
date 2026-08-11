import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ExecutionLeaseHeader } from '@nexusos/contracts';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import {
  FilesystemRuntime,
  ExecutionLeaseBoundary,
  RuntimeRegistry,
  FilesystemExecutionPolicy,
  RuntimeCategory,
  FilesystemOperationName,
  FilesystemOperationRequestContext,
} from '../src/index.js';

class StubAllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      reason: 'Allowed in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

class StubDenyPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.DENY,
      allowed: false,
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      reason: 'Denied in test policy',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

function createValidLease(scopes: string[]): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-001',
    tenant_id: crypto.randomUUID(),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    scopes,
    signature: 'valid-test-sig',
    nonce: crypto.randomUUID(),
  };
}

describe('Filesystem Runtime — Operations, Security, & Evidence', () => {
  let tmpRootDir: string;
  let runtime: FilesystemRuntime;
  let allowLeaseBoundary: ExecutionLeaseBoundary;
  let denyLeaseBoundary: ExecutionLeaseBoundary;

  before(() => {
    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-fs-runtime-test-'));
    allowLeaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator());
    denyLeaseBoundary = new ExecutionLeaseBoundary(new StubDenyPolicyEvaluator());
    runtime = new FilesystemRuntime(allowLeaseBoundary);
  });

  after(() => {
    if (fs.existsSync(tmpRootDir)) {
      fs.rmSync(tmpRootDir, { recursive: true, force: true });
    }
  });

  it('registers in RuntimeRegistry with FilesystemExecutionPolicy', () => {
    const registry = new RuntimeRegistry(new FilesystemExecutionPolicy());
    const descriptor = runtime.getDescriptor();

    assert.strictEqual(descriptor.category, RuntimeCategory.FILESYSTEM);
    assert.strictEqual(descriptor.isExecutable, true);

    // Registration succeeds under FilesystemExecutionPolicy
    registry.registerRuntime(descriptor);
    assert.strictEqual(registry.hasRuntime(descriptor.runtimeId), true);

    // Non-filesystem executable registration is still denied fail-closed
    assert.throws(
      () =>
        registry.registerRuntime({
          runtimeId: 'rt:terminal-v1',
          category: RuntimeCategory.TERMINAL,
          version: '0.1.0',
          isExecutable: true,
          supportedActions: ['execute'],
        }),
      /\[RuntimeRegistrySecurityError\]/,
    );
  });

  it('executes a protected file write (atomic) and read operation with evidence', async () => {
    const testFilePath = path.join(tmpRootDir, 'write-test.txt');
    const secretContent = 'USER_PRIVATE_DOCUMENT_CONTENT';
    const lease = createValidLease([FilesystemOperationName.WRITE, FilesystemOperationName.READ]);

    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    // 1. Write file
    const writeOutcome = await runtime.writeFile(
      { path: testFilePath, content: secretContent, overwrite: true },
      context,
    );

    assert.strictEqual(writeOutcome.result.success, true);
    assert.strictEqual(fs.existsSync(testFilePath), true);
    assert.strictEqual(fs.readFileSync(testFilePath, 'utf-8'), secretContent);
    assert.strictEqual(writeOutcome.event.schema_id, 'nexusos.events.filesystem.write.v1');

    // REDACTION INVARIANT CHECK: Evidence payload MUST NOT contain raw content
    const writePayloadStr = JSON.stringify(writeOutcome.event.payload);
    assert.strictEqual(
      writePayloadStr.includes(secretContent),
      false,
      'Raw content MUST NOT be logged in evidence event payload',
    );

    // 2. Read file
    const readOutcome = await runtime.readFile({ path: testFilePath }, context);
    assert.strictEqual(readOutcome.result.success, true);
    assert.strictEqual(readOutcome.result.data, secretContent);
    assert.strictEqual(readOutcome.event.schema_id, 'nexusos.events.filesystem.read.v1');
  });

  it('lists directory contents with scope and entry limits', async () => {
    const subDir = path.join(tmpRootDir, 'list-dir');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'file1.txt'), 'f1');
    fs.writeFileSync(path.join(subDir, 'file2.txt'), 'f2');

    const lease = createValidLease([FilesystemOperationName.LIST]);
    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
      limits: { maxDirectoryEntries: 1 },
    };

    const outcome = await runtime.listDirectory({ path: subDir }, context);

    assert.strictEqual(outcome.result.success, true);
    assert.strictEqual(outcome.result.data?.entries.length, 1);
    assert.strictEqual(outcome.result.data?.truncated, true);
  });

  it('statFile returns metadata and content hash', async () => {
    const filePath = path.join(tmpRootDir, 'stat-test.txt');
    fs.writeFileSync(filePath, 'stat content');

    const lease = createValidLease([FilesystemOperationName.STAT]);
    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    const outcome = await runtime.statFile({ path: filePath }, context);

    assert.strictEqual(outcome.result.success, true);
    assert.strictEqual(outcome.result.data?.isFile, true);
    assert.ok(outcome.result.data?.sha256Hash);
  });

  it('copyFile & moveFile enforce path security on both source and destination', async () => {
    const srcPath = path.join(tmpRootDir, 'source.txt');
    const copyDest = path.join(tmpRootDir, 'copied.txt');
    const moveDest = path.join(tmpRootDir, 'moved.txt');

    fs.writeFileSync(srcPath, 'original data');

    const lease = createValidLease([FilesystemOperationName.COPY, FilesystemOperationName.MOVE]);
    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    // Copy
    const copyOutcome = await runtime.copyFile(
      { sourcePath: srcPath, destinationPath: copyDest },
      context,
    );
    assert.strictEqual(copyOutcome.result.success, true);
    assert.strictEqual(fs.existsSync(copyDest), true);

    // Move
    const moveOutcome = await runtime.moveFile(
      { sourcePath: srcPath, destinationPath: moveDest },
      context,
    );
    assert.strictEqual(moveOutcome.result.success, true);
    assert.strictEqual(fs.existsSync(srcPath), false);
    assert.strictEqual(fs.existsSync(moveDest), true);
  });

  it('deleteFile removes file and creates a pre-mutation snapshot', async () => {
    const delPath = path.join(tmpRootDir, 'delete-me.txt');
    fs.writeFileSync(delPath, 'to be deleted');

    const lease = createValidLease([FilesystemOperationName.DELETE]);
    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    const outcome = await runtime.deleteFile({ path: delPath }, context);

    assert.strictEqual(outcome.result.success, true);
    assert.strictEqual(fs.existsSync(delPath), false);
    assert.ok(outcome.result.snapshotId, 'Must create snapshot before deleting existing file');
  });

  it('enforces preconditions and rejects stale/mismatching state', async () => {
    const filePath = path.join(tmpRootDir, 'precondition-test.txt');
    fs.writeFileSync(filePath, 'initial text');
    const initialHash = crypto.createHash('sha256').update('initial text').digest('hex');

    const lease = createValidLease([FilesystemOperationName.WRITE]);
    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    // Matching precondition succeeds
    const matchOutcome = await runtime.writeFile(
      {
        path: filePath,
        content: 'updated text',
        overwrite: true,
        preconditions: { expectedHash: initialHash },
      },
      context,
    );
    assert.strictEqual(matchOutcome.result.success, true);

    // Mismatching hash precondition fails
    const mismatchOutcome = await runtime.writeFile(
      {
        path: filePath,
        content: 'should fail',
        overwrite: true,
        preconditions: { expectedHash: 'wrong-hash-value' },
      },
      context,
    );

    assert.strictEqual(mismatchOutcome.result.success, false);
    assert.strictEqual(mismatchOutcome.result.error?.code, 'PRECONDITION_FAILED');
  });

  it('fails closed when lease scope does not include required capability', async () => {
    const filePath = path.join(tmpRootDir, 'scope-test.txt');
    fs.writeFileSync(filePath, 'data');

    // Lease ONLY grants fs:read, but request is fs:write
    const lease = createValidLease([FilesystemOperationName.READ]);
    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    const outcome = await runtime.writeFile({ path: filePath, content: 'new data' }, context);

    assert.strictEqual(outcome.result.success, false);
    assert.strictEqual(outcome.result.error?.code, 'MISSING_CAPABILITY_SCOPE');
    assert.strictEqual(outcome.event.schema_id, 'nexusos.events.filesystem.denied.v1');
  });

  it('fails closed when policy evaluator denies execution', async () => {
    const denyRuntime = new FilesystemRuntime(denyLeaseBoundary);
    const filePath = path.join(tmpRootDir, 'policy-deny-test.txt');
    const lease = createValidLease([FilesystemOperationName.READ]);

    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
    };

    const outcome = await denyRuntime.readFile({ path: filePath }, context);

    assert.strictEqual(outcome.result.success, false);
    assert.strictEqual(outcome.result.error?.code, 'LEASE_OR_POLICY_INVALID');
    assert.strictEqual(outcome.event.schema_id, 'nexusos.events.filesystem.denied.v1');
  });

  it('enforces maxFileSizeByte limit and fails closed', async () => {
    const filePath = path.join(tmpRootDir, 'large-file.txt');
    const lease = createValidLease([FilesystemOperationName.WRITE]);

    const context: FilesystemOperationRequestContext = {
      lease,
      allowedRoots: [tmpRootDir],
      limits: { maxFileSizeByte: 100 }, // Tiny 100 byte limit for test
    };

    const largeContent = 'X'.repeat(500); // 500 bytes exceeds 100 byte limit

    const outcome = await runtime.writeFile({ path: filePath, content: largeContent }, context);

    assert.strictEqual(outcome.result.success, false);
    assert.strictEqual(outcome.result.error?.code, 'FILE_TOO_LARGE');
  });
});
