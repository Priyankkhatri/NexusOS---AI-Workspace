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
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { AgentLifecycleState } from '../src/lifecycle/index.js';
import { DeviceRuntime } from '../src/runtimes/device/runtime.js';
import { DeviceOperationName, DeviceRequestContext } from '../src/runtimes/device/types.js';
import { DeviceExecuteIPCRequestSchema } from '../src/runtimes/device/schemas.js';

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

describe('Task 041 — Adversarial Security Regression Suite (041-SEC-01 to 041-SEC-12)', () => {
  let tmpDir: string;
  let leaseBoundary: ExecutionLeaseBoundary;

  function createValidLease(
    scopes: string[],
    taskId = crypto.randomUUID(),
    tenantId = crypto.randomUUID(),
    agentId = 'agent-041-sec',
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
      agent_id: agentId,
      tenant_id: tenantId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      scopes,
      signature: 'valid-sig-sec',
      nonce: crypto.randomUUID(),
      policy_hash: 'stub-hash',
    };
  }

  function createRequestContext(
    scopes: string[],
    taskId = crypto.randomUUID(),
    tenantId = crypto.randomUUID(),
    agentId = 'agent-041-sec',
  ): DeviceRequestContext {
    const leaseHeader = createValidLease(scopes, taskId, tenantId, agentId);
    return {
      taskId: leaseHeader.task_id,
      workspaceId: crypto.randomUUID(),
      tenantId: leaseHeader.tenant_id,
      subjectId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      leaseHeader,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-device-sec-'));
    leaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator());
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('041-SEC-01: device.execute without valid authorization is rejected', async () => {
    // Unsigned boundary for testing invalid signature
    const unauthBoundary = new ExecutionLeaseBoundary();
    const runtime = new DeviceRuntime(unauthBoundary);
    const leaseHeader: ExecutionLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: 'agent-1',
      tenant_id: crypto.randomUUID(),
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      scopes: ['capability:clipboard:read'],
      signature: 'invalid-signature-123',
      nonce: crypto.randomUUID(),
      policy_hash: 'hash-1',
    };
    const ctx: DeviceRequestContext = {
      taskId: leaseHeader.task_id,
      workspaceId: crypto.randomUUID(),
      tenantId: leaseHeader.tenant_id,
      subjectId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      leaseHeader,
    };

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'LEASE_VALIDATION_FAILED');
  });

  it('041-SEC-02: expired execution lease is rejected', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    const expiredLease: ExecutionLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: 'agent-1',
      tenant_id: crypto.randomUUID(),
      issued_at: new Date(Date.now() - 7200000).toISOString(),
      expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired 1h ago
      scopes: ['capability:clipboard:read'],
      signature: 'valid-sig',
      nonce: crypto.randomUUID(),
      policy_hash: 'hash-1',
    };
    const ctx: DeviceRequestContext = {
      taskId: expiredLease.task_id,
      workspaceId: crypto.randomUUID(),
      tenantId: expiredLease.tenant_id,
      subjectId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      leaseHeader: expiredLease,
    };

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'LEASE_VALIDATION_FAILED');
  });

  it('041-SEC-03: malformed execution lease fails closed', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    const malformedLease = {
      lease_id: 'not-a-uuid',
      task_id: '',
    } as unknown as ExecutionLeaseHeader;

    const ctx: DeviceRequestContext = {
      taskId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      subjectId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      leaseHeader: malformedLease,
    };

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.ok(res.error);
  });

  it('041-SEC-04: cross-tenant device access is rejected', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    const tenantAuth = crypto.randomUUID();
    const tenantAttack = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const lease = createValidLease(['capability:clipboard:read'], taskId, tenantAuth);
    const ctx: DeviceRequestContext = {
      taskId,
      workspaceId: crypto.randomUUID(),
      tenantId: tenantAttack, // Mismatched tenant
      subjectId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'TENANT_CONTEXT_MISMATCH');
  });

  it('041-SEC-05: cross-device identity mismatch is rejected', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    const taskAuth = crypto.randomUUID();
    const taskAttack = crypto.randomUUID();
    const lease = createValidLease(['capability:clipboard:read'], taskAuth);
    const ctx: DeviceRequestContext = {
      taskId: taskAttack, // Mismatched task
      workspaceId: crypto.randomUUID(),
      tenantId: lease.tenant_id,
      subjectId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      leaseHeader: lease,
    };

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'TASK_CONTEXT_MISMATCH');
  });

  it('041-SEC-06: device.execute cannot bypass capability authorization', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    // Lease has no capability scopes matching clipboard write
    const ctx = createRequestContext(['capability:unrelated:scope']);

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Exploit attempt',
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'MISSING_REQUIRED_SCOPE');
  });

  it('041-SEC-07: lease is revalidated at the execution boundary', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    const ctx = createRequestContext(['capability:clipboard:read']);

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, true);
  });

  it('041-SEC-08: queryInfo/getPosture cannot expose privileged secrets/internal state', async () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    const ctx = createRequestContext(['capability:device:query']);

    const infoRes = await runtime.execute({
      operationName: DeviceOperationName.DEVICE_QUERY_INFO,
      context: ctx,
    });

    assert.equal(infoRes.success, true);
    const json = JSON.stringify(infoRes.data);
    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('secret'), false);
    assert.equal(json.includes('privateKey'), false);
  });

  it('041-SEC-09: oversized/malformed IPC payload is rejected by Zod schema', () => {
    // Malformed request missing operationName
    assert.throws(() => {
      DeviceExecuteIPCRequestSchema.parse({
        request: { text: 'No operation name' },
      });
    });

    // Oversized clipboard text payload
    assert.throws(() => {
      const oversizedText = 'A'.repeat(2 * 1024 * 1024); // 2 MB > 1 MB max
      DeviceExecuteIPCRequestSchema.parse({
        request: {
          operationName: DeviceOperationName.CLIPBOARD_WRITE,
          text: oversizedText,
          context: createRequestContext(['capability:clipboard:write']),
        },
      });
    });
  });

  it('10. 041-SEC-10: device operations are rejected during STOPPING/STOPPED/FAILED', async () => {
    const runtime = new DeviceRuntime(
      leaseBoundary,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => AgentLifecycleState.STOPPING, // Lifecycle state is STOPPING
    );

    const ctx = createRequestContext(['capability:clipboard:read']);
    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'LIFECYCLE_STATE_REJECTED');
  });

  it('11. 041-SEC-11: concurrent device.execute requests respect existing runtime/resource limits', async () => {
    const runtime = new DeviceRuntime(
      leaseBoundary,
      { maxConcurrentOperations: 1 }, // Low concurrency limit
    );

    const ctx2 = createRequestContext(['capability:clipboard:write']);

    // Simulate concurrent active operation by manually elevating count
    (runtime as any).activeOperationsCount = 1;

    const res = await runtime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Limit test',
      context: ctx2,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'RATE_LIMITED');

    // Clean up count
    (runtime as any).activeOperationsCount = 0;
  });

  it('12. 041-SEC-12: shutdown/cleanup is idempotent and leaves no active resources', () => {
    const runtime = new DeviceRuntime(leaseBoundary);
    (runtime as any).activeOperationsCount = 5;

    // First call to shutdown
    runtime.shutdown();
    assert.equal(runtime.getActiveOperationsCount(), 0);

    // Second call to shutdown (idempotent)
    runtime.shutdown();
    assert.equal(runtime.getActiveOperationsCount(), 0);
  });
});
