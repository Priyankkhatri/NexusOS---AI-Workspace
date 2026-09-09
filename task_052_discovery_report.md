# TASK 052 DISCOVERY REPORT

## Sprint 1 Milestone 4: Human-in-the-Loop Desktop Approval Interceptor & Native Approval UI Integration

---

### 1. Exact Task Identity

- **Canonical Task Title**: `TASK 052: SPRINT 1 MILESTONE 4 — HUMAN-IN-THE-LOOP DESKTOP APPROVAL INTERCEPTOR & NATIVE APPROVAL UI INTEGRATION`
- **Sprint / Milestone**: Sprint 1, Milestone 4
- **Sprint 1 Track / Week**: Week 2 (AI Integration & Experience Plane)
- **Owning Subsystem(s)**:
  - Desktop Agent UI Subsystem (`apps/desktop-agent/src/ui/`)
  - Desktop Agent Orchestrator & Interceptors (`apps/desktop-agent/src/orchestrator/`)
  - Workflow DAG Engine (`apps/desktop-agent/src/workflow/`)
  - Canonical Shared Contracts (`packages/contracts/src/approval/`)

---

### 2. Why Task 052 Is Next

1. **Authoritative Roadmap Sequencing**:
   Per [`docs/SPRINT_1_READINESS_AND_BACKLOG.md`](docs/SPRINT_1_READINESS_AND_BACKLOG.md), Section 4 ("Sprint 1 Candidate Backlog") and Section 5 ("Recommended Sprint 1 Sequencing"):

   - **Week 1: Runtime & Orchestration Foundations**
     - Item 1: Multi-Step Workflow Graph Execution (`services/orchestrator`, `apps/desktop-agent/src/workflow/`) — **COMPLETED in Task 049**
     - Item 2: Desktop Agent Filesystem & Sandbox Runtime Hardening (`apps/desktop-agent/src/runtimes/filesystem/`) — **COMPLETED in Task 050**
   - **Week 2: AI Integration & Experience Plane**
     - Item 3: Local AI Model Router & ONNX / LLaMA Engine Integration (`runtimes/local-ai/`, `apps/desktop-agent/src/runtimes/local-ai/`) — **COMPLETED in Task 051**
     - Item 4: Human-in-the-Loop Desktop Approval Interceptor (`apps/desktop-agent/src/ui/`, `apps/desktop-agent/src/orchestrator/`) — **AUTHORITATIVE NEXT (Task 052)**
     - Item 5: Web Dashboard Experience Platform Phase 1 Skeleton (`apps/web-dashboard/`) — **Task 053**

2. **Dependency on Task 051 & Preceding Runtimes**:

   - Task 049 built the DAG workflow engine, Task 050 hardened filesystem mutations with cryptographic evidence, and Task 051 integrated the local AI model router with dynamic VRAM detection and prompt isolation.
   - All tool runtimes (Terminal, Filesystem, Browser, Plugin, Local AI) are now capable of executing real operations. However, executing high-impact, irreversible, or sensitive actions (such as terminal commands, external web navigation, file deletions, or privileged model operations) without human-in-the-loop authorization violates the core zero-trust and least-privilege tenets of the NexusOS architecture.
   - Task 052 introduces the critical **Execution Approval Interceptor**, which intercepts high-risk capability executions at the orchestrator boundary, transitions the task state to `AWAITING_APPROVAL`, renders native prompt notifications via `NativeApprovalHost` and the System Tray UI, enforces a 60-second timeout, and fails closed if denied or expired.

3. **Why Task 052 Precedes Task 053+**:
   - **Task 053 (Web Dashboard Experience Platform)**: The web dashboard provides remote task oversight, real-time activity visualization, and approval inboxes. The authoritative desktop approval contracts, lifecycle state machine, and IPC/event streams must be formalized in Task 052 before the remote web dashboard can render or interact with pending approvals.

---

### 3. Authoritative Requirements

#### 3.1 Sprint 1 Readiness and Backlog Specification (`docs/SPRINT_1_READINESS_AND_BACKLOG.md`, Section 4, Item 5)

