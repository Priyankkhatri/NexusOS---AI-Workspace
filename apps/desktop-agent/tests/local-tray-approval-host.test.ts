import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TrayUIController } from '../src/ui/tray-controller.js';
import { NativeApprovalHost } from '../src/ui/approval-host.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';
import type { ExecutionLeaseHeader } from '@nexusos/contracts';

function createDummyLeaseHeader(): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-test-v01',
    tenant_id: crypto.randomUUID(),
    scopes: ['approval:present', 'approval:submit'],
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    signature: 'sig-dummy-v01',
  };
}

class MockLeaseBoundary extends ExecutionLeaseBoundary {
  constructor(private readonly isValid = true) {
    super();
  }
  override async validateLease(_leaseHeader: unknown) {
    return { valid: this.isValid, reason: this.isValid ? undefined : 'Mock lease invalid' };
  }
}

test('TrayUIController - state machine and menu descriptors', () => {
  const tray = new TrayUIController();
  assert.equal(tray.getStatus().state, 'CONNECTED');
  assert.equal(tray.getStatus().isPaused, false);

  tray.setActiveTaskCount(2);
  assert.equal(tray.getStatus().state, 'WORKING');
  assert.equal(tray.getStatus().activeTaskCount, 2);

  tray.setPendingApprovalCount(1);
  assert.equal(tray.getStatus().state, 'AWAITING_APPROVAL');

  tray.pause('User paused');
  assert.equal(tray.getStatus().state, 'PAUSED');
  assert.equal(tray.getStatus().isPaused, true);

  const menus = tray.getMenuDescriptors();
  assert.ok(menus.some((m) => m.id === 'resume_agent'));

  tray.resume();
  assert.equal(tray.getStatus().state, 'AWAITING_APPROVAL');

  tray.setPendingApprovalCount(0);
  assert.equal(tray.getStatus().state, 'WORKING');

  tray.setActiveTaskCount(0);
  assert.equal(tray.getStatus().state, 'CONNECTED');

  tray.shutdown();
  assert.equal(tray.getStatus().state, 'OFFLINE');
});

test('NativeApprovalHost - prompt creation, retrieval, and listing', async () => {
  const boundary = new MockLeaseBoundary(true);
  const host = new NativeApprovalHost(boundary);

  const req = {
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-001',
    title: 'Delete Production Database',
    description: 'High risk operation requiring approval',
    riskTier: 'HIGH' as const,
    actionIdentifier: 'fs.delete',
  };

  const item = await host.presentPrompt(req);
  assert.ok(item.promptId);
  assert.equal(item.state, 'PENDING');
  assert.equal(item.title, 'Delete Production Database');

  const retrieved = host.getPrompt(item.promptId);
  assert.ok(retrieved);
  assert.equal(retrieved.requestId, 'req-001');

  const pendingList = host.listPendingPrompts();
  assert.equal(pendingList.length, 1);
  assert.equal(pendingList[0].promptId, item.promptId);
});

test('NativeApprovalHost - decision submission ALLOW and DENY', async () => {
  const boundary = new MockLeaseBoundary(true);
  const host = new NativeApprovalHost(boundary);

  const item = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-002',
    title: 'Terminal Execution',
    description: 'Run powershell script',
    riskTier: 'MEDIUM' as const,
    actionIdentifier: 'terminal.execute',
  });

  const res = await host.submitDecision({
    promptId: item.promptId,
    decision: 'ALLOW',
    nonce: item.nonce,
    leaseHeader: createDummyLeaseHeader(),
  });

  assert.equal(res.decision, 'ALLOW');
  assert.equal(res.state, 'APPROVED');
  assert.ok(res.receiptHash);

  const updated = host.getPrompt(item.promptId);
  assert.equal(updated?.state, 'APPROVED');
});

test('NativeApprovalHost - secret redaction and lock-screen privacy filtering', async () => {
  const boundary = new MockLeaseBoundary(true);
  const redactionFilter = new RedactionFilter(new SecretRedactionRegistry());
  const host = new NativeApprovalHost(boundary, redactionFilter);

  const item = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-003',
    title: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret',
    description: 'api_key: sk-1234567890abcdef1234567890abcdef',
    riskTier: 'HIGH' as const,
    actionIdentifier: 'auth.connect',
    isLockScreenPrivate: true,
    metadata: { secret: 'sk-1234567890abcdef1234567890abcdef' },
  });

  assert.ok(!item.title.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  assert.ok(!item.description.includes('sk-1234567890abcdef1234567890abcdef'));

  const sanitized = host.getSanitizedPromptForUI(item.promptId, true);
  assert.ok(sanitized);
  assert.equal(sanitized.description, '[REDACTED FOR PRIVACY - SENSITIVE CONTENT]');
  assert.equal(sanitized.metadata, undefined);
});

test('NativeApprovalHost - cancellation and shutdown', async () => {
  const host = new NativeApprovalHost();
  const item = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-004',
    title: 'Pending Operation',
    description: 'To be cancelled',
    riskTier: 'LOW' as const,
    actionIdentifier: 'test.action',
  });

  const cancelled = host.cancelPrompt(item.promptId, 'User cancelled');
  assert.equal(cancelled, true);

  const updated = host.getPrompt(item.promptId);
  assert.equal(updated?.state, 'CANCELLED');

  host.shutdown();
});
