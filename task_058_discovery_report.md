# Task 058 Discovery Report

## 1. Exact Task Identity

### 1.1 Canonical Identity Analysis

An exhaustive audit of the authoritative project documentation, git history, and prior milestone discovery/completion reports reveals the exact architectural context and options for **Task 058**:

- **Preceding Frontier**: `Task 057: Sprint 1 Milestone 9 — Autonomous Workflow Orchestrator & Adaptive Goal Decomposer` (Closed & verified GREEN at baseline commit `af6a6e8b29b719a099aadfebea00bca2dc0a0cc1`).
- **Authoritative Citations in Repository**:
  - `task_056_discovery_report.md` (lines 21, 223, 313):
    - _"Downstream Work Blocked by Task 056: Task 058+: Cross-Session Episodic Learning, Memory Compression & Graph Retrieval Projections"_
    - _"No unsupervised memory compression or recursive graph summarization (deferred to Task 058)."_
    - _"Advanced automated hierarchical memory summarization and graph projection (Task 058)."_
  - `task_057_discovery_report.md` (lines 26–28, 488, 499):
    - _"Downstream Work Blocked by Task 057: Task 058+: Cross-Session Episodic Learning, Memory Compression & Graph Retrieval Projections (Sprint 2)"_
    - _"Sprint 1 Hardening, Quality Gate Finalization & Sprint 2 Readiness Exit Gate"_
    - _"Cross-session episodic learning, memory compression, and graph retrieval projections (Deferred to Task 058+ / Sprint 2)."_
    - _"Cross-session episodic graph indexing (Task 058)."_
  - `docs/SPRINT_1_READINESS_AND_BACKLOG.md`: Originally budgeted Items 1–5 (Tasks 049–053). Tasks 054 (M6), 055 (M7), 056 (M8), and 057 (M9) implemented the remaining candidate items from Blueprint Section 59 (`plugin SDK`, `Browser Runtime`, `memory foundation`, `richer task creation / autonomous workflow orchestrator`).
  - `docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md` (Sections 52, 56, 58, 59): In the NexusOS sprint lifecycle, every sprint culminates in a formal hardening and readiness exit gate (analogous to Sprint 0 Milestone M7 / Task 048).

### 1.2 Separation of Fact, Inference, and Open Question

#### FACT

1. `task_056_discovery_report.md` and `task_057_discovery_report.md` explicitly reserved the identifier **"Task 058"** for **Cross-Session Episodic Learning, Memory Compression & Graph Retrieval Projections**.
2. All 10 candidate foundational feature areas listed in Blueprint Section 59 have been implemented and verified green across Sprint 1 Milestones 1 through 9 (Tasks 049–057).
3. In Sprint 0, the milestone sequence ended with a formal exit gate: `TASK 048: MILESTONE M7 — SPRINT 0 HARDENING, QUALITY GATE FINALIZATION & SPRINT 1 READINESS (SPRINT 0 EXIT)`.
4. `task_057_discovery_report.md` Section 1 explicitly listed two downstream unblocked tracks following Milestone 9:
   - Track A: `Task 058+: Cross-Session Episodic Learning, Memory Compression & Graph Retrieval Projections (Sprint 2)`
   - Track B: `Sprint 1 Hardening, Quality Gate Finalization & Sprint 2 Readiness Exit Gate`

#### INFERENCE

Based on the repository's sprint structure and precedent, there are two distinct, authoritative architectural candidates for Task 058:

- **Candidate 1 (Feature Advancement — AI Runtime / Memory Graph Intelligence)**:
  - **Canonical Title**: `TASK 058: SPRINT 1 MILESTONE 10 — CROSS-SESSION EPISODIC LEARNING, MEMORY COMPRESSION & GRAPH RETRIEVAL PROJECTIONS` (or if placed as the opening of Sprint 2: `TASK 058: SPRINT 2 MILESTONE 1 — CROSS-SESSION EPISODIC LEARNING, MEMORY COMPRESSION & GRAPH RETRIEVAL PROJECTIONS`).
  - **Focus**: Building the Context Continuity Engine (CCE) components: episodic episode recording from execution receipts, lossiness-tracked memory compression, graph projections for entity/task relationships, and checkpoint restoration validation.
- **Candidate 2 (Lifecycle Governance — Terminal Sprint 1 Exit Gate)**:
  - **Canonical Title**: `TASK 058: SPRINT 1 MILESTONE 10 — SPRINT 1 HARDENING, QUALITY GATE FINALIZATION & SPRINT 2 READINESS (SPRINT 1 EXIT)`.
  - **Focus**: Analogous to Task 048 for Sprint 0. Consolidating and hardening all 9 Sprint 1 subsystems (Tasks 049–057), auditing the 1043 test baseline across 202 suites, extending the operational runbooks (`RB-001`–`RB-010`) to cover Sprint 1 failure domains, measuring the Sprint 1 resource baseline (`scripts/measure-resource-baseline.js`), generating `SPRINT_1_COMPLETION_REPORT.md`, and formulating `docs/SPRINT_2_READINESS_AND_BACKLOG.md`.

