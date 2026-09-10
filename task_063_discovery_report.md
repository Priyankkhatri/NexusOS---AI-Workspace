# TASK 063 DISCOVERY REPORT

**Sprint 2 Milestone 4 — Web Dashboard Multi-Agent Collaboration, Persistent Memory/Graph Observability & Governed Agent Activity Experience**

---

## 1. Executive Summary & Authoritative Task Identity

### Authoritative Task Identity

- **Canonical Task Identifier**: `TASK 063`
- **Canonical Task Title**: `TASK 063: SPRINT 2 MILESTONE 4 — WEB DASHBOARD MULTI-AGENT COLLABORATION, PERSISTENT MEMORY/GRAPH OBSERVABILITY & GOVERNED AGENT ACTIVITY EXPERIENCE`
- **Milestone Designation**: Sprint 2 Milestone 4 (Experience Platform / Web Dashboard Phase 2)
- **Owning Subsystem**: Web Dashboard (`apps/web-dashboard`), Backend Projections (`services/backend`)

### Authoritative Roadmap Evidence

1. **`docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 6 (Recommended Sprint 2 Sequencing)**:
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │ SPRINT 2 PHASE 1: NATIVE AI & PERSISTENT KNOWLEDGE GRAPH    │
   │ 1. Native Model Execution & VRAM Offloading (local-ai)      │ (Completed in Task 061)
   │ 2. Persistent SQLite/Vector Graph Store (services/memory)   │ (Completed in Task 062)
   └──────────────────────────────┬──────────────────────────────┘
                                  │
   ┌──────────────────────────────▼──────────────────────────────┐
   │ SPRINT 2 PHASE 2: MULTI-AGENT FEDERATION & ENTERPRISE SYNC   │
   │ 3. Multi-Agent Delegation & Federated ACP (apps/desktop)    │ (Completed in Task 060)
   │ 4. Web Dashboard Multi-Agent View & Timeline (web-dashboard)│ (Authoritative Task 063)
   └─────────────────────────────────────────────────────────────┘
   ```
2. **`task_062_discovery_report.md` — Section 2 (Authoritative Task Identity)**:
   - Formally designated: _"Candidate 2: Web Dashboard Multi-Agent Collaboration View & Timeline Cockpit ... DEFERRED TO TASK 063. Represents Sprint 2 Phase 2 experience-layer work that visualizes multi-agent delegation trees and federated ACP messages delivered in Task 060."_
3. **`docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md`**:
   - Section 2.1 (Application Map): Defines `Tasks`, `Activity Center`, `Memory Explorer`, and `Knowledge Graph` operational surfaces.
   - Section 7 (Activity Center): Details canonical human-facing event projections across tasks, agents, workflows, and approvals.
   - Section 9 (Memory Explorer): Details governed inspection, search, provenance, and deletion of memory objects.
   - Section 10 (Knowledge Graph): Details progressive neighborhood expansion, typed edges, and relationship inspection under access constraints.
4. **`SPRINT_1_COMPLETION_REPORT.md` & `SPRINT_2_READINESS_AND_BACKLOG.md`**:
   - Confirms Task 053 delivered the initial web dashboard baseline (Overview, Tasks, Approvals, Activity). Task 063 expands this platform to observe the multi-agent delegation trees (Task 060) and persistent memory/knowledge graph (Task 062).

### Why Task 063 is the Correct Next Task

Sprint 2 delivered:

- Milestone 1 (Task 060): Autonomous Multi-Agent Delegation, Agent Directory, and Federated ACP.
- Milestone 2 (Task 061): Native Local-AI Inference & VRAM Offloading.
- Milestone 3 (Task 062): Persistent SQLite Store, Vector Search, and Knowledge Graph Projections.

The backend subsystems and execution runtimes now possess advanced multi-agent coordination and persistent knowledge capabilities, but the Web Dashboard currently only reflects single-agent task lifecycles and basic activity. Task 063 integrates these foundational capabilities into the unified Experience Platform.

---

## 2. Authoritative Baseline Verification

