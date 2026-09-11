# Task 067 Discovery Report

**Sprint 3 / S3-03 — Web Dashboard Real-Time Telemetry, Live Agent Activity & Delegation Observability**

- **Date**: 2026-09-11
- **Authoritative Baseline SHA**: `a736f32a431b0bfc78b5d463dce8188753a08e27`
- **Preceding Milestone**: Task 066 (Sprint 3 / S3-02 — Real-Time Graph Evolution & Outbox Reliability) — Closed and verified green on CI.
- **Status**: DISCOVERY COMPLETE — STRICTLY NO IMPLEMENTATION

---

## 1. Authoritative Task Identity

### 1.1 Canonical Identification

| Attribute                          | Value                                                                                                                                     |
| :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonical Task Identifier**      | `TASK 067`                                                                                                                                |
| **Canonical Title**                | `TASK 067: SPRINT 3 / S3-03 — WEB DASHBOARD REAL-TIME TELEMETRY, LIVE AGENT ACTIVITY & DELEGATION OBSERVABILITY`                          |
| **Sprint / Roadmap Item**          | Sprint 3 Candidate `S3-03` (`docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2)                                                                  |
| **Alternative Roadmap Title**      | `CANDIDATE S3-03: Dashboard Real-Time Agent Telemetry & Delegation Live Tree`                                                             |
| **Owning Subsystems**              | Web Dashboard (`apps/web-dashboard`), Control-Plane Backend Streaming (`services/backend`), Shared Event Contracts (`packages/contracts`) |
| **Primary Architectural Boundary** | The Web Dashboard remains **strictly read-only observability**. It **MUST NOT** become an execution authority (`067-SEC-08`).             |

### 1.2 Discrepancy & Alignment Note

The user prompt specifies:
`TASK 067 — SPRINT 3 / S3-03: WEB DASHBOARD REAL-TIME TELEMETRY, LIVE AGENT ACTIVITY & DELEGATION OBSERVABILITY`.
In `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2, this candidate is titled:
`CANDIDATE S3-03: Dashboard Real-Time Agent Telemetry & Delegation Live Tree`.
In `docs/task_065_discovery_report.md` §3 (Table Candidate E), it was formally sequenced:
`SEQUENCED as Task 067 (S3-03)`.
Both titles describe the identical engineering scope. For repository consistency, the canonical title for this task is:
**`TASK 067: SPRINT 3 / S3-03 — WEB DASHBOARD REAL-TIME TELEMETRY, LIVE AGENT ACTIVITY & DELEGATION OBSERVABILITY`**.

---

## 2. Current Repository Baseline

### 2.1 Git Audit

| Property                | Measured Value                                        |                 Status                 |
| :---------------------- | :---------------------------------------------------- | :------------------------------------: |
| **HEAD SHA**            | `a736f32a431b0bfc78b5d463dce8188753a08e27`            |    Verified (`git rev-parse HEAD`)     |
| **origin/main SHA**     | `a736f32a431b0bfc78b5d463dce8188753a08e27`            | Verified (`git rev-parse origin/main`) |
| **Working Tree**        | Clean (`git status --short` is empty)                 |                Verified                |
| **Preceding CI Run**    | Run `34586468013` (NexusOS Monorepo CI Quality Gates) |           ✅ SUCCESS (2m10s)           |
| **Monorepo Test Suite** | 1,492 / 1,492 tests passing (0 failures, 0 skipped)   |             Verified live              |

---

## 3. Roadmap Evidence & Dependency Tracing

### 3.1 Tracing the Milestone Hierarchy

1. **`docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 — Candidate S3-03**:

   - Explicitly establishes Candidate S3-03: _"Dashboard Real-Time Agent Telemetry & Delegation Live Tree"_.
   - Depends on: Task 063 Phase 2 (Agent Cockpit) and Task 060 (`DelegationCoordinator`).
   - Rationale: _"The Sprint 2 Agent Cockpit renders static agent snapshots and delegation history but does not stream live delegation events. Sprint 3 would: (1) Implement SSE stream for delegation lifecycle events from DelegationCoordinator; (2) Display a live delegation tree in dashboard; (3) Add HITL approval/rejection actions from dashboard UI; (4) Surface delegation cascade cancellation controls in dashboard operator panel."_
   - Entry criteria: SSE delegation event stream endpoint defined in backend; `DashboardAPIClient` SSE subscription method designed.

2. **`docs/task_065_discovery_report.md` §3 — Milestone Sequencing**:

   - Formally designated Candidate E (`S3-03`) as **`Task 067`**, following the completion of Task 065 (Model Manifests) and Task 066 (Real-Time Graph Evolution).

3. **`task_060_completion_report.md`**:

   - Delivered `DelegationCoordinator` (`services/backend/src/agents/delegation-coordinator.ts`) and `AgentDirectoryService` (`services/backend/src/agents/agent-directory.ts`).
   - Validated depth bounds (`MAX_DEPTH = 3`), fan-out limits (`MAX_FAN_OUT = 5`), child leases, and cascade cancellation.

4. **`task_063_discovery_report.md` & `SPRINT_2_COMPLETION_REPORT.md`**:
   - Delivered Phase 1, Phase 2, and Phase 3 of the Web Dashboard:
     - Overview summary cards, tasks, approvals, and activity stream.
     - Agent Roster and Delegation Cockpit (tree visualization, timeline).
     - Persistent Memory Explorer and Knowledge Graph interactive view.
   - All data was delivered via HTTP REST endpoints polled at 15-second intervals.

---

## 4. Existing Dashboard Architecture Audit

### 4.1 Subsystem Layout

The dashboard resides in `apps/web-dashboard/`:

- [`src/api/client.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/web-dashboard/src/api/client.ts): `DashboardAPIClient` providing typed, authenticated HTTP REST methods.
- [`src/main.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/web-dashboard/src/main.ts): Single-page application logic managing state, navigation, rendering, and auto-refresh.
- [`src/index.css`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/web-dashboard/src/index.css): Responsive styles, theme tokens, card animations, WCAG contrast.
- [`index.html`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/web-dashboard/index.html): HTML5 semantic shell with ARIA live regions, skip links, and navigation landmarks.

### 4.2 Current Data Retrieval & Polling Mechanics

- **Cadence**: A single global `setInterval` in `startPolling()` triggers every **15,000 ms (15 seconds)**.
- **Tab Visibility Guard**:
  ```ts
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });
  ```
  `refreshCurrentView()` early-exits if `document.hidden` is true to conserve battery and bandwidth.
- **View-Level Retrieval on Each Tick**:
  1. `loadSummary()`: Fetches `/v1/dashboard/summary` (task counts, health status, pending approvals).
  2. `loadViewData(state.currentView)`: Triggers a REST fetch tailored to the active tab:
     - `overview`: `loadSummary()` + `loadRecentActivity()` (`/v1/activity?limit=10`)
     - `tasks`: `loadTasks(true)` (`/v1/tasks?limit=50&status=...`)
     - `approvals`: `loadApprovals()` (`/v1/approvals`)
     - `activity`: `loadActivityStream(true)` (`/v1/activity?limit=30`)
     - `agents`: `loadAgents(true)` (`/v1/agents?limit=100`)
     - `delegations`: `loadDelegations(true)` (`/v1/delegations?limit=100`)
     - `memory`: `loadMemory(true)` (`/v1/memory/search?...`)
     - `graph`: `loadGraph(true)` (`/v1/memory/graph/query`)

### 4.3 Existing Client Guards & Safety Controls

- **Stale Response / Race Guards**: `agentsRequestId`, `delegationsRequestId`, `memoryRequestId`, and `graphRequestId` monotonic integer counters guard against delayed async network responses overwriting newer user selections.
- **Event Deduplication & Sorting**: `loadActivityStream()` maintains a `Set<string>` of `event_id`s, merges incoming items, sorts deterministically by `occurred_at DESC`, and slices to a strict **100-entry DOM limit** (`merged.slice(0, 100)`).
- **Delegation Tree Boundedness**: `renderDelegationTree()` sorts deterministically by `depth ASC, delegationId ASC`, bounds rendering to **100 sessions**, and detects cycles with `visited = new Set<string>()`.
- **XSS Sanitization**: `sanitizeHTML()` escapes special characters (`& < > " ' / \``) on all dynamic server strings before DOM insertion.
- **Credential Safety**: `_authToken` is stored exclusively in closure memory, never in `localStorage`, `sessionStorage`, or URL query parameters (`053-SEC-05`).

