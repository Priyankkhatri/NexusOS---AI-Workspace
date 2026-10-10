# TASK 068 PHASE 4B DISCOVERY REPORT

## Safe Task Cancellation UX & Operator Controls

**Author:** NexusOS Platform Engineering  
**Task Identifier:** Task 068 / Phase 4B (Discovery Only)  
**Baseline Commit:** `1f1fa1893d61176a801588bfefac005b38e9e148`  
**CI Baseline:** GitHub Actions Run `38040931391` — GREEN (1,605 tests passing, 0 failures)  
**Status:** DISCOVERY ONLY (Zero implementation changes; zero test changes)

---

## 1. Executive Summary

This discovery report provides the technical investigation, security verification, and UX architecture for **Task 068 Phase 4B**: _Safe Task Cancellation UX_.

Following the completion of Phase 4A (which established read-only task inspection via `<dialog id="task-detail-modal">`), Phase 4B investigates whether the existing backend task cancellation endpoint (`POST /v1/tasks/:id/cancel`) can be safely surfaced to operators in the Vanilla TypeScript web dashboard without altering backend semantics or violating system invariants.

### Key Discovery Findings:

1. **Existing End-to-End API Route [FACT]:** An authenticated cancellation endpoint already exists at `POST /v1/tasks/:id/cancel` in `services/backend/src/server/app.ts` (lines 428–458), backed by `TaskController.cancelTask()` in `services/backend/src/tasks/controller.ts` (lines 1254–1312) and exposed via `DashboardAPIClient.cancelTask()` in `apps/web-dashboard/src/api/client.ts` (lines 254–259).
2. **Logical vs. Physical Cancellation [FACT]:** Cancellation in NexusOS is **strictly logical**. It transitions the task's state in persistence to `CANCELLED`, records the cancellation reason, and publishes `nexusos.events.task.canceled` and `task.status_changed`. It does **NOT** propagate an abort signal or cancellation token to running workers, agent executors, or the Desktop Agent. However, security invariant `047-SEC-10` guarantees that late execution receipts from running workers are rejected, preventing resurrection of cancelled tasks.
3. **State Precondition Matrix [FACT]:** Cancellation is valid for 6 non-terminal states: `SUBMITTED`, `POLICY_EVALUATED`, `LEASED`, `DISPATCHED`, `EXECUTING`, and `AWAITING_APPROVAL`. The endpoint is idempotent for already `CANCELLED` tasks (returns HTTP 200). It throws an error for `COMPLETED`, `FAILED`, and crucially `RECEIPT_VERIFIED` (which has no valid transition to `CANCELLED` in `TaskStateMachine`).
4. **Security & Tenant Isolation [FACT]:** Strict server-side authentication and tenant isolation are enforced. Cross-tenant cancellation probes return a non-disclosing HTTP 404 (`TASK_NOT_FOUND`). Client-side button state confers zero authorization.
5. **REST & SSE Reconciliation [FACT]:** The Task 067 SSE telemetry infrastructure (`TelemetryStreamClient`) and `main.ts` event pipeline already project `task.status_changed` events and deduplicate event IDs. A REST-initiated cancellation immediately updates local state, converging cleanly with asynchronous SSE delivery.
6. **Readiness Decision [FACT]:** **Decision A** — The existing cancellation endpoint is sufficient for Phase 4B UI implementation. No backend modifications are required.

---

## 2. Authoritative Sources

The following files and contracts serve as the authoritative sources of truth for Task 068 Phase 4B:

- **Backend API Routes & Request Handling:** `services/backend/src/server/app.ts` (lines 266–336, 428–458). **[FACT]**
- **Task Execution & Mutation Authority:** `services/backend/src/tasks/controller.ts` (lines 439–450, 1254–1312, 1314–1335, 1430–1440). **[FACT]**
- **Task Lifecycle State Machine:** `services/backend/src/tasks/state-machine.ts` (lines 14–101). **[FACT]**
- **ACP Dispatch & Agent Relay Boundary:** `services/backend/src/server/acp-dispatch-bridge.ts` (lines 17–128). **[FACT]**
- **Canonical Task Contracts & Enums:** `packages/contracts/src/tasks/index.ts` (lines 14–28, 275–307). **[FACT]**
- **Canonical Event Contracts:** `packages/contracts/src/events/schemas.ts`. **[FACT]**
- **Dashboard API Helper Client:** `apps/web-dashboard/src/api/client.ts` (lines 163–209, 252–259). **[FACT]**
- **Dashboard Application State & Phase 4A Inspection:** `apps/web-dashboard/src/main.ts` (lines 128–174, 408–428, 462–525, 835–867, 1497–1670). **[FACT]**
- **Task 067 SSE Client:** `apps/web-dashboard/src/telemetry-stream-client.ts` (lines 34–150). **[FACT]**
- **Dashboard Markup:** `apps/web-dashboard/index.html` (lines 509–538). **[FACT]**
- **Prior Discovery & Hardening Findings:** `docs/task_068_discovery_report.md` (lines 44–79, 438–461, 498–505). **[FACT]**