- **Current HEAD**: `668515ca4c8970ff83e76ad6a555ec54a6b66d6f`
- **Current Branch**: `main`
- **Remote Tracking**: `origin/main` (`HEAD == origin/main`)
- **Working Tree**: Completely clean (`git status --short` is empty)
- **Prior Milestone Status**: Task 062 Phase 3 is fully closed and passing CI (Run `34463981041` SUCCESS).

---

## 3. Current System Inventory

### Web Dashboard Workspace (`apps/web-dashboard/`)

- **Structure**:
  - `apps/web-dashboard/index.html`: Semantic HTML shell with WCAG 2.2 AA landmarks, skip-link, header, navigation sidebar, main content views, and task detail modal.
  - `apps/web-dashboard/src/index.css`: Comprehensive design system with CSS custom properties (tokens for light/dark themes, spacing, typography, colors, animations, modals, badges).
  - `apps/web-dashboard/src/api/client.ts`: `DashboardAPIClient` implementing authenticated HTTP communication with backend REST endpoints, handling error mapping and XSS escaping.
  - `apps/web-dashboard/src/main.ts`: Client-side router and state manager handling:
    - `overview`: Summary metric cards (Active, Pending Approvals, Completed, Failed) + recent activity log.
    - `tasks`: Paginated task table with status filters, cancellation modal, and detail inspector.
    - `approvals`: Approval inbox with pending prompt inspection and Allow/Deny decision submission.
    - `activity`: Paginated event stream log.
    - Polling mechanism: 15-second background refresh paused when `document.hidden` is true.

### Backend Infrastructure (`services/backend/`)

- **Task Controller & Routes** (`services/backend/src/tasks/controller.ts`, `services/backend/src/server/app.ts`):
  - `GET /health/readiness`
  - `GET /v1/dashboard/summary`
  - `GET /v1/tasks` & `POST /v1/tasks` & `GET /v1/tasks/:id` & `POST /v1/tasks/:id/cancel`
  - `GET /v1/activity`
  - `GET /v1/approvals` & `POST /v1/approvals/:id/decision`
  - `GET /v1/plugins` & `GET /v1/plugins/:id`
- **Memory Subsystem & Routes** (`services/backend/src/memory/memory-routes.ts`, `services/backend/src/memory/memory-service.ts`):
  - `POST /v1/memory` & `GET /v1/memory/:id` & `DELETE /v1/memory/:id`
  - `GET /v1/memory/search`
  - `POST /v1/memory/vectors/search` & `POST /v1/memory/vectors` & `GET/DELETE /v1/memory/vectors/:id`
  - `POST /v1/memory/graph/query`
  - `GET/POST /v1/memory/episodes` & `GET/POST /v1/memory/playbooks`
- **Agent Coordination Subsystem** (`services/backend/src/agents/`):
  - `AgentDirectoryService`: In-memory directory with heartbeat tracking, capability matching, role assignment, and capacity bounds.
  - `DelegationCoordinator`: Session tracking for parent-child task delegations, lease attenuation, depth/fan-out bounds, cascade cancellation, and composite execution receipts.

---

## 4. Dependencies Audit: Task 060 & Task 062

| Subsystem                | Task | Components Available                                                                    | Exposure Status                                     | Dashboard Integration Need                                                       |
| :----------------------- | :--- | :-------------------------------------------------------------------------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------------- |
| **Agent Directory**      | 060  | `AgentDirectoryService` (`registerAgent`, `listAgents`, `getAgent`, `recordHeartbeat`)  | In-memory backend service; no public REST route yet | Expose `GET /v1/agents` on BackendApp; render Agent Roster in dashboard          |
| **Sub-Agent Delegation** | 060  | `DelegationCoordinator` (`getSession`, `listSessionsForParent`, `cancelDelegationTree`) | Backend service; no public REST route yet           | Expose `GET /v1/delegations` on BackendApp; render delegation trees in dashboard |
| **ACP Federation**       | 060  | `AcpFederationMessageSchema`, `createFederationMessage`                                 | Contract & bridge in backend                        | Surface federated message events in Activity Stream                              |
| **Persistent Memory**    | 062  | `SqliteMemoryStore`, `MemoryService`                                                    | Fully exposed on `/v1/memory/*`                     | Add Memory Explorer view to query, filter, and inspect records                   |
| **Vector Search**        | 062  | `VectorIndex`, `/v1/memory/vectors/search`                                              | Fully exposed on `/v1/memory/vectors/search`        | Add semantic vector search input and similarity score indicators                 |
| **Knowledge Graph**      | 062  | `GraphProjectionEngine`, `/v1/memory/graph/query`                                       | Fully exposed on `/v1/memory/graph/query`           | Add Knowledge Graph neighborhood view with depth/limit controls                  |

