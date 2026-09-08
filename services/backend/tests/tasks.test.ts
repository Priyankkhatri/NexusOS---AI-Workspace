import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { TaskLifecycleState, TaskRecord } from '@nexusos/contracts';
import {
  TaskStateMachine,
  LeaseIssuer,
  verifyLeaseSignature,
  ReceiptVerifier,
  computeEvidenceHash,
  computeReceiptSignature,
  TaskController,
  InMemoryEventPublisherBoundary,
} from '../src/index.js';
import {
  ReferencePolicyEvaluator,
  loadPolicyConfig,
  PolicyEvaluator,
  PolicyEffect,
} from '@nexusos/policy';
import { AuthenticatedContext, PrincipalType } from '@nexusos/identity';

const defaultTenantId = 'e0000000-0000-4000-8000-000000000001';
const defaultUserId = 'e0000000-0000-4000-8000-000000000002';
const defaultAgentId = 'e0000000-0000-4000-8000-000000000003';

function createMockAuthContext(overrides?: Partial<AuthenticatedContext>): AuthenticatedContext {
  const tenantId = overrides?.tenantId ?? defaultTenantId;
  return {
    principal: {
      type: PrincipalType.USER,
      userId: defaultUserId,
      tenantId,
      roles: ['admin', 'operator'],
    },
    tenantId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    rawTokenHash: 'hash-abc-123',
    ...overrides,
  };
}

describe('Task 047 — Backend Task State Machine & Lifecycle Verification', () => {
  const initialTask: TaskRecord = {
    taskId: crypto.randomUUID(),
    tenantId: defaultTenantId,
    submittedBy: defaultUserId,
    title: 'Query system posture',
    targetAgentId: defaultAgentId,
    capabilityId: 'device.queryInfo',
    runtimeCategory: 'DEVICE',
    parameters: {},
    requestedScope: 'device:read',
    state: TaskLifecycleState.SUBMITTED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('progresses through happy-path states sequentially', () => {
    let task: TaskRecord = { ...initialTask };

    task = TaskStateMachine.transition(task, TaskLifecycleState.POLICY_EVALUATED);
    assert.strictEqual(task.state, TaskLifecycleState.POLICY_EVALUATED);

    task = TaskStateMachine.transition(task, TaskLifecycleState.LEASED);
    assert.strictEqual(task.state, TaskLifecycleState.LEASED);

    task = TaskStateMachine.transition(task, TaskLifecycleState.DISPATCHED);
    assert.strictEqual(task.state, TaskLifecycleState.DISPATCHED);

    task = TaskStateMachine.transition(task, TaskLifecycleState.EXECUTING);
    assert.strictEqual(task.state, TaskLifecycleState.EXECUTING);

    task = TaskStateMachine.transition(task, TaskLifecycleState.RECEIPT_VERIFIED);
    assert.strictEqual(task.state, TaskLifecycleState.RECEIPT_VERIFIED);

    task = TaskStateMachine.transition(task, TaskLifecycleState.COMPLETED);
    assert.strictEqual(task.state, TaskLifecycleState.COMPLETED);
  });

  it('rejects illegal state skips (e.g. SUBMITTED -> COMPLETED)', () => {
    assert.throws(
      () => TaskStateMachine.transition(initialTask, TaskLifecycleState.COMPLETED),
      /Illegal task state transition/,
    );
  });

  it('allows transition to FAILED from active states', () => {
    const failedTask = TaskStateMachine.transition(
      initialTask,
      TaskLifecycleState.FAILED,
      'Policy denial',
    );
    assert.strictEqual(failedTask.state, TaskLifecycleState.FAILED);
    assert.strictEqual(failedTask.error?.message, 'Policy denial');
  });

  it('allows transition to CANCELLED from active states', () => {
    const cancelledTask = TaskStateMachine.transition(
      initialTask,
      TaskLifecycleState.CANCELLED,
      'User requested cancellation',
    );
    assert.strictEqual(cancelledTask.state, TaskLifecycleState.CANCELLED);
  });

  it('blocks transition from terminal COMPLETED state', () => {
    const completedTask = { ...initialTask, state: TaskLifecycleState.COMPLETED };
    assert.throws(
      () => TaskStateMachine.transition(completedTask, TaskLifecycleState.EXECUTING),
      /Illegal task state transition/,
    );
  });

  it('blocks transition from terminal CANCELLED state to COMPLETED', () => {
    const cancelledTask = { ...initialTask, state: TaskLifecycleState.CANCELLED };
    assert.throws(
      () => TaskStateMachine.transition(cancelledTask, TaskLifecycleState.COMPLETED),
      /Illegal task state transition/,
    );
  });
});

describe('Task 047 — Signed Execution Lease Issuer', () => {
  const leaseSecret = 'test-lease-hmac-secret-32-chars-long!';
  const issuer = new LeaseIssuer({ leaseSecret, ttlSeconds: 30 });

  it('issues a cryptographically signed execution lease bound to context', () => {
    const taskId = crypto.randomUUID();
    const lease = issuer.issueLease({
      taskId,
      agentId: defaultAgentId,
      tenantId: defaultTenantId,
      scopes: ['device:read'],
      policyHash: 'pol-hash-999',
    });

    assert.strictEqual(lease.task_id, taskId);
    assert.strictEqual(lease.agent_id, defaultAgentId);
    assert.strictEqual(lease.tenant_id, defaultTenantId);
    assert.deepStrictEqual(lease.scopes, ['device:read']);
    assert.ok(lease.signature);
    assert.ok(lease.nonce);

    // Verify signature
    const isValid = verifyLeaseSignature(lease, leaseSecret);
    assert.strictEqual(isValid, true);
  });

  it('rejects tampered lease signature', () => {
    const lease = issuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId: defaultAgentId,
      tenantId: defaultTenantId,
      scopes: ['device:read'],
    });

    const tampered = { ...lease, signature: 'tampered-signature-value' };
    assert.strictEqual(verifyLeaseSignature(tampered, leaseSecret), false);
  });

  it('rejects tampered lease scopes under original signature', () => {
    const lease = issuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId: defaultAgentId,
      tenantId: defaultTenantId,
      scopes: ['device:read'],
    });

    const escalated = { ...lease, scopes: ['device:read', 'admin:escalate'] };
    assert.strictEqual(verifyLeaseSignature(escalated, leaseSecret), false);
  });
});

