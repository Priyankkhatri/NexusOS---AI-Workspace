import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  AgentDirectoryService,
  DelegationCoordinator,
  LeaseIssuer,
  verifyScopeAttenuation,
} from '@nexusos/backend';
import { createFederationMessage, CompositeExecutionReceiptSchema } from '@nexusos/contracts';

describe('Task 060 Security Hardening: Multi-Agent Delegation & Federated ACP Invariants', () => {
  let directory: AgentDirectoryService;
  let leaseIssuer: LeaseIssuer;
  let coordinator: DelegationCoordinator;

  const testSecret = 'hardened-security-secret-at-least-16-chars';
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const parentTaskId = crypto.randomUUID();

  beforeEach(() => {
    directory = new AgentDirectoryService({ heartbeatTtlMs: 5000, maxAgentsPerTenant: 10 });
    leaseIssuer = new LeaseIssuer({ leaseSecret: testSecret });
    coordinator = new DelegationCoordinator({
      agentDirectory: directory,
      leaseIssuer,
      maxDepth: 3,
      maxFanOut: 5,
    });

    // Register approved agents in Tenant A
    directory.registerAgent({
      agentId: 'specialist-analyst-01',
      tenantId: tenantA,
      workspaceScope: [workspaceA],
      role: 'SPECIALIST',
      capabilities: ['filesystem.readFile', 'browser.navigate'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });

    directory.registerAgent({
      agentId: 'specialist-writer-01',
      tenantId: tenantA,
      workspaceScope: [workspaceA],
      role: 'SPECIALIST',
      capabilities: ['filesystem.writeFile'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });

    // Register agent in Tenant B
    directory.registerAgent({
      agentId: 'agent-tenant-b',
      tenantId: tenantB,
      workspaceScope: [workspaceB],
      role: 'SPECIALIST',
      capabilities: ['filesystem.readFile', 'filesystem.writeFile'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });
  });

  function createParentLease(
    scopes = ['filesystem.readFile', 'browser.navigate', 'agent.delegate'],
  ) {
    return leaseIssuer.issueLease({
      taskId: parentTaskId,
      agentId: 'coordinator-01',
      tenantId: tenantA,
      scopes,
      ttlSeconds: 300,
    });
  }

  describe('060-SEC-01: Anti-Privilege Escalation', () => {
    it('fails closed when child requests scopes exceeding parent lease authority', async () => {
      const parentLease = createParentLease(['filesystem.readFile']); // Only read scope

      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-01',
        targetAgentId: 'specialist-writer-01',
        tenantId: tenantA,
        workspaceId: workspaceA,
        subGoal: 'Unauthorized write attempt',
        capabilityId: 'filesystem.writeFile',
        requestedScopes: ['filesystem.writeFile'], // Escalation attempt
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'sec-01-escalate',
        correlationId: crypto.randomUUID(),
      };

      await assert.rejects(async () => {
        await coordinator.delegateSubTask(req, parentLease);
      }, /Privilege escalation forbidden/);
    });

    it('rejects wildcard expansion in child scopes if not explicitly present in parent', () => {
      const parentScopes = ['filesystem.readFile'];
      const childScopes = ['filesystem.*'];

      const result = verifyScopeAttenuation(parentScopes, childScopes);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errorCode, 'SCOPE_AMPLIFICATION_FORBIDDEN');
    });
  });

  describe('060-SEC-02: Bounded Delegation Depth & Fan-out', () => {
    it('rejects recursive delegation exceeding maximum depth limit of 3', async () => {
      const parentLease = createParentLease();

      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-01',
        targetAgentId: 'specialist-analyst-01',
        tenantId: tenantA,
        workspaceId: workspaceA,
        subGoal: 'Depth 4 delegation attempt',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 4, // Exceeds limit
        timeoutMs: 30000,
        idempotencyKey: 'sec-02-depth-4',
        correlationId: crypto.randomUUID(),
      };

      await assert.rejects(async () => {
        await coordinator.delegateSubTask(req, parentLease);
      }, /Number must be less than or equal to 3|Recursive delegation limit exceeded/);
    });

    it('atomically enforces fan-out concurrency ceiling (max 5 active child tasks)', async () => {
      const parentLease = createParentLease();

      for (let i = 0; i < 5; i++) {
        await coordinator.delegateSubTask(
          {
            delegationId: crypto.randomUUID(),
            parentTaskId,
            parentLeaseId: parentLease.lease_id,
            delegatorAgentId: 'coordinator-01',
            targetAgentId: 'specialist-analyst-01',
            tenantId: tenantA,
            workspaceId: workspaceA,
            subGoal: `Fan-out child ${i}`,
            capabilityId: 'filesystem.readFile',
            requestedScopes: ['filesystem.readFile'],
            delegationDepth: 1,
            timeoutMs: 30000,
            idempotencyKey: `sec-02-fanout-${i}`,
            correlationId: crypto.randomUUID(),
          },
          parentLease,
        );
      }

      await assert.rejects(async () => {
        await coordinator.delegateSubTask(
          {
            delegationId: crypto.randomUUID(),
            parentTaskId,
            parentLeaseId: parentLease.lease_id,
            delegatorAgentId: 'coordinator-01',
            targetAgentId: 'specialist-analyst-01',
            tenantId: tenantA,
            workspaceId: workspaceA,
            subGoal: 'Excess child 6',
            capabilityId: 'filesystem.readFile',
            requestedScopes: ['filesystem.readFile'],
            delegationDepth: 1,
            timeoutMs: 30000,
            idempotencyKey: 'sec-02-fanout-6',
            correlationId: crypto.randomUUID(),
          },
          parentLease,
        );
      }, /Child fan-out limit exceeded/);
    });
  });

  describe('060-SEC-03: Cross-Tenant Isolation', () => {
    it('rejects delegation across tenant boundaries', async () => {
      const parentLease = createParentLease();

      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-01',
        targetAgentId: 'agent-tenant-b', // Agent in Tenant B
        tenantId: tenantB, // Request claiming Tenant B
        workspaceId: workspaceB,
        subGoal: 'Cross-tenant data extraction',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'sec-03-cross-tenant',
        correlationId: crypto.randomUUID(),
      };

      await assert.rejects(async () => {
        await coordinator.delegateSubTask(req, parentLease);
      }, /Cross-tenant delegation forbidden/);
    });

    it('prevents agent discovery across tenants', () => {
      const results = directory.findEligibleAgents({
        tenantId: tenantA,
        workspaceId: workspaceA,
      });

      // All returned agents must strictly belong to Tenant A
      for (const agent of results) {
        assert.strictEqual(agent.tenantId, tenantA);
      }
      assert.strictEqual(
        results.some((a) => a.agentId === 'agent-tenant-b'),
        false,
      );
    });
  });

  describe('060-SEC-04: Cryptographic Sender Verification', () => {
    it('rejects delegation when parent lease HMAC signature has been tampered with', async () => {
      const parentLease = createParentLease();
      const forgedLease = {
        ...parentLease,
        signature: 'deadbeefcafebabe' + parentLease.signature.slice(16),
      };

      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId: parentLease.lease_id,
        delegatorAgentId: 'coordinator-01',
        targetAgentId: 'specialist-analyst-01',
        tenantId: tenantA,
        workspaceId: workspaceA,
        subGoal: 'Forged signature run',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'sec-04-forged',
        correlationId: crypto.randomUUID(),
      };

      await assert.rejects(async () => {
        await coordinator.delegateSubTask(req, forgedLease);
      }, /Parent execution lease signature is invalid or forged/);
    });
  });

  describe('060-SEC-05: Secret Leakage Prevention in ACP Envelopes', () => {
    it('ensures federated ACP messages require explicit schema references rather than plaintext credentials', () => {
      const correlationId = crypto.randomUUID();
      const msg = createFederationMessage({
        correlation_id: correlationId,
        message_type: 'DELEGATION',
        from_agent: 'coordinator-01',
        to_agent: 'specialist-analyst-01',
        tenant_id: tenantA,
        workspace_id: workspaceA,
        schema_id: 'schema:nexusos:acp:delegation:v1',
        body_ref: 'art-secret-free-reference-01',
        payload: {
          taskRef: 'task-771',
          dataRef: 'art-protected-context',
        },
      });

      assert.ok(msg.body_ref);
      assert.strictEqual(msg.payload.dataRef, 'art-protected-context');
    });
  });

  describe('060-SEC-06: Tamper-Resistant Evidence & Composite Receipts', () => {
    it('rejects composite receipt settlement if child receipt evidence checksum is invalid', async () => {
      const parentLease = createParentLease();
      const res = await coordinator.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId,
          parentLeaseId: parentLease.lease_id,
          delegatorAgentId: 'coordinator-01',
          targetAgentId: 'specialist-analyst-01',
          tenantId: tenantA,
          workspaceId: workspaceA,
          subGoal: 'Verify checksum tamper',
          capabilityId: 'filesystem.readFile',
          requestedScopes: ['filesystem.readFile'],
          delegationDepth: 1,
          timeoutMs: 30000,
          idempotencyKey: 'sec-06-tamper',
          correlationId: crypto.randomUUID(),
        },
        parentLease,
      );

      const invalidReceipt = {
        receiptId: crypto.randomUUID(),
        taskId: res.childTaskId,
        leaseId: res.childLeaseId,
        agentId: crypto.randomUUID(),
        tenantId: tenantA,
        status: 'SUCCESS' as const,
        exitCode: 0,
        evidenceChecksum: 'invalid-checksum', // Not 64 hex chars
        completedAt: new Date().toISOString(),
        signature: 'valid-sig',
      };

      assert.throws(() => {
        CompositeExecutionReceiptSchema.parse({
          receiptId: crypto.randomUUID(),
          parentTaskId,
          parentLeaseId: parentLease.lease_id,
          tenantId: tenantA,
          workspaceId: workspaceA,
          coordinatorAgentId: 'coordinator-01',
          status: 'SUCCESS',
          childReceipts: [invalidReceipt],
          evidenceTreeHash: crypto.createHash('sha256').update('tree').digest('hex'),
          completedAt: new Date().toISOString(),
          signature: 'sig',
        });
      });
    });
  });

  describe('060-SEC-07: Cascade Cancellation of Delegated Tasks', () => {
    it('revokes all child leases upon parent cancellation and rejects late settlements', async () => {
      const parentLease = createParentLease();
      const res = await coordinator.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId,
          parentLeaseId: parentLease.lease_id,
          delegatorAgentId: 'coordinator-01',
          targetAgentId: 'specialist-analyst-01',
          tenantId: tenantA,
          workspaceId: workspaceA,
          subGoal: 'Task to cancel',
          capabilityId: 'filesystem.readFile',
          requestedScopes: ['filesystem.readFile'],
          delegationDepth: 1,
          timeoutMs: 30000,
          idempotencyKey: 'sec-07-cancel',
          correlationId: crypto.randomUUID(),
        },
        parentLease,
      );

      // Perform parent cancellation
      const cancelResult = coordinator.cancelDelegation(parentTaskId);
      assert.strictEqual(cancelResult.cancelledChildTaskIds.includes(res.childTaskId), true);

      // Attempt late settlement
      const lateReceipt = {
        receiptId: crypto.randomUUID(),
        taskId: res.childTaskId,
        leaseId: res.childLeaseId,
        agentId: crypto.randomUUID(),
        tenantId: tenantA,
        status: 'SUCCESS' as const,
        exitCode: 0,
        evidenceChecksum: crypto.createHash('sha256').update('evidence').digest('hex'),
        completedAt: new Date().toISOString(),
        signature: 'late-sig',
      };

      const settlement = coordinator.settleChildReceipt(lateReceipt);
      assert.strictEqual(settlement.valid, false);
      assert.match(settlement.error ?? '', /cancelled/);

      // Further delegation attempts under cancelled parent are blocked
      await assert.rejects(async () => {
        await coordinator.delegateSubTask(
          {
            delegationId: crypto.randomUUID(),
            parentTaskId,
            parentLeaseId: parentLease.lease_id,
            delegatorAgentId: 'coordinator-01',
            targetAgentId: 'specialist-analyst-01',
            tenantId: tenantA,
            workspaceId: workspaceA,
            subGoal: 'New child under cancelled parent',
            capabilityId: 'filesystem.readFile',
            requestedScopes: ['filesystem.readFile'],
            delegationDepth: 1,
            timeoutMs: 30000,
            idempotencyKey: 'sec-07-post-cancel',
            correlationId: crypto.randomUUID(),
          },
          parentLease,
        );
      }, /has been cancelled or revoked/);
    });
  });
});