#### OPEN QUESTION

- Does project leadership intend for **Task 058** to be:
  - **Option 1**: **Sprint 1 Milestone 10: Cross-Session Episodic Learning, Memory Compression & Graph Retrieval Projections** (advancing memory intelligence before exiting Sprint 1)?
  - **Option 2**: **Sprint 1 Milestone 10: Sprint 1 Hardening, Quality Gate Finalization & Sprint 2 Readiness (Sprint 1 Exit)** (formalizing the exit of Sprint 1 first, with Episodic Learning becoming Task 059 / Sprint 2 Milestone 1)?
- _Resolution_: This Discovery Report provides the complete, authoritative specification, contract analysis, security threat model, and implementation roadmap for **Candidate 1 (the explicitly cited Task 058 identity)** while fully preserving the requirements and verification for Candidate 2.

---

## 2. Baseline / Repository State

- **Current Baseline Commit SHA**: `af6a6e8b29b719a099aadfebea00bca2dc0a0cc1`
- **Active Git Branch**: `main`
- **Remote Tracking**: In lockstep with `origin/main` (`git rev-parse HEAD` == `git rev-parse origin/main` == `af6a6e8b29b719a099aadfebea00bca2dc0a0cc1`).
- **Working Tree State**: Clean (0 modified, 0 untracked files prior to this report).
- **Monorepo Build & Typecheck**:
  - `pnpm -r build`: 100% clean across all 7 workspace packages (`@nexusos/contracts`, `@nexusos/backend`, `@nexusos/desktop-agent`, `@nexusos/local-ai`, `@nexusos/web-dashboard`, `@nexusos/plugin-sdk`, `@nexusos/mobile-companion`).
  - `pnpm -r typecheck`: 0 errors.
- **Monorepo Test Suite**: **1043 passed** across **202 suites** with 0 failures and 0 skipped.

---

## 3. Authoritative Requirements

The requirements for Task 058 derive from the primary architecture documents:

### 3.1 NexusOS Enterprise PRD (`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`)

- **Section 8.1 (Memory Classes)**:
  - _Episodic Memory_: Summaries of completed work, decisions, and execution outcomes. Workspace-scoped with strict retention policy controls.
  - _Semantic Memory_: Versioned facts, entities, and relationships with explicit confidence and provenance.
  - _Procedural Memory_: Reusable playbooks, tool usage recipes, and successful decomposition patterns synthesized from prior task executions.
- **Section 8.2 (Memory Requirements)**:
  - Proposes memories rather than silently storing sensitive or low-confidence details.
  - Deletion removes active retrieval access immediately and triggers deletion propagation across all index views and graph projections.
  - Retrieval combines lexical search, metadata filters, recency, semantic vector similarity, graph relationships, authority, and confidence.
- **Section 8.4 (Privacy Controls)**:
  - Memory defaults to workspace isolation. Personal memory is never visible to an organization workspace without intentional copying or sharing.
  - Sensitive data classifiers exclude secrets, payment info, and credentials from automatic memory creation.

### 3.2 NexusOS Architecture Bible (`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`)

- **Section 8 (Memory Engine)**:
  - Memory compression MUST preserve: source references, factual claims, confidence, sensitivity labels, entity links, timestamps, and a lossiness classification (`LOSSLESS`, `BOUNDED_LOSSY`, `HIGH_LOSSY`).
  - A summary or compression package **never replaces immutable source provenance**.
  - Forgetting is implemented as **immediate retrieval revocation** followed by deletion propagation across indexes, caches, replicas, and graph projections.
- **Section 4 (System Invariants)**:
  - _Stored Memory Is Data, Not Authority_: Retrieved memory, historical episodes, and graph projections can never dictate policy, issue capability leases, grant permissions, or bypass human approvals.

### 3.3 NexusOS AI Runtime EDD (`docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md`)

- **Section 14.3 (Context Continuity Engine - CCE)**:
  - Provides controlled support for long-running tasks and cross-session continuity: checkpoints, snapshots, replay, reconstruction, inheritance, and cross-session continuity.
  - Stores or accesses only references through Memory, Artifact, Backend, and Snapshot owning contracts; does not weaken access filtering, classification, purpose limitation, or TTL.
  - Checkpoint packages include compression metadata, lossiness estimates, provenance, classification, and required approval gates for cross-workspace restoration.