---

## 5. Backend Telemetry & Event Producer Audit

A comprehensive search of `services/backend/` and `packages/contracts/` revealed the following factual state:

### 5.1 Existing Event Infrastructure

1. **Canonical Schema (`packages/contracts/src/events/index.ts`)**:
   `EventEnvelopeSchema` defines standard cloud-event-style envelopes:
   - `schema_id`: string (e.g., `'nexusos.events.task.created'`)
   - `version`: string (`'1.0.0'`)
   - `event_id`: UUID
   - `correlation_id`: string
   - `occurred_at`: ISO datetime string
   - `producer_id`: string (`'control-plane-backend'`)
   - `payload`: `Record<string, unknown>`
2. **Publisher Boundary (`services/backend/src/events/publisher-boundary.ts`)**:
   `EventPublisherBoundary` interface with `publish(event: EventEnvelope)`.
   `InMemoryEventPublisherBoundary` stores published events in an in-memory array (`publishedEvents: EventEnvelope[]`).
   **Crucial Finding**: It is currently passive array storage (`publishedEvents.push(event)`). There is **no subscription mechanism, no pub/sub callback, no EventEmitter, and no streaming interface**.
3. **Activity Query Endpoint (`services/backend/src/tasks/controller.ts`)**:
   `getActivityByTenant(tenantId, query)` reads from `eventPublisher.getPublishedEvents()`, filters by `tenantId`, deduplicates by `event_id`, sorts deterministically, and applies cursor pagination.

### 5.2 Producers of Events vs. Passive Subsystems

| Subsystem                    | File                                                    | Current Event Production Status                                                                                                                                                                                      |
| :--------------------------- | :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task Execution**           | `services/backend/src/tasks/controller.ts`              | **ACTIVE PRODUCER**: Emits `task.created`, `task.leased`, `task.dispatched`, `task.completed`, `task.failed`, `task.canceled`, `workflow.created`, `workflow.dispatched`, `workflow.completed`, `policy.denial`.     |
| **Approval Lifecycle**       | `controller.ts` & `approval-host.ts`                    | **PARTIAL**: Emits `approval.decision` when a human operator acts. Does **NOT** emit an event when a new approval prompt is initially requested (`approval.requested`).                                              |
| **Agent Directory**          | `services/backend/src/agents/agent-directory.ts`        | **PASSIVE**: Updates in-memory map on `recordHeartbeat()` and `registerAgent()`. Does **NOT** emit `agent.status_changed` or `agent.registered`.                                                                     |
| **Delegation Coordinator**   | `services/backend/src/agents/delegation-coordinator.ts` | **PASSIVE**: Updates in-memory `sessions` map on `delegateSubTask()`, `completeDelegation()`, `failDelegation()`, `cascadeCancel()`. Does **NOT** emit any delegation lifecycle events.                              |
| **Memory / Graph Evolution** | `services/backend/src/memory/`                          | **PASSIVE**: Writes to SQLite `memory_records` and `memory_evolution_outbox`. Outbox processor executes graph mutations but does **NOT** publish live event envelopes to the event publisher.                        |
| **Desktop Agent Telemetry**  | `apps/desktop-agent/src/telemetry/`                     | **ISOLATED**: Desktop Agent maintains its own `TelemetryManager`, `TelemetrySpool`, and `StructuredLogger`. Relays receipts to backend over ACP, but runtime metrics (VRAM, CPU) are not broadcast to the dashboard. |

---

## 6. Current Polling / Reconciliation Evaluation

### 6.1 Limitations of Pure Polling

- **Latency**: Operator actions (e.g. sub-agent delegation, task state changes, approval requests) take up to 15 seconds to appear in the dashboard.
- **Resource Inefficiency**: Every 15 seconds, an active dashboard tab fires multiple parallel HTTP requests (`/summary`, `/activity`, `/agents`, `/delegations`, etc.), triggering repeated authentication, database lookups, JSON serialization, and memory allocation even when zero system state changed.
- **Inability to Trace Sub-Second Lifecycles**: Autonomous sub-agent delegations and fast-executing tasks can be created, delegated, executed, and settled within 500ms, completely eluding operator visibility between 15-second polling intervals.

### 6.2 The Value of Retaining Polling

While polling is suboptimal for real-time responsiveness, **it is extremely robust**. Polling has no persistent connection state, survives server restarts seamlessly, and requires zero connection recovery logic.
**Architecture Decision**: The 15-second polling mechanism MUST NOT be deleted. It must remain as:

1. An automatic fallback if the real-time transport is unavailable or blocked by network intermediaries.
2. A periodic background consistency reconciliation check (e.g., every 60s or on stream reconnect) to detect any missed dropped frames.

