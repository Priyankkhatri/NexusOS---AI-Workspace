import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  TaskLifecycleState,
  TaskRecord,
  ExecutionLeaseHeader,
  ExecutionReceipt,
  WorkflowDAG,
} from '@nexusos/contracts';
import {
  SqliteTaskRepository,
  InMemoryTaskRepository,
  createTaskRepository,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  computeEvidenceHash,
  computeReceiptSignature,
} from '../src/index.js';
import { ReferencePolicyEvaluator, loadPolicyConfig } from '@nexusos/policy';
import { AuthenticatedContext, PrincipalType } from '@nexusos/identity';

const tenantA = 'e0000000-0000-4000-8000-000000000001';
const tenantB = 'e0000000-0000-4000-8000-000000000002';
const agentId = 'a0000000-0000-4000-8000-000000000001';
const userId = 'u0000000-0000-4000-8000-000000000001';

function createMockAuthContext(overrides?: Partial<AuthenticatedContext>): AuthenticatedContext {
  const tenantId = overrides?.tenantId ?? tenantA;
  return {
    principal: {
      type: PrincipalType.USER,
      userId,
      tenantId,
      roles: ['admin', 'operator'],
    },
    tenantId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    rawTokenHash: 'hash-test-token',
    ...overrides,
  };
}