---

## 3. Existing Cancellation API Contract

### 3.1 Endpoint Specification

- **HTTP Method:** `POST`
- **Route Path:** `/v1/tasks/:id/cancel` (matched via regex `/^\/v1\/tasks\/([^/]+)\/cancel$/` in `app.ts` line 429).
- **Authentication:** Mandatory Bearer token authenticated by `this.authenticator` (`app.ts` lines 268–272). Request must have an associated `authContext` containing `principal` and `tenantId` (`app.ts` lines 313–320).
- **Request Body:** Optional JSON payload: `{ reason?: string }` parsed via `this.readJsonBody(req)` (`app.ts` line 432). If omitted or empty, `reason` defaults to `'User cancellation requested.'` (`controller.ts` line 1286).
- **Response Status & Shape:** `200 OK` on success, returning serialized `TaskRecord`:
  ```json
  {
    "taskId": "UUID",
    "tenantId": "tenant-id",
    "submittedBy": "user-id",
    "title": "Task title",
    "targetAgentId": "agent-id",
    "capabilityId": "capability-id",
    "runtimeCategory": "category",
    "parameters": {},
    "requestedScope": "scope",
    "state": "CANCELLED",
    "error": {
      "code": "TASK_CANCELLED",
      "message": "User cancellation requested."
    },
    "createdAt": "2026-10-10T00:00:00.000Z",
    "updatedAt": "2026-10-10T00:01:00.000Z"
  }
  ```

### 3.2 Error Responses & HTTP Statuses

| Condition                                                 | HTTP Status                 | Response Error Code           | Response Message / Body                                                 | Source Reference                              |
| :-------------------------------------------------------- | :-------------------------- | :---------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------- |
| Missing / invalid authentication                          | `401 Unauthorized`          | `UNAUTHENTICATED`             | "Authentication credentials are required for task operations."          | `app.ts` lines 315–334                        |
| Task Controller not configured                            | `503 Service Unavailable`   | `TASK_CONTROLLER_UNAVAILABLE` | "TaskController is not configured."                                     | `app.ts` lines 298–310                        |
| Cross-tenant probe (`task.tenantId !== context.tenantId`) | `404 Not Found`             | `TASK_NOT_FOUND`              | `Task ${taskId} not found.` (non-disclosing)                            | `app.ts` lines 441–455                        |
| Task not found in tenant (`getTask` returns null)         | `500 Internal Server Error` | `INTERNAL_SERVER_ERROR`       | `Task '${taskId}' not found.`                                           | `controller.ts` line 1265, `app.ts` line 934  |
| Task already `COMPLETED`                                  | `500 Internal Server Error` | `INTERNAL_SERVER_ERROR`       | `Cannot cancel task '${taskId}': task is already COMPLETED.`            | `controller.ts` line 1274, `app.ts` line 934  |
| Task already `FAILED`                                     | `500 Internal Server Error` | `INTERNAL_SERVER_ERROR`       | `Cannot cancel task '${taskId}': task has already FAILED.`              | `controller.ts` line 1277, `app.ts` line 934  |
| Task in `RECEIPT_VERIFIED`                                | `500 Internal Server Error` | `INTERNAL_SERVER_ERROR`       | `Illegal task state transition from 'RECEIPT_VERIFIED' to 'CANCELLED'.` | `state-machine.ts` line 77, `app.ts` line 934 |

> **[FACT]**: The backend route catches `err.message.includes('different tenant')` specifically to return `404 Not Found`. Any other error thrown by `TaskController.cancelTask()` or `TaskStateMachine.transition()` bubbles up to `handleServerError()`, resulting in `500 Internal Server Error`. The dashboard must handle both 404 and 500 error envelopes gracefully.

### 3.3 Client SDK Wrapper

`DashboardAPIClient` in `apps/web-dashboard/src/api/client.ts` (lines 254–259) provides:

```typescript
async cancelTask(taskId: string, reason?: string): Promise<TaskItemResponse> {
  return this.request<TaskItemResponse>(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
```

This method injects Bearer auth, sets `X-Request-ID` and `X-Correlation-ID`, handles non-2xx responses by throwing `DashboardAPIError`, and parses the JSON response.

---

## 4. Cancellation Execution Semantics

