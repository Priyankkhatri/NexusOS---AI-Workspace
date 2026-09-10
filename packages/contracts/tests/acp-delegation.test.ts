import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  AcpFederationMessageSchema,
  createFederationMessage,
  SubAgentDelegationRequestSchema,
  SubAgentDelegationResponseSchema,
  CompositeExecutionReceiptSchema,
  AgentRegistrationSchema,
  AgentHeartbeatSchema,
  DelegatedLeaseHeaderSchema,
  DELEGATION_SAFETY_LIMITS,
} from '../src/index.js';

describe('Federated ACP & Sub-Agent Delegation Contracts Audit (Task 060)', () => {
  const tenantId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const parentTaskId = crypto.randomUUID();
  const childTaskId = crypto.randomUUID();
  const parentLeaseId = crypto.randomUUID();
  const childLeaseId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();

  describe('Authoritative Safety Bounds', () => {
    it('exports canonical delegation safety limits (060-SEC-02)', () => {
      assert.strictEqual(DELEGATION_SAFETY_LIMITS.MAX_DEPTH, 3);
      assert.strictEqual(DELEGATION_SAFETY_LIMITS.MAX_FAN_OUT, 5);
      assert.strictEqual(DELEGATION_SAFETY_LIMITS.MAX_TIMEOUT_MS, 300000);
    });
  });

  describe('Federated ACP Message Envelopes', () => {
    it('validates a well-formed federated ACP delegation message', () => {
      const msg = createFederationMessage({
        correlation_id: correlationId,
        message_type: 'DELEGATION',
        from_agent: 'agent-coordinator-01',
        to_agent: 'agent-specialist-02',
        tenant_id: tenantId,
        workspace_id: workspaceId,
        task_id: parentTaskId,
        schema_id: 'schema:nexusos:acp:delegation:v1',
        payload: {
          subGoal: 'Analyze security logs',
          requestedScopes: ['filesystem.readFile'],
        },
      });

      const parsed = AcpFederationMessageSchema.safeParse(msg);
      assert.strictEqual(parsed.success, true);
      if (parsed.success) {
        assert.strictEqual(parsed.data.message_type, 'DELEGATION');
        assert.strictEqual(parsed.data.tenant_id, tenantId);
        assert.strictEqual(parsed.data.workspace_id, workspaceId);
      }
    });

    it('rejects a federated ACP message with invalid message_type', () => {
      const invalidMsg = {
        version: '1.0.0',
        message_id: crypto.randomUUID(),
        correlation_id: correlationId,
        message_type: 'INVALID_TYPE',
        from_agent: 'agent-coordinator-01',
        to_agent: 'agent-specialist-02',
        tenant_id: tenantId,
        workspace_id: workspaceId,
        timestamp: new Date().toISOString(),
        schema_id: 'schema:nexusos:acp:test',
        payload: {},
      };

      const parsed = AcpFederationMessageSchema.safeParse(invalidMsg);
      assert.strictEqual(parsed.success, false);
    });
  });

  describe('SubAgentDelegationRequestSchema & ResponseSchema', () => {
    it('validates a valid delegation request within safety limits', () => {
      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId,
        delegatorAgentId: 'agent-coordinator-01',
        targetAgentId: 'agent-specialist-02',
        tenantId,
        workspaceId,
        subGoal: 'Process dataset partitions',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        parameters: { path: 'data/partition1.csv' },
        delegationDepth: 1,
        timeoutMs: 30000,
        idempotencyKey: 'idem-key-001',
        correlationId,
      };

      const parsed = SubAgentDelegationRequestSchema.safeParse(req);
      assert.strictEqual(parsed.success, true);
    });

    it('rejects delegation depth exceeding maximum depth limit (MAX_DEPTH = 3)', () => {
      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId,
        delegatorAgentId: 'agent-coordinator-01',
        targetAgentId: 'agent-specialist-02',
        tenantId,
        workspaceId,
        subGoal: 'Deep recursive delegation',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 4, // Exceeds limit
        timeoutMs: 30000,
        idempotencyKey: 'idem-key-002',
        correlationId,
      };

      const parsed = SubAgentDelegationRequestSchema.safeParse(req);
      assert.strictEqual(parsed.success, false);
    });

    it('rejects delegation timeout exceeding maximum timeout (300,000ms)', () => {
      const req = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId,
        delegatorAgentId: 'agent-coordinator-01',
        targetAgentId: 'agent-specialist-02',
        tenantId,
        workspaceId,
        subGoal: 'Long running task',
        capabilityId: 'filesystem.readFile',
        requestedScopes: ['filesystem.readFile'],
        delegationDepth: 2,
        timeoutMs: 400000, // Exceeds 300000
        idempotencyKey: 'idem-key-003',
        correlationId,
      };

      const parsed = SubAgentDelegationRequestSchema.safeParse(req);
      assert.strictEqual(parsed.success, false);
    });

    it('validates a valid delegation response contract', () => {
      const res = {
        delegationId: crypto.randomUUID(),
        parentTaskId,
        childTaskId,
        childLeaseId,
        assignedAgentId: 'agent-specialist-02',
        tenantId,
        workspaceId,
        status: 'ACCEPTED',
        delegationDepth: 1,
        acceptedAt: new Date().toISOString(),
      };

      const parsed = SubAgentDelegationResponseSchema.safeParse(res);
      assert.strictEqual(parsed.success, true);
    });
  });

  describe('CompositeExecutionReceiptSchema', () => {
    it('validates composite receipt aggregating verified child receipts', () => {
      const childAgentId = crypto.randomUUID();
      const childReceipt = {
        receiptId: crypto.randomUUID(),
        taskId: childTaskId,
        leaseId: childLeaseId,
        agentId: childAgentId,
        tenantId,
        status: 'SUCCESS' as const,
        exitCode: 0,
        evidenceChecksum: crypto.createHash('sha256').update('child-evidence').digest('hex'),
        output: { rowsProcessed: 100 },
        completedAt: new Date().toISOString(),
        signature: 'valid-child-sig',
      };

      const compositeReceipt = {
        receiptId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId,
        tenantId,
        workspaceId,
        coordinatorAgentId: 'agent-coordinator-01',
        status: 'SUCCESS' as const,
        childReceipts: [childReceipt],
        evidenceTreeHash: crypto.createHash('sha256').update('evidence-tree').digest('hex'),
        output: { totalProcessed: 100 },
        completedAt: new Date().toISOString(),
        signature: 'valid-composite-sig',
      };

      const parsed = CompositeExecutionReceiptSchema.safeParse(compositeReceipt);
      assert.strictEqual(parsed.success, true);
    });

    it('rejects composite receipt with invalid evidenceTreeHash format', () => {
      const invalidReceipt = {
        receiptId: crypto.randomUUID(),
        parentTaskId,
        parentLeaseId,
        tenantId,
        workspaceId,
        coordinatorAgentId: 'agent-coordinator-01',
        status: 'SUCCESS',
        childReceipts: [],
        evidenceTreeHash: 'not-a-sha256-hash',
        completedAt: new Date().toISOString(),
        signature: 'valid-sig',
      };

      const parsed = CompositeExecutionReceiptSchema.safeParse(invalidReceipt);
      assert.strictEqual(parsed.success, false);
    });
  });

  describe('Agent Directory & Heartbeat Contracts', () => {
    it('validates valid agent registration and heartbeat', () => {
      const reg = {
        agentId: 'agent-specialist-01',
        tenantId,
        workspaceScope: [workspaceId],
        role: 'SPECIALIST' as const,
        capabilities: ['filesystem.readFile', 'browser.navigate'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
      };

      const parsedReg = AgentRegistrationSchema.safeParse(reg);
      assert.strictEqual(parsedReg.success, true);

      const heartbeat = {
        agentId: 'agent-specialist-01',
        tenantId,
        status: 'AVAILABLE' as const,
        currentLoad: 0.25,
        timestamp: new Date().toISOString(),
        activeTaskIds: [],
      };

      const parsedHb = AgentHeartbeatSchema.safeParse(heartbeat);
      assert.strictEqual(parsedHb.success, true);
    });
  });

  describe('DelegatedLeaseHeaderSchema', () => {
    it('validates delegated lease header bound to parent authority', () => {
      const delegatedLease = {
        lease_id: childLeaseId,
        task_id: childTaskId,
        agent_id: 'agent-specialist-02',
        tenant_id: tenantId,
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        scopes: ['filesystem.readFile'],
        signature: 'hmac-signature-hex',
        parent_lease_id: parentLeaseId,
        parent_task_id: parentTaskId,
        delegation_depth: 2,
        workspace_id: workspaceId,
      };

      const parsed = DelegatedLeaseHeaderSchema.safeParse(delegatedLease);
      assert.strictEqual(parsed.success, true);
    });
  });
});
