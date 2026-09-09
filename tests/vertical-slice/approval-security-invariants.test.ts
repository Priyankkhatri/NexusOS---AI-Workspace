import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeApprovalReceiptChecksum, ExecutionLeaseHeader } from '@nexusos/contracts';
import {
  AgentIdentityProvider,
  AgentLifecycleState,
  AgentOrchestrator,
  CapabilityRegistry,
  DesktopAgentConfig,
  DeviceRuntime,
  ExecutionLeaseBoundary,
  FilesystemRuntime,
  NativeApprovalHost,
  RuntimeCategory,
  RuntimeRegistry,
  RuntimeRouter,
  TaskScheduler,
  TerminalRuntime,
  TrayUIController,
  UIError,
  WorkflowDAG,
  WorkflowEngine,
} from '@nexusos/desktop-agent';

class AllowAllPolicyEvaluator {
  async evaluate(request: any): Promise<any> {
    return {
      decisionId: crypto.randomUUID(),
      effect: 'ALLOW' as const,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      reason: 'Allowed in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context?.requestId,
      correlationId: request.context?.correlationId,
    };
  }

  getSnapshot() {
    return {
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

class TestControlPlaneClient {
  public sentMessages: any[] = [];
  public relayedEvents: any[] = [];

  public async sendMessage(msg: any): Promise<void> {
    this.sentMessages.push(msg);
  }

  public async relayEvent(event: any): Promise<void> {
    this.relayedEvents.push(event);
  }

  public async sendHeartbeat(): Promise<void> {}
  public async receiveCommands(): Promise<any[]> {
    return [];
  }
}

class MockTelemetrySpool {
  public enqueuedEvents: any[] = [];

  public enqueueEventEnvelope(envelope: any): void {
    this.enqueuedEvents.push(envelope);
  }
}

describe('Task 052 — Human-in-the-Loop Desktop Approval Security Invariants (052-SEC-01 to 052-SEC-06)', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let identityProvider: AgentIdentityProvider;
  let controlPlaneClient: TestControlPlaneClient;
  let telemetrySpool: MockTelemetrySpool;
  let capabilityRegistry: CapabilityRegistry;
  let runtimeRegistry: RuntimeRegistry;
  let runtimeRouter: RuntimeRouter;
  let approvalHost: NativeApprovalHost;
  let trayController: TrayUIController;
  let orchestrator: AgentOrchestrator;

  const validTenantId = '11111111-1111-4111-8111-111111111111';
  const validTenantIdB = '22222222-2222-4222-8222-222222222222';
  const validDeviceId = '33333333-3333-4333-8333-333333333333';

  function createSignedLease(
    scopes: string[] = [
      'terminal.execute',
      'filesystem.read',
      'filesystem.deleteFile',
      'device.info',
    ],
    tenantId: string = validTenantId,
  ): ExecutionLeaseHeader {
    return {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      tenant_id: tenantId,
      agent_id: validDeviceId,
      issued_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 120000).toISOString(),
      scopes,
      signature: 'test-valid-sig',
      nonce: crypto.randomUUID(),
    };
  }

  beforeEach(() => {
    leaseBoundary = new ExecutionLeaseBoundary(new AllowAllPolicyEvaluator());
    identityProvider = {
      getIdentity: async () => ({
        deviceId: validDeviceId,
        deviceFingerprint: 'fp-test-123',
        pairedTenantId: validTenantId,
        agentVersion: '0.1.0-sprint0',
        enrolledAt: new Date().toISOString(),
      }),
      verifyHardwareAttestation: async () => ({
        status: 0 as any,
        reason: 'ok',
      }),
    };

    controlPlaneClient = new TestControlPlaneClient();
    telemetrySpool = new MockTelemetrySpool();
    capabilityRegistry = new CapabilityRegistry();
    runtimeRegistry = new RuntimeRegistry({
      allowExecutableRegistration: () => true,
    });

    // Register test capabilities
    capabilityRegistry.registerCapability({
      capabilityId: 'terminal.execute',
      category: 'runtime',
      description: 'Execute shell commands',
      isDangerous: true,
    });

    capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.deleteFile',
      category: 'runtime',
      description: 'Delete files on disk',
      isDangerous: true,
    });

    capabilityRegistry.registerCapability({
      capabilityId: 'filesystem.read',
      category: 'runtime',
      description: 'Read file content',
      isDangerous: false,
    });

    capabilityRegistry.registerCapability({
      capabilityId: 'device.info',
      category: 'device',
      description: 'Get device information',
      isDangerous: false,
    });

    // Register mock runtimes
    runtimeRegistry.registerRuntime({
      runtimeId: 'terminal',
      category: RuntimeCategory.TERMINAL,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: ['execute'],
    });

    runtimeRegistry.registerRuntime({
      runtimeId: 'filesystem',
      category: RuntimeCategory.FILESYSTEM,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: ['read', 'deleteFile'],
    });

    runtimeRegistry.registerRuntime({
      runtimeId: 'device',
      category: RuntimeCategory.DEVICE,
      version: '1.0.0',
      isExecutable: true,
      supportedActions: ['info'],
    });

    runtimeRouter = new RuntimeRouter(capabilityRegistry, runtimeRegistry);
    approvalHost = new NativeApprovalHost(leaseBoundary);
    trayController = new TrayUIController();

    const mockFsRuntime = {
      execute: async () => ({ content: 'safe-file-data' }),
      shutdown: async () => {},
    } as unknown as FilesystemRuntime;

    const mockTerminalRuntime = {
      execute: async () => ({ exitCode: 0, stdout: 'command output' }),
      shutdown: async () => {},
    } as unknown as TerminalRuntime;

    const mockDeviceRuntime = {
      execute: async () => ({ deviceModel: 'NexusBox-1' }),
      shutdown: async () => {},
    } as unknown as DeviceRuntime;

    const config = {
      deviceId: validDeviceId,
      agentVersion: '0.1.0-sprint0',
      tenantId: validTenantId,
    } as unknown as DesktopAgentConfig;

    orchestrator = new AgentOrchestrator(
      config,
      identityProvider,
      controlPlaneClient as any,
      leaseBoundary,
      runtimeRouter,
      undefined, // stateManager
      undefined, // memoryCache
      telemetrySpool as any,
      undefined, // redactionFilter
      undefined, // notificationManager
      undefined, // secretsVault
      () => AgentLifecycleState.READY,
      mockFsRuntime,
      mockTerminalRuntime,
      undefined, // browser
      undefined, // plugin
      mockDeviceRuntime,
      undefined, // localAi
      approvalHost,
      trayController,
    );
  });

