# Sprint 3 Readiness & Backlog

## NexusOS Sprint 3 — Candidate Milestones & Entry Requirements

**Document Type**: Sprint Readiness Assessment  
**Sprint**: Sprint 3 (Candidate)  
**Prepared At**: Sprint 2 Exit Gate (Task 064)  
**Baseline**: `f0b701dbefaca766d148a979c78b8df3aabb9e32`  
**Author**: NexusOS Platform Engineering

---

## 1. Sprint 2 Exit State — Architectural Foundation for Sprint 3

Sprint 3 begins with the following stable, tested infrastructure delivered by Sprint 2:

| Subsystem                                           | Delivery Sprint  | State                     |
| :-------------------------------------------------- | :--------------- | :------------------------ |
| Federated ACP & Multi-Agent Delegation              | Sprint 2 (T-060) | Stable, tested, runbooked |
| Native Quantized Local-AI with VRAM Offloading      | Sprint 2 (T-061) | Stable, tested, runbooked |
| Persistent SQLite Memory / Vector / Knowledge Graph | Sprint 2 (T-062) | Stable, tested, runbooked |
| Web Dashboard — Memory Explorer & Knowledge Graph   | Sprint 2 (T-063) | Stable, tested, runbooked |
| Multi-Agent Governance & Delegation Vertical Slice  | Sprint 2 (T-060) | Passing                   |
| Sprint 2 Security Hardening Suites (4 test files)   | Sprint 2 (T-064) | Registered in CI          |
| Operational Runbooks RB-001 through RB-024          | Sprint 0–2       | Complete catalog          |

---

## 2. Sprint 3 CANDIDATE Milestones

The following milestones are CANDIDATES for Sprint 3. They are derived from the NexusOS
authoritative roadmap (`docs/EDDs/`, `README.md`), and from known technical debts and
deferred features identified during Sprint 2 delivery.

> **IMPORTANT**: This list is advisory only. Milestone selection, sequencing, and scoping
> requires formal discovery (equivalent to a Task 064-style discovery task) before implementation.
> Sprint 3 milestones must NOT be implemented during Task 064.

---

### CANDIDATE S3-01: End-to-End Model Weight Integration & Inference Benchmarking

**Depends on**: Task 061 (VRAM offloading runtime, `HardwareDetector`, `VramOffloader`)

**Rationale**: Task 061 delivered the full native-AI runtime infrastructure but intentionally
excluded real GGUF/ONNX model weight files (not stored in repository). Sprint 3 must:

1. Define the model manifest format and storage convention for GGUF weight files
2. Implement model download, verification (checksum), and caching lifecycle
3. Execute real inference benchmarks on the RTX 3050 6GB reference hardware
4. Measure token/second throughput and VRAM usage under Q4_K_M and Q5_K_M quantization
5. Validate `InferenceExecutionPlan` accuracy against measured real-world layer placement

**Entry Criteria**:

- [ ] GGUF model weight acquisition process defined
- [ ] Model manifest schema specified in `@nexusos/contracts`
- [ ] `ModelCacheManager.download()` implemented with checksum verification

---

### CANDIDATE S3-02: Real-Time Graph Evolution — Streaming Memory Writes to Knowledge Graph

**Depends on**: Task 062 (GraphProjectionEngine, SqliteMemoryStore)

**Rationale**: The Sprint 2 Knowledge Graph engine supports write-on-demand but does not
automatically derive graph nodes/edges from new `MemoryRecord` content. Sprint 3 would:

1. Implement entity/concept extraction from memory content (NLP pipeline integration or
   heuristic extraction)
2. Automatically upsert `ENTITY`, `CONCEPT`, and `EVENT` nodes from newly written memory records
3. Derive edges from co-occurrence or explicit relationship annotations in memory metadata
4. Update the Dashboard Knowledge Graph view to show live graph evolution as memories are written

**Entry Criteria**:

- [ ] Entity extraction strategy selected (rule-based vs. embedding-based)
- [ ] `GraphProjectionEngine.deriveFromRecord()` designed and contract-specced

---

### CANDIDATE S3-03: Dashboard Real-Time Agent Telemetry & Delegation Live Tree

**Depends on**: Task 063 Phase 2 (Agent Cockpit) and Task 060 (`DelegationCoordinator`)

**Rationale**: The Sprint 2 Agent Cockpit renders static agent snapshots and delegation history
but does not stream live delegation events. Sprint 3 would:

1. Implement SSE (Server-Sent Events) stream for delegation lifecycle events from `DelegationCoordinator`
2. Display a live delegation tree in the dashboard — node-link graph updating in real-time
3. Add HITL approval/rejection actions for delegated tasks from the dashboard UI
4. Surface delegation cascade cancellation controls in the dashboard operator panel

