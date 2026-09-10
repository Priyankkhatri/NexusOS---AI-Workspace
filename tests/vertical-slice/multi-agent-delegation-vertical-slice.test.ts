import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { AgentDirectoryService, DelegationCoordinator, LeaseIssuer } from '@nexusos/backend';
import { createFederationMessage, AcpFederationMessageSchema } from '@nexusos/contracts';

describe('Task 060 Vertical Slice: End-to-End Multi-Agent Delegation & Federated ACP', () => {
  let directory: AgentDirectoryService;
  let leaseIssuer: LeaseIssuer;
  let coordinator: DelegationCoordinator;

  const testSecret = 'vertical-slice-secret-at-least-16-chars';
  const tenantId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const parentTaskId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();

  beforeEach(() => {
    directory = new AgentDirectoryService();
    leaseIssuer = new LeaseIssuer({ leaseSecret: testSecret });
    coordinator = new DelegationCoordinator({
      agentDirectory: directory,
      leaseIssuer,
      maxDepth: 3,
      maxFanOut: 5,
    });

    // Register Coordinator Agent
    directory.registerAgent({
      agentId: 'coordinator-agent',
      tenantId,
      workspaceScope: [workspaceId],
      role: 'COORDINATOR',
      capabilities: ['agent.delegate', 'filesystem.readFile', 'browser.navigate'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });

    // Register Research Specialist Sub-Agent
    directory.registerAgent({
      agentId: 'researcher-subagent',
      tenantId,
      workspaceScope: [workspaceId],
      role: 'SPECIALIST',
      capabilities: ['browser.navigate'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });

    // Register Data Processing Specialist Sub-Agent
    directory.registerAgent({
      agentId: 'analyst-subagent',
      tenantId,
      workspaceScope: [workspaceId],
      role: 'SPECIALIST',
      capabilities: ['filesystem.readFile'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });
  });

  it('Scenario 1: Happy Path — End-to-end multi-agent delegation with attenuated child leases and composite receipt roll-up', async () => {
    // 1. Issue Parent Execution Lease to Coordinator
    const parentLease = leaseIssuer.issueLease({
      taskId: parentTaskId,
      agentId: 'coordinator-agent',
      tenantId,
      scopes: ['agent.delegate', 'filesystem.readFile', 'browser.navigate'],
      ttlSeconds: 300,
    });
    assert.strictEqual(leaseIssuer.verifyLease(parentLease), true);

    // 2. Discover Specialist Sub-Agent
    const availableResearchers = directory.findEligibleAgents({
      tenantId,
      workspaceId,
      requiredCapabilities: ['browser.navigate'],
      preferredRole: 'SPECIALIST',
    });
    assert.strictEqual(availableResearchers.length, 1);
    assert.strictEqual(availableResearchers[0].agentId, 'researcher-subagent');

    // 3. Coordinator initiates Bounded Sub-Agent Delegation Request
    const delegationReq = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'researcher-subagent',
      tenantId,
      workspaceId,
      subGoal: 'Browse security bulletin and extract findings',
      capabilityId: 'browser.navigate',
      requestedScopes: ['browser.navigate'], // Attenuated: strictly subset of parent
      parameters: { url: 'https://security.nexusos.internal/bulletin' },
      delegationDepth: 1,
      timeoutMs: 60000,
      idempotencyKey: 'idem-vs-01',
      correlationId,
    };

    const delegationRes = await coordinator.delegateSubTask(delegationReq, parentLease);
    assert.strictEqual(delegationRes.status, 'ACCEPTED');
    assert.ok(delegationRes.childTaskId);
    assert.ok(delegationRes.childLeaseId);

    // 4. Transport delegation message over Federated ACP Envelope
    const acpFrame = createFederationMessage({
      correlation_id: correlationId,
      message_type: 'DELEGATION',
      from_agent: 'coordinator-agent',
      to_agent: 'researcher-subagent',
      tenant_id: tenantId,
      workspace_id: workspaceId,
      task_id: delegationRes.childTaskId,
      delegation_lineage: [delegationReq.delegationId],
      schema_id: 'schema:nexusos:acp:delegation:v1',
      payload: {
        subGoal: delegationReq.subGoal,
        leaseId: delegationRes.childLeaseId,
        parameters: delegationReq.parameters,
      },
    });

    const parsedFrame = AcpFederationMessageSchema.safeParse(acpFrame);
    assert.strictEqual(parsedFrame.success, true);

    // 5. Specialist Sub-Agent executes work and produces signed ExecutionReceipt
    const evidenceChecksum = crypto
      .createHash('sha256')
      .update('extracted-bulletin-content')
      .digest('hex');

    const childReceipt = {
      receiptId: crypto.randomUUID(),
      taskId: delegationRes.childTaskId,
      leaseId: delegationRes.childLeaseId,
      agentId: crypto.randomUUID(),
      tenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum,
      output: { bulletinCount: 3, criticalCount: 0 },
      completedAt: new Date().toISOString(),
      signature: 'child-agent-hmac-sig',
    };

    // 6. Settle Child Receipt in Delegation Coordinator
    const settlement = coordinator.settleChildReceipt(childReceipt);
    assert.strictEqual(settlement.valid, true);

    // 7. Coordinator Rolls Up Verified Child Evidence into Composite Receipt
    const compositeReceipt = coordinator.generateCompositeReceipt({
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      tenantId,
      workspaceId,
      coordinatorAgentId: 'coordinator-agent',
      output: {
        summary: 'Security bulletin analysis complete',
        findings: childReceipt.output,
      },
    });

    assert.strictEqual(compositeReceipt.status, 'SUCCESS');
    assert.strictEqual(compositeReceipt.childReceipts.length, 1);
    assert.strictEqual(compositeReceipt.childReceipts[0].taskId, delegationRes.childTaskId);
    assert.ok(compositeReceipt.evidenceTreeHash);
    assert.ok(compositeReceipt.signature);
  });

  it('Scenario 2: Failure & Compensation — Localized sub-agent failure triggers compensation without crashing workflow', async () => {
    const parentLease = leaseIssuer.issueLease({
      taskId: parentTaskId,
      agentId: 'coordinator-agent',
      tenantId,
      scopes: ['agent.delegate', 'filesystem.readFile'],
      ttlSeconds: 300,
    });

    const compensationPayload = {
      action: 'use-cached-local-file',
      fallbackPath: 'cache/fallback-data.json',
    };

    const delegationReq = {
      delegationId: crypto.randomUUID(),
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      delegatorAgentId: 'coordinator-agent',
      targetAgentId: 'analyst-subagent',
      tenantId,
      workspaceId,
      subGoal: 'Read network data with compensation fallback',
      capabilityId: 'filesystem.readFile',
      requestedScopes: ['filesystem.readFile'],
      delegationDepth: 1,
      timeoutMs: 30000,
      idempotencyKey: 'idem-vs-fail',
      correlationId,
      compensationPayload,
    };

    const delegationRes = await coordinator.delegateSubTask(delegationReq, parentLease);
    assert.strictEqual(delegationRes.status, 'ACCEPTED');

    // Child sub-agent fails
    const failureHandling = coordinator.handleChildFailure(
      delegationRes.childTaskId,
      'Remote file connection timed out',
    );

    assert.strictEqual(failureHandling.compensated, true);
    assert.deepStrictEqual(failureHandling.compensationPayload, compensationPayload);

    // Composite receipt reflects partial compensation
    const compositeReceipt = coordinator.generateCompositeReceipt({
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      tenantId,
      workspaceId,
      coordinatorAgentId: 'coordinator-agent',
      output: { recovery: 'Fallback executed successfully' },
    });

    assert.strictEqual(compositeReceipt.status, 'PARTIAL_COMPENSATION');
  });

  it('Scenario 3: Cancellation Cascade — Parent abort revokes active child leases and rejects late arrivals', async () => {
    const parentLease = leaseIssuer.issueLease({
      taskId: parentTaskId,
      agentId: 'coordinator-agent',
      tenantId,
      scopes: ['agent.delegate', 'browser.navigate'],
      ttlSeconds: 300,
    });

    const delegationRes = await coordinator.delegateSubTask(
      {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-agent',
        targetAgentId: 'researcher-subagent',
        tenantId,
        workspaceId,
        subGoal: 'Long scrape to be cancelled',
        capabilityId: 'browser.navigate',
        requestedScopes: ['browser.navigate'],
        delegationDepth: 1,
        timeoutMs: 60000,
        idempotencyKey: 'idem-vs-cancel',
        correlationId,
      },
      parentLease,
    );

    // Cancel parent workflow
    const cancellation = coordinator.cancelDelegation(parentTaskId);
    assert.strictEqual(cancellation.cancelledChildTaskIds.length, 1);
    assert.strictEqual(cancellation.cancelledChildTaskIds[0], delegationRes.childTaskId);

    // Late receipt submission
    const lateReceipt = {
      receiptId: crypto.randomUUID(),
      taskId: delegationRes.childTaskId,
      leaseId: delegationRes.childLeaseId,
      agentId: crypto.randomUUID(),
      tenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum: crypto.createHash('sha256').update('late').digest('hex'),
      completedAt: new Date().toISOString(),
      signature: 'late-sig',
    };

    const lateResult = coordinator.settleChildReceipt(lateReceipt);
    assert.strictEqual(lateResult.valid, false);
    assert.match(lateResult.error ?? '', /cancelled/);

    // Composite receipt status is CANCELLED
    const compositeReceipt = coordinator.generateCompositeReceipt({
      parentTaskId,
      parentLeaseId: parentLease.lease_id,
      tenantId,
      workspaceId,
      coordinatorAgentId: 'coordinator-agent',
    });
    assert.strictEqual(compositeReceipt.status, 'CANCELLED');
  });
});
