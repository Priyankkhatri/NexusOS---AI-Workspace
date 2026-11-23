# NEXUSOS — FULL PROJECT COMPLETION AUDIT & FINAL EXECUTION PLAN

**Audit Timestamp:** 2026-11-23  
**Audit Baseline Git Commit:** `800cbf4b794590360edeb985ed4942eb71906ecf`  
**Working Tree Status:** Clean  
**Authoritative Reference:** PRD v1.0, Architecture Bible, Backend/Desktop/Runtime/Experience Platform EDDs, Sprint 0–3 Backlogs and Completion Reports.

---

## 1. Executive Summary

NexusOS is an enterprise-grade AI Desktop Agent and Web Experience Platform designed for multi-tenant local orchestration, autonomous task execution, local LLM acceleration, hardware-enforced policy boundaries, and human-in-the-loop (HITL) approval workflows.

Over Sprint 0, Sprint 1, Sprint 2, and Sprint 3 (up to Task 068 Phase 4C), the core software architecture, domain models, cryptographic policy enforcement, local SQLite memory graph, and single-page operator dashboard were created and hardened. All 19 active automated test suites pass cleanly across backend, desktop-agent, web-dashboard, and contract packages with green GitHub Actions CI.

However, an exhaustive, source-level audit of the entire codebase reveals that NexusOS is **not yet production-ready or complete**. Significant architectural discrepancies, in-memory volatile implementations, simulated runtime stubs, and lifecycle orchestration gaps persist beneath passing unit and integration suites:

1. **Volatile Task & Workflow Persistence:** The backend task execution engine (`services/backend/src/tasks/controller.ts`) previously persisted tasks, execution leases, idempotency tokens, and receipts exclusively in an in-memory `Map<string, TaskRecord>`. Process restarts discarded all task history, active delegations, and SSE buffers. In Roadmap Prompt 1, this has been upgraded to durable SQLite-backed task persistence (`SqliteTaskRepository` using Node 24 native `node:sqlite` `DatabaseSync`). Note that `DatabaseBoundary` in `services/backend/src/database/boundary.ts` is currently a simulated infrastructure boundary that toggles an in-memory boolean rather than maintaining a live database connection.
2. **Simulated Runtime Stubs (Browser & Local AI):** The browser runtime (`runtimes/browser/runtime.ts`) enforces security checks and sandbox boundary limits, but navigation and DOM content extraction return hardcoded mock HTML strings rather than driving a real headless Chromium/Playwright instance. The local AI runtime possesses complete VRAM offload math and GGUF inspection logic, but runtime model inference falls back to simulated strings or loopback external HTTP endpoints (`127.0.0.1:11434`, `:8080`, `:1234`) rather than native in-process llama.cpp execution.
3. **Approval Contract Discrepancy (HITL Expiry):** The authoritative backend contract (`ApprovalPromptItemSchema`) mandates `expiresAt: z.number().int().positive()` as a required field with strict server-side TTL invalidation. Conversely, the web dashboard accommodates `expiresAt?: number` and treats `undefined` as non-expiring, introducing contract drift.
4. **Monorepo Lifecycle & Operational Scripts:** The repository lacks top-level `start`, `dev`, and packaging orchestration scripts to simultaneously launch the backend API and host the web dashboard with proper reverse proxying or CORS.
5. **Empty Structural Placeholders:** Monorepo top-level directories `infrastructure/`, `runtimes/`, and `tools/` contain only placeholder `README.md` files without production deployment manifests or container definitions.

This audit establishes an authoritative subsystem breakdown, catalogs all technical and operational debt, resolves the known HITL contract discrepancy, and provides a strict **6-prompt execution roadmap** to bring NexusOS to full production release readiness.

---

## 2. Repository Baseline & Audit Methodology

### 2.1 Git Verification

- **HEAD SHA:** `800cbf4b794590360edeb985ed4942eb71906ecf`
- **origin/main SHA:** `800cbf4b794590360edeb985ed4942eb71906ecf`
- **Synchronization:** Perfectly aligned (0 commits ahead, 0 behind).
- **Working Tree:** Pristine (`git status --short` returns empty).
- **Latest Commit:** `feat(dashboard): implement approval decision workflow` (Task 068 Phase 4C).
- **CI Status:** GitHub Actions Run `45153351609` completed with status `SUCCESS` (green).

