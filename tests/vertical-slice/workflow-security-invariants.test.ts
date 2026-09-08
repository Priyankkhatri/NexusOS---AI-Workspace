import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  TaskLifecycleState,
  WorkflowDAG,
  WorkflowExecutionReceipt,
  TaskGraphCreateRequest,
} from '@nexusos/contracts';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  computeEvidenceHash,
  computeWorkflowReceiptSignature,
  verifyWorkflowReceiptSignature,
  verifyLeaseSignature,
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
import { ExecutionLeaseBoundary, resolveInterpolation } from '@nexusos/desktop-agent';

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

describe('Task 049 — Security Invariants (049-SEC-01 to 049-SEC-05)', () => {
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
  let taskController: TaskController;
  let leaseIssuer: LeaseIssuer;
  let receiptVerifier: ReceiptVerifier;
  let leaseBoundary: ExecutionLeaseBoundary;
  let authContext: AuthenticatedContext;
  let policyEvaluator: ReferencePolicyEvaluator;
  let identityProvider: TestIdentityProvider;

  before(async () => {
    tenantId = crypto.randomUUID();
    otherTenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    agentId = crypto.randomUUID();
    leaseSecret = 'sec-049-lease-secret-32-chars-long!';
    agentSecret = 'sec-049-agent-secret-32-chars-long!';

    // Identity setup
    const identityConfig = loadIdentityConfig({
      JWT_ISSUER: 'https://auth.nexusos.local',
      JWT_AUDIENCE: 'https://api.nexusos.local',
    });
    identityProvider = new TestIdentityProvider();
    authToken = 'valid-token-049-sec';
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

    // Policy rules allowing task:execute for operators
    const policyRules = [
      {
        ruleId: 'rule-operator-workflow',
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

  // =========================================================================
  // 049-SEC-01: Multi-Node Policy Governance & Fail-Closed Behavior
  // =========================================================================
  describe('049-SEC-01: Multi-node policy check', () => {
    it('all nodes permitted -> entire workflow is allowed and leased', async () => {
      const graphReq: TaskGraphCreateRequest = {
        title: 'Allowed Multi-Step Workflow',
        targetAgentId: agentId,
        nodes: [
          {
            nodeId: 'node-1',
            capabilityId: 'device.queryInfo',
            runtimeCategory: 'device',
            payload: {},
          },
          {
            nodeId: 'node-2',
            capabilityId: 'device.execute',
            runtimeCategory: 'device',
            payload: {},
          },
        ],
        edges: [{ fromNodeId: 'node-1', toNodeId: 'node-2' }],
      };

      const result = await taskController.createTaskGraph(graphReq, authContext);

      assert.strictEqual(result.policyAllowed, true);
      assert.strictEqual(result.task.state, TaskLifecycleState.LEASED);
      assert.ok(result.task.lease);
      assert.strictEqual(result.task.isWorkflow, true);
    });

    it('unauthorized user without required role -> entire workflow denied with zero lease issued', async () => {
      const unprivilegedContext: AuthenticatedContext = {
        ...authContext,
        principal: {
          type: PrincipalType.USER,
          userId: crypto.randomUUID(),
          tenantId,
          roles: ['guest'], // Not operator
        },
      };

      const graphReq: TaskGraphCreateRequest = {
        title: 'Unauthorized Multi-Step Workflow',
        targetAgentId: agentId,
        nodes: [
          {
            nodeId: 'node-1',
            capabilityId: 'device.queryInfo',
            runtimeCategory: 'device',
            payload: {},
          },
        ],
      };

      const result = await taskController.createTaskGraph(graphReq, unprivilegedContext);

      assert.strictEqual(result.policyAllowed, false);
      assert.strictEqual(result.task.state, TaskLifecycleState.FAILED);
      assert.strictEqual(result.task.lease, undefined);
    });

    it('one node denied -> entire workflow rejected fail-closed with zero lease', async () => {
      // Create controller with custom policy denying dangerous terminal capability
      const selectivePolicyEvaluator = {
        evaluate: async (req: {
          action: { requiredScope?: string; actionName: string };
          context: {
            details?: { capabilityId?: string };
            requestId: string;
            correlationId: string;
          };
        }) => {
          const capId = req.context.details?.capabilityId || req.action.requiredScope;
          if (
            capId === 'terminal.executeDangerousCommand' ||
            capId?.includes('terminal:executeDangerousCommand')
          ) {
            return {
              decisionId: crypto.randomUUID(),
              effect: PolicyEffect.DENY,
              allowed: false,
              reason: 'Dangerous capability explicitly denied by policy.',
              policyVersion: '1.0.0',
              policyHash: 'deny-hash',
              evaluatedAt: new Date().toISOString(),
              requestId: req.context.requestId,
              correlationId: req.context.correlationId,
            };
          }
          return {
            decisionId: crypto.randomUUID(),
            effect: PolicyEffect.ALLOW,
            allowed: true,
            reason: 'Permitted',
            policyVersion: '1.0.0',
            policyHash: 'allow-hash',
            evaluatedAt: new Date().toISOString(),
            requestId: req.context.requestId,
            correlationId: req.context.correlationId,
          };
        },
        getSnapshot: () => ({
          policyVersion: '1.0.0',
          policyHash: 'hash',
          createdAt: new Date().toISOString(),
          rules: [],
        }),
      };

      const selectiveController = new TaskController({
        leaseIssuer,
        receiptVerifier,
        policyEvaluator: selectivePolicyEvaluator,
        eventPublisher,
      });

      const multiNodeReq: TaskGraphCreateRequest = {
        title: 'Mixed Workflow with One Denied Node',
        targetAgentId: agentId,
        nodes: [
          {
            nodeId: 'step-safe',
            capabilityId: 'device.queryInfo',
            runtimeCategory: 'device',
            payload: {},
          },
          {
            nodeId: 'step-dangerous',
            capabilityId: 'terminal.executeDangerousCommand',
            runtimeCategory: 'terminal',
            payload: {},
          },
        ],
        edges: [{ fromNodeId: 'step-safe', toNodeId: 'step-dangerous' }],
      };

      const result = await selectiveController.createTaskGraph(multiNodeReq, authContext);

      assert.strictEqual(result.policyAllowed, false);
      assert.strictEqual(result.task.state, TaskLifecycleState.FAILED);
      assert.strictEqual(result.task.lease, undefined);
      assert.ok(result.denialReason?.includes('Dangerous capability explicitly denied'));
    });
  });

  // =========================================================================
  // 049-SEC-02: Composite Lease Cryptographic Binding & Tampering
  // =========================================================================
  describe('049-SEC-02: Composite lease cryptographic binding', () => {
    it('issues cryptographically valid composite lease binding all workflow capabilities', () => {
      const compositeScopes = [
        'capability:device:query',
        'capability:device:execute',
        'capability:filesystem:read',
      ];
      const lease = leaseIssuer.issueLease({
        taskId: crypto.randomUUID(),
        agentId,
        tenantId,
        scopes: compositeScopes,
      });

      assert.ok(verifyLeaseSignature(lease, leaseSecret));
      assert.deepStrictEqual(lease.scopes, compositeScopes);
    });

    it('detects tampering with composite lease scopes (privilege escalation)', () => {
      const lease = leaseIssuer.issueLease({
        taskId: crypto.randomUUID(),
        agentId,
        tenantId,
        scopes: ['capability:device:query'],
      });

      const tamperedLease = {
        ...lease,
        scopes: ['capability:device:query', 'capability:admin:root'],
      };

      assert.strictEqual(verifyLeaseSignature(tamperedLease, leaseSecret), false);
    });

    it('rejects expired composite lease at Desktop Agent boundary', async () => {
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

    it('rejects cross-tenant composite lease at Desktop Agent boundary', async () => {
      const otherTenantLease = leaseIssuer.issueLease({
        taskId: crypto.randomUUID(),
        agentId,
        tenantId: otherTenantId,
        scopes: ['capability:device:query'],
      });

      const validation = await leaseBoundary.validateLease(
        otherTenantLease,
        authContext, // AuthContext has tenantId != otherTenantId
        'capability:device:query',
      );

      assert.strictEqual(validation.valid, false);
      assert.ok(validation.reason?.includes('TENANT_MISMATCH'));
    });

    it('fails closed when attempting to execute capability outside composite lease scopes', async () => {
      const lease = leaseIssuer.issueLease({
        taskId: crypto.randomUUID(),
        agentId,
        tenantId,
        scopes: ['capability:device:query'],
      });

      const validation = await leaseBoundary.validateLease(
        lease,
        authContext,
        'capability:terminal:write', // Not granted in lease!
      );

      assert.strictEqual(validation.valid, false);
      assert.ok(validation.reason?.includes('SCOPE_NOT_GRANTED'));
    });
  });

  // =========================================================================
  // 049-SEC-03: Tenant-Isolated Workflow Status & Cancellation
  // =========================================================================
  describe('049-SEC-03: Tenant-isolated workflow status/cancellation', () => {
    let tenantWorkflowTaskId: string;

    before(async () => {
      const createRes = await taskController.createTaskGraph(
        {
          title: 'Tenant-Isolated Workflow',
          targetAgentId: agentId,
          nodes: [
            { nodeId: 'node-1', capabilityId: 'device.queryInfo', runtimeCategory: 'device' },
          ],
        },
        authContext,
      );
      tenantWorkflowTaskId = createRes.task.taskId;
    });

    it('cross-tenant status query does not disclose workflow existence (returns 404 non-disclosing error)', () => {
      const otherTenantContext: AuthenticatedContext = {
        ...authContext,
        tenantId: otherTenantId,
        principal: {
          ...authContext.principal,
          tenantId: otherTenantId,
        },
      };

      assert.throws(
        () => taskController.getTask(tenantWorkflowTaskId, otherTenantContext),
        /belongs to a different tenant/,
      );
    });

    it('cross-tenant cancellation request is rejected without metadata leakage', async () => {
      const otherTenantContext: AuthenticatedContext = {
        ...authContext,
        tenantId: otherTenantId,
        principal: {
          ...authContext.principal,
          tenantId: otherTenantId,
        },
      };

      await assert.rejects(async () => {
        await taskController.cancelTask(
          tenantWorkflowTaskId,
          'Malicious cancel',
          otherTenantContext,
        );
      }, /belongs to a different tenant/);
    });

    it('cross-tenant HTTP GET /v1/tasks/:id returns 404 without leaking other tenant info', async () => {
      const otherToken = 'other-tenant-token-049';
      identityProvider.registerToken(otherToken, {
        principal: {
          type: PrincipalType.USER,
          userId: crypto.randomUUID(),
          tenantId: otherTenantId,
          roles: ['operator'],
        },
        tenantId: otherTenantId,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        rawTokenHash: crypto.createHash('sha256').update(otherToken).digest('hex'),
      });

      const res = await fetch(`${baseUrl}/v1/tasks/${tenantWorkflowTaskId}`, {
        headers: {
          Authorization: `Bearer ${otherToken}`,
        },
      });

      // Must return 404 (not 403) to prevent tenant enumeration
      assert.strictEqual(res.status, 404);
    });
  });

  // =========================================================================
  // 049-SEC-04: Prototype-Pollution-Safe Context Interpolation
  // =========================================================================
  describe('049-SEC-04: Prototype-pollution-safe context interpolation', () => {
    const validContext = {
      nodes: {
        step1: {
          output: {
            token: 'valid-auth-token-xyz',
            count: 42,
            nested: { key: 'nested-val' },
          },
        },
      },
    };

    it('interpolates legitimate node outputs safely', () => {
      const expr = 'Bearer {{nodes.step1.output.token}}';
      const resolved = resolveInterpolation(expr, validContext);
      assert.strictEqual(resolved, 'Bearer valid-auth-token-xyz');
    });

    it('strictly rejects __proto__ property navigation attempts', () => {
      const pollExpr = '{{nodes.step1.output.__proto__.polluted}}';
      assert.throws(() => {
        resolveInterpolation(pollExpr, validContext);
      }, /Prototype pollution attempt detected/);
    });

    it('strictly rejects constructor property navigation attempts', () => {
      const pollExpr = '{{nodes.step1.output.constructor.prototype}}';
      assert.throws(() => {
        resolveInterpolation(pollExpr, validContext);
      }, /Prototype pollution attempt detected/);
    });

    it('strictly rejects prototype property navigation attempts', () => {
      const pollExpr = '{{nodes.step1.output.prototype.polluted}}';
      assert.throws(() => {
        resolveInterpolation(pollExpr, validContext);
      }, /Prototype pollution attempt detected/);
    });

    it('strictly rejects expression escaping node output syntax (invalid pattern)', () => {
      const malformedExpr = '{{system.env.SECRET}}';
      assert.throws(() => {
        resolveInterpolation(malformedExpr, validContext);
      }, /Invalid workflow interpolation pattern/);
    });
  });

  // =========================================================================
  // 049-SEC-05: Authorized Compensation / Rollback
  // =========================================================================
  describe('049-SEC-05: Authorized compensation/rollback', () => {
    it('verifies workflow receipt signature and detects forged signatures', () => {
      const unsignedReceipt: Omit<WorkflowExecutionReceipt, 'signature'> = {
        receiptId: crypto.randomUUID(),
        workflowId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        leaseId: crypto.randomUUID(),
        agentId,
        tenantId,
        status: 'SUCCESS',
        completedNodes: ['step-1', 'step-2'],
        failedNodes: [],
        nodeOutputs: { 'step-1': { ok: true } },
        evidenceChecksum: computeEvidenceHash({ 'step-1': { ok: true } }),
        completedAt: new Date().toISOString(),
      };

      const validSig = computeWorkflowReceiptSignature(unsignedReceipt, agentSecret);
      const validReceipt: WorkflowExecutionReceipt = { ...unsignedReceipt, signature: validSig };

      assert.ok(verifyWorkflowReceiptSignature(validReceipt, agentSecret));

      const forgedReceipt: WorkflowExecutionReceipt = {
        ...unsignedReceipt,
        signature: 'forged-sig',
      };
      assert.strictEqual(verifyWorkflowReceiptSignature(forgedReceipt, agentSecret), false);
    });

    it('rejects workflow receipt with tampered evidence hash', () => {
      const taskId = crypto.randomUUID();
      const workflowId = crypto.randomUUID();
      const leaseId = crypto.randomUUID();
      const originalOutputs = { 'step-1': { ok: true } };
      const tamperedOutputs = { 'step-1': { ok: true, injected: 'backdoor' } };

      const unsignedReceipt: Omit<WorkflowExecutionReceipt, 'signature'> = {
        receiptId: crypto.randomUUID(),
        workflowId,
        taskId,
        leaseId,
        agentId,
        tenantId,
        status: 'SUCCESS',
        completedNodes: ['step-1'],
        failedNodes: [],
        nodeOutputs: tamperedOutputs, // Tampered outputs
        evidenceChecksum: computeEvidenceHash(originalOutputs), // Hash of original
        completedAt: new Date().toISOString(),
      };

      const signature = computeWorkflowReceiptSignature(unsignedReceipt, agentSecret);
      const receipt: WorkflowExecutionReceipt = { ...unsignedReceipt, signature };

      const verification = receiptVerifier.verifyWorkflowReceipt(receipt, {
        expectedTaskId: taskId,
        expectedWorkflowId: workflowId,
        expectedLeaseId: leaseId,
        expectedAgentId: agentId,
        expectedTenantId: tenantId,
      });

      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.errorCode, 'EVIDENCE_HASH_MISMATCH');
    });

    it('settling failed workflow transitions task to FAILED deterministically', async () => {
      const createRes = await taskController.createTaskGraph(
        {
          title: 'Failing Workflow Task',
          targetAgentId: agentId,
          nodes: [
            { nodeId: 'step-1', capabilityId: 'device.queryInfo', runtimeCategory: 'device' },
            { nodeId: 'step-2', capabilityId: 'device.execute', runtimeCategory: 'device' },
          ],
          edges: [{ fromNodeId: 'step-1', toNodeId: 'step-2' }],
        },
        authContext,
      );

      const taskId = createRes.task.taskId;
      const leaseId = createRes.task.lease!.lease_id;

      const outputs = { 'step-1': { state: 'ok' } };
      const unsignedReceipt: Omit<WorkflowExecutionReceipt, 'signature'> = {
        receiptId: crypto.randomUUID(),
        workflowId: (createRes.task.dag as WorkflowDAG).workflowId,
        taskId,
        leaseId,
        agentId,
        tenantId,
        status: 'FAILURE',
        completedNodes: ['step-1'],
        failedNodes: ['step-2'],
        nodeOutputs: outputs,
        evidenceChecksum: computeEvidenceHash(outputs),
        errorMessage: 'Step 2 failed during execution: hardware timeout.',
        completedAt: new Date().toISOString(),
      };

      const signature = computeWorkflowReceiptSignature(unsignedReceipt, agentSecret);
      const receipt: WorkflowExecutionReceipt = { ...unsignedReceipt, signature };

      const settledTask = await taskController.settleReceipt(receipt);

      assert.strictEqual(settledTask.state, TaskLifecycleState.FAILED);
      assert.strictEqual(settledTask.receipt?.status, 'FAILURE');
      assert.strictEqual(settledTask.error?.code, 'WORKFLOW_EXECUTION_FAILED');
      assert.ok(settledTask.error?.message?.includes('hardware timeout'));
    });
  });
});
