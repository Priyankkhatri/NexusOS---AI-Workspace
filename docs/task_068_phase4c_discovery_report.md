# NEXUSOS — TASK 068 PHASE 4C DISCOVERY REPORT

**Task:** `TASK 068: SPRINT 3 / S3-04 — WEB DASHBOARD OPERATOR CONTROLS, TASK INSPECTION & APPROVAL WORKFLOW UX`  
**Phase:** 4C — Dashboard Approval Workflow  
**Date:** 2026-11-23  
**Status:** DISCOVERY COMPLETE — READY FOR IMPLEMENTATION

---

## 1. Executive Summary

This report establishes the verified technical baseline, contract specifications, state machine invariants, security controls, and safe implementation scope for **Task 068 Phase 4C: Dashboard Approval Workflow**.

Phase 4C addresses operator human-in-the-loop (HITL) approval and rejection for tasks requiring human authorization. When policy evaluation checkpoints a high-risk capability (e.g. terminal execution, destructive filesystem changes, security modifications), the task pauses in `AWAITING_APPROVAL` and presents an approval prompt.

### Key Discovery Findings

1. **Existing Backend APIs are Production-Ready:** The backend routes `GET /v1/approvals` and `POST /v1/approvals/:id/decision` are fully implemented in `services/backend/src/server/app.ts` (lines 526–643) and `services/backend/src/tasks/controller.ts` (lines 577–701). No backend route additions, schema alterations, or database migrations are required.
2. **State Machine Semantics:**
   - **Approve (`ALLOW`):** Transitions prompt state to `APPROVED` and task state from `AWAITING_APPROVAL` to `EXECUTING`.
   - **Reject (`DENY`):** Transitions prompt state to `DENIED` and task state from `AWAITING_APPROVAL` to `FAILED` (terminal) with `error: { code: 'APPROVAL_DENIED', message: 'Human operator denied approval for task execution.' }`.
   - Both decisions generate a deterministic 64-character SHA-256 evidence receipt checksum (`computeApprovalReceiptChecksum`).
3. **Current Dashboard Limitations:**
   - While the dashboard contains an Approvals view (`#view-approvals` in `apps/web-dashboard/src/main.ts`), clicking "Approve" or "Reject" fires an immediate network mutation **without** operator confirmation, without warning of consequences, and without providing an input field for audit reason/notes (`userNotes`).
   - The Task Detail modal (`openTaskDetail()`) currently only provides cancellation controls (from Phase 4B); it does **not** expose Approve or Reject actions when inspecting a task in `AWAITING_APPROVAL`.
   - Prompt TTL expiration (default 60s) and backend error rejections (409 Conflict, 410 Expired, 400 Nonce Mismatch, 403 Tenant Mismatch) require explicit visual error handling.
4. **Implementation Scope:** Phase 4C can be completed entirely on the frontend dashboard (`apps/web-dashboard/src/main.ts` and CSS) and verified with a dedicated hardening test suite (`tests/hardening/dashboard-approval-workflow-phase4c.test.ts`).

---

## 2. Source File Citations & Exact Line References

| Component              | File Path                                     | Line Range       | Role / Description                                                                                                      |
| ---------------------- | --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Contracts**          | `packages/contracts/src/approval/index.ts`    | 1–203            | `ApprovalPromptItem`, `ApprovalDecisionRequestSchema`, `ApprovalDecisionResultSchema`, `computeApprovalReceiptChecksum` |
| **Contracts**          | `packages/contracts/src/tasks/index.ts`       | 15–25, 275–309   | `TaskLifecycleState` (including `AWAITING_APPROVAL`), `TaskRecordSchema`                                                |
| **Contracts**          | `packages/contracts/src/events/stream.ts`     | 36–37, 142–169   | `ApprovalRequestedPayloadSchema`, `ApprovalDecidedPayloadSchema`                                                        |
| **Backend Routes**     | `services/backend/src/server/app.ts`          | 526–643          | REST endpoints for `GET /v1/approvals` and `POST /v1/approvals/:id/decision`                                            |
| **Backend Controller** | `services/backend/src/tasks/controller.ts`    | 39–45, 577–701   | `listPendingApprovals()`, `submitApprovalDecision()`, task state reconciliation, audit & SSE emission                   |
| **State Machine**      | `services/backend/src/tasks/state-machine.ts` | 46–50            | `TaskStateMachine` transition rules for `AWAITING_APPROVAL`                                                             |
| **Approval Host**      | `apps/desktop-agent/src/ui/approval-host.ts`  | 304–422          | `submitDecision()`: nonce check, expiry check, lease TOCTOU re-validation, double-click protection                      |
| **Dashboard Client**   | `apps/web-dashboard/src/api/client.ts`        | 118–161, 280–302 | `getApprovals()`, `submitApprovalDecision()`, and interface types                                                       |
| **Dashboard UI**       | `apps/web-dashboard/src/main.ts`              | 881–1010         | SSE event projection: `projectApprovalRequested`, `projectApprovalDecided`                                              |
| **Dashboard UI**       | `apps/web-dashboard/src/main.ts`              | 1520–1700        | `openTaskDetail()` modal inspection and action controls                                                                 |
| **Dashboard UI**       | `apps/web-dashboard/src/main.ts`              | 1915–2125        | Approvals view: `loadApprovals()`, `renderApprovals()`, `bindApprovalActionButtons()`                                   |