---

## 5. Canonical Contract Audit

| Contract Domain           | Contract / Schema                                                                                                                  | Status                                                 | Action in Task 063                                   |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------- | :--------------------------------------------------- |
| **Agent Directory**       | `AgentRegistrationSchema`, `AgentHeartbeatSchema`, `AgentRoleSchema`, `AgentStatusSchema`                                          | Complete in `@nexusos/contracts/src/acp/directory.ts`  | **REUSE** directly                                   |
| **Delegation**            | `SubAgentDelegationRequestSchema`, `SubAgentDelegationResponseSchema`, `CompositeExecutionReceiptSchema`, `DelegationStatusSchema` | Complete in `@nexusos/contracts/src/acp/delegation.ts` | **REUSE** directly                                   |
| **ACP Messages**          | `AcpFederationMessageSchema`, `AcpMessageTypeSchema`                                                                               | Complete in `@nexusos/contracts/src/acp/federation.ts` | **REUSE** directly                                   |
| **Tasks & DAGs**          | `TaskRecordSchema`, `WorkflowDAGSchema`, `TaskLifecycleState`                                                                      | Complete in `@nexusos/contracts/src/tasks/`            | **REUSE** directly                                   |
| **Memory Records**        | `MemoryRecordSchema`, `MemorySearchRequestSchema`, `MemorySensitivitySchema`                                                       | Complete in `@nexusos/contracts/src/memory/`           | **REUSE** directly                                   |
| **Knowledge Graph**       | `MemoryGraphQueryRequestSchema`, `MemoryGraphNodeSchema`, `MemoryGraphEdgeSchema`                                                  | Complete in `@nexusos/contracts/src/memory/`           | **REUSE** directly                                   |
| **Vectors**               | `VectorEmbeddingSchema`, `VectorSearchRequestSchema`                                                                               | Complete in `@nexusos/contracts/src/memory/`           | **REUSE** directly                                   |
| **Approvals**             | `ApprovalPromptItemSchema`, `ApprovalDecisionRequestSchema`                                                                        | Complete in `@nexusos/contracts/src/approval/`         | **REUSE** directly                                   |
| **Activity Stream**       | `EventEnvelopeSchema`, `ActivityQuerySchema`, `DashboardSummarySchema`                                                             | Complete in `@nexusos/contracts/src/events/`           | **REUSE** directly                                   |
| **Dashboard Projections** | `AgentRosterItemResponse`, `DelegationSessionResponse`                                                                             | Missing client-side interfaces                         | **DEFINE** in `apps/web-dashboard/src/api/client.ts` |

---

## 6. Multi-Agent Collaboration UX Requirements

Based on `NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md` Section 7 and `SPRINT_2_READINESS_AND_BACKLOG.md` Section 6:

1. **Agent Roster Navigation & View**:
   - Displays all logical agents registered in the tenant's workspace.
   - Shows role badges: `COORDINATOR`, `SPECIALIST`, `SUPERVISOR`, `WORKER`.
   - Shows lifecycle status: `AVAILABLE`, `BUSY`, `UNHEALTHY`, `RETIRED`.
   - Shows declared capabilities (e.g. `terminal.exec`, `browser.navigate`, `filesystem.read`).
   - Shows health / heartbeat freshness indicator.
2. **Delegation Hierarchy & Lineage Tree**:
   - In Task Detail and dedicated Delegation View, render the parent-child delegation tree.
   - Disclose delegation depth ($d \in [1, 3]$) and assigned sub-agents.
   - Display attenuated scope grants per sub-agent.
   - Show child task status (`ACCEPTED`, `EXECUTING`, `COMPLETED`, `FAILED`, `CANCELLED`).
3. **Federated ACP Activity Stream**:
   - Filterable activity view for inter-agent messages (`DELEGATION`, `PROGRESS`, `RECEIPT_SETTLEMENT`, `CANCELLATION`).
   - Display from/to agent identities, correlation IDs, and causation links.