function createSampleTask(overrides?: Partial<TaskRecord>): TaskRecord {
  const now = new Date().toISOString();
  return {
    taskId: crypto.randomUUID(),
    tenantId: tenantA,
    submittedBy: userId,
    title: 'Test persistence task',
    targetAgentId: agentId,
    capabilityId: 'system.diagnostics',
    runtimeCategory: 'system',
    parameters: { verbose: true, timeoutMs: 5000 },
    requestedScope: 'system:read',
    state: TaskLifecycleState.SUBMITTED,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Task Persistence — SqliteTaskRepository Hardening & Durability', () => {
  let tempDir: string;
  let dbFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-task-persistence-'));
    dbFilePath = path.join(tempDir, 'tasks.db');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error on open file handles
    }
  });

  it('1. Task creation and retrieval', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const task = createSampleTask({ title: 'Task creation test' });

    repo.save(task);

    const retrievedById = repo.findById(task.taskId);
    const retrievedByGet = repo.get(task.taskId);

    assert.ok(retrievedById);
    assert.ok(retrievedByGet);
    assert.strictEqual(retrievedById.taskId, task.taskId);
    assert.strictEqual(retrievedById.title, 'Task creation test');
    assert.strictEqual(retrievedById.state, TaskLifecycleState.SUBMITTED);
    assert.strictEqual(repo.has(task.taskId), true);
    assert.strictEqual(repo.has('non-existent-id'), false);

    repo.close();
  });

  it('2. Complete TaskRecord round-trip serialization', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();

    const lease: ExecutionLeaseHeader = {
      lease_id: leaseId,
      task_id: taskId,
      agent_id: agentId,
      tenant_id: tenantA,
      scopes: ['system:read', 'system:write'],
      policy_hash: 'sha256-policy-hash-test',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      signature: 'test-lease-signature-hex',
    };

    const output = { status: 'success', metrics: { cpu: 12.5, memMb: 512 } };
    const evidenceChecksum = computeEvidenceHash(output);

    const receipt: ExecutionReceipt = {
      receiptId: crypto.randomUUID(),
      taskId,
      leaseId,
      agentId,
      tenantId: tenantA,
      status: 'SUCCESS',
      exitCode: 0,
      evidenceChecksum,
      output,
      completedAt: new Date().toISOString(),
      signature: 'test-receipt-signature-hex',
    };

    const dag: WorkflowDAG = {
      workflowId: crypto.randomUUID(),
      taskId,
      leaseHeader: lease,
      correlationId: taskId,
      nodes: [
        {
          nodeId: 'node-1',
          capabilityId: 'system.diagnostics',
          runtimeCategory: 'system',
          payload: { command: 'uptime' },
        },
      ],
      edges: [],
    };

    const task: TaskRecord & { workspaceId?: string } = {
      taskId,
      tenantId: tenantA,
      workspaceId: 'ws-prod-01',
      submittedBy: userId,
      title: 'Full round-trip task',
      targetAgentId: agentId,
      capabilityId: 'workflow.dag',
      runtimeCategory: 'workflow',
      parameters: { env: 'production', tags: ['critical', 'automated'] },
      requestedScope: 'system:read,system:write',
      state: TaskLifecycleState.COMPLETED,
      lease,
      receipt,
      evidenceChecksum,
      isWorkflow: true,
      dag,
      policyDecision: {
        allowed: true,
        reason: 'Policy check passed',
        policyVersion: '1.2.0',
        policyHash: 'sha256-hash',
      },
      error: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    repo.save(task);

    const retrieved = repo.findById(taskId) as TaskRecord & { workspaceId?: string };
    assert.ok(retrieved);
    assert.deepStrictEqual(retrieved.parameters, task.parameters);
    assert.deepStrictEqual(retrieved.policyDecision, task.policyDecision);
    assert.deepStrictEqual(retrieved.lease, task.lease);
    assert.deepStrictEqual(retrieved.receipt, task.receipt);
    assert.deepStrictEqual(retrieved.dag, task.dag);
    assert.strictEqual(retrieved.workspaceId, 'ws-prod-01');
    assert.strictEqual(retrieved.isWorkflow, true);
    assert.strictEqual(retrieved.state, TaskLifecycleState.COMPLETED);

    repo.close();
  });

  it('3. Task updates and state transitions', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    let task = createSampleTask();

    repo.save(task);
    assert.strictEqual(repo.findById(task.taskId)?.state, TaskLifecycleState.SUBMITTED);

    const states: TaskLifecycleState[] = [
      TaskLifecycleState.POLICY_EVALUATED,
      TaskLifecycleState.LEASED,
      TaskLifecycleState.DISPATCHED,
      TaskLifecycleState.EXECUTING,
      TaskLifecycleState.RECEIPT_VERIFIED,
      TaskLifecycleState.COMPLETED,
    ];

    for (const state of states) {
      task = {
        ...task,
        state,
        updatedAt: new Date().toISOString(),
      };
      repo.save(task);
      const updated = repo.findById(task.taskId);
      assert.strictEqual(updated?.state, state);
    }

    repo.close();
  });

  it('4. Lease persistence', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const taskId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30000).toISOString();

    const task = createSampleTask({
      taskId,
      state: TaskLifecycleState.LEASED,
      lease: {
        lease_id: leaseId,
        task_id: taskId,
        agent_id: agentId,
        tenant_id: tenantA,
        scopes: ['system:read'],
        policy_hash: 'hash-123',
        issued_at: new Date().toISOString(),
        expires_at: expiresAt,
        signature: 'sig-123',
      },
    });

    repo.save(task);

    const db = repo.getDatabase();
    const row = db
      .prepare('SELECT lease_id, lease_expires_at FROM tasks WHERE task_id = ?;')
      .get(taskId) as {
      lease_id: string;
      lease_expires_at: string;
    };

    assert.strictEqual(row.lease_id, leaseId);
    assert.strictEqual(row.lease_expires_at, expiresAt);

    repo.close();
  });

  it('5. Receipt persistence', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const taskId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    const output = { executed: true };
    const evidenceChecksum = computeEvidenceHash(output);

    const task = createSampleTask({
      taskId,
      state: TaskLifecycleState.COMPLETED,
      receipt: {
        receiptId,
        taskId,
        leaseId: crypto.randomUUID(),
        agentId,
        tenantId: tenantA,
        status: 'SUCCESS',
        exitCode: 0,
        evidenceChecksum,
        output,
        completedAt: new Date().toISOString(),
        signature: 'sig-abc',
      },
      evidenceChecksum,
    });

    repo.save(task);

    const db = repo.getDatabase();
    const row = db
      .prepare('SELECT receipt_id, evidence_checksum FROM tasks WHERE task_id = ?;')
      .get(taskId) as {
      receipt_id: string;
      evidence_checksum: string;
    };

    assert.strictEqual(row.receipt_id, receiptId);
    assert.strictEqual(row.evidence_checksum, evidenceChecksum);

    repo.close();
  });

  it('6. Idempotency behavior across repository reopen', () => {
    const repo1 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const task = createSampleTask({ title: 'Idempotent task' });

    repo1.save(task);
    assert.strictEqual(repo1.size, 1);
    repo1.close();

    const repo2 = new SqliteTaskRepository({ dbPath: dbFilePath });
    assert.strictEqual(repo2.size, 1);

    // Save the exact same task again
    repo2.save(task);
    assert.strictEqual(repo2.size, 1);

    // Save modified version with same ID
    repo2.save({ ...task, title: 'Updated idempotent title' });
    assert.strictEqual(repo2.size, 1);
    assert.strictEqual(repo2.findById(task.taskId)?.title, 'Updated idempotent title');

    repo2.close();
  });

  it('7. Tenant isolation', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const taskA1 = createSampleTask({ tenantId: tenantA, title: 'Tenant A task 1' });
    const taskA2 = createSampleTask({ tenantId: tenantA, title: 'Tenant A task 2' });
    const taskB1 = createSampleTask({ tenantId: tenantB, title: 'Tenant B task 1' });

    repo.save(taskA1);
    repo.save(taskA2);
    repo.save(taskB1);

    const tenantAResults = repo.findByTenant(tenantA);
    const tenantBResults = repo.findByTenant(tenantB);

    assert.strictEqual(tenantAResults.total, 2);
    assert.strictEqual(tenantAResults.items.length, 2);
    assert.ok(tenantAResults.items.every((t) => t.tenantId === tenantA));

    assert.strictEqual(tenantBResults.total, 1);
    assert.strictEqual(tenantBResults.items.length, 1);
    assert.strictEqual(tenantBResults.items[0].taskId, taskB1.taskId);

    const countsA = repo.getStatusCounts(tenantA);
    const countsB = repo.getStatusCounts(tenantB);
    assert.strictEqual(countsA.total, 2);
    assert.strictEqual(countsB.total, 1);

    repo.close();
  });

  it('8. Workspace isolation', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const taskWs1 = createSampleTask({
      tenantId: tenantA,
      title: 'Workspace 1 task',
      ...({ workspaceId: 'ws-alpha' } as any),
    });
    const taskWs2 = createSampleTask({
      tenantId: tenantA,
      title: 'Workspace 2 task',
      ...({ workspaceId: 'ws-beta' } as any),
    });

    repo.save(taskWs1);
    repo.save(taskWs2);

    const ws1Results = repo.findByTenant(tenantA, { workspaceId: 'ws-alpha' });
    const ws2Results = repo.findByTenant(tenantA, { workspaceId: 'ws-beta' });

    assert.strictEqual(ws1Results.total, 1);
    assert.strictEqual(ws1Results.items[0].taskId, taskWs1.taskId);

    assert.strictEqual(ws2Results.total, 1);
    assert.strictEqual(ws2Results.items[0].taskId, taskWs2.taskId);

    repo.close();
  });

  it('9. Invalid or corrupted record handling', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const task = createSampleTask({ title: 'Task to be corrupted' });
    repo.save(task);

    // Intentionally corrupt the serialized JSON payload in the database row
    const db = repo.getDatabase();
    db.prepare(
      "UPDATE tasks SET record_json = '{ corrupted: true, json invalid...' WHERE task_id = ?;",
    ).run(task.taskId);

    // Retrieve task: must NOT throw an unhandled syntax error; must gracefully reconstruct fallback
    const recovered = repo.findById(task.taskId);
    assert.ok(recovered);
    assert.strictEqual(recovered.taskId, task.taskId);
    assert.strictEqual(recovered.tenantId, task.tenantId);
    assert.strictEqual(recovered.state, task.state);
    assert.strictEqual(recovered.title, task.title);

    repo.close();
  });

  it('10. Migration from an older schema', () => {
    // Manually create an older v1 database without workspace_id and lease_expires_at columns
    const rawDb = new DatabaseSync(dbFilePath);
    rawDb.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES (1, datetime('now'), 'Initial v1 schema');

      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        submitted_by TEXT NOT NULL,
        title TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        runtime_category TEXT NOT NULL,
        state TEXT NOT NULL,
        requested_scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        lease_id TEXT,
        receipt_id TEXT,
        evidence_checksum TEXT,
        is_workflow INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        record_json TEXT NOT NULL
      );
    `);

    const v1Task = createSampleTask({ title: 'Legacy v1 task' });
    rawDb
      .prepare(
        `
      INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, null, 0, null, null, ?)
    `,
      )
      .run(
        v1Task.taskId,
        v1Task.tenantId,
        v1Task.submittedBy,
        v1Task.title,
        v1Task.targetAgentId,
        v1Task.capabilityId,
        v1Task.runtimeCategory,
        v1Task.state,
        v1Task.requestedScope,
        v1Task.createdAt,
        v1Task.updatedAt,
        JSON.stringify(v1Task),
      );
    rawDb.close();

    // Now instantiate SqliteTaskRepository: it must detect schema version 1 and run migration 2
    const migratedRepo = new SqliteTaskRepository({ dbPath: dbFilePath });

    const maxV = (
      migratedRepo
        .getDatabase()
        .prepare('SELECT MAX(version) as max_v FROM schema_migrations;')
        .get() as { max_v: number }
    ).max_v;
    assert.strictEqual(maxV, 2);

    // Verify legacy task is still intact
    const retrieved = migratedRepo.findById(v1Task.taskId);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.title, 'Legacy v1 task');

    // Verify new columns function
    const v2Task = createSampleTask({
      title: 'V2 Task with Workspace',
      ...({ workspaceId: 'ws-new' } as any),
    });
    migratedRepo.save(v2Task);

    const retrievedV2 = migratedRepo.findById(v2Task.taskId) as TaskRecord & {
      workspaceId?: string;
    };
    assert.strictEqual(retrievedV2.workspaceId, 'ws-new');

    migratedRepo.close();
  });

  it('11. Transaction rollback on injected write failure', () => {
    const repo = new SqliteTaskRepository({ dbPath: dbFilePath });
    const task = createSampleTask({ title: 'Original title' });
    repo.save(task);

    // Inject simulated write failure
    repo.simulateFailure = true;

    assert.throws(
      () => repo.save({ ...task, title: 'Mutated title that fails' }),
      /Simulated database write failure/,
    );

    // Disable failure injection and verify previous state was unchanged
    repo.simulateFailure = false;
    const reloaded = repo.findById(task.taskId);
    assert.strictEqual(reloaded?.title, 'Original title');

    repo.close();
  });

  it('12. Two repository instances reopening the same database', () => {
    const repoA = new SqliteTaskRepository({ dbPath: dbFilePath });
    const task1 = createSampleTask({ title: 'Task from Repo A' });
    repoA.save(task1);
    repoA.close();

    const repoB = new SqliteTaskRepository({ dbPath: dbFilePath });
    const retrieved1 = repoB.findById(task1.taskId);
    assert.ok(retrieved1);
    assert.strictEqual(retrieved1.title, 'Task from Repo A');

    const task2 = createSampleTask({ title: 'Task from Repo B' });
    repoB.save(task2);
    repoB.close();

    const repoA2 = new SqliteTaskRepository({ dbPath: dbFilePath });
    assert.strictEqual(repoA2.size, 2);
    assert.ok(repoA2.findById(task1.taskId));
    assert.ok(repoA2.findById(task2.taskId));
    repoA2.close();
  });

  it('13. TaskController reconstruction using the same SQLite database', async () => {
    const leaseSecret = 'controller-lease-secret-key-32-chars';
    const agentSecret = 'controller-agent-secret-key-32-chars';
    const leaseIssuer = new LeaseIssuer({ leaseSecret });
    const receiptVerifier = new ReceiptVerifier({ agentSecret });
    const policyEvaluator = {
      evaluate: async () => ({
        decisionId: crypto.randomUUID(),
        effect: 'ALLOW',
        allowed: true,
        policyVersion: '1.0.0',
        policyHash: 'sha256-test-hash',
        reason: 'Policy check passed',
      }),
    };

    // Controller 1 with persistent SQLite repo
    const repo1 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const controller1 = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      taskRepository: repo1,
    });

    const authContext = createMockAuthContext();
    const { task } = await controller1.createTask(
      {
        title: 'Task submitted before restart',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: { check: 'memory' },
        requestedScope: 'device:read',
      },
      authContext,
    );

    assert.ok(task.taskId);
    assert.strictEqual(task.state, TaskLifecycleState.LEASED);
    controller1.close();

    // Controller 2 reconstructed with same SQLite DB
    const repo2 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const controller2 = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      taskRepository: repo2,
    });

    const retrieved = controller2.getTask(task.taskId, authContext);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.taskId, task.taskId);
    assert.strictEqual(retrieved.title, 'Task submitted before restart');
    assert.strictEqual(retrieved.state, TaskLifecycleState.LEASED);

    controller2.close();
  });

  it('14. Restart persistence for tasks in important lifecycle states', () => {
    const repo1 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const states: TaskLifecycleState[] = [
      TaskLifecycleState.SUBMITTED,
      TaskLifecycleState.POLICY_EVALUATED,
      TaskLifecycleState.LEASED,
      TaskLifecycleState.DISPATCHED,
      TaskLifecycleState.EXECUTING,
      TaskLifecycleState.AWAITING_APPROVAL,
      TaskLifecycleState.COMPLETED,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.CANCELLED,
    ];

    const tasksMap = new Map<TaskLifecycleState, TaskRecord>();
    for (const state of states) {
      const task = createSampleTask({
        state,
        title: `Task in state ${state}`,
      });
      repo1.save(task);
      tasksMap.set(state, task);
    }

    assert.strictEqual(repo1.size, states.length);
    repo1.close();

    // Reopen database
    const repo2 = new SqliteTaskRepository({ dbPath: dbFilePath });
    assert.strictEqual(repo2.size, states.length);

    for (const [expectedState, originalTask] of tasksMap.entries()) {
      const reloaded = repo2.findById(originalTask.taskId);
      assert.ok(reloaded, `Task ${originalTask.taskId} must exist after restart`);
      assert.strictEqual(
        reloaded.state,
        expectedState,
        `State must be preserved as ${expectedState}`,
      );
      assert.strictEqual(reloaded.title, `Task in state ${expectedState}`);
    }

    repo2.close();
  });

  it('15. Expired lease reconciliation, only where supported by the existing contract', async () => {
    const leaseSecret = 'controller-lease-secret-key-32-chars';
    const agentSecret = 'controller-agent-secret-key-32-chars';
    const leaseIssuer = new LeaseIssuer({ leaseSecret });
    const receiptVerifier = new ReceiptVerifier({ agentSecret });
    const policyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig());

    const repo1 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const controller = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      taskRepository: repo1,
    });

    const expiredTaskId = crypto.randomUUID();
    const activeTaskId = crypto.randomUUID();

    const expiredLease: ExecutionLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: expiredTaskId,
      agent_id: agentId,
      tenant_id: tenantA,
      scopes: ['system:read'],
      policy_hash: 'hash-expired',
      issued_at: new Date(Date.now() - 60000).toISOString(),
      expires_at: new Date(Date.now() - 10000).toISOString(), // expired 10s ago
      signature: 'sig-exp',
    };

    const activeLease: ExecutionLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: activeTaskId,
      agent_id: agentId,
      tenant_id: tenantA,
      scopes: ['system:read'],
      policy_hash: 'hash-active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(), // expires in 60s
      signature: 'sig-active',
    };

    const expiredTask = createSampleTask({
      taskId: expiredTaskId,
      state: TaskLifecycleState.EXECUTING,
      lease: expiredLease,
      title: 'Task with expired lease',
    });

    const activeTask = createSampleTask({
      taskId: activeTaskId,
      state: TaskLifecycleState.EXECUTING,
      lease: activeLease,
      title: 'Task with active lease',
    });

    repo1.save(expiredTask);
    repo1.save(activeTask);

    // Call reconcileExpiredLeases
    const reconciled = await controller.reconcileExpiredLeases(new Date());

    assert.strictEqual(reconciled.length, 1);
    assert.strictEqual(reconciled[0].taskId, expiredTask.taskId);
    assert.strictEqual(reconciled[0].state, TaskLifecycleState.FAILED);
    assert.strictEqual(reconciled[0].error?.code, 'LEASE_EXPIRED');

    // Active task must remain EXECUTING
    const activeReloaded = controller.getTask(activeTask.taskId);
    assert.strictEqual(activeReloaded?.state, TaskLifecycleState.EXECUTING);

    controller.close();
  });

  it('16. Cancellation and late-receipt invariants after restart', async () => {
    const leaseSecret = 'controller-lease-secret-key-32-chars';
    const agentSecret = 'controller-agent-secret-key-32-chars';
    const leaseIssuer = new LeaseIssuer({ leaseSecret });
    const receiptVerifier = new ReceiptVerifier({ agentSecret });
    const policyEvaluator = {
      evaluate: async () => ({
        decisionId: crypto.randomUUID(),
        effect: 'ALLOW',
        allowed: true,
        policyVersion: '1.0.0',
        policyHash: 'sha256-test-hash',
        reason: 'Policy check passed',
      }),
    };

    const repo1 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const controller1 = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      taskRepository: repo1,
    });

    const authContext = createMockAuthContext();
    const { task } = await controller1.createTask(
      {
        title: 'Task to be cancelled',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'device:read',
      },
      authContext,
    );

    await controller1.cancelTask(task.taskId, 'Operator aborted task', authContext);
    assert.strictEqual(controller1.getTask(task.taskId)?.state, TaskLifecycleState.CANCELLED);

    controller1.close();

    // Reconstruct controller after restart
    const repo2 = new SqliteTaskRepository({ dbPath: dbFilePath });
    const controller2 = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator,
      taskRepository: repo2,
    });

    const cancelledTask = controller2.getTask(task.taskId);
    assert.strictEqual(cancelledTask?.state, TaskLifecycleState.CANCELLED);

    // Attempt late receipt settlement: must be rejected
    const output = { done: true };
    const unsignedReceipt = {
      receiptId: crypto.randomUUID(),
      taskId: task.taskId,
      leaseId: task.lease!.lease_id,
      agentId,
      tenantId: tenantA,
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum: computeEvidenceHash(output),
      output,
      completedAt: new Date().toISOString(),
    };
    const signature = computeReceiptSignature(unsignedReceipt, agentSecret);
    const receipt = { ...unsignedReceipt, signature };

    await assert.rejects(
      async () => controller2.settleReceipt(receipt),
      /task is already CANCELLED/,
    );

    // State remains CANCELLED
    assert.strictEqual(controller2.getTask(task.taskId)?.state, TaskLifecycleState.CANCELLED);

    controller2.close();
  });

  it('17. InMemoryTaskRepository and createTaskRepository factory integration', () => {
    const inMemRepo = new InMemoryTaskRepository();
    const task = createSampleTask({ title: 'In-memory test task' });
    inMemRepo.save(task);

    assert.strictEqual(inMemRepo.size, 1);
    assert.strictEqual(inMemRepo.findById(task.taskId)?.title, 'In-memory test task');

    const factoryRepo = createTaskRepository({ dbPath: ':memory:' });
    factoryRepo.save(task);
    assert.strictEqual(factoryRepo.findById(task.taskId)?.title, 'In-memory test task');
    factoryRepo.close();
  });
});