Tracing cancellation through the execution layer, agent dispatch, and runtime reveals what cancellation actually guarantees:

1. **Does cancellation merely update the task's logical status?**  
   **YES [FACT]**: `TaskController.cancelTask()` only updates `this.tasks.set(taskId, updatedTask)` in the in-memory map and emits telemetry events.
2. **Does it signal a cancellation token, abort controller, worker, agent, or executor?**  
   **NO [FACT]**: `TaskController` holds no references to `AbortController`, cancellation tokens, or worker processes. `ACPDispatchBridge` (`services/backend/src/server/acp-dispatch-bridge.ts`) has only `dispatchTask` and `dispatchWorkflow` methods; it exposes zero cancellation methods.
3. **Is cancellation propagated to delegated work?**  
   **NO [FACT]**: While `DelegationCoordinator.cancelDelegation()` exists in `services/backend/src/delegation/` for multi-agent delegation trees, `TaskController.cancelTask()` does **not** invoke it.
4. **Does the executing operation cooperate with cancellation?**  
   **NO [FACT]**: An active worker or LLM agent cannot inspect task cancellation in the control plane during its execution loop.
5. **Can external side effects continue after the task is marked canceled?**  
   **YES [FACT]**: Because physical execution is not forcibly aborted, an external script, tool execution, or container process launched by an agent may continue until natural completion or timeout.
6. **Can a cancellation request be accepted while the task is already completing?**  
   **YES [FACT]**: If the task is in `EXECUTING`, cancellation is accepted immediately.
7. **What happens if cancellation races with success or failure?**  
   **[FACT]**:
   - If cancellation commits first: The task becomes `CANCELLED`. When the worker later posts a completion receipt via `POST /v1/tasks/:id/receipt` (`settleReceipt()`), lines 1327 and 1432 throw:
     `Cannot settle receipt for task '${task.taskId}': task is already CANCELLED.`
     The task remains `CANCELLED` and cannot be resurrected to `COMPLETED` (Security Invariant `047-SEC-10`).
   - If receipt commits first: The task becomes `COMPLETED` or `FAILED`. A subsequent cancellation request throws `Cannot cancel task: task is already COMPLETED / FAILED.` and fails with 500.
8. **Can a canceled task transition back into execution?**  
   **NO [FACT]**: `CANCELLED` is a terminal state with zero outgoing transitions (`state-machine.ts` line 57).
9. **Is cancellation terminal?**  
   **YES [FACT]**: `TaskStateMachine.isTerminal(CANCELLED)` evaluates to `true`.
10. **Does cancellation guarantee cleanup or rollback?**  
    **NO [FACT]**: No compensation, undo, or rollback transactions are triggered upon task cancellation.
11. **What happens when the process stops or crashes during cancellation?**  
    **[FACT/INFERENCE]**: In-memory task state is lost unless persisted. If the cancellation transition completed, the task remains `CANCELLED`.
12. **Is there a distinct cancellation-requested state, acknowledgement, or completion receipt?**  
    **NO [FACT]**: The task transitions atomically from its current state directly to `CANCELLED`. There is no intermediate `CANCELLING` or `CANCELLATION_REQUESTED` state.

### Explicit Conceptual Separation

- **Cancellation Requested:** Operator confirms the action in the UI; HTTP request sent.
- **Cancellation Accepted:** Server validates authentication, tenant, and state machine; commits state `CANCELLED`.
- **Task State Changed:** Controller persists `CANCELLED` state and emits `task.status_changed`.
- **Execution Acknowledged:** _Does not exist in NexusOS._
- **External Effects Stopped / Compensated:** _Not guaranteed by the platform._

> **[IMPORTANT] UX Consequence**: The dashboard UI must NOT state "Task execution stopped". The UI must state "Task marked as cancelled in control plane" and clarify that in-flight operations will be discarded upon completion.

---

## 5. Canonical State Preconditions

`TaskLifecycleState` defines 10 canonical states in `packages/contracts/src/tasks/index.ts`. The behavior of `POST /v1/tasks/:id/cancel` across every state is as follows:

| Current State       | Cancel Endpoint Accepts?      | State Transition                                        | Execution Interruption Guaranteed?                                     | Source Evidence                |
| :------------------ | :---------------------------- | :------------------------------------------------------ | :--------------------------------------------------------------------- | :----------------------------- |
| `SUBMITTED`         | ✅ Yes (`200 OK`)             | `SUBMITTED` → `CANCELLED`                               | N/A (not yet executing)                                                | `state-machine.ts` line 22     |
| `POLICY_EVALUATED`  | ✅ Yes (`200 OK`)             | `POLICY_EVALUATED` → `CANCELLED`                        | N/A (not yet dispatched)                                               | `state-machine.ts` line 27     |
| `LEASED`            | ✅ Yes (`200 OK`)             | `LEASED` → `CANCELLED`                                  | ❌ No (lease not recalled; receipt rejected per `047-SEC-10`)          | `state-machine.ts` line 32     |
| `DISPATCHED`        | ✅ Yes (`200 OK`)             | `DISPATCHED` → `CANCELLED`                              | ❌ No (envelope in transit; late receipt rejected per `047-SEC-10`)    | `state-machine.ts` line 38     |
| `EXECUTING`         | ✅ Yes (`200 OK`)             | `EXECUTING` → `CANCELLED`                               | ❌ No (worker runs until done; late receipt rejected per `047-SEC-10`) | `state-machine.ts` line 44     |
| `AWAITING_APPROVAL` | ✅ Yes (`200 OK`)             | `AWAITING_APPROVAL` → `CANCELLED`                       | N/A (execution blocked; pending approval prompt not cancelled)         | `state-machine.ts` line 49     |
| `RECEIPT_VERIFIED`  | ❌ No (`500 Error`)           | **Illegal Transition** (Throws `TaskStateMachineError`) | ❌ No (execution finished)                                             | `state-machine.ts` lines 51–54 |
| `COMPLETED`         | ❌ No (`500 Error`)           | **Terminal** (Throws `Cannot cancel: COMPLETED`)        | N/A (already terminal)                                                 | `controller.ts` line 1274      |
| `FAILED`            | ❌ No (`500 Error`)           | **Terminal** (Throws `Cannot cancel: FAILED`)           | N/A (already terminal)                                                 | `controller.ts` line 1277      |
| `CANCELLED`         | ✅ Yes (`200 OK`, idempotent) | None (`task` returned unchanged)                        | N/A (already terminal)                                                 | `controller.ts` line 1280      |

### Critical Discovery: `RECEIPT_VERIFIED` State Guard

> **[FACT]**: `TaskStateMachine.ALLOWED_TRANSITIONS[RECEIPT_VERIFIED]` contains ONLY `COMPLETED` and `FAILED`.
> Attempting to cancel a task in `RECEIPT_VERIFIED` causes `TaskStateMachine.transition()` to throw `TaskStateMachineError`.
> **Rule for Dashboard UI:** A task is cancellable if and only if its state is one of:
> `SUBMITTED`, `POLICY_EVALUATED`, `LEASED`, `DISPATCHED`, `EXECUTING`, `AWAITING_APPROVAL`.
> If a task is in `RECEIPT_VERIFIED`, `COMPLETED`, `FAILED`, or `CANCELLED`, the "Cancel Task" button MUST be hidden or disabled.

---

## 6. Authentication and Authorization

### 6.1 Server-Side Enforcement

- **Authentication:** `services/backend/src/server/app.ts` (lines 268–272, 313–335) verifies the Bearer token via `this.authenticator(req, res)` and extracts `authContext`. Unauthenticated requests receive `401 Unauthorized` with `APIErrorResponseSchema`.
- **Tenant Isolation:** `services/backend/src/tasks/controller.ts` lines 1269–1271 checks `task.tenantId !== context.tenantId`. If mismatched, it throws `Access denied: task '${taskId}' belongs to a different tenant.`.
- **Non-Disclosing 404:** `services/backend/src/server/app.ts` lines 440–455 intercepts this message and returns `404 Not Found` with `{ code: 'TASK_NOT_FOUND', message: 'Task ${taskId} not found.' }`. Cross-tenant probes cannot infer task existence or state.
- **Ordering:** Authentication → Context extraction → Task retrieval → Tenant match check → State machine precondition check → Mutation → Persistence → Event broadcast.

### 6.2 Security Invariants

- **068-CANCEL-SEC-01 (Tenant Boundary):** A caller cannot cancel a task outside their authorized tenant (returns non-disclosing 404).
- **068-CANCEL-SEC-02 (Workspace Scope):** Workspace-scoped authorization cannot be bypassed by supplying a task ID.
- **068-CANCEL-SEC-03 (No Client Trust):** Client-side button visibility or DOM attributes are never treated as authorization; server-side enforcement is authoritative.
- **068-CANCEL-SEC-04 (State Transition Integrity):** Invalid transitions (`COMPLETED → CANCELLED`, `FAILED → CANCELLED`, `RECEIPT_VERIFIED → CANCELLED`) are strictly rejected by the backend even if UI state is stale.
- **068-CANCEL-SEC-05 (Idempotency Guard):** Repeated or concurrent cancellation requests cannot produce an unsafe transition. An already `CANCELLED` task returns 200 OK with the existing record.
- **068-CANCEL-SEC-06 (Receipt Immunity / 047-SEC-10):** Late execution receipts submitted after task cancellation are rejected and cannot resurrect a `CANCELLED` task to `COMPLETED`.

