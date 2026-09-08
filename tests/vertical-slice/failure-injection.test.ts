import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { TaskLifecycleState, ExecutionReceipt } from '@nexusos/contracts';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  computeEvidenceHash,
  computeReceiptSignature,
  InMemoryEventPublisherBoundary,
} from '@nexusos/backend';
import { ReferencePolicyEvaluator, loadPolicyConfig, PolicyEffect } from '@nexusos/policy';
import {
  createAuthenticationMiddleware,
  IdentityProviderBoundary,
  AuthenticationResult,
  loadIdentityConfig,
  PrincipalType,
  AuthenticatedContext,
} from '@nexusos/identity';
import { ExecutionLeaseBoundary } from '@nexusos/desktop-agent';

class TestIdentityProvider implements IdentityProviderBoundary {
  private readonly tokens = new Map<string, AuthenticatedContext>();

  registerToken(token: string, context: AuthenticatedContext): void {
    this.tokens.set(token, context);
  }

  async authenticateToken(rawToken: string): Promise<AuthenticationResult> {
    const context = this.tokens.get(rawToken);
    if (!context) {
      return { success: false, errorCode: 'INVALID_CREDENTIALS', errorMessage: 'Invalid token' };
    }
    return { success: true, context };
  }
}

describe('Task 047 — Milestone M6: Failure Injection Scenarios (Section 87)', () => {
  let app: BackendApp;
  let baseUrl: string;
  let authToken: string;
  let tenantId: string;
  let userId: string;
  let agentId: string;
  let leaseSecret: string;
  let agentSecret: string;
  let eventPublisher: InMemoryEventPublisherBoundary;
  let taskController: TaskController;
  let policyEvaluator: ReferencePolicyEvaluator;
  let leaseIssuer: LeaseIssuer;
  let receiptVerifier: ReceiptVerifier;
  let leaseBoundary: ExecutionLeaseBoundary;

  before(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    agentId = crypto.randomUUID();
    leaseSecret = 'failure-injection-lease-hmac-secret-32b!';
    agentSecret = 'failure-injection-agent-hmac-secret-32b!';

    const identityConfig = loadIdentityConfig({
      JWT_ISSUER: 'https://auth.nexusos.local',
      JWT_AUDIENCE: 'https://api.nexusos.local',
    });
    const identityProvider = new TestIdentityProvider();
    authToken = 'valid-test-token-failure-injection';
    identityProvider.registerToken(authToken, {
      principal: {
        type: PrincipalType.USER,
        userId,
        tenantId,
        roles: ['operator'],
      },
      tenantId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rawTokenHash: crypto.createHash('sha256').update(authToken).digest('hex'),
    });

    const authenticator = createAuthenticationMiddleware(identityProvider, identityConfig);

    const policyRules = [
      {
        ruleId: 'rule-device-execute',
        actionName: 'lease:execute',
        resourceType: 'agent-execution-plane',
        effect: PolicyEffect.ALLOW,
        requiredScope: 'capability:device:query',
      },
      {
        ruleId: 'rule-task-intake',
        actionName: 'task:execute',
        resourceType: 'task',
        effect: PolicyEffect.ALLOW,
        requiredRole: 'operator',
      },
    ];
    policyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig(), policyRules);

    leaseIssuer = new LeaseIssuer({ leaseSecret, ttlSeconds: 60 });
    receiptVerifier = new ReceiptVerifier({ agentSecret });
    eventPublisher = new InMemoryEventPublisherBoundary();
    leaseBoundary = new ExecutionLeaseBoundary(policyEvaluator, leaseSecret);

    taskController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      eventPublisher,
    });

    const backendConfig = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    app = new BackendApp(backendConfig, {
      taskController,
      authenticator,
    });

    const server = await app.start();
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (app) {
      await app.stop();
    }
  });

  it('Scenario 1: Malformed task intake payload rejected with 400 Bad Request', async () => {
    const invalidPayload = {
      title: '', // empty title invalid
      targetAgentId: 'not-a-valid-uuid',
      requestedScope: 'invalid',
    };

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(invalidPayload),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.strictEqual(body.error.code, 'BAD_REQUEST');
  });

  it('Scenario 2: Unauthenticated task intake rejected with 401 Unauthorized', async () => {
    const validPayload = {
      title: 'Unauthenticated Task Test',
      targetAgentId: agentId,
      capabilityId: 'device.queryInfo',
      runtimeCategory: 'DEVICE',
      parameters: {},
      requestedScope: 'capability:device:query',
    };

    // Missing token
    const resNoToken = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.strictEqual(resNoToken.status, 401);

    // Invalid token
    const resInvalidToken = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer completely-invalid-token',
      },
      body: JSON.stringify(validPayload),
    });
    assert.strictEqual(resInvalidToken.status, 401);
  });

  it('Scenario 3: Policy evaluation DENY halts execution and transitions task to FAILED', async () => {
    // Evaluator with zero matching rules -> defaults to DENY
    const denyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig(), []);
    const denyController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator: denyEvaluator,
      eventPublisher,
    });

    const context: AuthenticatedContext = {
      principal: {
        type: PrincipalType.USER,
        userId,
        tenantId,
        roles: ['operator'],
      },
      tenantId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rawTokenHash: 'hash',
    };

    const intakeReq = {
      title: 'Policy Denied Task',
      targetAgentId: agentId,
      capabilityId: 'admin.shutdown',
      runtimeCategory: 'DEVICE' as const,
      parameters: {},
      requestedScope: 'capability:admin:shutdown',
    };

    const result = await denyController.createTask(intakeReq, context);
    assert.strictEqual(result.policyAllowed, false);
    assert.strictEqual(result.task.state, TaskLifecycleState.FAILED);
    assert.strictEqual(result.task.error?.code, 'POLICY_DENIED');
    assert.strictEqual(result.task.lease, undefined);

    const events = eventPublisher.getPublishedEvents();
    const denialEvents = events.filter((e) => e.schema_id === 'nexusos.events.policy.denial');
    assert.ok(denialEvents.length > 0);
  });

  it('Scenario 4: Expired lease rejected at execution boundary with LEASE_EXPIRED', async () => {
    const expiredIssuer = new LeaseIssuer({ leaseSecret, ttlSeconds: -10 }); // Already expired
    const expiredLease = expiredIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId,
      scopes: ['capability:device:query'],
    });

    const validation = await leaseBoundary.validateLease(
      expiredLease,
      {
        principal: {
          type: PrincipalType.DEVICE,
          deviceId: agentId,
          tenantId,
          scopes: ['capability:device:query'],
        },
        tenantId,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        rawTokenHash: 'hash',
      },
      'capability:device:query',
    );

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.reason?.toLowerCase().includes('expired'));
  });

  it('Scenario 5: Tampered lease signature rejected at execution boundary with INVALID_SIGNATURE', async () => {
    const validLease = leaseIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId,
      scopes: ['capability:device:query'],
    });

    // Tamper with lease signature
    const tamperedLease = { ...validLease, signature: 'corrupted-signature-00000000000000' };

    const validation = await leaseBoundary.validateLease(
      tamperedLease,
      {
        principal: {
          type: PrincipalType.DEVICE,
          deviceId: agentId,
          tenantId,
          scopes: ['capability:device:query'],
        },
        tenantId,
        issuedAt: new Date().toISOString(),
        expiresAt: validLease.expires_at,
        rawTokenHash: 'hash',
      },
      'capability:device:query',
    );

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.reason?.includes('INVALID_LEASE_SIGNATURE'));
  });

  it('Scenario 6: Scope escalation outside lease rejected with SCOPE_NOT_GRANTED', async () => {
    const restrictedLease = leaseIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId,
      scopes: ['capability:device:query'],
    });

    // Attempt to validate for ungranted scope 'capability:device:admin'
    const validation = await leaseBoundary.validateLease(
      restrictedLease,
      {
        principal: {
          type: PrincipalType.DEVICE,
          deviceId: agentId,
          tenantId,
          scopes: ['capability:device:query'],
        },
        tenantId,
        issuedAt: new Date().toISOString(),
        expiresAt: restrictedLease.expires_at,
        rawTokenHash: 'hash',
      },
      'capability:device:admin',
    );

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.reason?.includes('SCOPE_NOT_GRANTED'));
  });

  it('Scenario 7: Tenant mismatch between lease and subject rejected with TENANT_MISMATCH', async () => {
    const foreignTenantId = crypto.randomUUID();
    const lease = leaseIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId: foreignTenantId,
      scopes: ['capability:device:query'],
    });

    // Context has local tenantId, lease has foreignTenantId
    const validation = await leaseBoundary.validateLease(
      lease,
      {
        principal: {
          type: PrincipalType.DEVICE,
          deviceId: agentId,
          tenantId,
          scopes: ['capability:device:query'],
        },
        tenantId,
        issuedAt: new Date().toISOString(),
        expiresAt: lease.expires_at,
        rawTokenHash: 'hash',
      },
      'capability:device:query',
    );

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.reason?.includes('TENANT_MISMATCH'));
  });

  it('Scenario 8: Forged receipt signature rejected with INVALID_RECEIPT_SIGNATURE', async () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const output = { query: 'result' };
    const evidenceChecksum = computeEvidenceHash(output);

    const receipt: ExecutionReceipt = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId,
      status: 'SUCCESS',
      exitCode: 0,
      evidenceChecksum,
      output,
      completedAt: new Date().toISOString(),
      signature: 'forged-invalid-hmac-signature',
    };

    const verification = receiptVerifier.verify(receipt, {
      expectedTaskId: taskId,
      expectedLeaseId: leaseId,
      expectedAgentId: agentId,
      expectedTenantId: tenantId,
    });

    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.errorCode, 'INVALID_RECEIPT_SIGNATURE');
  });

  it('Scenario 9: Evidence hash mismatch rejected with EVIDENCE_HASH_MISMATCH', async () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const originalOutput = { query: 'original' };
    const tamperedOutput = { query: 'tampered-data-after-execution' };
    const evidenceChecksum = computeEvidenceHash(originalOutput);

    const unsignedReceipt: Omit<ExecutionReceipt, 'signature'> = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId,
      status: 'SUCCESS',
      exitCode: 0,
      evidenceChecksum,
      output: tamperedOutput, // tampered output does not match evidenceChecksum!
      completedAt: new Date().toISOString(),
    };

    const signature = computeReceiptSignature(unsignedReceipt, agentSecret);
    const receipt: ExecutionReceipt = { ...unsignedReceipt, signature };

    const verification = receiptVerifier.verify(receipt, {
      expectedTaskId: taskId,
      expectedLeaseId: leaseId,
      expectedAgentId: agentId,
      expectedTenantId: tenantId,
    });

    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.errorCode, 'EVIDENCE_HASH_MISMATCH');
  });

  it('Scenario 10: Late receipt settlement on a CANCELLED task rejected', async () => {
    const context: AuthenticatedContext = {
      principal: {
        type: PrincipalType.USER,
        userId,
        tenantId,
        roles: ['operator'],
      },
      tenantId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rawTokenHash: 'hash',
    };

    const createResult = await taskController.createTask(
      {
        title: 'Task To Be Cancelled',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'capability:device:query',
      },
      context,
    );

    const taskId = createResult.task.taskId;
    const leaseId = createResult.task.lease!.lease_id;

    // Cancel task before receipt arrives
    const cancelledTask = await taskController.cancelTask(taskId, 'User abort', context);
    assert.strictEqual(cancelledTask.state, TaskLifecycleState.CANCELLED);

    // Agent attempts to settle receipt late
    const output = { status: 'done' };
    const unsignedReceipt: Omit<ExecutionReceipt, 'signature'> = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId,
      status: 'SUCCESS',
      exitCode: 0,
      evidenceChecksum: computeEvidenceHash(output),
      output,
      completedAt: new Date().toISOString(),
    };
    const signature = computeReceiptSignature(unsignedReceipt, agentSecret);
    const lateReceipt: ExecutionReceipt = { ...unsignedReceipt, signature };

    await assert.rejects(
      async () => {
        await taskController.settleReceipt(lateReceipt);
      },
      {
        message: `Cannot settle receipt for task '${taskId}': task is already CANCELLED.`,
      },
    );

    // Verify task state remains CANCELLED and was not resurrected
    const freshRecord = taskController.getTask(taskId, context);
    assert.strictEqual(freshRecord?.state, TaskLifecycleState.CANCELLED);
  });
});
