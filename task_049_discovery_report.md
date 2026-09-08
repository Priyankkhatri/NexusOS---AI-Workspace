# Task 049 — Discovery Report

## Sprint 1 Milestone 1: Multi-Step Workflow Graph Execution & Control-Plane Orchestration (DAG Task Foundation)

**Date:** 2026-09-08  
**Mode:** DISCOVERY ONLY  
**Baseline HEAD SHA:** `3fa388f9c52421fd5bf93fc8099e247255d4b3f8`  
**Owning Subsystem:** Control-Plane Task Orchestration (`services/backend/src/tasks`) & Desktop Agent Workflow Integration (`apps/desktop-agent/src/workflow`)  
**Status:** COMPLETE (Discovery Only — Implementation Not Started)

---

## 1. Exact Task Identity

- **Task Identifier:** `Task 049`
- **Canonical Title:** `TASK 049: SPRINT 1 MILESTONE 1 — MULTI-STEP WORKFLOW GRAPH EXECUTION & CONTROL-PLANE ORCHESTRATION (DAG TASK FOUNDATION)`
- **Sprint / Milestone:** `Sprint 1 — Milestone 1: Multi-Step Workflow Graph Execution & DAG Task Foundation`
- **Sprint 1 Track:** `Sprint 1 Week 1: Runtime & Orchestration Foundations` (Item 1)
- **Owning Subsystems:**
  - Control-Plane Backend & Task Orchestration: `services/backend/src/tasks/`
  - Shared Contracts: `packages/contracts/src/tasks/`
  - Desktop Agent Workflow Plane: `apps/desktop-agent/src/workflow/` & `apps/desktop-agent/src/agent.ts`
- **Preceding Frontier:** `Task 048: Milestone M7 — Sprint 0 Hardening, Quality Gate Finalization & Sprint 1 Readiness (Sprint 0 Exit)` (Verified GREEN in CI Run `34244894107`, commit `3fa388f9c52421fd5bf93fc8099e247255d4b3f8`)
- **Authority Derivation:**
  - _NexusOS Sprint 0 Implementation Blueprint_, Section 58 (`Definition of Ready for Sprint 1`)
  - _NexusOS Sprint 0 Implementation Blueprint_, Section 59 (`Sprint 1 Candidate Work` — "workflow graph execution; richer task creation")
  - _Sprint 1 Readiness and Backlog Specification_ (`docs/SPRINT_1_READINESS_AND_BACKLOG.md`), Section 4 (`Sprint 1 Candidate Backlog`, Item 1) & Section 5 (`Recommended Sprint 1 Sequencing`, Week 1)
  - _NexusOS Backend Engineering Design Document (EDD)_, Section 7 (`Task Orchestration`) & Section 8 (`Workflow Management`)
  - _NexusOS AI Runtime Engineering Design Document (EDD)_, Section 5 (`Execution Graph Engine`)
  - _NexusOS Enterprise PRD v3_, Section 6.4 (`Plan and Execution Graph`) & Section 12.1 (`Control plane: intent-to-execution`)
  - _NexusOS Architecture Bible_, Section 6 (`Task Lifecycle & Graph Engine`) & Section 14 (`Agent Communication Protocol`)

---

## 2. Why This Is the Next Sprint 1 Task

Following the successful hardening and formal exit of Sprint 0 in Task 048 (commit `3fa388f`), the project transitions into Sprint 1 feature development. Task 049 is the authoritative and necessary first task of Sprint 1 for the following architectural reasons:

1. **Sprint 0 Exit Prerequisite Met:**
   Sprint 0 concluded with a hardened, single-step vertical slice (Task 047) and complete operational runbooks / DoD audit (Task 048). As explicitly documented in `docs/SPRINT_1_READINESS_AND_BACKLOG.md` (Section 5) and Blueprint Section 59, the first architectural dependency of Sprint 1 is **Item 1: Multi-Step Workflow Graph Execution**.

