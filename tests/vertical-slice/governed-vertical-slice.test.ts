import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  TaskLifecycleState,
  ExecutionReceipt,
  ExecutionLeaseHeader,
  createACPMessageEnvelope,
} from '@nexusos/contracts';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  computeEvidenceHash,
  computeReceiptSignature,
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
  DeviceRuntime,
  DeviceOperationName,
  AgentLifecycleState,
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

describe('Task 047 — Milestone M6: Governed Vertical Slice Canonical E2E Flow', () => {
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
  let deviceRuntime: DeviceRuntime;
  let leaseBoundary: ExecutionLeaseBoundary;
  let dispatchBridge: ACPDispatchBridge;

  before(async () => {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    agentId = crypto.randomUUID();
    leaseSecret = 'test-governed-lease-hmac-secret-32-bytes!';
    agentSecret = 'test-governed-agent-hmac-secret-32-bytes!';

    // 1. Setup Identity & Authenticator
    const identityConfig = loadIdentityConfig({
      JWT_ISSUER: 'https://auth.nexusos.local',
      JWT_AUDIENCE: 'https://api.nexusos.local',
    });
    const identityProvider = new TestIdentityProvider();
    authToken = 'valid-test-bearer-token-047';
    identityProvider.registerToken(authToken, {
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
    });

    const authenticator = createAuthenticationMiddleware(identityProvider, identityConfig);

    // 2. Setup Policy Evaluator with Governed Admin and Lease Rules
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
    const policyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig(), policyRules);

    // 3. Setup Lease Issuer & Receipt Verifier
    const leaseIssuer = new LeaseIssuer({ leaseSecret, ttlSeconds: 60 });
    const receiptVerifier = new ReceiptVerifier({ agentSecret });
    eventPublisher = new InMemoryEventPublisherBoundary();

    // 4. Setup Desktop Agent Execution Plane
    leaseBoundary = new ExecutionLeaseBoundary(policyEvaluator, leaseSecret);
    deviceRuntime = new DeviceRuntime(
      leaseBoundary,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => AgentLifecycleState.READY,
    );

    // 5. Setup ACP Dispatch Bridge
    dispatchBridge = new ACPDispatchBridge();

    // Desktop Agent ACP Frame Receiver Simulation
    dispatchBridge.setTargetAgent({
      receiveACPMessage: async (frame) => {
        const { task_id, leaseHeader } = frame.payload as {
          task_id: string;
          leaseHeader: ExecutionLeaseHeader;
        };

        // Desktop Agent validates lease at boundary
        const leaseValidation = await leaseBoundary.validateLease(
          leaseHeader,
          {
            principal: {
              type: PrincipalType.DEVICE,
              deviceId: agentId,
              tenantId,
              scopes: ['capability:device:query'],
            },
            tenantId,
            issuedAt: new Date().toISOString(),
            expiresAt: leaseHeader.expires_at,
            rawTokenHash: 'hash',
          },
          'capability:device:query',
        );

        if (!leaseValidation.valid) {
          throw new Error(`Desktop Agent rejected lease: ${leaseValidation.reason}`);
        }

        // Desktop Agent invokes DeviceRuntime
        const opResult = await deviceRuntime.execute({
          operationName: DeviceOperationName.DEVICE_QUERY_INFO,
          context: {
            taskId: task_id,
            workspaceId: 'workspace-default',
            tenantId,
            subjectId: agentId,
            correlationId: task_id,
            leaseHeader,
          },
        });

        // Desktop Agent produces and signs ExecutionReceipt
        const output = (opResult.data as Record<string, unknown>) ?? { query: 'success' };
        const evidenceChecksum = computeEvidenceHash(output);

        const unsignedReceipt: Omit<ExecutionReceipt, 'signature'> = {
          receiptId: crypto.randomUUID(),
          taskId: task_id,
          leaseId: leaseHeader.lease_id,
          agentId,
          tenantId,
          status: opResult.success ? 'SUCCESS' : 'FAILURE',
          exitCode: opResult.success ? 0 : 1,
          evidenceChecksum,
          output,
          completedAt: new Date().toISOString(),
        };

        const signature = computeReceiptSignature(unsignedReceipt, agentSecret);
        const receipt: ExecutionReceipt = { ...unsignedReceipt, signature };

        // Desktop Agent relays receipt back via ACP frame to DispatchBridge
        const receiptFrame = createACPMessageEnvelope(
          '1.0.0',
          agentId,
          'control-plane-backend',
          'schema:nexusos:acp:task:receipt:v1',
          task_id,
          receipt,
        );

        await dispatchBridge.handleIncomingFrame(receiptFrame);
      },
    });

    // 6. Setup Task Controller
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
    if (app) {
      await app.stop();
    }
  });

  it('executes complete governed vertical slice from HTTP intake to receipt verification', async () => {
    // Step 1: User / Task Intake via authenticated HTTP POST /v1/tasks
    const intakePayload = {
      title: 'Canonical Governed Vertical Slice Task',
      targetAgentId: agentId,
      capabilityId: 'device.queryInfo',
      runtimeCategory: 'DEVICE',
      parameters: { detailLevel: 'full' },
      requestedScope: 'capability:device:query',
    };

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
      task: { taskId: string; state: string };
      policyAllowed: boolean;
      denialReason?: string;
    };

    assert.strictEqual(intakeBody.policyAllowed, true);
    const taskId = intakeBody.task.taskId;
    assert.ok(taskId);

    // Step 2: Query task state after ACP dispatch and execution completion
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
      lease?: { lease_id: string; signature: string; scopes: string[] };
      receipt?: { receiptId: string; status: string; evidenceChecksum: string };
      evidenceChecksum?: string;
    };

    // Step 3: Verify Task State Progression reached COMPLETED
    assert.strictEqual(taskRecord.taskId, taskId);
    assert.strictEqual(taskRecord.tenantId, tenantId);
    assert.strictEqual(taskRecord.state, TaskLifecycleState.COMPLETED);

    // Step 4: Verify Lease was issued and securely bound
    assert.ok(taskRecord.lease);
    assert.ok(taskRecord.lease.signature);
    assert.deepStrictEqual(taskRecord.lease.scopes, ['capability:device:query']);

    // Step 5: Verify Execution Receipt was verified and bound
    assert.ok(taskRecord.receipt);
    assert.strictEqual(taskRecord.receipt.status, 'SUCCESS');
    assert.ok(taskRecord.receipt.evidenceChecksum);
    assert.strictEqual(taskRecord.evidenceChecksum, taskRecord.receipt.evidenceChecksum);

    // Step 6: Verify Inspectable Audit Events emitted
    const events = eventPublisher.getPublishedEvents();
    const eventTypes = events.map((e) => e.schema_id);

    assert.ok(eventTypes.includes('nexusos.events.task.created'));
    assert.ok(eventTypes.includes('nexusos.events.task.leased'));
    assert.ok(eventTypes.includes('nexusos.events.task.dispatched'));
    assert.ok(eventTypes.includes('nexusos.events.task.completed'));
  });
});