---

## 7. Real-Time Transport Comparison

We evaluate four candidate transport architectures for the NexusOS Experience Platform:

| Evaluation Dimension                     | A. Shorter-Interval Polling (2s)                  | B. Server-Sent Events (SSE)                                                  | C. WebSocket                                                                | D. Existing Event Infrastructure        |
| :--------------------------------------- | :------------------------------------------------ | :--------------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :-------------------------------------- |
| **Browser Support**                      | Universal (HTTP fetch)                            | Universal (`EventSource` in 100% modern browsers)                            | Universal (`WebSocket` API)                                                 | Universal (REST endpoints)              |
| **Connection Directionality**            | Unidirectional pull                               | Unidirectional push (Server → Client)                                        | Bidirectional (Full duplex)                                                 | Unidirectional pull                     |
| **Reconnect Behavior**                   | Natural (next timer tick)                         | **Native in browser**: Automatic backoff with `Last-Event-ID` cursor         | Must be hand-rolled in JS; no native cursor support                         | Natural (next timer tick)               |
| **Ordering & Framing**                   | Per-poll array sort                               | Strict FIFO stream over TCP/HTTP with event IDs                              | Ordered messages, but manual protocol framing                               | Timestamp sort in response              |
| **Authentication**                       | Standard `Authorization: Bearer` header           | Standard HTTP GET at connection setup                                        | Handshake only (tickets/cookies); no custom headers in browser API          | Standard `Authorization: Bearer` header |
| **Tenant Isolation**                     | Per-request auth check                            | Anchored at connection handshake via `authenticateForDashboard`              | Handshake auth; risk of frame-level scope confusion                         | Per-request auth check                  |
| **Backpressure**                         | Natural client pacing                             | Node socket flow control (`res.write()` drain check)                         | Socket buffer monitoring; requires ping/pong framing                        | Natural client pacing                   |
| **Server Resource Usage**                | High CPU / DB query spikes under load             | **Extremely Low**: 1 open HTTP socket per tab, idle when quiet               | Moderate: Protocol state machine, ping/pong heartbeats                      | High CPU / DB query spikes              |
| **Implementation Complexity**            | Trivial (change constant)                         | **Low**: Native Node `res.write()`, zero dependencies                        | **High**: Requires `ws` library or custom RFC 6455 engine                   | Low: Already partially exists           |
| **Authority Containment (`067-SEC-08`)** | Safe: Mutations remain on separate POST endpoints | **Completely Safe**: Unidirectional; impossible to send commands over stream | **Dangerous**: Two-way channel encourages bypassing REST mutation authority | Safe                                    |
| **Repository Fit**                       | High (already present)                            | **Optimal**: Directly aligns with Sprint 3 S3-03 specification               | Poor: Adds unnecessary complexity and dependencies                          | High: Serves as foundation for SSE      |

### 7.1 Detailed Evaluation of Option C (WebSocket)

WebSocket is often assumed to be the default "real-time" technology, but for NexusOS it presents major architectural drawbacks:

1. **Violation of Read-Only Constraint**: The dashboard is strictly an observability surface. All mutations (canceling tasks, approving leases) MUST route through audited REST endpoints with nonces, lease headers, and signature checks. A bidirectional WebSocket creates a persistent temptation to execute commands over the socket, bypassing REST middleware and security gates.
2. **Missing Dependencies**: Neither `services/backend` nor `apps/web-dashboard` includes a WebSocket library (`ws`, `socket.io`). Adding one violates the dependency minimalism of NexusOS.
3. **No Native Replay Protocol**: WebSockets do not have a standard resumption header. SSE natively provides the `Last-Event-ID` header and automatic browser-level reconnection.

---

## 8. Recommended Transport

### 8.1 Primary Recommendation: Server-Sent Events (SSE) with In-Process Pub/Sub Bus

**Recommendation**: Adopt **Approach B (Server-Sent Events)** backed by an in-process, tenant-scoped subscription bus extending `EventPublisherBoundary` (Approach D).

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             BACKEND CONTROL PLANE                                │
│                                                                                  │
│   TaskController  DelegationCoordinator  AgentDirectory  ApprovalHost            │
│         │                  │                    │              │                 │
│         ▼                  ▼                    ▼              ▼                 │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │            Governed Event Bus (EventPublisherBoundary + Pub/Sub)         │   │
│   │   - RedactionFilter (067-SEC-03)                                         │   │
│   │   - Monotonic Epoch-Scoped Cursor <epoch>:<seq> (067-SEC-04)             │   │
│   │   - Bounded Per-Tenant Ring Buffer [Max 100 / 5 min] (067-SEC-05)        │   │
│   │   - Bounded Activity Array FIFO Cap [1,000 items max]                    │   │
│   └─────────────────────────────────────┬────────────────────────────────────┘   │
│                                         │                                        │
│                                         ▼                                        │
│                      GET /v1/telemetry/stream (SSE)                              │
│                      - authenticateForDashboard() (067-SEC-02)                   │
│                      - Tenant / Workspace Filter (067-SEC-01)                    │
│                      - Backpressure & Connection Cap (067-SEC-07)                │
└─────────────────────────────────────────┼────────────────────────────────────────┘
                                          │  text/event-stream
                                          │  Last-Event-ID: <epoch>:<seq>
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         WEB DASHBOARD (EXPERIENCE PLATFORM)                      │
│                                                                                  │
│   DashboardAPIClient.subscribeTelemetry()                                       │
│   - Fetch-Stream Reader with Authorization Header                                │
│   - Client-side Dedup & Deterministic Sort (067-SEC-06)                          │
│   - Epoch Change / Expiration Handling: stream.reset -> REST reconciliation      │
│   - Fallback: Reverts to 15s Polling on 3x Stream Failure                        │
│   - Strict Read-Only Observability (067-SEC-08)                                  │
│                                                                                  │
│   Live Projections:                                                              │
│   - Agent Roster Live Status                                                     │
│   - Delegation Live Tree & Timeline                                              │
│   - Real-Time Activity Feed                                                      │
│   - Instant Pending Approval Alerts                                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Why This is the Right Choice