### 2.2 Audit Methodology

The audit was conducted via direct static analysis of source files, package manifests, build scripts, test suites, and architectural specifications:

1. **Document-to-Source Mapping:** Requirements from the PRD, EDDs, and Architecture Bible were checked against actual TypeScript implementations in `apps/`, `packages/`, and `services/`.
2. **Persistence & Storage Audit:** Database connections, migration files, and state stores were inspected for ACID durability versus volatile in-memory collections.
3. **Contract Verification:** Zod schemas in `packages/contracts` were compared against backend route controllers, client API callers, and frontend viewmodels.
4. **Runtime & Sandbox Inspection:** Agent execution runtimes were inspected for genuine hardware/OS integration versus mocked/simulated stubs.
5. **Test Suite Analysis:** The 19 test files registered in root `package.json` were analyzed for assertion rigor, mock usage, and coverage blindspots.

---

## 3. Authoritative Product Scope

The full scope of NexusOS is defined across five core design artifacts:

- **PRD v1.0:** Enterprise requirements for local AI execution, desktop system agents, multi-tenant workspace isolation, HITL permissioning, and audit logging.
- **Architecture Bible:** System communication map, protocol specifications, tenant boundaries, and distributed event bus architecture.
- **Backend EDD:** REST API endpoints, task state machine, lease management, SSE streaming, and SQLite persistence.
- **Desktop Agent EDD:** Subsystem orchestration (Node/Native, Python sandbox, Browser sandbox, Local AI runtime), tray controller, and local approval host.
- **Experience Platform EDD:** Web dashboard responsive design, operator task controls, real-time activity graphs, memory visualization, and manual approval dialogs.

### Core Architectural Mandates

1. **Zero-Trust Local Execution:** All agent operations must execute within bounded sandboxes with explicit, cryptographic permission leases.
2. **Offline-First Resilience:** The system must function completely without outbound internet connectivity when configured with local models.
3. **Deterministic State Machine:** Task states (`PENDING`, `PLANNING`, `AWAITING_APPROVAL`, `EXECUTING`, `COMPLETED`, `FAILED`, `CANCELLED`) must transition strictly via state machine rules with persistent audit trails.
4. **Operator Authority:** Dangerous or out-of-policy tool calls must pause execution and present an actionable approval prompt to a human operator before expiring or proceeding.

---

## 4. Subsystem-by-Subsystem Implementation Matrix

