import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  TaskLifecycleState,
  createACPMessageEnvelope,
  WorkflowDAG,
  WorkflowExecutionReceipt,
} from '@nexusos/contracts';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  computeEvidenceHash,
  computeWorkflowReceiptSignature,
  ACPDispatchBridge,
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
import {
  ExecutionLeaseBoundary,
  WorkflowEngine,
  AgentLifecycleState,
  AgentOrchestrator,
  RuntimeRouter,
  CapabilityRegistry,
  RuntimeRegistry,
  RedactionFilter,
  MockTransportAdapter,
  ProductionControlPlaneClient,
  ControlPlaneConfig,
  TaskScheduler,
} from '@nexusos/desktop-agent';

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

describe('Task 049 — Governed Workflow Graph Canonical E2E Flow', () => {
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
  let dispatchBridge: ACPDispatchBridge;
  let workflowEngine: WorkflowEngine;
  let authContext: AuthenticatedContext;
  let leaseIssuer: LeaseIssuer;
  let receiptVerifier: ReceiptVerifier;
  let policyEvaluator: ReferencePolicyEvaluator;

  before(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    agentId = crypto.randomUUID();
    leaseSecret = 'test-workflow-lease-hmac-secret-32b!';
    agentSecret = 'test-workflow-agent-hmac-secret-32b!';

    // 1. Identity & Authenticator setup
    const identityConfig = loadIdentityConfig({
      JWT_ISSUER: 'https://auth.nexusos.local',
      JWT_AUDIENCE: 'https://api.nexusos.local',
    });
    const identityProvider = new TestIdentityProvider();
    authToken = 'valid-test-bearer-token-049';
    authContext = {
      principal: {
        type: PrincipalType.USER,
        userId,
        tenantId,
        roles: ['admin', 'operator'],
      },
      tenantId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rawTokenHash: crypto.createHash('sha256').update(authToken).digest('hex'),
    };
    identityProvider.registerToken(authToken, authContext);
    const authenticator = createAuthenticationMiddleware(identityProvider, identityConfig);

    // 2. Policy Evaluator with multi-node rules
    const policyRules = [
      {
        ruleId: 'rule-device-query',
        actionName: 'lease:execute',
        resourceType: 'agent-execution-plane',
        effect: PolicyEffect.ALLOW,
        requiredScope: 'capability:device:query',
      },
      {
        ruleId: 'rule-device-execute',
        actionName: 'lease:execute',
        resourceType: 'agent-execution-plane',
        effect: PolicyEffect.ALLOW,
        requiredScope: 'capability:device:execute',
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

    // 3. Lease Issuer & Receipt Verifier
    leaseIssuer = new LeaseIssuer({ leaseSecret, ttlSeconds: 60 });
    receiptVerifier = new ReceiptVerifier({ agentSecret });
    eventPublisher = new InMemoryEventPublisherBoundary();

    // 4. Desktop Agent Execution Plane with WorkflowEngine
    const agentLeaseBoundary = new ExecutionLeaseBoundary(policyEvaluator, leaseSecret);
    const capabilityRegistry = new CapabilityRegistry();
    const runtimeRegistry = new RuntimeRegistry();
    const runtimeRouter = new RuntimeRouter(capabilityRegistry, runtimeRegistry);

    const agentIdentity = {
      deviceId: agentId,
      deviceFingerprint: 'wf-agent-fp',
      pairedTenantId: tenantId,
      agentVersion: '0.1.0-sprint0',
      enrolledAt: new Date().toISOString(),
    };
    const desktopIdentityProvider = {
      getIdentity: async () => agentIdentity,
      verifyHardwareAttestation: async () => ({
        status: 0 as never,
        reason: 'test',
      }),
    };

    const mockConfig: ControlPlaneConfig = {
      gatewayUrl: 'wss://gateway.nexusos.internal/v1/stream',
      heartbeatIntervalMs: 60000,
      idleTimeoutMs: 180000,
      maxFrameSizeBytes: 1024 * 1024,
      maxSpoolSizeBytes: 50 * 1024 * 1024,
      reconnectInitialDelayMs: 100,
      reconnectMaxDelayMs: 1000,
      reconnectMultiplier: 2.0,
    };
    const mockTransport = new MockTransportAdapter();
    const controlPlaneClient = new ProductionControlPlaneClient(
      mockConfig,
      desktopIdentityProvider,
      agentLeaseBoundary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockTransport,
    );

    const orchestrator = new AgentOrchestrator(
      { agentVersion: '0.1.0-sprint0' } as never,
      desktopIdentityProvider,
      controlPlaneClient,
      agentLeaseBoundary,
      runtimeRouter,
      undefined,
      undefined,
      undefined,
      new RedactionFilter(),
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );

    const scheduler = new TaskScheduler(
      { agentVersion: '0.1.0-sprint0' } as never,
      desktopIdentityProvider,
      agentLeaseBoundary,
      orchestrator,
      undefined,
      undefined,
      new RedactionFilter(),
      undefined,
      () => AgentLifecycleState.READY,
    );

    workflowEngine = new WorkflowEngine(
      { agentVersion: '0.1.0-sprint0' } as never,
      desktopIdentityProvider,
      agentLeaseBoundary,
      orchestrator,
      scheduler,
      undefined,
      undefined,
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );

    // 5. ACP Dispatch Bridge
    dispatchBridge = new ACPDispatchBridge();

    // Wire ACP workflow execution to Desktop Agent
    dispatchBridge.setTargetAgent({
      receiveACPMessage: async (frame) => {
        try {
          const schemaId = frame.schema_id || (frame as unknown as { type?: string }).type;
          if (schemaId === 'schema:nexusos:acp:workflow:execute:v1') {
            const payload = frame.payload as {
              workflowId?: string;
              taskId?: string;
              workflow?: WorkflowDAG;
              dag?: WorkflowDAG;
            };
            const dag = payload.dag || payload.workflow;
            if (!dag) {
              throw new Error('Workflow DAG missing in execution payload');
            }

            // 1. Desktop Agent validates composite lease at boundary
            const requiredScopes = Array.from(
              new Set(
                dag.nodes.map((n) => `capability:${(n.capabilityId || '').replace(/\./g, ':')}`),
              ),
            );

            for (const scope of requiredScopes) {
              const leaseValidation = await agentLeaseBoundary.validateLease(
                dag.leaseHeader,
                {
                  principal: {
                    type: PrincipalType.DEVICE,
                    deviceId: agentId,
                    tenantId,
                    scopes: requiredScopes,
                  },
                  tenantId,
                  issuedAt: new Date().toISOString(),
                  expiresAt: dag.leaseHeader.expires_at,
                  rawTokenHash: 'hash',
                },
                scope,
              );

              if (!leaseValidation.valid) {
                throw new Error(
                  `Desktop Agent rejected composite lease: ${leaseValidation.reason}`,
                );
              }
            }

            // 2. Desktop Agent executes workflow through WorkflowEngine
            const engineResult = await workflowEngine.executeWorkflow(dag);

            // 3. Build & sign WorkflowExecutionReceipt
            const nodeOutputs: Record<string, Record<string, unknown>> = {};
            const completedNodes: string[] = [];
            const failedNodes: string[] = [];

            for (const node of dag.nodes) {
              if (engineResult.success) {
                completedNodes.push(node.nodeId);
                nodeOutputs[node.nodeId] = {
                  status: 'executed',
                  capability: node.capabilityId,
                  outputData: `result-from-${node.nodeId}`,
                };
              } else {
                failedNodes.push(node.nodeId);
              }
            }

            const evidenceChecksum = computeEvidenceHash(nodeOutputs);
            const unsignedReceipt: Omit<WorkflowExecutionReceipt, 'signature'> = {
              receiptId: crypto.randomUUID(),
              workflowId: dag.workflowId,
              taskId: dag.taskId,
              leaseId: dag.leaseHeader.lease_id,
              agentId,
              tenantId,
              status: engineResult.success ? 'SUCCESS' : 'FAILURE',
              completedNodes,
              failedNodes,
              nodeOutputs,
              evidenceChecksum,
              completedAt: new Date().toISOString(),
            };

            const signature = computeWorkflowReceiptSignature(unsignedReceipt, agentSecret);
            const receipt: WorkflowExecutionReceipt = { ...unsignedReceipt, signature };

            // 4. Send receipt frame back across ACP boundary
            const receiptFrame = createACPMessageEnvelope(
              '1.0.0',
              agentId,
              'control-plane-backend',
              'schema:nexusos:acp:task:receipt:v1',
              dag.taskId,
              receipt,
            );
            await dispatchBridge.handleIncomingFrame(receiptFrame);
          }
        } catch (err) {
          console.error('RECEIVE ERROR:', err);
        }
      },
    });

    // 6. Setup TaskController
    taskController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      eventPublisher,
      acpBridge: dispatchBridge,
    });

    // 7. Setup Backend HTTP App
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
    if (workflowEngine) {
      workflowEngine.shutdown();
    }
    if (app) {
      await app.stop();
    }
  });

  it('executes full governed multi-node DAG workflow from HTTP intake to receipt settlement', async () => {
    const intakePayload = {
      title: 'Governed Multi-Node DAG Workflow Task',
      targetAgentId: agentId,
      nodes: [
        {
          nodeId: 'step-1',
          capabilityId: 'device.queryInfo',
          runtimeCategory: 'device',
          name: 'Query Device State',
        },
        {
          nodeId: 'step-2',
          capabilityId: 'device.execute',
          runtimeCategory: 'device',
          name: 'Execute Device Action',
          dependencies: ['step-1'],
        },
      ],
      edges: [{ fromNodeId: 'step-1', toNodeId: 'step-2' }],
    };

    // 1. Submit DAG via HTTP POST /v1/tasks
    const intakeRes = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(intakePayload),
    });

    assert.strictEqual(intakeRes.status, 201);
    const intakeBody = (await intakeRes.json()) as {
      task: { taskId: string; state: string; isWorkflow?: boolean };
      policyAllowed: boolean;
    };

    assert.strictEqual(intakeBody.policyAllowed, true);
    assert.strictEqual(intakeBody.task.isWorkflow, true);
    const taskId = intakeBody.task.taskId;
    assert.ok(taskId);

    // 2. Query task state
    const queryRes = await fetch(`${baseUrl}/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    assert.strictEqual(queryRes.status, 200);
    const taskRecord = (await queryRes.json()) as {
      taskId: string;
      state: string;
      tenantId: string;
      isWorkflow?: boolean;
      lease?: { lease_id: string; signature: string; scopes: string[] };
      receipt?: {
        receiptId: string;
        status: string;
        evidenceChecksum: string;
        completedNodes: string[];
      };
      evidenceChecksum?: string;
    };

    // 3. Verify task settled to COMPLETED
    assert.strictEqual(taskRecord.taskId, taskId);
    assert.strictEqual(taskRecord.tenantId, tenantId);
    assert.strictEqual(taskRecord.state, TaskLifecycleState.COMPLETED);
    assert.strictEqual(taskRecord.isWorkflow, true);

    // 4. Verify composite lease bounds all required capabilities
    assert.ok(taskRecord.lease);
    assert.ok(taskRecord.lease.signature);
    assert.ok(
      taskRecord.lease.scopes.includes('capability:device:queryInfo') ||
        taskRecord.lease.scopes.includes('device.queryInfo'),
    );
    assert.ok(
      taskRecord.lease.scopes.includes('capability:device:execute') ||
        taskRecord.lease.scopes.includes('device.execute'),
    );

    // 5. Verify workflow receipt was validated and bound
    assert.ok(taskRecord.receipt);
    assert.strictEqual(taskRecord.receipt.status, 'SUCCESS');
    assert.deepStrictEqual(taskRecord.receipt.completedNodes, ['step-1', 'step-2']);
    assert.strictEqual(taskRecord.evidenceChecksum, taskRecord.receipt.evidenceChecksum);

    // 6. Verify audit trail events
    const events = eventPublisher.getPublishedEvents();
    const eventTypes = events.map((e) => e.schema_id);
    assert.ok(eventTypes.includes('nexusos.events.task.created'));
    assert.ok(eventTypes.includes('nexusos.events.task.leased'));
    assert.ok(eventTypes.includes('nexusos.events.task.dispatched'));
    assert.ok(eventTypes.includes('nexusos.events.task.completed'));
  });

  it('rejects malformed DAG topology at HTTP intake', async () => {
    const invalidDag = {
      title: 'Cyclic DAG Task',
      targetAgentId: agentId,
      nodes: [
        { nodeId: 'A', capabilityId: 'device.queryInfo', runtimeCategory: 'device' },
        { nodeId: 'B', capabilityId: 'device.execute', runtimeCategory: 'device' },
      ],
      edges: [
        { fromNodeId: 'A', toNodeId: 'B' },
        { fromNodeId: 'B', toNodeId: 'A' },
      ],
    };

    const res = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(invalidDag),
    });

    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: { message: string } };
    assert.ok(
      body.error.message.includes('cycle') ||
        body.error.message.includes('topology') ||
        body.error.message.includes('Circular'),
    );
  });

  it('handles mid-workflow failure by settling to FAILED and preserving completed node evidence', async () => {
    const manualController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      eventPublisher,
    });

    const intakePayload = {
      title: 'Failing DAG Workflow Task',
      targetAgentId: agentId,
      nodes: [
        {
          nodeId: 'step-ok',
          capabilityId: 'device.queryInfo',
          runtimeCategory: 'device',
        },
        {
          nodeId: 'step-fail',
          capabilityId: 'device.execute',
          runtimeCategory: 'device',
          dependencies: ['step-ok'],
        },
      ],
      edges: [{ fromNodeId: 'step-ok', toNodeId: 'step-fail' }],
    };

    const intakeRes = await manualController.createTaskGraph(intakePayload, authContext);
    assert.strictEqual(intakeRes.policyAllowed, true);
    const taskId = intakeRes.task.taskId;
    const leaseId = intakeRes.task.lease!.lease_id;

    // Simulate failure receipt: step-ok succeeded, step-fail failed
    const nodeOutputs = { 'step-ok': { result: 'ok-data' } };
    const evidenceChecksum = computeEvidenceHash(nodeOutputs);
    const unsignedReceipt: Omit<WorkflowExecutionReceipt, 'signature'> = {
      receiptId: crypto.randomUUID(),
      workflowId: (intakeRes.task.dag as WorkflowDAG).workflowId,
      taskId,
      leaseId,
      agentId,
      tenantId,
      status: 'FAILURE',
      completedNodes: ['step-ok'],
      failedNodes: ['step-fail'],
      nodeOutputs,
      evidenceChecksum,
      errorMessage: 'Step step-fail failed during execution.',
      completedAt: new Date().toISOString(),
    };

    const signature = computeWorkflowReceiptSignature(unsignedReceipt, agentSecret);
    const receipt: WorkflowExecutionReceipt = { ...unsignedReceipt, signature };

    const settled = await manualController.settleReceipt(receipt);
    assert.strictEqual(settled.state, TaskLifecycleState.FAILED);
    assert.strictEqual(settled.receipt?.status, 'FAILURE');
    assert.deepStrictEqual((settled.receipt as WorkflowExecutionReceipt).completedNodes, [
      'step-ok',
    ]);
    assert.deepStrictEqual((settled.receipt as WorkflowExecutionReceipt).failedNodes, [
      'step-fail',
    ]);
    assert.strictEqual(settled.error?.code, 'WORKFLOW_EXECUTION_FAILED');
  });

  it('supports variable interpolation from previous node output in workflow payload', async () => {
    const stepContext = {
      nodes: {
        step1: {
          output: {
            authHeader: 'Bearer token-12345',
            devicePort: 8080,
          },
        },
      },
    };

    const template =
      'Connecting with {{nodes.step1.output.authHeader}} to port {{nodes.step1.output.devicePort}}';
    const { resolveInterpolation } = await import('@nexusos/desktop-agent');
    const result = resolveInterpolation(template, stepContext);
    assert.strictEqual(result, 'Connecting with Bearer token-12345 to port 8080');
  });

  it('enforces monotonic lifecycle terminal state: completed workflow cannot be re-executed or resurrected', async () => {
    const manualController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      eventPublisher,
    });

    const intakePayload = {
      title: 'Monotonic Workflow Task',
      targetAgentId: agentId,
      nodes: [{ nodeId: 'node-1', capabilityId: 'device.queryInfo', runtimeCategory: 'device' }],
    };

    const intakeRes = await manualController.createTaskGraph(intakePayload, authContext);
    const taskId = intakeRes.task.taskId;
    const leaseId = intakeRes.task.lease!.lease_id;

    const outputs = { 'node-1': { query: 'done' } };
    const unsignedReceipt: Omit<WorkflowExecutionReceipt, 'signature'> = {
      receiptId: crypto.randomUUID(),
      workflowId: (intakeRes.task.dag as WorkflowDAG).workflowId,
      taskId,
      leaseId,
      agentId,
      tenantId,
      status: 'SUCCESS',
      completedNodes: ['node-1'],
      failedNodes: [],
      nodeOutputs: outputs,
      evidenceChecksum: computeEvidenceHash(outputs),
      completedAt: new Date().toISOString(),
    };
    const signature = computeWorkflowReceiptSignature(unsignedReceipt, agentSecret);
    const receipt: WorkflowExecutionReceipt = { ...unsignedReceipt, signature };

    const completed = await manualController.settleReceipt(receipt);
    assert.strictEqual(completed.state, TaskLifecycleState.COMPLETED);

    // Late / duplicate receipt rejected once in terminal state COMPLETED
    await assert.rejects(async () => {
      await manualController.settleReceipt(receipt);
    }, /Illegal task state transition/);
  });
});
