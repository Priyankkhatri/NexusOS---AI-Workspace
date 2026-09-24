# Task 067 Phase 3 Discovery Report

**Sprint 3 / S3-03: Web Dashboard Real-Time Telemetry, Live Agent Activity & Delegation Observability**  
**Phase 3 Discovery: Web Dashboard Live Telemetry, SSE Client, Reconnection & Live Agent/Delegation Observability**

---

## 1. Authoritative Task Identity

- **Task Identifier**: Task 067 — Sprint 3 / S3-03
- **Title**: Web Dashboard Real-Time Telemetry, Live Agent Activity & Delegation Observability
- **Sub-Phase**: Phase 3 Discovery Only (Web Dashboard Client Integration)
- **Status**: Discovery Only. Implementation strictly forbidden during this pass.
- **Preceding Milestones**:
  - **Phase 1 (Closed)**: `fcb3acfcf52d37db64a62bbb31842e23c5188b6a` — Canonical stream contracts, `TenantStreamEventBus`, bounded replay buffer, epoch + sequence cursor, tenant/workspace isolation, reset semantics, and secret redaction.
  - **Phase 2 (Closed)**: `ff9bbb34f0113fcb9d712376b61b0471ea64b7f5` — Production SSE endpoint (`GET /v1/telemetry/stream`), `SSEStreamConnection`, heartbeat frames, bounded backpressure queue, multi-workspace replay-to-live horizon deduplication, authoritative producer instrumentation across `TaskController`, `AgentDirectoryService`, `DelegationCoordinator`, and `GraphEvolutionEngine`. Certified green in GitHub Actions Run `35127951536`.

---

## 2. Current Git Baseline Verification

The working tree and remote tracking branch were verified against the repository baseline:

```bash
$ git rev-parse HEAD
b173cd769aad205d1233198acee7273cc66e6667

$ git rev-parse origin/main
b173cd769aad205d1233198acee7273cc66e6667

$ git status --short
# (clean working tree)
```

- **Expected Baseline SHA**: `ff9bbb34f0113fcb9d712376b61b0471ea64b7f5` (Phase 2 completion)
- **Actual HEAD SHA**: `b173cd769aad205d1233198acee7273cc66e6667`
- **Baseline Discrepancy Analysis**: The actual HEAD SHA `b173cd769aad205d1233198acee7273cc66e6667` contains the initial discovery report commit `b173cd7` (`docs(task-067): discover phase 3 dashboard realtime integration`) which advanced `origin/main` directly from Phase 2 final `ff9bbb34f0113fcb9d712376b61b0471ea64b7f5`. No source code, tests, or package dependencies have been modified. Actual HEAD `b173cd769aad205d1233198acee7273cc66e6667` is used as the authoritative repository source of truth.
- **Working Tree**: Clean. No uncommitted modifications or untracked implementation files.

---

## 3. Audit of Existing Web Dashboard (`apps/web-dashboard/`)

An in-depth audit of the existing dashboard architecture was conducted across `apps/web-dashboard/index.html`, `apps/web-dashboard/src/main.ts`, `apps/web-dashboard/src/api/client.ts`, and `apps/web-dashboard/src/index.css`.

### 3.1 Entry Point & Component Architecture

- **Entry Point**: `apps/web-dashboard/src/main.ts` compiled via `tsc` to `dist/index.js`, loaded via `<script type="module" src="./dist/main.js">` in `index.html`.
- **Framework & Dependencies**: Pure vanilla TypeScript (v5.7.3) with direct DOM manipulation. Zero UI frameworks (no React, Vue, or Svelte). Runtime dependency is `@nexusos/contracts` and `zod`.
- **Styling**: `apps/web-dashboard/src/index.css` (43 KB) defining CSS custom properties, responsive grid layout, card animations, dark/light theme switching, and WCAG-compliant color tokens.

### 3.2 State Management Model

The application state is centralized in a single module-scoped object (`state: AppState`, lines 113–151 of `main.ts`):

```typescript
interface AppState {
  currentView:
    | 'overview'
    | 'tasks'
    | 'approvals'
    | 'activity'
    | 'agents'
    | 'delegations'
    | 'memory'
    | 'graph';
  summary: DashboardSummaryResponse | null;
  tasks: TaskItemResponse[];
  tasksCursor: string | undefined;
  tasksTotal: number;
  taskFilter: string;
  approvals: ApprovalViewModel[];
  activity: ActivityItemResponse[];
  activityCursor: string | undefined;
  activityTotal: number;
  agents: AgentRecord[];
  agentRoleFilter: string;
  agentStatusFilter: string;
  agentsRequestId: number;
  delegations: DelegationSummary[];
  delegationStatusFilter: string;
  delegationsRequestId: number;
  selectedSessionId?: string;
  // Memory & Graph Explorer Projections
  memoryItems: MemorySearchResultItem[];
  memoryTotal: number;
  memorySearchQuery: string;
  memoryClassFilter: string;
  memorySensitivityFilter: string;
  memoryStatusFilter: string;
  selectedMemoryRecord: MemoryRecord | null;
  memoryRequestId: number;
  graphNodes: MemoryGraphNode[];
  graphEdges: MemoryGraphEdge[];
  graphNodeTypeFilter: string;
  graphEdgeTypeFilter: string;
  graphDepth: number;
  selectedGraphNode: MemoryGraphNode | null;
  selectedGraphEdge: MemoryGraphEdge | null;
  graphViewMode: 'visual' | 'table';
  graphRequestId: number;
  isLoading: boolean;
  pollingInterval: ReturnType<typeof setInterval> | null;
}
```