---

## 3. Backend API Contract

### 3.1 Listing Pending Approvals: `GET /v1/approvals`

- **Location:** `services/backend/src/server/app.ts:526–543`
- **Authentication:** Required (`authenticateForDashboard`). Returns 401 if unauthenticated.
- **Tenant Scope:** Scoped strictly to caller's `dashAuth.tenantId` via `taskController.listPendingApprovals(tenantId)`.
- **Response Format (`200 OK`):**
  ```json
  {
    "items": [
      {
        "promptId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "requestId": "req-12345",
        "taskId": "task-67890",
        "leaseId": "lease-abcde",
        "tenantId": "tenant-corp",
        "title": "Execute Terminal Command",
        "description": "rm -rf /tmp/scratch",
        "riskTier": "HIGH",
        "actionIdentifier": "terminal.execute",
        "capabilityId": "terminal.execute",
        "nonce": "crypto-nonce-string",
        "state": "PENDING",
        "createdAt": 1700000000000,
        "expiresAt": 1700000060000,
        "isLockScreenPrivate": false
      }
    ],
    "total": 1
  }
  ```

### 3.2 Submitting Approval Decisions: `POST /v1/approvals/:id/decision`

- **Location:** `services/backend/src/server/app.ts:545–643` and `services/backend/src/tasks/controller.ts:589–701`
- **Authentication:** Required (`authenticateForDashboard`). Returns 401 if unauthenticated.
- **Path vs. Body Validation:** If body contains `promptId`, it must match path `:id`. Mismatches return `400 INVALID_INPUT`.
- **Request Body Schema (`ApprovalDecisionRequestSchema`):**
  ```typescript
  {
    promptId: string; // UUID
    decision: 'ALLOW' | 'DENY';
    nonce: string; // Cryptographic nonce matching prompt record
    leaseHeader: ExecutionLeaseHeader; // Valid execution lease header
    tenantId?: string; // Optional; if supplied, must match authenticated tenantId
    userNotes?: string; // Optional operator reason/notes (max 1024 chars)
    decidedBy?: string; // Optional; server sets to caller principal ID if omitted
  }
  ```
- **Response Format (`200 OK`):**
  ```json
  {
    "promptId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "requestId": "req-12345",
    "taskId": "task-67890",
    "decision": "ALLOW",
    "state": "APPROVED",
    "resolvedAt": 1700000010000,
    "receiptHash": "8f4675e81f5c6b6d5f75e7a5b3a4a7a8...",
    "userNotes": "Approved for routine cleanup",
    "decidedBy": "user-operator-1"
  }
  ```

### 3.3 HTTP Error Responses

The backend maps exceptions deterministically (`app.ts:602–641`):