| Subsystem                                                            | Intended Role                                                                                              | Current Source Implementation                                                                                | Status                 | Gaps / Real-World Blockers                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend REST & SSE API** (`services/backend`)                      | Central control plane for task submission, lifecycle state machine, event streams, and agent registration. | Express 4.x server with TypeScript routes for tasks, approvals, health, and SSE. Fully tested via supertest. | **COMPLETE (DURABLE)** | Task persistence is backed by `SqliteTaskRepository` (native `node:sqlite`). DatabaseBoundary is currently a simulated connectivity boundary; production wiring entrypoints are configured via factory and planned for Prompt 3. |
| **Contracts & Protocol** (`packages/contracts`)                      | Authoritative Zod schemas for tasks, events, approvals, policies, and agent capabilities.                  | Comprehensive schemas in `packages/contracts/src/` with strict validation rules.                             | **COMPLETE**           | Discrepancy identified between `ApprovalPromptItemSchema.expiresAt` (required) and dashboard viewmodel (optional).                                                                                                               |
| **Policy Engine** (`services/policy`)                                | RBAC, tenant isolation, and cryptographic lease token generation.                                          | HMAC-SHA256 signature generation and validation, policy rule evaluators in `services/policy/src/`.           | **COMPLETE**           | Relies on in-process symmetric secrets; KMS/vault integration is not wired.                                                                                                                                                      |
| **Identity Service** (`services/identity`)                           | User, service account, and tenant authentication and session token issuance.                               | In-process JWT signer/verifier with tenant claims validation.                                                | **COMPLETE**           | In-process library only; does not provide standalone OAuth2/OIDC provider bridge.                                                                                                                                                |
| **Memory & Graph Store** (`services/backend/src/memory`)             | Local semantic memory and knowledge graph storage.                                                         | Full SQLite-backed store with vector cosine similarity, FTS5 full-text search, and node/edge relationships.  | **COMPLETE**           | Functional and durable. Fully tested with Node 24 native SQLite engine (`node:sqlite` `DatabaseSync`).                                                                                                                           |
| **Desktop Agent Core** (`apps/desktop-agent`)                        | Local agent supervisor managing task queues, runtimes, and local approval host.                            | Implemented in `apps/desktop-agent/src/supervisor.ts`, with local approval HTTP host.                        | **PARTIALLY COMPLETE** | Runtime supervisor manages child tasks, but process lifecycle depends on ephemeral in-memory state.                                                                                                                              |
| **Browser Runtime** (`apps/desktop-agent/src/runtimes/browser`)      | Headless browser execution for web navigation and content extraction.                                      | Implemented in `runtimes/browser/runtime.ts` with strict domain whitelist and URL validation.                | **SIMULATED**          | Does not execute real Chromium/Playwright. Extracts hardcoded mock HTML strings.                                                                                                                                                 |
| **Local AI Runtime** (`apps/desktop-agent/src/runtimes/local-ai`)    | Hardware-accelerated local GGUF model execution with VRAM budgeting.                                       | Complete model catalog, GGUF parser, VRAM offload planner, and fallback adapters.                            | **PARTIALLY COMPLETE** | Real native `llama.cpp` node-addon bindings not bundled; falls back to loopback HTTP servers or simulated token generators.                                                                                                      |
| **System/Node Runtime** (`apps/desktop-agent/src/runtimes/system`)   | Local shell execution, file system operations, and process management.                                     | Sandboxed command execution with strict path whitelisting and command blacklist.                             | **COMPLETE**           | Fully functional with real subprocess execution and timeout protection.                                                                                                                                                          |
| **Desktop Tray UI** (`apps/desktop-agent/src/ui/tray-controller.ts`) | Desktop system tray icon, status indicators, and notification hooks.                                       | Headless state machine emitting tray events and status changes.                                              | **PARTIALLY COMPLETE** | No native Win32/macOS tray library (e.g. Electron or native OS binding) wired to the headless state machine.                                                                                                                     |
| **Web Dashboard** (`apps/web-dashboard`)                             | Operator web interface for task monitoring, inspection, approvals, and activity.                           | Vanilla TypeScript SPA with modular views (Overview, Tasks, Approvals, Activity, Agents, Memory, Graph).     | **COMPLETE**           | Fully tested with DOM unit tests and mock APIs. Lacks production serving and live reverse-proxy scripts.                                                                                                                         |
| **Plugin SDK** (`packages/plugin-sdk`)                               | Developer extensibility framework for custom tools and agent skills.                                       | Manifest schemas, plugin loader, and sandboxed sandbox execution interface.                                  | **COMPLETE**           | Basic interface implemented and tested; external plugin marketplace runtime not implemented.                                                                                                                                     |
| **Monorepo Tooling** (`infrastructure/`, `tools/`)                   | Deployment configurations, CI/CD pipelines, container images.                                              | GitHub Actions CI workflow in `.github/workflows/ci.yml`.                                                    | **NOT IMPLEMENTED**    | `infrastructure/` and `tools/` contain only placeholder `README.md` files; no Dockerfiles or Helm charts.                                                                                                                        |

---

## 5. Security, Tenant Isolation & Reliability Gaps

### 5.1 In-Memory Persistence Failure

- **Vulnerability:** In `services/backend/src/tasks/controller.ts`, tasks, leases, and receipts were originally stored in an in-memory `Map<string, TaskRecord>`. Note that `services/backend/src/database/boundary.ts` operates as a simulated connectivity boundary rather than a live database connection.
- **Remediation & Resolution:** Implemented `TaskRepository` interface and `SqliteTaskRepository` under `services/backend/src/tasks/repository.ts` using Node 24 native `node:sqlite` `DatabaseSync` with full WAL journaling, atomic transactions, parameterized queries, and versioned migrations. Task state persists across restarts.

### 5.2 Tenant & Workspace Isolation

