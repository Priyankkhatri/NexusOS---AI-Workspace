/**
 * Task 067 — Vertical Slice Test: Authenticated SSE Telemetry Stream & Producer Event Instrumentation
 *
 * Verifies:
 * 1. SSE protocol headers & framing (text/event-stream, no-cache, event:, id:, data:)
 * 2. Cursor replay of retained events before live events
 * 3. Stream reset events on epoch mismatch, future sequence, or malformed cursor
 * 4. Periodic heartbeat comments (: ping\n\n) without cursor advancement
 * 5. Full producer instrumentation across:
 *    - TaskController (task.status_changed, approval.requested, approval.decided, telemetry.sample)
 *    - AgentDirectoryService (agent.status_changed)
 *    - DelegationCoordinator (delegation.created, delegation.progress, delegation.completed, delegation.cancelled)
 *    - GraphEvolutionEngine (graph.evolved)
 * 6. Security Invariants (067-SEC-01..08):
 *    - Unauthenticated request rejected with 401
 *    - Non-GET request rejected with 405 (read-only projection)
 *    - Concurrent connection limit enforced with 429
 *    - Cross-tenant isolation
 *    - Workspace scoping
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  InMemoryEventPublisherBoundary,
  TenantStreamEventBus,
  SSEStreamConnection,
  AgentDirectoryService,
  DelegationCoordinator,
  GraphEvolutionEngine,
  InMemoryMemoryStore,
  MemoryServiceContext,
  computeEvidenceHash,
  computeReceiptSignature,
} from '@nexusos/backend';
import {
  TaskLifecycleState,
  ExecutionLeaseHeader,
  MemoryClass,
  MemoryStatus,
  MemorySensitivity,
  MemorySourceType,
  MemoryRecord,
  GraphExtractionResult,
  ExecutionReceipt,
} from '@nexusos/contracts';
import { PolicyEffect } from '@nexusos/policy';
import { AuthenticatedContext, PrincipalType } from '@nexusos/identity';
import { NativeApprovalHost } from '@nexusos/desktop-agent';

interface ParsedEvent {
  event?: string;
  id?: string;
  data?: string;
  comment?: string;
  parsedData?: any;
}

function parseSSEChunk(raw: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const blocks = raw.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    const parsed: ParsedEvent = {};
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith(':')) {
        parsed.comment = line.substring(1).trim();
      } else if (line.startsWith('event:')) {
        parsed.event = line.substring(6).trim();
      } else if (line.startsWith('id:')) {
        parsed.id = line.substring(3).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.substring(5).trim());
      }
    }
    if (dataLines.length > 0) {
      parsed.data = dataLines.join('\n');
      try {
        parsed.parsedData = JSON.parse(parsed.data);
      } catch {
        // Raw string
      }
    }
    if (parsed.event || parsed.id || parsed.data || parsed.comment) {
      events.push(parsed);
    }
  }
  return events;
}

function openSSEConnection(
  url: string,
  headers: Record<string, string> = {},
): {
  req: http.ClientRequest;
  statusCode: Promise<number>;
  responseHeaders: Promise<http.IncomingHttpHeaders>;
  events: ParsedEvent[];
  waitForEvent: (
    predicate: (e: ParsedEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<ParsedEvent>;
  close: () => void;
} {
  const events: ParsedEvent[] = [];
  let buffer = '';
  const listeners: Array<(event: ParsedEvent) => void> = [];

  let resolveStatus: (status: number) => void;
  const statusCode = new Promise<number>((res) => {
    resolveStatus = res;
  });

  let resolveHeaders: (hdrs: http.IncomingHttpHeaders) => void;
  const responseHeaders = new Promise<http.IncomingHttpHeaders>((res) => {
    resolveHeaders = res;
  });

  const req = http.get(url, { headers }, (res) => {
    resolveStatus(res.statusCode ?? 0);
    resolveHeaders(res.headers);

    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      const boundaryIndex = buffer.lastIndexOf('\n\n');
      if (boundaryIndex !== -1) {
        const complete = buffer.substring(0, boundaryIndex + 2);
        buffer = buffer.substring(boundaryIndex + 2);
        const parsed = parseSSEChunk(complete);
        for (const p of parsed) {
          events.push(p);
          for (const l of [...listeners]) {
            l(p);
          }
        }
      }
    });
  });

  const waitForEvent = (
    predicate: (e: ParsedEvent) => boolean,
    timeoutMs: number = 5000,
  ): Promise<ParsedEvent> => {
    // Check existing
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for SSE event`));
      }, timeoutMs);

      const listener = (e: ParsedEvent) => {
        if (predicate(e)) {
          clearTimeout(timer);
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
          resolve(e);
        }
      };
      listeners.push(listener);
    });
  };

  const close = () => {
    req.destroy();
  };

  return { req, statusCode, responseHeaders, events, waitForEvent, close };
}

class AllowAllPolicyEvaluator {
  async evaluate(request: { context?: { requestId?: string; correlationId?: string } }) {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-policy-hash',
      reason: 'Allowed in test',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context?.requestId,
      correlationId: request.context?.correlationId,
    };
  }
  getSnapshot() {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-policy-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Task 067 — Vertical Slice: Authenticated SSE Stream & Event Producers', () => {
  const tenantId = crypto.randomUUID();
  const tenantOther = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let app: BackendApp;
  let baseUrl: string;
  let streamBus: TenantStreamEventBus;
  let leaseIssuer: LeaseIssuer;
  let taskController: TaskController;
  let agentDirectory: AgentDirectoryService;
  let delegationCoordinator: DelegationCoordinator;
  let approvalHost: NativeApprovalHost;
  let memoryStore: InMemoryMemoryStore;
  let evolutionEngine: GraphEvolutionEngine;

  const authContext: AuthenticatedContext = {
    principal: {
      type: PrincipalType.USER,
      userId,
      tenantId,
      roles: ['admin'],
    },
    tenantId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    rawTokenHash: 'test-token-hash',
  };

  const testAuthHeader = `Bearer test-token-${tenantId}`;
  const testOtherAuthHeader = `Bearer test-token-${tenantOther}`;

  before(async () => {
    streamBus = new TenantStreamEventBus();
    const config = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    leaseIssuer = new LeaseIssuer('test-secret-key-dashboard-067');
    const receiptVerifier = new ReceiptVerifier({ agentSecret: 'receipt-secret-dashboard-067' });
    const eventPublisher = new InMemoryEventPublisherBoundary();
    const policyEvaluator = new AllowAllPolicyEvaluator();
    approvalHost = new NativeApprovalHost();
    agentDirectory = new AgentDirectoryService({ streamEventBus: streamBus });
    delegationCoordinator = new DelegationCoordinator({
      agentDirectory,
      leaseIssuer,
      streamEventBus: streamBus,
    });

    taskController = new TaskController({
      leaseIssuer,
      receiptVerifier,
      policyEvaluator: policyEvaluator as any,
      eventPublisher,
      approvalHost,
      streamEventBus: streamBus,
    });

    memoryStore = new InMemoryMemoryStore();
    evolutionEngine = new GraphEvolutionEngine({
      store: memoryStore,
      streamEventBus: streamBus,
    });

    app = new BackendApp(config, {
      taskController,
      agentDirectory,
      delegationCoordinator,
      streamEventBus: streamBus,
      sseOptions: {
        heartbeatIntervalMs: 100, // fast heartbeat for tests
      },
      authenticator: async (req: any) => {
        const auth = req.headers['authorization'];
        if (auth && auth.includes('test-token-')) {
          const parsedTenant = auth.replace('Bearer test-token-', '').trim();
          req.authenticatedContext = {
            ...authContext,
            tenantId: parsedTenant,
            principal: { ...authContext.principal, tenantId: parsedTenant },
          };
          return true;
        }
        return false;
      },
    });

    const server = await app.start();
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await app.stop();
  });

  it('rejects unauthenticated request with 401', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`);
    const status = await conn.statusCode;
    assert.strictEqual(status, 401);
    conn.close();
  });

  it('rejects non-GET request with 405 Method Not Allowed (067-SEC-07)', async () => {
    const postReq = http.request(`${baseUrl}/v1/telemetry/stream`, {
      method: 'POST',
      headers: { Authorization: testAuthHeader },
    });

    const status = await new Promise<number>((res) => {
      postReq.on('response', (response) => {
        res(response.statusCode ?? 0);
      });
      postReq.end();
    });

    assert.strictEqual(status, 405);
  });

  it('connects to GET /v1/telemetry/stream and returns compliant SSE headers', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
    });

    const status = await conn.statusCode;
    assert.strictEqual(status, 200);

    const headers = await conn.responseHeaders;
    assert.match(headers['content-type'] ?? '', /text\/event-stream/i);
    assert.match(headers['cache-control'] ?? '', /no-cache/i);
    assert.match(headers['connection'] ?? '', /keep-alive/i);
    assert.strictEqual(headers['x-accel-buffering'], 'no');

    conn.close();
  });

  it('delivers live events formatted with event, id, and data lines', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
    });

    await conn.statusCode;

    // Publish event on streamBus
    const published = await streamBus.publish({
      schema_id: 'nexusos.events.telemetry.sample',
      tenant_id: tenantId,
      payload: {
        tenantId,
        activeTaskCount: 42,
        pendingApprovalCount: 1,
        completedTaskCount: 10,
        failedTaskCount: 0,
        connectedDeviceCount: 2,
        healthStatus: 'HEALTHY',
      },
    });

    const received = await conn.waitForEvent((e) => e.event === 'nexusos.events.telemetry.sample');

    assert.strictEqual(received.event, 'nexusos.events.telemetry.sample');
    assert.strictEqual(received.id, `${streamBus.streamEpochId}:${published.sequence_number}`);
    assert.ok(received.parsedData);
    assert.strictEqual(received.parsedData.payload.activeTaskCount, 42);

    conn.close();
  });

  it('replays buffered events when Last-Event-ID cursor is provided', async () => {
    // 1. Seed 3 events on the bus
    const e1 = await streamBus.publish({
      schema_id: 'nexusos.events.telemetry.sample',
      tenant_id: tenantId,
      payload: {
        tenantId,
        activeTaskCount: 10,
        pendingApprovalCount: 0,
        completedTaskCount: 1,
        failedTaskCount: 0,
        connectedDeviceCount: 1,
        healthStatus: 'HEALTHY',
      },
    });
    const e2 = await streamBus.publish({
      schema_id: 'nexusos.events.telemetry.sample',
      tenant_id: tenantId,
      payload: {
        tenantId,
        activeTaskCount: 20,
        pendingApprovalCount: 0,
        completedTaskCount: 2,
        failedTaskCount: 0,
        connectedDeviceCount: 1,
        healthStatus: 'HEALTHY',
      },
    });
    const e3 = await streamBus.publish({
      schema_id: 'nexusos.events.telemetry.sample',
      tenant_id: tenantId,
      payload: {
        tenantId,
        activeTaskCount: 30,
        pendingApprovalCount: 0,
        completedTaskCount: 3,
        failedTaskCount: 0,
        connectedDeviceCount: 1,
        healthStatus: 'HEALTHY',
      },
    });

    // 2. Connect with Last-Event-ID pointing to e1
    const cursor = `${streamBus.streamEpochId}:${e1.sequence_number}`;
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
      'Last-Event-ID': cursor,
    });

    await conn.statusCode;

    // Should receive e2 and e3 in order
    const receivedE2 = await conn.waitForEvent(
      (e) => e.id === `${streamBus.streamEpochId}:${e2.sequence_number}`,
    );
    assert.strictEqual(receivedE2.parsedData.payload.activeTaskCount, 20);

    const receivedE3 = await conn.waitForEvent(
      (e) => e.id === `${streamBus.streamEpochId}:${e3.sequence_number}`,
    );
    assert.strictEqual(receivedE3.parsedData.payload.activeTaskCount, 30);

    conn.close();
  });

  it('emits nexusos.events.stream.reset when cursor epoch does not match', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
      'Last-Event-ID': `${crypto.randomUUID()}:1`,
    });

    await conn.statusCode;

    const resetEvent = await conn.waitForEvent((e) => e.event === 'nexusos.events.stream.reset');
    assert.ok(resetEvent);
    assert.strictEqual(resetEvent.parsedData.reason, 'SERVER_EPOCH_CHANGED');
    assert.strictEqual(resetEvent.parsedData.currentEpoch, streamBus.streamEpochId);

    conn.close();
  });

  it('emits nexusos.events.stream.reset when cursor sequence is in the future', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
      'Last-Event-ID': `${streamBus.streamEpochId}:999999`,
    });

    await conn.statusCode;

    const resetEvent = await conn.waitForEvent((e) => e.event === 'nexusos.events.stream.reset');
    assert.ok(resetEvent);
    assert.strictEqual(resetEvent.parsedData.reason, 'FUTURE_CURSOR_DETECTED');

    conn.close();
  });

  it('emits nexusos.events.stream.reset on malformed cursor', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
      'Last-Event-ID': 'invalid_cursor_format',
    });

    await conn.statusCode;

    const resetEvent = await conn.waitForEvent((e) => e.event === 'nexusos.events.stream.reset');
    assert.ok(resetEvent);
    assert.strictEqual(resetEvent.parsedData.reason, 'MALFORMED_CURSOR');

    conn.close();
  });

  it('sends periodic : ping heartbeat comments without advancing sequence', async () => {
    const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testAuthHeader,
    });

    await conn.statusCode;

    const ping = await conn.waitForEvent((e) => e.comment === 'ping');
    assert.strictEqual(ping.comment, 'ping');
    assert.strictEqual(ping.event, undefined);
    assert.strictEqual(ping.id, undefined);

    conn.close();
  });

  it('enforces cross-tenant isolation: Tenant B never receives Tenant A events', async () => {
    const connOther = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
      Authorization: testOtherAuthHeader,
    });
    await connOther.statusCode;

    // Publish event exclusively in Tenant A
    await streamBus.publish({
      schema_id: 'nexusos.events.telemetry.sample',
      tenant_id: tenantId,
      payload: {
        tenantId,
        activeTaskCount: 99,
        pendingApprovalCount: 0,
        completedTaskCount: 0,
        failedTaskCount: 0,
        connectedDeviceCount: 1,
        healthStatus: 'HEALTHY',
      },
    });

    // Tenant B should not receive it within 200ms
    let receivedOther = false;
    try {
      await connOther.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.telemetry.sample' &&
          e.parsedData?.payload?.activeTaskCount === 99,
        200,
      );
      receivedOther = true;
    } catch {
      receivedOther = false;
    }

    assert.strictEqual(receivedOther, false);
    connOther.close();
  });

  describe('Authoritative Event Producer Instrumentation', () => {
    it('TaskController emits task.status_changed on createTask', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      const targetAgentId = crypto.randomUUID();
      await taskController.createTask(
        {
          title: 'Instrumented Task Test',
          targetAgentId,
          capabilityId: 'fs:read',
          runtimeCategory: 'FILESYSTEM',
          parameters: { path: '/tmp/test' },
          requestedScope: 'fs:read',
        },
        authContext,
      );

      const event = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.task.status_changed' &&
          e.parsedData?.payload?.title === 'Instrumented Task Test',
      );

      assert.strictEqual(event.parsedData.payload.state, TaskLifecycleState.SUBMITTED);
      assert.strictEqual(event.parsedData.tenant_id, tenantId);

      conn.close();
    });

    it('TaskController emits approval.requested and approval.decided on approval flow', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      const promptTaskId = crypto.randomUUID();
      const promptLease: ExecutionLeaseHeader = {
        lease_id: crypto.randomUUID(),
        task_id: promptTaskId,
        tenant_id: tenantId,
        agent_id: 'agent-1',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        scopes: ['fs:delete'],
        signature: 'valid-sig',
        nonce: crypto.randomUUID(),
      };

      const promptReq = {
        leaseHeader: promptLease,
        requestId: crypto.randomUUID(),
        taskId: promptTaskId,
        tenantId,
        title: 'Delete Sensitive File',
        description: 'Requires approval',
        riskTier: 'HIGH' as const,
        actionIdentifier: 'fs.delete',
        expiresAt: Date.now() + 60000,
      };

      const promptItem = await taskController.presentApprovalPrompt(promptReq);

      const reqEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.approval.requested' &&
          e.parsedData?.payload?.promptId === promptItem.promptId,
      );
      assert.strictEqual(reqEvent.parsedData.payload.actionIdentifier, 'fs.delete');

      // Now decide approval
      await taskController.submitApprovalDecision(
        {
          promptId: promptItem.promptId,
          decision: 'ALLOW',
          nonce: promptItem.nonce,
          leaseHeader: promptLease,
          tenantId,
          userNotes: 'Approved for test',
        },
        authContext,
      );

      const decEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.approval.decided' &&
          e.parsedData?.payload?.promptId === promptItem.promptId,
      );
      assert.strictEqual(decEvent.parsedData.payload.decision, 'ALLOW');
      assert.strictEqual(decEvent.parsedData.payload.userNotes, 'Approved for test');

      conn.close();
    });

    it('TaskController emits telemetry.sample via sampleTelemetry', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      await taskController.sampleTelemetry(tenantId);

      const sampleEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.telemetry.sample' && e.parsedData?.tenant_id === tenantId,
      );
      assert.ok(sampleEvent.parsedData.payload);
      assert.strictEqual(typeof sampleEvent.parsedData.payload.activeTaskCount, 'number');

      conn.close();
    });

    it('AgentDirectoryService emits agent.status_changed on register and heartbeat', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      const agentId = `agent-${crypto.randomUUID()}`;

      // Register
      agentDirectory.registerAgent({
        agentId,
        tenantId,
        workspaceScope: ['ws-1'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
        role: 'WORKER',
        capabilities: ['fs:read'],
      });

      const regEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.agent.status_changed' &&
          e.parsedData?.payload?.agentId === agentId &&
          e.parsedData?.payload?.status === 'AVAILABLE',
      );
      assert.strictEqual(regEvent.parsedData.payload.role, 'WORKER');

      // Heartbeat with BUSY
      agentDirectory.recordHeartbeat({
        agentId,
        tenantId,
        status: 'BUSY',
        timestamp: new Date().toISOString(),
        currentLoad: 0.8,
        activeTaskIds: ['task-busy-1'],
      });

      const hbEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.agent.status_changed' &&
          e.parsedData?.payload?.agentId === agentId &&
          e.parsedData?.payload?.status === 'BUSY',
      );
      assert.strictEqual(hbEvent.parsedData.payload.currentLoad, 0.8);

      conn.close();
    });

    it('DelegationCoordinator emits delegation.created, progress, completed, cancelled', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      const workspaceId = crypto.randomUUID();

      agentDirectory.registerAgent({
        agentId: 'root-agent',
        tenantId,
        workspaceScope: [workspaceId],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
        role: 'COORDINATOR',
        capabilities: ['data.process', 'data.cleanup'],
      });
      agentDirectory.registerAgent({
        agentId: 'child-agent-1',
        tenantId,
        workspaceScope: [workspaceId],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
        role: 'WORKER',
        capabilities: ['data.process'],
      });
      agentDirectory.registerAgent({
        agentId: 'child-agent-2',
        tenantId,
        workspaceScope: [workspaceId],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
        role: 'WORKER',
        capabilities: ['data.cleanup'],
      });

      const parentTaskId1 = crypto.randomUUID();
      const parentLease1 = leaseIssuer.issueLease({
        taskId: parentTaskId1,
        tenantId,
        agentId: 'root-agent',
        scopes: ['data.process'],
        ttlSeconds: 300,
      });

      // 1. delegateSubTask -> delegation.created
      const delegation = await delegationCoordinator.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId: parentTaskId1,
          parentLeaseId: parentLease1.lease_id,
          delegatorAgentId: 'root-agent',
          targetAgentId: 'child-agent-1',
          tenantId,
          workspaceId,
          subGoal: 'Process test dataset',
          capabilityId: 'data.process',
          requestedScopes: ['data.process'],
          delegationDepth: 1,
          idempotencyKey: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
        },
        parentLease1,
      );

      const createdEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.delegation.created' &&
          e.parsedData?.payload?.delegationId === delegation.delegationId,
      );
      assert.strictEqual(createdEvent.parsedData.payload.assignedAgentId, 'child-agent-1');

      // 2. recordProgress -> delegation.progress
      await delegationCoordinator.recordProgress(delegation.childTaskId, 50, 'Halfway done');

      const progEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.delegation.progress' &&
          e.parsedData?.payload?.delegationId === delegation.delegationId,
      );
      assert.strictEqual(progEvent.parsedData.payload.progressPercent, 50);

      // 3. settleChildReceipt -> delegation.completed
      const receipt: ExecutionReceipt = {
        receiptId: crypto.randomUUID(),
        taskId: delegation.childTaskId,
        leaseId: delegation.childLeaseId,
        tenantId,
        agentId: 'child-agent-1',
        status: 'SUCCESS',
        exitCode: 0,
        evidenceChecksum: 'a'.repeat(64),
        completedAt: new Date().toISOString(),
        signature: 'valid-sig',
      };
      delegationCoordinator.settleChildReceipt(receipt);

      const compEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.delegation.completed' &&
          e.parsedData?.payload?.delegationId === delegation.delegationId,
      );
      assert.strictEqual(compEvent.parsedData.payload.status, 'COMPLETED');

      // 4. cancelDelegation -> delegation.cancelled
      const parentTaskId2 = crypto.randomUUID();
      const parentLease2 = leaseIssuer.issueLease({
        taskId: parentTaskId2,
        tenantId,
        agentId: 'root-agent',
        scopes: ['data.cleanup'],
        ttlSeconds: 300,
      });

      const del2 = await delegationCoordinator.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId: parentTaskId2,
          parentLeaseId: parentLease2.lease_id,
          delegatorAgentId: 'root-agent',
          targetAgentId: 'child-agent-2',
          tenantId,
          workspaceId,
          subGoal: 'Clean up test dataset',
          capabilityId: 'data.cleanup',
          delegationDepth: 1,
          requestedScopes: ['data.cleanup'],
          idempotencyKey: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
        },
        parentLease2,
      );

      delegationCoordinator.cancelDelegation(del2.parentTaskId);

      const cancelEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.delegation.cancelled' &&
          e.parsedData?.payload?.delegationId === del2.delegationId,
      );
      assert.ok(cancelEvent.parsedData.payload.reason);

      conn.close();
    });

    it('GraphEvolutionEngine emits graph.evolved on evolveCandidates', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      const memCtx: MemoryServiceContext = {
        tenantId,
        workspaceId: 'workspace-mem-1',
        principalId: 'test-principal',
      };

      // Seed parent memory record
      const parentRecord: MemoryRecord = {
        id: crypto.randomUUID(),
        tenantId,
        workspaceId: 'workspace-mem-1',
        ownerId: 'test-principal',
        title: 'Initial Concept',
        content: 'Exploration of system architectures',
        class: MemoryClass.EPISODIC,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        confidence: 1.0,
        tags: ['arch'],
        metadata: {},
        provenance: {
          timestamp: new Date().toISOString(),
          sourceType: MemorySourceType.TASK_EXECUTION,
          creatorPrincipalId: 'test-principal',
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await memoryStore.create(parentRecord);

      const candidates: GraphExtractionResult = {
        memoryRecordId: parentRecord.id,
        tenantId,
        workspaceId: 'workspace-mem-1',
        nodes: [
          {
            candidateId: 'cand-node-1',
            label: 'Microservices',
            nodeType: 'CONCEPT' as any,
            memoryRecordId: parentRecord.id,
            tenantId,
            workspaceId: 'workspace-mem-1',
            properties: { category: 'architecture' },
            confidence: 0.9,
            provenance: parentRecord.provenance,
          },
        ],
        edges: [],
        truncated: false,
        extractedAt: new Date().toISOString(),
        executionDurationMs: 12,
      };

      await evolutionEngine.evolveCandidates(parentRecord, candidates, memCtx);

      const evolvedEvent = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.graph.evolved' &&
          e.parsedData?.payload?.recordId === parentRecord.id,
      );
      assert.ok(evolvedEvent.parsedData.payload);
      assert.strictEqual(evolvedEvent.parsedData.payload.recordId, parentRecord.id);
      assert.strictEqual(evolvedEvent.parsedData.payload.nodeCount, 1);

      conn.close();
    });

    it('publishes task.status_changed with accurate previous and current states across SUBMITTED, LEASED, COMPLETED, FAILED, CANCELLED', async () => {
      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      const wsScoped = crypto.randomUUID();

      // A. Create task -> SUBMITTED (previous undefined), then LEASED (previous POLICY_EVALUATED)
      const taskRes = await taskController.createTask(
        {
          title: 'Lifecycle States Test',
          targetAgentId: crypto.randomUUID(),
          capabilityId: 'test.run',
          runtimeCategory: 'TEST',
          parameters: {},
          requestedScope: 'test.run',
          metadata: { workspaceId: wsScoped },
        },
        { ...authContext, workspaceId: wsScoped },
      );

      const submittedEvt = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.task.status_changed' &&
          e.parsedData?.payload?.taskId === taskRes.task.taskId &&
          e.parsedData?.payload?.state === TaskLifecycleState.SUBMITTED,
      );
      assert.strictEqual(submittedEvt.parsedData.payload.previousState, undefined);
      assert.strictEqual(submittedEvt.parsedData.payload.workspaceId, wsScoped);

      const leasedEvt = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.task.status_changed' &&
          e.parsedData?.payload?.taskId === taskRes.task.taskId &&
          e.parsedData?.payload?.state === TaskLifecycleState.LEASED,
      );
      assert.strictEqual(
        leasedEvt.parsedData.payload.previousState,
        TaskLifecycleState.POLICY_EVALUATED,
      );

      // B. Cancel task -> CANCELLED (previous was LEASED)
      await taskController.cancelTask(taskRes.task.taskId, 'Testing cancellation', authContext);

      const cancelEvt = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.task.status_changed' &&
          e.parsedData?.payload?.taskId === taskRes.task.taskId &&
          e.parsedData?.payload?.state === TaskLifecycleState.CANCELLED,
      );
      assert.strictEqual(cancelEvt.parsedData.payload.previousState, TaskLifecycleState.LEASED);
      assert.strictEqual(cancelEvt.parsedData.payload.error?.code, 'TASK_CANCELLED');

      // C. Settle Receipt -> COMPLETED (previous was LEASED)
      const task2Res = await taskController.createTask(
        {
          title: 'Settlement Test',
          targetAgentId: crypto.randomUUID(),
          capabilityId: 'test.run',
          runtimeCategory: 'TEST',
          parameters: {},
          requestedScope: 'test.run',
        },
        authContext,
      );

      const evidenceChecksum = computeEvidenceHash({});
      const receiptWithoutSig = {
        receiptId: crypto.randomUUID(),
        taskId: task2Res.task.taskId,
        leaseId: task2Res.task.lease!.lease_id,
        tenantId,
        agentId: task2Res.task.targetAgentId,
        status: 'SUCCESS' as const,
        exitCode: 0,
        evidenceChecksum,
        completedAt: new Date().toISOString(),
      };
      const receipt: ExecutionReceipt = {
        ...receiptWithoutSig,
        signature: computeReceiptSignature(receiptWithoutSig, 'receipt-secret-dashboard-067'),
      };

      await taskController.settleReceipt(receipt);

      const completedEvt = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.task.status_changed' &&
          e.parsedData?.payload?.taskId === task2Res.task.taskId &&
          e.parsedData?.payload?.state === TaskLifecycleState.COMPLETED,
      );
      assert.strictEqual(completedEvt.parsedData.payload.previousState, TaskLifecycleState.LEASED);

      // D. Settle Receipt with failure -> FAILED
      const task3Res = await taskController.createTask(
        {
          title: 'Failure Settlement Test',
          targetAgentId: crypto.randomUUID(),
          capabilityId: 'test.run',
          runtimeCategory: 'TEST',
          parameters: {},
          requestedScope: 'test.run',
        },
        authContext,
      );

      const failEvidenceChecksum = computeEvidenceHash({});
      const failReceiptWithoutSig = {
        receiptId: crypto.randomUUID(),
        taskId: task3Res.task.taskId,
        leaseId: task3Res.task.lease!.lease_id,
        tenantId,
        agentId: task3Res.task.targetAgentId,
        status: 'FAILURE' as const,
        exitCode: 1,
        errorMessage: 'Execution error occurred',
        evidenceChecksum: failEvidenceChecksum,
        completedAt: new Date().toISOString(),
      };
      const failReceipt: ExecutionReceipt = {
        ...failReceiptWithoutSig,
        signature: computeReceiptSignature(failReceiptWithoutSig, 'receipt-secret-dashboard-067'),
      };

      await taskController.settleReceipt(failReceipt);

      const failedEvt = await conn.waitForEvent(
        (e) =>
          e.event === 'nexusos.events.task.status_changed' &&
          e.parsedData?.payload?.taskId === task3Res.task.taskId &&
          e.parsedData?.payload?.state === TaskLifecycleState.FAILED,
      );
      assert.strictEqual(failedEvt.parsedData.payload.previousState, TaskLifecycleState.LEASED);
      assert.strictEqual(failedEvt.parsedData.payload.error?.code, 'EXECUTION_FAILED');

      conn.close();
    });
  });

  describe('Replay to Live Transition & Boundary Hardening (Section 3 & 7)', () => {
    it('handles replay -> live transition without loss or duplication when replay buffer has multi-workspace events', async () => {
      const wsA = crypto.randomUUID();
      const wsB = crypto.randomUUID();

      // 1. Initial event in wsA (seq 1)
      const eA1 = await streamBus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantId,
        workspace_id: wsA,
        payload: {
          tenantId,
          activeTaskCount: 1,
          pendingApprovalCount: 0,
          completedTaskCount: 0,
          failedTaskCount: 0,
          connectedDeviceCount: 1,
          healthStatus: 'HEALTHY',
        },
      });

      // 2. Events in wsB with higher sequences (seq 2, seq 3)
      await streamBus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantId,
        workspace_id: wsB,
        payload: {
          tenantId,
          activeTaskCount: 2,
          pendingApprovalCount: 0,
          completedTaskCount: 0,
          failedTaskCount: 0,
          connectedDeviceCount: 1,
          healthStatus: 'HEALTHY',
        },
      });
      await streamBus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantId,
        workspace_id: wsB,
        payload: {
          tenantId,
          activeTaskCount: 3,
          pendingApprovalCount: 0,
          completedTaskCount: 0,
          failedTaskCount: 0,
          connectedDeviceCount: 1,
          healthStatus: 'HEALTHY',
        },
      });

      // 3. Connect subscriber scoped to wsA with cursor before eA1
      const received: any[] = [];
      const handle = streamBus.subscribe({
        tenantId,
        workspaceId: wsA,
        cursor: `${streamBus.streamEpochId}:${eA1.sequence_number - 1}`,
        listener: (evt) => {
          received.push(evt);
        },
      });

      // 4. Publish live event in wsA (seq 4)
      const liveEvent = await streamBus.publish({
        schema_id: 'nexusos.events.telemetry.sample',
        tenant_id: tenantId,
        workspace_id: wsA,
        payload: {
          tenantId,
          activeTaskCount: 4,
          pendingApprovalCount: 0,
          completedTaskCount: 0,
          failedTaskCount: 0,
          connectedDeviceCount: 1,
          healthStatus: 'HEALTHY',
        },
      });

      // Subscriber should have received eA1 from replay and liveEvent from live queue
      // Should NOT have received wsB events
      assert.strictEqual(received.length, 2);
      assert.strictEqual(received[0].sequence_number, eA1.sequence_number);
      assert.strictEqual(received[1].sequence_number, liveEvent.sequence_number);

      handle.unsubscribe();
    });

    it('enforces maximum 10 concurrent streams per tenant (rejects 11th with 429)', async () => {
      const tenantStreams = crypto.randomUUID();
      const streamsAuth = `Bearer test-token-${tenantStreams}`;

      const connections: ReturnType<typeof openSSEConnection>[] = [];
      try {
        // Open 10 connections
        for (let i = 0; i < 10; i++) {
          const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
            Authorization: streamsAuth,
          });
          const status = await conn.statusCode;
          assert.strictEqual(status, 200);
          connections.push(conn);
        }

        // 11th connection must be rejected with 429
        const conn11 = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
          Authorization: streamsAuth,
        });
        const status11 = await conn11.statusCode;
        assert.strictEqual(status11, 429);
        conn11.close();
      } finally {
        for (const conn of connections) {
          conn.close();
        }
      }
    });

    it('terminates subscriber connection safely when outbound backpressure exceeds queue limit', async () => {
      // Create mock response that simulates backpressure
      const fakeReq = new http.IncomingMessage({} as any);
      const fakeRes = new http.ServerResponse(fakeReq);

      // Override write to return false (simulating full TCP socket buffer / backpressure)
      (fakeRes as any).write = () => false;

      const sseConn = new SSEStreamConnection(fakeReq, fakeRes, {
        maxQueueSize: 3,
        maxQueueBytes: 1024,
      });

      const subHandle = streamBus.subscribe({
        tenantId,
        listener: (evt) => sseConn.sendEvent(evt),
      });
      sseConn.bindSubscription(subHandle);

      assert.strictEqual(sseConn.closed, false);

      // Emit 5 events (limit is 3)
      for (let i = 0; i < 5; i++) {
        await streamBus.publish({
          schema_id: 'nexusos.events.telemetry.sample',
          tenant_id: tenantId,
          payload: {
            tenantId,
            activeTaskCount: i,
            pendingApprovalCount: 0,
            completedTaskCount: 0,
            failedTaskCount: 0,
            connectedDeviceCount: 1,
            healthStatus: 'HEALTHY',
          },
        });
      }

      // Consumer queue limit exceeded -> sseConn must have closed automatically
      assert.strictEqual(sseConn.closed, true);
      assert.strictEqual(subHandle.isSubscribed(), false);
    });

    it('decrements active stream count and cleans up resources when client terminates connection', async () => {
      const initialCount = streamBus.getActiveStreamCount(tenantId);

      const conn = openSSEConnection(`${baseUrl}/v1/telemetry/stream`, {
        Authorization: testAuthHeader,
      });
      await conn.statusCode;

      assert.strictEqual(streamBus.getActiveStreamCount(tenantId), initialCount + 1);

      conn.close();

      // Wait briefly for disconnect event propagation
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(streamBus.getActiveStreamCount(tenantId), initialCount);
    });
  });
});