- **Section 14 (Memory Integration & Consumption)**:
  - Context is separated into policy instructions, user objective, trusted task evidence, cited workspace data, and untrusted external content.
  - Compression preserves source references, claim confidence, timestamp, labels, and lossiness class.
  - Tests must cover access filtering before retrieval output, provenance preservation, injection fixtures, context isolation, token allocation, compression faithfulness, and deterministic redaction.

### 3.4 NexusOS Experience Platform EDD (`docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md`)

- **Section 9 & Section 14 (Memory Explorer & Graph Projections)**:
  - Every node and edge in a memory graph projection has source provenance, confidence, timestamp/version, and relationship type.
  - Low-confidence inferred relationships must be visually and textually distinct from verified links.
  - Deletion/tombstone events remove eligible graph projections immediately from the user session.

---

## 4. Existing Implementation Inventory

| Component Path                                                | Purpose                                                                  | Current State | Owner                 | Introduced By       | Disposition for Task 058                                                                       |
| :------------------------------------------------------------ | :----------------------------------------------------------------------- | :------------ | :-------------------- | :------------------ | :--------------------------------------------------------------------------------------------- |
| `packages/contracts/src/memory/`                              | Canonical memory schemas, types, escaping, and context formatting        | Production    | Shared Contracts      | Task 056            | **EXTEND**: Add compression, lossiness, episodic, and graph projection contracts               |
| `packages/contracts/src/planner/`                             | Planner schemas, strategy enums, DAG safety limits, and replanning types | Production    | Shared Contracts      | Task 057            | **REUSE**: Ingest completed workflow DAG execution receipts for episodic learning              |
| `packages/contracts/src/tasks/`                               | Task execution graphs, ACP commands, and receipts                        | Production    | Shared Contracts      | Task 049 / Task 057 | **REUSE**: Extract execution evidence and terminal outcomes                                    |
| `services/backend/src/memory/memory-service.ts`               | Governed memory CRUD, access filtering, secret scanning, and tombstoning | Production    | Backend Control Plane | Task 056            | **EXTEND**: Integrate episodic synthesis, compression engine, and graph projection queries     |
| `services/backend/src/memory/memory-store.ts`                 | In-memory / lexical store with tenant and workspace isolation            | Production    | Backend Control Plane | Task 056            | **EXTEND**: Add graph relationship storage (nodes & edges) and compression metadata            |
| `services/backend/src/planner/`                               | Autonomous workflow orchestrator, decomposer, and replan coordinator     | Production    | AI Runtime / Backend  | Task 057            | **REUSE**: Supply task goal, decomposition structure, and replan rationale to episodic learner |
| `services/backend/src/audit/`                                 | Cryptographic audit logger and event publisher                           | Production    | Backend Control Plane | Task 015+           | **REUSE**: Emit audit events for episodic memory creation, compression, and graph revocation   |
| `services/backend/src/auth/`                                  | Tenant, workspace, and principal auth context                            | Production    | Backend Control Plane | Task 018+           | **REUSE**: Enforce multi-tenant and workspace boundaries on all graph traversals               |
| `services/backend/src/security/redaction-filter.ts`           | Regex-based secret, token, and credential scanning/redaction             | Production    | Backend Security      | Task 038+           | **REUSE**: Scan episodic summaries and compressed memories before persistence                  |
| `apps/desktop-agent/src/memory/memory-cache-manager.ts`       | Ephemeral L1 in-memory cache for local agent execution                   | Production    | Desktop Agent         | Task 03E/03K        | **LEAVE UNTOUCHED**: L1 execution cache is distinct from governed persistent memory            |
| `tests/vertical-slice/memory-governed-vertical-slice.test.ts` | Vertical slice test for Task 056 memory lifecycle and authority boundary | Production    | QA / Security         | Task 056            | **REUSE & COMPLEMENT**: Add new episodic & compression vertical slice                          |
| `docs/runbooks/`                                              | Operational runbooks for 10 system failure domains (`RB-001`–`RB-010`)   | Production    | Platform Ops          | Task 048            | **EXTEND**: If Candidate 2 / Sprint 1 Exit is executed, add `RB-011`–`RB-019`                  |
| `scripts/measure-resource-baseline.js`                        | Resource measurement script for CPU, RAM, GPU, VRAM, and disk            | Production    | Monorepo Tooling      | Task 048            | **REUSE**: Execute to record Sprint 1 resource baseline if Candidate 2 is executed             |

---

## 5. Canonical Contract Gap

### 5.1 Existing Contracts (`packages/contracts/src/memory/index.ts`)

The current contract package exports:

- Enums: `MemoryClass`, `MemorySensitivity`, `MemoryStatus`, `MemorySourceType`.
- Types & Schemas: `MemoryProvenanceSchema`, `MemoryRetentionPolicySchema`, `MemoryRecordSchema`, `MemoryCreateRequestSchema`, `MemoryUpdateRequestSchema`, `MemorySearchRequestSchema`, `MemorySearchResultItemSchema`, `MemorySearchResponseSchema`, `MemoryProposalSchema`, `MemoryTombstoneResponseSchema`.
- Helpers: `escapeUntrustedMemoryContent`, `estimateTokenCount`, `formatRetrievedContext`.

### 5.2 Missing Contracts for Task 058 (Candidate 1)

To support cross-session episodic learning, memory compression, and graph projections, the following canonical contracts are missing:

1. **Lossiness Classification & Compression Strategy**:

   - `LossinessClassSchema`: `z.enum(['LOSSLESS', 'BOUNDED_LOSSY', 'HIGH_LOSSY'])`
   - `CompressionStrategySchema`: `z.enum(['EXTRACTIVE', 'ABSTRACTIVE', 'HIERARCHICAL_SUMMARIZATION'])`
   - `MemoryCompressionRequestSchema`: Input specifying target memory IDs, max token budget, allowed lossiness, and preservation instructions (e.g. preserve code snippets, file paths, error codes).
   - `MemoryCompressionResponseSchema`: Output record with preserved claims, compression ratio, lossiness class, and immutable array of source memory citations.

2. **Episodic Episode & Learning Proposals**:

   - `EpisodicEpisodeSchema`: Captures a completed task run: `taskId`, `goal`, `planGraphVersion`, `nodeReceipts` (outcomes, errors, tool calls), `humanDecisions` (approvals, denials), `outcomeStatus` (`SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`), and `synthesisStatus`.
   - `ProceduralPlaybookProposalSchema`: Synthesizes reusable playbooks or decomposition recommendations (`goalPattern`, `recommendedGraph`, `confidence`, `successCount`, `failureCount`).

3. **Memory Knowledge Graph Projections**:

   - `MemoryGraphNodeTypeSchema`: `z.enum(['ENTITY', 'CONCEPT', 'TASK', 'WORKSPACE', 'DECISION', 'ARTIFACT', 'ERROR_PATTERN'])`
   - `MemoryGraphEdgeTypeSchema`: `z.enum(['DERIVED_FROM', 'RELATES_TO', 'SUPERSEDES', 'DECIDED_IN', 'EXECUTED_BY', 'RESOLVED_BY'])`
   - `MemoryGraphNodeSchema`: `id`, `tenantId`, `workspaceId`, `nodeType`, `label`, `memoryRecordId` (optional link to canonical record), `properties`, `confidence`.
   - `MemoryGraphEdgeSchema`: `id`, `sourceNodeId`, `targetNodeId`, `edgeType`, `weight`, `confidence`, `provenance`.
   - `MemoryGraphQueryRequestSchema` & `MemoryGraphQueryResponseSchema`: Filtered traversal by depth, edge types, and min confidence within tenant/workspace.

4. **Context Continuity Engine (CCE) Checkpoint**:
   - `ContextCheckpointSchema`: Snapshot of working context, active citations, lossiness metadata, token budget, and compatibility version.

---

## 6. Architecture Gap Analysis

```
CURRENT STATE (Task 057 Baseline)
├── Memory Service (Task 056): Individual records, lexical search, manual proposals, tombstones
├── Planner Service (Task 057): Decomposes goals into PROPOSED DAGs, replans on failure
└── Execution Engine (Task 049): Deterministically executes leased nodes on Desktop Agent
                                ↓
TASK 058 TARGET STATE (Candidate 1: Memory Graph & Episodic Learning)
├── Context Continuity Engine (CCE): Checkpoints and cross-session task continuity
├── Episodic Learner: Ingests completed task execution receipts → synthesizes episodic records & playbooks
├── Memory Compressor: Lossiness-tracked hierarchical summarization preserving source citations
└── Graph Projection Engine: Entity-relationship graph queries scoped strictly to tenant & workspace
                                ↓
MISSING PIECES
├── 1. Canonical contracts in packages/contracts/src/memory/ (compression, episodic, graph)
├── 2. services/backend/src/memory/episodic-learner.ts (receipt ingestion & playbook synthesis)
├── 3. services/backend/src/memory/memory-compressor.ts (lossiness-tracked context compression)
├── 4. services/backend/src/memory/graph-engine.ts (isolated graph node/edge store & projection)
└── 5. services/backend/src/memory/cce-service.ts (checkpoint creation, validation & restoration)
```

### Relationship to Completed Milestones (Tasks 049–057)