### 3.3 Current Polling & Lifecycle Implementation

- **Polling Loop** (`main.ts:2569–2584`):
  ```typescript
  function startPolling(): void {
    if (state.pollingInterval) return;
    state.pollingInterval = setInterval(() => {
      void refreshCurrentView();
    }, 15_000);
  }
  ```
- **View Refresh** (`main.ts:2585–2595`): On timer trigger, calls `loadSummary()` and `loadViewData(state.currentView)`.
- **Visibility Optimization** (`main.ts:2598–2606`): Uses `document.addEventListener('visibilitychange')` to halt polling when `document.hidden === true` and resume when the tab becomes active.
- **Deficiencies in Current Polling**:
  - Polling is blind: requests full REST snapshots every 15 seconds regardless of whether mutations occurred.
  - Updates introduce visual latency (up to 15s delay for critical task failure or delegation cascade).
  - No sequence tracking or change deltas.

### 3.4 Connection Indicator Audit

- `index.html` lines 65–73 contains:
  ```html
  <span
    id="connection-indicator"
    class="connection-indicator connection-indicator--online"
    role="status"
    aria-live="assertive"
  >
    Connected
  </span>
  ```
- **Finding**: The connection indicator is currently **static**. `main.ts` never references or updates `#connection-indicator`. `index.css` provides `.connection-indicator--online` (green) and `.connection-indicator--offline` (red), but no runtime code drives these classes.

### 3.5 Rendering Model, DOM Bounds & Deduplication

- **Rendering**: Views are rendered via string templates sanitized through `sanitizeHTML()` (`053-SEC-04`) and inserted using `innerHTML` or `textContent`.
- **DOM Bounds**: Activity stream is capped at 50 items; tasks, agents, and delegations query endpoints enforce limits (e.g. `Math.min(limit, 100)`).
- **Deduplication**: Currently absent on client. Every REST refresh replaces existing state arrays wholesale.

---

## 4. Audit of Phase 2 SSE Wire Contract

The Phase 2 backend streaming boundary in `services/backend/src/server/app.ts`, `services/backend/src/events/sse-handler.ts`, and `packages/contracts/src/events/stream.ts` establishes the authoritative wire contract:

### 4.1 Wire Endpoint & HTTP Headers

- **Endpoint**: `GET /v1/telemetry/stream`
- **Allowed Methods**: `GET` only. All other HTTP verbs return `405 Method Not Allowed` (`067-SEC-07`).
- **Response Headers**:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`
- **Status Codes**:
  - `200 OK`: Stream established.
  - `401 Unauthorized`: Missing or invalid bearer credentials.
  - `405 Method Not Allowed`: Non-GET request.
  - `429 Too Many Requests`: Tenant stream ceiling exceeded (max 10 concurrent streams per tenant per `067-SEC-07`).

### 4.2 Stream Frame Formatting

Events are framed according to the W3C Server-Sent Events specification:

```
event: <schema_id>
id: <cursor>
data: <json_payload>

```

- `event`: Canonical schema category (e.g. `nexusos.events.task.status_changed`).
- `id`: Composite cursor formatted as `<streamEpochId>:<sequenceNumber>` (UUIDv4:integer, e.g. `c2b4a689-1234-4567-89ab-cdef01234567:1042`).
- `data`: Complete JSON-stringified `TelemetryStreamEvent` envelope.

### 4.3 Heartbeat Protocol

- Format: `: ping\n\n` (SSE comment line).
- Cadence: Every 15,000 ms (`DEFAULT_HEARTBEAT_INTERVAL_MS`).
- Semantics: Comment-only; contains no `event:` or `id:` fields, does **not** advance stream sequence numbers, does **not** enter replay buffers, and does **not** trigger client telemetry handlers.

### 4.4 Client Resumption & Cursor Parameters

Clients supply their resumption cursor via:

1. `Last-Event-ID` HTTP header (primary, standard SSE mechanism).
2. `?lastEventId=<cursor>` URL query parameter (fallback).

### 4.5 Stream Reset Protocol (`stream.reset`)

If the server cannot resume from the client's requested cursor, it dispatches an immediate control event:

```
event: nexusos.events.stream.reset
id: <currentEpoch>:0
data: {"reason":"<REASON>","currentEpoch":"<UUID>","currentSequence":<N>,"requestedCursor":"..."}

