import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { AgentDirectoryService } from '../src/agents/agent-directory.js';
import { DelegationCoordinator } from '../src/agents/delegation-coordinator.js';
import { LeaseIssuer } from '../src/leases/lease-issuer.js';

describe('DelegationCoordinator Unit & Security Tests (Task 060)', () => {
  let directory: AgentDirectoryService;
  let leaseIssuer: LeaseIssuer;
  let coordinator: DelegationCoordinator;

  const testSecret = 'test-secret-key-at-least-16-chars-long';
  const tenantId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const parentTaskId = crypto.randomUUID();
  const parentLeaseSecret = testSecret;

  beforeEach(() => {
    directory = new AgentDirectoryService();
    leaseIssuer = new LeaseIssuer({ leaseSecret: parentLeaseSecret });
    coordinator = new DelegationCoordinator({
      agentDirectory: directory,
      leaseIssuer,
      maxDepth: 3,
      maxFanOut: 5,
    });

    // Register target agent
    directory.registerAgent({
      agentId: 'specialist-01',
      tenantId,
      workspaceScope: [workspaceId],
      role: 'SPECIALIST',
      capabilities: ['filesystem.readFile', 'browser.navigate'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });
  });

  function createParentLease(
    scopes = ['filesystem.readFile', 'browser.navigate', 'agent.delegate'],
  ) {
    return leaseIssuer.issueLease({
      taskId: parentTaskId,
      agentId: 'coordinator-agent',
      tenantId,
      scopes,
      ttlSeconds: 300,
    });
  }

  it('delegates sub-task and generates an attenuated child lease', async () => {
    const parentLease = createParentLease();
    const req = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'specialist-01',
      tenantId,
      workspaceId,
      subGoal: 'Read data file',
      capabilityId: 'filesystem.readFile',
      requestedScopes: ['filesystem.readFile'],
      parameters: { file: 'data.txt' },
      delegationDepth: 1,
      timeoutMs: 30000,
      idempotencyKey: 'idem-1',
      correlationId: crypto.randomUUID(),
    };

    const res = await coordinator.delegateSubTask(req, parentLease);
    assert.strictEqual(res.status, 'ACCEPTED');
    assert.strictEqual(res.assignedAgentId, 'specialist-01');
    assert.strictEqual(res.delegationDepth, 1);
    assert.ok(res.childTaskId);
    assert.ok(res.childLeaseId);

    const session = coordinator.getSession(res.delegationId);
    assert.ok(session);
    assert.strictEqual(session?.childLease.scopes.length, 1);
    assert.strictEqual(session?.childLease.scopes[0], 'filesystem.readFile');
  });

  it('060-SEC-01: rejects child scope escalation (childScopes must be subset of parentScopes)', async () => {
    const parentLease = createParentLease(['filesystem.readFile']); // Only readFile
    const req = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'specialist-01',
      tenantId,
      workspaceId,
      subGoal: 'Write file without authority',
      capabilityId: 'filesystem.writeFile',
      requestedScopes: ['filesystem.writeFile'], // Escalation!
      delegationDepth: 1,
      timeoutMs: 30000,
      idempotencyKey: 'idem-escalate',
      correlationId: crypto.randomUUID(),
    };

    await assert.rejects(async () => {
      await coordinator.delegateSubTask(req, parentLease);
    }, /Privilege escalation forbidden/);
  });

  it('060-SEC-02: rejects recursive delegation exceeding max depth (d > 3)', async () => {
    const parentLease = createParentLease();
    const req = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'specialist-01',
      tenantId,
      workspaceId,
      subGoal: 'Deep recursion',
      capabilityId: 'filesystem.readFile',
      requestedScopes: ['filesystem.readFile'],
      delegationDepth: 4, // Exceeds max depth 3
      timeoutMs: 30000,
      idempotencyKey: 'idem-depth',
      correlationId: crypto.randomUUID(),
    };

    await assert.rejects(async () => {
      await coordinator.delegateSubTask(req, parentLease);
    }, /Number must be less than or equal to 3|Recursive delegation limit exceeded/);
  });

  it('060-SEC-02: enforces atomic fan-out limit (max 5 active child tasks)', async () => {
    const parentLease = createParentLease();

    // Register 5 child tasks
    for (let i = 0; i < 5; i++) {
      await coordinator.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId,
          parentLeaseId: parentLease.lease_id,
          delegatorAgentId: 'coordinator-agent',
          targetAgentId: 'specialist-01',
          tenantId,
          workspaceId,
          subGoal: `Fan-out child ${i}`,
          capabilityId: 'filesystem.readFile',
          requestedScopes: ['filesystem.readFile'],
          delegationDepth: 1,
          timeoutMs: 30000,
          idempotencyKey: `idem-fanout-${i}`,
          correlationId: crypto.randomUUID(),
        },
        parentLease,
      );
    }

    assert.strictEqual(coordinator.getActiveChildCount(parentTaskId), 5);

    // 6th delegation must be rejected
    await assert.rejects(async () => {
      await coordinator.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId,
          parentLeaseId: parentLease.lease_id,
          delegatorAgentId: 'coordinator-agent',
          targetAgentId: 'specialist-01',
          tenantId,
          workspaceId,
          subGoal: 'Fan-out child overflow',
          capabilityId: 'filesystem.readFile',
          requestedScopes: ['filesystem.readFile'],
          delegationDepth: 1,
          timeoutMs: 30000,
          idempotencyKey: 'idem-fanout-overflow',
          correlationId: crypto.randomUUID(),
        },
        parentLease,
      );
    }, /Child fan-out limit exceeded: Parent task .* already has 5 active child tasks/);
  });

  it('060-SEC-03: rejects cross-tenant delegation', async () => {
    const parentLease = createParentLease();
    const foreignTenantId = crypto.randomUUID();

    const req = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'specialist-01',
      tenantId: foreignTenantId, // Mismatched tenant
      workspaceId,
      subGoal: 'Cross-tenant task',
      capabilityId: 'filesystem.readFile',
      requestedScopes: ['filesystem.readFile'],
      delegationDepth: 1,
      timeoutMs: 30000,
      idempotencyKey: 'idem-cross-tenant',
      correlationId: crypto.randomUUID(),
    };

    await assert.rejects(async () => {
      await coordinator.delegateSubTask(req, parentLease);
    }, /Cross-tenant delegation forbidden/);
  });

  it('060-SEC-04: rejects delegation with tampered parent lease signature', async () => {
    const parentLease = createParentLease();
    const tamperedLease = {
      ...parentLease,
      signature: 'deadbeef' + parentLease.signature.slice(8),
    };

    const req = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'specialist-01',
      tenantId,
      workspaceId,
      subGoal: 'Tampered lease delegation',
      capabilityId: 'filesystem.readFile',
      requestedScopes: ['filesystem.readFile'],
      delegationDepth: 1,
      timeoutMs: 30000,
      idempotencyKey: 'idem-tamper',
      correlationId: crypto.randomUUID(),
    };

    await assert.rejects(async () => {
      await coordinator.delegateSubTask(req, tamperedLease);
    }, /Parent execution lease signature is invalid or forged/);
  });

  it('060-SEC-06: settles child receipt and generates verified composite receipt', async () => {
    const parentLease = createParentLease();
    const res = await coordinator.delegateSubTask(
      {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-agent',
        targetAgentId: 'specialist-01',
        tenantId,
        workspaceId,
        subGoal: 'Process file',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'idem-receipt',
        correlationId: crypto.randomUUID(),
      },
      parentLease,
    );

    const childReceipt = {
      receiptId: crypto.randomUUID(),
      taskId: res.childTaskId,
      leaseId: res.childLeaseId,
      agentId: crypto.randomUUID(),
      tenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum: crypto.createHash('sha256').update('child-evidence').digest('hex'),
      output: { lines: 42 },
      completedAt: new Date().toISOString(),
      signature: 'valid-child-sig',
    };

    const settlement = coordinator.settleChildReceipt(childReceipt);
    assert.strictEqual(settlement.valid, true);

    const compositeReceipt = coordinator.generateCompositeReceipt({
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      tenantId,
      workspaceId,
      coordinatorAgentId: 'coordinator-agent',
      output: { summary: 'all-done' },
    });

    assert.strictEqual(compositeReceipt.status, 'SUCCESS');
    assert.strictEqual(compositeReceipt.childReceipts.length, 1);
    assert.ok(compositeReceipt.evidenceTreeHash);
    assert.ok(compositeReceipt.signature);
  });

  it('060-SEC-07: cascade cancellation revokes all child tasks and rejects late child receipts', async () => {
    const parentLease = createParentLease();
    const res = await coordinator.delegateSubTask(
      {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-agent',
        targetAgentId: 'specialist-01',
        tenantId,
        workspaceId,
        subGoal: 'To be cancelled',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'idem-cancel',
        correlationId: crypto.randomUUID(),
      },
      parentLease,
    );

    // Cancel parent
    const cancelRes = coordinator.cancelDelegation(parentTaskId);
    assert.strictEqual(cancelRes.cancelledChildTaskIds.length, 1);
    assert.strictEqual(cancelRes.cancelledChildTaskIds[0], res.childTaskId);

    // Attempt to settle late receipt on cancelled child
    const childReceipt = {
      receiptId: crypto.randomUUID(),
      taskId: res.childTaskId,
      leaseId: res.childLeaseId,
      agentId: crypto.randomUUID(),
      tenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum: crypto.createHash('sha256').update('late-evidence').digest('hex'),
      output: {},
      completedAt: new Date().toISOString(),
      signature: 'late-sig',
    };

    const lateSettlement = coordinator.settleChildReceipt(childReceipt);
    assert.strictEqual(lateSettlement.valid, false);
    assert.match(lateSettlement.error ?? '', /Parent task or delegation was cancelled/);
  });

  it('localizes child failure and returns compensation payload', async () => {
    const parentLease = createParentLease();
    const compensationPayload = { fallbackAction: 'use-cached-data' };

    const res = await coordinator.delegateSubTask(
      {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-agent',
        targetAgentId: 'specialist-01',
        tenantId,
        workspaceId,
        subGoal: 'Failing subtask',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'idem-fail-comp',
        correlationId: crypto.randomUUID(),
        compensationPayload,
      },
      parentLease,
    );

    const failureResult = coordinator.handleChildFailure(res.childTaskId, 'File not found');
    assert.strictEqual(failureResult.compensated, true);
    assert.deepStrictEqual(failureResult.compensationPayload, compensationPayload);

    // Composite receipt reflects partial compensation rather than crashing parent
    const compositeReceipt = coordinator.generateCompositeReceipt({
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      tenantId,
      workspaceId,
      coordinatorAgentId: 'coordinator-agent',
    });
    assert.strictEqual(compositeReceipt.status, 'PARTIAL_COMPENSATION');
  });
});
