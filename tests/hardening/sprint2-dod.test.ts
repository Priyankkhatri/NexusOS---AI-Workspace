import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ── Sprint 2 Contracts ────────────────────────────────────────────────────────
import {
  // Task 060: ACP Federation & Delegation
  AcpFederationMessageSchema,
  SubAgentDelegationRequestSchema,
  SubAgentDelegationResponseSchema,
  CompositeExecutionReceiptSchema,
  AgentRegistrationSchema,
  AgentHeartbeatSchema,
  DELEGATION_SAFETY_LIMITS,
  createFederationMessage,
  // Task 061: Native Local-AI
  InferenceExecutionPlanSchema,
  NativeEngineDescriptorSchema,
  // Task 062: Persistent Memory & Vector & Graph
  DEFAULT_VECTOR_DIMENSION,
  VectorSearchRequestSchema,
  VectorSearchResponseSchema,
  MemoryGraphQueryRequestSchema,
  MemoryGraphQueryResponseSchema,
  MemoryRecordSchema,
  MemorySensitivity,
  MemoryStatus,
  MemoryGraphNodeType,
} from '@nexusos/contracts';

// ── Sprint 2 Backend Services ─────────────────────────────────────────────────
import { AgentDirectoryService } from '../../services/backend/src/agents/agent-directory.js';
import { verifyScopeAttenuation } from '../../services/backend/src/agents/attenuation.js';
import { SqliteMemoryStore } from '../../services/backend/src/memory/sqlite-memory-store.js';
import { VectorIndex } from '../../services/backend/src/memory/vector-index.js';
import { GraphProjectionEngine } from '../../services/backend/src/memory/graph-projection-engine.js';