- **Status:** Tenant and workspace headers (`x-tenant-id`, `x-workspace-id`) are validated by Express middleware and checked in policy evaluation.
- **Gap:** When tasks are dispatched to local runtimes, isolation relies purely on working directory path sandboxing (`validatePathWithinBase`). OS-level container isolation (e.g., Docker/Podman/cgroups) is not implemented for shell execution.

### 5.3 Secret Management

- **Status:** Policy tokens and HMAC leases use runtime-provided symmetric secrets.
- **Gap:** Secrets are read from environment variables (`POLICY_SECRET`, `JWT_SECRET`) without fallback to OS credential vaults (Windows Credential Manager, macOS Keychain) or HSMs.

---

## 6. Testing, Mocking, and Runtime-Validation Gaps

### 6.1 Current Test Suite Analysis

The repository currently executes 19 test suites in CI:

1. `tests/hardening/dashboard-event-projection-phase3b.test.ts`
2. `tests/hardening/dashboard-resilience-operator-ux-phase3c.test.ts`
3. `tests/hardening/dashboard-task-inspection-phase4a.test.ts`
4. `tests/hardening/dashboard-cancellation-phase4b.test.ts`
5. `tests/hardening/dashboard-approval-phase4c.test.ts`
6. `packages/contracts/tests/contracts.test.ts`
7. `services/policy/tests/policy.test.ts`
8. `services/identity/tests/identity.test.ts`
9. `services/backend/tests/memory/sqlite-memory-store.test.ts`
10. `services/backend/tests/tasks.test.ts`
11. `services/backend/tests/task-persistence-sqlite.test.ts`
12. `apps/desktop-agent/tests/agent.test.ts`
13. `apps/desktop-agent/tests/local-ai-runtime.test.ts`
14. `apps/desktop-agent/tests/browser-runtime.test.ts`
15. `apps/desktop-agent/tests/approval-host.test.ts`
16. `apps/desktop-agent/tests/hardware-detection.test.ts`
17. `apps/web-dashboard/tests/dashboard.test.ts`
18. `apps/web-dashboard/tests/dashboard-api-client.test.ts`
19. `apps/web-dashboard/tests/dashboard-approvals-view.test.ts`

### 6.2 Reality vs. Mocking Breakdown

- **Real:**
  - Contracts & Zod validation (100% real, no mocks).
  - SQLite Knowledge Graph & Vector Memory (100% real SQLite engine with in-memory or file databases).
  - Identity & Policy Token Signatures (100% real HMAC-SHA256 crypto).
  - System Shell Execution (100% real child process execution with sandbox limits).
  - Web Dashboard DOM rendering and EventSource handling (100% real happy-dom / jsdom execution).
- **Simulated / Stubbed:**
  - **Browser Runtime:** Uses string stubs returning mock HTML rather than driving CDP/Chromium.
  - **Local AI Execution:** Emulates inference via loopback endpoints or synthetic generators rather than native llama bindings.
  - **Task Repository:** Volatile JS `Map` rather than a persistent database.

---

## 7. Documentation & Operational Gaps

1. **No Production / Dev Launch Scripts:** Root `package.json` contains `build`, `test`, `lint`, and `typecheck`, but no `pnpm dev` or `pnpm start` scripts to launch the backend server and serve the dashboard frontend.
2. **Missing Operational Runbooks:** Documentation does not provide disaster recovery runbooks, database migration guides, or hardware deployment checklists.
3. **Container / Infrastructure Manifests:** The repository lacks a standard `docker-compose.yml` or Dockerfiles for containerized backend evaluation.

---

## 8. Known Discrepancy Findings: Approval Expiry Rules

### 8.1 Investigation Target

Audit the discrepancy between the authoritative backend contract and the web dashboard implementation regarding approval prompt expiry (`expiresAt`).

### 8.2 Authoritative Backend Contract Inspection

In `packages/contracts/src/approval/index.ts` (lines 80–92):

```typescript
export const ApprovalPromptItemSchema = z.object({
  promptId: z.string().min(1),
  taskId: z.string().min(1),
  tenantId: z.string().min(1),
  actionType: z.string().min(1),
  state: ApprovalStateSchema,
  summary: z.string().min(1),
  details: z.record(z.unknown()),
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(), // MANDATORY, POSITIVE INTEGER
  resolvedAt: z.number().int().positive().optional(),
  resolvedBy: z.string().optional(),
  decisionReason: z.string().optional(),
});
```

