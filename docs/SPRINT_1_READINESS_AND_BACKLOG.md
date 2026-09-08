# Sprint 1 Readiness Assessment & Candidate Backlog

**Authoritative Sources:**

- NexusOS Sprint 0 Implementation Blueprint — Section 58 (Definition of Ready for Sprint 1)
- NexusOS Sprint 0 Implementation Blueprint — Section 59 (Sprint 1 Candidate Work)
- NexusOS Enterprise PRD & Architecture Bible

---

## 1. Sprint 0 Exit & Sprint 1 Readiness Assessment

Sprint 1 begins only when the 10 core readiness criteria from Blueprint Section 58 are satisfied. Below is the audited status at the conclusion of Sprint 0:

| Section 58 Criterion                                  | Status        | Evidence / Repository Verification                                                                                             |
| :---------------------------------------------------- | :------------ | :----------------------------------------------------------------------------------------------------------------------------- |
| **1. Repository foundation is stable**                | **SATISFIED** | Monorepo toolchain locked (Node 24.14.1, pnpm 11.21.0, TS 5.7.3), reproducible builds, zero dirty git state.                   |
| **2. Contracts are versioned**                        | **SATISFIED** | `@nexusos/contracts` (`v0.1.0-sprint0`) exports typed schemas, ACP protocols, and error taxonomy with zero cross-dependencies. |
| **3. Architecture dependencies are clear**            | **SATISFIED** | Multi-plane topology documented in `docs/ARCHITECTURE_INDEX.md` and enforced by ESLint boundary rules.                         |
| **4. Core CI gates are green**                        | **SATISFIED** | GitHub Actions CI workflow runs `format:check`, `lint`, `typecheck`, `test`, `build`, `validate`, and `security`.              |
| **5. Development environments work**                  | **SATISFIED** | Step-by-step setup in `docs/LOCAL_DEVELOPMENT.md`; local services and tray UI run on developer workstations.                   |
| **6. First vertical slice is proven**                 | **SATISFIED** | Governed end-to-end task execution passing in `tests/vertical-slice/governed-vertical-slice.test.ts`.                          |
| **7. Critical blockers are resolved**                 | **SATISFIED** | Zero open P0/P1 architectural blockers; trust boundaries and process supervisor verified.                                      |
| **8. Remaining risks have owners**                    | **SATISFIED** | Risk register maintained in Sprint 0 Completion Report with assigned engineering owners.                                       |
| **9. Sprint 1 tasks have acceptance criteria**        | **SATISFIED** | Candidate backlog defined below with explicit, testable acceptance criteria.                                                   |
| **10. Applicable contracts identified for each task** | **SATISFIED** | Each candidate item maps directly to `@nexusos/contracts` schemas and EDD specifications.                                      |

---

## 2. Prerequisites Satisfied & Architecture Foundations

The following foundational subsystems were completed and hardened in Sprint 0:

1. **Monorepo & Governance (M0):** Strict workspace isolation, linting, typechecking, and frozen lockfile hygiene.
2. **Contract Foundation (M1):** Shared schemas for tasks, ACP messages, events, and error taxonomy.
3. **Platform Foundation (M2):** Express API server, zero-trust JWT validator, and Policy evaluation engine.
4. **Device Foundation (M3):** Windows Desktop Agent supervisor, local encrypted vault, and runtime abstractions.
5. **AI Foundation (M4):** Local AI runtime router, prompt isolation boundary, and circuit breakers.
6. **Experience Foundation (M5):** System tray UI host and vertical slice event observables.
7. **Vertical Slice (M6):** Governed task lifecycle from creation through policy approval to execution and receipt audit.
8. **Hardening & Operations (M7):** 10 failure-domain runbooks (`RB-001`–`RB-010`), resource baseline (`scripts/measure-resource-baseline.js`), and automated DoD audit.

---

## 3. Remaining Risks & Deferred Items (Non-Blocking)

| Risk / Deferred Item                 | Severity | Owner              | Mitigation / Sprint 1 Plan                                                                                                                |
| :----------------------------------- | :------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Local LLM Model Weight Size**      | Medium   | AI Runtime Team    | Implement streaming model quantization and dynamic VRAM offloading in `runtimes/local-ai`.                                                |
| **Windows Tray IPC Platform Limits** | Low      | Desktop Agent Team | Benchmark high-throughput named pipe communication under heavy task queues.                                                               |
| **Full Web Dashboard Application**   | Deferred | Experience Team    | Sprint 0 utilized the Tray UI host and API observables; the standalone Web Dashboard UI (`apps/web-dashboard`) is scheduled for Sprint 1. |
| **Production Vault Integration**     | Deferred | Platform Ops       | Replace local vault mock adapter with production HashiCorp Vault / KMS client in staging/prod.                                            |

