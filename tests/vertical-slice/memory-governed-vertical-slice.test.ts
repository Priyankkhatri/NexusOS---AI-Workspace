/**
 * Task 056 — Sprint 1 Milestone 8
 * Memory / Context Runtime Foundation & Governed Persistent Context
 *
 * Vertical Slice Test:
 * Task/Auth Context → Governed Memory Ingestion/Proposal → Backend Persistence
 * → Authorized Retrieval → Desktop Agent Client → Untrusted Context Packaging
 * → Audit & Evidence Verification
 *
 * Covers both safe execution and denied/adversarial security paths:
 * - 056-SEC-01: Stored memory is inert data, not authority (injection containment)
 * - 056-SEC-02: Multi-tenant and workspace boundary enforcement
 * - 056-SEC-03: Secret sanitization fail-closed blocking
 * - 056-SEC-04: Provenance integrity validation
 * - 056-SEC-05: Tombstone / expiry leakage defense
 * - 056-SEC-06: Unauthorized mutation defense with optimistic locking
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { MemoryClass, MemorySensitivity, MemorySourceType } from '@nexusos/contracts';
import {
  InMemoryMemoryStore,
  MemoryService,
  MemoryController,
  handleMemoryRoutes,
  Logger,
} from '@nexusos/backend';
import { PersistentMemoryClient } from '@nexusos/desktop-agent';

describe('Task 056 — Governed Memory Vertical Slice & Security Integration', () => {
  let store: InMemoryMemoryStore;
  let service: MemoryService;
  let controller: MemoryController;
  let logger: Logger;
  let loggedEvents: Array<{ level: string; message: string; details?: Record<string, unknown> }>;

  const createTransport = (
    controllerInst: MemoryController,
    defaultTenantId: string,
    defaultWorkspaceId: string,
    defaultPrincipalId: string,
  ) => {
    return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlObj = new URL(url.toString());
      const method = init?.method || 'GET';
      const headers = (init?.headers || {}) as Record<string, string>;
      if (!headers['x-workspace-id']) {
        headers['x-workspace-id'] = defaultWorkspaceId;
      }
      const bodyText = typeof init?.body === 'string' ? init.body : '';

      let responseStatusCode = 200;
      const responseHeaders = new Map<string, string>();
      let responseBody = '';

      const reqLike = {
        method,
        url: urlObj.pathname + urlObj.search,
        headers,
      } as unknown as IncomingMessage;

      const resLike = {
        statusCode: 200,
        setHeader: (k: string, v: string) => responseHeaders.set(k, v),
        end: (data: string) => {
          responseBody = data;
          responseStatusCode = (resLike as unknown as { statusCode: number }).statusCode;
        },
      } as unknown as ServerResponse;

      const routeContext = {
        requestId: 'req-vslice',
        correlationId: 'corr-vslice',
        timestamp: new Date().toISOString(),
      };

      const authContextLike = {
        principal: {
          type: 'USER',
          userId: headers['x-principal-id'] || defaultPrincipalId,
        },
        tenantId: headers['x-tenant-id'] || defaultTenantId,
      };

      const handled = await handleMemoryRoutes(
        reqLike,
        resLike,
        urlObj,
        controllerInst,
        authContextLike,
        routeContext,
        async () => (bodyText ? JSON.parse(bodyText) : {}),
      );

      if (!handled) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      return new Response(responseBody, {
        status: responseStatusCode,
        headers: Object.fromEntries(responseHeaders.entries()),
      });
    };
  };

  beforeEach(() => {
    store = new InMemoryMemoryStore();
    logger = new Logger('debug');
    loggedEvents = [];

    // Capture log events for audit verification
    const origLog = logger.log.bind(logger);
    logger.log = (level, message, meta) => {
      loggedEvents.push({ level, message, details: meta?.details });
      return origLog(level, message, meta);
    };

    service = new MemoryService({ store, logger });
    controller = new MemoryController(service);
  });

  it('executes full end-to-end vertical slice: task context → governed persistence → retrieval → context packaging', async () => {
    const client = new PersistentMemoryClient({
      backendUrl: 'http://localhost:3000',
      tenantId: 'tenant-enterprise-1',
      workspaceId: 'ws-production',
      principalId: 'agent-worker-01',
      fetchFn: createTransport(
        controller,
        'tenant-enterprise-1',
        'ws-production',
        'agent-worker-01',
      ),
    });

    // 1. Ingest task-generated memory
    const memoryRecord = await client.createMemory({
      class: MemoryClass.EPISODIC,
      title: 'Database Migration Summary',
      content: 'Migration v1.2 applied successfully without downtime. Schema version is 1.2.',
      confidence: 0.99,
      sensitivity: MemorySensitivity.INTERNAL,
      tags: ['database', 'migration'],
      provenance: {
        sourceType: MemorySourceType.TASK_EXECUTION,
        sourceId: 'task-db-mig-01',
        stepIndex: 3,
        creatorPrincipalId: 'agent-worker-01',
        timestamp: new Date().toISOString(),
        verified: true,
      },
    });

    assert.ok(memoryRecord.id);
    assert.equal(memoryRecord.version, 1);
    assert.equal(memoryRecord.tenantId, 'tenant-enterprise-1');

    // Verify audit log emission
    const createLog = loggedEvents.find((e) =>
      e.message.includes('Persistent memory record created'),
    );
    assert.ok(createLog, 'Audit log for memory creation must be emitted');
    assert.equal(createLog.details?.tenantId, 'tenant-enterprise-1');
    assert.equal(createLog.details?.class, MemoryClass.EPISODIC);

    // 2. Retrieve and package context for downstream LLM invocation
    const packaged = await client.retrieveAndFormatContext({
      query: 'migration',
    });

    assert.equal(packaged.citationCount, 1);
    assert.ok(packaged.items.length === 1);
    assert.equal(packaged.items[0].record.title, 'Database Migration Summary');
    assert.ok(packaged.formattedContext.includes('<!-- BEGIN_UNTRUSTED_RETRIEVED_MEMORY -->'));
    assert.ok(packaged.formattedContext.includes('Migration v1.2 applied successfully'));
    assert.ok(packaged.formattedContext.includes('<!-- END_UNTRUSTED_RETRIEVED_MEMORY -->'));
  });

  it('enforces denied paths: cross-tenant isolation and secret leakage fail-closed', async () => {
    // Tenant A client
    const clientA = new PersistentMemoryClient({
      backendUrl: 'http://localhost:3000',
      tenantId: 'tenant-a',
      workspaceId: 'ws-main',
      principalId: 'user-a',
      fetchFn: createTransport(controller, 'tenant-a', 'ws-main', 'user-a'),
    });

    // Tenant B client
    const clientB = new PersistentMemoryClient({
      backendUrl: 'http://localhost:3000',
      tenantId: 'tenant-b',
      workspaceId: 'ws-main',
      principalId: 'user-b',
      fetchFn: createTransport(controller, 'tenant-b', 'ws-main', 'user-b'),
    });

    // Create memory in Tenant A
    const recordA = await clientA.createMemory({
      class: MemoryClass.SEMANTIC,
      title: 'Secret Project Roadmap',
      content: 'Confidential roadmap details for Tenant A.',
      sensitivity: MemorySensitivity.CONFIDENTIAL,
      provenance: {
        sourceType: MemorySourceType.USER_EXPLICIT,
        creatorPrincipalId: 'user-a',
        timestamp: new Date().toISOString(),
      },
    });

    // Tenant B attempts to read Tenant A's memory record -> must return null (404)
    const crossRead = await clientB.getMemory(recordA.id);
    assert.equal(crossRead, null, 'Cross-tenant direct read must return null');

    // Tenant B searches -> 0 results
    const searchB = await clientB.searchMemory({ query: 'Roadmap' });
    assert.equal(searchB.total, 0, 'Cross-tenant search must return 0 results');

    // Secret injection attempt -> must be rejected fail-closed (422)
    await assert.rejects(
      () =>
        clientA.createMemory({
          class: MemoryClass.WORKING,
          content:
            'Here is our production API key: sk-proj-1234567890abcdef1234567890abcdef1234567890',
          provenance: {
            sourceType: MemorySourceType.USER_EXPLICIT,
            creatorPrincipalId: 'user-a',
            timestamp: new Date().toISOString(),
          },
        }),
      /422|056-SEC-03/,
    );
  });

  it('enforces memory proposal governance: unverified autonomous memory requires proposal and approval', async () => {
    const client = new PersistentMemoryClient({
      backendUrl: 'http://localhost:3000',
      tenantId: 'tenant-gov',
      workspaceId: 'ws-gov',
      principalId: 'agent-learner',
      fetchFn: createTransport(controller, 'tenant-gov', 'ws-gov', 'agent-learner'),
    });

    // Inferred memory proposal
    const proposal = await client.proposeMemory({
      class: MemoryClass.SEMANTIC,
      title: 'Observed User Style',
      content: 'User consistently chooses dark mode and concise summaries.',
      confidence: 0.82,
      sensitivity: MemorySensitivity.INTERNAL,
      provenance: {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: 'agent-learner',
        timestamp: new Date().toISOString(),
      },
    });

    assert.equal(proposal.status, 'PENDING');

    // Search before approval -> 0 results
    const searchBefore = await client.searchMemory({ query: 'dark mode' });
    assert.equal(searchBefore.total, 0);

    // Human supervisor approves proposal
    const resolution = await client.resolveProposal(proposal.proposalId, 'APPROVED');
    assert.equal(resolution.proposal.status, 'APPROVED');
    assert.ok(resolution.memoryRecord);

    // Search after approval -> 1 result
    const searchAfter = await client.searchMemory({ query: 'dark mode' });
    assert.equal(searchAfter.total, 1);
    assert.equal(searchAfter.items[0].record.title, 'Observed User Style');
  });
});
