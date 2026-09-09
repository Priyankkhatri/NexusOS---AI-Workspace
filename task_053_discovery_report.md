# TASK 053 DISCOVERY REPORT

## Sprint 1 Milestone 5: Web Dashboard Experience Platform & Activity/Evidence Observability

---

### 1. Task Identity

- **Task Identifier**: `TASK-053` (Task 053)
- **Canonical Title**: `TASK 053: SPRINT 1 MILESTONE 5 — WEB DASHBOARD EXPERIENCE PLATFORM & ACTIVITY/EVIDENCE OBSERVABILITY`
- **Sprint & Milestone**: Sprint 1, Milestone 5
- **Sprint Week & Workstream**: Week 2 — Experience Plane & Web Platform
- **Authoritative Backlog Item**:
  - `docs/SPRINT_1_READINESS_AND_BACKLOG.md` Section 4, Item 4: _"Web Dashboard Experience Platform (Phase 1 Skeleton)"_
  - `docs/SPRINT_1_READINESS_AND_BACKLOG.md` Section 5, Sequencing: _"Sprint 1 Week 2: 5. Web Dashboard Experience Platform (`apps/web-dashboard`)"_
- **Predecessor Dependencies**:
  - **Task 049 (Sprint 1 Milestone 1)**: Multi-Step Workflow Graph Execution — **COMPLETE** (HEAD `d549880`)
  - **Task 050 (Sprint 1 Milestone 2)**: Desktop Agent Filesystem & Sandbox Runtime Hardening — **COMPLETE** (HEAD `757b4ac`)
  - **Task 051 (Sprint 1 Milestone 3)**: Local AI Model Router & ONNX/LLaMA Engine Integration — **COMPLETE** (HEAD `40205c3`)
  - **Task 052 (Sprint 1 Milestone 4)**: Human-in-the-Loop Desktop Approval Interceptor & Native UI Integration — **COMPLETE** (HEAD `446f23f`)
- **Owning Subsystem**:
  - **Primary**: Experience Platform (`apps/web-dashboard/`)
  - **Secondary (Projection Endpoints)**: Backend Services (`services/backend/`)
- **Security Classification**:
  - **UNTRUSTED CLIENT (Experience Plane)**: Per Architecture Bible Section 1.4 and Experience Platform EDD Section 18, the Web Dashboard operates as an untrusted client outside the security perimeter. It displays authority but does NOT create authority; all permissions, grants, approvals, mutations, and tenant boundaries MUST be enforced server-side by Backend and Policy services.

---

### 2. Baseline SHA

- **Current HEAD Commit**: `446f23fc8f4de4b1986e79f92df3cb4f6ba8be75`
- **Remote `origin/main` Commit**: `446f23fc8f4de4b1986e79f92df3cb4f6ba8be75`
- **Synchronization State**: Fully up to date with remote `main`.
- **Preceding Milestone Commit**: `446f23f` (`feat(hitl): Sprint 1 Milestone 4 — Human-in-the-Loop Desktop Approval Interceptor & Native UI Integration (Task 052)`)

---

### 3. Repository / Git State

- **Branch**: `main`
- **Working Tree Status**: Clean (0 modified files, 0 untracked files, 0 staged changes)
- **Package Manager & Toolchain**:
  - Node.js: `>=24.0.0` (Node 24 LTS runtime)
  - Package Manager: `pnpm@11.21.0` (frozen lockfile hygiene, pnpm workspaces)
  - TypeScript: `5.7.3`
  - ESLint: `9.20.0` with `typescript-eslint 8.24.0`
  - Prettier: `3.5.0`
- **Quality Gates Execution Verification**:
  - `npx pnpm run typecheck`: **PASS** (`tsc --noEmit` exits 0)
  - `npx pnpm run lint`: **PASS** (0 errors)
  - `npx pnpm run format:check`: **PASS** (100% clean formatting)
  - `npx pnpm run validate`: **PASS** (repository structure & architecture boundaries valid)
  - `npx pnpm run security`: **PASS** (0 secrets detected)
  - `npx pnpm run test`: **PASS** (**847/847 passing** across 146 test suites)

---

### 4. Authoritative Sources Consulted

In accordance with Section 1 of the instruction hierarchy:

1. **NexusOS Architecture Bible — Pre-EDD Foundation** ([`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)):
   - Section 1.4: Multi-plane topology (Experience Plane vs Control Plane vs Execution Plane)
   - Section 2.1: Trust boundaries and prohibition on client-side authority
   - Directory structure: `apps/web-dashboard/` allocated for web experience
2. **NexusOS Experience Platform Engineering Design Document (EDD)** ([`docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md)):
   - Sections 1–5: Product mental model, IA, layout system, design tokens, component library
   - Section 7: Activity Center (canonical event projection, cursor pagination, execution inspector, failure classification)
   - Section 14: Real-time experience (WebSocket/SSE, cursor recovery, reconnect backoff)
   - Section 15: State management (authoritative server state, bounded query cache, zero optimistic terminal mutations)
   - Section 16 & 17: Accessibility (WCAG 2.2 AA) and performance budgets (<50ms main-thread long tasks, virtualized lists)
   - Section 18: Security (untrusted client, no raw secrets, strict tenant filtering, output sanitization)
   - Section 21.1 & 21.2: Major page specifications (Dashboard Overview & Tasks / Task Detail)
3. **NexusOS API Contract Specification — Section 1: System Communication Map** ([`docs/Architecture_and_Specs/NexusOS_API_Contract_Specification_Section_1_System_Communication_Map.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_API_Contract_Specification_Section_1_System_Communication_Map.md)):
   - Section 1.3 & 1.5: `UI_DASHBOARD -- REST/WS --> API_GATEWAY / BACKEND`
   - Section 1.4: Trust boundaries (Dashboard is an untrusted client)
4. **NexusOS Enterprise PRD for AI Desktop Agent and Web Platform** ([`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md)):
   - Section 12: Web Dashboard UX Specification (12.1 Navigation, 12.2 Dashboard, 12.4 Task Detail, 12.5 Design System, 12.6 States and Errors)
5. **NexusOS AI Coding Standards and Development Guide** ([`docs/Architecture_and_Specs/NexusOS_AI_Coding_Standards_and_Development_Guide.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_AI_Coding_Standards_and_Development_Guide.md)):
   - Preservation of architecture boundaries, no direct cross-plane leakage, AI agents as implementation agents
6. **NexusOS Sprint 0 Implementation Blueprint** ([`docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md)):
   - Section 58 & 59: Sprint 1 Definition of Ready and Candidate Work
7. **Sprint 1 Readiness Assessment & Candidate Backlog** ([`docs/SPRINT_1_READINESS_AND_BACKLOG.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/SPRINT_1_READINESS_AND_BACKLOG.md)):
   - Item 4 / Item 5: Web Dashboard Experience Platform (Phase 1 Skeleton)
8. **ADR 0001: Monorepo Foundation** ([`adrs/0001-monorepo-foundation.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/adrs/0001-monorepo-foundation.md)):
   - Monorepo package topology, workspace hoisting rules, build and test isolation
9. **Prior Milestone Completion Reports**:
   - `task_049_completion_report.md` (Workflow Graph Execution)
   - `task_050_completion_report.md` (Filesystem Sandboxing)
   - `task_051_completion_report.md` (Local AI Model Router)
   - `task_052_completion_report.md` (Human-in-the-Loop Desktop Approvals)

---

### 5. Roadmap Position

```
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 1 WEEK 1: RUNTIME & ORCHESTRATION FOUNDATIONS                   │
│ ✅ Task 049: Multi-Step Workflow Graph Execution (COMPLETE)            │
│ ✅ Task 050: Desktop Filesystem Sandbox Hardening (COMPLETE)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ SPRINT 1 WEEK 2: AI INTEGRATION & EXPERIENCE PLANE                     │
│ ✅ Task 051: Local AI Model Router & Engine Integration (COMPLETE)     │
│ ✅ Task 052: Human-in-the-Loop Desktop Approval Interceptor (COMPLETE) │
│ 🔵 Task 053: Web Dashboard Experience Platform (CURRENT DISCOVERY)    │
└────────────────────────────────────────────────────────────────────────┘
```

Task 053 is the **culminating milestone of Sprint 1**. It delivers the operator-facing Experience Platform slice that unites the foundations built in Tasks 049–052 into a coherent, observable, policy-governed web surface.

---

### 6. Owning Subsystems & Directory Boundaries

- **Owning Subsystems**:
  - `apps/web-dashboard/` (Experience Platform frontend application)
  - `services/backend/` (Control-Plane HTTP and event projection endpoints)
  - `packages/contracts/` (Canonical API query, dashboard summary, and activity projection schemas)
- **Allowed Directories**:
  - `apps/web-dashboard/**`
  - `services/backend/src/**` (read-only projection endpoints, e.g. `GET /v1/tasks`, `GET /v1/activity`, `GET /v1/approvals`)
  - `packages/contracts/src/**` (projection schemas)
  - `tests/vertical-slice/` (Sprint 1 Milestone 5 vertical-slice security tests)