- **Applicable Contracts**: `ApprovalRequest`, `ApprovalDecision` (must be standardized in `@nexusos/contracts`).
- **Objective**: Render native desktop prompt notifications for high-risk capabilities (e.g., terminal execution, external network calls, file deletions).
- **Mandatory Acceptance Criteria**:
  1. Interactive approval dialog with 60-second expiration timeout.
  2. Denial halts task execution immediately and records audit refusal.

#### 3.2 Enterprise PRD Specifications (`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`)

- **TSK-002 (P0)**: Tasks support statuses: `draft`, `planning`, `awaiting approval`, `queued`, `running`, `paused`, `blocked`, `completed`, `failed`, `canceled`, `expired`. Status transitions must be validated and logged.
- **DSK-002 (P0)**: Desktop Agent exposes system tray state: `connected`, `working`, `awaiting approval`, `offline`, `error`, `paused`. Tray menu supports open dashboard, pause agent, view active task, diagnostics, quit.
- **Section 7.4 (Approval UX)**:
  - Approval cards must state: (1) what will happen in plain language; (2) affected application, account, path, domain, or service; (3) why the action is needed; (4) reversibility and potential impact; (5) relevant evidence, diff, command, or data preview; (6) choices: approve once, approve for task, approve with narrower scope, deny, or stop task.
  - High-risk actions always require fresh explicit approval: deleting outside recycle bin, force push, external communications, purchases, credential/security setting changes, production deployment, sensitive-data export, privilege escalation, and irreversible account actions.
- **Section 7.5 (Emergency Controls)**:
  - Global pause stops new tool invocation and pauses active tasks at safe boundaries.
  - Device disconnect revokes active execution leases immediately.
  - Kill switch terminates managed child processes subject to operating-system constraints.

#### 3.3 Experience Platform EDD (`docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md`)

- **Section 1.1**: The Experience Platform presents policy-filtered state, collects user intent, scoped approvals, and human overrides, and renders evidence.
- **Section 4.1**: Lifecycle states: `Planning --> AwaitingApproval --> Executing`.
- **Section 6.5**: Approval cards render action, target, reason, consequence, reversibility, relevant preview, scope options, expiration, and alternatives. Stale cards become non-actionable.
- **Section 13.1**: Approvals, permissions, revocations, and policy changes are **never optimistically finalized**.
- **Section 18.2**: Approval UI is distinct from chat confirmation and includes impact, destination, reversibility, evidence, expiration, scope alternatives, and authoritative decision receipt.

#### 3.4 NexusOS Implementation Blueprint & Architecture Bible

- **Blueprint Section 20 / Section 58**: Pipeline requires `Request -> Identity -> Policy Evaluation -> Allow / Deny / Approval Required -> Capability Eligibility -> Execution Lease`. The AI model MUST NOT be the policy authority.
- **Architecture Bible Section 40 / 731 / 735**: Single-writer state is authoritative for task graphs, grants, approvals, and leases. State transitions and approval events may not be silently dropped.

---

### 4. Existing Architecture

#### 4.1 Existing Components

1. **`NativeApprovalHost` (`apps/desktop-agent/src/ui/approval-host.ts`)**:
   - Manages pending approval prompts in an in-memory `Map<string, ApprovalPromptItem>`.
   - Methods: `presentPrompt()`, `submitDecision()`, `getPrompt()`, `getSanitizedPromptForUI()`, `listPendingPrompts()`, `cancelPrompt()`, `shutdown()`.
   - Security features:
     - Re-validates execution leases at prompt creation and decision submission time (`this.leaseBoundary.validateLease()`).
     - Cryptographic nonce generation and verification preventing replay attacks.
     - Single-resolution guard preventing double-click / concurrent race conditions (`PROMPT_ALREADY_RESOLVED`).
     - Tenant matching guard preventing cross-tenant decision submission (`TENANT_MISMATCH`).
     - Secret redaction via `RedactionFilter`.
     - Lock-screen privacy sanitization for sensitive payloads.
     - Computes SHA-256 `receiptHash`.