**Entry Criteria**:

- [ ] SSE delegation event stream endpoint defined in backend
- [ ] `DashboardAPIClient` SSE subscription method designed

---

### CANDIDATE S3-04: Plugin SDK — Memory & Graph Write Capability

**Depends on**: Task 062 (SqliteMemoryStore) and `packages/plugin-sdk`

**Rationale**: Sprint 2 `packages/plugin-sdk` allows plugins to READ NexusOS context
but plugins cannot currently write to memory or the knowledge graph. Sprint 3 would:

1. Add `PluginMemoryWriteCapability` to the Plugin SDK with explicit tenant isolation contract
2. Allow whitelisted plugins to propose new `MemoryRecord` entries (via the proposal pathway —
   not direct create)
3. Implement plugin-originated provenance tracking (`sourceType: 'PLUGIN'`)
4. Add plugin write capability to the security hardening test suite

**Entry Criteria**:

- [ ] Plugin SDK capability model extended in `packages/plugin-sdk/src/index.ts`
- [ ] Plugin write capability schema spec'd in `@nexusos/contracts`

---

### CANDIDATE S3-05: Autonomous Replanning — Memory-Informed Goal Decomposition

**Depends on**: Task 062 (SqliteMemoryStore) and Sprint 1 PlannerEngine

**Rationale**: The Sprint 1 `ReplanCoordinator` triggers replanning on task failure but does not
consult the episodic memory or knowledge graph when constructing new plans. Sprint 3 would:

1. Integrate `SqliteMemoryStore` search into the `ReplanCoordinator` context window
2. Surface relevant past experiences (episodic memory) during replanning to avoid repeating failures
3. Inject knowledge graph context (related entities/concepts) into goal decomposition prompts
4. Measure replan quality improvement with and without memory context injection

**Entry Criteria**:

- [ ] PlannerEngine can accept external context injection interface defined
- [ ] Memory-informed replan contract schema defined

---

## 3. Technical Debt & Deferrals from Sprint 2

The following items were explicitly deferred from Sprint 2 and are Sprint 3 candidates:

| Item                                               | Deferred From         | Priority                                |
| :------------------------------------------------- | :-------------------- | :-------------------------------------- |
| Real GGUF model download lifecycle                 | Task 061              | HIGH — required for real local-AI usage |
| Automatic graph derivation from memory content     | Task 062              | MEDIUM — enhances knowledge graph value |
| Dashboard live delegation SSE streaming            | Task 063 Phase 2      | MEDIUM — improves operator visibility   |
| Plugin write capability for memory                 | Task 062 / Plugin SDK | LOW — requires trust model expansion    |
| Memory-informed autonomous replanning              | Sprint 1 / Task 062   | HIGH — core AI quality improvement      |
| Graph node count alerting (> 10,000 per workspace) | Task 062              | LOW — operational hygiene               |
| WAL checkpoint interval tuning for production      | Task 062              | MEDIUM — operational hardening          |

---

## 4. Sprint 3 Entry Checklist

Before Sprint 3 can begin implementation, the following must be verified:

- [ ] Sprint 2 DoD audit (`sprint2-dod.test.ts`) passes 10/10 in CI
- [ ] All Sprint 2 completion reports present: `task_060_`, `task_061_`, `task_062_`, `task_063_*`
- [ ] `SPRINT_2_COMPLETION_REPORT.md` formally signed off
- [ ] `docs/RESOURCE_BASELINE.md` §5 Sprint 2 section present with observed measurements
- [ ] All Sprint 2 runbooks (RB-021 through RB-024) reviewed by Platform Operations
- [ ] Sprint 3 milestone sequencing confirmed via discovery task (equivalent to Task 064)
- [ ] Sprint 3 baseline commit recorded (derived from `f0b701db` + Task 064 governance files)

---

## 5. Architecture Constraints for Sprint 3

The following architectural constraints remain binding in Sprint 3:

1. **Single SQLite authority**: No second persistent memory store may be introduced
2. **Loopback-only inference**: `validateLoopbackEndpoint()` guard must remain active
3. **Delegation safety limits**: `MAX_DEPTH = 3`, `MAX_FAN_OUT = 5` — changes require EDD update
4. **Graph traversal bounds**: `maxDepth ≤ 4`, `limit ≤ 100` — changes require security review
5. **Package isolation**: `packages/contracts` and `packages/plugin-sdk` must not depend on backend implementation packages
6. **No runtime permission escalation**: Memory, graph, and delegation data remain data-only, never used as permission or capability grants

---

_Document prepared: 2026-09-10 | Sprint 2 Exit Gate (Task 064) | NexusOS Platform Engineering_