- **Strictly Forbidden Directories**:
  - `apps/desktop-agent/**`: MUST NOT be modified or imported directly by the dashboard. The Web Dashboard CANNOT have a direct dependency on Desktop Agent internals, named pipes, or local IPC. All data flows strictly through the Backend / Event Bus.
  - `runtimes/**`: Runtime execution belongs exclusively to the Execution Plane.
  - `services/identity/**`: Authentication and OIDC validation logic is frozen from Sprint 0.
  - `services/policy/**`: Policy evaluation rules remain encapsulated behind `PolicyEvaluatorBoundary`.

---

### 7. Existing Implementation Audit

| Subsystem                   | Location                                            | Current Implementation Status                                                                                                                      | Gap for Task 053                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Dashboard App**       | `apps/web-dashboard/`                               | **DOES NOT EXIST** in tree.                                                                                                                        | Entire application must be scaffolded with HTML shell, Vite, React/vanilla UI components, design tokens, and state management.                                                          |
| **Backend App Server**      | `services/backend/src/server/app.ts`                | Exposes `/health/liveness`, `/health/readiness`, `POST /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/tasks/:id/cancel`, `POST /v1/tasks/:id/receipt`. | Missing `GET /v1/tasks` (task listing with tenant/workspace filtering), `GET /v1/activity` (event stream query), `GET /v1/approvals` (approval query), and `GET /v1/dashboard/summary`. |
| **Backend Task Controller** | `services/backend/src/tasks/controller.ts`          | Contains `getAllTasks()`, `getTask()`, `createTask()`, `createTaskGraph()`, `cancelTask()`, `settleReceipt()`.                                     | `getAllTasks()` returns unpaginated, unfiltered in-memory array. Needs tenant-filtered, cursor-paginated projection for dashboard ingestion.                                            |
| **Backend Event Publisher** | `services/backend/src/events/publisher-boundary.ts` | `InMemoryEventPublisherBoundary` collects `EventEnvelope` items.                                                                                   | No public query API or streaming bridge (SSE/WebSocket) to project these events to the Web Dashboard.                                                                                   |
| **Desktop Agent HITL**      | `apps/desktop-agent/src/ui/approval-host.ts`        | `NativeApprovalHost` handles desktop-level prompts, timeouts, and local IPC.                                                                       | Approvals exist locally on Desktop Agent. Dashboard cannot see pending approvals unless Backend provides a projection endpoint or receives relayed approval events.                     |
| **Desktop Agent Tray UI**   | `apps/desktop-agent/src/ui/tray-controller.ts`      | System tray state machine (`CONNECTED`, `WORKING`, `AWAITING_APPROVAL`, `ERROR`).                                                                  | Local to Windows taskbar; not accessible to remote web browser.                                                                                                                         |
| **Design System Tokens**    | N/A                                                 | None in repo.                                                                                                                                      | Need canonical CSS variables / tokens for light/dark theme, typography, status colors, spacing, and elevation per EDD Section 4.                                                        |

---

### 8. Existing Contracts Audit

Existing `@nexusos/contracts` exports:

- `packages/contracts/src/api/`: `APIRequestMetaSchema`, `APISuccessResponseSchema`, `APIErrorResponseSchema`, `serializeContract`, `deserializeContract`.
- `packages/contracts/src/events/`: `EventEnvelopeSchema`, `createEventEnvelope`.
- `packages/contracts/src/identity/`: `UUIDSchema`, `TenantIdSchema`, `DeviceIdSchema`, `TaskIdSchema`, `CorrelationIdSchema`.
- `packages/contracts/src/tasks/`: `TaskLifecycleStateSchema`, `TaskCreateRequestSchema`, `ExecutionReceiptSchema`, `WorkflowNodeSchema`, `WorkflowEdgeSchema`, `WorkflowDAGSchema`, `WorkflowExecutionReceiptSchema`, `TaskRecordSchema`, `TaskCancelRequestSchema`.
- `packages/contracts/src/approval/`: `ApprovalRiskTierSchema`, `ApprovalLifecycleStateSchema`, `ApprovalDecisionChoiceSchema`, `ApprovalPromptRequestSchema`, `ApprovalPromptItemSchema`, `ApprovalDecisionRequestSchema`, `ApprovalDecisionResultSchema`, `computeApprovalReceiptChecksum`, `isHighRiskCapability`.
- `packages/contracts/src/ai/`: `ModelProviderTypeSchema`, `LocalAiOperation`, `ModelHardwareBudgetSchema`, `ModelInferenceRequestSchema`, `ModelInferenceResponseSchema`, `computeModelEvidenceChecksum`.