4. **Hierarchical Receipt & Roll-Up Evidence Inspection**:
   - Inspect composite receipts (`CompositeExecutionReceipt`).
   - Display Merkle/roll-up evidence tree checksum (`evidenceTreeHash`).
   - Validate that child task receipts are cryptographically anchored.

---

## 7. Memory & Knowledge Graph Observability UX

Based on Experience Platform EDD Sections 9 & 10 and Task 062 outputs:

1. **Memory Explorer View**:
   - Search memory records via lexical query and vector similarity.
   - Filter by memory class (`CONVERSATION`, `WORKSPACE`, `SEMANTIC`, `EPISODIC`, `PROCEDURAL`).
   - Display sensitivity pills: `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`.
   - Display provenance metadata: `sourceType`, `creatorPrincipalId`, timestamp, verification status.
   - Action: Request memory forgetting / tombstone (`DELETE /v1/memory/:id`).
2. **Knowledge Graph Explorer View**:
   - Interactive or structured tabular/node representation of entity neighborhoods.
   - Inputs: Node ID, maximum depth (clamped $\le 4$), result limit (clamped $\le 100$).
   - Displays typed edges: `DERIVED_FROM`, `RELATES_TO`, `CONTRADICTS`, `PRECEDES`, `SUPERSEDES`, `CITATION`.
   - Visual distinction between verified links and low-confidence inferred relationships.
3. **Critical Inert Context Safety (063-SEC-04)**:
   - Memory records, vector similarity matches, and graph nodes/edges are strictly **DATA**.
   - Under no circumstances may stored memory content execute commands or grant authority.
   - Delimiters and prompt injection attacks (`IGNORE ALL POLICIES...`) must be strictly sanitized via `sanitizeHTML()` before DOM insertion.
   - Display explicit advisory disclaimer: _"Retrieved memory and graph relationships are non-authoritative advisory context."_

---

## 8. Security & Tenancy Boundaries

The following security invariants are proposed for Task 063:

- **063-SEC-01 (Mandatory Authentication & Tenant Isolation)**:
  - All dashboard endpoints (`/v1/agents`, `/v1/delegations`, `/v1/memory/*`) require valid authentication.
  - Responses are strictly filtered to the caller's tenant ID and workspace ID.
  - Cross-tenant requests return 401, 403, or non-disclosing 404.
- **063-SEC-02 (XSS Sanitization & Prompt Injection Neutralization)**:
  - All dynamic data rendered into the DOM (agent names, sub-goal descriptions, memory contents, graph labels, error messages) MUST pass through `sanitizeHTML()`.
  - Zero raw `innerHTML` assignments without sanitization.
- **063-SEC-03 (Zero Secret & Credential Leakage)**:
  - Secrets, API keys, bearer tokens, and HMAC signing keys must never appear in DOM attributes, URLs, error banners, or `localStorage`.
  - Auth tokens are held strictly in memory.
- **063-SEC-04 (Inert Context Authority Boundary)**:
  - Memory search results, vectors, and graph nodes must not provide execution buttons, lease issuance triggers, or policy overrides.
- **063-SEC-05 (Bounded UI Resource Consumption)**:
  - Maximum 50 items per rendered list page.
  - Graph traversal requests clamped to `depth <= 4` and `limit <= 100`.
  - Background polling stops when browser tab is hidden (`document.hidden`).

---

## 9. Real-Time Data Flow & Transport Decision

### Architectural Decision: Low-Latency Polling (Preserved)

- **Investigation**: Evaluated WebSocket vs. SSE vs. Low-Latency Cursor Polling.
- **Finding**: Task 053 established low-latency HTTP cursor polling (`setInterval(..., 15000)` with `document.hidden` pause) as the canonical mechanism for the web dashboard.
- **Rationale**:
  - The repository's backend currently operates an HTTP/REST server without an active WebSocket server port.
  - Fabricating an ad-hoc WebSocket server would introduce non-canonical dependencies and potential connection leaks.
  - Low-latency HTTP polling reuses the existing authenticated REST pipeline, respects tenant boundaries, handles reconnect backoff naturally, and is fully covered by existing test harnesses.
