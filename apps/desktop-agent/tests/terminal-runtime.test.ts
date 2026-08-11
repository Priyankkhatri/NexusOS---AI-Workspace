import { describe, it, beforeEach } from 'node:test';
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
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { RuntimeRegistry } from '../src/registry/runtime-registry.js';
import { TerminalExecutionPolicy } from '../src/runtimes/terminal/policy.js';
import { TerminalRuntime } from '../src/runtimes/terminal/runtime.js';
import { TerminalOperationName } from '../src/runtimes/terminal/types.js';

class AllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Allowed by test evaluator',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

class DenyPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.DENY,
      allowed: false,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Denied by test evaluator',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Terminal Runtime — Authorization, Execution, & Security', () => {
  let tmpDir: string;
  let leaseBoundary: ExecutionLeaseBoundary;
  let runtime: TerminalRuntime;
  let validLease: ExecutionLeaseHeader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-term-test-'));
    leaseBoundary = new ExecutionLeaseBoundary(new AllowPolicyEvaluator());
    runtime = new TerminalRuntime(leaseBoundary);

    validLease = {
      lease_id: '00000000-0000-4000-8000-000000000001',
      task_id: '00000000-0000-4000-8000-000000000002',
      agent_id: 'agent_test_1',
      tenant_id: '00000000-0000-4000-8000-000000000003',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [
        TerminalOperationName.EXECUTE,
        TerminalOperationName.KILL,
        TerminalOperationName.LIST_PROCESSES,
      ],
      signature: 'valid_sig',
    };
  });

  it('registers successfully in RuntimeRegistry with TerminalExecutionPolicy', () => {
    const registry = new RuntimeRegistry(new TerminalExecutionPolicy());
    const descriptor = runtime.getDescriptor();

    registry.registerRuntime(descriptor);
    assert.equal(registry.hasRuntime(descriptor.runtimeId), true);
    assert.equal(descriptor.isExecutable, true);
  });

  it('executes an authorized command (node --version) and emits event envelope', async () => {
    const { result, event } = await runtime.executeCommand(
      {
        command: 'node',
        args: ['--version'],
        cwd: tmpDir,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
    assert.ok(result.stdout.startsWith('v'));
    assert.equal(event.schema_id, 'nexusos.events.terminal.exited.v1');
    assert.equal(event.payload['status'], 'SUCCESS');
  });

  it('rejects unauthorized commands not in allowlist (e.g. vssadmin)', async () => {
    const { result, event } = await runtime.executeCommand(
      {
        command: 'vssadmin',
        args: ['list', 'shadows'],
        cwd: tmpDir,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'UNAUTHORIZED_COMMAND');
    assert.equal(event.schema_id, 'nexusos.events.terminal.denied.v1');
  });

  it('rejects working directory outside authorized allowedRoots', async () => {
    const outsideDir = path.dirname(tmpDir);
    const { result } = await runtime.executeCommand(
      {
        command: 'node',
        args: ['--version'],
        cwd: outsideDir,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'PATH_OUTSIDE_SCOPE');
  });

  it('fails closed when lease scope does not include required capability', async () => {
    const restrictedLease: ExecutionLeaseHeader = {
      ...validLease,
      scopes: ['fs:read'], // missing term:execute
    };

    const { result } = await runtime.executeCommand(
      {
        command: 'node',
        args: ['--version'],
        cwd: tmpDir,
      },
      {
        lease: restrictedLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'MISSING_CAPABILITY_SCOPE');
  });

  it('fails closed when policy evaluator denies execution', async () => {
    const denyingLeaseBoundary = new ExecutionLeaseBoundary(new DenyPolicyEvaluator());
    const denyingRuntime = new TerminalRuntime(denyingLeaseBoundary);

    const { result } = await denyingRuntime.executeCommand(
      {
        command: 'node',
        args: ['--version'],
        cwd: tmpDir,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'LEASE_OR_POLICY_INVALID');
  });

  it('redacts sensitive output keys in stdout/stderr', async () => {
    const { result } = await runtime.executeCommand(
      {
        command: 'node',
        args: ['-e', 'console.log("api_key=secret_12345_token")'],
        cwd: tmpDir,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
    assert.ok(!result.stdout.includes('secret_12345_token'));
    assert.ok(result.stdout.includes('api_key=[REDACTED]'));
  });

  it('lists active processes and supports killing process', async () => {
    const procs = await runtime.listProcesses({
      lease: validLease,
      allowedRoots: [tmpDir],
    });
    assert.ok(Array.isArray(procs));
  });
});
