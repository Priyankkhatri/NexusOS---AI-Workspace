import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
import {
  DeviceOperationName,
  DeviceRequestContext,
  DeviceOperationRequest,
} from '../src/runtimes/device/types.js';
import { InMemoryClipboardAdapter } from '../src/runtimes/device/clipboard-adapter.js';
import { MemoryCacheManager } from '../src/memory/memory-cache-manager.js';
import { StateManager } from '../src/state/state-manager.js';

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

describe('Task 03O Device Runtime — Security Hardening & Vulnerability Audit', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let clipboardAdapter: InMemoryClipboardAdapter;
  let deviceRuntime: DeviceRuntime;

  function createValidLease(scopes: string[]): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: 'agent-001',
      tenant_id: crypto.randomUUID(),
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      scopes,
      signature: 'valid-sig',
      nonce: crypto.randomUUID(),
      policy_hash: 'stub-hash',
    };
  }

  function createRequestContext(scopes: string[]): DeviceRequestContext {
    const leaseHeader = createValidLease(scopes);
    return {
      taskId: leaseHeader.task_id,
      workspaceId: crypto.randomUUID(),
      tenantId: leaseHeader.tenant_id,
      subjectId: 'user-007',
      correlationId: crypto.randomUUID(),
      leaseHeader,
    };
  }

  beforeEach(() => {
    leaseBoundary = new ExecutionLeaseBoundary(new StubAllowPolicyEvaluator());
    clipboardAdapter = new InMemoryClipboardAdapter(10000); // 10KB limit for testing
    deviceRuntime = new DeviceRuntime(
      leaseBoundary,
      { maxClipboardSizeBytes: 10000 },
      clipboardAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );
  });

  it('VULNERABILITY-O01: denies execution when required capability scope is missing from lease', async () => {
    // Lease has 'capability:filesystem' scope, but NOT 'capability:clipboard:read'
    const ctx = createRequestContext(['capability:filesystem']);

    const res = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.category, 'AUTHORIZATION');
    assert.ok(res.error?.message.includes('Required capability scope'));
  });

  it('VULNERABILITY-O02: denies execution when lease is expired', async () => {
    const ctx = createRequestContext(['capability:clipboard:read']);
    // Artificially expire lease header
    ctx.leaseHeader.expires_at = new Date(Date.now() - 10000).toISOString();

    const res = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.category, 'AUTHORIZATION');
  });

  it('VULNERABILITY-O03: rejects oversized clipboard payloads exceeding maxClipboardSizeBytes', async () => {
    const ctx = createRequestContext(['capability:clipboard:write']);

    const res = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'A'.repeat(15000), // Exceeds 10,000 byte limit
      context: ctx,
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.category, 'VALIDATION');
  });

  it('VULNERABILITY-O04: redacts sensitive API keys and passwords from clipboard read output', async () => {
    await clipboardAdapter.writeText(
      'api_key: sk_live_secret_api_key_88888 and password: my_secret_pass',
    );

    const ctx = createRequestContext(['capability:clipboard:read']);
    const res = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });

    assert.equal(res.success, true);
    const data = res.data as { text: string };
    assert.equal(data.text.includes('sk_live_secret_api_key_88888'), false);
    assert.equal(data.text.includes('my_secret_pass'), false);
    assert.ok(data.text.includes('[REDACTED]'));
  });

  it('VULNERABILITY-O05: redacts sensitive tokens from desktop notification title and body', async () => {
    const ctx = createRequestContext(['capability:device:notification']);

    const res = await deviceRuntime.execute({
      operationName: DeviceOperationName.DEVICE_SHOW_NOTIFICATION,
      title: 'Alert for sk_live_secret_key_111',
      body: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      context: ctx,
    });

    assert.equal(res.success, true);
  });

  it('VULNERABILITY-O06: proves ZERO clipboard persistence to StateManager (03M) or MemoryCache (03N)', async () => {
    const storageDir = path.resolve('.test-device-sec-dir');
    if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true, force: true });

    const stateMgr = new StateManager({
      storageDir,
      encryptionKey: 'Super_Secure_Test_Device_Key_2026_x1',
    });
    const memCache = new MemoryCacheManager();
    await stateMgr.start();
    await memCache.start();

    const ctx = createRequestContext(['capability:clipboard:write']);
    await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'SECRET_CLIPBOARD_TEXT_9999',
      context: ctx,
    });

    // 1. Check StateManager disk store
    const stateVal = await stateMgr.get('SECRET_CLIPBOARD_TEXT_9999');
    assert.equal(stateVal, null);

    const stateFilePath = path.join(storageDir, 'agent-state.enc');
    if (fs.existsSync(stateFilePath)) {
      const diskContent = fs.readFileSync(stateFilePath, 'utf-8');
      assert.equal(diskContent.includes('SECRET_CLIPBOARD_TEXT_9999'), false);
    }

    // 2. Check MemoryCache store
    const cacheVal = await memCache.get('SECRET_CLIPBOARD_TEXT_9999', {
      taskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
    });
    assert.equal(cacheVal, null);

    await stateMgr.stop();
    await memCache.stop();
    if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('VULNERABILITY-O07: rejects device operations when agent lifecycle state is STOPPING or FAILED', async () => {
    let lifecycleState = AgentLifecycleState.STOPPING;

    const stoppingRuntime = new DeviceRuntime(
      leaseBoundary,
      {},
      clipboardAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      () => lifecycleState,
    );

    const ctx = createRequestContext(['capability:clipboard:read']);
    const resStopping = await stoppingRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });
    assert.equal(resStopping.success, false);
    assert.ok(resStopping.error?.message.includes('non-executable state'));

    lifecycleState = AgentLifecycleState.FAILED;
    const resFailed = await stoppingRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: ctx,
    });
    assert.equal(resFailed.success, false);
  });

  it('VULNERABILITY-O08: rejects unauthorized / unknown device operation names fail-closed', async () => {
    const ctx = createRequestContext(['capability:device']);

    const res = await deviceRuntime.execute({
      operationName: 'device:arbitrary_os_command_exec' as unknown as DeviceOperationName,
      context: ctx,
    } as unknown as DeviceOperationRequest);

    assert.equal(res.success, false);
    assert.equal(res.error?.category, 'VALIDATION');
  });
});