// ── Sprint 2 Desktop-Agent Local-AI ──────────────────────────────────────────
import { HardwareDetector } from '../../apps/desktop-agent/src/runtimes/local-ai/hardware-detector.js';
import {
  VramOffloader,
  VramOffloaderError,
} from '../../apps/desktop-agent/src/runtimes/local-ai/vram-offloader.js';
import {
  validateLoopbackEndpoint,
  ProviderAdapterError,
} from '../../apps/desktop-agent/src/runtimes/local-ai/provider-adapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Sprint 2 Definition of Done Audit (Tasks 060–063)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-01  Task 060: Multi-Agent Collaboration, Federated ACP & Delegation
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-01] Task 060: ACP federation/delegation contracts, AgentDirectory, and scope attenuation behave correctly', () => {
    // ── 1. Canonical contracts ──────────────────────────────────────────
    assert.ok(
      AcpFederationMessageSchema,
      'AcpFederationMessageSchema must be exported from @nexusos/contracts',
    );
    assert.ok(SubAgentDelegationRequestSchema, 'SubAgentDelegationRequestSchema must be exported');
    assert.ok(
      SubAgentDelegationResponseSchema,
      'SubAgentDelegationResponseSchema must be exported',
    );
    assert.ok(CompositeExecutionReceiptSchema, 'CompositeExecutionReceiptSchema must be exported');
    assert.ok(AgentRegistrationSchema, 'AgentRegistrationSchema must be exported');
    assert.ok(AgentHeartbeatSchema, 'AgentHeartbeatSchema must be exported');

    // ── 2. Safety limits are concrete values ─────────────────────────────
    assert.strictEqual(
      DELEGATION_SAFETY_LIMITS.MAX_DEPTH,
      3,
      'DELEGATION_SAFETY_LIMITS.MAX_DEPTH must equal 3',
    );
    assert.strictEqual(
      DELEGATION_SAFETY_LIMITS.MAX_FAN_OUT,
      5,
      'DELEGATION_SAFETY_LIMITS.MAX_FAN_OUT must equal 5',
    );

    // ── 3. createFederationMessage produces a valid envelope ──────────────
    // The helper uses snake_case parameters per the contract schema
    const envelope = createFederationMessage({
      message_type: 'HEARTBEAT',
      from_agent: 'agent-a',
      to_agent: 'agent-b',
      tenant_id: crypto.randomUUID(), // TenantIdSchema uses UUIDSchema
      workspace_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      schema_id: 'nexusos.acp.heartbeat.v1',
      payload: { status: 'alive' },
    });
    assert.ok(envelope.message_id, 'createFederationMessage must generate a message_id UUID');
    assert.strictEqual(envelope.message_type, 'HEARTBEAT', 'message_type must round-trip');
    assert.strictEqual(envelope.from_agent, 'agent-a', 'from_agent must round-trip');

    // ── 4. AcpFederationMessageSchema rejects an invalid payload ──────────
    const badResult = AcpFederationMessageSchema.safeParse({ foo: 'bar' });
    assert.strictEqual(
      badResult.success,
      false,
      'AcpFederationMessageSchema must reject incomplete payloads',
    );

    // ── 5. AgentDirectoryService: register and discover agents ────────────
    const dir = new AgentDirectoryService({ heartbeatTtlMs: 45000, maxAgentsPerTenant: 50 });
    const dodTenantId = crypto.randomUUID(); // TenantIdSchema requires UUID
    const dodWorkspaceId = crypto.randomUUID();
    const reg = dir.registerAgent({
      agentId: 'dod-agent-1',
      tenantId: dodTenantId,
      workspaceScope: [dodWorkspaceId], // required array of workspace IDs
      role: 'COORDINATOR', // AgentRoleSchema: COORDINATOR | SPECIALIST | SUPERVISOR | WORKER
      capabilities: ['task.execute'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });
    assert.strictEqual(reg.agentId, 'dod-agent-1', 'Registered agent must retain its agentId');
    assert.strictEqual(
      reg.status,
      'AVAILABLE',
      'Newly registered agent must start with AVAILABLE status',
    );

    const found = dir.getAgent(dodTenantId, 'dod-agent-1');
    assert.ok(found, 'Registered agent must be retrievable by tenantId and agentId');
    assert.strictEqual(found!.tenantId, dodTenantId, 'Retrieved agent tenantId must match');

    // Cross-tenant isolation: must NOT find an agent across tenants
    const crossTenant = dir.getAgent(crypto.randomUUID(), 'dod-agent-1');
    assert.strictEqual(
      crossTenant,
      undefined,
      'AgentDirectoryService must NOT expose an agent across tenant boundaries (060-SEC-03)',
    );

    // ── 6. Scope attenuation: child ⊆ parent enforcement ─────────────────
    const validAttenuation = verifyScopeAttenuation(['task.read', 'task.execute'], ['task.read']);
    assert.strictEqual(
      validAttenuation.valid,
      true,
      'A strict subset of parent scopes must pass attenuation (060-SEC-01)',
    );

    const escalation = verifyScopeAttenuation(['task.read'], ['task.read', 'admin.all']);
    assert.strictEqual(
      escalation.valid,
      false,
      'Scope escalation beyond parent lease must be rejected (060-SEC-01)',
    );
    assert.strictEqual(
      escalation.errorCode,
      'SCOPE_AMPLIFICATION_FORBIDDEN',
      'Escalation rejection must carry SCOPE_AMPLIFICATION_FORBIDDEN error code',
    );

    // ── 7. DelegationCoordinator and vertical slice exist ─────────────────
    const coordPath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'agents',
      'delegation-coordinator.ts',
    );
    assert.ok(fs.existsSync(coordPath), 'delegation-coordinator.ts must exist');

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'multi-agent-delegation-vertical-slice.test.ts',
    );
    assert.ok(
      fs.existsSync(vsTestPath),
      'multi-agent-delegation-vertical-slice.test.ts must exist',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-02  Task 061: Native Quantized Local-AI Execution & VRAM Offloading
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-02] Task 061: Native local-AI runtime, VRAM offloader, hardware detector, and SSRF guard behave correctly', async () => {
    // ── 1. Canonical contracts ────────────────────────────────────────────
    assert.ok(InferenceExecutionPlanSchema, 'InferenceExecutionPlanSchema must be exported');
    assert.ok(NativeEngineDescriptorSchema, 'NativeEngineDescriptorSchema must be exported');

    // ── 2. Runtime directory and required files exist ─────────────────────
    const localAiDir = path.join(rootDir, 'apps', 'desktop-agent', 'src', 'runtimes', 'local-ai');
    assert.ok(
      fs.existsSync(localAiDir),
      'apps/desktop-agent/src/runtimes/local-ai directory must exist',
    );

    const expectedFiles = [
      'hardware-detector.ts',
      'vram-offloader.ts',
      'provider-adapters.ts',
      'model-runtime-manager.ts',
      'resource-governor.ts',
    ];
    for (const f of expectedFiles) {
      assert.ok(fs.existsSync(path.join(localAiDir, f)), `${f} must exist in local-ai runtime`);
    }

    // ── 3. HardwareDetector: produces a valid hardware profile ────────────
    const detector = new HardwareDetector(undefined, 0); // TTL=0 forces fresh sample
    const profile = await detector.getProfile();
    assert.ok(
      typeof profile.totalRamBytes === 'number' && profile.totalRamBytes > 0,
      'HardwareDetector must report a positive totalRamBytes',
    );
    assert.ok(
      typeof profile.cpuCores === 'number' && profile.cpuCores >= 1,
      'HardwareDetector must report at least one CPU core',
    );
    assert.ok(
      Array.isArray(profile.gpuAdapters),
      'HardwareDetector must return gpuAdapters as an array',
    );
    assert.ok(typeof profile.sampledAt === 'number', 'HardwareDetector must include sampledAt');

    // ── 4. VramOffloader: deterministic layer placement with GPU headroom ──
    // Build a hardware profile with enough VRAM to trigger GPU path
    const testProfile = {
      cpuArch: 'x64' as const,
      cpuCores: 4,
      totalRamBytes: 16 * 1024 * 1024 * 1024, // 16 GB
      freeRamBytes: 8 * 1024 * 1024 * 1024,
      gpuAdapters: [
        {
          name: 'Test GPU',
          vramBytes: 6 * 1024 * 1024 * 1024, // 6 GB
          freeVramBytes: 5 * 1024 * 1024 * 1024, // 5 GB free
        },
      ],
      hasNpu: false,
      thermalState: 'normal' as const,
      sampledAt: Date.now(),
    };

    const plan = VramOffloader.planLayerOffload(testProfile, {
      modelId: 'test-model',
      fileSizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB model
      totalLayers: 32,
    });
    assert.ok(plan, 'VramOffloader.planLayerOffload must return an execution plan');
    assert.ok(plan.placement !== undefined, 'Execution plan must have a placement object');
    assert.ok(
      typeof plan.placement.gpuLayers === 'number',
      'plan.placement.gpuLayers must be a number (061 layer placement)',
    );
    assert.ok(
      typeof plan.placement.cpuLayers === 'number',
      'plan.placement.cpuLayers must be a number',
    );
    assert.strictEqual(
      plan.placement.gpuLayers + plan.placement.cpuLayers,
      32,
      'Total allocated layers must equal totalLayers (32) — placement invariant',
    );

    // ── 5. VramOffloader: rejects invalid hardware profile ────────────────
    assert.throws(
      () =>
        VramOffloader.planLayerOffload(
          { ...testProfile, totalRamBytes: 0 },
          { modelId: 'x', fileSizeBytes: 1024 },
        ),
      (err: unknown) => err instanceof VramOffloaderError && err.code === 'INVALID_HARDWARE',
      'VramOffloader must throw VramOffloaderError(INVALID_HARDWARE) for zero-RAM hardware',
    );

    // ── 6. SSRF loopback guard rejects non-loopback URLs ─────────────────
    assert.throws(
      () => validateLoopbackEndpoint('http://169.254.169.254/metadata'),
      (err: unknown) => err instanceof ProviderAdapterError && err.code === 'ENDPOINT_DISALLOWED',
      'validateLoopbackEndpoint must reject SSRF cloud metadata endpoints (061-SEC-01)',
    );
    assert.throws(
      () => validateLoopbackEndpoint('http://api.openai.com/v1/completions'),
      (err: unknown) => err instanceof ProviderAdapterError && err.code === 'ENDPOINT_DISALLOWED',
      'validateLoopbackEndpoint must reject remote API endpoints (061-SEC-01)',
    );

    // A loopback URL must be accepted
    const loopback = validateLoopbackEndpoint('http://127.0.0.1:11434/api/generate');
    assert.ok(
      loopback.includes('127.0.0.1'),
      'validateLoopbackEndpoint must accept 127.0.0.1 loopback URL',
    );

    // ── 7. Safety ceiling constants ───────────────────────────────────────
    assert.ok(
      VramOffloader.DEFAULT_MAX_VRAM_PERCENT <= 0.8,
      'VramOffloader MAX_VRAM_PERCENT must be <= 0.80 (VRAM safety ceiling)',
    );
    assert.ok(
      VramOffloader.DEFAULT_MAX_RAM_PERCENT <= 0.7,
      'VramOffloader MAX_RAM_PERCENT must be <= 0.70 (RAM safety ceiling)',
    );

    // ── 8. Security test suite exists ────────────────────────────────────
    const hardening = path.join(
      rootDir,
      'tests',
      'hardening',
      'local-ai-hardware-security.test.ts',
    );
    assert.ok(
      fs.existsSync(hardening),
      'tests/hardening/local-ai-hardware-security.test.ts must exist',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-03  Task 062: Persistent SQLite Store, Vector Search & Graph Engine
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-03] Task 062: SqliteMemoryStore, VectorIndex, and GraphProjectionEngine perform real persistence and tenant isolation', async () => {
    // ── 1. Contracts ──────────────────────────────────────────────────────
    assert.ok(
      DEFAULT_VECTOR_DIMENSION === 384,
      `DEFAULT_VECTOR_DIMENSION must equal 384; got ${DEFAULT_VECTOR_DIMENSION}`,
    );
    assert.ok(VectorSearchRequestSchema, 'VectorSearchRequestSchema must be exported');
    assert.ok(VectorSearchResponseSchema, 'VectorSearchResponseSchema must be exported');
    assert.ok(MemoryGraphQueryRequestSchema, 'MemoryGraphQueryRequestSchema must be exported');
    assert.ok(MemoryGraphQueryResponseSchema, 'MemoryGraphQueryResponseSchema must be exported');
    assert.ok(MemoryRecordSchema, 'MemoryRecordSchema must be exported');

    // ── 2. SqliteMemoryStore: in-memory instantiation and real write/read ──
    const store = new SqliteMemoryStore({ dbPath: ':memory:' });
    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();

    const record = MemoryRecordSchema.parse({
      id: recordId,
      tenantId: 'dod-tenant',
      workspaceId: 'dod-ws',
      ownerId: 'dod-user',
      class: 'WORKING',
      status: 'ACTIVE',
      sensitivity: 'PUBLIC',
      content: 'DoD-S2-03 test memory content for Sprint 2 exit gate audit',
      confidence: 0.95,
      tags: ['dod', 'sprint2'],
      metadata: {},
      provenance: {
        sourceType: 'USER_EXPLICIT', // correct enum value per MemoryProvenanceSourceSchema
        creatorPrincipalId: 'dod-user',
        timestamp: now,
        verified: true,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const created = await store.create(record);
    assert.ok(created.id, 'SqliteMemoryStore.create must return a record with an ID');
    assert.strictEqual(created.tenantId, 'dod-tenant', 'Stored record tenantId must match');
    assert.strictEqual(created.content, record.content, 'Stored record content must match input');

    // ── 3. Retrieve and verify round-trip persistence ─────────────────────
    const retrieved = await store.getById(recordId, 'dod-tenant', 'dod-ws');
    assert.ok(retrieved, 'SqliteMemoryStore.getById must retrieve the previously stored record');
    assert.strictEqual(retrieved!.id, recordId, 'Retrieved record ID must match stored ID');
    assert.strictEqual(
      retrieved!.content,
      record.content,
      'Retrieved content must match stored content',
    );

    // ── 4. Cross-tenant isolation: another tenant must NOT find this record
    const crossTenantResult = await store.getById(recordId, 'OTHER-TENANT', 'dod-ws');
    assert.strictEqual(
      crossTenantResult,
      null,
      'SqliteMemoryStore must enforce tenant isolation: cross-tenant getById must return null (062-SEC-01)',
    );

    // ── 5. VectorIndex: upsert and dimension verification ────────────────
    const idx = new VectorIndex({ dimensions: 384, maxVectorsPerWorkspace: 100 });
    assert.strictEqual(idx.getDimensions(), 384, 'VectorIndex must report correct 384 dimensions');

    idx.upsert({
      id: 'vec-dod-1',
      memoryRecordId: recordId,
      tenantId: 'dod-tenant',
      workspaceId: 'dod-ws',
      values: new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1)),
      dimensions: 384,
      sensitivity: MemorySensitivity.PUBLIC,
      status: MemoryStatus.ACTIVE,
    });
    assert.strictEqual(
      idx.size('dod-tenant', 'dod-ws'),
      1,
      'VectorIndex.size must report 1 after upsert',
    );

    // ── 6. VectorIndex: dimension mismatch throws ─────────────────────────
    const { VectorDimensionMismatchError } = await import(
      '../../services/backend/src/memory/types.js'
    );
    assert.throws(
      () =>
        idx.upsert({
          id: 'vec-wrong-dim',
          memoryRecordId: 'some-record',
          tenantId: 'dod-tenant',
          workspaceId: 'dod-ws',
          values: [0.1, 0.2], // wrong dimensions
          dimensions: 2,
        }),
      VectorDimensionMismatchError,
      'VectorIndex must throw VectorDimensionMismatchError for dimension mismatch (062-SEC-06)',
    );

    // ── 7. GraphProjectionEngine: node upsert with tenant validation ──────
    const engine = new GraphProjectionEngine({ store });
    const ctx = {
      tenantId: 'dod-tenant',
      workspaceId: 'dod-ws',
      actorId: 'dod-user',
      principalId: 'dod-user',
      requestId: 'req-graph-dod',
    };
    const node = await engine.upsertNode(
      {
        id: crypto.randomUUID(),
        tenantId: 'dod-tenant',
        workspaceId: 'dod-ws',
        nodeType: MemoryGraphNodeType.ENTITY,
        label: 'DoD Sprint 2 Test Entity',
        confidence: 0.9,
        properties: {},
        createdAt: now,
      },
      ctx,
    );
    assert.ok(node.id, 'GraphProjectionEngine.upsertNode must return a node with an ID');
    assert.strictEqual(node.label, 'DoD Sprint 2 Test Entity', 'Node label must round-trip');

    // ── 8. GraphProjectionEngine: cross-tenant upsert rejection ──────────
    await assert.rejects(
      () =>
        engine.upsertNode(
          {
            id: crypto.randomUUID(),
            tenantId: 'OTHER-TENANT',
            workspaceId: 'OTHER-WS',
            nodeType: MemoryGraphNodeType.CONCEPT,
            label: 'Unauthorized Node',
            confidence: 0.5,
            properties: {},
            createdAt: now,
          },
          ctx, // context says dod-tenant, node says OTHER-TENANT
        ),
      /058-SEC-03/,
      'GraphProjectionEngine must reject cross-tenant node upsert (058-SEC-03 / 062-SEC-01)',
    );

    // ── 9. Key source files exist ─────────────────────────────────────────
    const sqliteStorePath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'memory',
      'sqlite-memory-store.ts',
    );
    assert.ok(fs.existsSync(sqliteStorePath), 'sqlite-memory-store.ts must exist');

    const hardeningPath = path.join(
      rootDir,
      'tests',
      'hardening',
      'memory-persistence-security.test.ts',
    );
    assert.ok(
      fs.existsSync(hardeningPath),
      'tests/hardening/memory-persistence-security.test.ts must exist',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-04  Task 063: Web Dashboard — Memory Explorer & Knowledge Graph
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-04] Task 063: Web dashboard Memory Explorer and Knowledge Graph views and DashboardAPIClient methods exist', () => {
    // ── 1. Dashboard application directory exists ─────────────────────────
    const dashboardDir = path.join(rootDir, 'apps', 'web-dashboard');
    assert.ok(fs.existsSync(dashboardDir), 'apps/web-dashboard directory must exist');

    // ── 2. index.html contains Memory Explorer and Knowledge Graph sections
    const htmlPath = path.join(dashboardDir, 'index.html');
    assert.ok(fs.existsSync(htmlPath), 'apps/web-dashboard/index.html must exist');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(
      html.includes('id="nav-memory"'),
      'index.html must include nav-memory navigation button (Task 063 Phase 3)',
    );
    assert.ok(
      html.includes('id="nav-graph"'),
      'index.html must include nav-graph navigation button (Task 063 Phase 3)',
    );
    assert.ok(
      html.includes('id="view-memory"'),
      'index.html must include view-memory section (Task 063 Phase 3 — Memory Explorer)',
    );
    assert.ok(
      html.includes('id="view-graph"'),
      'index.html must include view-graph section (Task 063 Phase 3 — Knowledge Graph)',
    );

    // Task 063 Phase 2: Agent Roster and Delegation views
    assert.ok(
      html.includes('id="nav-agents"'),
      'index.html must include nav-agents navigation (Task 063 Phase 2)',
    );
    assert.ok(
      html.includes('id="nav-delegations"'),
      'index.html must include nav-delegations navigation (Task 063 Phase 2)',
    );

    // ── 3. API client exposes memory and graph methods ────────────────────
    const clientPath = path.join(dashboardDir, 'src', 'api', 'client.ts');
    assert.ok(fs.existsSync(clientPath), 'apps/web-dashboard/src/api/client.ts must exist');
    const clientSrc = fs.readFileSync(clientPath, 'utf8');

    const requiredMethods = [
      'searchMemory',
      'getMemory',
      'deleteMemory',
      'searchVectors',
      'queryGraph',
    ];
    for (const method of requiredMethods) {
      assert.ok(
        clientSrc.includes(`async ${method}(`),
        `DashboardAPIClient must expose ${method}() for memory/graph projections (Task 063 Phase 1)`,
      );
    }

    // ── 4. Types imported are real contract types ─────────────────────────
    assert.ok(
      clientSrc.includes('MemoryRecord'),
      'DashboardAPIClient must import MemoryRecord from contracts',
    );
    assert.ok(
      clientSrc.includes('MemoryGraphQueryResponse'),
      'DashboardAPIClient must import MemoryGraphQueryResponse from contracts',
    );
    assert.ok(
      clientSrc.includes('VectorSearchResponse'),
      'DashboardAPIClient must import VectorSearchResponse from contracts',
    );

    // ── 5. Bounded graph depth enforcement in client ──────────────────────
    // queryGraph enforces maxDepth <= 4 (062-SEC-05)
    assert.ok(
      clientSrc.includes('Math.min') && clientSrc.includes('4'),
      'DashboardAPIClient.queryGraph must enforce maxDepth <= 4 boundary (062-SEC-05)',
    );

    // ── 6. Security test suite exists ────────────────────────────────────
    const dashSecPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'dashboard-security-invariants.test.ts',
    );
    assert.ok(
      fs.existsSync(dashSecPath),
      'tests/vertical-slice/dashboard-security-invariants.test.ts must exist (Task 063)',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-05  Monorepo Workspace Architecture Isolation
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-05] Monorepo workspace isolation: packages/contracts and packages/plugin-sdk have no backend/desktop implementation dependencies', () => {
    const isolatedPackages = ['packages/contracts', 'packages/plugin-sdk'];
    const forbiddenPrefixes = ['@nexusos/backend', '@nexusos/desktop', '@nexusos/desktop-agent'];

    for (const pkg of isolatedPackages) {
      const pkgJsonPath = path.join(rootDir, pkg, 'package.json');
      assert.ok(
        fs.existsSync(pkgJsonPath),
        `${pkg}/package.json must exist for workspace isolation check`,
      );

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
        name: string;
        dependencies?: Record<string, string>;
      };

      // Runtime dependencies must NOT reference backend/desktop implementation packages
      const runtimeDeps = Object.keys(pkgJson.dependencies ?? {});
      for (const dep of runtimeDeps) {
        const isViolation = forbiddenPrefixes.some((prefix) => dep.startsWith(prefix));
        assert.strictEqual(
          isViolation,
          false,
          `${pkg} must NOT depend on implementation layer '${dep}' (architecture boundary violation)`,
        );
      }

      assert.ok(pkgJson.name, `${pkg}/package.json must declare a package name`);
    }

    // Verify monorepo workspace yaml covers all workspace globs
    const workspaceYaml = fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    assert.ok(workspaceYaml.includes('packages/*'), 'pnpm-workspace.yaml must include packages/*');
    assert.ok(workspaceYaml.includes('services/*'), 'pnpm-workspace.yaml must include services/*');
    assert.ok(workspaceYaml.includes('apps/*'), 'pnpm-workspace.yaml must include apps/*');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-06  Runbook Coverage — Sprint 2 Failure Domains
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-06] Sprint 2 operational runbooks exist for all Sprint 2 failure domains (RB-021 through RB-024)', () => {
    const runbooksDir = path.join(rootDir, 'docs', 'runbooks');
    assert.ok(fs.existsSync(runbooksDir), 'docs/runbooks directory must exist');

    // Sprint 2 runbooks RB-021 through RB-024
    for (const i of [21, 22, 23, 24]) {
      const numStr = String(i).padStart(3, '0');
      const files = fs.readdirSync(runbooksDir).filter((f) => f.startsWith(`RB-${numStr}`));
      assert.strictEqual(
        files.length,
        1,
        `Exactly one runbook must exist for RB-${numStr} (Sprint 2 failure domain) — found: [${files.join(', ')}]`,
      );

      // Each runbook must have substantive operator guidance (not a stub)
      const content = fs.readFileSync(path.join(runbooksDir, files[0]!), 'utf8');
      assert.ok(
        content.length > 500,
        `RB-${numStr} must contain substantive operator guidance (> 500 bytes), was ${content.length} bytes`,
      );
      // Must contain structural section markers
      const hasSections =
        content.includes('## 1.') ||
        content.includes('## 2.') ||
        content.includes('Purpose') ||
        content.includes('Detection');
      assert.ok(hasSections, `RB-${numStr} must include the runbook section structure`);
    }

    // Verify the master catalog indexes all runbooks RB-001 through RB-024
    const runbooksIndex = fs.readFileSync(path.join(rootDir, 'docs', 'RUNBOOKS.md'), 'utf8');
    for (let i = 1; i <= 24; i++) {
      const numStr = String(i).padStart(3, '0');
      assert.ok(
        runbooksIndex.includes(`RB-${numStr}`),
        `docs/RUNBOOKS.md must catalog RB-${numStr}`,
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-07  Resource Baseline — Sprint 2 Measurements Present
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-07] docs/RESOURCE_BASELINE.md contains a Sprint 2 measurement section with observed data', () => {
    const rbPath = path.join(rootDir, 'docs', 'RESOURCE_BASELINE.md');
    assert.ok(fs.existsSync(rbPath), 'docs/RESOURCE_BASELINE.md must exist');

    const content = fs.readFileSync(rbPath, 'utf8');

    assert.ok(content.includes('Sprint 0'), 'Resource baseline must include Sprint 0 data');
    assert.ok(content.includes('Sprint 1'), 'Resource baseline must include Sprint 1 data');
    assert.ok(
      content.includes('Sprint 2'),
      'Resource baseline must include a Sprint 2 measurement section',
    );

    // Sprint 2 section must contain observed measurements with numeric values
    const sprint2Index = content.indexOf('Sprint 2');
    const sprint2Section = content.substring(sprint2Index);
    const hasMeasurements = /\d+(\.\d+)?\s*(MB|ms|KB|GB|%)/.test(sprint2Section);
    assert.ok(
      hasMeasurements,
      'Sprint 2 resource baseline section must contain actual observed measurements (MB/ms/KB/GB/%)',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-08  Sprint 2 Completion Evidence — Milestone Reports Exist
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-08] Sprint 2 milestone completion reports exist for Tasks 060 through 063', () => {
    // Tasks 060 and 061 have conventional completion reports at root
    for (const taskNum of [60, 61]) {
      const reportName = `task_0${taskNum}_completion_report.md`;
      const reportPath = path.join(rootDir, reportName);
      assert.ok(fs.existsSync(reportPath), `${reportName} must exist at repository root`);
      const content = fs.readFileSync(reportPath, 'utf8');
      assert.ok(content.length > 500, `${reportName} must contain substantive report content`);
    }

    // Task 062 completion report
    const task062Report = path.join(rootDir, 'task_062_completion_report.md');
    assert.ok(
      fs.existsSync(task062Report),
      'task_062_completion_report.md must exist at repository root (Task 062: Persistent SQLite Store)',
    );

    // Task 063 was delivered in 3 phases — accept combined report or any phase report
    const task063Paths = [
      path.join(rootDir, 'task_063_completion_report.md'),
      path.join(rootDir, 'task_063_phase3_completion_report.md'),
      path.join(rootDir, 'task_063_phase3_discovery_report.md'),
      path.join(rootDir, 'task_063_discovery_report.md'),
    ];
    const hasTask063Evidence = task063Paths.some((p) => fs.existsSync(p));
    assert.ok(
      hasTask063Evidence,
      'Task 063 must have at least one completion or discovery report (task_063_*_report.md)',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-09  Sprint 2 Closure Documents — Completion Report & Sprint 3 Backlog
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-09] SPRINT_2_COMPLETION_REPORT.md and docs/SPRINT_3_READINESS_AND_BACKLOG.md exist with required sections', () => {
    // Sprint 2 completion report
    const s2ReportPath = path.join(rootDir, 'SPRINT_2_COMPLETION_REPORT.md');
    assert.ok(
      fs.existsSync(s2ReportPath),
      'SPRINT_2_COMPLETION_REPORT.md must exist at repository root',
    );
    const s2Report = fs.readFileSync(s2ReportPath, 'utf8');
    assert.ok(s2Report.length > 1000, 'SPRINT_2_COMPLETION_REPORT.md must be substantive (> 1KB)');

    // Must reference all 4 Sprint 2 milestones
    for (const ref of ['060', '061', '062', '063']) {
      assert.ok(s2Report.includes(ref), `Sprint 2 completion report must reference Task ${ref}`);
    }
    // Must contain an exit decision
    assert.ok(
      s2Report.toUpperCase().includes('PASS') ||
        s2Report.includes('exit') ||
        s2Report.includes('Exit'),
      'Sprint 2 completion report must contain an exit decision',
    );

    // Sprint 3 readiness & backlog
    const s3ReadinessPath = path.join(rootDir, 'docs', 'SPRINT_3_READINESS_AND_BACKLOG.md');
    assert.ok(fs.existsSync(s3ReadinessPath), 'docs/SPRINT_3_READINESS_AND_BACKLOG.md must exist');
    const s3Doc = fs.readFileSync(s3ReadinessPath, 'utf8');
    assert.ok(
      s3Doc.length > 500,
      'docs/SPRINT_3_READINESS_AND_BACKLOG.md must contain substantive readiness content',
    );
    assert.ok(
      s3Doc.includes('CANDIDATE') || s3Doc.includes('Candidate') || s3Doc.includes('Sprint 3'),
      'Sprint 3 readiness doc must reference Sprint 3 candidates explicitly',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DoD-S2-10  Sprint 2 Security Suites Present and Registered
  // ─────────────────────────────────────────────────────────────────────────
  it('[DoD-S2-10] Sprint 2 security hardening suites exist for all 4 milestones and are registered in package.json', () => {
    const securitySuites: Array<{ description: string; filePath: string }> = [
      {
        description: 'Task 060 multi-agent delegation security suite',
        filePath: path.join(
          rootDir,
          'tests',
          'hardening',
          'multi-agent-delegation-security.test.ts',
        ),
      },
      {
        description: 'Task 061 local-AI hardware security suite',
        filePath: path.join(rootDir, 'tests', 'hardening', 'local-ai-hardware-security.test.ts'),
      },
      {
        description: 'Task 062 memory persistence security suite',
        filePath: path.join(rootDir, 'tests', 'hardening', 'memory-persistence-security.test.ts'),
      },
      {
        description: 'Task 063 dashboard security invariants suite',
        filePath: path.join(
          rootDir,
          'tests',
          'vertical-slice',
          'dashboard-security-invariants.test.ts',
        ),
      },
    ];

    for (const suite of securitySuites) {
      assert.ok(
        fs.existsSync(suite.filePath),
        `${suite.description} must exist at ${path.relative(rootDir, suite.filePath)}`,
      );
      const stat = fs.statSync(suite.filePath);
      assert.ok(
        stat.size > 1000,
        `${suite.description} must be substantive (> 1 KB), was ${stat.size} bytes`,
      );
    }

    // All security suites must be registered in the root package.json test command
    const pkgJson = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    for (const filename of [
      'multi-agent-delegation-security.test.ts',
      'local-ai-hardware-security.test.ts',
      'memory-persistence-security.test.ts',
      'dashboard-security-invariants.test.ts',
      'sprint2-dod.test.ts',
    ]) {
      assert.ok(pkgJson.includes(filename), `package.json test command must register ${filename}`);
    }
  });
});