- **Task 049 (DAG Execution)**: Task 058 consumes task execution graphs and node receipts as inputs to episodic learning.
- **Task 050 (Filesystem)** & **Task 055 (Browser)**: Execution receipts generated by filesystem and browser runtimes provide grounded factual evidence for episodic memories.
- **Task 051 (Local AI)**: Used optionally for abstractive summarization and embedding calculation under strict prompt isolation.
- **Task 052 (HITL Approvals)**: Explicit human approvals and denials are recorded in episodic memory as ground-truth user preferences.
- **Task 056 (Persistent Memory)**: Foundational substrate. Task 058 builds directly on top of Task 056 contracts and store.
- **Task 057 (Planner / Replanner)**: Supplies the goal decomposition tree and replan history to the episodic learner.

---

## 7. Security Threat Model

| Invariant ID   | Security Boundary                  | Threat Description                                                                                | Mitigation & Enforcement Mechanism                                                                                                                                                                |
| :------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **058-SEC-01** | **Authority Boundary**             | Stored memory, episodic summary, or graph edge attempts to elevate authority or bypass policy     | **STORED MEMORY IS DATA, NOT AUTHORITY**. Output of graph traversal or compression is strictly tagged `<<<UNTRUSTED_RETRIEVED_MEMORY>>>`. Memory can never authorize leases or grant scopes.      |
| **058-SEC-02** | **Provenance & Lossiness**         | Compressed summary drops source references or hallucinates facts without attribution              | Immutable citation arrays required on all compressed records. Must declare `LossinessClass` (`LOSSLESS`, `BOUNDED_LOSSY`, `HIGH_LOSSY`).                                                          |
| **058-SEC-03** | **Workspace & Tenant Isolation**   | Cross-session graph traversal crosses workspace or tenant boundary (data exfiltration)            | All graph node/edge queries enforce strict `tenantId` and `workspaceId` matching before graph traversal or projection. Traversal across workspaces is rejected fail-closed.                       |
| **058-SEC-04** | **Sensitivity Inheritance**        | Summarizing confidential/restricted records downgrades sensitivity to internal/public             | Compressed and synthesized episodic memories must automatically inherit the **highest sensitivity tier** of any constituent source record.                                                        |
| **058-SEC-05** | **Atomic Forgetting & Revocation** | Tombstoned memory continues to be returned in graph projections or compressed summaries           | Tombstoning a memory record immediately invalidates all dependent graph projections and triggers re-indexing/tombstoning of derived summaries.                                                    |
| **058-SEC-06** | **Episodic Poisoning Defense**     | Adversarial or compromised task execution attempts to inject malicious playbooks                  | Procedural playbooks synthesized from execution runs default to `PROPOSED` status and require explicit confidence thresholding (&ge; 0.90) or human approval before being activated for planning. |
| **058-SEC-07** | **Secret & Credential Leakage**    | Task execution outputs containing API keys or passwords are baked into persistent episodic memory | All task outputs and candidate summaries pass through `RedactionFilter` before persistence; detected secrets trigger fail-closed rejection.                                                       |

---

## 8. Existing Authority Reuse

| Subsystem / Task                   | Disposition      | Reuse Rationale & Boundary Protection                                                                                      |
| :--------------------------------- | :--------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Task 049 (DAG Execution)**       | **REUSE**        | Do NOT build a second task executor. Ingest execution receipts produced by `WorkflowEngine`.                               |
| **Task 050 (Filesystem Sandbox)**  | **REUSE**        | Do NOT build new sandbox mechanisms. Memory persistence uses backend database/store only.                                  |
| **Task 051 (Local AI Runtime)**    | **REUSE**        | AI summarization or embeddings must route through `LocalAiRuntime` / model router with prompt isolation.                   |
| **Task 052 (HITL Approvals)**      | **REUSE**        | Do NOT build a second approval system. Procedural memory proposals reuse existing approval lifecycle.                      |
| **Task 053 (Web Dashboard)**       | **REUSE**        | Experience plane surfaces memory explorer; do not alter dashboard server architecture.                                     |
| **Task 054 (Plugin Governance)**   | **NOT RELEVANT** | Plugin SDK operates on capability plane; memory engine does not evaluate plugins directly.                                 |
| **Task 055 (Browser Runtime)**     | **REUSE**        | Ingest browser receipts for web research tasks; do not touch browser engine.                                               |
| **Task 056 (Persistent Memory)**   | **EXTEND**       | Primary substrate. Extend `MemoryService`, `IMemoryStore`, and canonical contracts with compression and graph projections. |
| **Task 057 (Planner / Replanner)** | **REUSE**        | Planner consumes episodic memories and playbooks as untrusted hints; planner logic remains unchanged.                      |

---