2. **`TrayUIController` (`apps/desktop-agent/src/ui/tray-controller.ts`)**:
   - Manages System Tray state machine: `CONNECTED`, `WORKING`, `AWAITING_APPROVAL`, `PAUSED`, `OFFLINE`, `ERROR`.
   - Manages `pendingApprovalCount` counter and transitions state to `AWAITING_APPROVAL` when approvals are pending.
   - Exposes menu descriptors for pause/resume/quit/diagnostics.
3. **IPC Handlers (`apps/desktop-agent/src/agent.ts`)**:
   - Registered methods: `tray.getStatus`, `tray.pause`, `tray.resume`, `approval.presentPrompt`, `approval.listPending`, `approval.submitDecision`.
4. **Existing Test Coverage**:
   - `apps/desktop-agent/tests/local-tray-approval-host.test.ts` (unit tests for tray controller and approval host).
   - `apps/desktop-agent/tests/local-tray-ipc.test.ts` (IPC invocation for tray and approval methods).
   - `apps/desktop-agent/tests/local-tray-approval-security-hardening.test.ts` (SH-01 through SH-12 security tests).

#### 4.2 Critical Architectural Gaps (What Is Missing)

1. **No Shared Canonical Contracts in `@nexusos/contracts`**:
   - Approval schemas (`ApprovalPromptRequest`, `ApprovalDecisionRequest`, etc.) currently exist only locally inside `apps/desktop-agent/src/ui/types.ts`.
   - `@nexusos/contracts` has NO `approval` module, preventing other services (`services/backend`, `services/policy`, `services/orchestrator`, `apps/web-dashboard`) from utilizing typed approval contracts.
2. **Missing Orchestration Interceptor**:
   - `AgentOrchestrator` (`apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`) has NO connection to `NativeApprovalHost`.
   - When a task execution request involves high-risk capabilities or policies requiring human approval, `AgentOrchestrator` executes the tool directly without pausing for approval.
   - There is no mechanism that:
     - Inspects capability risk tier or policy decision.
     - Prompts the user via `approvalHost.presentPrompt()`.
     - Transitions task status to `AWAITING_APPROVAL`.
     - Updates `TrayUIController` pending approval counter.
     - Awaits human decision with a 60-second TTL.
     - Fails closed on denial or timeout (`APPROVAL_DENIED`, `APPROVAL_EXPIRED`).
3. **Missing Workflow DAG Approval Step**:
   - `WorkflowEngine` (`apps/desktop-agent/src/workflow/engine.ts`) executes DAG nodes sequentially/parallelly without supporting human approval checkpoints.
4. **Missing Cryptographic Evidence & Telemetry Envelopes**:
   - Approval decisions and rejections are not emitted as canonical event envelopes (`nexusos.events.approval.requested.v1`, `nexusos.events.approval.decided.v1`, `nexusos.events.approval.expired.v1`) to `TelemetrySpool`.
   - The approval receipt hash is not chained into task execution receipts.
5. **No Vertical Slice Security Suite for Task 052**:
   - No `tests/vertical-slice/approval-security-invariants.test.ts` exists to validate end-to-end approval invariants `052-SEC-01` through `052-SEC-06`.

---

### 5. Dependencies

- **Task 051 Outputs**:
  - `LocalAiRuntime` and `ModelRuntimeManager` with hardened prompt isolation and capability registration (`local-ai.generate`).
- **Identity & Auth**:
  - `DefaultAgentIdentityProvider`, `AgentIdentity` (tenant ID, device ID binding).
- **Execution Leases & Boundaries**:
  - `ExecutionLeaseBoundary`, `ExecutionLeaseHeader` with `approval:present` and `approval:submit` scopes.
- **Desktop Agent Runtime**:
  - `DesktopAgent`, `AgentOrchestrator`, `TrayUIController`, `NativeApprovalHost`, `IPCManager`.