```

- **Reset Reasons**:
  - `SERVER_EPOCH_CHANGED`: Server was restarted or process epoch was refreshed.
  - `REPLAY_BUFFER_EXPIRED`: Requested sequence number is older than oldest retained event in the 100-event / 5-minute ring buffer.
  - `FUTURE_CURSOR_DETECTED`: Sequence number exceeds server's latest sequence.
  - `MALFORMED_CURSOR`: Format does not conform to `STREAM_CURSOR_REGEX`.

### 4.6 Bounded Capacity & Backpressure

- Per-tenant concurrent stream limit: Maximum 10 connections (`MAX_STREAMS_PER_TENANT = 10`).
- Per-connection outbound queue ceiling: 64 frames or 256 KB memory (`DEFAULT_MAX_QUEUE_SIZE = 64`, `DEFAULT_MAX_QUEUE_BYTES = 256 * 1024`).
- Saturated consumers exceeding memory boundaries are terminated and disconnected immediately to prevent buffer bloat.

---

## 5. Authentication & Browser Transport Analysis

A critical architectural challenge in browser environments is how to authenticate the SSE stream while preserving NexusOS security invariants.

### 5.1 The Browser Transport Constraint

In standard browser implementations, the W3C `EventSource` API has a major limitation: **it does not support custom HTTP request headers**. It is impossible to call `new EventSource(url)` and attach `Authorization: Bearer <token>`.

### 5.2 Comparative Analysis of Authentication Options

| Dimension                           | Option A: Native `EventSource` with Query Param                 | Option B: Fetch-Based Streaming Reader (`ReadableStream`)                | Option C: Session / HttpOnly Cookie                       |
| :---------------------------------- | :-------------------------------------------------------------- | :----------------------------------------------------------------------- | :-------------------------------------------------------- |
| **Header Support**                  | ❌ No custom headers allowed                                    | ✅ Full custom headers (`Authorization: Bearer ...`)                     | ❌ No custom headers (relies on browser cookie jar)       |
| **Security Invariant `053-SEC-05`** | ❌ **VIOLATION**: Exposes bearer token in URL query parameter   | ✅ **COMPLIANT**: Token held in memory closure, sent in header           | ⚠️ Requires full CSRF mitigation architecture             |
| **Leakage Surface**                 | ❌ Token logged in server access logs, browser history, proxies | ✅ Zero URL leakage; standard header redaction applies                   | ⚠️ Cookie replay risks across browser tabs                |
| **Backpressure / Abort**            | ⚠️ Limited to `eventSource.close()`                             | ✅ Fine-grained `AbortController.abort()`                                | ⚠️ Limited to `eventSource.close()`                       |
| **Reconnection Control**            | ❌ Fixed browser-internal reconnect; cannot coordinate backoff  | ✅ Explicit exponential backoff, jitter, and fallback state machine      | ❌ Fixed browser-internal reconnect                       |
| **Backend Route Impact**            | ❌ Requires ticket exchange or query-token auth in `app.ts`     | ✅ 100% compatible with existing `BackendApp.authenticateForDashboard()` | ❌ Requires session cookie middleware and CSRF protection |
| **New Dependencies**                | 0 (Native API)                                                  | 0 (Native API: `fetch`, `ReadableStreamDefaultReader`, `TextDecoder`)    | 0                                                         |

### 5.3 Architectural Recommendation

**Adopt Option B: Fetch-Based Streaming Reader (`fetch` + `ReadableStreamDefaultReader<Uint8Array>`).**

**Rationale**:

1. **Zero Security Compromise**: Passes the bearer token via `Authorization: Bearer ${token}` header, maintaining strict compliance with `053-SEC-05` (no tokens in URLs or storage).
2. **Immediate Backend Compatibility**: `BackendApp.authenticateForDashboard()` in `services/backend/src/server/app.ts:846` already expects and validates bearer headers for `/v1/telemetry/stream`. No backend auth changes are required.
3. **Deterministic Reconnection Control**: Allows the client to control backoff intervals, detect heartbeat timeouts, and transition to polling fallback without fighting browser-native retry timers.
4. **Zero New Dependencies**: `fetch`, `ReadableStream`, `TextDecoder`, and `AbortController` are universal web standards supported in all modern browsers.

---

## 6. SSE Client Design Abstraction

The client streaming abstraction will be implemented in `apps/web-dashboard/src/api/stream-client.ts` as `TelemetryStreamClient`.

### 6.1 Interface & Lifecycle Methods

```typescript
export interface TelemetryStreamClientConfig {
  baseUrl: string;
  getAuthToken: () => string | null;
  getWorkspaceId?: () => string | undefined;
  onEvent: (event: TelemetryStreamEvent) => void;
  onReset: (payload: StreamResetPayload) => void;
  onStateChange: (state: ConnectionState, detail?: string) => void;
  heartbeatTimeoutMs?: number; // Default: 35,000 ms (2x server heartbeat + 5s grace)
  maxReconnectAttempts?: number; // Default: 5 before falling back to polling
}

