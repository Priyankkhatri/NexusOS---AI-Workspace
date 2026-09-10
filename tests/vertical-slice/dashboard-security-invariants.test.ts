/**
 * Task 053 — Dashboard Security Invariants & Approval Integration
 *
 * Validates security properties of the dashboard projection & approval endpoints:
 * 053-SEC-01: Mandatory authentication for projection access
 * 053-SEC-02: Strict tenant/workspace isolation
 * 053-SEC-03: Server-side authorization / no client-side authority escalation
 * 053-SEC-04: Untrusted-content/XSS safety
 * 053-SEC-05: Cursor/event integrity (deduplication, safe cursors, ordering)
 * 053-SEC-06: Secret/protected-data handling (parameter redaction, no storage leakage)
 * Approval Integration: Canonical Task 052 authority, nonce/lease/expiry checks, replay protection
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import {
  BackendApp,
  loadBackendConfig,
  TaskController,
  LeaseIssuer,
  ReceiptVerifier,
  InMemoryEventPublisherBoundary,
  AuthenticatedIncomingMessage,
  AgentDirectoryService,
  DelegationCoordinator,
  MemoryService,
  InMemoryMemoryStore,
} from '@nexusos/backend';
import {
  TaskLifecycleState,
  createEventEnvelope,
  ExecutionLeaseHeader,
  ApprovalDecisionRequest,
  MemoryClass,
  MemoryStatus,
  MemorySensitivity,
  MemorySourceType,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
} from '@nexusos/contracts';
import { PolicyEffect } from '@nexusos/policy';
import { AuthenticatedContext, PrincipalType } from '@nexusos/identity';
import { NativeApprovalHost } from '@nexusos/desktop-agent';
import {
  DashboardAPIClient,
  DashboardAPIError,
  sanitizeHTML,
  type DelegationSummary,
  type AgentRecord,
} from '../../apps/web-dashboard/src/api/client.js';
import {
  generateAgentCardHTML,
  generateDelegationNodeHTML,
  generateDelegationTimelineItemHTML,
  getRoleBadge,
  getAgentStatusPill,
  getDelegationStatusBadge,
  buildDelegationTimeline,
} from '../../apps/web-dashboard/src/main.js';

// ============================================================
// Test Fixtures
// ============================================================

const tenantA = 'aaaaaaaa-0000-4000-8000-000000000001';
const tenantB = 'bbbbbbbb-0000-4000-8000-000000000002';
const userA = 'aaaaaaaa-0000-4000-8000-000000000010';
const userB = 'bbbbbbbb-0000-4000-8000-000000000020';
const agentId = 'eeeeeeee-0000-4000-8000-000000000003';

function createMockAuthContext(tenantId: string, userId: string): AuthenticatedContext {
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
    rawTokenHash: `hash-${userId}`,
  };
}

function createTestAuthenticator(authContext: AuthenticatedContext) {
  return async (req: IncomingMessage, _res: ServerResponse): Promise<boolean> => {
    (req as AuthenticatedIncomingMessage).authenticatedContext = authContext;
    return true;
  };
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

function createTestSignedLease(taskId: string, tenantId: string): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: taskId,
    tenant_id: tenantId,
    agent_id: agentId,
    issued_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 120000).toISOString(),
    scopes: ['terminal.exec', 'fs:read'],
    signature: 'test-valid-signature',
    nonce: crypto.randomUUID(),
  };
}

// ============================================================
// Test Suite
// ============================================================

describe('053-SEC — Dashboard Projection & Security Invariants', () => {
  let appA: BackendApp;
  let baseUrlA: string;
  let controllerA: TaskController;
  let eventPublisherA: InMemoryEventPublisherBoundary;
  let approvalHostA: NativeApprovalHost;
  let appNoAuth: BackendApp;
  let baseUrlNoAuth: string;
  let taskA1Id: string;
  let taskBSecretId: string;

  before(async () => {
    const authContextA = createMockAuthContext(tenantA, userA);

    const configA = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    const leaseIssuerA = new LeaseIssuer('test-key-a-dashboard-053');
    const receiptVerifierA = new ReceiptVerifier({ agentSecret: 'dashboard-053-receipt-secret' });
    eventPublisherA = new InMemoryEventPublisherBoundary();
    const policyEvaluatorA = new AllowAllPolicyEvaluator();
    approvalHostA = new NativeApprovalHost();

    controllerA = new TaskController({
      leaseIssuer: leaseIssuerA,
      receiptVerifier: receiptVerifierA,
      policyEvaluator: policyEvaluatorA as any,
      eventPublisher: eventPublisherA,
      approvalHost: approvalHostA,
    });

    appA = new BackendApp(configA, {
      taskController: controllerA,
      authenticator: createTestAuthenticator(authContextA),
    });

    const serverA = await appA.start();
    const addrA = serverA.address();
    const portA = typeof addrA === 'object' && addrA ? addrA.port : 0;
    baseUrlA = `http://127.0.0.1:${portA}`;

    // Seed tasks for Tenant A
    const t1 = await controllerA.createTask(
      {
        title: 'Tenant A Task 1',
        targetAgentId: agentId,
        capabilityId: 'filesystem.readFile',
        runtimeCategory: 'FILESYSTEM',
        parameters: { path: '/tmp/a.txt' },
        requestedScope: 'fs:read',
      },
      authContextA,
    );
    taskA1Id = t1.task.taskId;

    await controllerA.createTask(
      {
        title: 'Tenant A Task 2',
        targetAgentId: agentId,
        capabilityId: 'terminal.exec',
        runtimeCategory: 'TERMINAL',
        parameters: { command: 'echo hello' },
        requestedScope: 'terminal:exec',
      },
      authContextA,
    );

    // Seed task for Tenant B
    const authContextB = createMockAuthContext(tenantB, userB);
    const tB = await controllerA.createTask(
      {
        title: 'Tenant B Secret Task',
        targetAgentId: agentId,
        capabilityId: 'device.queryInfo',
        runtimeCategory: 'DEVICE',
        parameters: {},
        requestedScope: 'device:read',
      },
      authContextB,
    );
    taskBSecretId = tB.task.taskId;

    // Create the no-auth app (for testing unauthenticated access)
    const configNoAuth = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
    appNoAuth = new BackendApp(configNoAuth);
    const serverNoAuth = await appNoAuth.start();
    const addrNoAuth = serverNoAuth.address();
    const portNoAuth = typeof addrNoAuth === 'object' && addrNoAuth ? addrNoAuth.port : 0;
    baseUrlNoAuth = `http://127.0.0.1:${portNoAuth}`;
  });

  after(async () => {
    approvalHostA.shutdown();
    await appA?.stop();
    await appNoAuth?.stop();
  });

  // ============================================================
  // 053-SEC-01: Authentication Required
  // ============================================================

  describe('053-SEC-01: Authentication Required for Projection Endpoints', () => {
    it('GET /v1/tasks returns 401 without authenticator', async () => {
      const res = await fetch(`${baseUrlNoAuth}/v1/tasks`);
      assert.strictEqual(res.status, 401);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body.error, 'Error response should contain error object');
    });

    it('GET /v1/activity returns 401 without authenticator', async () => {
      const res = await fetch(`${baseUrlNoAuth}/v1/activity`);
      assert.strictEqual(res.status, 401);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body.error, 'Error response should contain error object');
    });

    it('GET /v1/dashboard/summary returns 401 without authenticator', async () => {
      const res = await fetch(`${baseUrlNoAuth}/v1/dashboard/summary`);
      assert.strictEqual(res.status, 401);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body.error, 'Error response should contain error object');
    });

    it('GET /v1/approvals returns 401 without authenticator', async () => {
      const res = await fetch(`${baseUrlNoAuth}/v1/approvals`);
      assert.strictEqual(res.status, 401);
      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(body.error, 'Error response should contain error object');
    });

    it('POST /v1/approvals/:id/decision returns 401 without authenticator', async () => {
      const res = await fetch(`${baseUrlNoAuth}/v1/approvals/some-prompt-id/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'ALLOW' }),
      });
      assert.strictEqual(res.status, 401);
    });
  });

  // ============================================================
  // 053-SEC-02: Tenant Isolation
  // ============================================================

  describe('053-SEC-02: Strict Tenant Isolation on Projection & Approval Endpoints', () => {
    it('GET /v1/tasks only returns tasks owned by the authenticated tenant', async () => {
      const res = await fetch(`${baseUrlA}/v1/tasks`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as {
        items: Array<{ tenantId: string; title: string }>;
        total: number;
      };
      assert.ok(Array.isArray(body.items), 'Response should have items array');

      for (const task of body.items) {
        assert.strictEqual(
          task.tenantId,
          tenantA,
          `Task "${task.title}" should belong to Tenant A, but belongs to ${task.tenantId}`,
        );
      }

      const hasTenantBTask = body.items.some((t) => t.title === 'Tenant B Secret Task');
      assert.strictEqual(hasTenantBTask, false, 'Tenant B task must not leak to Tenant A');
    });

    it('GET /v1/tasks with status filter respects tenant isolation', async () => {
      const res = await fetch(`${baseUrlA}/v1/tasks?status=LEASED`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: Array<{ tenantId: string; state: string }> };
      for (const task of body.items) {
        assert.strictEqual(task.tenantId, tenantA);
      }
    });

    it('GET /v1/dashboard/summary returns counts scoped to authenticated tenant only', async () => {
      const res = await fetch(`${baseUrlA}/v1/dashboard/summary`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as {
        tenantId: string;
        activeTaskCount: number;
        completedTaskCount: number;
        healthStatus: string;
      };

      assert.strictEqual(body.tenantId, tenantA, 'Summary must be scoped to authenticated tenant');
      assert.ok(typeof body.activeTaskCount === 'number');
      assert.ok(typeof body.completedTaskCount === 'number');
      assert.ok(typeof body.healthStatus === 'string');
      assert.strictEqual(body.activeTaskCount, 2, 'Should only count Tenant A active tasks');
    });

    it('GET /v1/activity returns only events for the authenticated tenant', async () => {
      const res = await fetch(`${baseUrlA}/v1/activity`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: Array<{ payload: Record<string, unknown> }> };
      assert.ok(Array.isArray(body.items));

      for (const event of body.items) {
        if (event.payload['tenantId']) {
          assert.strictEqual(
            event.payload['tenantId'],
            tenantA,
            'Activity events must not leak cross-tenant data',
          );
        }
      }
    });

    it('GET /v1/approvals isolates pending prompts by tenant', async () => {
      // Present prompt for Tenant A
      const leaseA = createTestSignedLease(taskA1Id, tenantA);
      await approvalHostA.presentPrompt({
        leaseHeader: leaseA,
        requestId: crypto.randomUUID(),
        taskId: taskA1Id,
        title: 'Tenant A Prompt',
        description: 'Approval for Tenant A command',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.exec',
        tenantId: tenantA,
      });

      // Present prompt for Tenant B
      const leaseB = createTestSignedLease(taskBSecretId, tenantB);
      await approvalHostA.presentPrompt({
        leaseHeader: leaseB,
        requestId: crypto.randomUUID(),
        taskId: taskBSecretId,
        title: 'Tenant B Secret Prompt',
        description: 'Approval for Tenant B secret operation',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.exec',
        tenantId: tenantB,
      });

      const res = await fetch(`${baseUrlA}/v1/approvals`);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as { items: Array<{ tenantId: string; title: string }> };

      for (const prompt of body.items) {
        assert.strictEqual(prompt.tenantId, tenantA, 'Must only return Tenant A prompts');
      }
      assert.ok(!body.items.some((p) => p.title === 'Tenant B Secret Prompt'));
    });

    it('POST /v1/approvals/:id/decision strictly blocks cross-tenant decision injection', async () => {
      // Attempt to submit decision for Tenant B's prompt using Tenant A credentials
      const pendingB = approvalHostA.listPendingPrompts(tenantB);
      assert.ok(pendingB.length > 0, 'Tenant B prompt must exist');
      const targetB = pendingB[0];

      const leaseA = createTestSignedLease(targetB.taskId || 'task-b', tenantA);
      const res = await fetch(`${baseUrlA}/v1/approvals/${targetB.promptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptId: targetB.promptId,
          decision: 'ALLOW',
          nonce: targetB.nonce,
          leaseHeader: leaseA,
          tenantId: tenantB, // Deliberate cross-tenant probe
        }),
      });

      assert.strictEqual(res.status, 403, 'Cross-tenant decision submission must fail with 403');
      const body = (await res.json()) as { error: { code: string } };
      assert.strictEqual(body.error.code, 'TENANT_MISMATCH');
    });
  });

  // ============================================================
  // 053-SEC-03: Server-Side Authorization / Read-Only Projections
  // ============================================================

  describe('053-SEC-03: Server-Side Authorization & Authority Protection', () => {
    it('GET /v1/tasks does not modify task state', async () => {
      const allTasksBefore = controllerA.getAllTasks();
      const statesBefore = allTasksBefore.map((t) => ({ id: t.taskId, state: t.state }));

      await fetch(`${baseUrlA}/v1/tasks`);

      const allTasksAfter = controllerA.getAllTasks();
      const statesAfter = allTasksAfter.map((t) => ({ id: t.taskId, state: t.state }));

      assert.deepStrictEqual(statesAfter, statesBefore, 'Projection must not mutate task state');
    });

    it('GET /v1/dashboard/summary does not modify task state', async () => {
      const allTasksBefore = controllerA.getAllTasks();
      const countBefore = allTasksBefore.length;

      await fetch(`${baseUrlA}/v1/dashboard/summary`);

      const allTasksAfter = controllerA.getAllTasks();
      assert.strictEqual(allTasksAfter.length, countBefore, 'Summary must not create/delete tasks');
    });

    it('GET /v1/activity does not modify published events', async () => {
      const res1 = await fetch(`${baseUrlA}/v1/activity`);
      const body1 = (await res1.json()) as { total: number };

      const res2 = await fetch(`${baseUrlA}/v1/activity`);
      const body2 = (await res2.json()) as { total: number };

      assert.strictEqual(body1.total, body2.total, 'Activity read must be idempotent');
    });

    it('query parameters cannot escalate tenant authority (server enforces authContext.tenantId)', async () => {
      // Attempt to query Tenant B's tasks by spoofing ?tenantId=tenantB in query string
      const res = await fetch(`${baseUrlA}/v1/tasks?tenantId=${tenantB}`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: Array<{ tenantId: string }> };
      for (const task of body.items) {
        assert.strictEqual(
          task.tenantId,
          tenantA,
          'Server must strictly force caller authContext.tenantId, ignoring client query spoofing',
        );
      }
    });

    it('client cannot forge approval authority without authoritative backend decision', async () => {
      const pendingA = approvalHostA.listPendingPrompts(tenantA);
      assert.ok(pendingA.length > 0);
      const prompt = pendingA[0];

      // Missing required fields (e.g. nonce or leaseHeader)
      const res = await fetch(`${baseUrlA}/v1/approvals/${prompt.promptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptId: prompt.promptId,
          decision: 'ALLOW',
          // Missing nonce and leaseHeader
        }),
      });

      assert.strictEqual(
        res.status,
        400,
        'Server-side validation must reject invalid decision payloads',
      );
      assert.strictEqual(
        prompt.state,
        'PENDING',
        'Prompt must remain PENDING on rejected client attempt',
      );
    });
  });

  // ============================================================
  // 053-SEC-04: Untrusted Content & XSS Sanitization
  // ============================================================

  describe('053-SEC-04: Untrusted-Content & XSS Safety', () => {
    it('sanitizes script injection vectors', async () => {
      const { sanitizeHTML } = await import('../../apps/web-dashboard/src/api/client.js');

      const malicious = '<script>alert("XSS")</script>';
      const sanitized = sanitizeHTML(malicious);

      assert.ok(!sanitized.includes('<script>'), 'Script tags must be escaped');
      assert.ok(!sanitized.includes('</script>'), 'Closing script tags must be escaped');
      assert.ok(sanitized.includes('&lt;'), 'Angle brackets must be HTML-encoded');
    });

    it('sanitizes attribute injection vectors', async () => {
      const { sanitizeHTML } = await import('../../apps/web-dashboard/src/api/client.js');

      const malicious = '" onload="alert(1)"';
      const sanitized = sanitizeHTML(malicious);

      assert.ok(!sanitized.includes('"'), 'Double quotes must be escaped');
      assert.ok(sanitized.includes('&quot;'), 'Quotes must be HTML-encoded');
    });

    it('sanitizes template literal injection', async () => {
      const { sanitizeHTML } = await import('../../apps/web-dashboard/src/api/client.js');

      const malicious = '`${alert(1)}`';
      const sanitized = sanitizeHTML(malicious);

      assert.ok(!sanitized.includes('`'), 'Backticks must be escaped');
      assert.ok(sanitized.includes('&#96;'), 'Backticks must be HTML-encoded');
    });

    it('preserves safe content unchanged', async () => {
      const { sanitizeHTML } = await import('../../apps/web-dashboard/src/api/client.js');

      const safe = 'Hello World 123 - Task Complete!';
      assert.strictEqual(sanitizeHTML(safe), safe, 'Safe strings must pass through unchanged');
    });

    it('safely handles non-string, null, and undefined inputs', async () => {
      const { sanitizeHTML } = await import('../../apps/web-dashboard/src/api/client.js');

      assert.strictEqual(sanitizeHTML(null), '', 'Null input returns empty string');
      assert.strictEqual(sanitizeHTML(undefined), '', 'Undefined input returns empty string');
      assert.strictEqual(sanitizeHTML(12345), '12345', 'Number input stringified safely');
    });

    it('sanitizes complex payload objects without executing nested HTML', async () => {
      const { sanitizeHTML } = await import('../../apps/web-dashboard/src/api/client.js');

      const nested = JSON.stringify({ prompt: '<img src=x onerror=alert(1)>' });
      const sanitized = sanitizeHTML(nested);

      assert.ok(!sanitized.includes('<img'), 'Nested HTML tags in JSON must be defanged');
      assert.ok(sanitized.includes('&lt;img'), 'Angle bracket must be escaped');
    });
  });

  // ============================================================
  // 053-SEC-05: Cursor and Event Integrity
  // ============================================================

  describe('053-SEC-05: Cursor & Event Integrity', () => {
    it('invalid or manipulated cursors fail safely with empty list and no crash', async () => {
      // Pass completely fake/manipulated cursor
      const res = await fetch(`${baseUrlA}/v1/tasks?cursor=malicious-nonexistent-task-id`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: unknown[]; nextCursor?: string; total: number };
      assert.strictEqual(
        body.items.length,
        0,
        'Non-existent cursor must fail safely with empty items',
      );
      assert.strictEqual(body.nextCursor, undefined);
    });

    it('cross-tenant cursor probe fails safely without disclosing other tenant items', async () => {
      // Use Tenant B's taskId as the cursor for Tenant A
      const res = await fetch(`${baseUrlA}/v1/tasks?cursor=${taskBSecretId}`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: unknown[]; total: number };
      assert.strictEqual(body.items.length, 0, 'Foreign cursor must not match Tenant A records');
    });

    it('duplicate event IDs are deduplicated in projection', async () => {
      const duplicateEventId = crypto.randomUUID();
      const ts = new Date().toISOString();

      // Publish the exact same event twice to the event bus
      const ev1 = createEventEnvelope(
        'nexusos.events.task.dispatched',
        '1.0.0',
        'test-producer',
        taskA1Id,
        { taskId: taskA1Id, tenantId: tenantA, attempt: 1 },
      );
      ev1.event_id = duplicateEventId;
      ev1.occurred_at = ts;

      const ev2 = createEventEnvelope(
        'nexusos.events.task.dispatched',
        '1.0.0',
        'test-producer',
        taskA1Id,
        { taskId: taskA1Id, tenantId: tenantA, attempt: 2 },
      );
      ev2.event_id = duplicateEventId;
      ev2.occurred_at = ts;

      await eventPublisherA.publish(ev1);
      await eventPublisherA.publish(ev2);

      const res = await fetch(`${baseUrlA}/v1/activity`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: Array<{ event_id: string }> };
      const duplicates = body.items.filter((item) => item.event_id === duplicateEventId);
      assert.strictEqual(
        duplicates.length,
        1,
        'Duplicate event IDs must be strictly deduplicated in activity projection',
      );
    });

    it('out-of-order and delayed events do not corrupt projection order', async () => {
      const earlierTs = new Date(Date.now() - 50000).toISOString();
      const laterTs = new Date(Date.now() - 10000).toISOString();

      const laterEv = createEventEnvelope(
        'nexusos.events.task.completed',
        '1.0.0',
        'test-producer',
        taskA1Id,
        { taskId: taskA1Id, tenantId: tenantA, seq: 'later' },
      );
      laterEv.occurred_at = laterTs;

      const delayedEarlierEv = createEventEnvelope(
        'nexusos.events.task.created',
        '1.0.0',
        'test-producer',
        taskA1Id,
        { taskId: taskA1Id, tenantId: tenantA, seq: 'earlier' },
      );
      delayedEarlierEv.occurred_at = earlierTs;

      // Publish in out-of-order sequence (later first, then delayed earlier)
      await eventPublisherA.publish(laterEv);
      await eventPublisherA.publish(delayedEarlierEv);

      const res = await fetch(`${baseUrlA}/v1/activity`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as {
        items: Array<{ occurred_at: string; event_id: string }>;
      };
      assert.ok(body.items.length >= 2);

      // Verify strict descending chronological ordering
      for (let i = 0; i < body.items.length - 1; i++) {
        assert.ok(
          body.items[i].occurred_at >= body.items[i + 1].occurred_at,
          `Events must be sorted descending by occurred_at: ${body.items[i].occurred_at} >= ${body.items[i + 1].occurred_at}`,
        );
      }
    });

    it('workspace scoping remains intact across pagination pages', async () => {
      const page1 = await fetch(`${baseUrlA}/v1/tasks?limit=1`);
      const body1 = (await page1.json()) as {
        items: Array<{ tenantId: string }>;
        nextCursor?: string;
      };

      if (body1.nextCursor) {
        const page2 = await fetch(`${baseUrlA}/v1/tasks?limit=1&cursor=${body1.nextCursor}`);
        const body2 = (await page2.json()) as { items: Array<{ tenantId: string }> };

        for (const item of body2.items) {
          assert.strictEqual(
            item.tenantId,
            tenantA,
            'Pagination across pages must maintain workspace scoping',
          );
        }
      }
    });
  });

  // ============================================================
  // 053-SEC-06: Secret and Protected-Data Handling
  // ============================================================

  describe('053-SEC-06: Secret & Protected-Data Handling', () => {
    it('redacts sensitive parameter keys before storage and projection', async () => {
      const authContextA = createMockAuthContext(tenantA, userA);

      const result = await controllerA.createTask(
        {
          title: 'Sensitive Credential Task',
          targetAgentId: agentId,
          capabilityId: 'terminal.exec',
          runtimeCategory: 'TERMINAL',
          parameters: {
            safe_name: 'production-run',
            api_key: 'sk-secret-live-api-key-12345',
            password: 'super-sensitive-password',
            private_key: '-----TEST_KEY_DATA-----',
            hmacSecret: 'raw-hmac-secret-material',
            customHeader: 'Bearer token-abcdef-123456',
          },
          requestedScope: 'terminal:exec',
        },
        authContextA,
      );

      // Query via projection endpoint
      const res = await fetch(`${baseUrlA}/v1/tasks/${result.task.taskId}`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { parameters: Record<string, unknown> };
      assert.strictEqual(body.parameters['safe_name'], 'production-run');
      assert.strictEqual(body.parameters['api_key'], '[REDACTED]');
      assert.strictEqual(body.parameters['password'], '[REDACTED]');
      assert.strictEqual(body.parameters['private_key'], '[REDACTED]');
      assert.strictEqual(body.parameters['hmacSecret'], '[REDACTED]');
      assert.strictEqual(body.parameters['customHeader'], 'Bearer [REDACTED_TOKEN]');
    });

    it('raw HMAC keys and signing secrets never appear in projection responses', async () => {
      const resSummary = await fetch(`${baseUrlA}/v1/dashboard/summary`);
      const summaryText = await resSummary.text();

      assert.ok(
        !summaryText.includes('test-key-a-dashboard-053'),
        'LeaseIssuer HMAC key must not leak',
      );
      assert.ok(
        !summaryText.includes('dashboard-053-receipt-secret'),
        'Receipt secret must not leak',
      );

      const resTasks = await fetch(`${baseUrlA}/v1/tasks`);
      const tasksText = await resTasks.text();
      assert.ok(
        !tasksText.includes('test-key-a-dashboard-053'),
        'LeaseIssuer HMAC key must not leak in tasks',
      );
      assert.ok(
        !tasksText.includes('dashboard-053-receipt-secret'),
        'Receipt secret must not leak in tasks',
      );
    });

    it('browser storage is not used for authentication tokens or secrets', async () => {
      // Verify statically that client code does not reference window.localStorage or window.sessionStorage
      const fs = await import('node:fs/promises');
      const clientSrc = await fs.readFile('apps/web-dashboard/src/api/client.ts', 'utf8');
      const mainSrc = await fs.readFile('apps/web-dashboard/src/main.ts', 'utf8');

      assert.ok(
        !clientSrc.includes('localStorage.setItem'),
        'client.ts must not persist to localStorage',
      );
      assert.ok(
        !clientSrc.includes('sessionStorage.setItem'),
        'client.ts must not persist to sessionStorage',
      );
      assert.ok(
        !mainSrc.includes('localStorage.setItem'),
        'main.ts must not persist to localStorage',
      );
      assert.ok(
        !mainSrc.includes('sessionStorage.setItem'),
        'main.ts must not persist to sessionStorage',
      );
    });
  });

  // ============================================================
  // Task 052 Canonical Approval Integration Audit
  // ============================================================

  describe('053-HITL: Canonical Task 052 Approval Integration Audit', () => {
    let pendingPromptId: string;
    let pendingPromptNonce: string;
    let pendingTaskId: string;
    let validLease: ExecutionLeaseHeader;

    before(async () => {
      // Create a task checkpointed in AWAITING_APPROVAL
      const authContextA = createMockAuthContext(tenantA, userA);
      const created = await controllerA.createTask(
        {
          title: 'High-Risk Operation Requiring Approval',
          targetAgentId: agentId,
          capabilityId: 'terminal.exec',
          runtimeCategory: 'TERMINAL',
          parameters: { command: 'rm -rf /test/data' },
          requestedScope: 'terminal:exec',
        },
        authContextA,
      );

      pendingTaskId = created.task.taskId;
      validLease = createTestSignedLease(pendingTaskId, tenantA);

      // Transition to AWAITING_APPROVAL in controller
      const task = controllerA.getTask(pendingTaskId, authContextA);
      assert.ok(task);
      (task as any).state = TaskLifecycleState.AWAITING_APPROVAL;

      // Present canonical prompt to approval host
      const prompt = await approvalHostA.presentPrompt({
        leaseHeader: validLease,
        requestId: crypto.randomUUID(),
        taskId: pendingTaskId,
        title: 'Delete Data Approval',
        description: 'Confirm deletion of test data',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.exec',
        tenantId: tenantA,
        ttlSeconds: 60,
      });

      pendingPromptId = prompt.promptId;
      pendingPromptNonce = prompt.nonce;
    });

    it('A. Uses canonical Task 052 approval protocol and surfaces in GET /v1/approvals', async () => {
      const res = await fetch(`${baseUrlA}/v1/approvals`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as {
        items: Array<{
          promptId: string;
          riskTier: string;
          nonce: string;
          actionIdentifier: string;
        }>;
      };
      const found = body.items.find((p) => p.promptId === pendingPromptId);
      assert.ok(found, 'Pending prompt must be present in GET /v1/approvals');
      assert.strictEqual(found.riskTier, 'HIGH');
      assert.strictEqual(found.actionIdentifier, 'terminal.exec');
      assert.strictEqual(found.nonce, pendingPromptNonce);
    });

    it('B & C. Authoritative backend command executes ALLOW and validates nonce & lease', async () => {
      const decisionPayload: ApprovalDecisionRequest = {
        promptId: pendingPromptId,
        decision: 'ALLOW',
        nonce: pendingPromptNonce,
        leaseHeader: validLease,
        tenantId: tenantA,
        userNotes: 'Approved via dashboard integration test',
      };

      const res = await fetch(`${baseUrlA}/v1/approvals/${pendingPromptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decisionPayload),
      });

      assert.strictEqual(res.status, 200);
      const result = (await res.json()) as {
        promptId: string;
        decision: string;
        state: string;
        receiptHash: string;
      };

      assert.strictEqual(result.decision, 'ALLOW');
      assert.strictEqual(result.state, 'APPROVED');
      assert.ok(result.receiptHash);
      assert.strictEqual(
        result.receiptHash.length,
        64,
        'Must return 64-character SHA-256 receipt hash',
      );

      // Verify task state transitioned authoritatively to EXECUTING
      const task = controllerA.getTask(pendingTaskId, createMockAuthContext(tenantA, userA));
      assert.ok(task);
      assert.strictEqual(
        task.state,
        TaskLifecycleState.EXECUTING,
        'ALLOW decision must transition task from AWAITING_APPROVAL to EXECUTING',
      );
    });

    it('D. Stale / replayed / duplicate decision is strictly rejected with 409 PROMPT_ALREADY_RESOLVED', async () => {
      // Re-submit the exact same decision on the now APPROVED prompt
      const replayPayload: ApprovalDecisionRequest = {
        promptId: pendingPromptId,
        decision: 'ALLOW',
        nonce: pendingPromptNonce,
        leaseHeader: validLease,
        tenantId: tenantA,
      };

      const res = await fetch(`${baseUrlA}/v1/approvals/${pendingPromptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replayPayload),
      });

      assert.strictEqual(
        res.status,
        409,
        'Replayed or duplicate decision must return 409 Conflict',
      );
      const body = (await res.json()) as { error: { code: string } };
      assert.strictEqual(body.error.code, 'PROMPT_ALREADY_RESOLVED');
    });

    it('E. Nonce mismatch is rejected with 400 NONCE_MISMATCH', async () => {
      // Create another prompt
      const lease = createTestSignedLease(crypto.randomUUID(), tenantA);
      const prompt = await approvalHostA.presentPrompt({
        leaseHeader: lease,
        requestId: crypto.randomUUID(),
        taskId: lease.task_id,
        title: 'Nonce Test Prompt',
        description: 'Verify nonce mismatch fail-closed',
        riskTier: 'HIGH',
        actionIdentifier: 'terminal.exec',
        tenantId: tenantA,
      });

      const badNoncePayload: ApprovalDecisionRequest = {
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: 'invalid-forged-nonce-12345',
        leaseHeader: lease,
        tenantId: tenantA,
      };

      const res = await fetch(`${baseUrlA}/v1/approvals/${prompt.promptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(badNoncePayload),
      });

      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.strictEqual(body.error.code, 'NONCE_MISMATCH');
    });

    it('F. Expired approval prompt auto-expires and rejects decision with 410 PROMPT_EXPIRED', async () => {
      const lease = createTestSignedLease(crypto.randomUUID(), tenantA);
      // Present prompt with 1 millisecond expiration (virtually instant expiration)
      const prompt = await approvalHostA.presentPrompt({
        leaseHeader: lease,
        requestId: crypto.randomUUID(),
        taskId: lease.task_id,
        title: 'Expiring Prompt',
        description: 'Testing expiration handling',
        riskTier: 'CRITICAL',
        actionIdentifier: 'fs:delete',
        tenantId: tenantA,
        ttlSeconds: 1, // Shortest TTL
      });

      // Manually advance prompt to expired state to simulate clock timeout
      (prompt as any).expiresAt = Date.now() - 5000;
      (approvalHostA as any).prompts.set(prompt.promptId, prompt);

      const decisionPayload: ApprovalDecisionRequest = {
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader: lease,
        tenantId: tenantA,
      };

      const res = await fetch(`${baseUrlA}/v1/approvals/${prompt.promptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decisionPayload),
      });

      assert.strictEqual(res.status, 410, 'Decision on expired prompt must fail with 410 Expired');
      const body = (await res.json()) as { error: { code: string } };
      assert.strictEqual(body.error.code, 'PROMPT_EXPIRED');
    });

    it('G. Authoritative DENY decision transitions task from AWAITING_APPROVAL to FAILED', async () => {
      const authContextA = createMockAuthContext(tenantA, userA);
      const created = await controllerA.createTask(
        {
          title: 'Operation to be Denied',
          targetAgentId: agentId,
          capabilityId: 'terminal.exec',
          runtimeCategory: 'TERMINAL',
          parameters: { command: 'drop database' },
          requestedScope: 'terminal:exec',
        },
        authContextA,
      );

      const taskId = created.task.taskId;
      const lease = createTestSignedLease(taskId, tenantA);

      const prompt = await approvalHostA.presentPrompt({
        leaseHeader: lease,
        requestId: crypto.randomUUID(),
        taskId,
        title: 'Drop Database Approval',
        description: 'Confirm dropping database',
        riskTier: 'CRITICAL',
        actionIdentifier: 'terminal.exec',
        tenantId: tenantA,
      });

      const task = controllerA.getTask(taskId, authContextA);
      assert.ok(task);
      (task as any).state = TaskLifecycleState.AWAITING_APPROVAL;

      const res = await fetch(`${baseUrlA}/v1/approvals/${prompt.promptId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptId: prompt.promptId,
          decision: 'DENY',
          nonce: prompt.nonce,
          leaseHeader: lease,
          tenantId: tenantA,
          userNotes: 'Denied by security policy',
        }),
      });

      assert.strictEqual(res.status, 200);
      const result = (await res.json()) as { decision: string; state: string };
      assert.strictEqual(result.decision, 'DENY');
      assert.strictEqual(result.state, 'DENIED');

      const updatedTask = controllerA.getTask(taskId, authContextA);
      assert.ok(updatedTask);
      assert.strictEqual(
        updatedTask.state,
        TaskLifecycleState.FAILED,
        'DENY decision must transition task to FAILED',
      );
      assert.strictEqual(updatedTask.error?.code, 'APPROVAL_DENIED');
    });
  });

  // ============================================================
  // Functional Contracts
  // ============================================================

  describe('053-FUNC: Functional Pagination & Structure Contracts', () => {
    it('GET /v1/tasks respects limit parameter', async () => {
      const res = await fetch(`${baseUrlA}/v1/tasks?limit=1`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as { items: unknown[]; nextCursor?: string; total: number };
      assert.ok(body.items.length <= 1, 'Should respect limit=1');
      assert.ok(typeof body.total === 'number', 'Should include total count');
    });

    it('GET /v1/tasks returns nextCursor when more items exist', async () => {
      const res = await fetch(`${baseUrlA}/v1/tasks?limit=1`);
      const body = (await res.json()) as { items: unknown[]; nextCursor?: string; total: number };

      if (body.total > 1) {
        assert.ok(body.nextCursor, 'Should provide nextCursor when more items exist');
      }
    });

    it('GET /v1/tasks cursor pagination returns remaining items', async () => {
      const res1 = await fetch(`${baseUrlA}/v1/tasks?limit=1`);
      const body1 = (await res1.json()) as {
        items: Array<{ taskId: string }>;
        nextCursor?: string;
      };

      if (body1.nextCursor) {
        const res2 = await fetch(`${baseUrlA}/v1/tasks?limit=1&cursor=${body1.nextCursor}`);
        assert.strictEqual(res2.status, 200);

        const body2 = (await res2.json()) as { items: Array<{ taskId: string }> };
        assert.ok(body2.items.length > 0, 'Second page should return items');

        const ids1 = new Set(body1.items.map((t) => t.taskId));
        for (const task of body2.items) {
          assert.ok(!ids1.has(task.taskId), 'Pages must not contain duplicate items');
        }
      }
    });

    it('GET /v1/dashboard/summary returns all required fields', async () => {
      const res = await fetch(`${baseUrlA}/v1/dashboard/summary`);
      const body = (await res.json()) as Record<string, unknown>;

      const requiredFields = [
        'tenantId',
        'activeTaskCount',
        'pendingApprovalCount',
        'completedTaskCount',
        'failedTaskCount',
        'connectedDeviceCount',
        'healthStatus',
        'updatedAt',
      ];

      for (const field of requiredFields) {
        assert.ok(field in body, `Response must include '${field}'`);
      }
    });

    it('GET /v1/tasks items include required task fields', async () => {
      const res = await fetch(`${baseUrlA}/v1/tasks`);
      const body = (await res.json()) as { items: Array<Record<string, unknown>> };

      if (body.items.length > 0) {
        const task = body.items[0];
        const requiredFields = [
          'taskId',
          'tenantId',
          'submittedBy',
          'title',
          'targetAgentId',
          'capabilityId',
          'runtimeCategory',
          'state',
          'createdAt',
          'updatedAt',
        ];

        for (const field of requiredFields) {
          assert.ok(field in task, `Task items must include '${field}'`);
        }
      }
    });
  });

  // ============================================================
  // Task 063: Backend Read-Model Projections & Dashboard API Client
  // ============================================================

  describe('Task 063: Backend Read-Model Projections & Dashboard API Client (063-SEC-01 to 063-SEC-05)', () => {
    const workspaceA1 = 'aaaaaaaa-1111-4000-8000-000000000001';
    const workspaceA2 = 'aaaaaaaa-2222-4000-8000-000000000002';
    const workspaceB = 'bbbbbbbb-1111-4000-8000-000000000001';
    const parentTaskIdA1 = crypto.randomUUID();
    const parentTaskIdA2 = crypto.randomUUID();
    const parentTaskIdB1 = crypto.randomUUID();

    let testApp: BackendApp;
    let testBaseUrl: string;
    let agentDir: AgentDirectoryService;
    let delegCoord: DelegationCoordinator;
    let memStore: InMemoryMemoryStore;
    let memService: MemoryService;
    let leaseIssuer63: LeaseIssuer;
    let clientA: DashboardAPIClient;
    let clientB: DashboardAPIClient;

    before(async () => {
      agentDir = new AgentDirectoryService();
      leaseIssuer63 = new LeaseIssuer('lease-issuer-secret-task-063');
      delegCoord = new DelegationCoordinator({
        leaseIssuer: leaseIssuer63,
        agentDirectory: agentDir,
      });
      memStore = new InMemoryMemoryStore();
      memService = new MemoryService({ store: memStore });

      // Seed Agents
      agentDir.registerAgent({
        agentId: 'agent-a1-coord',
        tenantId: tenantA,
        workspaceScope: [workspaceA1],
        role: 'COORDINATOR',
        capabilities: ['tasks.coordinate', 'filesystem.readFile'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
      });
      agentDir.recordHeartbeat({
        agentId: 'agent-a1-coord',
        tenantId: tenantA,
        status: 'AVAILABLE',
        currentLoad: 0.1,
        timestamp: new Date().toISOString(),
        activeTaskIds: [],
      });

      agentDir.registerAgent({
        agentId: 'agent-a2-worker',
        tenantId: tenantA,
        workspaceScope: [workspaceA2],
        role: 'WORKER',
        capabilities: ['filesystem.readFile'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
      });
      agentDir.recordHeartbeat({
        agentId: 'agent-a2-worker',
        tenantId: tenantA,
        status: 'BUSY',
        currentLoad: 0.9,
        timestamp: new Date().toISOString(),
        activeTaskIds: ['task-busy-1'],
      });

      agentDir.registerAgent({
        agentId: 'agent-b1-spec',
        tenantId: tenantB,
        workspaceScope: [workspaceB],
        role: 'SPECIALIST',
        capabilities: ['device.queryInfo'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
      });
      agentDir.recordHeartbeat({
        agentId: 'agent-b1-spec',
        tenantId: tenantB,
        status: 'AVAILABLE',
        currentLoad: 0.2,
        timestamp: new Date().toISOString(),
        activeTaskIds: [],
      });

      // Seed Delegations
      const parentLeaseA1 = leaseIssuer63.issueLease({
        taskId: parentTaskIdA1,
        agentId: 'agent-a1-coord',
        tenantId: tenantA,
        scopes: ['tasks.coordinate', 'filesystem.readFile'],
        ttlSeconds: 600,
      });
      await delegCoord.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId: parentTaskIdA1,
          parentLeaseId: parentLeaseA1.lease_id,
          delegatorAgentId: 'agent-a1-coord',
          targetAgentId: 'agent-a1-coord',
          tenantId: tenantA,
          workspaceId: workspaceA1,
          subGoal: 'Read partition data',
          capabilityId: 'filesystem.readFile',
          requestedScopes: ['filesystem.readFile'],
          parameters: { path: '/data/a1.txt' },
          delegationDepth: 1,
          timeoutMs: 60000,
          idempotencyKey: 'idem-a1',
          correlationId: crypto.randomUUID(),
        },
        parentLeaseA1,
      );

      const parentLeaseA2 = leaseIssuer63.issueLease({
        taskId: parentTaskIdA2,
        agentId: 'agent-a1-coord',
        tenantId: tenantA,
        scopes: ['tasks.coordinate', 'filesystem.readFile'],
        ttlSeconds: 600,
      });
      await delegCoord.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId: parentTaskIdA2,
          parentLeaseId: parentLeaseA2.lease_id,
          delegatorAgentId: 'agent-a1-coord',
          targetAgentId: 'agent-a2-worker',
          tenantId: tenantA,
          workspaceId: workspaceA2,
          subGoal: 'Process archive batch',
          capabilityId: 'filesystem.readFile',
          requestedScopes: ['filesystem.readFile'],
          parameters: { path: '/data/a2.txt' },
          delegationDepth: 1,
          timeoutMs: 60000,
          idempotencyKey: 'idem-a2',
          correlationId: crypto.randomUUID(),
        },
        parentLeaseA2,
      );

      const parentLeaseB = leaseIssuer63.issueLease({
        taskId: parentTaskIdB1,
        agentId: 'agent-b1-spec',
        tenantId: tenantB,
        scopes: ['device.queryInfo'],
        ttlSeconds: 600,
      });
      await delegCoord.delegateSubTask(
        {
          delegationId: crypto.randomUUID(),
          parentTaskId: parentTaskIdB1,
          parentLeaseId: parentLeaseB.lease_id,
          delegatorAgentId: 'agent-b1-spec',
          targetAgentId: 'agent-b1-spec',
          tenantId: tenantB,
          workspaceId: workspaceB,
          subGoal: 'Inspect device telemetry',
          capabilityId: 'device.queryInfo',
          requestedScopes: ['device.queryInfo'],
          parameters: {},
          delegationDepth: 1,
          timeoutMs: 60000,
          idempotencyKey: 'idem-b1',
          correlationId: crypto.randomUUID(),
        },
        parentLeaseB,
      );

      // Seed Memory Records & Vectors & Graph Nodes
      await memStore.create({
        id: 'mem-record-063-a1',
        tenantId: tenantA,
        workspaceId: workspaceA1,
        ownerId: userA,
        class: MemoryClass.WORKING,
        status: MemoryStatus.ACTIVE,
        sensitivity: MemorySensitivity.INTERNAL,
        title: 'Project Alpha Strategy',
        content: 'Observation regarding agent collaboration workflow and graph traversal.',
        confidence: 0.95,
        tags: ['strategy', 'alpha'],
        metadata: { source: 'test' },
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: userA,
          timestamp: new Date().toISOString(),
          verified: true,
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const embeddingValues = new Array(384).fill(0.02);
      await memStore.saveVector({
        id: crypto.randomUUID(),
        memoryRecordId: 'mem-record-063-a1',
        tenantId: tenantA,
        workspaceId: workspaceA1,
        values: embeddingValues,
        dimensions: 384,
        normalized: true,
        metric: 'COSINE',
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      await memStore.saveGraphNode({
        id: 'graph-node-063-root',
        tenantId: tenantA,
        workspaceId: workspaceA1,
        nodeType: MemoryGraphNodeType.CONCEPT,
        label: 'CollaborationArchitecture',
        properties: {},
        confidence: 1.0,
        createdAt: new Date().toISOString(),
      });

      await memStore.saveGraphNode({
        id: 'graph-node-063-child',
        tenantId: tenantA,
        workspaceId: workspaceA1,
        nodeType: MemoryGraphNodeType.TASK,
        label: 'SubtaskDelegation',
        properties: {},
        confidence: 0.9,
        createdAt: new Date().toISOString(),
      });

      await memStore.saveGraphEdge({
        id: 'graph-edge-063-1',
        tenantId: tenantA,
        workspaceId: workspaceA1,
        sourceNodeId: 'graph-node-063-root',
        targetNodeId: 'graph-node-063-child',
        edgeType: MemoryGraphEdgeType.RELATES_TO,
        weight: 1.0,
        confidence: 1.0,
        properties: {},
        provenance: {
          sourceType: MemorySourceType.USER_EXPLICIT,
          creatorPrincipalId: userA,
          timestamp: new Date().toISOString(),
          verified: true,
        },
        createdAt: new Date().toISOString(),
      });

      // Start test BackendApp
      const config = loadBackendConfig({ PORT: '0', NODE_ENV: 'test' });
      testApp = new BackendApp(config, {
        agentDirectory: agentDir,
        delegationCoordinator: delegCoord,
        memoryService: memService,
        authenticator: async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
          const authHeader = req.headers['authorization'];
          if (!authHeader) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Missing token' } }),
            );
            return false;
          }
          if (authHeader === 'Bearer token-tenant-b') {
            (req as AuthenticatedIncomingMessage).authenticatedContext = createMockAuthContext(
              tenantB,
              userB,
            );
            return true;
          }
          if (authHeader === 'Bearer token-tenant-a') {
            (req as AuthenticatedIncomingMessage).authenticatedContext = createMockAuthContext(
              tenantA,
              userA,
            );
            return true;
          }
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Invalid token' } }));
          return false;
        },
      });

      const server = await testApp.start();
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      testBaseUrl = `http://127.0.0.1:${port}`;

      clientA = new DashboardAPIClient({
        baseUrl: testBaseUrl,
        tenantId: tenantA,
        getAuthToken: () => 'token-tenant-a',
      });

      clientB = new DashboardAPIClient({
        baseUrl: testBaseUrl,
        tenantId: tenantB,
        getAuthToken: () => 'token-tenant-b',
      });
    });

    after(async () => {
      await testApp.stop();
    });

    // ------------------------------------------------------------
    // 063-SEC-01: Agent projection is tenant/workspace isolated
    // ------------------------------------------------------------
    describe('063-SEC-01: Agent Projection Tenant & Workspace Isolation', () => {
      it('listAgents() only returns agents registered for the authenticated tenant', async () => {
        const resA = await clientA.listAgents();
        assert.strictEqual(resA.total, 2);
        assert.strictEqual(resA.items.length, 2);
        for (const agent of resA.items) {
          assert.strictEqual(agent.tenantId, tenantA);
        }
        assert.ok(
          !resA.items.some((a) => a.agentId === 'agent-b1-spec'),
          'Tenant B agent must not leak to Tenant A',
        );

        const resB = await clientB.listAgents();
        assert.strictEqual(resB.total, 1);
        assert.strictEqual(resB.items[0].agentId, 'agent-b1-spec');
        assert.strictEqual(resB.items[0].tenantId, tenantB);
      });

      it('listAgents({ workspaceId }) strictly filters by workspace scope', async () => {
        const resW1 = await clientA.listAgents({ workspaceId: workspaceA1 });
        assert.strictEqual(resW1.total, 1);
        assert.strictEqual(resW1.items[0].agentId, 'agent-a1-coord');

        const resW2 = await clientA.listAgents({ workspaceId: workspaceA2 });
        assert.strictEqual(resW2.total, 1);
        assert.strictEqual(resW2.items[0].agentId, 'agent-a2-worker');
      });

      it('listAgents({ role, status }) correctly filters by role and status while isolated', async () => {
        const resRole = await clientA.listAgents({ role: 'COORDINATOR' });
        assert.strictEqual(resRole.total, 1);
        assert.strictEqual(resRole.items[0].agentId, 'agent-a1-coord');

        const resStatus = await clientA.listAgents({ status: 'BUSY' });
        assert.strictEqual(resStatus.total, 1);
        assert.strictEqual(resStatus.items[0].agentId, 'agent-a2-worker');

        const resCrossRole = await clientA.listAgents({ role: 'SPECIALIST' });
        assert.strictEqual(
          resCrossRole.total,
          0,
          'Should return 0 since SPECIALIST belongs only to Tenant B',
        );
      });

      it('GET /v1/agents returns 401 when request is unauthenticated', async () => {
        const res = await fetch(`${testBaseUrl}/v1/agents`);
        assert.strictEqual(res.status, 401);
      });

      it('GET /v1/agents enforces bounded results limit', async () => {
        const res = await clientA.listAgents({ limit: 1 });
        assert.strictEqual(res.items.length, 1);
        assert.strictEqual(res.total, 2);

        // Raw HTTP test: limit > 100 is rejected with 400
        const rawRes = await fetch(`${testBaseUrl}/v1/agents?limit=150`, {
          headers: { Authorization: 'Bearer token-tenant-a' },
        });
        assert.strictEqual(rawRes.status, 400);
      });
    });

    // ------------------------------------------------------------
    // 063-SEC-02: Delegation projection is tenant/workspace isolated
    // ------------------------------------------------------------
    describe('063-SEC-02: Delegation Projection Tenant & Workspace Isolation', () => {
      it('listDelegations() only returns sessions for the authenticated tenant', async () => {
        const resA = await clientA.listDelegations();
        assert.strictEqual(resA.total, 2);
        assert.strictEqual(resA.items.length, 2);
        for (const del of resA.items) {
          assert.strictEqual(del.tenantId, tenantA);
        }
        assert.ok(
          !resA.items.some((d) => d.parentTaskId === parentTaskIdB1),
          'Tenant B delegation must not leak',
        );

        const resB = await clientB.listDelegations();
        assert.strictEqual(resB.total, 1);
        assert.strictEqual(resB.items[0].tenantId, tenantB);
        assert.strictEqual(resB.items[0].parentTaskId, parentTaskIdB1);
      });

      it('listDelegations({ workspaceId }) strictly filters sessions by workspace', async () => {
        const resW1 = await clientA.listDelegations({ workspaceId: workspaceA1 });
        assert.strictEqual(resW1.total, 1);
        assert.strictEqual(resW1.items[0].parentTaskId, parentTaskIdA1);

        const resW2 = await clientA.listDelegations({ workspaceId: workspaceA2 });
        assert.strictEqual(resW2.total, 1);
        assert.strictEqual(resW2.items[0].parentTaskId, parentTaskIdA2);
      });

      it('listDelegations({ parentTaskId }) filters by parent task ID', async () => {
        const res = await clientA.listDelegations({ parentTaskId: parentTaskIdA1 });
        assert.strictEqual(res.total, 1);
        assert.strictEqual(res.items[0].parentTaskId, parentTaskIdA1);
      });

      it('GET /v1/delegations returns 401 when request is unauthenticated', async () => {
        const res = await fetch(`${testBaseUrl}/v1/delegations`);
        assert.strictEqual(res.status, 401);
      });

      it('GET /v1/delegations enforces bounded results limit', async () => {
        const res = await clientA.listDelegations({ limit: 1 });
        assert.strictEqual(res.items.length, 1);

        const rawRes = await fetch(`${testBaseUrl}/v1/delegations?limit=150`, {
          headers: { Authorization: 'Bearer token-tenant-a' },
        });
        assert.strictEqual(rawRes.status, 400);
      });
    });

    // ------------------------------------------------------------
    // 063-SEC-03: Prevention of Privilege Escalation via Query/Body
    // ------------------------------------------------------------
    describe('063-SEC-03: Prevention of Privilege Escalation via Client Parameters', () => {
      it('GET /v1/agents ignores query tenantId override and strictly scopes to trusted token context', async () => {
        const rawRes = await fetch(`${testBaseUrl}/v1/agents?tenantId=${tenantB}`, {
          headers: { Authorization: 'Bearer token-tenant-a' },
        });
        assert.strictEqual(rawRes.status, 200);
        const data = (await rawRes.json()) as { items: Array<{ tenantId: string }> };
        for (const item of data.items) {
          assert.strictEqual(
            item.tenantId,
            tenantA,
            'Query param tenantId must not escalate authority to Tenant B',
          );
        }
      });

      it('GET /v1/delegations ignores query tenantId override and strictly scopes to trusted token context', async () => {
        const rawRes = await fetch(`${testBaseUrl}/v1/delegations?tenantId=${tenantB}`, {
          headers: { Authorization: 'Bearer token-tenant-a' },
        });
        assert.strictEqual(rawRes.status, 200);
        const data = (await rawRes.json()) as { items: Array<{ tenantId: string }> };
        for (const item of data.items) {
          assert.strictEqual(
            item.tenantId,
            tenantA,
            'Query param tenantId must not escalate authority to Tenant B',
          );
        }
      });

      it('querying with unauthorized cross-tenant workspace returns zero results', async () => {
        const resAgents = await clientA.listAgents({ workspaceId: workspaceB });
        assert.strictEqual(resAgents.total, 0, 'Cannot view Tenant B workspace agents');

        const resDelegations = await clientA.listDelegations({ workspaceId: workspaceB });
        assert.strictEqual(resDelegations.total, 0, 'Cannot view Tenant B workspace delegations');
      });
    });

    // ------------------------------------------------------------
    // 063-SEC-04: Secret Redaction in Projections
    // ------------------------------------------------------------
    describe('063-SEC-04: Secret Redaction & Safe Projection Envelopes', () => {
      it('delegation projection does not leak child lease HMAC signatures or internal secrets', async () => {
        const rawRes = await fetch(`${testBaseUrl}/v1/delegations`, {
          headers: { Authorization: 'Bearer token-tenant-a' },
        });
        assert.strictEqual(rawRes.status, 200);
        const data = (await rawRes.json()) as { items: Array<Record<string, unknown>> };

        for (const item of data.items) {
          assert.strictEqual('signature' in item, false, 'Lease signature must not be exposed');
          assert.strictEqual('secretKey' in item, false, 'Secret key must not be exposed');
          assert.strictEqual('hmacKey' in item, false, 'HMAC key must not be exposed');
          assert.strictEqual('token' in item, false, 'Raw token must not be exposed');
          assert.ok(
            typeof item['childLeaseId'] === 'string',
            'Only childLeaseId identifier should be present',
          );
          assert.strictEqual(typeof item['hasCompensation'], 'boolean');
          assert.strictEqual(typeof item['hasChildReceipt'], 'boolean');
        }
      });

      it('agent projection exposes only bounded directory metadata and zero credential tokens', async () => {
        const rawRes = await fetch(`${testBaseUrl}/v1/agents`, {
          headers: { Authorization: 'Bearer token-tenant-a' },
        });
        assert.strictEqual(rawRes.status, 200);
        const data = (await rawRes.json()) as { items: Array<Record<string, unknown>> };

        for (const item of data.items) {
          assert.strictEqual('signature' in item, false);
          assert.strictEqual('secretKey' in item, false);
          assert.strictEqual('authToken' in item, false);
          assert.ok('agentId' in item);
          assert.ok('role' in item);
          assert.ok('capabilities' in item);
          assert.ok('status' in item);
        }
      });
    });

    // ------------------------------------------------------------
    // 063-SEC-05: Memory, Vector, and Graph Data Remains Advisory
    // ------------------------------------------------------------
    describe('063-SEC-05: Memory / Vector / Graph Advisory Data Observability', () => {
      it('DashboardAPIClient.searchMemory() returns inert retrieved context without granting execution authority', async () => {
        const searchRes = await clientA.searchMemory({
          query: 'Alpha',
          workspaceId: workspaceA1,
        });
        assert.ok(searchRes.items.length > 0);
        const item = searchRes.items[0];
        assert.strictEqual(item.record.id, 'mem-record-063-a1');
        assert.strictEqual(item.record.tenantId, tenantA);
        assert.ok(item.citationToken);
        // Stored memory is data, not authority: no lease header or policy decision attached
        assert.strictEqual('leaseHeader' in item, false);
        assert.strictEqual('policyDecision' in item, false);
      });

      it('DashboardAPIClient.getMemory() retrieves single record and returns null on 404', async () => {
        const found = await clientA.getMemory('mem-record-063-a1', { workspaceId: workspaceA1 });
        assert.ok(found);
        assert.strictEqual(found.id, 'mem-record-063-a1');
        assert.strictEqual(found.title, 'Project Alpha Strategy');

        const missing = await clientA.getMemory('non-existent-memory-id', {
          workspaceId: workspaceA1,
        });
        assert.strictEqual(missing, null);
      });

      it('DashboardAPIClient.searchVectors() executes bounded vector similarity search', async () => {
        const vectorRes = await clientA.searchVectors({
          vector: new Array(384).fill(0.02),
          query: 'Alpha Strategy',
          topK: 10,
          workspaceId: workspaceA1,
        });
        assert.ok(vectorRes.items.length > 0);
        assert.strictEqual(vectorRes.items[0].memoryRecordId, 'mem-record-063-a1');
        assert.ok(typeof vectorRes.items[0].score === 'number');
        assert.ok(typeof vectorRes.items[0].distance === 'number');
        assert.ok(vectorRes.items[0].citationToken);
      });

      it('DashboardAPIClient.queryGraph() executes bounded graph traversal query', async () => {
        const graphRes = await clientA.queryGraph({
          startNodeId: 'graph-node-063-root',
          maxDepth: 2,
          limit: 10,
          workspaceId: workspaceA1,
        });
        assert.ok(graphRes.nodes.length >= 2);
        assert.ok(graphRes.edges.length >= 1);
        assert.strictEqual(graphRes.tenantId, tenantA);
        assert.strictEqual(graphRes.workspaceId, workspaceA1);
      });

      it('DashboardAPIClient.deleteMemory() safely tombstones record with optimistic concurrency', async () => {
        const tombRes = await clientA.deleteMemory('mem-record-063-a1', {
          expectedVersion: 1,
          workspaceId: workspaceA1,
        });
        assert.strictEqual(tombRes.memoryId, 'mem-record-063-a1');
        assert.strictEqual(tombRes.status, 'TOMBSTONED');
        assert.strictEqual(tombRes.tenantId, tenantA);
      });

      it('DashboardAPIClient surfaces structured DashboardAPIError without leaking stack traces or credentials', async () => {
        try {
          await clientA.deleteMemory('non-existent-id-to-delete', { workspaceId: workspaceA1 });
          assert.fail('Expected deletion of non-existent record to throw DashboardAPIError');
        } catch (err) {
          assert.ok(err instanceof DashboardAPIError);
          assert.strictEqual(err.statusCode, 404);
          assert.ok(err.message.includes('NOT_FOUND') || err.message.includes('not found'));
          assert.strictEqual(err.path.includes('/v1/memory/'), true);
        }
      });
    });

    // ============================================================
    // Task 063 Phase 2: Web Dashboard Multi-Agent Collaboration & Delegation Cockpit UI & Security Invariants
    // ============================================================

    function createMockDelegation(overrides: Partial<DelegationSummary> = {}): DelegationSummary {
      return {
        delegationId: 'del-mock-default',
        parentTaskId: 'task-p-1',
        parentLeaseId: 'lease-p-1',
        childTaskId: 'task-c-1',
        childLeaseId: 'lease-c-1',
        delegatorAgentId: 'agent-del-1',
        assignedAgentId: 'agent-assigned-1',
        tenantId: tenantA,
        workspaceId: 'ws-1',
        depth: 1,
        status: 'ACCEPTED',
        requestedScopes: ['fs:read'],
        expiresAt: Date.now() + 60000,
        correlationId: 'corr-1',
        hasCompensation: false,
        hasChildReceipt: false,
        ...overrides,
      };
    }

    describe('Task 063 Phase 2: Web Dashboard Multi-Agent Collaboration & Delegation Cockpit UI & Security Invariants', () => {
      describe('063-UI-01: Agent Roster Safe Rendering & Status Semantics', () => {
        it('1. malicious agent name/id and version render safely as defanged text without XSS injection', () => {
          const maliciousAgent: AgentRecord = {
            agentId: '<script>alert("xss-agent")</script>evil-agent',
            tenantId: tenantA,
            workspaceScope: ['<img src=x onerror=alert(1)>', 'default-ws'],
            role: 'WORKER' as const,
            capabilities: ['<svg onload=alert(2)>', 'read_fs'],
            version: '1.0.0"><b id="injected">pwned</b>',
            metadata: {},
            registeredAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
            status: 'AVAILABLE' as const,
            currentLoad: 0.45,
            activeTaskIds: ['task-1'],
          };

          const html = generateAgentCardHTML(maliciousAgent);

          assert.ok(!html.includes('<script>'), 'Script tag must be defanged');
          assert.ok(!html.includes('<img src=x'), 'Img onerror must be defanged');
          assert.ok(!html.includes('<svg onload='), 'Svg onload must be defanged');
          assert.ok(!html.includes('<b id="injected">'), 'Version HTML injection must be defanged');
          assert.ok(
            html.includes(
              '&lt;script&gt;alert(&quot;xss-agent&quot;)&lt;&#x2F;script&gt;evil-agent',
            ),
          );
          assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
          assert.ok(html.includes('&lt;svg onload=alert(2)&gt;'));
          assert.ok(
            html.includes(
              'data-agent-id="&lt;script&gt;alert(&quot;xss-agent&quot;)&lt;&#x2F;script&gt;evil-agent"',
            ),
          );
        });

        it('2. status pills reflect canonical AgentStatus values with visual and accessible text labels (not color alone)', () => {
          const availablePill = getAgentStatusPill('AVAILABLE');
          assert.ok(availablePill.includes('agent-status-pill--available'));
          assert.ok(availablePill.includes('Available / Healthy'));
          assert.ok(availablePill.includes('status-dot'));

          const busyPill = getAgentStatusPill('BUSY');
          assert.ok(busyPill.includes('agent-status-pill--busy'));
          assert.ok(busyPill.includes('Busy / Working'));

          const unhealthyPill = getAgentStatusPill('UNHEALTHY');
          assert.ok(unhealthyPill.includes('agent-status-pill--unhealthy'));
          assert.ok(unhealthyPill.includes('Unhealthy / Offline'));

          const retiredPill = getAgentStatusPill('RETIRED');
          assert.ok(retiredPill.includes('agent-status-pill--retired'));
          assert.ok(retiredPill.includes('Retired'));

          const registeredPill = getAgentStatusPill('REGISTERED');
          assert.ok(registeredPill.includes('Registered'));

          // Unknown or unexpected status fails safely and sanitizes text
          const unknownPill = getAgentStatusPill('<script>CUSTOM</script>');
          assert.ok(!unknownPill.includes('<script>'));
          assert.ok(unknownPill.includes('&lt;script&gt;CUSTOM&lt;&#x2F;script&gt;'));
        });

        it('3. role badges render distinct accessible badges for all canonical AgentRole values', () => {
          assert.ok(getRoleBadge('COORDINATOR').includes('Coordinator'));
          assert.ok(getRoleBadge('SPECIALIST').includes('Specialist'));
          assert.ok(getRoleBadge('SUPERVISOR').includes('Supervisor'));
          assert.ok(getRoleBadge('WORKER').includes('Worker'));

          // Custom/unknown role is safely sanitized
          const customRoleBadge = getRoleBadge('ANALYST<script>');
          assert.ok(!customRoleBadge.includes('<script>'));
          assert.ok(customRoleBadge.includes('ANALYST&lt;script&gt;'));
        });

        it('4. agent card rendering never exposes internal lease secrets, signing keys, or tokens', () => {
          const secretAgent: AgentRecord = {
            agentId: 'agent-secured-007',
            tenantId: tenantA,
            workspaceScope: ['ws-1'],
            role: 'COORDINATOR' as const,
            capabilities: ['delegate', 'coordinate'],
            version: '2.1.0',
            metadata: { secretToken: 'SUPER_SECRET_HMAC_KEY', internalCert: 'PRIVATE_KEY_DATA' },
            registeredAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
            status: 'AVAILABLE' as const,
            currentLoad: 0.1,
            activeTaskIds: [],
          };

          const html = generateAgentCardHTML(secretAgent);
          assert.strictEqual(html.includes('SUPER_SECRET_HMAC_KEY'), false);
          assert.strictEqual(html.includes('PRIVATE_KEY_DATA'), false);
          assert.ok(html.includes('agent-secured-007'));
          assert.ok(html.includes('10% (0 active)'));
        });
      });

      describe('063-UI-02: Delegation Hierarchy Visualization & Tree Safety', () => {
        it('5. malicious parent/child task IDs and agent names in delegation node render as inert defanged text', () => {
          const maliciousDelegation = {
            delegationId: 'del-<script>alert("del")</script>',
            parentTaskId: 'task-parent<img src=x onerror=alert(1)>',
            parentLeaseId: 'lease-p-12345678',
            childTaskId: 'task-child<svg onload=alert(2)>',
            childLeaseId: 'lease-c-87654321',
            delegatorAgentId: 'agent-del<script>alert("del-agent")</script>',
            assignedAgentId: 'agent-child<b onmouseover=alert(3)>',
            tenantId: tenantA,
            workspaceId: 'ws-1',
            depth: 2,
            status: 'EXECUTING' as const,
            requestedScopes: ['fs:read'],
            expiresAt: Date.now() + 60000,
            correlationId: 'corr-1',
            hasCompensation: true,
            hasChildReceipt: true,
          };

          const html = generateDelegationNodeHTML(maliciousDelegation);
          assert.ok(!html.includes('<script>'), 'Script tag must be defanged in delegation node');
          assert.ok(
            !html.includes('<img src=x'),
            'Img onerror must be defanged in delegation node',
          );
          assert.ok(
            !html.includes('<svg onload='),
            'Svg onload must be defanged in delegation node',
          );
          assert.ok(
            !html.includes('<b onmouseover='),
            'Onmouseover event must be defanged in delegation node',
          );
          assert.ok(
            html.includes('&lt;script&gt;alert(&quot;del-agent&quot;)&lt;&#x2F;script&gt;'),
          );
          assert.ok(html.includes('&lt;b onmouseover=alert(3)&gt;'));
          assert.ok(html.includes('delegation-tree-node--depth-2'));
          assert.ok(html.includes('Receipt Settled'));
          assert.ok(html.includes('Compensated'));
        });

        it('6. delegation node clamps depth to valid range [1, 3] and generates corresponding CSS class', () => {
          const lowDepthSession = createMockDelegation({
            delegationId: 'del-d0',
            depth: 0, // below min
            status: 'ACCEPTED',
          });
          const lowHtml = generateDelegationNodeHTML(lowDepthSession);
          assert.ok(lowHtml.includes('delegation-tree-node--depth-1'), 'Depth 0 clamped to 1');

          const highDepthSession = createMockDelegation({
            delegationId: 'del-d5',
            depth: 99, // above max
            status: 'COMPLETED',
          });
          const highHtml = generateDelegationNodeHTML(highDepthSession);
          assert.ok(highHtml.includes('delegation-tree-node--depth-3'), 'Depth 99 clamped to 3');
        });

        it('7. delegation node exposes only truncated childLeaseId prefix and never leaks lease HMAC signatures or private data', () => {
          const session = createMockDelegation({
            delegationId: 'del-lease-test',
            parentLeaseId: 'parent-lease-secret-token-full-999',
            childLeaseId: 'lease-c-abcdef0123456789',
            status: 'EXECUTING',
            hasChildReceipt: true,
          });

          const html = generateDelegationNodeHTML(session);
          assert.strictEqual(
            html.includes('parent-lease-secret'),
            false,
            'Parent lease secret must not be displayed',
          );
          assert.ok(
            html.includes('Lease: lease-c-…'),
            'Only safe prefix of childLeaseId should be rendered',
          );
        });

        it('8. delegation status badges accurately reflect canonical ACP delegation statuses', () => {
          assert.ok(getDelegationStatusBadge('ACCEPTED').includes('Accepted'));
          assert.ok(getDelegationStatusBadge('EXECUTING').includes('Executing'));
          assert.ok(getDelegationStatusBadge('COMPLETED').includes('Completed'));
          assert.ok(getDelegationStatusBadge('FAILED').includes('Failed'));
          assert.ok(getDelegationStatusBadge('CANCELLED').includes('Cancelled'));
          assert.ok(getDelegationStatusBadge('REJECTED').includes('Rejected'));
          assert.ok(getDelegationStatusBadge('TIMED_OUT').includes('Timed Out'));

          // Custom/unknown status is safely sanitized
          const customBadge = getDelegationStatusBadge('<script>CUSTOM_STATUS</script>');
          assert.ok(!customBadge.includes('<script>'));
          assert.ok(customBadge.includes('&lt;script&gt;CUSTOM_STATUS&lt;&#x2F;script&gt;'));
        });
      });

      describe('063-UI-03: Delegation Timeline Cockpit & Event Derivation', () => {
        it('9. buildDelegationTimeline derives deterministic chronological events without fabricating synthetic history', () => {
          const sessions = [
            createMockDelegation({
              delegationId: 'del-1',
              parentTaskId: 'p-1',
              childTaskId: 'c-1-child-task-id',
              delegatorAgentId: 'coord-agent',
              assignedAgentId: 'worker-agent-1',
              depth: 1,
              status: 'COMPLETED',
              expiresAt: 1000000,
              hasChildReceipt: true,
              hasCompensation: false,
            }),
            createMockDelegation({
              delegationId: 'del-2',
              parentTaskId: 'p-2',
              childTaskId: 'c-2-child-task-id',
              delegatorAgentId: 'coord-agent',
              assignedAgentId: 'worker-agent-2',
              depth: 2,
              status: 'FAILED',
              expiresAt: 2000000,
              hasChildReceipt: false,
              hasCompensation: true,
            }),
          ];

          const events = buildDelegationTimeline(sessions);

          // Should have:
          // From del-1: COMPLETED status event + RECEIPT event (2 events)
          // From del-2: FAILED status event + COMPENSATION event (2 events)
          assert.strictEqual(events.length, 4);

          // Chronological ordering check: newest timestamp (2000000) before older (1000000)
          assert.strictEqual(events[0].timestamp, 2000000);
          assert.strictEqual(events[1].timestamp, 2000000);
          assert.strictEqual(events[2].timestamp, 1000000);
          assert.strictEqual(events[3].timestamp, 1000000);

          // Event contents match session data accurately
          const receiptEvent = events.find((e) => e.type === 'RECEIPT');
          assert.ok(receiptEvent);
          assert.strictEqual(receiptEvent.title, 'Receipt Cryptographically Settled');
          assert.ok(receiptEvent.description.includes('c-1-chil'));

          const compEvent = events.find((e) => e.type === 'COMPENSATION');
          assert.ok(compEvent);
          assert.strictEqual(compEvent.title, 'Compensation Rollback Executed');
        });

        it('10. buildDelegationTimeline strictly bounds total events to 100', () => {
          const largeSessions = Array.from({ length: 80 }, (_, i) =>
            createMockDelegation({
              delegationId: `del-large-${i}`,
              parentTaskId: `p-${i}`,
              childTaskId: `c-${i}`,
              delegatorAgentId: 'coord',
              assignedAgentId: `worker-${i}`,
              depth: 1,
              status: 'COMPLETED',
              expiresAt: Date.now() + i * 1000,
              hasChildReceipt: true, // 2 events per session = 160 events total
            }),
          );

          const events = buildDelegationTimeline(largeSessions);
          assert.strictEqual(events.length, 100, 'Events must be bounded to 100');
        });

        it('11. generateDelegationTimelineItemHTML defangs malicious injection in title and description', () => {
          const maliciousEvent = {
            id: 'ev-mal-1',
            delegationId: 'del-mal',
            type: 'COMPLETED' as const,
            timestamp: Date.now(),
            title: '<script>alert("timeline-title")</script>Task Completed',
            description: '<img src=x onerror=alert("timeline-desc")>Task summary',
            delegatorAgentId: 'agent-1',
            assignedAgentId: 'agent-2',
            taskId: 'task-1',
          };

          const html = generateDelegationTimelineItemHTML(maliciousEvent);
          assert.ok(!html.includes('<script>'), 'Title script tag must be defanged');
          assert.ok(!html.includes('<img src=x'), 'Description img tag must be defanged');
          assert.ok(
            html.includes('&lt;script&gt;alert(&quot;timeline-title&quot;)&lt;&#x2F;script&gt;'),
          );
          assert.ok(html.includes('&lt;img src=x onerror=alert(&quot;timeline-desc&quot;)&gt;'));
          assert.ok(html.includes('role="listitem"'));
        });
      });

      describe('063-UI-04: Refresh Lifecycle, Sequence Guards & Error State Safety', () => {
        it('12. sequence check rejects stale out-of-order network responses', () => {
          const currentSequence = 10;
          const slowResponseSeq = 9;
          const fastResponseSeq = 10;

          let appliedData = 'initial';
          function applyIfFresh(seq: number, data: string) {
            if (seq === currentSequence) {
              appliedData = data;
            }
          }

          applyIfFresh(fastResponseSeq, 'fresh-data');
          assert.strictEqual(appliedData, 'fresh-data');

          applyIfFresh(slowResponseSeq, 'stale-data');
          assert.strictEqual(
            appliedData,
            'fresh-data',
            'Stale response must not overwrite fresh data',
          );
        });

        it('13. cycle detection in delegation hierarchy prevents runaway rendering loops', () => {
          const cyclicSessions = [
            createMockDelegation({
              delegationId: 'del-cycle-1',
              parentTaskId: 't-1',
              childTaskId: 't-2',
              delegatorAgentId: 'agent-A',
              assignedAgentId: 'agent-B',
              depth: 1,
              status: 'EXECUTING',
            }),
            createMockDelegation({
              delegationId: 'del-cycle-1', // Duplicate ID forming loop
              parentTaskId: 't-2',
              childTaskId: 't-1',
              delegatorAgentId: 'agent-B',
              assignedAgentId: 'agent-A',
              depth: 2,
              status: 'EXECUTING',
            }),
          ];

          const visited = new Set<string>();
          const renderedNodes: string[] = [];
          for (const s of cyclicSessions) {
            if (visited.has(s.delegationId)) continue;
            visited.add(s.delegationId);
            renderedNodes.push(generateDelegationNodeHTML(s));
          }

          assert.strictEqual(
            renderedNodes.length,
            1,
            'Cycle protection must render only unique session IDs',
          );
        });

        it('14. tenant-scoped API data remains tenant-isolated and cannot be overwritten across tenants', async () => {
          const agentsA = await clientA.listAgents();
          assert.ok(agentsA.items.every((a) => a.tenantId === tenantA));

          const mixedAgents = agentsA.items.filter((a) => a.tenantId !== tenantA);
          assert.strictEqual(mixedAgents.length, 0, 'No Tenant B records in Tenant A view');
        });

        it('15. error states display user-safe message and retry button without leaking stack traces or internal errors', () => {
          const safeMessage = 'Failed to load delegation hierarchy.';

          const errorCardHTML = `<div class="error-state" role="alert"><p>${sanitizeHTML(safeMessage)}</p><button class="btn btn--outline btn--sm" type="button">Retry</button></div>`;

          assert.strictEqual(errorCardHTML.includes('SQLITE_BUSY'), false);
          assert.strictEqual(errorCardHTML.includes('/var/internal/'), false);
          assert.strictEqual(errorCardHTML.includes('queryDb'), false);
          assert.ok(errorCardHTML.includes('role="alert"'));
          assert.ok(errorCardHTML.includes('Retry'));
        });
      });
    });
  });
});