- **Transport Sequence**:
  ```
  Browser Timer (15s active tab)
          ↓
  DashboardAPIClient.request() [with Bearer token & Tenant Header]
          ↓
  BackendApp Route Handler (/v1/dashboard/summary, /v1/tasks, /v1/agents, etc.)
          ↓
  Authenticated Controller Query (tenant-filtered)
          ↓
  JSON Response Serialization
          ↓
  DOM Update with sanitizeHTML()
  ```

---

## 10. Performance & Resource Bounds

| Parameter                     | Authoritative Bound          | Source / Enforcement                       |
| :---------------------------- | :--------------------------- | :----------------------------------------- |
| **Max Agents per Tenant**     | 50                           | `AgentDirectoryOptions.maxAgentsPerTenant` |
| **Max Delegation Depth**      | 3                            | `DELEGATION_SAFETY_LIMITS.MAX_DEPTH`       |
| **Max Delegation Fan-Out**    | 5                            | `DELEGATION_SAFETY_LIMITS.MAX_FAN_OUT`     |
| **Vector Search topK**        | 50                           | `MemoryController.searchVectors` clamp     |
| **Graph Traversal Depth**     | Max 4 (default 2)            | `SqliteMemoryStore.queryGraph` clamp       |
| **Graph Result Limit**        | Max 100 (default 25)         | `SqliteMemoryStore.queryGraph` clamp       |
| **Activity Stream Page Size** | Max 100 (default 10-20)      | `ActivityQuerySchema`                      |
| **Polling Interval**          | 15,000 ms (0 ms when hidden) | `apps/web-dashboard/src/main.ts`           |

---

## 11. Failure & Recovery UX

1. **Agent Unavailability**:
   - Status badge turns red (`UNHEALTHY`) if heartbeat age $> 45$s.
   - Tasks assigned to unhealthy agents display warning badge.
2. **Sub-Agent Delegation Failure**:
   - Child node displays error icon with sanitized error reason.
   - Compensation status clearly marked (`COMPENSATED` vs `UNCOMPENSATED`).
3. **Degraded Semantic Search**:
   - If vector search falls back to lexical ranking, UI displays: `[Lexical Fallback: Vector Model Offline]`.
4. **Backend Unavailability**:
   - Connection indicator switches to `Disconnected` (red).
   - Summary cards display non-breaking fallback (`—`).
   - Retries automatically on next poll cycle.
5. **Cross-Tenant Access Denial**:
   - Clean 403 / 404 message without disclosing target entity existence.

---

## 12. Test Strategy

### Required New / Extended Test Suites

1. **Security Hardening Suite**:
   - File: `tests/hardening/dashboard-multi-agent-memory-security.test.ts`
   - Test cases:
     - `063-SEC-01`: Tenant isolation on `/v1/agents` and `/v1/delegations`.
     - `063-SEC-02`: XSS sanitization across agent names, delegation parameters, memory contents, and graph labels.
     - `063-SEC-03`: Secret sanitization (no credentials in responses, URLs, or storage).
     - `063-SEC-04`: Inert context safety (memory data cannot grant leases or trigger actions).
     - `063-SEC-05`: Bound clamping on graph and delegation queries.
2. **End-to-End Vertical Slice Suite**:
   - File: `tests/vertical-slice/dashboard-multi-agent-memory-vertical-slice.test.ts`
   - Complete browser-level / HTTP integration test verifying:
     - Full agent registration $\rightarrow$ heartbeat $\rightarrow$ roster rendering.
     - Sub-agent delegation creation $\rightarrow$ hierarchy rendering $\rightarrow$ receipt settlement.
     - Persistent memory query $\rightarrow$ vector search $\rightarrow$ graph exploration $\rightarrow$ tombstone.
3. **Client API Unit Tests**:
   - Extend `tests/vertical-slice/dashboard-security-invariants.test.ts` to cover new `DashboardAPIClient` methods.

---

## 13. Scope Boundaries

### IN SCOPE (Task 063)

- Expose read-model REST endpoints on BackendApp for:
  - `GET /v1/agents` (Agent Directory listing)
  - `GET /v1/delegations` (Active delegation sessions & trees)