## 9. Data / State / Lifecycle

### 9.1 Data Models & Schemas

- **Episodic Record**: Immutable snapshot of completed task run. Scoped to `tenantId` and `workspaceId`.
- **Memory Graph**: Property graph (`MemoryGraphNode`, `MemoryGraphEdge`). Stored in relational/document store alongside memory records.
- **Compressed Memory Record**: Sub-class of `MemoryRecord` with `class: EPISODIC` or `class: SEMANTIC`, containing `compressionMetadata: { strategy, lossiness, sourceRecordIds, preservedClaims }`.

### 9.2 Lifecycle & Retention

- **Creation**: Produced upon task completion (`TASK_COMPLETED`, `TASK_FAILED`) by `EpisodicLearner`.
- **Compression**: Triggered on-demand or when context token budget for a workspace/topic exceeds thresholds.
- **Tombstoning & Deletion**: Deletion of a parent memory record triggers immediate revocation of related graph edges and marks derived compressions as `STALE` or tombstoned.
- **Idempotency**: Episodic synthesis is idempotent per `taskId` using deduplication hashes on execution receipts.

---

## 10. Failure & Recovery Semantics

| Scenario                                         | Architectural Handling                                                       | Semantics               |
| :----------------------------------------------- | :--------------------------------------------------------------------------- | :---------------------- |
| **Malformed Compression Request**                | Reject request immediately with structured validation error                  | **FAIL CLOSED**         |
| **Cross-Tenant Graph Traversal**                 | Abort query immediately, emit security audit event, return empty result      | **FAIL CLOSED**         |
| **Secret Detected in Summary**                   | Abort memory persistence, emit security alert, discard candidate record      | **FAIL CLOSED**         |
| **Transient Model Failure during Summarization** | Fall back to extractive summarization heuristic (lossiness: `BOUNDED_LOSSY`) | **FALLBACK / DEGRADE**  |
| **Graph Edge Conflict / Duplicate**              | Upsert edge with incremented confidence and updated timestamp                | **RECONCILE**           |
| **Stale Context Checkpoint**                     | Validate against current schema version; reject restoration if incompatible  | **SURFACE UNCERTAINTY** |
| **Backend Crash during Synthesis**               | Resumable from task receipt in durable queue; idempotent upsert by `taskId`  | **RETRY / IDEMPOTENT**  |

---

## 11. Observability

### 11.1 Required Audit & Activity Events

- `MEMORY_COMPRESSION_EXECUTED`: Emitted when memory compression runs, recording input/output token counts, lossiness class, and source IDs.
- `EPISODIC_RECORD_SYNTHESIZED`: Emitted when a task run is synthesized into an episodic memory record.
- `PROCEDURAL_PLAYBOOK_PROPOSED`: Emitted when a reusable workflow pattern is proposed.
- `GRAPH_PROJECTION_UPDATED`: Emitted when new graph nodes or edges are created or revoked.
- `MEMORY_FORGETTING_PROPAGATED`: Emitted when a tombstone causes graph edge revocation and summary invalidation.

### 11.2 Telemetry Restrictions

- **Prohibited**: Plaintext prompts, secret tokens, raw file contents, or private personal data in telemetry spans.
- **Permitted**: Token counts, compression ratios, latency, edge counts, node counts, classification labels, and tenant/workspace IDs.

---

## 12. Testing Gap

### 12.1 Existing Test Baseline

- Total passing tests: **1043 tests** across **202 suites**.
- Existing memory tests: `packages/contracts/tests/memory/`, `services/backend/tests/memory/`, `tests/vertical-slice/memory-governed-vertical-slice.test.ts`.

### 12.2 Required Tests for Task 058 (Candidate 1)

1. **Contract Tests** (`packages/contracts/tests/memory/`):
   - Validation of `MemoryCompressionRequestSchema`, `LossinessClassSchema`, `EpisodicEpisodeSchema`, `MemoryGraphNodeSchema`, `MemoryGraphEdgeSchema`.
2. **Unit Tests** (`services/backend/tests/memory/`):
   - `episodic-learner.test.ts`: Receipt parsing, decision extraction, playbook proposal generation, idempotency by `taskId`.
   - `memory-compressor.test.ts`: Extractive & abstractive compression, token budget enforcement, citation preservation.
   - `graph-engine.test.ts`: Node and edge creation, access-filtered traversal, depth limits, cycle handling.
