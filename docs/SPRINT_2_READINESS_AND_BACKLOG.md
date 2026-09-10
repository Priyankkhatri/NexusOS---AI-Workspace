# Sprint 2 Readiness Assessment & Candidate Backlog

**Authoritative Sources:**

- NexusOS Sprint 0 Implementation Blueprint — Section 58 (Definition of Ready for Next Sprint)
- NexusOS Architecture Bible & Subsystem EDDs (Backend, Desktop Agent, AI Runtime, Experience Platform)
- Sprint 1 Completion Report (`SPRINT_1_COMPLETION_REPORT.md`)

---

## 1. Sprint 1 Exit & Sprint 2 Readiness Assessment

Sprint 2 begins only when the core readiness criteria adapted from Blueprint Section 58 are satisfied. Below is the audited status at the conclusion of Sprint 1:

| Criterion                                         | Status        | Evidence / Repository Verification                                                                                                     |
| :------------------------------------------------ | :------------ | :------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Repository foundation is stable**            | **SATISFIED** | Monorepo toolchain locked (Node 24.14.1, pnpm 11.21.0, TS 5.7.3), reproducible builds, zero dirty git state.                           |
| **2. Contracts are versioned & complete**         | **SATISFIED** | `@nexusos/contracts` (`v0.1.0-sprint0`) exports typed schemas across all 10 Sprint 1 subsystems with zero circular dependencies.       |
| **3. Architecture dependencies are clear**        | **SATISFIED** | Subsystem boundaries documented in `docs/ARCHITECTURE_INDEX.md` and enforced by ESLint boundary rules and `scripts/validate-repo.js`.  |
| **4. Core CI gates are 100% green**               | **SATISFIED** | GitHub Actions CI workflow runs `format:check`, `lint`, `typecheck`, `test`, `build`, `validate`, and `security` (1097 tests passing). |
| **5. Development environments work**              | **SATISFIED** | Setup verified in `docs/LOCAL_DEVELOPMENT.md`; all 8 workspace packages build and test locally.                                        |
| **6. Vertical slices proven across all runtimes** | **SATISFIED** | 11 dedicated vertical-slice security suites passing (Tasks 047 through 058).                                                           |
| **7. Critical blockers are resolved**             | **SATISFIED** | Zero open P0/P1 architectural blockers; execution leases, approval interceptors, and memory boundaries verified.                       |
| **8. Remaining risks have owners**                | **SATISFIED** | Risk register maintained in Sprint 1 Completion Report with assigned engineering owners.                                               |
| **9. Operational runbooks cataloged**             | **SATISFIED** | 20 operational runbooks (`RB-001` through `RB-020`) cataloged in `docs/RUNBOOKS.md`.                                                   |
| **10. Resource baseline established**             | **SATISFIED** | Updated Sprint 1 baseline recorded in `docs/RESOURCE_BASELINE.md` via `scripts/measure-resource-baseline.js`.                          |

---

## 2. Prerequisites Satisfied & Architecture Foundations

The following 10 foundational subsystems were completed and hardened in Sprint 1:

1. **Multi-Step Workflow Graph Execution (M1 / Task 049):** DAG topology validation, cycle detection, and composite leases.
2. **Desktop Filesystem Sandbox Runtime Hardening (M2 / Task 050):** OS directory jail, path canonicalization, and symlink protection.
3. **Local AI Model Router & Engine Integration (M3 / Task 051):** Model routing, hardware detection, fallback circuit breaker, and prompt isolation.
4. **Human-in-the-Loop Desktop Approval Interceptor (M4 / Task 052):** Native desktop prompt dialog, 60s timeout, and HMAC-signed decision evidence.
5. **Web Dashboard Experience Platform (M5 / Task 053):** Real-time WebSocket activity streaming, task controls, and audit evidence view.
6. **Plugin SDK & Governed Extensibility (M6 / Task 054):** PluginManifest validation, cryptographic signatures, 2FA capability leases, and quarantine.
7. **Browser Runtime Hardening & Web Automation (M7 / Task 055):** Headless Chrome CDP automation, ephemeral profile isolation, and SSRF defense.
8. **Memory / Context Runtime Foundation (M8 / Task 056):** Governed persistent memory store, memory leases, and untrusted delimiter isolation.
9. **Autonomous Workflow Orchestrator & Goal Decomposer (M9 / Task 057):** Goal normalizer, decomposer, closed capability registry, and 3-iteration replan cap.
10. **Cross-Session Episodic Learning & Memory Graph (M10 / Task 058):** Extractive compression, citation preservation, knowledge graph projection, and cascade forgetting.

---

## 3. Remaining Risks & Deferred Items (Non-Blocking)