| HTTP Status               | Error Code                                                   | Trigger Condition                                                                                            |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `400 Bad Request`         | `NONCE_MISMATCH`                                             | Submitted nonce does not match prompt record nonce.                                                          |
| `400 Bad Request`         | `INVALID_INPUT`                                              | Schema validation error or path `:id` mismatch with body `promptId`.                                         |
| `401 Unauthorized`        | `UNAUTHORIZED`                                               | Missing or invalid authentication token.                                                                     |
| `403 Forbidden`           | `TENANT_MISMATCH`                                            | `decisionReq.tenantId !== context.tenantId` (cross-tenant decision attempt).                                 |
| `404 Not Found`           | `PROMPT_NOT_FOUND`                                           | Prompt ID does not exist in approval host.                                                                   |
| `409 Conflict`            | `PROMPT_ALREADY_RESOLVED`                                    | Prompt is already in terminal state (`APPROVED`, `DENIED`, `CANCELLED`) or resolution is in flight.          |
| `410 Gone`                | `PROMPT_EXPIRED`                                             | System clock passed `expiresAt` (`Date.now() > item.expiresAt`). Prompt automatically resolves to `EXPIRED`. |
| `503 Service Unavailable` | `TASK_CONTROLLER_UNAVAILABLE` or `APPROVAL_HOST_UNAVAILABLE` | TaskController or ApprovalHost boundary is unconfigured.                                                     |

---

## 4. State Transition Invariants

### 4.1 Task Lifecycle Transitions

Defined in `services/backend/src/tasks/state-machine.ts` (lines 46–50):

```typescript
[TaskLifecycleState.AWAITING_APPROVAL]: new Set([
  TaskLifecycleState.EXECUTING,
  TaskLifecycleState.FAILED,
  TaskLifecycleState.CANCELLED,
]),
```

```
                        ┌───────────────┐
                        │   SUBMITTED   │
                        └───────┬───────┘
                                │
                                ▼
                        ┌───────────────┐
                        │POLICY_EVALUAT.│
                        └───────┬───────┘
                                │
                                ▼
                        ┌───────────────┐
                        │    LEASED     │
                        └───────┬───────┘
                                │
                                ▼
                        ┌───────────────┐
                        │  DISPATCHED   │
                        └───────┬───────┘
                                │ (High-risk capability intercepted)
                                ▼
                     ┌─────────────────────┐
                     │  AWAITING_APPROVAL  │
                     └───┬─────────────┬───┘
          Approve (ALLOW)│             │ Reject (DENY)
                         │             │
                         ▼             ▼
                 ┌───────────┐   ┌───────────┐
                 │ EXECUTING │   │  FAILED   │ (Terminal, code: APPROVAL_DENIED)
                 └───────────┘   └───────────┘
```

| Current Task State  | Operator Action  | Decision | Target Task State | Target Prompt State | Notes / Consequences                                                                   |
| ------------------- | ---------------- | -------- | ----------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `AWAITING_APPROVAL` | **Approve**      | `ALLOW`  | `EXECUTING`       | `APPROVED`          | Non-terminal. Task resumes worker execution pipeline.                                  |
| `AWAITING_APPROVAL` | **Reject**       | `DENY`   | `FAILED`          | `DENIED`            | **Terminal**. Task execution immediately halts; sets `error.code = 'APPROVAL_DENIED'`. |
| `AWAITING_APPROVAL` | **Cancel Task**  | N/A      | `CANCELLED`       | `PENDING`\*         | Handled via Phase 4B `POST /v1/tasks/:id/cancel`. (\*See Note below).                  |
| `COMPLETED`         | Approve / Reject | N/A      | _Rejected_        | N/A                 | Ineligible. Backend throws `TaskStateMachineError`.                                    |
| `FAILED`            | Approve / Reject | N/A      | _Rejected_        | N/A                 | Ineligible. Backend throws `TaskStateMachineError`.                                    |
| `CANCELLED`         | Approve / Reject | N/A      | _Rejected_        | N/A                 | Ineligible. Backend throws `TaskStateMachineError`.                                    |

> [!NOTE]
> When a task in `AWAITING_APPROVAL` is cancelled via Phase 4B, the task record transitions to `CANCELLED`. If an operator subsequently attempts to submit an approval decision on the associated prompt, the backend state reconciliation (`controller.ts:632, 641`) checks `if (task.state === TaskLifecycleState.AWAITING_APPROVAL)`. Since the task is already `CANCELLED`, the task is safely unaffected and not resurrected.

---

## 5. Security & Concurrency Analysis

### 5.1 Strict Server-Side Authorization & Isolation

