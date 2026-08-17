import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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
import { InMemoryClipboardAdapter } from '../src/runtimes/device/clipboard-adapter.js';
import { DefaultDeviceCapabilitiesAdapter } from '../src/runtimes/device/device-capabilities-adapter.js';
import { DefaultDeviceNotificationAdapter } from '../src/runtimes/device/device-notification-adapter.js';

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

describe('Task 03O Device Runtime — Functional & Integration Verification', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let clipboardAdapter: InMemoryClipboardAdapter;
  let deviceRuntime: DeviceRuntime;

  function createValidLease(scopes: string[], taskId = crypto.randomUUID()): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: taskId,
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
    clipboardAdapter = new InMemoryClipboardAdapter();
    deviceRuntime = new DeviceRuntime(
      leaseBoundary,
      {},
      clipboardAdapter,
      new DefaultDeviceCapabilitiesAdapter('0.1.0-sprint0', true),
      new DefaultDeviceNotificationAdapter(),
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );
  });

  it('exposes correct ToolRuntimeDescriptor', () => {
    const descriptor = deviceRuntime.getDescriptor();
    assert.equal(descriptor.runtimeId, 'rt:device-v1');
    assert.equal(descriptor.category, 'DEVICE');
    assert.equal(descriptor.isExecutable, true);
    assert.ok(descriptor.supportedActions.includes(DeviceOperationName.CLIPBOARD_READ));
    assert.ok(descriptor.supportedActions.includes(DeviceOperationName.DEVICE_QUERY_INFO));
  });

  it('executes clipboard write and read operations successfully with valid lease', async () => {
    const writeCtx = createRequestContext(['capability:clipboard:write']);
    const writeRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Hello NexusOS Device Runtime',
      context: writeCtx,
    });

    assert.equal(writeRes.success, true);

    const readCtx = createRequestContext(['capability:clipboard:read']);
    const readRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: readCtx,
    });

    assert.equal(readRes.success, true);
    const readData = readRes.data as { text: string };
    assert.equal(readData.text, 'Hello NexusOS Device Runtime');
  });

  it('clears clipboard contents successfully', async () => {
    const writeCtx = createRequestContext(['capability:clipboard:write']);
    await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_WRITE,
      text: 'Temporary Text',
      context: writeCtx,
    });

    const clearCtx = createRequestContext(['capability:clipboard:clear']);
    const clearRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_CLEAR,
      context: clearCtx,
    });

    assert.equal(clearRes.success, true);

    const readCtx = createRequestContext(['capability:clipboard:read']);
    const readRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.CLIPBOARD_READ,
      context: readCtx,
    });

    const readData = readRes.data as { text: string };
    assert.equal(readData.text, '');
  });

  it('queries device info and posture metadata', async () => {
    const queryCtx = createRequestContext(['capability:device:query']);

    const infoRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.DEVICE_QUERY_INFO,
      context: queryCtx,
    });
    assert.equal(infoRes.success, true);
    const infoData = infoRes.data as { agentVersion: string; platform: string };
    assert.equal(infoData.agentVersion, '0.1.0-sprint0');

    const postureRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.DEVICE_GET_POSTURE,
      context: queryCtx,
    });
    assert.equal(postureRes.success, true);
    const postureData = postureRes.data as { hasOSConsent: boolean; powerSource: string };
    assert.equal(postureData.hasOSConsent, true);
  });

  it('delivers actionable desktop notifications', async () => {
    const notifCtx = createRequestContext(['capability:device:notification']);

    const notifRes = await deviceRuntime.execute({
      operationName: DeviceOperationName.DEVICE_SHOW_NOTIFICATION,
      title: 'Task Milestone Reached',
      body: 'Task 03O execution completed successfully.',
      context: notifCtx,
    });

    assert.equal(notifRes.success, true);
    const notifData = notifRes.data as { notificationShown: boolean };
    assert.equal(notifData.notificationShown, true);
  });
});
