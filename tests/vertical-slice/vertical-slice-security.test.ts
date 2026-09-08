import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { TaskLifecycleState, TaskRecord, ExecutionReceipt } from '@nexusos/contracts';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  TaskStateMachine,
  LeaseIssuer,
  ReceiptVerifier,
  computeEvidenceHash,
  computeReceiptSignature,
  verifyLeaseSignature,
  verifyReceiptSignature,
  InMemoryEventPublisherBoundary,
  Logger,
} from '@nexusos/backend';
import {
  ReferencePolicyEvaluator,
  loadPolicyConfig,
  PolicyAuditLogger,
  DecisionEvidence,
  PolicyEffect,
} from '@nexusos/policy';
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

class TestPolicyAuditLogger extends PolicyAuditLogger {
  public loggedDecisions: DecisionEvidence[] = [];

  constructor() {
    super(new Logger('error'));
  }

  override logDecision(evidence: DecisionEvidence): void {
    super.logDecision(evidence);
    this.loggedDecisions.push(evidence);
  }
}

describe('Task 047 — Milestone M6: Vertical Slice Security Invariants (047-SEC-01 to 047-SEC-12)', () => {
  let app: BackendApp;
  let baseUrl: string;
  let authToken: string;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let agentId: string;
  let leaseSecret: string;
  let agentSecret: string;
  let eventPublisher: InMemoryEventPublisherBoundary;
  let policyAuditLogger: TestPolicyAuditLogger;
  let taskController: TaskController;
  let policyEvaluator: ReferencePolicyEvaluator;
  let leaseIssuer: LeaseIssuer;
  let receiptVerifier: ReceiptVerifier;
  let leaseBoundary: ExecutionLeaseBoundary;
  let authContext: AuthenticatedContext;

  before(async () => {
    tenantId = crypto.randomUUID();
    otherTenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    agentId = crypto.randomUUID();
    leaseSecret = 'sec-invariants-lease-secret-32-chars-long!';
    agentSecret = 'sec-invariants-agent-secret-32-chars-long!';

    const identityConfig = loadIdentityConfig({
      JWT_ISSUER: 'https://auth.nexusos.local',
      JWT_AUDIENCE: 'https://api.nexusos.local',
    });
    const identityProvider = new TestIdentityProvider();
    authToken = 'valid-token-security-invariants';
    authContext = {
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
    };
    identityProvider.registerToken(authToken, authContext);

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
    policyAuditLogger = new TestPolicyAuditLogger();
    leaseBoundary = new ExecutionLeaseBoundary(policyEvaluator, leaseSecret);

    taskController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      policyAuditLogger,
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

  it('047-SEC-01: Authentication mandatory for intake — Anonymous requests strictly rejected', async () => {
    const intakePayload = {
      title: 'Anonymous Test',
      targetAgentId: agentId,
      capabilityId: 'device.queryInfo',
      runtimeCategory: 'DEVICE',
      parameters: {},
      requestedScope: 'capability:device:query',
    };

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intakePayload),
    });

    assert.strictEqual(res.status, 401);
  });

  it('047-SEC-02: Tenant isolation — Cross-tenant retrieval and execution strictly rejected', async () => {
    const intakeRes = await taskController.createTask(
      {
        title: 'Tenant Isolation Task',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'capability:device:query',
      },
      authContext,
    );

    const otherTenantContext: AuthenticatedContext = {
      ...authContext,
      tenantId: otherTenantId,
      principal: {
        ...authContext.principal,
        tenantId: otherTenantId,
      },
    };

    // Attempt retrieval from another tenant throws access denied
    assert.throws(
      () => taskController.getTask(intakeRes.task.taskId, otherTenantContext),
      /belongs to a different tenant/,
    );
  });

  it('047-SEC-03: Policy evaluation mandatory prior to lease issuance — Zero lease without PERMIT', async () => {
    const unprivilegedContext: AuthenticatedContext = {
      ...authContext,
      principal: {
        type: PrincipalType.USER,
        userId: crypto.randomUUID(),
        tenantId,
        roles: ['guest'], // Not an operator
      },
    };

    const result = await taskController.createTask(
      {
        title: 'Unauthorized Task',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'capability:device:query',
      },
      unprivilegedContext,
    );

    assert.strictEqual(result.policyAllowed, false);
    assert.strictEqual(result.task.state, TaskLifecycleState.FAILED);
    assert.strictEqual(result.task.lease, undefined);
  });

  it('047-SEC-04: Cryptographic lease integrity — HMAC-SHA256 signature verified over immutable attributes', () => {
    const lease = leaseIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId,
      scopes: ['capability:device:query'],
    });

    assert.ok(verifyLeaseSignature(lease, leaseSecret));

    // Tampering any attribute invalidates signature
    const tamperedTaskId = { ...lease, task_id: crypto.randomUUID() };
    assert.strictEqual(verifyLeaseSignature(tamperedTaskId, leaseSecret), false);

    const tamperedTenant = { ...lease, tenant_id: otherTenantId };
    assert.strictEqual(verifyLeaseSignature(tamperedTenant, leaseSecret), false);

    const tamperedScopes = { ...lease, scopes: ['capability:device:query', 'capability:admin'] };
    assert.strictEqual(verifyLeaseSignature(tamperedScopes, leaseSecret), false);
  });

  it('047-SEC-05: Lease lifetime bounded by strict TTL — Expired lease rejected', async () => {
    const expiredIssuer = new LeaseIssuer({ leaseSecret, ttlSeconds: -10 });
    const expiredLease = expiredIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId,
      scopes: ['capability:device:query'],
    });

    const validation = await leaseBoundary.validateLease(expiredLease);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.reason?.includes('LEASE_EXPIRED'));
  });

  it('047-SEC-06: Principle of least privilege — Execution outside granted lease scope rejected', async () => {
    const lease = leaseIssuer.issueLease({
      taskId: crypto.randomUUID(),
      agentId,
      tenantId,
      scopes: ['capability:device:query'],
    });

    const validation = await leaseBoundary.validateLease(
      lease,
      authContext,
      'capability:filesystem:write', // Not granted in lease!
    );

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.reason?.includes('SCOPE_NOT_GRANTED'));
  });

  it('047-SEC-07: Cryptographic receipt verification — Unsigned or forged receipts rejected', () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const output = { success: true };
    const evidenceChecksum = computeEvidenceHash(output);

    const unsignedReceipt: Omit<ExecutionReceipt, 'signature'> = {
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
    };

    const validSignature = computeReceiptSignature(unsignedReceipt, agentSecret);
    const validReceipt: ExecutionReceipt = { ...unsignedReceipt, signature: validSignature };

    assert.ok(verifyReceiptSignature(validReceipt, agentSecret));

    const invalidReceipt: ExecutionReceipt = {
      ...unsignedReceipt,
      signature: 'forged-signature-xxx',
    };
    assert.strictEqual(verifyReceiptSignature(invalidReceipt, agentSecret), false);
  });

  it('047-SEC-08: Evidence hash integrity — Output tampering detected via SHA-256 checksum mismatch', () => {
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const originalOutput = { verified: true };
    const tamperedOutput = { verified: false, backdoor: true };
    const evidenceChecksum = computeEvidenceHash(originalOutput);

    const unsignedReceipt: Omit<ExecutionReceipt, 'signature'> = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId,
      status: 'SUCCESS',
      exitCode: 0,
      evidenceChecksum, // Checksum of originalOutput
      output: tamperedOutput, // Tampered output!
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

  it('047-SEC-09: Monotonic lifecycle state machine — Terminal states cannot transition further', () => {
    let task: TaskRecord = {
      taskId: crypto.randomUUID(),
      title: 'State Machine Test',
      targetAgentId: agentId,
      capabilityId: 'device.queryInfo',
      runtimeCategory: 'DEVICE',
      parameters: {},
      requestedScope: 'capability:device:query',
      tenantId,
      submittedBy: userId,
      state: TaskLifecycleState.SUBMITTED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    task = TaskStateMachine.transition(task, TaskLifecycleState.POLICY_EVALUATED);
    task = TaskStateMachine.transition(task, TaskLifecycleState.LEASED);
    task = TaskStateMachine.transition(task, TaskLifecycleState.DISPATCHED);
    task = TaskStateMachine.transition(task, TaskLifecycleState.EXECUTING);
    task = TaskStateMachine.transition(task, TaskLifecycleState.RECEIPT_VERIFIED);
    task = TaskStateMachine.transition(task, TaskLifecycleState.COMPLETED);

    // COMPLETED is terminal: cannot transition to any other state
    assert.throws(() => {
      TaskStateMachine.transition(task, TaskLifecycleState.EXECUTING);
    }, /Illegal task state transition/);

    assert.throws(() => {
      TaskStateMachine.transition(task, TaskLifecycleState.CANCELLED);
    }, /Illegal task state transition/);

    assert.throws(() => {
      TaskStateMachine.transition(task, TaskLifecycleState.FAILED);
    }, /Illegal task state transition/);
  });

  it('047-SEC-10: Cancelled task receipt immunity — Late receipts cannot resurrect CANCELLED task', async () => {
    const createResult = await taskController.createTask(
      {
        title: 'Late Receipt Task',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'capability:device:query',
      },
      authContext,
    );

    const taskId = createResult.task.taskId;
    const leaseId = createResult.task.lease!.lease_id;

    await taskController.cancelTask(taskId, 'Cancellation test', authContext);

    const output = { ok: true };
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
    const receipt: ExecutionReceipt = { ...unsignedReceipt, signature };

    await assert.rejects(async () => {
      await taskController.settleReceipt(receipt);
    }, /task is already CANCELLED/);

    const task = taskController.getTask(taskId, authContext);
    assert.strictEqual(task?.state, TaskLifecycleState.CANCELLED);
  });

  it('047-SEC-11: Sensitive parameter sanitization — Secrets and tokens redacted from stored task record', async () => {
    const intakeResult = await taskController.createTask(
      {
        title: 'Sensitive Task',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {
          apiKey: 'super-secret-api-key-12345',
          password: 'my-plaintext-password',
          authToken: 'Bearer secret-jwt-payload',
          nested: {
            secretData: 'confidential-value',
            publicInfo: 'public-value',
          },
        },
        requestedScope: 'capability:device:query',
      },
      authContext,
    );

    const params = intakeResult.task.parameters as Record<string, unknown>;
    assert.strictEqual(params.apiKey, '[REDACTED]');
    assert.strictEqual(params.password, '[REDACTED]');
    assert.strictEqual(params.authToken, '[REDACTED]');
    const nested = params.nested as Record<string, unknown>;
    assert.strictEqual(nested.secretData, '[REDACTED]');
    assert.strictEqual(nested.publicInfo, 'public-value');
  });

  it('047-SEC-12: Full audit trail observability — Decision evidence logged and lifecycle events emitted', async () => {
    assert.ok(policyAuditLogger.loggedDecisions.length > 0);
    const lastDecision =
      policyAuditLogger.loggedDecisions[policyAuditLogger.loggedDecisions.length - 1];
    assert.ok(lastDecision.decisionId);
    assert.ok(lastDecision.policyHash);
    assert.ok(lastDecision.timestamp);

    const events = eventPublisher.getPublishedEvents();
    assert.ok(events.length > 0);
    const schemas = events.map((e) => e.schema_id);
    assert.ok(schemas.includes('nexusos.events.task.created'));
    assert.ok(schemas.includes('nexusos.events.task.leased'));
  });
});