2. **Closing the Control Plane / Desktop Agent Architectural Asymmetry:**

   - In Task 03S, the Desktop Agent team implemented an in-memory client-side workflow engine (`apps/desktop-agent/src/workflow/workflow-engine.ts`, `dag-parser.ts`, `step-context.ts`) that successfully parses and executes local DAGs.
   - However, the **Control Plane (`services/backend`) currently has zero DAG awareness**:
     - `TaskCreateRequest` in `@nexusos/contracts` only supports single capability execution (`capabilityId: string`).
     - `TaskController` in `services/backend/src/tasks/controller.ts` only evaluates policy, issues leases, and handles receipts for a single capability.
     - ACP Dispatch Bridge (`services/backend/src/server/acp-dispatch-bridge.ts`) only formats single-task execution envelopes (`schema:nexusos:acp:task:execute:v1`).
     - `DesktopAgent`'s ACP listener in `apps/desktop-agent/src/agent.ts` blindly forwards ACP payloads to `taskScheduler.scheduleTask(...)` instead of routing workflow execution envelopes to `this.workflowEngine`.
   - The system is architecturally fractured: local DAG execution exists as an isolated component on the desktop, but enterprise users cannot submit, govern, policy-evaluate, lease, or audit multi-step DAG workflows through the Control Plane.

3. **Prerequisite for Subsequent Sprint 1 Milestones:**
   - _Sandbox Runtime Hardening (Item 2)_ requires multi-step workflows that pass file artifacts across isolated sandboxes.
   - _AI Runtime Model Routing & Planner Integration (Item 3)_ requires a Control-Plane orchestrator capable of consuming generated execution graphs.
   - _Experience Platform Web Dashboard (Item 4)_ requires DAG node-level lifecycle state telemetry to render graph visualization.

Therefore, **Task 049 is the foundational first task of Sprint 1**.

---

## 3. Authoritative Requirements

### 3.1 Sprint 0 Implementation Blueprint

- **Section 58 (Definition of Ready for Sprint 1):**
  - Architecture dependencies are clear.
  - Core CI quality gates remain strictly green.
  - First vertical slice is proven (proven in Task 047).
  - Sprint 1 tasks have concrete acceptance criteria and identified contracts.
- **Section 59 (Sprint 1 Candidate Work):**
  - Explicitly nominates: "richer task creation" and "workflow graph execution".
  - Requires: "Selection MUST be driven by architecture dependencies and product priorities, not by whichever feature is easiest to demo."

### 3.2 Sprint 1 Readiness and Backlog Specification (`docs/SPRINT_1_READINESS_AND_BACKLOG.md`)

- **Section 4 (Item 1: Multi-Step Workflow Graph Execution):**
  - **Owning Subsystem:** Control-Plane Orchestration (`services/backend/src/tasks`, previously referenced as `services/orchestrator`).
  - **Applicable Contracts:** `TaskExecutionGraph`, `WorkflowDAG`, `AcpCommand`, `AcpEvent`.
  - **Objective:** Extend single-task execution into multi-node directed acyclic graph (DAG) workflows with sequential and parallel node evaluation.
  - **Acceptance Criteria:**
    1. Orchestrator evaluates topological dependencies between tasks.
    2. Node failure triggers bounded retry or branch compensation.
    3. State transitions persist atomically in database / state store.

### 3.3 Backend Engineering Design Document (EDD)

- **Section 7 (Task Orchestration):**
  - "Task Service owns task lifecycle: Draft, Planning, AwaitingApproval, Queued, Running, Paused, Blocked, Completed, Failed, Canceled, Expired."
  - "Orchestrator coordinates graph-version references, policy evaluation, dispatch, lease generation, checkpoint synchronization, prioritization, scheduling, retries, compensation requests, cancellation, and reconciliation."
  - "Every dispatched node has an idempotency key, timeout, retry policy, expected evidence, compensation/reconciliation strategy, and trace context."
  - "Lease validation is performed by Orchestrator before issue and Desktop Agent before execution."
- **Section 8 (Workflow Management):**
  - "Workflow Service, implemented as a bounded domain of Task Service unless extracted after contract maturity, owns workflow definitions, templates, validation records, publication state, permissions, compatibility metadata, execution history references, and rollback/version lineage."
  - "Validation checks schema, referenced capabilities, policy compatibility, dependency versions, data classifications, approval requirements, budget declarations, and compensation declarations."

### 3.4 AI Runtime EDD