| Risk / Deferred Item                    | Severity | Owner               | Mitigation / Sprint 2 Plan                                                                                                |
| :-------------------------------------- | :------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------ |
| **Native GGUF / ONNX Weight Execution** | Medium   | AI Runtime Team     | Integrate native runtime engine bindings (e.g. `node-llama-cpp` or ONNX Runtime Node) with streaming VRAM offloading.     |
| **Persistent Distributed Graph Store**  | Medium   | Platform Data Team  | Transition memory knowledge graph from in-memory store to SQLite/Neo4j persistent backend with ACID transaction rollback. |
| **Multi-Agent Protocol Federation**     | Low      | Architecture Team   | Formalize Agent Control Protocol (ACP) federation across multiple physical or virtual agent devices.                      |
| **Cloud State Sync & Enterprise RBAC**  | Low      | Identity / Security | Implement multi-tenant cloud synchronization with OIDC/SAML single sign-on and role-based access control.                 |

---

## 4. Candidate Sprint 2 Roadmap & Backlog

The items below represent candidate architectural initiatives for Sprint 2, classified according to commitment level:

### Item 1: Advanced Multi-Agent Collaboration & Sub-Agent Delegation [CANDIDATE]

- **Owning Subsystem:** Control-Plane Orchestrator (`services/backend`), Desktop Agent (`apps/desktop-agent`)
- **Applicable Contracts:** `AcpFederationMessage`, `SubAgentDelegationRequest`, `CompositeLease`
- **Objective:** Extend autonomous workflow execution to federate tasks across specialized sub-agents with delegated capability leases.
- **Acceptance Criteria:**
  - Parent agent delegates bounded sub-tasks to child agents with attenuated capability leases.
  - Sub-agent execution receipts roll up hierarchically into parent evidence trees.
  - Failure in child agent triggers localized compensation without crashing the parent workflow.

### Item 2: Native Quantized Local-AI Model Execution (vLLM / ONNX) [CANDIDATE]

- **Owning Subsystem:** AI Runtime (`runtimes/local-ai`)
- **Applicable Contracts:** `ModelInferenceRequest`, `ModelInferenceResponse`, `HardwareProfile`
- **Objective:** Attach real quantized model execution (e.g. Llama 3 8B Q4_K_M or Phi-3) using native engine bindings.
- **Acceptance Criteria:**
  - Automatic offloading of transformer layers between CPU RAM and GPU VRAM based on measured headroom.
  - Deterministic fallback when VRAM budget is exceeded.
  - Strict token streaming through prompt isolation boundaries.

### Item 3: Persistent Distributed Graph Store & Vector Search [CANDIDATE]

- **Owning Subsystem:** Backend Memory Subsystem (`services/backend/src/memory`)
- **Applicable Contracts:** `MemoryGraphQueryRequestSchema`, `MemorySearchRequestSchema`
- **Objective:** Provide disk-backed SQLite / vector embeddings for episodic memory and knowledge graph projections.
- **Acceptance Criteria:**
  - Graph traversals persist across service restarts.
  - Atomic cascade tombstoning backed by database transactions.
  - Vector similarity search integrated with untrusted delimiter wrapping.

### Item 4: Cloud State Sync & Enterprise RBAC [DEFERRED]

- **Owning Subsystem:** Identity & Policy (`services/identity`, `services/policy`)
- **Applicable Contracts:** `TenantRbacPolicy`, `SyncCheckpoint`
- **Objective:** Centralized cloud synchronization of task receipts and enterprise directory integration.
- **Status:** Deferred to Sprint 3.

---

## 5. Contract Versioning Roadmap

1. **Sprint 1 Baseline:** `@nexusos/contracts` (`v0.1.0-sprint0`).
2. **Sprint 2 Initialization:**
   - Bump package version to `@nexusos/contracts@0.2.0-sprint1` reflecting the finalized canonical contracts delivered across Tasks 049 through 058.
   - Maintain strict backwards compatibility and zero service dependencies.

---

## 6. Recommended Sprint 2 Sequencing

```
┌─────────────────────────────────────────────────────────────┐
│ SPRINT 2 PHASE 1: NATIVE AI & PERSISTENT KNOWLEDGE GRAPH    │
│ 1. Native Model Execution & VRAM Offloading (local-ai)      │
│ 2. Persistent SQLite/Vector Graph Store (services/memory)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ SPRINT 2 PHASE 2: MULTI-AGENT FEDERATION & ENTERPRISE SYNC   │
│ 3. Multi-Agent Delegation & Federated ACP (apps/desktop)    │
│ 4. Web Dashboard Multi-Agent View & Timeline (web-dashboard)│
└─────────────────────────────────────────────────────────────┘
```