export class TelemetryStreamClient {
  public connect(): void;
  public disconnect(): void;
  public getState(): ConnectionState;
  public getCurrentCursor(): string | null;
}
```

### 6.2 SSE Frame Parsing Algorithm

The streaming reader processes incoming binary chunks via `TextDecoder`:

1. Maintain an internal `lineBuffer: string` to handle chunk boundaries splitting SSE lines.
2. Split buffer on `\n`. Keep incomplete trailing line in `lineBuffer`.
3. Track current frame state (`currentEventName`, `currentEventId`, `currentDataLines: string[]`).
4. On empty line (`\n\n`), dispatch completed frame:
   - If line starts with `:` (SSE comment), reset heartbeat watchdog timer.
   - If `event` is present, parse `currentDataLines.join('\n')` as JSON and invoke `onEvent` or `onReset`.
   - Update `currentCursor` to `currentEventId`.

### 6.3 Heartbeat Watchdog

- The server emits `: ping\n\n` every 15s.
- The client maintains a watchdog timer initialized to 35s.
- Whenever any byte or comment frame arrives, the watchdog timer resets.
- If the watchdog timer fires, the connection is declared dead (e.g. silent TCP drop or Wi-Fi sleep). The client invokes `abortController.abort()` and enters the reconnection state machine.

---

## 7. Reconnection State Machine

The client connection lifecycle is governed by an explicit finite state machine:

```
                  +-----------------------+
                  |        OFFLINE        |
                  +-----------+-----------+
                              |
                     connect() invoked
                              |
                              v
                  +-----------------------+
        +-------->|      CONNECTING       |<--------+
        |         +-----------+-----------+         |
        |                     |                     |
   Retry delay                | 200 OK + Handshake  | Max retries
   (Backoff + Jitter)         v                     | exceeded / 429
        |         +-----------------------+         |
        |         |  CONNECTED_STREAMING  |         |
        |         +-----------+-----------+         |
        |                     |                     |
        |           Socket Drop / Watchdog          |
        |                     |                     |
        |                     v                     |
        +---------+-----------------------+         |
                  |     RECONNECTING      +---------+
                  +-----------+-----------+
                              |
                              | Fallback triggered
                              v
                  +-----------------------+
                  |   DEGRADED_POLLING    |
                  +-----------+-----------+
                              |
               Probe timer / Window Focus
                              |
                              +--> Re-attempt connect()