---

## 7. Audit and Event Behavior

### 7.1 Lifecycle Events

When `TaskController.cancelTask()` succeeds, two distinct events are published:

1. **`nexusos.events.task.canceled` (Audit Envelope)**:
   - Schema: `nexusos.events.task.canceled` v1.0.0
   - Producer: `control-plane-backend`
   - Payload: `{ taskId: string, reason: string, tenantId: string }`
   - Published via: `this.eventPublisher.publish()` (`controller.ts` lines 1290–1304)
2. **`nexusos.events.task.status_changed` (Telemetry Stream Event)**:
   - Schema: `nexusos.events.task.status_changed`
   - Payload: `{ taskId: string, tenantId: string, state: 'CANCELLED', previousState: string, error: { code: 'TASK_CANCELLED', message: string } }`
   - Published via: `this.publishTaskStatusChanged()` to `TenantStreamEventBus` (`controller.ts` lines 1306–1309)

### 7.2 Persistence Timing

- The in-memory task map is updated (`this.tasks.set(taskId, updatedTask)`) **prior** to event emission.
- If event emission throws, the task record is already `CANCELLED` in memory.
- There is no need for a new event type or separate audit subsystem for Phase 4B.

---

## 8. Task 067 SSE Integration

The web dashboard uses `TelemetryStreamClient` (`apps/web-dashboard/src/telemetry-stream-client.ts`) and event handlers in `apps/web-dashboard/src/main.ts`.

### 8.1 Event Routing & Projection

- When `task.status_changed` arrives over SSE, `getStateEventKey(event)` (`main.ts` line 416) assigns the key `task:${event.payload.taskId}`.
- `enqueueTelemetryEvent(event)`:
  1. Checks `markAndCheckSeenEvent(event.event_id)` for deduplication.
  2. Updates live freshness timestamp via `recordLiveEventSuccess()`.
  3. Queues event for microtask/rAF batch processing via `scheduleFlush()`.
- `projectTaskStatusChanged()` (`main.ts` lines 835–867):
  1. Updates the item in `state.tasks`.
  2. Updates `.task-row[data-task-id="..."] .status-badge` in the DOM table.
  3. If `state.openTaskId === payload.taskId`, updates `#task-detail-content .status-badge`.

### 8.2 Phase 4B Extension Point

In `projectTaskStatusChanged()`, Phase 4B will also update the cancellation controls in the open modal if `state.openTaskId === payload.taskId`:

- If the new state is terminal (`COMPLETED`, `FAILED`, `CANCELLED`) or `RECEIPT_VERIFIED`, the "Cancel Task" button must transition to disabled or hidden, and any open confirmation dialog must automatically dismiss with an explanatory notice.

---

## 9. Race and Concurrency Analysis

| Scenario                                             | Race / Condition                                              | Safe UI Expected Behavior                                                                                                                                                 | Authoritative Authority                              |
| :--------------------------------------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------- |
| **A. REST succeeds; SSE arrives later**              | REST completes in 100ms; SSE arrives in 500ms                 | REST response updates modal and table immediately to `CANCELLED`. When SSE arrives, state matches; update is a no-op.                                                     | REST response (authoritative synchronous receipt)    |
| **B. SSE arrives before REST response**              | SSE stream delivers `status_changed` while fetch is in flight | SSE handler updates modal badge to `CANCELLED`. When REST response resolves, state remains `CANCELLED`.                                                                   | SSE projection & REST convergence                    |
| **C. REST request times out (uncertain outcome)**    | Network drop; fetch throws `AbortError` / timeout             | UI displays an uncertain banner: _"Cancellation requested, awaiting server confirmation..."_ with a Refresh button. UI does NOT claim success or failure.                 | Subsequent SSE event or explicit GET `/v1/tasks/:id` |
| **D. Task completes while confirmation dialog open** | Operator reading confirmation; worker completes               | SSE `status_changed` (`COMPLETED`) updates modal badge. Confirmation dialog disables "Confirm" button and shows: _"Task has completed."_                                  | SSE stream event                                     |
| **E. Another tab cancels same task**                 | Tab B cancels while Tab A views task                          | SSE `status_changed` (`CANCELLED`) updates Tab A modal. Cancel button is hidden/disabled; toast informs: _"Task cancelled by another operator."_                          | SSE stream event                                     |
| **F. Concurrent duplicate cancel clicks**            | Double-clicking "Confirm Cancellation"                        | First click disables button immediately (`aria-disabled="true"`, loading spinner). If two requests reach backend, line 1280 handles second idempotently (returns 200 OK). | Client debouncing + server line 1280                 |
| **G. Stream reset while cancellation pending**       | SSE reconnect triggers reset reconciliation                   | Reconcile generation guard protects state. Active REST mutation resolves independently.                                                                                   | Generation counter in `main.ts`                      |
| **H. Dashboard in degraded polling mode**            | SSE unavailable; fallback polling active                      | REST mutation executes normally. Polling cycle (`loadTasks()`) refreshes state within interval.                                                                           | REST HTTP transport                                  |
| **I. SSE connection lost during cancellation**       | Network severed during action                                 | REST call completes or fails independently of SSE. Client reconnects with cursor once network returns.                                                                    | HTTP fetch independence                              |
| **J. Stale task detail view open**                   | Task completed on server 5 mins ago; UI was paused            | Operator clicks Cancel; backend returns 500 (`Cannot cancel: task is already COMPLETED`). UI shows error alert and refreshes task via `GET /v1/tasks/:id`.                | Backend state machine                                |