- **Workflow & Task State**:
  - `TaskStateManager`, `WorkflowEngine`, monotonic lifecycle transitions.
- **Telemetry & Event Bus**:
  - `TelemetrySpool`, `RedactionFilter`, `SecretRedactionRegistry`.

---

### 6. Proposed Implementation Boundary

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PROPOSED ARCHITECTURE BOUNDARY: TASK 052                                │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. packages/contracts/src/approval/                                     │
│    - Canonical shared approval schemas, risk tiers, lifecycle states,   │
│      evidence hash calculations, and re-export in contracts index       │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. apps/desktop-agent/src/ui/                                           │
│    - Re-export canonical contracts from @nexusos/contracts              │
│    - Enhance NativeApprovalHost with event emission & listener hooks    │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. apps/desktop-agent/src/orchestrator/                                 │
│    - Add ApprovalInterceptor to AgentOrchestrator                       │
│    - Intercept high-risk capabilities and explicit approval flags       │
│    - Coordinate task state (AWAITING_APPROVAL) & 60s expiration timeout │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. apps/desktop-agent/src/workflow/                                     │
│    - Enable workflow DAG nodes to specify approval checkpoints          │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. tests/vertical-slice/approval-security-invariants.test.ts            │
│    - Author 052-SEC-01 through 052-SEC-06 security verification suite   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### What Should Change:

- `packages/contracts/src/approval/index.ts` [NEW]: Canonical contracts for approval requests, decisions, and evidence.
- `packages/contracts/src/index.ts` [MODIFY]: Re-export approval contracts.
- `apps/desktop-agent/src/ui/types.ts` [MODIFY]: Align with and re-export from `@nexusos/contracts`.
- `apps/desktop-agent/src/ui/approval-host.ts` [MODIFY]: Emit telemetry events, connect with orchestrator.
- `apps/desktop-agent/src/orchestrator/agent-orchestrator.ts` [MODIFY]: Inject `approvalHost` and intercept capabilities requiring approval before execution.
- `apps/desktop-agent/src/agent.ts` [MODIFY]: Pass `approvalHost` into `orchestrator`.
- `apps/desktop-agent/src/workflow/engine.ts` [MODIFY]: Support approval node evaluation.
- `tests/vertical-slice/approval-security-invariants.test.ts` [NEW]: Dedicated vertical slice test suite.
- `package.json` [MODIFY]: Wire new vertical slice test suite into `test` script.

#### What Must Remain Untouched:

- `services/backend/` and `services/identity/` (out of scope for desktop approval UI).
- `apps/web-dashboard/` (strictly deferred to Task 053).
- Existing Local AI, Filesystem, Terminal, and Browser core runtime adapters.

---

### 7. Contracts / APIs / Protocols

#### 7.1 Authoritative Approval Contracts (`packages/contracts/src/approval/index.ts`)

1. **`ApprovalRiskTier`**:
   `z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])`
2. **`ApprovalLifecycleState`**:
   `z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED'])`
3. **`ApprovalPromptRequestSchema`**:
   - `requestId`: UUID
   - `taskId`: string
   - `stepId`: string (optional)
   - `capabilityId`: string
   - `actionIdentifier`: string
   - `riskTier`: `ApprovalRiskTier`
   - `title`: string
   - `description`: string (max 64 KB)
   - `leaseHeader`: `ExecutionLeaseHeaderSchema`
   - `tenantId`: `TenantIdSchema`
   - `deviceId`: string (optional)
   - `ttlSeconds`: integer (default 60, min 1, max 600)
   - `isLockScreenPrivate`: boolean (default false)
   - `metadata`: record
4. **`ApprovalPromptItemSchema`**:
   - `promptId`: UUID
   - `nonce`: string (16-byte hex)
   - `state`: `ApprovalLifecycleState`
   - `createdAt`: integer (timestamp ms)
   - `expiresAt`: integer (timestamp ms)
   - Full prompt attributes.