```

### 7.1 State Definitions

1. `OFFLINE`: Explicitly disconnected, browser offline (`navigator.onLine === false`), or 401 unauthenticated. All timers inactive.
2. `CONNECTING`: HTTP fetch initiated; awaiting response headers and first byte.
3. `CONNECTED_STREAMING`: Reading SSE frames; heartbeats active. Polling fallback is suspended.
4. `RECONNECTING`: Stream interrupted; performing bounded exponential backoff.
5. `DEGRADED_POLLING`: Streaming unavailable (e.g. 429 concurrency ceiling or repeated reconnect failures); existing 15s REST polling active.

### 7.2 Transition Matrix & Guard Conditions

| Current State         | Event / Trigger                 | Target State          | Action / Side Effect                                             |
| :-------------------- | :------------------------------ | :-------------------- | :--------------------------------------------------------------- |
| `OFFLINE`             | `connect()` called              | `CONNECTING`          | Create `AbortController`, issue `fetch()`                        |
| `CONNECTING`          | HTTP 200 + stream open          | `CONNECTED_STREAMING` | Stop REST polling, reset retry counter, start heartbeat watchdog |
| `CONNECTING`          | HTTP 401 Unauthorized           | `OFFLINE`             | Disconnect, fire auth failure callback, trigger UI login prompt  |
| `CONNECTING`          | HTTP 429 Too Many Requests      | `DEGRADED_POLLING`    | Start REST polling, schedule delayed probe (30s)                 |
| `CONNECTING`          | Network error / Fetch failure   | `RECONNECTING`        | Increment retry counter, schedule backoff timer                  |
| `CONNECTED_STREAMING` | Watchdog timeout / Socket close | `RECONNECTING`        | Abort fetch, check retry count, schedule backoff timer           |
| `RECONNECTING`        | Backoff timer elapsed           | `CONNECTING`          | Issue fetch with `Last-Event-ID: ${cursor}`                      |
| `RECONNECTING`        | Retry count >= 5                | `DEGRADED_POLLING`    | Activate REST polling, schedule background probe timer (60s)     |
| `DEGRADED_POLLING`    | Background probe timer fires    | `CONNECTING`          | Attempt optimistic stream re-connection                          |
| Any State             | `disconnect()` / Window unload  | `OFFLINE`             | Abort controller, clear all timers, stop polling                 |

### 7.3 Backoff & Jitter Formulation

To prevent reconnection stampedes upon backend restart:
$$\text{delay} = \min\left(\text{baseDelay} \times \text{multiplier}^{\text{attempt}}, \text{maxDelay}\right) \times (1 \pm \text{jitter})$$

- `baseDelay`: 1,000 ms
- `multiplier`: 1.5
- `maxDelay`: 15,000 ms
- `jitter`: Uniform random distribution within $[-0.2, +0.2]$ ($\pm 20\%$)

---

## 8. Cursor Persistence & Reconciliation Strategy

### 8.1 In-Memory Cursor Scoping

- The stream cursor `<streamEpochId>:<sequenceNumber>` is maintained **strictly in memory** in `TelemetryStreamClient`.
- **Security Invariant `067-SEC-10`**: Cursors are **never written to `localStorage` or `sessionStorage`**. Persisting cursors to web storage risks cross-tenant state leakage or cursor reuse across different authenticated operator sessions on shared browser hardware.

### 8.2 Cursor Invalidation & Re-Sync (`stream.reset`)

When the server sends `stream.reset`:

1. Capture `currentEpoch` and `currentSequence` from the payload.
2. Advance local cursor to `${resetPayload.currentEpoch}:${resetPayload.currentSequence}`.
3. Trigger **Immediate REST Reconciliation**:
   - Re-fetch `loadSummary()` to synchronize high-level task and approval counters.
   - Re-fetch active view data via `loadViewData(state.currentView)` to reconcile entity lists.
4. Record diagnostic reset entry in console/diagnostics without throwing uncaught errors.

---

## 9. Polling Fallback Architecture

### 9.1 Unified Polling Coordination

Rather than implementing a second polling mechanism, Phase 3 repurposes the existing `startPolling()` and `stopPolling()` functions in `main.ts:2569–2584`:

- When `TelemetryStreamClient` enters `CONNECTED_STREAMING`, `stopPolling()` is executed immediately. No redundant REST calls occur while the real-time stream is healthy.
- When `TelemetryStreamClient` transitions to `DEGRADED_POLLING`, `startPolling()` is executed to ensure continuous visibility at the 15-second cadence.
- When stream re-connection succeeds, `stopPolling()` is invoked once more.

### 9.2 Deduplication Between REST Snapshots & SSE Events

When the client transitions from polling back to streaming, in-flight REST queries may return data concurrently with incoming SSE events.

- **Deduplication Rule**: All state collections (`tasks`, `approvals`, `agents`, `delegations`) use canonical entity IDs as unique keys.
- **Ordering Guard**: If an entity record contains an `updatedAt` timestamp or sequence indicator, an incoming event or REST snapshot item is only applied if its timestamp/state is newer than the locally held projection.

---

## 10. Canonical Event → UI State Mapping

Every canonical stream event category published by the Phase 2 backend must map deterministically to the dashboard state and views:

| Event Schema Category                 | Primary State Target                   | View Impact                              | Action / Update Semantics                                                                                                                                                         |
| :------------------------------------ | :------------------------------------- | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nexusos.events.agent.status_changed` | `state.agents`                         | Agents (`#view-agents`)                  | Locate agent by `agentId`. Update `status`, `currentLoad`, `activeTaskCount`, `lastHeartbeat`. If missing and matching workspace, insert into roster. Surgically update card DOM. |
| `nexusos.events.delegation.created`   | `state.delegations`                    | Delegations (`#view-delegations`)        | Prepend delegation summary to `state.delegations`. Update tree hierarchy and timeline view.                                                                                       |
| `nexusos.events.delegation.progress`  | `state.delegations`                    | Delegations (`#view-delegations`)        | Locate delegation node by `delegationId`. Update progress percentage and status message. Surgically update progress bar.                                                          |
| `nexusos.events.delegation.completed` | `state.delegations`                    | Delegations (`#view-delegations`)        | Update status to `COMPLETED`, record `receiptHash` and `durationMs`. Mark tree node terminal green.                                                                               |
| `nexusos.events.delegation.failed`    | `state.delegations`                    | Delegations (`#view-delegations`)        | Update status to `FAILED`, record `rejectionReason`. Mark tree node terminal red.                                                                                                 |
| `nexusos.events.delegation.cancelled` | `state.delegations`                    | Delegations (`#view-delegations`)        | Update status to `CANCELLED`, cascade visual cancellation styling to child delegation subtrees.                                                                                   |
| `nexusos.events.task.status_changed`  | `state.tasks`, `state.summary`         | Tasks (`#view-tasks`), Overview          | Update matching task's `state` and `error`. If task detail modal is open for this `taskId`, refresh modal fields dynamically.                                                     |
| `nexusos.events.approval.requested`   | `state.approvals`, `state.summary`     | Approvals (`#view-approvals`), Nav Badge | Construct `ApprovalViewModel` with `state: 'PENDING'`. Prepend to list, increment pending approval badge.                                                                         |
| `nexusos.events.approval.decided`     | `state.approvals`, `state.summary`     | Approvals (`#view-approvals`), Nav Badge | Update prompt state to `APPROVED` or `DENIED`, disable action buttons, decrement pending approval badge.                                                                          |
| `nexusos.events.graph.evolved`        | `state.graphNodes`, `state.graphEdges` | Knowledge Graph (`#view-graph`)          | Increment graph node/edge counters. If graph view is active, trigger throttled refresh (max 1/10s).                                                                               |
| `nexusos.events.telemetry.sample`     | `state.summary`                        | Overview (`#view-overview`), Header      | Update summary card metrics, refresh health badge status (`updateHealthBadge`), trigger VRAM alert if flagged.                                                                    |
| `nexusos.events.stream.reset`         | All collections                        | Global Application                       | Execute full REST reconciliation via `loadSummary()` and `loadViewData(state.currentView)`.                                                                                       |