Furthermore, in `apps/desktop-agent/src/ui/approval-host.ts`:

- An approval prompt is **always** assigned a concrete expiry: `expiresAt = now + ttlSeconds * 1000` (default 60s TTL).
- `listPendingPrompts()` strictly filters prompts using: `item.state === 'PENDING' && item.expiresAt > now`.
- `submitDecision()` strictly verifies expiry:
  ```typescript
  if (Date.now() > item.expiresAt) {
    res.status(410).json({ error: 'PROMPT_EXPIRED', message: 'Approval prompt has expired' });
    return;
  }
  ```

### 8.3 Web Dashboard Implementation Inspection

In `apps/web-dashboard/src/main.ts`:

- The viewmodel definition defines `expiresAt` as optional:
  ```typescript
  export interface ApprovalViewModel {
    ...
    expiresAt?: number;
  }
  ```
- The actionability check permits `undefined`:
  ```typescript
  export function isApprovalActionable(item: ApprovalViewModel): boolean {
    const now = Date.now();
    return item.state === 'PENDING' && (item.expiresAt === undefined || item.expiresAt > now);
  }
  ```

### 8.4 Root Cause & Resolution

- **Root Cause:** The dashboard viewmodel and helper functions were written defensively to accommodate loose synthetic mock payloads in test fixtures where `expiresAt` was omitted.
- **Contract Reality:** A prompt without `expiresAt` violates the authoritative schema (`ApprovalPromptItemSchema`) and is rejected by the backend. The backend never emits an approval prompt lacking `expiresAt`.
- **Resolution Plan:** Harden `ApprovalViewModel` in `apps/web-dashboard/src/main.ts` to mandate `expiresAt: number`, remove the `expiresAt === undefined` fallback, and update test fixtures to provide valid timestamps matching the backend schema.

---

## 9. Prioritized Remaining-Work Matrix

| Subsystem / Capability                     | Current Classification      | Priority          | Description of Required Work                                                                                                |
| ------------------------------------------ | --------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Durable Task Persistence**               | PARTIALLY COMPLETE          | **P0 (Critical)** | Replace backend `Map<string, TaskRecord>` with SQLite `SqliteTaskRepository` adhering to ACID transactions.                 |
| **Approval Contract Expiry Hardening**     | COMPLETE (Discrepancy)      | **P0 (Critical)** | Align web dashboard `ApprovalViewModel` to strictly require `expiresAt: number` matching contract schema.                   |
| **Monorepo Dev/Start Orchestration**       | NOT IMPLEMENTED             | **P1 (High)**     | Add `dev` and `start` scripts to root `package.json`, bundle static web dashboard serving into backend.                     |
| **Real Headless Browser Adapter**          | SIMULATED                   | **P1 (High)**     | Introduce Playwright/Puppeteer driver behind `BrowserRuntime` for genuine DOM extraction.                                   |
| **Local AI GGUF Model Execution**          | PARTIALLY COMPLETE          | **P1 (High)**     | Integrate verifiable local model download verification, llama.cpp bindings or verified loopback integration.                |
| **Production Containerization**            | NOT IMPLEMENTED             | **P2 (Medium)**   | Provide Dockerfile and `docker-compose.yml` for unified backend, memory, and dashboard deployment.                          |
| **End-to-End Vertical Slice Verification** | NEEDS REAL-WORLD VALIDATION | **P2 (Medium)**   | Automated E2E test verifying: Task submit -> Persistent Store -> HITL Prompt -> Dashboard Decision -> Execution -> Receipt. |

---

## 10. Authoritative 6-Prompt Completion Roadmap

To bring NexusOS from its current state to a complete, verified, production-ready release, the remaining work is divided into **6 focused, sequential prompts**. Each prompt has strict scope, non-overlapping boundaries, and explicit acceptance criteria.