---

## 4. Sprint 1 Candidate Backlog (Blueprint Section 59)

Per Blueprint Section 59, candidate work is selected from the highest-value foundational product slice driven by architectural dependencies rather than superficial demos.

> [!IMPORTANT] > **Strict Distinction:** The items below are **CANDIDATE WORK** for Sprint 1. Implementation must NOT begin until formal sprint planning and architectural kickoff.

### Item 1: Multi-Step Workflow Graph Execution

- **Owning Subsystem:** Control-Plane Orchestrator (`services/orchestrator`)
- **Applicable Contracts:** `TaskExecutionGraph`, `AcpCommand`, `AcpEvent`
- **Objective:** Extend single-task execution into multi-node directed acyclic graph (DAG) workflows with sequential and parallel node evaluation.
- **Acceptance Criteria:**
  - Orchestrator evaluates topological dependencies between tasks.
  - Node failure triggers bounded retry or branch compensation.
  - State transitions persist atomically in database.

### Item 2: Desktop Agent Filesystem & Sandbox Runtime Hardening

- **Owning Subsystem:** Desktop Agent (`apps/desktop-agent`)
- **Applicable Contracts:** `CapabilityRequest`, `CapabilityResult`, `CapabilityLease`
- **Objective:** Deepen filesystem runtime sandboxing with real OS directory jail constraints.
- **Acceptance Criteria:**
  - Agent enforces strict path traversal protections (`..` rejection, symlink canonicalization).
  - Write capabilities require explicit per-workspace authorization.
  - Full cryptographic audit evidence captured for all file modifications.

### Item 3: Local AI Model Router & ONNX / Llama Engine Integration

- **Owning Subsystem:** AI Runtime (`runtimes/local-ai`)
- **Applicable Contracts:** `ModelInferenceRequest`, `ModelInferenceResponse`
- **Objective:** Connect runtime router to real local model inference engine with GPU acceleration.
- **Acceptance Criteria:**
  - Dynamic detection of host GPU / VRAM capabilities.
  - Fallback to CPU quantized models if VRAM budget is exceeded.
  - Strict prompt template isolation preventing prompt injection leakage.

### Item 4: Web Dashboard Experience Platform (Phase 1 Skeleton)

- **Owning Subsystem:** Experience Platform (`apps/web-dashboard`)
- **Applicable Contracts:** REST API contracts, EventBus WebSocket stream
- **Objective:** Scaffold the React/Vite web dashboard for real-time task visualization.
- **Acceptance Criteria:**
  - Visual activity log displaying in-flight and completed tasks.
  - Task approval / denial controls linked to backend policy endpoint.
  - Health probe status indicator reflecting control-plane readiness.

### Item 5: Human-in-the-Loop Desktop Approval Interceptor

- **Owning Subsystem:** Desktop Agent UI (`apps/desktop-agent/src/ui/`)
- **Applicable Contracts:** `ApprovalRequest`, `ApprovalDecision`
- **Objective:** Render native desktop prompt notifications for high-risk capabilities (e.g. terminal execution, external network calls).
- **Acceptance Criteria:**
  - Interactive approval dialog with 60-second expiration timeout.
  - Denial halts task execution immediately and records audit refusal.

---

## 5. Recommended Sprint 1 Sequencing

```
┌─────────────────────────────────────────────────────────────┐
│ SPRINT 1 WEEK 1: RUNTIME & ORCHESTRATION FOUNDATIONS        │
│ 1. Multi-Step Workflow Graph Execution (services/orch)      │
│ 2. Desktop Filesystem Sandbox Hardening (apps/desktop-agent)│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ SPRINT 1 WEEK 2: AI INTEGRATION & EXPERIENCE PLANE          │
│ 3. Local AI Engine Integration (runtimes/local-ai)          │
│ 4. Human-in-the-Loop Desktop Approval UI                     │
│ 5. Web Dashboard Experience Platform (apps/web-dashboard)   │
└─────────────────────────────────────────────────────────────┘
```