---

## 10. Phase 4A Integration

### 10.1 Existing Phase 4A Mechanics

- **Modal Element:** `<dialog id="task-detail-modal" class="modal task-detail-modal" aria-labelledby="task-detail-title">` (`index.html` lines 511–538).
- **State Property:** `state.openTaskId` (`main.ts` line 130). Set on `openTaskDetail(taskId)` and cleared on modal `'close'` event (`main.ts` line 1682).
- **Render Flow:** `openTaskDetail(taskId)` fetches `TaskItemResponse` via `apiClient.getTask(taskId)` and generates HTML injected into `#task-detail-content`.
- **Close Handling:** Native `<dialog>` supports `Escape` key and click on `#task-detail-close` or backdrop. Focus is automatically managed by native `<dialog>`.

### 10.2 Smallest Safe Phase 4B Integration Point

1. **Modal Action Bar:** Inside `#task-detail-content`, below or alongside the status badge, insert an operator actions container:
   ```html
   <div class="task-detail-actions" id="task-detail-actions">
     <!-- Rendered dynamically based on task.state -->
   </div>
   ```
2. **Cancellable Eligibility Check:**
   ```typescript
   function isTaskCancellable(state: string): boolean {
     return [
       'SUBMITTED',
       'POLICY_EVALUATED',
       'LEASED',
       'DISPATCHED',
       'EXECUTING',
       'AWAITING_APPROVAL',
     ].includes(state);
   }
   ```
3. **Trigger Button:** If `isTaskCancellable(task.state)`, render:
   ```html
   <button type="button" class="btn btn--danger btn--sm" id="task-cancel-btn">Cancel Task</button>
   ```
4. **Inline Confirmation Layer:** Clicking `#task-cancel-btn` displays a nested confirmation prompt inside the dialog or an accessible sub-modal with explicit confirm/cancel buttons and an optional reason input field.

---

## 11. UX and Accessibility Requirements

### 11.1 Dialog & Confirmation Design

- **Explicit Confirmation:** A destructive action like task cancellation must never trigger immediately on a single click. A confirmation step is mandatory.
- **Wording:**
  - _Title:_ "Cancel Task Execution?"
  - _Body:_ "This will mark task **[Task ID]** as cancelled and reject subsequent execution receipts. Any active in-flight worker steps may take time to terminate."
  - _Reason Field:_ Optional text input `<input type="text" id="cancel-reason-input" placeholder="Reason for cancellation (optional)" maxlength="256">`.
  - _Action Buttons:_ "Confirm Cancellation" (`btn--danger`) and "Keep Task Running" (`btn--ghost`).
- **Duplicate-Click Prevention:** Upon clicking "Confirm Cancellation":
  - Disable both buttons (`btn.disabled = true; btn.setAttribute('aria-disabled', 'true')`).
  - Render a spinner and change label to "Cancelling...".
- **Feedback & Screen Readers:**
  - On success: Close confirmation, update status badge to `CANCELLED`, announce via `aria-live="polite"` region: _"Task [Task ID] cancelled successfully."_
  - On failure: Re-enable buttons, display clear error alert within modal: _"Failed to cancel task: [error message]"_, announce via `aria-live="assertive"`.
  - On timeout / network drop: Announce: _"Cancellation status uncertain. Please refresh to verify."_