**Contract Gaps for Task 053**:

1. `TaskLifecycleState`: Does not currently contain `AWAITING_APPROVAL`. In Task 052, `AgentOrchestrator` uses `AWAITING_APPROVAL`, but `TaskLifecycleStateSchema` in `@nexusos/contracts` has `SUBMITTED`, `POLICY_EVALUATED`, `LEASED`, `DISPATCHED`, `EXECUTING`, `RECEIPT_VERIFIED`, `COMPLETED`, `FAILED`, `CANCELLED`. Aligning `TaskLifecycleState` to include `AWAITING_APPROVAL` is required for end-to-end consistency.
2. `ActivityEventProjectionSchema`: No contract for paginated activity queries (`cursor`, `limit`, `tenantId`, `type`, `timeRange`).
3. `DashboardSummarySchema`: No contract for aggregated dashboard snapshot (`activeTaskCount`, `pendingApprovalCount`, `deviceHealthStatus`, `recentOutcomes`).

---

### 9. Existing APIs / Event Projections Audit

- **Current Backend Endpoints**:
  - `GET /health/liveness` → `{ status: 'HEALTHY', version, uptimeSeconds, state }`
  - `GET /health/readiness` → `{ status: 'READY', version, state }`
  - `POST /v1/tasks` → Single-task creation with policy evaluation and lease issuance
  - `GET /v1/tasks/:id` → Single-task status with tenant isolation (049-SEC-03: returns 404 on cross-tenant probe)
  - `POST /v1/tasks/:id/cancel` → Task cancellation with tenant check
  - `POST /v1/tasks/:id/receipt` → Execution receipt settlement with cryptographic verification