1. **Zero New NPM Dependencies**: Can be implemented using standard Node.js `http` primitives (`res.writeHead(200, { 'Content-Type': 'text/event-stream' })`) and standard browser APIs.
2. **Explicit Roadmap Alignment**: Matches `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 CANDIDATE S3-03 entry requirement: _"SSE delegation event stream endpoint defined in backend"_.
3. **Built-in Resilience**: SSE has native reconnection, heartbeat framing (`: ping\n\n`), and cursor-based resumption via `Last-Event-ID`.
4. **Enforces Unidirectional Safety**: Structurally prevents the dashboard from dispatching un-audited commands over the real-time channel.

---

## 9. Canonical Event Model

### 9.1 Minimum Required Event Set

To satisfy dashboard observability without flooding the network, the event model is scoped to 10 canonical event types:

| Event Schema ID                       | Producer                   | Trigger Condition                                                                                | Primary Payload Fields                                                                                           |
| :------------------------------------ | :------------------------- | :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `nexusos.events.agent.status_changed` | `AgentDirectoryService`    | Agent registers, heartbeats, or transitions status (`AVAILABLE`, `BUSY`, `UNHEALTHY`, `OFFLINE`) | `agentId`, `tenantId`, `role`, `status`, `currentLoad`, `activeTaskCount`                                        |
| `nexusos.events.delegation.created`   | `DelegationCoordinator`    | New sub-task delegation accepted (`delegateSubTask`)                                             | `delegationId`, `parentTaskId`, `childTaskId`, `delegatorAgentId`, `assignedAgentId`, `depth`, `requestedScopes` |
| `nexusos.events.delegation.completed` | `DelegationCoordinator`    | Child task completes and receipt settles                                                         | `delegationId`, `parentTaskId`, `childTaskId`, `status: 'COMPLETED'`, `receiptHash`                              |
| `nexusos.events.delegation.failed`    | `DelegationCoordinator`    | Child task fails or times out                                                                    | `delegationId`, `parentTaskId`, `childTaskId`, `status: 'FAILED'`, `rejectionReason`                             |
| `nexusos.events.delegation.cancelled` | `DelegationCoordinator`    | Cascade cancellation triggered (`cascadeCancel`)                                                 | `delegationId`, `parentTaskId`, `status: 'CANCELLED'`, `reason`                                                  |
| `nexusos.events.task.status_changed`  | `TaskExecutionController`  | Task transitions state (`SUBMITTED`, `EXECUTING`, `COMPLETED`, `FAILED`, `CANCELED`)             | `taskId`, `tenantId`, `title`, `state`, `targetAgentId`, `error`                                                 |
| `nexusos.events.approval.requested`   | `NativeApprovalHost`       | Agent requests human approval for privileged capability                                          | `promptId`, `taskId`, `title`, `riskTier`, `actionIdentifier`, `expiresAt`                                       |
| `nexusos.events.approval.decided`     | `TaskExecutionController`  | Human operator submits ALLOW/DENY decision                                                       | `promptId`, `taskId`, `decision`, `state`, `receiptHash`                                                         |
| `nexusos.events.graph.evolved`        | `MemoryEvolutionProcessor` | Graph outbox delivery commits new nodes/edges                                                    | `deliveryId`, `recordId`, `nodeCount`, `edgeCount`, `operationType`                                              |
| `nexusos.events.telemetry.sample`     | Background Sampler         | Sampled periodic system posture (every 5–10s)                                                    | `activeTaskCount`, `pendingApprovalCount`, `connectedDeviceCount`, `vramAlert`                                   |

### 9.2 Standard Telemetry Event Envelope

Building on `packages/contracts/src/events/index.ts`, all streaming events adhere to:

```ts
export interface TelemetryStreamEvent<T = Record<string, unknown>> {
  schema_id: string; // e.g. 'nexusos.events.delegation.created'
  version: '1.0.0';
  event_id: string; // UUIDv4
  epoch_id: string; // Process-lifetime stream epoch UUID (067-SEC-04)
  sequence_number: number; // Monotonic per-tenant sequence counter within epoch (067-SEC-04)
  cursor: string; // Canonical composite cursor `<epoch_id>:<sequence_number>`
  tenant_id: string; // Strict tenant ownership (067-SEC-01)
  workspace_id?: string; // Optional workspace scoping
  correlation_id: string; // Task ID, session ID, or trace correlation
  occurred_at: string; // ISO 8601 UTC timestamp
  producer_id: string; // 'delegation-coordinator', 'task-controller', etc.
  payload: T; // Strongly-typed event data (redacted per 067-SEC-03)
}
```

---

## 10. Authentication, Tenant & Workspace Security Model

### 10.1 Handshake Authentication (`067-SEC-02`)

- The streaming endpoint is an HTTP endpoint: `GET /v1/telemetry/stream`.
- When invoked, the backend executes the identical authentication gate used by all dashboard routes:
  ```ts
  const dashAuth = await this.authenticateForDashboard(req, res, context);
  if (!dashAuth) return; // 401 Unauthorized sent immediately
  ```
- **Browser EventSource Authentication Note**: The standard browser `EventSource` API does not natively allow custom `Authorization` HTTP headers.
  - **Pattern Option A (Recommended)**: Use a lightweight `fetch()` streaming reader in `DashboardAPIClient` that passes the `Authorization: Bearer <token>` header, parses `text/event-stream` chunks, and handles reconnection.
  - **Pattern Option B**: Authenticate via an ephemeral, single-use ticket (`GET /v1/telemetry/ticket` → returns a 30-second cryptographic token passed as `?ticket=...`).
  - **Pattern Option C**: HttpOnly session cookie.
  - _Discovery Recommendation_: Use **Pattern Option A** (fetch-based SSE reader). It requires zero backend ticketing state, maintains strict header-based auth, and prevents tokens from leaking into query strings or server access logs (`053-SEC-05`).

### 10.2 Strict Tenant & Workspace Isolation (`067-SEC-01`)

- The authenticated tenant ID (`dashAuth.tenantId`) is bound to the stream handler closure.
- Client-provided query parameters (e.g., `?tenantId=...`) are **strictly ignored** for access control.
- When an event is published to the internal bus, the SSE connection manager dispatches the event **only** to active stream sockets whose authenticated `tenantId` exactly matches `event.tenant_id`.
- If an optional `x-workspace-id` header or `?workspaceId=` parameter is supplied, events are further filtered to match that workspace or wildcard (`*`) workspace events.

---

## 11. Ordering, Cursor & Bounded Replay Strategy

### 11.1 The Out-of-Order / Missing Event Problem

When a network connection drops or a laptop lid closes, events continue to occur on the backend. When the client reconnects, it must not display stale data or corrupt its state.

### 11.2 Bounded Replay Architecture

1. **Per-Tenant Monotonic Sequence**:
   - The backend maintains an atomic monotonic integer counter `tenantSequence: Map<string, number>` starting at 1.
   - Every event published for that tenant receives a sequential `sequence_number`.
2. **In-Memory Ring Buffer**:
   - The backend maintains a bounded circular buffer per tenant:
     - **Max Capacity**: 100 events per tenant (`MAX_REPLAY_BUFFER_SIZE = 100`).
     - **Max Age / TTL**: 5 minutes (`MAX_REPLAY_BUFFER_AGE_MS = 300_000`).
   - Eviction is automatic: oldest events are discarded when the buffer reaches capacity or exceeds the TTL. This guarantees **bounded memory consumption** under all conditions.
3. **Resumption via Composite Cursor**:
   - Each SSE frame formats the composite cursor `<streamEpochId>:<sequenceNumber>` as the event ID:
     ```
     id: c2b4a689-1234-4567-89ab-cdef01234567:1042
     event: nexusos.events.delegation.created
     data: {"delegationId":"del-99", ...}
     ```
   - On reconnect, the client sends `Last-Event-ID: c2b4a689-1234-4567-89ab-cdef01234567:1042` (or `?lastEventId=...`).
   - Replay is evaluated against the current process epoch and buffer boundaries (detailed in §12).

---

## 12. Discovery Hardening — Cursor Epoch & Deployment Semantics

### 12.1 Problem Analysis: Ambiguity Across Backend Restarts

A simple integer counter starting at 1 creates dangerous cursor-integrity ambiguities across server restarts:

- Before restart: Tenant sequence reaches `1042`. Client disconnected at `Last-Event-ID: 2`.
- Backend restarts: In-memory sequence counter resets to `1`.
- New event produced: Receives sequence `3`.
- The client reconnects presenting `Last-Event-ID: 2`. Under naive sequence checks, the server would believe event `3` is the immediate successor to event `2`, incorrectly serving new epoch events as continuous history without reconciling the hundreds of events lost across the restart.

This violates `067-SEC-04` by claiming false cross-restart continuity.

### 12.2 Chosen Cursor Design: Process Stream Epoch + Monotonic Sequence

We evaluated four cursor identity alternatives:

| Alternative                                         | Evaluation                                                                                                                                                                                                                                 |                      Verdict                       |
| :-------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------: |
| **A. Server Epoch + Monotonic Sequence**            | Generates a random UUID on process startup (`streamEpochId = crypto.randomUUID()`). Cursor format: `<streamEpochId>:<monotonicSequence>`. Sequence is strictly monotonic within one epoch; cursor identity cannot collide across restarts. | **SELECTED (Smallest, safest, zero dependencies)** |
| **B. Process Start Timestamp + Sequence**           | Uses process launch epoch timestamp. Vulnerable to NTP clock adjustments and microsecond collisions during rapid container restarts.                                                                                                       |             Rejected in favor of UUID              |
| **C. Persisted Global Sequence (SQLite)**           | Writes an updated sequence counter to disk for every ephemeral telemetry event. Introduces heavy write amplification and SQLite lock contention against task execution.                                                                    |  Rejected (overkill for transient observability)   |
| **D. Distributed Vector Clock / Lamport Timestamp** | Multi-node causal ordering. Over-engineered for single-process desktop/server runtime; adds high framing overhead.                                                                                                                         |                      Rejected                      |

#### Canonical Cursor Representation

- `streamEpochId`: Generated once during backend initialization (`crypto.randomUUID()`).
- `sequenceNumber`: Atomic integer incremented per event per tenant (starting at 1).
- `Composite Cursor`: `${streamEpochId}:${sequenceNumber}` (e.g. `d4e5f6a7-b8c9-4012-9345-6789abcdef01:1042`).
- Regex validation: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$/i`.