> [!IMPORTANT] > **Zero Execution Authority (`067-SEC-07`)**: All incoming events are strictly observational. Operator approval decisions, task cancellations, and memory tombstoning must continue to execute exclusively through their existing authenticated REST endpoints (`POST /v1/approvals/:id/decision`, `POST /v1/tasks/:id/cancel`, etc.). Incoming stream events never alter cryptographic receipts or execute mutations directly.

---

## 11. Agent & Delegation Live Visualizer Design

### 11.1 Surgical DOM Updates vs. Full Re-Rendering

To prevent UI flickering, DOM thrashing, and loss of scroll position during streaming updates:

- Rendered agent cards and delegation nodes will include stable DOM data attributes: `data-agent-id="${agent.agentId}"` and `data-delegation-id="${delegation.delegationId}"`.
- When an `agent.status_changed` event arrives for an existing agent, the UI updates only the targeted DOM elements:
  - Updates text of the active task badge and load percentage.
  - Toggles CSS status classes (`.agent-pill--active`, `.agent-pill--draining`, `.agent-pill--offline`).
  - Animates the load progress bar width without rebuilding the card container.
- If an event arrives for an unseen agent, the card is rendered and prepended to `#agent-roster-grid` with a CSS fade-in animation.

### 11.2 Delegation Hierarchy & Cascade Cancellation

- The delegation tree maintains parent-child links via `parentTaskId` and `childTaskId`.
- When `delegation.cancelled` arrives, the visualizer applies a cascading cancellation style (`.delegation-node--cancelled`) to the affected node and all dependent child branches.
- Delegation depth is bounded strictly to $\le 3$ per contract constraints.

---

## 12. Telemetry UI Data Contract & Metric Truthfulness

### 12.1 Truthful Metric Mapping

Per Phase 2 contracts (`packages/contracts/src/events/stream.ts:182–193`), `telemetry.sample` genuine payload properties are:

- `tenantId: string`
- `activeTaskCount: number`
- `pendingApprovalCount: number`
- `completedTaskCount: number`
- `failedTaskCount: number`
- `connectedDeviceCount: number`
- `vramAlert?: boolean`
- `healthStatus: 'HEALTHY' | 'READY' | 'DEGRADED' | 'UNREADY'`
- `workspaceId?: string`

### 12.2 Prohibited Inventions

The UI must **not** fabricate fake gauges or charts for:

- GPU utilization percentage or clock speeds.
- VRAM allocation in gigabytes/megabytes.
- CPU percentages, memory RSS, or thread counts.
- Token generation rates or inference throughput.

**Rule**: The Overview cards will render only authentic backend telemetry metrics. If `vramAlert === true`, an alert banner will display in the header ("VRAM High Memory Watermark Warning").

---

## 13. Graph Evolution Live Updates

- `nexusos.events.graph.evolved` delivers incremental node/edge delta counts (`nodeCount`, `edgeCount`, `operationType`).
- **Visual Stability Rule**: Performing full D3/SVG graph re-layouts on every evolution event causes severe visual instability, breaks user zoom/pan coordinates, and creates heavy CPU overhead.
- **Phase 3 Behavior**:
  - Updates the node/edge summary metrics in the Graph Inspector.
  - If the user is viewing the Knowledge Graph, display a subtle notification pill: _"Graph updated (+N nodes, +M edges) — [Refresh View]"_, or trigger an automated throttled layout update at most once every 10 seconds.

---

## 14. Approval Event Integration & Stale Action Prevention

- Operator approval actions carry critical authorization authority (`Task 052` / `Task 053`).
- When `approval.requested` arrives:
  - Prepend a new card to `#approval-cards-container`.
  - Update `#approval-badge` count and animate badge appearance.
- When `approval.decided` arrives:
  - If another operator or policy engine decided the prompt, locate the open card by `promptId`.
  - Disable the "Allow" and "Deny" buttons immediately.
  - Replace action controls with a resolved label: _"Resolved: ${decision} by ${decidedBy}"_.
  - This prevents double-submission or stale approval actions without waiting for manual refresh.

---

## 15. Accessibility Implementation (WCAG 2.2 AA)

1. **Aria-Live Restraint**:
   - High-frequency telemetry updates (`telemetry.sample`, heartbeats) **must never trigger screen reader announcements**.
   - The connection indicator (`#connection-indicator`) must use `aria-live="polite"` (correcting the pre-existing `assertive` setting in `index.html:69` to prevent screen reader interruption).
2. **Critical Alerts**:
   - High-risk approval requests (`riskTier === 'CRITICAL'`) or VRAM alerts will dispatch polite announcements to an offscreen accessibility landmark (`#a11y-status`).
3. **Focus Preservation**:
   - Surgical DOM updates must never steal or reset keyboard focus. If an operator has focused an action button or task card, streaming updates to adjacent elements must preserve active element focus.
4. **Motion Preferences**:
   - All status transitions, pulse dots, and card animations must honor `@media (prefers-reduced-motion: reduce)` by disabling transitions.

---

## 16. Resource & Performance Bounds

To ensure the web dashboard can run unattended for days without memory bloat or frame drops:

| Resource Dimension          | Bound / Ceiling   | Mitigation Strategy                                                                |
| :-------------------------- | :---------------- | :--------------------------------------------------------------------------------- |
| **DOM Activity Stream**     | Max 50 rows       | Prune oldest `<tr>` elements when prepending new activity items.                   |
| **State Collections**       | Max 100 items     | Cap `state.tasks`, `state.delegations`, and `state.activity` to 100 items.         |
| **DOM Update Frequency**    | Max 60 FPS        | Coalesce rapid bursts of SSE events via `requestAnimationFrame`.                   |
| **Heartbeat Watchdog**      | 35 seconds        | Single unreferenced timer; reset on byte reception; aborted on disconnect.         |
| **Reconnect Backoff**       | Max 15 seconds    | Bounded exponential growth ($\times 1.5$ per attempt, capped at 15s).              |
| **Outbound Event Memory**   | Zero              | The client is purely a consumer; does not queue outbound telemetry.                |
| **Hidden Tab Optimization** | 0 CPU DOM updates | When `document.hidden === true`, buffer events in memory and apply upon tab focus. |

---

## 17. Security Invariants (Phase 3 Extensions)

Phase 3 adheres strictly to the canonical Task 067 security boundary:

- **`067-SEC-01` Tenant Isolation**: The client derives tenant scope exclusively from the authenticated session context. Client code never injects or overrides tenant identifiers in request parameters.
- **`067-SEC-02` Workspace Scoping**: The client passes `X-Workspace-ID` or `?workspaceId=` matching the active dashboard selection. Cross-workspace leakage is prevented server-side.
- **`067-SEC-03` Payload Bounds**: Payloads exceeding 16 KB are rejected server-side; client rejects malformed JSON frames exceeding buffer thresholds.
- **`067-SEC-04` Cursor Integrity**: Cursors must strictly conform to `STREAM_CURSOR_REGEX`. Malformed or invalid cursors trigger `stream.reset` and REST reconciliation.
- **`067-SEC-05` Resource Limits**: Bounded collections on the client prevent browser memory leaks; double-bounded server queues prevent backpressure bloat.
- **`067-SEC-06` Deterministic Teardown**: Aborting the client stream terminates the server connection, clears server and client timers, and unregisters bus subscriptions.
- **`067-SEC-07` Observational Boundary**: The SSE stream is strictly read-only. No execution, lease granting, or approval authority is conferred via stream frames.
- **`067-SEC-08` Secret Containment**: Bearer tokens are kept in closure memory (`_authToken`), never persisted to `localStorage` or URL query parameters (`053-SEC-05`). All incoming string properties are passed through `sanitizeHTML()` before DOM insertion (`053-SEC-04`).
- **`067-SEC-09` Stale Sequence Rejection**: Incoming events with `sequence_number <= lastDeliveredSeq` within the same epoch are discarded as duplicates.
- **`067-SEC-10` Ephemeral Cursor Scoping**: Cursors are stored only in memory during the active session. They are destroyed on tab close to prevent cross-session contamination.
- **`067-SEC-11` Non-Optimistic Governance**: Approval decisions and task cancellations remain pending until the authoritative REST API returns a signed receipt.

---

## 18. Comprehensive Test Strategy

The Phase 3 implementation will be verified through targeted unit tests, integration tests, and full monorepo quality gates:

### 18.1 Client Unit Tests (`apps/web-dashboard/tests/`)

1. **SSE Frame Parser Tests**:
   - Correct parsing of multiline `data:` blocks.
   - Parsing of `event:`, `id:`, and trailing `\n\n`.
   - Handling of partial chunks split across read buffers.
   - Recognition and discarding of `: ping` comment frames without invoking event callbacks.
2. **Reconnection State Machine Tests**:
   - Successful transition: `CONNECTING` → `CONNECTED_STREAMING`.
   - Backoff delay computation and jitter validation across 5 consecutive failures.
   - Transition to `DEGRADED_POLLING` upon 429 status or max retries exceeded.
   - Immediate abort and transition to `OFFLINE` on 401 Unauthorized.
3. **Cursor & Reset Tests**:
   - Monotonic advancement of `currentCursor`.
   - Ingestion of `nexusos.events.stream.reset` triggering full REST reconciliation.
   - Duplicate sequence suppression.
4. **Heartbeat Watchdog Tests**:
   - Triggering abort when no frame arrives within the watchdog window.
   - Resetting watchdog timer upon receipt of comment ping.

### 18.2 End-to-End Vertical Slice Tests (`tests/vertical-slice/`)

1. **Live Dashboard Telemetry Integration**:
   - Boot `BackendApp` with HTTP server.
   - Connect `TelemetryStreamClient` with valid bearer token.
   - Publish `task.status_changed`, `delegation.created`, and `agent.status_changed` events via subsystem controllers.
   - Assert client receives and applies events in deterministic order.
2. **Resilience & Polling Failover**:
   - Terminate backend server; assert client transitions to `RECONNECTING` and then `DEGRADED_POLLING`.
   - Restart backend server; assert client re-establishes SSE stream, receives replay buffer events, and suspends polling.

---