- **Section 5.1 (Graph Model):**
  - Graph model represents versioned directed graphs (DAGs).
  - Node types: Action, Decision, Condition, Parallel fork/join, Retry, Timeout, Compensation, Approval, Checkpoint, Terminal.
  - Edges define dependencies and data passing between nodes.

### 3.5 PRD v3

- **Section 6.4 (Plan and Execution Graph):**
  - Plan is a versioned DAG of steps with explicit input references, output artifact contracts, capability requirements, permission scopes, and rollback/compensation instructions.
- **Section 12.1 (Control Plane):**
  - Control plane plans, composes DAGs, enforces policy, issues signed work leases, and maintains the execution ledger.

### 3.6 AI Coding Standards & Monorepo Boundaries

- Contract-first design: Shared schemas must live in `packages/contracts` and be strictly validated via Zod.
- Fail-closed security posture: If any node in a DAG fails policy or authentication, the workflow must be rejected immediately.
- Immutability of task and graph execution state; audit logging of every node transition.
- Prototype pollution guards on context variable interpolation (`{{nodes.<nodeId>.output.<key>}}`).

---

## 4. Existing Architecture / Components

### 4.1 Packages & Services Overview

```
NexusOS Monorepo
├── packages/
│   ├── contracts/                <-- Shared types & Zod schemas
│   │   ├── src/tasks/            <-- TaskCreateRequest, TaskRecord, ExecutionReceipt (Single-task only)
│   │   ├── src/permissions/      <-- ExecutionLeaseHeader, CapabilityLease
│   │   └── src/acp/              <-- ACPMessageEnvelope, createACPMessageEnvelope
│   └── policy/                   <-- PolicyEvaluator, PolicyDecisionRequest
├── services/
│   └── backend/
│       └── src/
│           ├── tasks/            <-- TaskController, TaskStateMachine (Single-task only)
│           ├── leases/           <-- LeaseIssuer (HMAC-SHA256 lease signer)
│           ├── receipts/         <-- ReceiptVerifier (Receipt verification)
│           └── server/           <-- ACPDispatchBridge (ACP dispatching to Desktop Agent)
└── apps/
    └── desktop-agent/
        └── src/
            ├── agent.ts          <-- DesktopAgent host class (instantiates WorkflowEngine)
            ├── workflow/         <-- Task 03S DAG implementation
            │   ├── types.ts      <-- Local WorkflowDAG, WorkflowNode types
            │   ├── dag-parser.ts <-- Validation, cycle detection, topological sort
            │   ├── step-context.ts<-- Safe variable interpolation
            │   └── workflow-engine.ts <-- Local DAG execution runtime
            └── scheduler/        <-- TaskScheduler (handles single tasks)
```

### 4.2 Verified Source Components to Reuse