- **Missing Endpoints Required by Dashboard**:
  - `GET /v1/tasks`: List tasks with tenant isolation, pagination (`limit`, `cursor`), and status filter (`RUNNING`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`).
  - `GET /v1/activity`: Cursor-based query for event envelopes (`nexusos.events.*`) with tenant filtering.
  - `GET /v1/dashboard/summary`: High-level counts for attention banner, active tasks, approvals, and system posture.
  - `GET /v1/approvals`: List pending approvals requiring human intervention.
  - `POST /v1/approvals/:id/decision`: Authoritative backend endpoint for approval resolution.

---

### 10. Task 051 Integration State (Local AI Observability)

- **Available Data**:
  - Telemetry event: `schema:nexusos:ai:inference:evidence:v1`
  - Attributes: `modelId`, `provider`, `promptTokens`, `completionTokens`, `totalTokens`, `latencyMs`, `finishReason`, `cpuFallback`, `fallbackReason`, `evidenceChecksum`, `taskId`, `leaseId`.
- **Architectural Boundary Rule**:
  - The Dashboard **MUST NOT** directly query `ModelRuntimeManager` or `LocalAiRuntime` in `apps/desktop-agent`.
  - The Dashboard observes AI telemetry strictly through Backend API projections (`GET /v1/tasks/:id` receipt metadata, and `GET /v1/activity` event envelopes).
- **Dashboard Representation**:
  - In Task Detail (right pane per PRD 12.4): Display model provider (ONNX / LLaMA / CPU Fallback), latency, token count, and evidence checksum anchor.
  - If `cpuFallback: true`, render visible warning badge indicating VRAM budget was exceeded with fallback reason.

---

### 11. Task 052 Integration State (HITL Approvals)

- **Available Data**:
  - Canonical contracts: `ApprovalPromptItem`, `ApprovalDecisionRequest`, `ApprovalDecisionResult`, `computeApprovalReceiptChecksum`.
  - States: `PENDING`, `APPROVED`, `DENIED`, `EXPIRED`, `CANCELLED`.
  - Telemetry event: `schema:nexusos:approval:decision:v1`.
- **Strict Prohibition on Approval Bypass**:
  - The Web Dashboard must **NEVER** optimistically mutate a task from `AWAITING_APPROVAL` to `EXECUTING`.
  - The Web Dashboard must **NEVER** forge nonces or bypass backend authorization.
  - A dashboard approval action (`ALLOW` / `DENY`) must submit an authoritative `ApprovalDecisionRequest` containing valid nonce, tenant ID, and user identity to the Backend.
  - The Backend must verify lease validity, tenant ownership, single-resolution state, and receipt hash before acknowledging.
  - If a prompt has expired (>60s TTL), the UI must render the card as disabled / stale (`PROMPT_EXPIRED`) and reject client-side approval attempts.

---

### 12. Dashboard / Experience Platform Gaps

1. **Application Scaffold**: `apps/web-dashboard` does not exist in the repository.
2. **Global Shell & Layout**: No responsive layout shell (navigation sidebar, top bar with workspace/tenant indicator, main viewport).
3. **Overview Surface**: No dashboard home with:
   - Attention banner / Approval inbox card
   - Active tasks grid
   - Control plane & agent health indicator
   - Recent activity timeline
   - Resource & AI token usage summary
4. **Empty, Loading, Offline, and Error States**: EDD Section 12.6 requires every card and page to handle loading skeletons, empty data, network disconnection, and error recovery with correlation IDs.

---

### 13. Activity Center Gaps

1. **Canonical Event Projection**: Events published during task lifecycle (`nexusos.events.task.*`, `nexusos.events.policy.*`, `nexusos.events.approval.*`) are currently retained only in `InMemoryEventPublisherBoundary`.
2. **Activity Store & Query**: Backend lacks a structured activity projection store supporting `GET /v1/activity?tenantId=...&limit=...&cursor=...`.
3. **Activity Stream Component**: No visual timeline component displaying events chronologically with actor, timestamp, semantic icon, correlation ID, and expandable technical payload.
4. **Failure & Recovery Classification**: No UI classification distinguishing policy denial vs lease expiration vs execution crash vs human denial.

---

### 14. Evidence / Artifact Gaps

1. **Cryptographic Receipt Anchor**: `ExecutionReceipt` and `WorkflowExecutionReceipt` contain a 64-character SHA-256 `evidenceChecksum`. The UI currently has no component to inspect, copy, or verify this evidence anchor.
2. **Node Execution Outputs**: Workflow node outputs in `WorkflowExecutionReceipt.nodeOutputs` are not visually inspectable.
3. **Safe Previews & Redaction**: Output payloads must be sanitized to defang scripts, raw HTML, and secrets prior to display in the DOM.

---

### 15. Approval UX Gaps

1. **Approval Inbox**: No web UI surfacing pending prompts from `NativeApprovalHost` / Backend.
2. **Decision Controls**: No interactive ALLOW / DENY modal/card presenting:
   - Action identifier and capability name
   - Target agent / device ID
   - Risk tier badge (`HIGH` / `CRITICAL` in high-visibility warning colors)
   - Expiration countdown timer (visualizing 60s TTL)
   - Consequence disclosure (reversible vs irreversible)
   - Justification / user notes input
3. **Stale Card Protection**: UI must disable actions immediately when expiration countdown reaches zero or when another client resolves the prompt.

---

### 16. Security Gaps & Invariants

1. **Untrusted Client Invariant**: All mutations initiated from the Web Dashboard (`POST /v1/tasks`, `POST /v1/tasks/:id/cancel`, `POST /v1/approvals/:id/decision`) must be re-authenticated via JWT and re-authorized by the Backend.
2. **Tenant & Workspace Isolation**: Cross-tenant data display is strictly forbidden. The dashboard must never render tasks, activities, or approvals belonging to Tenant B when authenticated as Tenant A.
3. **Zero Direct Desktop Access**: The dashboard must never connect directly to the Desktop Agent's named pipe or local port.
4. **XSS & Content Sanitization**: Task titles, tool outputs, terminal logs, and parameter JSON must be sanitized and HTML-escaped.
5. **No Secret Exposure in UI State**: Credentials, auth tokens, lease private signatures, and raw secrets must never appear in URL query parameters, unredacted telemetry, or localStorage.

---

### 17. Performance / Accessibility Gaps

1. **Performance Budgets (EDD Section 17)**:
   - Initial authenticated shell usable: p75 < 2.5s.
   - Route transition: < 200ms visual feedback.
   - Long activity timeline / task list: Must use list virtualization or pagination to prevent main-thread tasks exceeding 50ms.
2. **Accessibility (WCAG 2.2 AA per EDD Section 16)**:
   - All interactive controls reachable via keyboard (Tab / Shift-Tab / Enter / Space).
   - High-contrast color palette where color is never the sole indicator of status.
   - ARIA live-regions (`aria-live="polite"` / `"assertive"`) for task status transitions and approval prompts.

---

### 18. Test Coverage Gaps

1. **Zero Dashboard Tests**: No unit, component, or visual tests exist for the Web Dashboard.
2. **Missing Backend List & Activity Tests**: No tests currently verify `GET /v1/tasks` (with tenant isolation) or `GET /v1/activity`.
3. **Vertical Slice Security Invariants Suite**: A dedicated suite `tests/vertical-slice/dashboard-security-invariants.test.ts` is required to validate `053-SEC-01` through `053-SEC-06`.

---

### 19. Legacy / Dead Code Findings

- **No Legacy UI Code**: There are zero legacy HTML/CSS/JS files in the repository. The tree is completely free of obsolete dashboard prototypes or abandoned UI dependencies.
- **Unused/Unexposed Backend Methods**: `TaskController.getAllTasks()` exists in `services/backend/src/tasks/controller.ts` (line 172) but is never wired to an HTTP route in `services/backend/src/server/app.ts`. This existing method can be extended with tenant filtering and pagination for Task 053.

---

### 20. Real vs Mock Classification

| Subsystem / Data Source           | Classification           | Authoritative Backing                                           | Notes                                                                                                |
| --------------------------------- | ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Task Intake & State Machine**   | **REAL**                 | `services/backend/src/tasks/controller.ts` & `state-machine.ts` | Fully implemented, policy-governed task state machine with cryptographic lease issuance.             |
| **Task Execution Engine**         | **REAL**                 | `apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`     | Real local execution with tool runtimes (filesystem, terminal, device, local AI).                    |
| **HITL Approval Host**            | **REAL**                 | `apps/desktop-agent/src/ui/approval-host.ts`                    | Real nonce enforcement, 60s timer, and deterministic receipt generation.                             |
| **Backend Event Publisher**       | **LOCAL / IN-MEMORY**    | `services/backend/src/events/publisher-boundary.ts`             | In-memory boundary capturing `EventEnvelope` items. Production Kafka/NATS deferred.                  |
| **Backend-to-Agent ACP Dispatch** | **EMULATED / IN-MEMORY** | `services/backend/src/server/acp-dispatch-bridge.ts`            | In-memory bridge simulating network dispatch. Production mTLS gateway deferred.                      |
| **Activity Store**                | **DEFERRED / IN-MEMORY** | Not yet implemented.                                            | Task 053 will provide an in-memory projection adapter backed by `EventPublisherBoundary`.            |
| **Web Dashboard Frontend**        | **NEW / SKELETON**       | `apps/web-dashboard/`                                           | Will be implemented as a clean, modern, responsive web application backed by real backend REST APIs. |

---

### 21. Exact Files Likely In Scope for Task 053 Implementation

#### New Files to Create:

1. `apps/web-dashboard/package.json` — Workspace package definition (dependencies, scripts: `dev`, `build`, `test`, `lint`).
2. `apps/web-dashboard/tsconfig.json` — TypeScript configuration.
3. `apps/web-dashboard/index.html` — HTML5 entry shell with semantic landmarks and metadata.
4. `apps/web-dashboard/src/index.css` — Modern design system tokens (dark/light themes, typography, status colors, glassmorphism, responsive grid).
5. `apps/web-dashboard/src/main.ts` / `src/App.ts` — Main dashboard shell, navigation, workspace selector, and routing.
6. `apps/web-dashboard/src/components/` — Reusable, accessible UI components:
   - `Header.ts`: Workspace selector, live connection indicator, health badge.
   - `Navigation.ts`: Accessible sidebar with keyboard navigation.
   - `OverviewCards.ts`: Active tasks, pending approvals, agent status, AI token usage.
   - `TaskList.ts`: Tenant-filtered task table with status badges and search/filter.
   - `TaskDetailModal.ts`: 3-column task inspector (graph/steps, live narrative/artifacts, metadata/controls).
   - `ApprovalInbox.ts`: High-visibility cards with 60s countdown timer and ALLOW/DENY controls.
   - `ActivityStream.ts`: Chronological event projection log with correlation IDs.
   - `EvidenceViewer.ts`: SHA-256 checksum inspector and node output viewer.
7. `apps/web-dashboard/src/api/client.ts` — Authenticated HTTP client communicating with Backend REST API.
8. `apps/web-dashboard/tests/` — Component and state reducer tests.
9. `tests/vertical-slice/dashboard-security-invariants.test.ts` — Dedicated end-to-end security invariants suite.

#### Existing Files to Enhance:

1. `services/backend/src/server/app.ts` — Wire `GET /v1/tasks` (with tenant filter & pagination), `GET /v1/activity`, `GET /v1/dashboard/summary`, `GET /v1/approvals`, `POST /v1/approvals/:id/decision`.
2. `services/backend/src/tasks/controller.ts` — Add tenant-filtered pagination to `getAllTasks()`, add activity query helper.
3. `packages/contracts/src/tasks/index.ts` — Ensure `TaskLifecycleState` includes `AWAITING_APPROVAL` for consistency.
4. `package.json` — Add `apps/web-dashboard` scripts and register vertical-slice test in `"test"`.

---

### 22. Exact Files That MUST NOT Be Modified

- `apps/desktop-agent/**` — Desktop Agent implementation must NOT be altered or coupled to the web dashboard.
- `services/identity/**` — Identity and token validation logic is frozen.
- `services/policy/**` — Policy evaluation rules must remain intact.
- `runtimes/**` — Tool runtimes are out of scope.
- `adrs/**` & `threat-models/**` — Architecture documentation and threat models must not be altered.
- `scripts/validate-repo.js` & `scripts/security-scan.js` — Core governance scripts must not be modified.

---

### 23. Acceptance Criteria

From `docs/SPRINT_1_READINESS_AND_BACKLOG.md` Item 4 and PRD Section 12:

1. **Dashboard Overview**:
   - Visual summary card displaying active tasks, awaiting approvals, connected devices, and AI resource usage.
   - Real-time health indicator reflecting Backend readiness (`/health/readiness`).
2. **Visual Activity Log**:
   - Displays in-flight and completed tasks with timestamp, status badge, capability ID, and correlation ID.
   - Supports filtering by status and tenant isolation.
3. **HITL Approval Controls**:
   - Surfacing pending approvals with action name, risk tier, and 60-second expiration countdown.
   - Interactive ALLOW / DENY buttons dispatching to Backend decision endpoint.
   - Stale / expired approvals are disabled immediately.
4. **Task Detail & Execution Graph**:
   - Inspect single-task and multi-node workflow DAG status.
   - Display node execution states, dependency edges, and step outcomes.
5. **Evidence & Artifact Observability**:
   - Display deterministic SHA-256 evidence checksums for task receipts and AI inference.
6. **Failure & Offline States**:
   - Informative loading skeletons, empty states, and offline reconnection banners.
   - Correlation IDs displayed on all error messages.

---

### 24. Required Security Invariants

The implementation must define and pass tests for the following canonical security invariants:

- **053-SEC-01: UNTRUSTED CLIENT BOUNDARY & RE-AUTHORIZATION**
  - Web Dashboard mutations (`POST /v1/tasks`, `POST /v1/tasks/:id/cancel`, `POST /v1/approvals/:id/decision`) must require valid JWT authentication and server-side policy re-evaluation. The dashboard cannot create authority or execute tools directly.
- **053-SEC-02: TENANT & WORKSPACE STRICT ISOLATION**
  - Tasks, activities, and approvals must be strictly filtered by `tenantId`. Probing tasks or activities belonging to Tenant B while authenticated as Tenant A must fail closed (returning 404 or empty list without metadata leakage).
- **053-SEC-03: APPROVAL INTEGRITY & BYPASS PREVENTION**
  - Dashboard UI cannot bypass approval gates or optimistically advance tasks from `AWAITING_APPROVAL`. Approvals must be verified via cryptographic nonce and lease re-validation at the Backend. Stale or expired approvals must be rejected.
- **053-SEC-04: XSS & CONTENT SANITIZATION**
  - All external, untrusted, or model-generated text rendered by the dashboard (task parameters, terminal outputs, error messages, descriptions) must be safely escaped or sanitized. Raw HTML execution or script injection must be blocked.
- **053-SEC-05: SENSITIVE DATA & SECRET REDACTION**
  - UI telemetry, client error logs, and activity streams must redact passwords, tokens, API keys, and HMAC signatures. Secrets must never be stored in browser storage (`localStorage`, `sessionStorage`) or URL parameters.
- **053-SEC-06: RECOVERY & STALE STATE FAIL-CLOSED**
  - Disconnection from Backend or expired auth tokens must transition dashboard controls to read-only/disabled state. Actions cannot be taken against unknown or reconciling server states.

---

### 25. Required Tests

1. **Dashboard UI Unit & Component Tests**:
   - Rendering of overview cards (active tasks, approvals, health status).
   - Task list filtering and pagination.
   - Approval countdown timer and expired-state disabling.
   - XSS sanitization helper validation.
2. **Backend API Projection Tests**:
   - `GET /v1/tasks`: Returns tasks for caller's tenant; strictly isolates cross-tenant data.
   - `GET /v1/activity`: Returns chronological event stream for caller's tenant.
   - `GET /v1/dashboard/summary`: Returns accurate counts matching task database.
   - `POST /v1/approvals/:id/decision`: Successfully routes decision; rejects cross-tenant attempts.
3. **Dedicated Vertical-Slice Security Suite** (`tests/vertical-slice/dashboard-security-invariants.test.ts`):
   - `053-SEC-01`: Mutation re-authorization and zero-direct-execution boundary.
   - `053-SEC-02`: Cross-tenant task/activity query isolation.
   - `053-SEC-03`: Approval gate enforcement and stale-decision rejection.
   - `053-SEC-04`: Script/HTML injection defanging in rendered outputs.
   - `053-SEC-05`: Sensitive secret redaction in UI projections.
   - `053-SEC-06`: Offline / disconnected fail-closed posture.

---

### 26. Risks, Ambiguities, and ADR Requirements

1. **Frontend Framework vs Minimal Footprint**:
   - _Consideration_: The repo currently has zero frontend dependencies (no React or Vite in root).
   - _Recommendation_: Implement `apps/web-dashboard` as a lightweight Vite + TypeScript web application utilizing vanilla DOM / component modules with rich CSS tokens and utilities (consistent with repo instructions). This avoids adding heavy React 19 / JSX bloat to the monorepo while delivering rich glassmorphism aesthetics, responsive layouts, fast startup, and 100% testability.
   - _ADR Required?_: No, this conforms to the existing Blueprint Section 59 and Experience Platform EDD.
2. **Backend Approval Inbox API**:
   - _Consideration_: In Task 052, `NativeApprovalHost` was implemented in `apps/desktop-agent`. For the Web Dashboard to show pending approvals, the Backend must expose an approval projection endpoint (`/v1/approvals`).
   - _Recommendation_: Add projection endpoints `GET /v1/approvals` and `POST /v1/approvals/:id/decision` to `services/backend` which coordinate with the task state machine and event publisher.
   - _ADR Required?_: No, this fulfills PRD 12.2 and EDD 21.1 without changing parent trust boundaries.

---

### 27. Recommended Implementation Sequence

```
Step 1: Backend Projection Endpoints
  ├── Add GET /v1/tasks (tenant-filtered, paginated)
  ├── Add GET /v1/activity (event projection)
  ├── Add GET /v1/dashboard/summary (aggregated counts)
  ├── Add GET /v1/approvals & POST /v1/approvals/:id/decision
  └── Verify with unit/integration tests in services/backend/tests/

Step 2: Scaffold apps/web-dashboard Workspace
  ├── Create apps/web-dashboard/package.json & tsconfig.json
  ├── Create index.html shell with WCAG 2.2 semantic landmarks
  ├── Create src/index.css with dark/light design system tokens
  └── Implement authenticated API client (src/api/client.ts)

Step 3: Implement Dashboard Components
  ├── Header & Navigation (workspace selector, health badge)
  ├── Overview Cards (active work, approvals, device health, AI tokens)
  ├── Task List & Execution Graph Inspector
  ├── Approval Inbox Card (with 60s countdown and ALLOW/DENY)
  ├── Activity Stream (chronological event projection)
  └── Evidence Viewer (SHA-256 checksums & sanitized output)

Step 4: Author Dedicated Vertical-Slice Security Suite
  ├── Create tests/vertical-slice/dashboard-security-invariants.test.ts
  ├── Validate 053-SEC-01 through 053-SEC-06
  └── Register in package.json "test" script

Step 5: Quality Gates & CI Verification
  ├── Run typecheck, lint, format, validate, security, test
  ├── Commit, push to origin/main, and monitor GitHub Actions CI
  └── Author task_053_completion_report.md
```

---

### 28. Definition of Done (DoD)

Task 053 is complete only when:

1. `apps/web-dashboard/` exists and builds cleanly as an independent workspace.
2. Web Dashboard renders overview, task list, execution graph, approval inbox, activity stream, and evidence inspector.
3. Backend exposes governed projection endpoints for tasks, activity, approvals, and summary.
4. All Section 24 security invariants (`053-SEC-01` to `053-SEC-06`) pass in `tests/vertical-slice/dashboard-security-invariants.test.ts`.
5. All 847+ monorepo tests pass with zero regressions.
6. All quality gates (`typecheck`, `lint`, `format:check`, `validate`, `security`) pass 100% clean.
7. Remote GitHub Actions CI run on `origin/main` completes with conclusion `success`.
8. `task_053_completion_report.md` is authored.

---

### 29. Task 054+ Status

- **Task 054+ Status**: **STRICTLY NOT STARTED**.
- No implementation code, commits, or branching for Task 054 or subsequent sprints have been initiated.
- Discovery for Task 053 is complete. Awaiting user review and authorization before proceeding to implementation.