### 12.3 Replay Semantics: The 5 Cursor Scenarios

When a client initiates an SSE connection passing `Last-Event-ID: <cursor>` (or query parameter `lastEventId`), the server parses the cursor into `[clientEpoch, clientSeq]` and applies strict deterministic branching:

```
                      Client connects with Last-Event-ID
                                      │
                                      ▼
                        Is cursor format valid regex?
                                ├── No ────────► [SCENARIO 5: MALFORMED]
                                │                Send stream.reset (MALFORMED_CURSOR)
                                │                Trigger full REST reconciliation
                                ▼ Yes
                     clientEpoch === serverEpoch?
                                ├── No ────────► [SCENARIO 4: SERVER_EPOCH_CHANGED]
                                │                Send stream.reset (SERVER_EPOCH_CHANGED)
                                │                Reset client cursor, trigger REST reconciliation
                                ▼ Yes
                   clientSeq > serverLatestSeq?
                                ├── Yes ───────► [SCENARIO 3: FUTURE_CURSOR]
                                │                Send stream.reset (FUTURE_CURSOR_DETECTED)
                                │                Reset client cursor, trigger REST reconciliation
                                ▼ No
                   clientSeq < bufferOldestSeq?
                                ├── Yes ───────► [SCENARIO 2: REPLAY_BUFFER_EXPIRED]
                                │                Send stream.reset (REPLAY_BUFFER_EXPIRED)
                                │                Trigger full REST reconciliation
                                ▼ No
                   [SCENARIO 1: VALID REPLAY]
                   Replay events (clientSeq + 1)..serverLatestSeq
                   Seamlessly transition to live stream
```

1. **Scenario 1: Current Epoch & Within Replay Buffer**
   - Condition: `clientEpoch === serverEpoch` AND `clientSeq >= bufferOldestSeq` AND `clientSeq <= serverLatestSeq`.
   - Behavior: The server replays all buffered events from `(clientSeq + 1)` through `serverLatestSeq` in strict FIFO order, then continues streaming live events. Zero missing data.
2. **Scenario 2: Current Epoch but Older than Replay Buffer**
   - Condition: `clientEpoch === serverEpoch` AND `clientSeq < bufferOldestSeq` (client was disconnected longer than 5 minutes or 100 events have passed).
   - Behavior: Server emits a control event:
     ```
     event: nexusos.events.stream.reset
     data: {"reason":"REPLAY_BUFFER_EXPIRED","currentEpoch":"d4e5f6a7...","currentSequence":1500}
     ```
     Client invalidates cached view data and triggers full REST reconciliation (`refreshCurrentView()`).
3. **Scenario 3: Current Epoch but Ahead of Server Sequence**
   - Condition: `clientEpoch === serverEpoch` AND `clientSeq > serverLatestSeq` (client supplied a corrupted or speculative sequence number).
   - Behavior: Server emits:
     ```
     event: nexusos.events.stream.reset
     data: {"reason":"FUTURE_CURSOR_DETECTED","currentEpoch":"d4e5f6a7...","currentSequence":100}
     ```
     Client resets its cursor and reconciles via REST.