```
+-----------------------------------------------------------------------------------+
|                           NEXUSOS COMPLETION ROADMAP                              |
+-----------------------------------------------------------------------------------+
| Prompt 1: Backend Durable Task & Workflow Persistence (SQLite Task Store)         |
|                                         |                                         |
|                                         v                                         |
| Prompt 2: Web Dashboard Contract Hardening & HITL Expiry Alignment                |
|                                         |                                         |
|                                         v                                         |
| Prompt 3: Developer Lifecycle & Server Orchestration (Static Serving & Dev CLI)   |
|                                         |                                         |
|                                         v                                         |
| Prompt 4: Real Browser Runtime Adapter Integration (Headless Automation)          |
|                                         |                                         |
|                                         v                                         |
| Prompt 5: Local AI Model Verification & Inference Engine Bridge                   |
|                                         |                                         |
|                                         v                                         |
| Prompt 6: Full System End-to-End Release Hardening, Dockerization & Final Gate    |
+-----------------------------------------------------------------------------------+
```

---

### Prompt 1: Backend Durable Task & Workflow Persistence

- **Objective:** Eliminate volatile in-memory task storage in `services/backend/src/tasks/controller.ts` by implementing a durable SQLite-backed repository.
- **Scope:**
  - Create `services/backend/src/tasks/repository.ts` implementing `TaskRepository`, `InMemoryTaskRepository`, and `SqliteTaskRepository` backed by Node 24 native `node:sqlite` (`DatabaseSync`).
  - Persist full authoritative `TaskRecord` with indexed relational columns and validated JSON serialization.
  - Maintain ACID transactional integrity for state transitions without altering REST API contracts or Zod schemas.
  - Preserve unresolved execution states on restart; reconcile expired leases safely via contract-compliant `reconcileExpiredLeases()`.
- **Status:** **COMPLETE** (Prompt 1). Tested across 16 durability, restart, isolation, and migration test cases in `services/backend/tests/task-persistence-sqlite.test.ts`. Production startup composition entrypoints will be wired in Prompt 3.

---

### Prompt 2: Web Dashboard Contract Hardening & HITL Expiry Alignment

- **Objective:** Resolve the known discrepancy in approval prompt expiration between the backend contract and web dashboard.
- **Scope:**
  - Update `ApprovalViewModel` in `apps/web-dashboard/src/main.ts` to require `expiresAt: number` (eliminating `expiresAt?: number`).
  - Update `isApprovalActionable()` to strictly check `item.state === 'PENDING' && item.expiresAt > Date.now()` (removing `expiresAt === undefined`).
  - Enhance dashboard countdown/timer UI to display dynamic "Expires in Xs" countdown on pending approval cards.
  - Automatically mark approval cards as expired/disabled in the UI when the local clock exceeds `expiresAt`.
  - Update test fixtures in `apps/web-dashboard/tests/` to provide valid positive timestamps.
- **Constraints:**
  - Do not weaken backend contract validation.
  - Preserve all existing Phase 4A, 4B, and 4C test assertions.
- **Verification & Acceptance Criteria:**
  - Test verifying prompt renders actionable when `expiresAt > now`.
  - Test verifying prompt renders disabled/expired when `expiresAt <= now`.
  - Full dashboard test suite passes cleanly.

---

### Prompt 3: Developer Lifecycle & Server Orchestration

- **Objective:** Provide standard monorepo scripts and static hosting so operators and developers can launch the full NexusOS stack with a single command.
- **Scope:**
  - Add static file serving to `services/backend`: serve compiled `apps/web-dashboard` bundle from `/` or `/ui` when static directory exists.
  - Configure CORS and WebSocket/SSE proxying for seamless local development.
  - Add root scripts to `package.json`:
    - `pnpm dev`: Concurrently runs backend server and dashboard builder in watch mode.
    - `pnpm start`: Launches the compiled backend and serves the production dashboard.
- **Constraints:**
  - No external runtime dependencies beyond existing monorepo tools.
  - Must work seamlessly across Windows (PowerShell) and POSIX environments.
- **Verification & Acceptance Criteria:**
  - Running `pnpm build && pnpm start` opens the backend HTTP server and successfully serves `index.html` and assets on `http://127.0.0.1:3000`.

---

### Prompt 4: Real Browser Runtime Adapter Integration