1. **`apps/desktop-agent/src/workflow/dag-parser.ts`:**
   - Already provides robust cycle detection (DFS-based), topological sort (Kahn's algorithm), and parallel execution tier grouping (`executionTiers: string[][]`).
   - Limits workflow complexity (max 50 nodes, max 100 edges).
2. **`apps/desktop-agent/src/workflow/step-context.ts`:**
   - Already provides secure variable substitution with prototype pollution protection (blocks `__proto__`, `constructor`, `prototype`) and 1MB size bounds.
3. **`apps/desktop-agent/src/workflow/workflow-engine.ts`:**
   - Implements multi-tier node execution, compensation invocation on node failure, timeout enforcement, cancellation via `AbortController`, and local checkpointing.
4. **`services/backend/src/leases/lease-issuer.ts`:**
   - Signs expiring HMAC-SHA256 leases for capabilities.
5. **`services/backend/src/receipts/receipt-verifier.ts`:**
   - Validates cryptographic execution receipts from Desktop Agent.
6. **`services/backend/src/server/acp-dispatch-bridge.ts`:**
   - Bridges control-plane task dispatch to desktop agent over ACP envelopes.

---

## 5. Dependencies on Sprint 0 / Tasks 040–048

Task 049 builds directly upon the foundations hardened across Sprint 0:

| Dependency                       | Sprint 0 Task | Verified Capability Used in Task 049                                                 |
| :------------------------------- | :------------ | :----------------------------------------------------------------------------------- |
| **Monorepo & Build Toolchain**   | Task 040      | Strict typecheck, linting, formatting, turbo build pipelines.                        |
| **Shared Contracts Foundation**  | Task 041      | Zod-validated cross-workspace contracts in `@nexusos/contracts`.                     |
| **Control-Plane Backend**        | Task 042      | Backend server lifecycle, database/mock persistence, structured logging.             |
| **Desktop Agent Host Plane**     | Task 043      | Desktop Agent lifecycle states, runtime registry, capability registration.           |
| **Governance & Leases**          | Task 044      | Policy evaluation engine (`@nexusos/policy`), HMAC-signed `ExecutionLeaseHeader`.    |
| **Agent Communication Protocol** | Task 045      | ACP envelope schemas (`ACPMessageEnvelope`), pairing, and communication.             |
| **Audit & Observability**        | Task 046      | Event publishing (`EventPublisherBoundary`), structured telemetry, secret redaction. |
| **Vertical Slice Integration**   | Task 047      | Single-task dispatch, execution, receipt verification, and end-to-end integration.   |
| **Hardening & Quality Gates**    | Task 048      | 10 operational runbooks, resource baseline, Sprint 0 exit gate (743 tests passing).  |

---

## 6. Proposed Implementation Boundary

To preserve monorepo boundaries and adhere strictly to Backend EDD Section 8, Task 049 will implement multi-step workflow graph execution across three specific layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. SHARED CONTRACTS (@nexusos/contracts/src/tasks/)                    │
│    - Promote WorkflowDAG, WorkflowNode, WorkflowEdge, WorkflowStatus   │
│      into canonical, versioned Zod schemas.                            │
│    - Define TaskGraphCreateRequest & TaskGraphRecord schemas.          │
│    - Define ACP Workflow Dispatch Envelope (v1).                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ 2. CONTROL-PLANE ORCHESTRATION (services/backend/src/tasks/)           │
│    - Extend TaskController to accept TaskGraphCreateRequest.           │
│    - Graph Validator: Validate DAG, cycles, and capabilities on submit.│
│    - Multi-Node Policy Evaluator: Evaluate ABAC/RBAC for all nodes.    │
│    - Graph Lease Issuer: Issue composite/per-node execution leases.    │
│    - ACP Workflow Dispatch: Dispatch graph to Desktop Agent via ACP.   │
│    - Workflow Receipt Settler: Settle graph completion and evidence.   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (ACP Protocol Stream)
┌───────────────────────────────────▼────────────────────────────────────┐
│ 3. DESKTOP AGENT INTEGRATION (apps/desktop-agent/)                     │
│    - Update apps/desktop-agent/src/workflow/types.ts to re-export from │
│      @nexusos/contracts (eliminating redundant local type definitions).│
│    - Update agent.ts ACP command handler to route                      │
│      'schema:nexusos:acp:workflow:execute:v1' directly to              │
│      workflowEngine.executeWorkflow(dag).                              │
│    - Provide public workflow engine access on DesktopAgent for testing.│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Contracts / APIs / Protocols

### 7.1 Shared Contracts (`packages/contracts/src/tasks/`)

The following canonical Zod schemas and TypeScript types must be defined in `@nexusos/contracts`:

1. **`WorkflowNodeSchema`:**
   ```ts
   export const WorkflowNodeSchema = z.object({
     nodeId: z.string().min(1).max(64),
     capabilityId: z.string().min(1),
     runtimeCategory: z.string().min(1),
     payload: z.record(z.unknown()).default({}),
     dependencies: z.array(z.string()).optional(),
     compensationPayload: z.record(z.unknown()).optional(),
     timeoutMs: z.number().int().positive().max(300000).optional(),
   });
   ```
2. **`WorkflowEdgeSchema`:**
   ```ts
   export const WorkflowEdgeSchema = z.object({
     fromNodeId: z.string().min(1),
     toNodeId: z.string().min(1),
   });
   ```
3. **`WorkflowDAGSchema`:**
   ```ts
   export const WorkflowDAGSchema = z.object({
     workflowId: UUIDSchema,
     taskId: TaskIdSchema,
     leaseHeader: ExecutionLeaseHeaderSchema,
     correlationId: z.string().min(1),
     nodes: z.array(WorkflowNodeSchema).min(1).max(50),
     edges: z.array(WorkflowEdgeSchema).max(100).optional(),
     expiresAt: z.string().datetime().optional(),
   });
   ```
4. **`TaskGraphCreateRequestSchema`:**
   ```ts
   export const TaskGraphCreateRequestSchema = z.object({
     title: z.string().min(1).max(256),
     targetAgentId: DeviceIdSchema,
     workflowId: UUIDSchema.optional(),
     nodes: z.array(WorkflowNodeSchema).min(1).max(50),
     edges: z.array(WorkflowEdgeSchema).max(100).optional(),
     requestedScope: z.string().min(1),
     metadata: z.record(z.string()).optional(),
   });
   ```
5. **`WorkflowExecutionReceiptSchema`:**
   ```ts
   export const WorkflowExecutionReceiptSchema = z.object({
     receiptId: UUIDSchema,
     workflowId: UUIDSchema,
     taskId: TaskIdSchema,
     leaseId: LeaseIdSchema,
     agentId: DeviceIdSchema,
     tenantId: TenantIdSchema,
     status: z.enum(['SUCCESS', 'FAILURE', 'CANCELLED']),
     completedNodes: z.array(z.string()),
     failedNodes: z.array(z.string()),
     nodeOutputs: z.record(z.record(z.unknown())),
     evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
     errorMessage: z.string().optional(),
     completedAt: z.string().datetime(),
     signature: z.string().min(1),
   });
   ```

### 7.2 ACP Protocols

- **ACP Workflow Execution Command:**
  - `schema:nexusos:acp:workflow:execute:v1`
  - Payload contains full signed `WorkflowDAG`.
- **ACP Workflow Cancellation Command:**
  - `schema:nexusos:acp:workflow:cancel:v1`
  - Payload contains `{ workflowId, tenantId, reason }`.

### 7.3 Event Bus Topics & Events

- `schema:nexusos:workflow:submitted:v1`
- `schema:nexusos:workflow:leased:v1`
- `schema:nexusos:workflow:dispatched:v1`
- `schema:nexusos:workflow:node:completed:v1`
- `schema:nexusos:workflow:completed:v1`
- `schema:nexusos:workflow:failed:v1`
- `schema:nexusos:workflow:canceled:v1`

---

## 8. Security Requirements

Every requirement conforms to the fail-closed governance model established in Sprint 0:

1. **049-SEC-01: Multi-Node Pre-Execution Policy Evaluation**
   - The Control Plane MUST evaluate policy for _every capability_ referenced across all nodes in the DAG before issuing any execution lease.
   - If even one node is denied by policy, the entire graph submission MUST be rejected (`403 Forbidden / POLICY_DENIED`) with fail-closed semantics.
2. **049-SEC-02: Cryptographic Lease Integrity for Workflows**
   - The workflow lease MUST cryptographically bind the tenant ID, target device ID, allowed scopes, and workflow ID using HMAC-SHA256.
   - Desktop Agent MUST re-validate the lease signature and expiry before launching any workflow node.
3. **049-SEC-03: Tenant Isolation & Status Masking**
   - Cross-tenant workflow queries, cancellation attempts, or status requests MUST return `404 Not Found` (or `null`) rather than disclosing execution state.
4. **049-SEC-04: Prototype Pollution & Context Injection Prevention**
   - Context interpolation (`{{nodes.<id>.output.<key>}}`) MUST strictly sanitize object paths, rejecting `__proto__`, `constructor`, `prototype`, and keys containing prototype modifiers.
5. **049-SEC-05: Topological Bound Enforcement**
   - DAGs must not exceed 50 nodes and 100 edges. Cycles MUST be rejected deterministically before execution.
6. **049-SEC-06: Automatic Failure Compensation**
   - If a downstream node fails and a preceding node defined a `compensationPayload`, the compensation action MUST be executed (or scheduled) to rollback side-effects.

---

## 9. Test & Validation Requirements

### 9.1 Unit & Contract Tests

1. **Contract Tests (`packages/contracts/tests/tasks/workflow-contracts.test.ts`):**
   - Validates `WorkflowDAGSchema`, `WorkflowNodeSchema`, `TaskGraphCreateRequestSchema`, and `WorkflowExecutionReceiptSchema`.
   - Rejects invalid topologies, cycle definitions, negative timeouts, missing capability IDs, and oversized node counts (>50).
2. **Control-Plane DAG Controller Tests (`services/backend/tests/tasks/workflow-controller.test.ts`):**
   - Validates submission of multi-node DAG tasks through `TaskController`.
   - Tests policy denial on individual nodes leading to entire graph rejection.
   - Tests multi-node lease generation and dispatch via ACP bridge.
   - Tests settling of multi-node workflow execution receipts.
3. **Desktop Agent ACP Workflow Dispatch Tests (`apps/desktop-agent/tests/workflow-acp-integration.test.ts`):**
   - Validates that ACP command `schema:nexusos:acp:workflow:execute:v1` received by `DesktopAgent` triggers `WorkflowEngine.executeWorkflow`.
   - Tests cancellation propagation via ACP.

### 9.2 End-to-End Governed Multi-Step Integration Test

- **`tests/vertical-slice/governed-workflow-graph.test.ts`:**
  - Full end-to-end integration test exercising:
    1. Authenticated user submits a 3-node DAG (Node A: `filesystem.read` -> Node B: `device.info` -> Node C: `terminal.exec` [low risk] with dependency on A & B).
    2. Backend validates DAG, checks policy for all 3 nodes, issues signed workflow lease, and dispatches via ACP.
    3. Desktop Agent receives ACP command, parses DAG, resolves dependencies, executes nodes in topological order, interpolates output of Node A into Node C, and generates a signed `WorkflowExecutionReceipt`.
    4. Backend receives receipt, verifies signature and evidence checksum, and marks task `COMPLETED`.
    5. Audit ledger and event stream verify all step transitions.

### 9.3 Failure & Resilience Scenarios

1. **Policy Denied on Node 2:** Graph rejected before dispatch; zero nodes execute.
2. **Cycle in Submitted Graph:** Backend parser rejects with `CYCLE_DETECTED`; 400 Bad Request.
3. **Mid-Workflow Node Failure with Compensation:** Node 1 succeeds, Node 2 fails -> Node 1's compensation action is automatically triggered.
4. **Workflow Lease Expiry:** Expired lease halts workflow execution; returns `LEASE_EXPIRED`.
5. **Cross-Tenant Access Rejection:** Tenant B cannot view or cancel Tenant A's workflow.

---

## 10. In Scope

- Authoring canonical `WorkflowDAG`, `WorkflowNode`, `WorkflowEdge`, and `TaskGraphCreateRequest` schemas in `@nexusos/contracts`.
- Extending `services/backend/src/tasks/controller.ts` (or introducing `services/backend/src/tasks/workflow-orchestrator.ts`) to validate, policy-evaluate, lease, and dispatch DAG workflows.
- Updating `services/backend/src/server/acp-dispatch-bridge.ts` with `dispatchWorkflow(dag)` method.
- Updating `apps/desktop-agent/src/agent.ts` ACP command handler to route workflow execution envelopes to `this.workflowEngine`.
- Refactoring `apps/desktop-agent/src/workflow/types.ts` to consume canonical types from `@nexusos/contracts`.
- Comprehensive unit, contract, and end-to-end integration tests for multi-step DAG workflows.
- Updating API documentation and documentation index.

---

## 11. Out of Scope

- Implementing the AI Runtime Planner graph generation (Item 3 in Sprint 1 backlog; AI Planner will be wired in Milestone 2).
- Implementing the Web Dashboard graph visualization UI (`apps/web-dashboard`, Item 4).
- Production HashiCorp Vault integration (deferred per Sprint 0 exit report).
- OS directory jail hardening (Item 2 in Sprint 1 backlog).
- Modifying unrelated runbooks or touching existing Sprint 0 baseline tests (`tests/sanity.test.ts`, `tests/vertical-slice/governed-vertical-slice.test.ts`).
- Task 050+ implementation.

---

## 12. Risks / Ambiguities

| Risk / Ambiguity                                      | Impact | Resolution / Mitigating Design for Task 049                                                                                                                                                                                                                                                                                                                                               |
| :---------------------------------------------------- | :----- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lease Granularity: Graph vs Per-Node**              | Medium | A single workflow lease with a list of permitted capability IDs is simpler, but a per-node lease offers tighter least privilege. **Resolution:** Use a workflow-level `ExecutionLeaseHeader` whose `scopes` encompass all capabilities in the graph, but attach node-level capability IDs in the DAG payload for individual node boundary validation.                                     |
| **Monorepo Contracts Duplication**                    | Low    | Currently `apps/desktop-agent/src/workflow/types.ts` defines `WorkflowDAG` locally. **Resolution:** Move canonical definitions into `@nexusos/contracts/src/tasks/` and re-export them in `desktop-agent` to ensure strict backward compatibility without breaking existing desktop agent tests.                                                                                          |
| **Backend Service Extraction (Task vs Orchestrator)** | Low    | Backlog mentions `services/orchestrator`, but Backend EDD Section 8 explicitly states: _"Workflow Service, implemented as a bounded domain of Task Service unless extracted after contract maturity"_. **Resolution:** Implement workflow graph orchestration directly within `services/backend/src/tasks/` to avoid premature network overhead and unnecessary repository fragmentation. |
| **Receipt Structure for Multi-Step**                  | Medium | Does each node produce an individual `ExecutionReceipt` or does the workflow produce a single aggregate receipt? **Resolution:** Desktop Agent generates an aggregate `WorkflowExecutionReceipt` containing an array of node execution records, outputs, and a combined evidence SHA-256 hash.                                                                                            |

---

## 13. Recommended Implementation Sequence

When authorized to begin implementation, Task 049 should execute in the following 5 strictly scoped phases:

```
Phase 1: Shared Contracts Promotion
├── 1.1 Add WorkflowNode, WorkflowEdge, WorkflowDAG, TaskGraphCreateRequest schemas to packages/contracts/src/tasks/
├── 1.2 Add WorkflowExecutionReceipt and ACP workflow command schemas
├── 1.3 Update packages/contracts/src/index.ts exports
└── 1.4 Add unit contract tests in packages/contracts/tests/tasks/

Phase 2: Desktop Agent Contract Alignment
├── 2.1 Update apps/desktop-agent/src/workflow/types.ts to re-export from @nexusos/contracts
├── 2.2 Wire ACP command handler in apps/desktop-agent/src/agent.ts for 'schema:nexusos:acp:workflow:execute:v1'
├── 2.3 Expose getWorkflowEngine() getter on DesktopAgent
└── 2.4 Verify all existing 743 tests remain 100% green

Phase 3: Control-Plane Workflow Graph Orchestration
├── 3.1 Implement DAG topology validation & node capability checking in services/backend/src/tasks/
├── 3.2 Implement multi-node policy evaluation in TaskController (evaluating all node capabilities before lease issue)
├── 3.3 Implement workflow lease issuance via LeaseIssuer
├── 3.4 Add dispatchWorkflow() to services/backend/src/server/acp-dispatch-bridge.ts
└── 3.5 Implement workflow receipt settlement and lifecycle state transitions

Phase 4: Integration & Security Test Suite
├── 4.1 Author services/backend/tests/tasks/workflow-controller.test.ts
├── 4.2 Author apps/desktop-agent/tests/workflow-acp-integration.test.ts
└── 4.3 Author end-to-end test tests/vertical-slice/governed-workflow-graph.test.ts

Phase 5: Local Validation & DoD Verification
├── 5.1 Run npm run format:check, npm run lint, npm run typecheck
├── 5.2 Run npm run build and npm run test
├── 5.3 Run npm run test:security
└── 5.4 Author task_049_completion_report.md
```

---

## Concluding Metadata

- **Baseline HEAD SHA:** `3fa388f9c52421fd5bf93fc8099e247255d4b3f8`
- **Discovery-Only Confirmation:** CONFIRMED. No implementation code was written, modified, or deleted.
- **Exact Report Path:** `task_049_discovery_report.md` (at repository root: `c:\Users\priya\Desktop\Nexus AI\task_049_discovery_report.md`)
- **No Implementation Code Changed:** CONFIRMED. All existing packages, services, apps, and tests remain untouched.
- **Task 050+ Confirmation:** CONFIRMED. Task 050+ has not been started.