- Extend `DashboardAPIClient` with agent, delegation, memory, vector, and graph methods.
- Expand `apps/web-dashboard/index.html` with:
  - Agents / Multi-Agent Collaboration view
  - Memory Explorer view
  - Knowledge Graph view
- Expand `apps/web-dashboard/src/main.ts` with view controllers, renderers, and event handlers.
- Style additions in `apps/web-dashboard/src/index.css` for hierarchy trees, memory cards, and graph nodes.
- Security hardening and vertical slice test suites (`063-SEC-01` through `063-SEC-05`).

### OUT OF SCOPE (Task 063)

- Task 064+ features.
- Cloud state sync and Enterprise RBAC (deferred to Sprint 3).
- Modifying Task 060 agent algorithms or Task 062 SQLite storage engine.
- Adding third-party frontend frameworks (e.g. React, Vue, Svelte) or heavyweight canvas libraries — preserve the clean, lightweight, zero-dependency Vanilla TS architecture.

---

## 14. Proposed Implementation Phases

### Phase 1: Backend Projections & Dashboard API Client Extensions

- **Goal**: Expose Task 060 Agent Directory and Delegation sessions via authenticated backend routes, and equip `DashboardAPIClient` with typed client methods for agents, delegations, memory records, vector search, and graph traversal.
- **Files**:
  - `services/backend/src/server/app.ts`: Add `agentDirectory` and `delegationCoordinator` options; mount `GET /v1/agents` and `GET /v1/delegations`.
  - `services/backend/src/tasks/controller.ts`: Add helper query methods if needed.
  - `apps/web-dashboard/src/api/client.ts`: Add `getAgents()`, `getDelegations()`, `searchMemory()`, `getMemory()`, `deleteMemory()`, `searchVectors()`, and `queryGraph()`.
- **Verification**: Focused API route tests and TypeScript compilation.

### Phase 2: Multi-Agent Collaboration & Timeline Cockpit Experience

- **Goal**: Implement the Agent Roster and Delegation Hierarchy views in the Web Dashboard.
- **Files**:
  - `apps/web-dashboard/index.html`: Add navigation items and view sections for `agents` and `delegation-tree`.
  - `apps/web-dashboard/src/main.ts`: Implement `loadAgents()`, `renderAgentRoster()`, `loadDelegations()`, and `renderDelegationTree()`.
  - `apps/web-dashboard/src/index.css`: Styles for agent cards, role badges, hierarchy connectors, and status indicators.
- **Verification**: UI rendering and multi-agent interaction tests.

### Phase 3: Memory & Knowledge Graph Observability, Security Hardening & Vertical Slice

- **Goal**: Implement Memory Explorer and Knowledge Graph views, complete security invariants (`063-SEC-01..05`), and prove end-to-end integration across all quality gates.
- **Files**:
  - `apps/web-dashboard/index.html`: Add `memory` and `knowledge-graph` views.
  - `apps/web-dashboard/src/main.ts`: Implement `loadMemory()`, `searchVectors()`, and `renderGraphNeighborhood()`.
  - `tests/hardening/dashboard-multi-agent-memory-security.test.ts`: Security invariant tests.
  - `tests/vertical-slice/dashboard-multi-agent-memory-vertical-slice.test.ts`: End-to-end vertical slice test.
- **Verification**: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and CI GREEN.

---

## 15. Open Risks & Implementation Considerations

1. **DOM Tree Bounds in Graph Visualization**:
   - Knowledge graphs can grow rapidly. The implementation must strictly cap returned nodes ($\le 100$) and depth ($\le 4$), rendering a clean, scrollable node/edge neighborhood or structured graph cards rather than an unbounded DOM tree.
2. **Inert Data Discipline**:
   - Memory records containing adversarial prompts (e.g. `SYSTEM: IGNORE POLICIES`) must be visibly disclaimed and completely sanitized before DOM insertion.

---

## 16. Confirmation of Non-Execution

- **Zero implementation code was written or modified.**
- **Zero test files were created or modified.**
- **No dependencies were installed.**
- **No git commits were made.**
- **The repository working tree remains 100% clean at HEAD `668515ca4c8970ff83e76ad6a555ec54a6b66d6f`.**