5. **`ApprovalDecisionRequestSchema`**:
   - `promptId`: UUID
   - `decision`: `z.enum(['ALLOW', 'DENY'])`
   - `nonce`: string
   - `leaseHeader`: `ExecutionLeaseHeaderSchema`
   - `tenantId`: `TenantIdSchema`
   - `userNotes`: string (optional)
6. **`ApprovalDecisionResultSchema`**:
   - `promptId`: UUID
   - `requestId`: string
   - `decision`: `z.enum(['ALLOW', 'DENY'])`
   - `state`: `ApprovalLifecycleState`
   - `resolvedAt`: integer
   - `receiptHash`: string (SHA-256)
7. **`computeApprovalReceiptChecksum(...)`**:
   Deterministic SHA-256 hash calculation over sorted canonical attributes.

---

### 8. Security Requirements & Security Invariants (`052-SEC-01` to `052-SEC-06`)

| Invariant ID     | Security Invariant                                        | Requirement & Enforcement                                                                                                                                                                                                           |
| :--------------- | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`052-SEC-01`** | **Mandatory Scope & Lease Authorization**                 | Presenting an approval prompt and submitting an approval decision strictly requires `approval:present` and `approval:submit` scopes respectively. Forged or expired leases fail closed.                                             |
| **`052-SEC-02`** | **Tenant & Device Isolation Guard**                       | Cross-tenant approval decision submission is strictly blocked. An approval prompt bound to Tenant A cannot be viewed or decided by Tenant B (`TENANT_MISMATCH`).                                                                    |
| **`052-SEC-03`** | **Replay, Concurrent Race & Nonce Protection**            | Nonce verification prevents forged approvals. Prompts resolved as `APPROVED` or `DENIED` cannot be transitioned again (`PROMPT_ALREADY_RESOLVED`). Concurrent double-click races resolve deterministically with exactly one winner. |
| **`052-SEC-04`** | **Deterministic 60-Second TTL Auto-Expiration**           | Unanswered approval prompts strictly auto-expire upon reaching TTL (default 60s). Expired prompts transition to `EXPIRED` and fail closed (`PROMPT_EXPIRED`).                                                                       |
| **`052-SEC-05`** | **Secret Redaction & Lock-Screen Privacy**                | Prompts containing bearer tokens, passwords, or API keys are automatically sanitized via `RedactionFilter`. When marked lock-screen private, sensitive payload details are redacted.                                                |
| **`052-SEC-06`** | **Cryptographic Receipt & Orchestrator Fail-Closed Halt** | An approval denial or expiration halts task execution immediately with zero tool invocation. Approved decisions produce a verifiable SHA-256 receipt bound to the execution evidence.                                               |

---

### 9. Test & Validation Requirements

1. **Existing Test Suites Must Pass (Zero Regressions)**:
   - `apps/desktop-agent/tests/local-tray-approval-host.test.ts`
   - `apps/desktop-agent/tests/local-tray-ipc.test.ts`
   - `apps/desktop-agent/tests/local-tray-approval-security-hardening.test.ts`
   - Existing 827 monorepo tests across 136 suites.
2. **New Dedicated Vertical Slice Test Suite**:
   - `tests/vertical-slice/approval-security-invariants.test.ts` covering:
     - `052-SEC-01`: Cryptographic lease validation on approval endpoints.
     - `052-SEC-02`: Strict cross-tenant rejection on prompt inspection and decision.
     - `052-SEC-03`: Nonce mismatch and double-click race collision handling.
     - `052-SEC-04`: 60-second TTL auto-expiration fail-closed.
     - `052-SEC-05`: Secret redaction in prompt titles/descriptions and lock-screen privacy.
     - `052-SEC-06`: Orchestrator end-to-end interception (denial halts execution, approval allows execution with receipt).
3. **Repository Quality Gates**:
   - `npm run typecheck`: 0 errors.
   - `npm run lint`: 0 errors.
   - `npm run format:check`: 100% clean with LF.
   - `npm run validate`: Repository architecture boundaries valid.
   - `npm run security`: Zero secrets detected.
   - `npm run test`: All monorepo tests pass.
