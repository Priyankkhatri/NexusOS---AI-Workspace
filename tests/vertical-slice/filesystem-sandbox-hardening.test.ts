import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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
  AgentOrchestrator,
  TaskExecutionRequest,
  FilesystemRuntime,
  FilesystemExecutionPolicy,
  PathSecurityService,
  WorkspaceDirectoryJail,
  ExecutionLeaseBoundary,
  RuntimeRouter,
  CapabilityRegistry,
  RuntimeRegistry,
  AgentLifecycleState,
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

describe('Task 050 — Filesystem Sandbox Runtime Hardening & Orchestrator Integration', () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let orchestrator: AgentOrchestrator;
  let filesystemRuntime: FilesystemRuntime;
  let workspaceJail: WorkspaceDirectoryJail;

  const tenantId = '11111111-2222-4333-8444-555555555555';
  const deviceId = 'device-desk-050';

  function createValidLease(
    scopes: string[] = [
      'fs:read',
      'fs:write',
      'fs:list',
      'fs:stat',
      'fs:copy',
      'fs:move',
      'fs:delete',
      'fs.readFile',
      'fs.writeFile',
      'fs.copyFile',
    ],
    tId = tenantId,
    taskId = crypto.randomUUID(),
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: deviceId,
      tenant_id: tId,

      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      scopes,
      nonce: crypto.randomUUID(),
      signature: 'valid-test-signature',
    };
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-fs-orch-'));
    workspaceRoot = path.join(tmpRoot, 'authorized-ws');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const pathSecurity = new PathSecurityService();
    workspaceJail = new WorkspaceDirectoryJail();
    const leaseBoundary = new ExecutionLeaseBoundary(new AllowAllPolicyEvaluator() as any);

    filesystemRuntime = new FilesystemRuntime(
      leaseBoundary,
      pathSecurity,
      undefined,
      undefined,
      workspaceJail,
    );

    // Register active workspace
    workspaceJail.registerWorkspace({
      workspaceId: 'ws-main',
      tenantId,
      rootPath: workspaceRoot,
      isReadOnly: false,
    });

    const capabilityRegistry = new CapabilityRegistry();
    const runtimeRegistry = new RuntimeRegistry(new FilesystemExecutionPolicy());
    runtimeRegistry.registerRuntime(filesystemRuntime.getDescriptor());
    const runtimeRouter = new RuntimeRouter(capabilityRegistry, runtimeRegistry);

    const identityProvider = {
      getIdentity: async () => ({
        agentId: 'agent-desk-050',
        deviceId,
        pairedTenantId: tenantId,
        deviceFingerprint: 'fp-050',
        agentVersion: '0.1.0-sprint0',
        enrolledAt: new Date().toISOString(),
      }),
      verifyHardwareAttestation: async () =>
        ({ valid: true, status: 'PASSED', reason: 'OK' }) as any,
    };

    const controlPlaneClient = {
      start: async () => {},
      registerAgent: async () => ({ accepted: true, controlPlaneVersion: '1.0.0' }),
      sendHeartbeat: async () => true,
      relayEvent: async () => ({ success: true }) as any,
      getConnectionState: () => 'CONNECTED' as any,
      disconnect: async () => {},
    };

    orchestrator = new AgentOrchestrator(
      { agentVersion: '0.1.0-sprint0' } as any,
      identityProvider as any,
      controlPlaneClient as any,
      leaseBoundary,
      runtimeRouter,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
      filesystemRuntime,
    );
  });

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  it('executes a 3-step governed filesystem workflow DAG: writeFile -> readFile -> copyFile', async () => {
    const targetFile = path.join(workspaceRoot, 'annual_report.txt');
    const backupFile = path.join(workspaceRoot, 'backup', 'annual_report_bak.txt');
    const content = 'Quarterly Revenue: $1,250,000 USD. All audits clear.';

    // Step 1: Write file
    const writeTaskId = crypto.randomUUID();
    const writeLease = createValidLease(undefined, tenantId, writeTaskId);
    const writeReq: TaskExecutionRequest = {
      task_id: writeTaskId,
      step_id: 'step-write-1',
      correlation_id: 'corr-001',
      leaseHeader: writeLease,
      capabilityId: 'fs.writeFile',
      runtimeCategory: 'filesystem',
      payload: {
        workspaceId: 'ws-main',
        path: targetFile,
        content,
        overwrite: true,
      },
    };

    const writeResult = await orchestrator.executeTask(writeReq);
    assert.strictEqual(writeResult.success, true);

    assert.strictEqual(orchestrator.getTaskStatus(writeTaskId), 'COMPLETED');
    assert.strictEqual(fs.existsSync(targetFile), true);

    const writeOutput = writeResult.output as {
      success: boolean;
      preHash?: string;
      postHash?: string;
      evidenceChecksum?: string;
    };
    assert.strictEqual(writeOutput.success, true);
    assert.strictEqual(writeOutput.preHash, undefined);
    assert.ok(writeOutput.postHash, 'Post-mutation hash required');
    assert.ok(writeOutput.evidenceChecksum, 'Evidence checksum required');

    // Step 2: Read file
    const readTaskId = crypto.randomUUID();
    const readLease = createValidLease(undefined, tenantId, readTaskId);
    const readReq: TaskExecutionRequest = {
      task_id: readTaskId,
      step_id: 'step-read-2',
      correlation_id: 'corr-002',
      leaseHeader: readLease,
      capabilityId: 'fs.readFile',
      runtimeCategory: 'filesystem',
      payload: {
        workspaceId: 'ws-main',
        path: targetFile,
      },
    };

    const readResult = await orchestrator.executeTask(readReq);
    assert.strictEqual(readResult.success, true);
    assert.strictEqual(orchestrator.getTaskStatus(readTaskId), 'COMPLETED');

    const readOutput = readResult.output as {
      success: boolean;
      data: string;
      evidenceChecksum?: string;
    };
    assert.strictEqual(readOutput.success, true);
    assert.strictEqual(readOutput.data, content);
    assert.ok(readOutput.evidenceChecksum, 'Read evidence checksum required');

    // Step 3: Copy file to backup
    const copyTaskId = crypto.randomUUID();
    const copyLease = createValidLease(undefined, tenantId, copyTaskId);
    const copyReq: TaskExecutionRequest = {
      task_id: copyTaskId,
      step_id: 'step-copy-3',
      correlation_id: 'corr-003',
      leaseHeader: copyLease,
      capabilityId: 'fs.copyFile',
      runtimeCategory: 'filesystem',
      payload: {
        workspaceId: 'ws-main',
        sourcePath: targetFile,
        destinationPath: backupFile,
        overwrite: true,
      },
    };

    const copyResult = await orchestrator.executeTask(copyReq);
    assert.strictEqual(copyResult.success, true);
    assert.strictEqual(orchestrator.getTaskStatus(copyTaskId), 'COMPLETED');
    assert.strictEqual(fs.existsSync(backupFile), true);
    assert.strictEqual(fs.readFileSync(backupFile, 'utf-8'), content);
  });

  it('routes task requests using the "fs" category alias', async () => {
    const targetFile = path.join(workspaceRoot, 'alias_test.txt');
    const content = 'Category alias test';

    const taskId = crypto.randomUUID();
    const lease = createValidLease(undefined, tenantId, taskId);
    const req: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-alias-1',
      correlation_id: 'corr-alias',
      leaseHeader: lease,
      capabilityId: 'fs.writeFile',
      runtimeCategory: 'fs',
      payload: {
        workspaceId: 'ws-main',
        path: targetFile,
        content,
      },
    };

    const result = await orchestrator.executeTask(req);
    assert.strictEqual(result.success, true);
    assert.strictEqual(orchestrator.getTaskStatus(taskId), 'COMPLETED');
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), content);
  });

  it('adversarial task: rejects traversal escape with PATH_OUTSIDE_SCOPE and marks task FAILED', async () => {
    const escapeTarget = path.join(workspaceRoot, '..', 'host_escape.txt');

    const taskId = crypto.randomUUID();
    const lease = createValidLease(undefined, tenantId, taskId);
    const req: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-evil-1',
      correlation_id: 'corr-evil-1',
      leaseHeader: lease,
      capabilityId: 'fs.writeFile',
      runtimeCategory: 'filesystem',
      payload: {
        workspaceId: 'ws-main',
        path: escapeTarget,
        content: 'should fail',
      },
    };

    const result = await orchestrator.executeTask(req);
    assert.strictEqual(result.success, false);
    assert.strictEqual(orchestrator.getTaskStatus(taskId), 'FAILED');
    assert.strictEqual(result.errorCode, 'PATH_OUTSIDE_SCOPE');
    assert.strictEqual(fs.existsSync(escapeTarget), false);
  });

  it('adversarial task: rejects mutating read-only workspace with WRITE_NOT_AUTHORIZED', async () => {
    const roWorkspace = path.join(tmpRoot, 'ro-workspace');
    fs.mkdirSync(roWorkspace, { recursive: true });

    workspaceJail.registerWorkspace({
      workspaceId: 'ws-ro',
      tenantId,
      rootPath: roWorkspace,
      isReadOnly: true,
    });

    const taskId = crypto.randomUUID();
    const lease = createValidLease(undefined, tenantId, taskId);
    const req: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-evil-ro',
      correlation_id: 'corr-evil-2',
      leaseHeader: lease,
      capabilityId: 'fs.writeFile',
      runtimeCategory: 'filesystem',
      payload: {
        workspaceId: 'ws-ro',
        path: path.join(roWorkspace, 'illegal.txt'),
        content: 'should fail',
      },
    };

    const result = await orchestrator.executeTask(req);
    assert.strictEqual(result.success, false);
    assert.strictEqual(orchestrator.getTaskStatus(taskId), 'FAILED');
    assert.strictEqual(result.errorCode, 'WRITE_NOT_AUTHORIZED');
  });

  it('adversarial task: rejects NTFS Alternate Data Stream with ADS_PROHIBITED', async () => {
    const legitFile = path.join(workspaceRoot, 'legit.txt');
    fs.writeFileSync(legitFile, 'valid');

    const taskId = crypto.randomUUID();
    const lease = createValidLease(undefined, tenantId, taskId);
    const req: TaskExecutionRequest = {
      task_id: taskId,
      step_id: 'step-evil-ads',
      correlation_id: 'corr-evil-3',
      leaseHeader: lease,
      capabilityId: 'fs.writeFile',
      runtimeCategory: 'filesystem',
      payload: {
        workspaceId: 'ws-main',
        path: `${legitFile}:hidden_stream`,
        content: 'ads payload',
      },
    };

    const result = await orchestrator.executeTask(req);
    assert.strictEqual(result.success, false);
    assert.strictEqual(orchestrator.getTaskStatus(taskId), 'FAILED');
    assert.strictEqual(result.errorCode, 'ADS_PROHIBITED');
  });
});