- **Authentication Enforcement:** `server/app.ts:528, 548` invokes `authenticateForDashboard(req, res, context)`. Missing or malformed authentication immediately yields `401 Unauthorized`.
- **Tenant Isolation:** `controller.ts:606–610` verifies that `decisionReq.tenantId` equals `context.tenantId`. If cross-tenant prompt injection is attempted, the server rejects it with `403 TENANT_MISMATCH`.
- **Audit Logging:** Every approval decision emits a canonical event envelope `nexusos.events.approval.decision` (version 1.0.0) with tenantId, promptId, taskId, decision, and receiptHash (`controller.ts:658–674`).

### 5.2 Cryptographic Evidence & Nonce Verification

- Every approval prompt generated by `ApprovalAuthorityBoundary` has a unique cryptographic `nonce` (`apps/desktop-agent/src/ui/approval-host.ts:77`).
- `submitDecision()` verifies `item.nonce === request.nonce`. A forged or mismatched nonce triggers `400 NONCE_MISMATCH` (`approval-host.ts:328–333`).
- Upon decision resolution, `computeApprovalReceiptChecksum` calculates a deterministic SHA-256 evidence receipt combining `promptId`, `requestId`, `decision`, `resolvedAt`, `nonce`, `tenantId`, and `leaseId`.

### 5.3 Concurrency & Replay Protection

- **Single-Resolution Lock:** `approval-host.ts:325` maintains a `resolvingPrompts` set. Concurrent double-click or simultaneous API calls hit:
  ```typescript
  if (item.state !== 'PENDING' || this.resolvingPrompts.has(request.promptId)) {
    throw new UIError(
      `Approval prompt '${request.promptId}' is already resolved in state '${item.state}'`,
      'PROMPT_ALREADY_RESOLVED',
    );
  }
  ```
  This returns `409 Conflict` to the second caller, guaranteeing strictly once-only resolution.
- **TTL Expiration Auto-Settle:** Prompts specify an expiration deadline (`expiresAt`). If `Date.now() > item.expiresAt`, the approval host marks the item `EXPIRED` and throws `410 PROMPT_EXPIRED`.

### 5.4 Live SSE Race Reconciliation

- When an approval decision resolves, the backend publishes `nexusos.events.approval.decided` to the telemetry event bus (`controller.ts:678–698`).
- The dashboard projects this event via `projectApprovalDecided(payload)` (`main.ts:950–1004`), which:
  1. Finds the prompt in `state.approvals` and sets `app.state = decisionState`.
  2. Disables all action buttons (`.approval-action-btn`).
  3. Replaces status badge with `✓ Approved` or `✗ Denied`.
  4. Renders the resolved receipt hash.
  5. Updates navigation and summary badges.
- If a task status change event (`nexusos.events.task.status_changed`) arrives while an operator is inspecting an approval or has a confirmation dialog open, the modal must dynamically reconcile to remove stale action buttons.

---

## 6. Dashboard Integration Points

### 6.1 Existing Dashboard Code vs. Gaps

| Feature / Location                       | Current Implementation in `main.ts`                                                                                                                 | Discovered Gap for Phase 4C                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Approvals View (`#view-approvals`)**   | Renders cards with Approve / Reject buttons (`generateApprovalCardHTML`).                                                                           | **No confirmation step**: clicking fires network request immediately. **No reason input**: `userNotes` is never passed.               |
| **In-Flight UI Guard**                   | Sets `item.state = 'RECONCILING'`, but does not visually disable individual buttons with a spinner or "Authorizing..." state until after re-render. | Needs an explicit pending state disabling all buttons on the card during request flight.                                              |
| **Task Detail Modal (`openTaskDetail`)** | Renders task metadata and "Cancel Task" (Phase 4B).                                                                                                 | **Zero approval controls**: Does not check if task is `AWAITING_APPROVAL` or render Approve/Reject buttons in `#task-detail-actions`. |
| **Task Detail Concurrency**              | Removes cancel button on SSE transition (`projectTaskStatusChanged`).                                                                               | Does not remove or reconcile approval buttons in the modal when `approval.decided` occurs.                                            |
| **Accessibility (a11y)**                 | Polite announcement element `#task-detail-announcement` exists in task modal.                                                                       | Approvals view lacks polite `aria-live` announcement when decision resolves or errors.                                                |
| **Error Feedback**                       | Logs error to `console.error` and resets state; no visible inline error banner.                                                                     | Operators receive no visible feedback if backend returns 409, 410, 400, or network failure.                                           |