- **Keyboard Navigation & Focus Management:**
  - Opening confirmation moves focus to the "Confirm Cancellation" or "Keep Task Running" button.
  - Pressing `Escape` while confirmation is open dismisses the confirmation _without_ cancelling the task.
  - Closing the task detail modal restores focus to the table row or trigger button that opened it.
  - Reduced-motion styles respected (no disorienting animations).

---

## 12. Existing Test Coverage

### 12.1 Existing Repository Suites Covering Cancellation

- `tests/vertical-slice/vertical-slice-security.test.ts`:
  - `047-SEC-10`: Cancelled task receipt immunity (lines 395–434).
- `tests/vertical-slice/workflow-security-invariants.test.ts`:
  - `049-SEC-03`: Tenant-isolated workflow status & cancellation (lines 412–429).
- `tests/vertical-slice/failure-injection.test.ts`:
  - Scenario 10: Late receipt settlement on a `CANCELLED` task rejected (lines 416–477).
- `tests/vertical-slice/telemetry-stream-sse.test.ts`:
  - `cancelTask` emits `task.status_changed` with accurate previous state (lines 962–972).
- `tests/hardening/dashboard-task-inspection-phase4a.test.ts`:
  - Phase 4A DOM unit testing harness using lightweight in-memory `MockElement` and `node:test`.

### 12.2 Recommended Phase 4B Test Suite

Phase 4B implementation tests should be placed in:
`tests/hardening/dashboard-task-cancellation-phase4b.test.ts`

Recommended test cases:

1. "Cancel Task" button renders only for eligible states (`SUBMITTED`, `POLICY_EVALUATED`, `LEASED`, `DISPATCHED`, `EXECUTING`, `AWAITING_APPROVAL`).
2. "Cancel Task" button does NOT render for ineligible states (`RECEIPT_VERIFIED`, `COMPLETED`, `FAILED`, `CANCELLED`).
3. Clicking "Cancel Task" opens confirmation without dispatching HTTP request.
4. Dismissing confirmation restores UI without dispatching HTTP request.
5. Confirming cancellation dispatches `POST /v1/tasks/:id/cancel` with reason.
6. Buttons are disabled with loading state during fetch to prevent double-submit.
7. Successful REST response immediately transitions modal status badge to `CANCELLED`.
8. 404 response displays "Task not found or access denied" error alert.
9. 500 response displays descriptive server error alert.
10. Network failure / timeout renders uncertain outcome state with refresh prompt.
11. Incoming SSE `task.status_changed` while confirmation is open updates UI safely.
12. Keyboard navigation: `Escape` closes confirmation first, second `Escape` closes task detail modal.

---

## 13. Gaps and Risks

| Gap / Risk                               | Severity | Description                                                                                                | Mitigation Strategy                                                                                           |
| :--------------------------------------- | :------- | :--------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **G-01: Execution Disconnect**           | MEDIUM   | Control plane cancellation does not stop active agent workers immediately.                                 | Explicit confirmation wording informing operator that cancellation is logical and late receipts are rejected. |
| **G-02: `RECEIPT_VERIFIED` State Crash** | HIGH     | `cancelTask()` on `RECEIPT_VERIFIED` throws `TaskStateMachineError` (500).                                 | Dashboard must classify `RECEIPT_VERIFIED` as strictly non-cancellable.                                       |
| **G-03: Approval Prompt Orphan**         | LOW      | Cancelling task in `AWAITING_APPROVAL` does not auto-cancel pending prompt in `ApprovalAuthorityBoundary`. | Out of scope for Phase 4B; prompt becomes inert because task cannot proceed.                                  |
| **G-04: Non-404 Errors Return 500**      | MEDIUM   | Invalid state transitions return HTTP 500 rather than HTTP 400.                                            | Dashboard must parse `error.message` from 500 envelopes and present user-friendly error banners.              |
| **G-05: Stale DOM Double-Click**         | LOW      | Rapid double clicks could fire duplicate requests.                                                         | Client-side immediate disabling of confirm button on click; server line 1280 provides idempotency fallback.   |

---

## 14. Minimum Implementation File Scope

### MUST CHANGE:

1. `apps/web-dashboard/src/main.ts`:
   - Add `isTaskCancellable(state)` helper.
   - Render "Cancel Task" button in `openTaskDetail()`.
   - Implement accessible confirmation dialog and cancellation handler.
   - Wire `apiClient.cancelTask(taskId, reason)`.
   - Update modal and table DOM state on success.
   - Add polite `aria-live` status announcements.
   - Update `projectTaskStatusChanged()` to handle open modal cancel button disabling.
2. `tests/hardening/dashboard-task-cancellation-phase4b.test.ts`:
   - Comprehensive hardening test suite covering all states, confirmation, races, errors, and accessibility.

### MAY CHANGE:

- `apps/web-dashboard/src/index.css`:
  - Styles for `.task-detail-actions`, confirmation dialog, danger buttons, and loading spinner.
- `apps/web-dashboard/index.html`:
  - Static confirmation dialog container if separate from dynamic injection.

### DO NOT CHANGE:

- `services/backend/src/server/app.ts` (Endpoint already works as intended).
- `services/backend/src/tasks/controller.ts` (Controller logic is complete).
- `services/backend/src/tasks/state-machine.ts` (State machine is authoritative and immutable).
- `apps/web-dashboard/src/api/client.ts` (`cancelTask()` is already implemented).
- `apps/web-dashboard/src/telemetry-stream-client.ts` (SSE client is closed and verified).
- `packages/contracts/` (Contracts are frozen).

---

## 15. Acceptance Matrix

| Criterion ID     | Requirement / Rule                                                                                                                             | Verification Method |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :------------------ |
| **068-4B-AC-01** | Cancel button is visible only when task state is `SUBMITTED`, `POLICY_EVALUATED`, `LEASED`, `DISPATCHED`, `EXECUTING`, or `AWAITING_APPROVAL`. | DOM unit tests      |
| **068-4B-AC-02** | Cancel button is hidden/disabled for `RECEIPT_VERIFIED`, `COMPLETED`, `FAILED`, and `CANCELLED`.                                               | DOM unit tests      |
| **068-4B-AC-03** | Clicking Cancel displays explicit confirmation prompt before any network mutation is initiated.                                                | Interaction test    |
| **068-4B-AC-04** | Operator can cancel the confirmation dialog via button or `Escape` key without modifying task state.                                           | Keyboard & DOM test |
| **068-4B-AC-05** | Confirming cancellation calls `POST /v1/tasks/:id/cancel` with optional reason.                                                                | HTTP mock test      |
| **068-4B-AC-06** | Double-click protection: button is disabled with loading state immediately upon submission.                                                    | Concurrency test    |
| **068-4B-AC-07** | Successful response immediately updates modal status badge and table row to `CANCELLED`.                                                       | State update test   |
| **068-4B-AC-08** | Server rejection (404/500) displays error alert without corrupting dashboard state.                                                            | Error handling test |
| **068-4B-AC-09** | Network timeout / abort displays uncertain outcome notice advising manual refresh.                                                             | Resilience test     |
| **068-4B-AC-10** | SSE `task.status_changed` arriving before or after REST response converges cleanly.                                                            | Race test           |
| **068-4B-AC-11** | Screen reader receives polite `aria-live` announcement upon cancellation.                                                                      | Accessibility test  |
| **068-4B-AC-12** | Zero regression across existing 1,605 monorepo tests.                                                                                          | Full CI suite run   |

---

## 16. Explicit Non-Goals

The following items are strictly out of scope for Phase 4B:

- **NO Framework Migration:** Do not introduce React, Vue, Svelte, or UI libraries.
- **NO Task State Machine Alterations:** Do not add transitions to `TaskStateMachine`.
- **NO Task Retry Implementation:** Task retry remains strictly out of scope (undefined semantics per Phase 4A discovery hardening).
- **NO Task Pause / Resume:** Pause and resume mechanisms do not exist in the backend and will not be created.
- **NO Backend Changes:** Zero changes to `services/backend/` unless a blocking security vulnerability is uncovered.
- **NO SSE Protocol Changes:** Zero modifications to `telemetry-stream-client.ts` or stream schemas.
- **NO Physical Worker Killing:** The dashboard will not fabricate or attempt out-of-band OS process termination.

---

## 17. Final Readiness Decision

### Decision: **A** — Existing cancellation endpoint is sufficient for Phase 4B UI.

**Source Evidence Supporting Decision A:**

1. **Endpoint Exists & Proven:** `POST /v1/tasks/:id/cancel` is fully implemented in `app.ts` and `TaskController.cancelTask()`, with tests passing in `vertical-slice-security.test.ts` and `failure-injection.test.ts`.
2. **Client SDK Ready:** `DashboardAPIClient.cancelTask()` is already implemented in `apps/web-dashboard/src/api/client.ts`.
3. **Security Invariants Intact:** Server strictly validates authentication and tenant isolation, enforcing `047-SEC-09`, `047-SEC-10`, and `049-SEC-03`.
4. **Idempotency Handled:** Calling cancel on an already `CANCELLED` task returns HTTP 200 safely.
5. **Phase 4A Foundation Stable:** The `<dialog id="task-detail-modal">` structure and `openTaskDetail()` in `main.ts` provide a clean, isolated host for the cancellation UX.

Phase 4B is ready for implementation following these findings.