## 19. Dependency & Architecture Verification

- **Current Dashboard Dependencies**:
  - `dependencies`: `@nexusos/contracts: workspace:*`, `zod: 3.24.2`
  - `devDependencies`: `@types/node: 24.0.0`, `typescript: 5.7.3`
- **Phase 3 Requirement**: **ZERO new runtime dependencies**.
  - All streaming, decoding, abort, and reconnection logic will be implemented using standard browser primitives (`fetch`, `ReadableStream`, `TextDecoder`, `AbortController`).
  - No external state management libraries (Redux, Zustand) or transport wrappers (RxJS, Socket.io) are permitted.

---

## 20. Concrete Phase 3 Implementation Plan

The implementation of Phase 3 will proceed in 4 strictly sequenced steps:

```
+-------------------------------------------------------------------------------+
| Step 1: TelemetryStreamClient Module                                          |
| File: apps/web-dashboard/src/api/stream-client.ts                             |
| - Fetch streaming reader + TextDecoder SSE parser                             |
| - Heartbeat watchdog timer (35s)                                              |
| - Reconnection state machine (CONNECTING, CONNECTED, RECONNECTING, DEGRADED)   |
| - Cursor management & stream.reset dispatch                                  |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Step 2: Dashboard API Client & State Machine Integration                      |
| Files: apps/web-dashboard/src/api/client.ts, apps/web-dashboard/src/main.ts   |
| - Bind TelemetryStreamClient to DashboardAPIClient config                     |
| - Wire connection indicator (#connection-indicator) to state machine          |
| - Coordinate polling fallback: suspend on streaming, resume on degraded       |
| - Connect stream in init() after initial REST load                            |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Step 3: Event → UI State Dispatchers & Surgical DOM Updaters                  |
| File: apps/web-dashboard/src/main.ts                                          |
| - agent.status_changed -> updateAgentCardDOM()                                |
| - delegation.* -> updateDelegationTreeDOM() / timeline                         |
| - task.status_changed -> updateTaskItemDOM() / modal                          |
| - approval.* -> updateApprovalCardsDOM() / badge                              |
| - telemetry.sample -> updateSummaryCardsDOM() / health badge                  |
| - requestAnimationFrame event coalescing                                      |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Step 4: Verification, Hardening & Quality Gates                               |
| Files: apps/web-dashboard/tests/, tests/vertical-slice/                       |
| - Unit tests for stream-client (parser, watchdog, state machine)              |
| - Vertical slice tests for client <-> backend integration                     |
| - Full monorepo gates: build, typecheck, lint, format:check, validate, test   |
+-------------------------------------------------------------------------------+
```

---

## 21. Strict Non-Goals

The following areas are strictly outside the boundary of Task 067 Phase 3:

1. **No WebSockets**: The architecture is anchored on HTTP SSE (`text/event-stream`); no WebSocket upgrades or fallback endpoints.
2. **No Third-Party Frameworks**: No React, Vue, Svelte, TailwindCSS, or external state managers.
3. **No Distributed Brokers**: No Redis, Kafka, or RabbitMQ integration.
4. **No Client-Side Execution Authority**: SSE remains strictly read-only; no client-side lease issuance or direct approval settlements.
5. **No Memory/Graph Write Engines**: No modification of Task 066 graph evolution authority or persistent memory indexing.
6. **No Backend Bus Redesign**: The Phase 1 and Phase 2 backend contracts and bus implementations remain untouched.

---

## 22. Risks & Mitigations

| Identified Risk                                 | Severity | Mitigation Strategy                                                                                                               |
| :---------------------------------------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **1. Silent Network Drops (Half-Open Sockets)** | Medium   | 35-second heartbeat watchdog timer aborts hung fetch streams when `: ping\n\n` comments cease.                                    |
| **2. High-Frequency DOM Thrashing**             | High     | Buffer incoming stream events in a micro-task queue and flush to DOM using `requestAnimationFrame` (capped at 60 FPS).            |
| **3. Memory Growth in Long-Running Tabs**       | Medium   | Cap activity rows to 50, collections to 100 items, and unregister all timers when `document.hidden === true`.                     |
| **4. Stale Approval Race Condition**            | High     | Instantly disable action buttons on open approval cards upon receiving `approval.decided`; server validates cryptographic nonces. |
| **5. Cross-Tenant Token Leakage**               | Critical | Tokens stored strictly in closure memory (`_authToken`); cursors kept in memory; zero storage in `localStorage` or URLs.          |
| **6. Reconnect Stampedes on Server Reboot**     | Medium   | Exponential backoff with $\pm 20\%$ randomized jitter distributes re-connection spikes across time.                               |

---

## 23. Summary & Conclusion

Task 067 Phase 3 connects the production-grade Phase 2 backend SSE streaming infrastructure (`GET /v1/telemetry/stream`) to the Task 063 Web Dashboard. By employing a lightweight native fetch-based streaming reader, the dashboard achieves real-time observability for agent status, delegation cascades, and task lifecycles with zero new dependencies, strict adherence to `053-SEC-05` authentication boundaries, and automatic, seamless failover to polling when degraded.