### 6.2 Data Flow Between Task Modal and Approvals

When `openTaskDetail(taskId)` is invoked for a task with `state === 'AWAITING_APPROVAL'`:

1. The modal can look up the pending approval prompt in `state.approvals` matching `a.taskId === taskId && a.state === 'PENDING'`.
2. If found, the modal can render:
   - "Approve" (`btn--primary`)
   - "Reject" (`btn--danger`)
   - "Cancel Task" (`btn--ghost` / secondary danger)
3. If clicked, an alertdialog confirmation prompt asks for operator confirmation with truthful consequence wording and an optional reason input.
4. On confirmation, `apiClient.submitApprovalDecision` is dispatched with `promptId`, `decision`, `nonce`, `leaseHeader`, and `userNotes`.

---

## 7. Existing Test Coverage & Verification Baseline

### 7.1 Existing Tests (Passing)

- **`tests/vertical-slice/approval-security-invariants.test.ts`:**
  - `052-SEC-01`: High-risk operations pause in `AWAITING_APPROVAL` until `ALLOW` is submitted.
  - `052-SEC-02`: Nonce integrity verification and fail-closed on mismatch.
  - `052-SEC-03`: Tenant and task request isolation.
  - `052-SEC-04`: Single-resolution race safety and double-click protection (409 Conflict).
  - `052-SEC-05`: Expiration fail-closed (410 Expired).
  - `052-SEC-06`: Receipt checksum and evidence integrity.
- **`tests/vertical-slice/dashboard-security-invariants.test.ts`:**
  - `053-HITL A`: GET `/v1/approvals` surfaces pending prompts.
  - `053-HITL B & C`: POST `/v1/approvals/:id/decision` with `ALLOW` transitions task to `EXECUTING`.
  - `053-HITL D`: Replayed decision returns 409 `PROMPT_ALREADY_RESOLVED`.
  - `053-HITL E`: Nonce mismatch returns 400 `NONCE_MISMATCH`.
  - `053-HITL F`: Expired prompt returns 410 `PROMPT_EXPIRED`.
  - `053-HITL G`: POST `/v1/approvals/:id/decision` with `DENY` transitions task to `FAILED` with `APPROVAL_DENIED`.
- **`tests/hardening/dashboard-event-projection-phase3b.test.ts`:**
  - Test 10: `approval.requested` creates/prepends card and increments badge.
  - Test 11: `approval.decided` disables buttons and displays decision and receipt.
  - Test 12: Approval badge never becomes negative.

### 7.2 Missing Test Coverage (To be created in Phase 4C)

A dedicated hardening suite `tests/hardening/dashboard-approval-workflow-phase4c.test.ts` is required to cover:

1. **Approval UI Visibility:**
   - Presence of Approve/Reject action controls in both Approvals card and Task Detail modal when state is `AWAITING_APPROVAL`.
   - Absence of Approve/Reject action controls when task is in non-approval states (`SUBMITTED`, `EXECUTING`, `COMPLETED`, `FAILED`, `CANCELLED`).
2. **Confirmation & Truthful Copy:**
   - Explicit confirmation dialog triggered before any network mutation for both Approve and Reject.
   - Truthful warning copy for Approve (resumes active execution) and Reject (permanent terminal failure).
   - Abort/dismissal restores trigger buttons without submitting requests.
3. **Reason / Notes Capture:**
   - Optional `userNotes` captured from input field and passed to `apiClient.submitApprovalDecision`.
   - Empty/whitespace notes omitted or trimmed cleanly.
4. **Duplicate Submission Guards:**
   - Prevention of concurrent clicks while an approval or rejection request is in-flight.
   - Truthful pending state ("Approving...", "Rejecting...", disabled buttons).
5. **Successful State Updates:**
   - `ALLOW` decision updates badge to `Approved` / `Executing` and clears approval prompts.
   - `DENY` decision updates badge to `Denied` / `Failed` with `APPROVAL_DENIED` code.