4. **Scenario 4: Previous or Unknown Epoch (Process Restart)**
   - Condition: `clientEpoch !== serverEpoch` (backend restarted while client was disconnected).
   - Behavior: Server immediately emits:
     ```
     event: nexusos.events.stream.reset
     data: {"reason":"SERVER_EPOCH_CHANGED","currentEpoch":"d4e5f6a7...","currentSequence":0}
     ```
     **Critical Invariant**: The server **NEVER** attempts cross-epoch replay. The client discards its stale cursor, adopts `currentEpoch`, and executes a clean REST reconciliation.
5. **Scenario 5: Malformed Cursor**
   - Condition: Cursor fails regex validation.
   - Behavior: Server emits:
     ```
     event: nexusos.events.stream.reset
     data: {"reason":"MALFORMED_CURSOR","currentEpoch":"d4e5f6a7...","currentSequence":0}
     ```
     Client resets cursor and reconciles.

### 12.4 Multi-Instance Deployment Boundary

An audit of the NexusOS backend architecture confirms the following deployment characteristics:

- **Single-Process Authority**: `NexusOSBackendApp` (`services/backend/src/server/app.ts`) is designed and executed as a single Node.js process.
- **SQLite Single-Writer Model**: The primary state stores (`SqliteMemoryStore`, `TaskExecutionController`) rely on local SQLite files and in-memory Map tables. Multi-master replication is explicitly not present.
- **Explicit Architectural Boundaries**:
  1. **Process-Local Replay**: The stream event bus and replay buffers are strictly process-local.
  2. **No Global Multi-Instance Ordering**: Global ordering across multiple independent backend instances is **NOT** guaranteed and is not supported.
  3. **Connection Affinity**: An SSE stream must be served by the backend instance that executes the agent operations.
  4. **No Distributed Broker**: External distributed pub/sub infrastructure (Kafka, Redis, RabbitMQ) is intentionally excluded from the single-node architecture. If multi-worker horizontal scaling is ever required in future sprints, a distributed event log milestone must precede it.

### 12.5 Event Publisher Memory Bounds Strategy