4. **Remote GitHub Actions CI**:
   - Verify green GitHub Actions run for exact final commit SHA.

---

### 10. In Scope vs. Out of Scope

#### In Scope:

- Defining shared canonical approval contracts in `packages/contracts/src/approval/index.ts`.
- Enhancing `NativeApprovalHost` and `TrayUIController` in `apps/desktop-agent/src/ui/`.
- Building `ApprovalInterceptor` and integrating into `AgentOrchestrator` (`apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`).
- Intercepting high-risk capabilities and task steps requiring human-in-the-loop approval.
- Enforcing the 60-second TTL timeout and fail-closed termination on denial or expiry.
- Emitting telemetry events and computing cryptographically bound approval receipts.
- Authoring vertical-slice security invariants test suite (`tests/vertical-slice/approval-security-invariants.test.ts`).

#### Out of Scope:

- **Task 053+**: Web Dashboard React/Vite UI (`apps/web-dashboard`).
- Modifying backend PostgreSQL schema or remote backend approval endpoints.
- Modifying identity service OIDC provider or JWT validation logic.
- Building custom graphical OS window renderers (NativeApprovalHost uses system tray and IPC dialog bridge).

---

### 11. Risks & Ambiguities

1. **Async Interception & Lock Contention in Orchestrator**:
   - Awaiting human approval for up to 60 seconds must NOT block the orchestrator's event loop or freeze unrelated tasks. The active task must transition to `AWAITING_APPROVAL` and wait on an asynchronous promise/callback without holding synchronizing state locks.
2. **Cancellation during Awaiting Approval**:
   - If a task is cancelled while awaiting user approval, the pending approval prompt must be automatically cancelled (`cancelPrompt()`), the prompt timer cleared, and the task transition to `CANCELED`.
3. **Contract Deduplication**:
   - `apps/desktop-agent/src/ui/types.ts` has duplicate schemas that must be replaced by or re-exported from `@nexusos/contracts` to prevent divergence.

---

### 12. Recommended Implementation Sequence (For Subsequent Execution Phase)

1. **Phase 1: Canonical Approval Contracts**
   - Create `packages/contracts/src/approval/index.ts`.
   - Re-export in `packages/contracts/src/index.ts`.
   - Add unit tests for contracts in `packages/contracts/tests/contracts.test.ts`.
2. **Phase 2: UI Types & Approval Host Enhancement**
   - Refactor `apps/desktop-agent/src/ui/types.ts` to consume canonical contracts.
   - Enhance `NativeApprovalHost` to support asynchronous approval listeners and audit event emission.
3. **Phase 3: Orchestrator Approval Interceptor**
   - Implement approval interception logic in `AgentOrchestrator`.
   - Update `TrayUIController` state during approval wait.
   - Handle cancellation and timeout events.
4. **Phase 4: Vertical Slice Security Tests**
   - Create `tests/vertical-slice/approval-security-invariants.test.ts` verifying `052-SEC-01` through `052-SEC-06`.
   - Wire into `package.json` test script.
5. **Phase 5: Quality Gates, Commit, Push & CI Verification**
   - Run `typecheck`, `lint`, `format:check`, `validate`, `security`, and `test`.
   - Commit, push to `origin/main`, monitor GitHub Actions CI until green.
   - Produce `task_052_completion_report.md`.

---

### 13. Baseline / Discovery Confirmation

- **Exact Baseline HEAD SHA**: `42b243e8fd5566534473fbe37e6d4cc9aaab7ecb`
- **Git Status Before Discovery**: Clean on `main`, up to date with `origin/main`.
- **Git Status After Discovery**: Clean on `main`, only `task_052_discovery_report.md` created.
- **Zero Implementation / Test Code Modified**: CONFIRMED. No source or test files were modified.
- **Task 053+ Status**: CONFIRMED. Task 053+ has NOT been started.
- **Discovery Report Path**: [`task_052_discovery_report.md`](task_052_discovery_report.md)