- **Objective:** Upgrade the browser runtime from a hardcoded string stub to a genuine headless browser driver.
- **Scope:**
  - Introduce an abstraction layer in `apps/desktop-agent/src/runtimes/browser/`: `BrowserDriver` interface with `PuppeteerDriver` and `MockBrowserDriver` implementations.
  - Implement genuine headless DOM navigation, content extraction, and screenshot capture via Playwright or Puppeteer Core.
  - Enforce sandbox security constraints: strictly block local file URLs (`file://`), private IP ranges (`10.0.0.0/8`, `192.168.0.0/16`, `127.0.0.1`), and non-whitelisted domains.
  - Retain `MockBrowserDriver` for isolated, lightweight unit test environments.
- **Constraints:**
  - Browser must run strictly headless with GPU acceleration disabled and sandbox flags enabled.
  - Download operations and arbitrary script evaluation disabled.
- **Verification & Acceptance Criteria:**
  - Browser runtime integration test executing against a local test HTTP server, successfully extracting DOM text.
  - Security test verifying private IP and `file://` navigation attempts are rejected with security errors.

---

### Prompt 5: Local AI Model Verification & Inference Engine Bridge

- **Objective:** Connect the local AI runtime to verifiable model weights and an active inference engine.
- **Scope:**
  - Implement `ModelVerificationService`: verifies SHA-256 checksums, GGUF metadata, quantization levels, and memory requirements before loading.
  - Provide a robust local inference bridge: connects to a local OpenAI-compatible endpoint (Ollama / llama.cpp server / vLLM) with automatic health probing, model availability checks, and streaming response parsing.
  - Enhance fallback hierarchy: High-VRAM GPU -> Low-VRAM GPU -> Local CPU inference -> Graceful out-of-memory error reporting.
- **Constraints:**
  - Do not bundle multi-gigabyte model binaries directly in the Git repository.
  - Preserve offline-first operation: all checksums and manifests verified locally.
- **Verification & Acceptance Criteria:**
  - Model verification unit tests validating correct and corrupted GGUF checksums.
  - Mock inference engine integration test verifying prompt submission and token streaming.

---

### Prompt 6: Full System End-to-End Release Hardening & Dockerization

- **Objective:** Final release packaging, containerization, end-to-end integration verification, and deployment documentation.
- **Scope:**
  - Add root `Dockerfile` and `docker-compose.yml` defining production backend, SQLite volume mount, and web dashboard hosting.
  - Implement full vertical slice E2E test (`tests/e2e/full-task-lifecycle.test.ts`):
    1. Submit task via REST API.
    2. Persist in SQLite database.
    3. Supervisor assigns task to runtime.
    4. Runtime triggers sensitive operation requiring approval.
    5. Approval prompt emitted over SSE to dashboard client.
    6. Operator approves task via dashboard client API.
    7. Task resumes, completes execution, and persists execution receipt.
    8. Verify audit logs and event history.
  - Consolidate operator documentation, deployment guides, and API reference.
- **Constraints:**
  - E2E test must run in CI using ephemeral test databases and mock approval actors.
  - Working tree must be 100% clean and all linters/checks must pass.
- **Verification & Acceptance Criteria:**
  - All CI test suites, E2E tests, typecheck, lint, and architecture validation pass.
  - Docker container builds and starts cleanly.

---

## 11. Explicit Project Completion & Definition of Done Criteria

NexusOS shall be declared **100% COMPLETE and RELEASE READY** when and only when all of the following criteria are met:

1. **State Durability:** Task submission, status transitions, execution leases, and receipts survive complete backend service process termination and restart.
2. **Contract Fidelity:** 100% schema alignment across backend, desktop agent, client API, and web dashboard, with zero optionality mismatches on critical fields (such as `expiresAt`).
3. **Execution Authenticity:** Browser and system runtimes perform real-world execution within secure sandbox boundaries, with simulated stubs retained solely for isolated unit tests.
4. **Operator Experience:** The operator web dashboard builds, runs, connects to backend SSE streams, renders real-time state, and executes task controls (cancellation, approval, inspection) against live persistent backend services.
5. **Operational Packaging:** Single-command dev/start scripts and containerized deployment manifests exist, build cleanly, and run out of the box.
6. **Continuous Integration:** All unit, integration, hardening, and end-to-end test suites execute and pass on clean GitHub Actions CI across all supported operating systems.