An audit of [`services/backend/src/events/publisher-boundary.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/services/backend/src/events/publisher-boundary.ts) revealed an existing unbounded growth vector:

```ts
export class InMemoryEventPublisherBoundary implements EventPublisherBoundary {
  private readonly publishedEvents: EventEnvelope[] = []; // Grows indefinitely!
  async publish(event: EventEnvelope) {
    this.publishedEvents.push(event); // Unbounded push
    ...
  }
}
```

If this array is used for the real-time event bus, long-running processes will suffer memory leaks.

#### Decoupling Strategy: Live Stream Replay vs. REST Activity History

1. **Dedicated Live Replay Ring Buffer (`StreamReplayBuffer`)**:
   - Distinct from long-term activity storage.
   - Per-tenant circular buffer capped at **`MAX_REPLAY_BUFFER_SIZE = 100`** events and **`MAX_REPLAY_BUFFER_AGE_MS = 300,000`** (5 minutes).
   - Serves only real-time reconnects via `Last-Event-ID`.
2. **Bounded REST Activity History (`InMemoryEventPublisherBoundary`)**:
   - Retained for paginated queries via `GET /v1/activity`.
   - Must enforce a strict FIFO cap: **`MAX_PUBLISHED_EVENTS = 1,000`** total (or 250 events per tenant).
   - When the array reaches capacity, oldest events are evicted via `shift()`.
   - Preserves sufficient history for recent activity pagination while eliminating memory leaks.
3. **No Unbounded Memory**: Under zero circumstances may any in-memory event array grow unbounded.

---

## 13. Reconnection & Lifecycle Strategy

### 13.1 Client Connection State Machine

The client manages four explicit connection states surfaced on the existing `#connection-indicator` element:

```
[ OFFLINE / DISCONNECTED ]
      │
      │ connect() / auto-retry
      ▼
[ CONNECTING ] ──(Auth fail / 401)──► [ AUTH_REQUIRED ]
      │
      │ 200 OK text/event-stream
      ▼
[ CONNECTED_STREAMING ]
      │
      ├─(Network drop / Heartbeat timeout)──► [ RECONNECTING (Backoff) ]
      │                                                │
      └─(3 failed reconnect attempts)──────────────────▼
                                              [ DEGRADED_POLLING ]
```

### 13.2 Lifecycle Handlers

- **Tab Hidden (`document.hidden`)**:
  - When the tab is blurred/hidden, the client closes the SSE stream to save server resources and battery.
  - When the tab becomes visible (`visibilitychange`), the client immediately reconnects with its latest known `lastEventId`.
- **Heartbeat & Zombie Connection Detection**:
  - The server emits an SSE comment heartbeat every 15 seconds (`: ping\n\n`).
  - If the client receives no data or ping for 35 seconds, it considers the connection dead, tears down the socket, and reconnects.
- **Multiple Tabs**:
  - Each browser tab maintains an independent SSE connection scoped to the authenticated tenant. The backend bus broadcasts events to all active connections matching the tenant.

---

## 14. Backpressure & Resource Bounds

To prevent memory exhaustion, slow-client stalls, or ReDoS attacks, explicit numerical ceilings are established:

| Boundary Parameter                       | Enforced Limit             | Rationale                                                                                                                                                                                                                               |
| :--------------------------------------- | :------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Max Concurrent Streams per Tenant**    | `10 connections`           | Prevents connection starvation from runaway browser tabs or automated scripts. Excess connections rejected with `429 Too Many Requests`.                                                                                                |
| **Max Event Payload Size**               | `16,384 bytes (16 KB)`     | Telemetry frames are compact descriptors, not bulk binary transfers. Payloads exceeding 16 KB are rejected fail-closed.                                                                                                                 |
| **Max Replay Buffer per Tenant**         | `100 events` / `5 minutes` | Caps server in-memory buffer to < 2 MB per active tenant under worst-case load.                                                                                                                                                         |
| **Socket Buffer / Backpressure**         | `highWaterMark: 16 KB`     | If a client socket buffer fills (slow consumer), non-essential telemetry metric samples are dropped. Critical lifecycle events (approvals, task completions) are retained. If buffer remains saturated > 30s, connection is terminated. |
| **Client DOM Bounds**                    | `100 items maximum`        | Retains existing dashboard bounds: max 100 activity events, max 100 delegation tree nodes, max 50 tasks rendered.                                                                                                                       |
| **Max Events per Second (Rate Ceiling)** | `50 events/sec per tenant` | Protects UI thread from layout thrashing during extreme burst activity.                                                                                                                                                                 |

---

## 15. Fallback & Graceful Degradation Design

### 15.1 The Three-Tier Reliability Hierarchy

```
Tier 1: Live SSE Stream (Sub-second latency, push updates)
   │
   ▼ (Connection failure / Network proxy blocking streaming / 3 consecutive errors)
Tier 2: Governed REST Polling (15-second cadence, identical to Task 063)
   │
   ▼ (Total network outage / Backend down)
Tier 3: Offline Stale-State Display with Operator Retry Button
```

### 15.2 Fail-Safe Principles

1. **Never Brick the UI**: If the SSE endpoint returns 404, 502, or fails to connect, the dashboard silently transitions to Tier 2 (15s polling) and updates the header badge to `"Live Updates Paused (Polling)"`.
2. **Read-Only Invariance**: A failure in the real-time telemetry stream **never** blocks an operator from submitting an approval decision or canceling a task via REST.
3. **No Phantom State**: Reconnected streams always verify their sequence integrity against the server before updating the DOM.

---

## 16. Accessibility (WCAG 2.2 AA) & UX Requirements

### 16.1 Managing Real-Time Screen-Reader Announcements

Uncontrolled real-time updates are a primary violation of WCAG 2.2 AA (Criterion 4.1.3: Status Messages), causing screen readers to interrupt the user constantly.

- **Live Region Scoping**:
  - High-frequency events (e.g. periodic CPU/VRAM metric updates, agent heartbeat timestamps) MUST NOT be attached to `aria-live` regions. They update visually in place without screen-reader chatter.
  - Critical, human-actionable events (e.g. `nexusos.events.approval.requested`, `nexusos.events.task.failed`) MUST trigger an announcement via a dedicated polite live region (`<div id="telemetry-live-announcer" class="sr-only" role="status" aria-live="polite">`).
- **Focus Preservation**:
  - Background DOM insertions or re-orderings in the Delegation Tree or Activity Feed MUST NEVER steal user focus.
  - Active form controls (such as the approval decision notes input or filter dropdowns) must retain focus during stream updates.
- **Connection State Transparency**:
  - The `#connection-indicator` in the header maintains explicit semantic status:
    - `"Connected"` (`connection-indicator--online`, `aria-live="polite"`)
    - `"Reconnecting..."` (`connection-indicator--connecting`, `aria-live="polite"`)
    - `"Offline — Polling Active"` (`connection-indicator--polling`, `aria-live="polite"`)

---

## 17. Security Threat Model & Concrete Invariants

### 17.1 Threat Vectors Analyzed

1. **Cross-Tenant Telemetry Snooping**: An attacker in Tenant B attempts to observe tasks, agent registrations, or delegation hierarchies belonging to Tenant A by connecting to the stream with crafted query parameters or forged headers.
2. **Secret Leakage in Event Payloads**: An agent task executes with an API token or password in its parameters; the task completion event broadcasts the raw parameters over the telemetry stream to the browser.
3. **Stream Hijacking & Command Injection**: An adversary attempts to send execution frames or reverse-RPC commands back across the telemetry connection to manipulate backend state.
4. **Denial of Service via Connection Exhaustion**: A malicious tenant opens thousands of concurrent streaming connections to exhaust Node.js file descriptors and memory.
5. **DOM / Memory Exhaustion via Event Flooding**: A compromised or misbehaving agent loops rapidly, emitting thousands of events per second to freeze the operator's browser tab.
6. **Cross-Restart Replay Confusion**: A client connects after a backend restart with a cursor from a previous server epoch, causing either duplicate event execution or missed state transitions.

### 17.2 Concrete Security Invariants (Hardened)

The implementation of Task 067 must enforce the following eight mandatory security invariants:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      TASK 067 MANDATORY SECURITY INVARIANTS                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 067-SEC-01: Tenant & Workspace Event Isolation                                  │
│             Stream dispatch is strictly filtered by the authenticated tenant    │
│             context. Client-supplied tenant query parameters are NEVER trusted  │
│             as authority. Cross-tenant subscriptions are impossible.            │
│                                                                                 │
│ 067-SEC-02: Authenticated Subscription Authority                                │
│             Establishing a stream requires valid authentication credentials.    │
│             Unauthenticated or expired requests are rejected with 401.          │
│                                                                                 │
│ 067-SEC-03: Event Payload Secret Containment                                    │
│             All event payloads pass through RedactionFilter before publication. │
│             API keys, tokens, and raw passwords are never broadcast.            │
│                                                                                 │
│ 067-SEC-04: Ordering & Monotonic Cursor Integrity (Hardened)                    │
│             Events carry strictly increasing sequence numbers scoped to a       │
│             process stream epoch (<streamEpochId>:<sequenceNumber>). Monotonicity│
│             is guaranteed within an epoch. Cursors from prior epochs or future  │
│             speculative sequences are rejected with an explicit stream.reset    │
│             frame (SERVER_EPOCH_CHANGED / FUTURE_CURSOR_DETECTED), triggering   │
│             safe REST reconciliation. Cross-epoch replay confusion is forbidden.│
│                                                                                 │
│ 067-SEC-05: Replay Buffer Boundedness & Lifetime Separation (Hardened)          │
│             Live replay buffers are strictly bounded (max 100 events / 5 min per│
│             tenant) and tied to the active process epoch. Expired cursors trigger│
│             an explicit REPLAY_BUFFER_EXPIRED reset. Background REST activity   │
│             history storage is capped at 1,000 events FIFO to eliminate memory  │
│             leaks. Zero unbounded in-memory queues are permitted.               │
│                                                                                 │
│ 067-SEC-06: Duplicate & Out-of-Order Safety                                     │
│             Dashboard clients deduplicate event IDs and maintain deterministic  │
│             timestamp sorting before DOM insertion.                             │
│                                                                                 │
│ 067-SEC-07: Connection & Resource Exhaustion Protection                         │
│             Enforces hard caps: max 10 concurrent streams per tenant, 16 KB max │
│             event size, and backpressure socket draining.                       │
│                                                                                 │
│ 067-SEC-08: Observability Isolation (No Execution Authority)                    │
│             The real-time channel is strictly unidirectional (server-to-client).│
│             All state mutations require authenticated REST commands with leases │
│             and nonces. Observability data NEVER confers execution authority.   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 18. Proposed Implementation Phases

When Task 067 moves to implementation, the work should be structured in four sequential, test-driven phases:

### Phase 1: Canonical Real-Time Event Contracts & Backend Event Bus

- Define `TelemetryStreamEventSchema` and event payload schemas in `packages/contracts/src/events/stream.ts`.
- Re-export contracts through `packages/contracts/src/index.ts`.
- Extend `services/backend/src/events/publisher-boundary.ts` into a lightweight, in-process pub/sub event bus supporting `subscribe(tenantId, listener)`, per-tenant monotonic sequence generation within a random `streamEpochId`, dedicated bounded circular replay buffers (`StreamReplayBuffer`), and a 1,000-event FIFO cap on activity history.
- Unit tests: Contract validation, epoch generation, and event bus subscriber isolation.

### Phase 2: Producer Instrumentation & Backend SSE Endpoint

- Instrument `DelegationCoordinator` to publish `delegation.created`, `completed`, `failed`, `cancelled`.
- Instrument `AgentDirectoryService` to publish `agent.status_changed`.
- Instrument `NativeApprovalHost` to publish `approval.requested`.
- Implement `GET /v1/telemetry/stream` in `services/backend/src/server/app.ts`:
  - Route authentication via `authenticateForDashboard()`.
  - SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`).
  - Connection limit enforcement (`maxStreamsPerTenant = 10`).
  - Composite cursor recovery (`Last-Event-ID: <epoch>:<seq>`) handling all 5 replay scenarios.
  - Heartbeat ping timer (every 15s).
- Integration tests: Multi-tenant SSE streaming, restart epoch reset, replay recovery, and secret redaction.

### Phase 3: Web Dashboard SSE Integration & Live Views

- Add `subscribeTelemetry()` to `DashboardAPIClient` using a fetch-based streaming reader.
- Integrate stream event handlers into `apps/web-dashboard/src/main.ts`:
  - Handle `nexusos.events.stream.reset` by resetting stored cursor and triggering `refreshCurrentView()`.
  - Dynamically update Agent Roster status cards on `agent.status_changed`.
  - Dynamically insert/update nodes in the Delegation Live Tree and Timeline on `delegation.*`.
  - Prepend new events to Activity Feed with deduplication and 100-item cap.
  - Trigger approval badge and view updates instantly on `approval.requested` / `approval.decided`.
- Implement automatic fallback to 15s polling on stream failure.
- Update `#connection-indicator` with real-time connection state.

### Phase 4: Security Hardening & Vertical Slice Verification

- Author security suite `tests/hardening/dashboard-telemetry-security.test.ts` covering `067-SEC-01` through `067-SEC-08` (including restart epoch separation and buffer bounds).
- Author vertical slice test `tests/vertical-slice/dashboard-realtime-telemetry-vertical-slice.test.ts` verifying end-to-end delegation lifecycle streaming from coordinator to client.
- Execute full monorepo quality gates (`build`, `typecheck`, `lint`, `format:check`, `validate`, `security`, `pnpm test`).

---

## 19. Explicit Non-Goals

To maintain strict boundary discipline and prevent scope creep, the following are declared explicit non-goals for Task 067:

1. **NO WebSockets**: WebSockets are explicitly rejected due to unnecessary bidirectional complexity, missing dependencies, and violation of `067-SEC-08`.
2. **NO External Message Brokers**: No Redis, RabbitMQ, Kafka, or external pub/sub infrastructure. All event distribution is in-process within the backend control-plane service.
3. **NO Bidirectional Commands over Stream**: The dashboard will not send commands, decisions, or cancellations over the SSE stream. All mutations remain on authenticated REST endpoints.
4. **NO Unbounded History Storage**: The backend will not store permanent event histories in memory. Replay buffers are strictly capped at 100 entries / 5 minutes, and passive activity history is capped at 1,000 entries FIFO.
5. **NO Changes to Execution Authority or Lease Governance**: The delegation safety bounds (`MAX_DEPTH = 3`, `MAX_FAN_OUT = 5`), approval state machines, and lease attenuation logic from Task 060 remain entirely untouched.
6. **NO Changes to Memory/Graph Persistence**: The SQLite outbox and graph evolution engine from Task 066 remain the sole authority for knowledge graph state.

---

## 20. Risks & Open Questions

| Risk / Question                               | Impact                                                                                                              | Mitigation Strategy                                                                                                                                                                                                                                                                         |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Browser `EventSource` Header Limitation**   | Standard `EventSource` cannot pass `Authorization: Bearer` headers.                                                 | **Mitigation**: Implement a lightweight `fetch()` response body stream reader (`ReadableStreamDefaultReader`) in `DashboardAPIClient`. This allows standard `Authorization` headers, full control over reconnection backoff, and identical SSE event parsing without external dependencies. |
| **HTTP/1.1 Max Connections per Host**         | Browsers limit HTTP/1.1 connections to 6 per domain, which could starve other REST calls if SSE holds a connection. | **Mitigation**: Dashboard is served on modern browsers supporting HTTP/2 or local loopback where multiplexing is supported. Furthermore, the dashboard maintains at most **1** SSE connection per tab, leaving ample sockets for REST mutations.                                            |
| **Corporate Proxy Buffering**                 | Certain enterprise proxies buffer chunked HTTP responses, delaying SSE frames.                                      | **Mitigation**: Include `X-Accel-Buffering: no` header in backend response; 15-second fallback polling guarantees the dashboard remains functional even if a proxy completely stalls the stream.                                                                                            |
| **UI Layout Thrashing during Burst Activity** | High event volume could cause browser render lag if every frame triggers immediate DOM reflow.                      | **Mitigation**: Batch incoming UI updates using `requestAnimationFrame()` in `main.ts`, applying updates in single animation frames.                                                                                                                                                        |

---

## 21. Conclusion & Readiness

This discovery report comprehensively establishes the hardened real-time telemetry architecture for Task 067 (Sprint 3 Candidate S3-03).

- **Restart-Safe Cursor Identity**: Uses `<streamEpochId>:<sequenceNumber>` to eliminate cross-restart sequence collisions and provide deterministic replay reset.
- **Process-Local Scope**: Explicitly identifies the single-process boundary of NexusOS without fabricating unsupported distributed guarantees.
- **Strict In-Memory Bounds**: Decouples live stream replay (100 items / 5 min) from REST activity history (1,000 items FIFO), eliminating memory leaks.
- **Security Invariants**: `067-SEC-01` through `067-SEC-08` are formally hardened against stale cursors, secret leakage, and execution authority escape.

**STATUS: DISCOVERY ONLY — DO NOT IMPLEMENT.**