3. **Security Invariant Tests** (`services/backend/tests/memory/`):
   - `058-SEC-01`: Untrusted context packaging verification (stored memory cannot inject system instructions).
   - `058-SEC-02`: Lossiness class and source provenance retention verification.
   - `058-SEC-03`: Multi-tenant and workspace graph isolation verification (traversal across workspaces strictly blocked).
   - `058-SEC-04`: Sensitivity inheritance verification (summary inherits highest sensitivity).
   - `058-SEC-05`: Atomic tombstone propagation to graph edges and derived summaries.
   - `058-SEC-06`: Poisoned execution receipt rejection and proposal gating.
   - `058-SEC-07`: Secret redaction in episodic summaries.
4. **Vertical Slice Test** (`tests/vertical-slice/episodic-memory-vertical-slice.test.ts`):
   - End-to-end task execution &rarr; receipt capture &rarr; episodic synthesis &rarr; graph projection &rarr; access-aware retrieval in next session &rarr; tombstone deletion revocation.

---

## 13. Dependencies & Blockers

### 13.1 Hard Blockers

- **NONE**. Task 057 is closed and verified green in CI. All 9 prerequisite Sprint 1 milestones are complete.

### 13.2 Soft Dependencies

- Model availability for abstractive summarization (deterministic fallback to extractive summarization must be supported for hermetic CI).

### 13.3 Optional Dependencies

- Web Dashboard Memory Explorer UI visual enhancements (can be rendered with existing API endpoints).

---

## 14. In Scope

### For Candidate 1 (Cross-Session Episodic Learning & Memory Compression)

- Canonical Zod schemas and TypeScript types for compression, episodic learning, and graph projections in `packages/contracts/src/memory/`.
- Backend `EpisodicLearner` service ingesting workflow execution receipts.
- Backend `MemoryCompressor` service with lossiness classification and citation tracking.
- Backend `GraphProjectionEngine` for entity/task relationship queries scoped by workspace and tenant.
- Tombstone revocation propagation for graph projections.
- Comprehensive unit, security, and vertical slice tests verifying 058-SEC-01 through 058-SEC-07.

---

## 15. Out of Scope

- Modifying the core execution engine (`WorkflowEngine` in `apps/desktop-agent`).
- External heavyweight vector database daemons (Qdrant, Pinecone, Milvus) in local CI.
- Live foundation model training or parameter-efficient fine-tuning (LoRA).
- Full multi-user real-time collaborative memory CRDT synchronization (deferred to Enterprise roadmap).
- Modifying Browser Runtime or Filesystem Sandboxing internals (Tasks 050/055 are closed).
- Modifying the Planner decomposition algorithm (Task 057 is closed).

---

## 16. Deferred Work

- **Sprint 2 Candidate Work**:
  - Live local embedding model on-device quantization and streaming model offloading.
  - Multi-user collaborative shared memory conflict-free replicated data types (CRDTs).
  - Web Dashboard Memory Explorer full interactive graph visualization components.
  - Enterprise data connector pack ingestion (Notion, Google Drive, Jira) into memory engine.

---

## 17. Proposed Files

### 17.1 For Candidate 1 (Episodic Learning & Memory Compression)

#### New Files

1. `packages/contracts/src/memory/compression.ts` — Schemas and types for lossiness, compression requests, and responses.
2. `packages/contracts/src/memory/graph.ts` — Schemas and types for memory graph nodes, edges, queries, and projections.
3. `packages/contracts/src/memory/episodic.ts` — Schemas and types for task execution episodes and procedural playbook proposals.
4. `packages/contracts/tests/memory/compression-contracts.test.ts` — Contract validation tests for compression and graph schemas.
5. `services/backend/src/memory/episodic-learner.ts` — Ingests task execution receipts and synthesizes episodic memories.
6. `services/backend/src/memory/memory-compressor.ts` — Lossiness-tracked extractive/abstractive summarization engine.
7. `services/backend/src/memory/graph-projection-engine.ts` — In-memory / indexed graph storage with workspace isolation.
8. `services/backend/tests/memory/episodic-learner.test.ts` — Unit tests for episode ingestion and playbook proposal generation.
9. `services/backend/tests/memory/memory-compressor.test.ts` — Unit tests for compression, budgets, and lossiness tracking.
10. `services/backend/tests/memory/graph-projection.test.ts` — Unit tests for graph queries and workspace boundary enforcement.
11. `services/backend/tests/memory/episodic-security.test.ts` — Security invariant verification tests (058-SEC-01..07).
12. `tests/vertical-slice/episodic-memory-vertical-slice.test.ts` — End-to-end vertical slice verifying cross-session continuity and forgetting.

#### Files to Modify