describe('Task 047 — Execution Receipt Verifier', () => {
  const agentSecret = 'agent-shared-hmac-secret-for-signing';
  const verifier = new ReceiptVerifier({ agentSecret });

  it('verifies valid signed execution receipt with matching evidence hash', () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const agentId = defaultAgentId;
    const output = { status: 'healthy', cpu: 'arm64' };
    const evidenceChecksum = computeEvidenceHash(output);

    const unsignedReceipt = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId: defaultTenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum,
      output,
      completedAt: new Date().toISOString(),
    };

    const signature = computeReceiptSignature(unsignedReceipt, agentSecret);
    const receipt = { ...unsignedReceipt, signature };

    const result = verifier.verifyReceipt({
      receipt,
      expectedTaskId: taskId,
      expectedLeaseId: leaseId,
      expectedAgentId: agentId,
      expectedTenantId: defaultTenantId,
      actualOutput: output,
    });

    assert.strictEqual(result.valid, true);
  });

  it('rejects receipt with evidence hash mismatch', () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const agentId = defaultAgentId;
    const output = { status: 'healthy' };
    const forgedEvidenceChecksum = computeEvidenceHash({ forged: 'tampered-data' });

    const unsignedReceipt = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId: defaultTenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum: forgedEvidenceChecksum,
      output,
      completedAt: new Date().toISOString(),
    };

    const signature = computeReceiptSignature(unsignedReceipt, agentSecret);
    const receipt = { ...unsignedReceipt, signature };

    const result = verifier.verifyReceipt({
      receipt,
      expectedTaskId: taskId,
      expectedLeaseId: leaseId,
      expectedAgentId: agentId,
      expectedTenantId: defaultTenantId,
      actualOutput: output,
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorCode, 'EVIDENCE_HASH_MISMATCH');
  });

  it('rejects receipt with forged signature', () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const agentId = defaultAgentId;
    const output = { status: 'ok' };
    const evidenceChecksum = computeEvidenceHash(output);

    const receipt = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId: defaultTenantId,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum,
      output,
      completedAt: new Date().toISOString(),
      signature: 'invalid-forged-signature',
    };

    const result = verifier.verifyReceipt({
      receipt,
      expectedTaskId: taskId,
      expectedLeaseId: leaseId,
      expectedAgentId: agentId,
      expectedTenantId: defaultTenantId,
      actualOutput: output,
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errorCode, 'INVALID_RECEIPT_SIGNATURE');
  });
});