6. **Error Resilience:**
   - Handling 409 `PROMPT_ALREADY_RESOLVED`: updates UI to authoritative state without crashing.
   - Handling 410 `PROMPT_EXPIRED`: displays expired status and disables controls.
   - Handling 400 `NONCE_MISMATCH` / 403 `TENANT_MISMATCH`: displays clear inline error message.
   - Handling network failure: informs operator that status is uncertain and keeps retry possible.
7. **Live SSE Reconciliation:**
   - Live incoming `approval.decided` event dynamically closes confirmation dialog and disables controls.
   - Live incoming `task.status_changed` (e.g. task cancelled) dynamically removes approval controls.
8. **Accessibility & Keyboard Navigation:**
   - Escape key dismisses confirmation box without closing parent modal dialog.
   - Screen reader announcements (`aria-live="polite"`) for decision outcomes and errors.

---

## 8. Required Discovery Decisions

| Question                                                     | Decision                                                          | Technical Rationale                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Can Phase 4C be implemented using existing backend APIs?** | **YES**                                                           | `GET /v1/approvals` and `POST /v1/approvals/:id/decision` are fully operational and verified.                                                               |
| **Which exact operator actions are supported?**              | **Approve (`ALLOW`) and Reject (`DENY`)**                         | Both map directly to backend `ApprovalDecisionChoiceSchema`.                                                                                                |
| **What exact states enable each action?**                    | Task: `AWAITING_APPROVAL`; Prompt: `PENDING` (and unexpired).     | `TaskStateMachine` strictly allows `AWAITING_APPROVAL -> EXECUTING` (ALLOW) and `AWAITING_APPROVAL -> FAILED` (DENY).                                       |
| **What confirmation and reason-input requirements exist?**   | **Mandatory confirmation; optional reason notes.**                | Both actions carry significant consequences (execution resumption vs. permanent failure). `ApprovalDecisionRequest.userNotes` allows up to 1024 characters. |
| **What UI wording is truthful?**                             | **Explicit consequence disclosure.**                              | Approve: "Resumes execution of [capability] on agent [agentId]". Reject: "Permanently terminates task with FAILED (APPROVAL_DENIED)".                       |
| **What error and concurrency behavior must be handled?**     | **409, 410, 400, 403, 404, network failure, and live SSE races.** | Server enforces single-resolution and TTL expiration; client must reflect server state gracefully.                                                          |
| **Are there blockers requiring backend work?**               | **NO**                                                            | Zero backend changes required.                                                                                                                              |
| **What is the smallest safe implementation scope?**          | **Frontend-only hardening + tests.**                              | Enhance `main.ts` (Approvals view + Task modal), add CSS, and create dedicated Phase 4C test suite.                                                         |

---

## 9. Implementation Plan & Recommended Next Steps

When Phase 4C implementation is authorized:

1. **Step 1: Dashboard UI Enhancement (`apps/web-dashboard/src/main.ts`)**:
   - Add confirmation dialog and reason input for Approve (`ALLOW`) and Reject (`DENY`) in `#view-approvals`.
   - Update `openTaskDetail()` to render Approve and Reject controls alongside Cancel when `task.state === 'AWAITING_APPROVAL'`.
   - Connect decision submissions to `apiClient.submitApprovalDecision` with `promptId`, `decision`, `nonce`, `leaseHeader`, and `userNotes`.
   - Wire in-flight submission guards (`isDeciding`) and error handling for 409, 410, 400, 403, and network errors.
   - Enhance `projectApprovalDecided()` and `projectTaskStatusChanged()` to dynamically reconcile open task modals.
2. **Step 2: Dashboard Styling (`apps/web-dashboard/src/index.css`)**:
   - Add styling for approval confirmation boxes, reason input fields, and error messages matching the Phase 4B visual design.
3. **Step 3: Hardening Test Suite (`tests/hardening/dashboard-approval-workflow-phase4c.test.ts`)**:
   - Write comprehensive unit/integration test suite covering visibility, confirmation, reason capture, duplicate prevention, state transitions, error handling, SSE races, and keyboard accessibility.
4. **Step 4: Root Test Runner Registration (`package.json`)**:
   - Append `tests/hardening/dashboard-approval-workflow-phase4c.test.ts` to `scripts.test`.
5. **Step 5: Monorepo Quality Gates & CI Verification**:
   - Run `format:check`, `lint`, `typecheck`, `build`, `test`, `validate`, `security`.
   - Commit, push, and verify green GitHub Actions run.