1. `packages/contracts/src/memory/index.ts` — Export new compression, graph, and episodic modules.
2. `services/backend/src/memory/types.ts` — Add `IEpisodicLearner`, `IMemoryCompressor`, and `IGraphProjectionEngine` interfaces.
3. `services/backend/src/memory/memory-service.ts` — Mount episodic ingestion, compression, and graph query handlers.
4. `services/backend/src/memory/memory-store.ts` — Store graph nodes/edges and propagate tombstones to graph projections.
5. `services/backend/src/memory/memory-routes.ts` — Expose `/v1/memory/compress`, `/v1/memory/graph`, and `/v1/memory/episodes`.
6. `services/backend/src/memory/index.ts` — Barrel exports for new memory modules.
7. `package.json` — Add new test suites to root test runner.

#### Files That Must NOT Be Touched

- `apps/desktop-agent/src/workflow/` — Execution engine remains strictly isolated.
- `apps/desktop-agent/src/runtimes/` — Runtime sandboxes are closed.
- `services/backend/src/policy/` — Policy evaluation logic remains authoritative and untouched.
- `packages/contracts/src/planner/` — Planner contracts remain unchanged.

---

## 18. Recommended Implementation Sequence

```
Step 1: Canonical Contracts (packages/contracts/src/memory/)
├── Define LossinessClass, CompressionStrategy, MemoryCompressionRequest/Response
├── Define MemoryGraphNode, MemoryGraphEdge, MemoryGraphQueryRequest/Response
├── Define EpisodicEpisode, ProceduralPlaybookProposal
└── Implement contract tests in packages/contracts/tests/memory/
        ↓
Step 2: Foundational Memory Subsystems (services/backend/src/memory/)
├── Implement GraphProjectionEngine with tenant/workspace isolation
├── Implement MemoryCompressor with citation preservation and lossiness tracking
└── Implement EpisodicLearner with deterministic receipt parser and playbook synthesizer
        ↓
Step 3: Security & Tombstone Propagation
├── Implement 058-SEC-01 through 058-SEC-07 security invariants
├── RedactionFilter integration on all candidate summaries
└── Atomic tombstone revocation on graph projections and derived summaries
        ↓
Step 4: Backend Service & Route Integration
├── Wire EpisodicLearner, MemoryCompressor, and GraphProjectionEngine into MemoryService
└── Mount HTTP endpoints in memory-routes.ts and app.ts
        ↓
Step 5: Testing & Vertical Slice
├── Unit tests: episodic-learner.test.ts, memory-compressor.test.ts, graph-projection.test.ts
├── Security suite: episodic-security.test.ts (all 7 security invariants)
└── End-to-end vertical slice: episodic-memory-vertical-slice.test.ts
        ↓
Step 6: Quality Gate Verification & Completion Report
├── Run all local quality gates (build, typecheck, lint, format:check, validate, security, test)
└── Create task_058_completion_report.md
```

---

## 19. Risks / Open Questions / ADR Candidates

### 19.1 Risks & Mitigations

| Risk                                               | Severity | Mitigation                                                                                                                                               |
| :------------------------------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model Hallucination during Summarization**       | Medium   | Enforce mandatory extractive fallback for core facts, code paths, and error codes; require citation arrays for all claims.                               |
| **Graph Traversal Performance in In-Memory Store** | Low      | Limit traversal depth (default: 2, max: 4) and return bounded candidate sets; enforce per-query node ceilings.                                           |
| **Episodic Memory Poisoning by Flaky Tasks**       | Medium   | Synthesized playbooks default to `PROPOSED` status; require high confidence (&ge; 0.90) and minimum 2 consecutive successes before planning eligibility. |

### 19.2 Open Questions

1. **Milestone Scheduling**: Confirm whether Task 058 should execute **Candidate 1 (Cross-Session Episodic Learning & Memory Compression)** under Sprint 1 Milestone 10, or execute **Candidate 2 (Sprint 1 Exit Gate)** as Task 058 with Episodic Learning becoming Task 059 / Sprint 2 Milestone 1.

---

## 20. Discovery Conclusion

1. **Exact Task Identity Derived**:
   - Primary Candidate: `TASK 058: SPRINT 1 MILESTONE 10 — CROSS-SESSION EPISODIC LEARNING, MEMORY COMPRESSION & GRAPH RETRIEVAL PROJECTIONS`.
   - Alternative Candidate: `TASK 058: SPRINT 1 MILESTONE 10 — SPRINT 1 HARDENING, QUALITY GATE FINALIZATION & SPRINT 2 READINESS (SPRINT 1 EXIT)`.
2. **Baseline Conformance**: Checked out at `af6a6e8b29b719a099aadfebea00bca2dc0a0cc1` on branch `main` with 0 modified/untracked files and 1043 passing tests.
3. **No Code Written**: This is strictly a discovery task. Zero implementation code, test code, configuration, or package manifests were altered.
4. **Readiness**: Task 058 is fully unblocked and ready for architectural alignment and implementation kickoff upon maintainer selection.