  afterEach(() => {
    approvalHost.shutdown();
    trayController.shutdown();
  });

  // =========================================================================
  // 052-SEC-01: HIGH-RISK CAPABILITIES REQUIRE HUMAN APPROVAL
  // =========================================================================
  describe('052-SEC-01: High-Risk Capabilities Require Human Approval', () => {
    it('intercepts high-risk capability and pauses in AWAITING_APPROVAL until ALLOW is submitted', async () => {
      const leaseHeader = createSignedLease();
      const taskId = crypto.randomUUID();

      const taskPromise = orchestrator.executeTask({
        task_id: taskId,
        step_id: 'step-exec-1',
        correlation_id: 'corr-01',
        leaseHeader,
        capabilityId: 'terminal.execute',
        runtimeCategory: 'terminal',
        payload: { command: 'npm test' },
      });

      // Give orchestrator event loop ticks to setup and present prompt
      await new Promise((r) => setTimeout(r, 20));

      // Invariant: Status must be AWAITING_APPROVAL before execution
      assert.strictEqual(orchestrator.getTaskStatus(taskId), 'AWAITING_APPROVAL');

      // Invariant: Tray postured into AWAITING_APPROVAL
      assert.strictEqual(trayController.getStatus().state, 'AWAITING_APPROVAL');
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 1);

      // Verify pending prompt exists in host
      const pending = approvalHost.listPendingPrompts(validTenantId);
      assert.strictEqual(pending.length, 1);
      assert.strictEqual(pending[0].actionIdentifier, 'terminal.execute');

      // Submit explicit human ALLOW
      const decisionRes = await approvalHost.submitDecision({
        promptId: pending[0].promptId,
        decision: 'ALLOW',
        nonce: pending[0].nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      assert.strictEqual(decisionRes.state, 'APPROVED');

      // Wait for task completion
      const result = await taskPromise;
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.approvalDecision, 'ALLOW');
      assert.ok(result.approvalReceiptHash);
      assert.strictEqual(result.approvalReceiptHash.length, 64);
      assert.strictEqual(result.approvalReceiptHash, decisionRes.receiptHash);

      // Invariant: Tray restored to CONNECTED / WORKING
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });

    it('immediately halts and fails task with APPROVAL_DENIED upon human DENY', async () => {
      const leaseHeader = createSignedLease();
      const taskId = crypto.randomUUID();

      const taskPromise = orchestrator.executeTask({
        task_id: taskId,
        step_id: 'step-delete-1',
        correlation_id: 'corr-02',
        leaseHeader,
        capabilityId: 'filesystem.deleteFile',
        runtimeCategory: 'filesystem',
        payload: { path: '/tmp/target.txt' },
      });

      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(orchestrator.getTaskStatus(taskId), 'AWAITING_APPROVAL');

      const pending = approvalHost.listPendingPrompts(validTenantId);
      assert.strictEqual(pending.length, 1);

      // Submit human DENY
      const decisionRes = await approvalHost.submitDecision({
        promptId: pending[0].promptId,
        decision: 'DENY',
        nonce: pending[0].nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      assert.strictEqual(decisionRes.state, 'DENIED');

      const result = await taskPromise;
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorCode, 'APPROVAL_DENIED');
      assert.strictEqual(orchestrator.getTaskStatus(taskId), 'FAILED');
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });

    it('bypasses approval for low-risk capabilities and executes immediately', async () => {
      const leaseHeader = createSignedLease();
      const taskId = crypto.randomUUID();

      const result = await orchestrator.executeTask({
        task_id: taskId,
        step_id: 'step-read-1',
        correlation_id: 'corr-03',
        leaseHeader,
        capabilityId: 'filesystem.read',
        runtimeCategory: 'filesystem',
        riskTier: 'LOW',
        payload: { path: '/tmp/readme.txt' },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(orchestrator.getTaskStatus(taskId), 'COMPLETED');
      assert.strictEqual(approvalHost.listPendingPrompts().length, 0);
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });

    it('fails closed with APPROVAL_REQUIRED when high-risk approval is requested but no approval host is configured', async () => {
      const unhostedOrchestrator = new AgentOrchestrator(
        { deviceId: validDeviceId, agentVersion: '0.1.0-sprint0', tenantId: validTenantId } as any,
        identityProvider,
        controlPlaneClient as any,
        leaseBoundary,
        runtimeRouter,
      );

      const leaseHeader = createSignedLease();
      const result = await unhostedOrchestrator.executeTask({
        task_id: crypto.randomUUID(),
        step_id: 'step-unhosted-1',
        correlation_id: 'corr-unhosted',
        leaseHeader,
        capabilityId: 'terminal.execute',
        runtimeCategory: 'terminal',
        requiresApproval: true,
        payload: { command: 'ls' },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorCode, 'APPROVAL_REQUIRED');
    });
  });

  // =========================================================================
  // 052-SEC-02: APPROVAL REQUEST AUTHENTICITY / NONCE INTEGRITY
  // =========================================================================
  describe('052-SEC-02: Approval Request Authenticity / Nonce Integrity', () => {
    it('rejects decision with forged or mismatched nonce and preserves prompt in PENDING state', async () => {
      const leaseHeader = createSignedLease();
      const prompt = await approvalHost.presentPrompt({
        leaseHeader,
        requestId: 'req-nonce-1',
        title: 'Execute Command',
        description: 'Shell command execution',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
      });

      // Submit decision with invalid nonce
      await assert.rejects(
        async () => {
          await approvalHost.submitDecision({
            promptId: prompt.promptId,
            decision: 'ALLOW',
            nonce: 'forged-nonce-value-12345678',
            leaseHeader,
            tenantId: validTenantId,
          });
        },
        (err: UIError) => err.code === 'NONCE_MISMATCH',
      );

      // Prompt must remain in PENDING state
      const item = approvalHost.getPrompt(prompt.promptId);
      assert.strictEqual(item?.state, 'PENDING');

      // Valid nonce submission succeeds afterward
      const validDecision = await approvalHost.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      assert.strictEqual(validDecision.state, 'APPROVED');
    });
  });

  // =========================================================================
  // 052-SEC-03: TENANT / TASK / REQUEST ISOLATION
  // =========================================================================
  describe('052-SEC-03: Tenant / Task / Request Isolation', () => {
    it('rejects cross-tenant decision submission and prevents cross-tenant prompt probing', async () => {
      const leaseHeaderA = createSignedLease(['terminal.execute'], validTenantId);
      const leaseHeaderB = createSignedLease(['terminal.execute'], validTenantIdB);

      const promptA = await approvalHost.presentPrompt({
        leaseHeader: leaseHeaderA,
        requestId: 'req-tenant-a',
        tenantId: validTenantId,
        title: 'Tenant A Operation',
        description: 'Operation belonging to tenant A',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
      });

      // Cross-tenant decision submission attempt
      await assert.rejects(
        async () => {
          await approvalHost.submitDecision({
            promptId: promptA.promptId,
            decision: 'ALLOW',
            nonce: promptA.nonce,
            leaseHeader: leaseHeaderB,
            tenantId: validTenantIdB, // Attacker tenant B
          });
        },
        (err: UIError) => err.code === 'TENANT_MISMATCH',
      );

      // Cross-tenant getPrompt probing
      await assert.rejects(
        async () => {
          approvalHost.getPrompt(promptA.promptId, validTenantIdB);
        },
        (err: UIError) => err.code === 'TENANT_MISMATCH',
      );

      // Tenant-filtered listing isolation
      const tenantAList = approvalHost.listPendingPrompts(validTenantId);
      const tenantBList = approvalHost.listPendingPrompts(validTenantIdB);

      assert.strictEqual(tenantAList.length, 1);
      assert.strictEqual(tenantBList.length, 0);
    });
  });

  // =========================================================================
  // 052-SEC-04: SINGLE-RESOLUTION / RACE SAFETY
  // =========================================================================
  describe('052-SEC-04: Single-Resolution / Race Safety', () => {
    it('prevents double-click race and ensures only one decision can resolve a prompt', async () => {
      const leaseHeader = createSignedLease();
      const prompt = await approvalHost.presentPrompt({
        leaseHeader,
        requestId: 'req-race-1',
        title: 'Race Test',
        description: 'Testing concurrent decision resolution',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
      });

      const d1 = approvalHost.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader,
      });

      const d2 = approvalHost.submitDecision({
        promptId: prompt.promptId,
        decision: 'DENY',
        nonce: prompt.nonce,
        leaseHeader,
      });

      const results = await Promise.allSettled([d1, d2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);

      const rejectedErr = (rejected[0] as PromiseRejectedResult).reason as UIError;
      assert.strictEqual(rejectedErr.code, 'PROMPT_ALREADY_RESOLVED');
    });

    it('rejects subsequent decision submission on already resolved prompt', async () => {
      const leaseHeader = createSignedLease();
      const prompt = await approvalHost.presentPrompt({
        leaseHeader,
        requestId: 'req-repeat-1',
        title: 'Repeat Test',
        description: 'Testing second decision attempt',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
      });

      await approvalHost.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader,
      });

      await assert.rejects(
        async () => {
          await approvalHost.submitDecision({
            promptId: prompt.promptId,
            decision: 'DENY',
            nonce: prompt.nonce,
            leaseHeader,
          });
        },
        (err: UIError) => err.code === 'PROMPT_ALREADY_RESOLVED',
      );
    });
  });

  // =========================================================================
  // 052-SEC-05: EXPIRATION FAIL-CLOSED
  // =========================================================================
  describe('052-SEC-05: Expiration Fail-Closed', () => {
    it('auto-expires prompt upon TTL timeout and fails task with APPROVAL_EXPIRED', async () => {
      const leaseHeader = createSignedLease();
      const taskId = crypto.randomUUID();

      // Configure a short TTL (1 second)
      const prompt = await approvalHost.presentPrompt({
        leaseHeader,
        requestId: taskId,
        taskId,
        title: 'TTL Test',
        description: 'Auto-expiration test',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
        ttlSeconds: 1,
      });

      assert.strictEqual(prompt.state, 'PENDING');

      const waitPromise = approvalHost.waitForDecision(prompt.promptId);

      // Wait for expiration timer to trigger (1.15s)
      await new Promise((r) => setTimeout(r, 1150));

      const expiredDecision = await waitPromise;
      assert.strictEqual(expiredDecision.state, 'EXPIRED');
      assert.strictEqual(expiredDecision.decision, 'DENY');

      // Attempting to submit a decision on an expired prompt must be rejected
      await assert.rejects(
        async () => {
          await approvalHost.submitDecision({
            promptId: prompt.promptId,
            decision: 'ALLOW',
            nonce: prompt.nonce,
            leaseHeader,
          });
        },
        (err: UIError) => err.code === 'PROMPT_ALREADY_RESOLVED' || err.code === 'PROMPT_EXPIRED',
      );
    });
  });

  // =========================================================================
  // 052-SEC-06: RECEIPT / EVIDENCE INTEGRITY
  // =========================================================================
  describe('052-SEC-06: Receipt / Evidence Integrity', () => {
    it('generates deterministic SHA-256 evidence receipt bound to decision parameters', async () => {
      const leaseHeader = createSignedLease();
      const prompt = await approvalHost.presentPrompt({
        leaseHeader,
        requestId: 'req-evidence-1',
        title: 'Evidence Test',
        description: 'Checking receipt checksum determinism',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
      });

      const res = await approvalHost.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      assert.ok(res.receiptHash);
      assert.strictEqual(res.receiptHash.length, 64);

      // Deterministic re-calculation verification
      const expectedChecksum = computeApprovalReceiptChecksum({
        promptId: res.promptId,
        requestId: res.requestId,
        decision: 'ALLOW',
        resolvedAt: res.resolvedAt,
        nonce: prompt.nonce,
        tenantId: validTenantId,
        leaseId: leaseHeader.lease_id,
      });

      assert.strictEqual(res.receiptHash, expectedChecksum);

      // Tampering detection: changing decision from ALLOW to DENY changes hash
      const tamperedChecksum = computeApprovalReceiptChecksum({
        promptId: res.promptId,
        requestId: res.requestId,
        decision: 'DENY',
        resolvedAt: res.resolvedAt,
        nonce: prompt.nonce,
        tenantId: validTenantId,
        leaseId: leaseHeader.lease_id,
      });

      assert.notStrictEqual(res.receiptHash, tamperedChecksum);
    });

    it('emits canonical telemetry event envelope with approval decision and receipt hash', async () => {
      const leaseHeader = createSignedLease();
      const taskId = crypto.randomUUID();

      const taskPromise = orchestrator.executeTask({
        task_id: taskId,
        step_id: 'step-telem-1',
        correlation_id: 'corr-telem-01',
        leaseHeader,
        capabilityId: 'terminal.execute',
        runtimeCategory: 'terminal',
        payload: { command: 'echo hello' },
      });

      await new Promise((r) => setTimeout(r, 20));

      const pending = approvalHost.listPendingPrompts(validTenantId);
      assert.strictEqual(pending.length, 1);

      await approvalHost.submitDecision({
        promptId: pending[0].promptId,
        decision: 'ALLOW',
        nonce: pending[0].nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      await taskPromise;

      const decisionEvent = telemetrySpool.enqueuedEvents.find(
        (e) => e.schema_id === 'schema:nexusos:approval:decision:v1',
      );

      assert.ok(decisionEvent, 'Expected decision telemetry event to be enqueued');
      assert.strictEqual(decisionEvent.payload.decision, 'ALLOW');
      assert.strictEqual(decisionEvent.payload.taskId, taskId);
      assert.strictEqual(decisionEvent.payload.capabilityId, 'terminal.execute');
      assert.ok(decisionEvent.payload.receiptHash);
    });
  });

  // =========================================================================
  // CANCELLATION, SHUTDOWN & SYSTEM TRAY INTEGRATION
  // =========================================================================
  describe('Cancellation, Teardown & Tray Integration', () => {
    it('cancels pending prompt and updates tray count when task is cancelled while awaiting approval', async () => {
      const leaseHeader = createSignedLease();
      const taskId = crypto.randomUUID();

      const taskPromise = orchestrator.executeTask({
        task_id: taskId,
        step_id: 'step-cancel-1',
        correlation_id: 'corr-cancel',
        leaseHeader,
        capabilityId: 'terminal.execute',
        runtimeCategory: 'terminal',
        payload: { command: 'sleep 10' },
      });

      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(orchestrator.getTaskStatus(taskId), 'AWAITING_APPROVAL');
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 1);

      // Cancel the task while awaiting approval
      const cancelled = await orchestrator.cancelTask(taskId, validTenantId);
      assert.strictEqual(cancelled, true);

      const result = await taskPromise;
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorCode, 'TASK_CANCELED');
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });

    it('cleans up pending timers and rejects waiters on shutdown without leaking', async () => {
      const leaseHeader = createSignedLease();
      const prompt = await approvalHost.presentPrompt({
        leaseHeader,
        requestId: 'req-shutdown-1',
        title: 'Shutdown Test',
        description: 'Checking clean host shutdown',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.execute',
      });

      const waitPromise = approvalHost.waitForDecision(prompt.promptId);

      approvalHost.shutdown();

      await assert.rejects(async () => {
        await waitPromise;
      });

      const item = approvalHost.getPrompt(prompt.promptId);
      assert.strictEqual(item?.state, 'CANCELLED');
    });

    it('accurately maintains pending approval count across multiple concurrent approval requests', async () => {
      const leaseHeader = createSignedLease();
      const taskId1 = crypto.randomUUID();
      const taskId2 = crypto.randomUUID();

      const p1 = orchestrator.executeTask({
        task_id: taskId1,
        step_id: 'step-multi-1',
        correlation_id: 'corr-multi-1',
        leaseHeader,
        capabilityId: 'terminal.execute',
        runtimeCategory: 'terminal',
        payload: { command: 'cmd1' },
      });

      const p2 = orchestrator.executeTask({
        task_id: taskId2,
        step_id: 'step-multi-2',
        correlation_id: 'corr-multi-2',
        leaseHeader,
        capabilityId: 'filesystem.deleteFile',
        runtimeCategory: 'filesystem',
        payload: { path: '/tmp/file2' },
      });

      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 2);
      assert.strictEqual(trayController.getStatus().state, 'AWAITING_APPROVAL');

      const pending = approvalHost.listPendingPrompts();
      assert.strictEqual(pending.length, 2);

      // Approve first prompt
      await approvalHost.submitDecision({
        promptId: pending[0].promptId,
        decision: 'ALLOW',
        nonce: pending[0].nonce,
        leaseHeader,
      });

      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 1);
      assert.strictEqual(trayController.getStatus().state, 'AWAITING_APPROVAL');

      // Deny second prompt
      await approvalHost.submitDecision({
        promptId: pending[1].promptId,
        decision: 'DENY',
        nonce: pending[1].nonce,
        leaseHeader,
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.strictEqual(r1.success, true);
      assert.strictEqual(r2.success, false);

      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });
  });

  // =========================================================================
  // WORKFLOW DAG APPROVAL CHECKPOINTS
  // =========================================================================
  describe('Workflow DAG Approval Checkpoints', () => {
    let taskScheduler: TaskScheduler;
    let workflowEngine: WorkflowEngine;

    beforeEach(() => {
      const config = {
        deviceId: validDeviceId,
        agentVersion: '0.1.0-sprint0',
        tenantId: validTenantId,
      } as unknown as DesktopAgentConfig;

      taskScheduler = new TaskScheduler(config, identityProvider, leaseBoundary, orchestrator);

      workflowEngine = new WorkflowEngine(
        config,
        identityProvider,
        leaseBoundary,
        orchestrator,
        taskScheduler,
      );
    });

    afterEach(() => {
      workflowEngine.shutdown();
      taskScheduler.shutdown();
    });

    it('pauses workflow DAG at high-risk node approval checkpoint, resumes and completes on ALLOW', async () => {
      const leaseHeader = createSignedLease(['filesystem.read', 'terminal.execute', 'device.info']);

      const dag: WorkflowDAG = {
        workflowId: 'wf-checkpoint-allow',
        taskId: 'task-wf-1',
        correlationId: 'corr-wf-1',
        leaseHeader,
        nodes: [
          {
            nodeId: 'node-safe-read',
            capabilityId: 'filesystem.read',
            runtimeCategory: 'filesystem',
            payload: { file: 'test.txt' },
            dependencies: [],
          },
          {
            nodeId: 'node-high-risk-exec',
            capabilityId: 'terminal.execute',
            runtimeCategory: 'terminal',
            payload: { command: 'echo hello' },
            dependencies: ['node-safe-read'],
          },
          {
            nodeId: 'node-safe-device',
            capabilityId: 'device.info',
            runtimeCategory: 'device',
            payload: {},
            dependencies: ['node-high-risk-exec'],
          },
        ],
        edges: [
          { fromNodeId: 'node-safe-read', toNodeId: 'node-high-risk-exec' },
          { fromNodeId: 'node-high-risk-exec', toNodeId: 'node-safe-device' },
        ],
      };

      const workflowPromise = workflowEngine.executeWorkflow(dag);

      // Wait until the workflow executes node 1 and reaches node 2 (approval required)
      let pending: any[] = [];
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 20));
        pending = approvalHost.listPendingPrompts(validTenantId);
        if (pending.length > 0) break;
      }

      assert.strictEqual(pending.length, 1);
      assert.strictEqual(pending[0].actionIdentifier, 'terminal.execute');
      assert.strictEqual(trayController.getStatus().state, 'AWAITING_APPROVAL');

      // Human ALLOWs the high-risk node
      await approvalHost.submitDecision({
        promptId: pending[0].promptId,
        decision: 'ALLOW',
        nonce: pending[0].nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      const wfResult = await workflowPromise;
      assert.strictEqual(wfResult.success, true);
      assert.strictEqual(workflowEngine.getWorkflowStatus('wf-checkpoint-allow'), 'COMPLETED');
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });

    it('halts workflow DAG at high-risk node approval checkpoint with compensation when DENIED', async () => {
      const leaseHeader = createSignedLease(['filesystem.read', 'terminal.execute']);

      const dag: WorkflowDAG = {
        workflowId: 'wf-checkpoint-deny',
        taskId: 'task-wf-2',
        correlationId: 'corr-wf-2',
        leaseHeader,
        nodes: [
          {
            nodeId: 'node-step-1',
            capabilityId: 'filesystem.read',
            runtimeCategory: 'filesystem',
            payload: { file: 'step1.txt' },
            dependencies: [],
          },
          {
            nodeId: 'node-step-2-dangerous',
            capabilityId: 'terminal.execute',
            runtimeCategory: 'terminal',
            payload: { command: 'rm -rf /' },
            dependencies: ['node-step-1'],
          },
        ],
        edges: [{ fromNodeId: 'node-step-1', toNodeId: 'node-step-2-dangerous' }],
      };

      const workflowPromise = workflowEngine.executeWorkflow(dag);

      let pending: any[] = [];
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 20));
        pending = approvalHost.listPendingPrompts(validTenantId);
        if (pending.length > 0) break;
      }

      assert.strictEqual(pending.length, 1);

      // Human DENIES the dangerous action
      await approvalHost.submitDecision({
        promptId: pending[0].promptId,
        decision: 'DENY',
        nonce: pending[0].nonce,
        leaseHeader,
        tenantId: validTenantId,
      });

      const wfResult = await workflowPromise;
      assert.strictEqual(wfResult.success, false);
      assert.strictEqual(wfResult.errorCode, 'APPROVAL_DENIED');
      assert.strictEqual(workflowEngine.getWorkflowStatus('wf-checkpoint-deny'), 'FAILED');
      assert.strictEqual(trayController.getStatus().pendingApprovalCount, 0);
    });
  });
});