describe('Task 047 — TaskController Intake, Policy, & Redaction', () => {
  const leaseSecret = 'controller-lease-secret-key-32-chars';
  const agentSecret = 'controller-agent-secret-key-32-chars';
  const leaseIssuer = new LeaseIssuer({ leaseSecret });
  const receiptVerifier = new ReceiptVerifier({ agentSecret });
  const eventPublisher = new InMemoryEventPublisherBoundary();
  const policyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig());

  it('redacts sensitive parameters during task creation', async () => {
    const controller = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      eventPublisher,
    });

    const targetAgentId = crypto.randomUUID();
    const authContext = createMockAuthContext();
    const { task } = await controller.createTask(
      {
        title: 'Task with sensitive credentials',
        targetAgentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {
          apiKey: 'super-secret-api-key-12345',
          password: 'plain-text-password',
          host: '127.0.0.1',
        },
        requestedScope: 'device:read',
      },
      authContext,
    );

    assert.strictEqual(task.parameters.apiKey, '[REDACTED]');
    assert.strictEqual(task.parameters.password, '[REDACTED]');
    assert.strictEqual(task.parameters.host, '127.0.0.1');
  });

  it('transitions to FAILED without issuing a lease when policy denies', async () => {
    // Custom policy evaluator that always denies
    const denyingPolicyEvaluator: PolicyEvaluator = {
      evaluate: async (decisionReq) => ({
        decisionId: crypto.randomUUID(),
        effect: PolicyEffect.DENY,
        allowed: false,
        reason: 'Restricted high-privilege action denied by policy.',
        policyVersion: '1.0.0',
        policyHash: 'deny-hash',
        evaluatedAt: new Date().toISOString(),
        requestId: decisionReq.context.requestId,
        correlationId: decisionReq.context.correlationId,
      }),
      getSnapshot: () => ({
        policyVersion: '1.0.0',
        policyHash: 'deny-hash',
        createdAt: new Date().toISOString(),
        rules: [],
      }),
    };

    const controller = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator: denyingPolicyEvaluator,
      eventPublisher,
    });

    const targetAgentId = crypto.randomUUID();
    const authContext = createMockAuthContext();
    const result = await controller.createTask(
      {
        title: 'Forbidden Task',
        targetAgentId,
        capabilityId: 'terminal.executeCommand',
        runtimeCategory: 'TERMINAL',
        parameters: { command: 'rm -rf /' },
        requestedScope: 'terminal:write',
      },
      authContext,
    );

    assert.strictEqual(result.policyAllowed, false);
    assert.strictEqual(result.task.state, TaskLifecycleState.FAILED);
    assert.strictEqual(result.task.lease, undefined);
  });

  it('prevents cross-tenant task access', async () => {
    const controller = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      eventPublisher,
    });

    const targetAgentId = crypto.randomUUID();
    const tenantAContext = createMockAuthContext({ tenantId: crypto.randomUUID() });
    const { task } = await controller.createTask(
      {
        title: 'Tenant A task',
        targetAgentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'device:read',
      },
      tenantAContext,
    );

    const tenantBContext = createMockAuthContext({ tenantId: crypto.randomUUID() });
    assert.throws(
      () => controller.getTask(task.taskId, tenantBContext),
      /belongs to a different tenant/,
    );
  });
});
