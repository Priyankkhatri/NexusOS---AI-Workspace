# Task 062 Discovery Report

**Sprint 2 Milestone 3 — Discovery Phase**
**Repository**: NexusOS Monorepo (`priyankkhatri/nexus-ai`)
**Date**: September 10, 2026

---

## 1. Live Repository Baseline

The current live state of the NexusOS monorepo was audited directly from the git filesystem and repository toolchain:

- **Exact Baseline Git HEAD SHA**: `0abdb31424cfe3ddf64443b8e4cf1f501af659d7`
- **Active Branch**: `main`
- **Remote Synchronization State**: `origin/main` is exactly aligned at `0abdb31424cfe3ddf64443b8e4cf1f501af659d7` (`HEAD == origin/main`).
- **Working Tree State**: Completely clean (zero modified files, zero untracked files prior to this report).
- **Evidence Task 061 is Closed**:
  - `task_061_completion_report.md` exists and records final implementation commit `d3baa28caa486d4b369ac10d43c6a925dc68ea63` and final documentation commit `0abdb31424cfe3ddf64443b8e4cf1f501af659d7`.
  - GitHub Actions CI run `34443768519` (commit `0b0b005`) and run `34443987469` (commit `0abdb31`) both concluded with **`success`** in under 2 minutes.
  - All 1,195 monorepo tests are passing (100% pass rate across 251 test suites).
  - All quality gates (`build`, `typecheck`, `lint`, `format:check`, `validate-repo`, `security-scan`) are clean.
- **Evidence Task 062+ Has NOT Started**:
  - No SQLite database connection files exist in `services/backend/src/memory`.
  - No vector indexing or embedding search engines exist in `services/backend/src/memory`.
  - No contract modifications have been made to `packages/contracts/src/memory` post-Task-061.
  - `git log -n 5 --oneline` confirms only Task 061 commits exist at the top of tree.

---

## 2. Exact Canonical Task Identity

Through deep examination of authoritative repository documentation, architectural blueprints, subsystem EDDs, and sprint backlogs, the canonical next milestone for Sprint 2 is established:

- **Canonical Identifier & Title**:
  `TASK 062: SPRINT 2 MILESTONE 3 — PERSISTENT DISTRIBUTED GRAPH STORE, ACID TRANSACTIONAL PERSISTENCE & VECTOR SEARCH (SQLITE / EMBEDDINGS)`
- **Sprint**: Sprint 2
- **Milestone Number**: Milestone 3
- **Owning Subsystems**:
  - Backend Memory Subsystem (`services/backend/src/memory`)
  - Shared Contracts (`packages/contracts/src/memory`)
  - Control-Plane Orchestration Interface (`services/backend/src/server`, `services/backend/src/planner`)
- **Authoritative Sources**:
  1. `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 4, Item 3: _"Persistent Distributed Graph Store & Vector Search [CANDIDATE]"_
  2. `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 6, Recommended Sprint 2 Sequencing:
     ```
     ┌─────────────────────────────────────────────────────────────┐
     │ SPRINT 2 PHASE 1: NATIVE AI & PERSISTENT KNOWLEDGE GRAPH    │
     │ 1. Native Model Execution & VRAM Offloading (local-ai)      │ (Completed in Task 061)
     │ 2. Persistent SQLite/Vector Graph Store (services/memory)   │ <== CANONICAL NEXT (Task 062)
     └──────────────────────────────┬──────────────────────────────┘
     ```
  3. `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 3, Table 1: Item _"Persistent Distributed Graph Store"_, Owner: Platform Data Team.
  4. `SPRINT_1_COMPLETION_REPORT.md` — Section 8, Known Limitations & Technical Debt, Item 2: _"In-Memory Store Default: Memory and graph projections currently use the in-memory MemoryStore suitable for single-node development; distributed database persistence (e.g. SQLite / Neo4j) is planned for Sprint 2."_
  5. `task_061_completion_report.md` — Section 29, Deferred Work: _"Distributed Vector Database / Graph Store (Candidate 2)."_
  6. `docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md` — Section 2.1 & Section 10: Memory Engine and Knowledge Engine persistent backing interfaces.
  7. `docs/RUNBOOKS.md` & `docs/runbooks/RB-020-episodic-graph-cycle-forgetting-cascade-failure.md` — Memory Graph Explosion & Atomic Forgetting Cascade Runbook.

---

## 3. Candidate & Conflict Analysis

### 3.1 Candidate Ranking Matrix

| Candidate                       | Proposed Milestone Title                                                            | Priority             | Authoritative Source Alignment                                                                                                                 | Evaluation & Decision                                                                                                                                                        |
| :------------------------------ | :---------------------------------------------------------------------------------- | :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Candidate 1 (Authoritative)** | **Persistent Distributed Graph Store & Vector Search (SQLite / Embeddings)**        | **Rank 1 (Primary)** | `SPRINT_2_READINESS_AND_BACKLOG.md` Sec 6 Phase 1 Item 2; `SPRINT_1_COMPLETION_REPORT.md` Sec 8 Item 2; `task_061_completion_report.md` Sec 29 | **SELECTED AS CANONICAL TASK 062**. Completes Phase 1 of Sprint 2 by replacing the single-node ephemeral memory store with ACID disk persistence and semantic vector search. |
| **Candidate 2 (Alternative)**   | **Web Dashboard Multi-Agent Collaboration View & Timeline Cockpit**                 | **Rank 2**           | `SPRINT_2_READINESS_AND_BACKLOG.md` Sec 6 Phase 2 Item 4; `task_061_completion_report.md` Sec 29                                               | **DEFERRED TO TASK 063**. Represents Sprint 2 Phase 2 experience-layer work that visualizes multi-agent delegation trees and federated ACP messages delivered in Task 060.   |
| **Candidate 3 (Governance)**    | **Contract Versioning Roadmap Initialization (`@nexusos/contracts@0.2.0-sprint1`)** | **Rank 3**           | `SPRINT_2_READINESS_AND_BACKLOG.md` Sec 5                                                                                                      | **DEFERRED / INCORPORATED**. Package version bump can be incorporated into Task 062 or release milestone; does not constitute a standalone feature milestone.                |
| **Candidate 4 (Conflicting)**   | **Cloud State Sync & Enterprise RBAC**                                              | **Disqualified**     | `SPRINT_2_READINESS_AND_BACKLOG.md` Sec 4 Item 4                                                                                               | **EXPLICITLY DEFERRED TO SPRINT 3**. Prohibited from Sprint 2 scope.                                                                                                         |

### 3.2 Conflict Resolution

- In `SPRINT_2_READINESS_AND_BACKLOG.md` Section 6, Sprint 2 Phase 1 specifies two initiatives:
  1. _Native Model Execution & VRAM Offloading_ (Completed in Task 061)
  2. _Persistent SQLite/Vector Graph Store_ (Unexecuted, direct successor)
- Task 060 delivered Multi-Agent Delegation & Federated ACP (Sprint 2 Milestone 1).
- Task 061 delivered Native Local-AI Execution & VRAM Offloading (Sprint 2 Milestone 2).
- Therefore, the exact and unambiguous canonical next milestone is Sprint 2 Milestone 3: Persistent Distributed Graph Store & Vector Search (Task 062).

---

## 4. Existing Architecture Inventory (From Tasks 049–061)

The monorepo contains a mature, highly resilient in-memory memory subsystem established across Tasks 056, 058, and 060:

1. **Memory Domain Contracts (`packages/contracts/src/memory/`)**:
   - `base.ts`: Defines `MemoryClass` (`WORKING`, `EPISODIC`, `SEMANTIC`, `PROCEDURAL`, `ARTIFACT`), `MemorySensitivity` (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`), `MemoryStatus` (`ACTIVE`, `PROPOSED`, `TOMBSTONED`, `ARCHIVED`), `MemorySourceType`, `RetrievalMode` (`LEXICAL`, `HYBRID`, `SEMANTIC_DEGRADED`, `EXACT`), `MemoryRecordSchema`, `MemoryCreateRequestSchema`, `MemoryUpdateRequestSchema`, `MemorySearchRequestSchema`, `MemorySearchResponseSchema`, `MemoryProposalSchema`, and `escapeUntrustedMemoryContent()`.
   - `compression.ts`: Defines `LossinessClass`, `CompressionStrategy`, `MemoryCitationSchema`, `MemoryCompressionRequestSchema`, `MemoryCompressionResponseSchema`, and `inheritHighestSensitivity()`.
   - `episodic.ts`: Defines `EpisodeOutcome`, `NodeReceiptSummarySchema`, `HumanDecisionRecordSchema`, `EpisodicEpisodeSchema`, `PlaybookStatus`, and `ProceduralPlaybookProposalSchema`.
   - `graph.ts`: Defines `MemoryGraphNodeType`, `MemoryGraphEdgeType`, `MemoryGraphNodeSchema`, `MemoryGraphEdgeSchema`, `MemoryGraphQueryRequestSchema`, and `MemoryGraphQueryResponseSchema`.
2. **Backend Memory Engine (`services/backend/src/memory/`)**:
   - `IMemoryStore` (`types.ts`): Formal interface defining all CRUD, search, proposal, episode, playbook, graph traversal, and atomic cascade tombstoning operations.
   - `InMemoryMemoryStore` (`memory-store.ts`): Complete in-memory implementation of `IMemoryStore` using `Map<string, T>` collections.
   - `MemoryService` (`memory-service.ts`): Business logic orchestrator coordinating storage, redaction (`RedactionFilter`), compression, episodic learning, and graph projections.
   - `MemoryController` (`memory-controller.ts`): Request context extraction, tenant/workspace scoping, input validation, and HTTP dispatch.
   - `handleMemoryRoutes` (`memory-routes.ts`): Standard HTTP router mapping `/v1/memory/*` endpoints.
   - `GraphProjectionEngine` (`graph-projection-engine.ts`): Derives entity/task/decision/artifact graph nodes and semantic edges from completed tasks and episodes.
   - `EpisodicLearner` (`episodic-learner.ts`): Records structured episodic runs, summarizes receipts, and proposes procedural playbooks.
   - `MemoryCompressor` (`memory-compressor.ts`): Performs bounded hierarchical summarization with strict citation tracking and sensitivity inheritance.
3. **Desktop Agent Memory Client (`apps/desktop-agent/src/runtimes/memory/` or `PersistentMemoryClient`)**:
   - Consumes `/v1/memory/*` endpoints over authenticated HTTP/IPC.
   - Packages retrieved context using `wrapUntrustedMemory()` into `<<<UNTRUSTED_RETRIEVED_MEMORY>>>` inert boundaries.

---

## 5. Current Implementation Inventory

| Component / File Path                                | Current Status      | Current Responsibility                     | Task 062 Role & Impact                                                |
| :--------------------------------------------------- | :------------------ | :----------------------------------------- | :-------------------------------------------------------------------- |
| `packages/contracts/src/memory/graph.ts`             | Complete (Task 058) | Graph node, edge, and query schemas        | **REUSE & EXTEND** with vector embedding schemas                      |
| `packages/contracts/src/memory/base.ts`              | Complete (Task 056) | Memory records, search schemas, delimiters | **REUSE & EXTEND** with vector search request fields                  |
| `packages/contracts/src/memory/vector.ts`            | **MISSING**         | N/A                                        | **CREATE** canonical vector similarity search contracts               |
| `services/backend/src/memory/types.ts`               | Complete (Task 058) | `IMemoryStore` and domain error types      | **EXTEND** `IMemoryStore` with vector search and transaction methods  |
| `services/backend/src/memory/memory-store.ts`        | In-Memory Only      | `InMemoryMemoryStore` backing `Map`s       | **PRESERVE** as deterministic mock/testing store                      |
| `services/backend/src/memory/sqlite-memory-store.ts` | **MISSING**         | N/A                                        | **CREATE** persistent SQLite implementation of `IMemoryStore`         |
| `services/backend/src/memory/vector-index.ts`        | **MISSING**         | N/A                                        | **CREATE** deterministic cosine similarity vector search index        |
| `services/backend/src/memory/migrations/`            | **MISSING**         | N/A                                        | **CREATE** DDL schema migrations for tables, indexes, and constraints |
| `services/backend/src/memory/memory-service.ts`      | Complete (Task 058) | High-level memory coordination             | **REUSE**; inject persistent store instance                           |
| `services/backend/src/memory/memory-controller.ts`   | Complete (Task 056) | HTTP request handlers                      | **REUSE & EXTEND** to expose vector search endpoints                  |
| `services/backend/src/memory/memory-routes.ts`       | Complete (Task 056) | HTTP routing for `/v1/memory/*`            | **REUSE & EXTEND** with `/v1/memory/search/vector`                    |

---

## 6. Gap Analysis

### 6.1 Canonical Contracts

- **Current State**: `MemorySearchRequestSchema` supports lexical string queries (`query`), `status`, `classes`, `tags`, `minConfidence`, and `maxSensitivity`. `RetrievalModeSchema` includes `HYBRID` and `SEMANTIC_DEGRADED`, but there is no canonical schema defining vector embeddings, vector dimensions, distance metrics, or vector similarity search requests/responses.
- **Required State**: Define `VectorEmbeddingSchema` (array of numbers, dimension constraint e.g. 384 or 1536, normalization flag), `VectorSearchRequestSchema` (vector query or text query, topK, minSimilarity, metric `'COSINE' | 'DOT' | 'EUCLIDEAN'`), and `VectorSearchResultItemSchema`.
- **Affected Area**: `packages/contracts/src/memory/vector.ts`, `packages/contracts/src/memory/index.ts`.
- **Status**: **MANDATORY for Task 062**.

### 6.2 Storage & Persistence (SQLite Engine)

- **Current State**: `InMemoryMemoryStore` loses all memory records, proposals, episodic episodes, procedural playbooks, and knowledge graph nodes/edges on process restart.
- **Required State**: Implement `SqliteMemoryStore` conforming to `IMemoryStore` using Node.js built-in `node:sqlite` (introduced in Node 22+) or clean embedded SQLite driver that requires zero native toolchain compilation on GitHub Actions CI. All writes (especially atomic cascade tombstoning) must execute inside ACID transactions (`BEGIN IMMEDIATE ... COMMIT / ROLLBACK`).
- **Affected Area**: `services/backend/src/memory/sqlite-memory-store.ts`.
- **Status**: **MANDATORY for Task 062**.

### 6.3 Vector Search & Hybrid Retrieval

- **Current State**: `InMemoryMemoryStore.search()` performs only exact substring lexical matching (`record.content.toLowerCase().includes(q)`).
- **Required State**: Embed a deterministic, lightweight in-process vector similarity search module supporting cosine distance calculation over stored embedding vectors, with graceful fallback to lexical search when embeddings are unavailable (`SEMANTIC_DEGRADED` mode).
- **Affected Area**: `services/backend/src/memory/vector-index.ts`, `services/backend/src/memory/memory-service.ts`.
- **Status**: **MANDATORY for Task 062**.

### 6.4 Graph Traversal Optimization & Indexing

- **Current State**: Graph BFS traversal in `InMemoryMemoryStore` iterates through all workspace edges in memory on every frontier expansion.
- **Required State**: Persist graph nodes and edges in indexed SQLite tables (`idx_graph_nodes_workspace`, `idx_graph_edges_source`, `idx_graph_edges_target`). Enforce foreign key constraints or atomic transaction cascade so that tombstoning a memory record deletes its associated graph nodes and edges atomically.
- **Affected Area**: `services/backend/src/memory/sqlite-memory-store.ts`.
- **Status**: **MANDATORY for Task 062**.

### 6.5 Atomic Cascade Forgetting & Transactional Rollback

- **Current State**: If a failure occurs during `revokeGraphForMemory()` or `markDerivedCompressionsTombstoned()`, state can become partially mutated.
- **Required State**: Wrap memory record tombstoning, derived compression invalidation, and graph edge/node revocation in an atomic SQLite transaction. If any step fails, roll back completely.
- **Affected Area**: `services/backend/src/memory/sqlite-memory-store.ts`.
- **Status**: **MANDATORY for Task 062**.

---

## 7. Security Threat Model

Task 062 deals directly with persistent storage of enterprise data, episodic memories, and graph relationships. The following threat vectors must be mitigated:

1. **Cross-Tenant & Cross-Workspace Data Bleed**: A query in Tenant A must never read, traverse, search, or mutate memory atoms or graph nodes belonging to Tenant B.
2. **SQL Injection & Query Tampering**: Untrusted user inputs, query strings, tags, or graph properties must never be concatenated into raw SQL statements. Parameterized queries are mandatory.
3. **Prompt / Context Injection via Retrieved Memory**: Stored memory content is untrusted data. When retrieved, it must be escaped using `escapeUntrustedMemoryContent()` and wrapped in `<<<UNTRUSTED_RETRIEVED_MEMORY>>>` delimiters before presentation to models or planners.
4. **Secret Persistence**: Raw passwords, API keys, and bearer tokens must never be written to persistent database records. `RedactionFilter` must scrub payloads prior to SQLite insertion.
5. **Orphaned Graph Projections after Right-to-be-Forgotten**: When a memory record is tombstoned, any knowledge graph node or edge derived from it must be atomically revoked. Failure to do so leads to privacy breaches.
6. **Unbounded Graph Traversal DoS**: Malicious cyclic or dense graph topologies could cause exponential traversal, CPU exhaustion, or massive memory allocations. Strict clamping to `maxDepth <= 4` and `limit <= 100` must be enforced at the SQL query boundary.
7. **Unbounded Vector Retrieval & OOM**: Vector similarity scans across millions of embeddings could exhaust heap memory. Searches must enforce bounded pagination (`limit <= 100`, `topK <= 50`).
8. **Plan / Memory Usurpation of Authority**: Neither vector search results nor graph query responses are execution authority. They are inert data.

---

## 8. Proposed Security Invariants (062-SEC-01 through 062-SEC-07)

The implementation of Task 062 will be governed by seven verifiable security invariants:

- **`062-SEC-01: Persistent Tenant & Workspace Partitioning`**
  Every persistent table (`memory_records`, `memory_proposals`, `episodes`, `playbooks`, `graph_nodes`, `graph_edges`, `vector_embeddings`) MUST enforce composite partitioning by `(tenant_id, workspace_id)`. Cross-tenant queries return zero records and cross-tenant mutations fail closed.
- **`062-SEC-02: SQL Parameterization & Injection Defense`**
  Zero raw string concatenation in SQL queries. All queries, graph traversals, and vector metadata filters must use parameterized statement bindings (`?` or named parameters).
- **`062-SEC-03: Atomic Cascade Tombstoning & Forgetting Transactionality`**
  Tombstoning a memory record MUST atomically cascade to mark derived compressions as tombstoned and purge/revoke associated graph nodes and edges within a single ACID transaction (`BEGIN ... COMMIT`). If any step fails, the entire transaction rolls back.
- **`062-SEC-04: Secret Sanitization at the Persistence Boundary`**
  Payloads containing plaintext credentials, bearer tokens, or private keys MUST be rejected or redacted before persisting to disk. The database file must contain zero unredacted secrets.
- **`062-SEC-05: Bounded Graph Traversal & Depth Protection`**
  Graph query depth is strictly clamped to `maxDepth <= 4` and total returned nodes/edges clamped to `limit <= 100`. Cyclic graph structures must be detected and terminated without infinite loops or duplicate edge emission.
- **`062-SEC-06: Vector Search Tenant Isolation & Sensitivity Filtering`**
  Vector similarity search must filter candidate vectors by authenticated `tenantId`, `workspaceId`, and caller `maxSensitivity` rank _before_ ranking or returning results.
- **`062-SEC-07: Inert Memory Context Packaging & Delimiter Integrity`**
  Retrieved persistent memory and vector search results MUST be passed through `escapeUntrustedMemoryContent()` and wrapped within `<!-- BEGIN_UNTRUSTED_RETRIEVED_MEMORY -->` delimiters. Persistent memory must never grant execution authority or override policy.

---

## 9. Authority & Trust Boundaries

```mermaid
flowchart TD
  subgraph ClientPlane [Client / Experience Plane]
    DA[Desktop Agent / PersistentMemoryClient]
    WD[Web Dashboard]
  end

  subgraph ControlPlane [Control Plane Backend]
    MC[MemoryController]
    MS[MemoryService]
    RF[RedactionFilter]
    PL[Planner / ReplanCoordinator]
  end

  subgraph PersistenceBoundary [Authoritative Persistence Layer]
    SMS[SqliteMemoryStore (ACID)]
    VI[VectorIndex (In-Process Similarity)]
    DB[(SQLite Disk Database)]
  end

  DA -->|Authenticated HTTP with Tenant/Workspace Headers| MC
  WD -->|Authenticated HTTP| MC
  PL -->|Internal Memory Queries| MS
  MC -->|Validated Context| MS
  MS -->|Sanitize Secrets| RF
  RF -->|Clean Payload| SMS
  SMS -->|ACID Transactions| DB
  SMS <-->|Sync Embeddings| VI
```

- **Authoritative Component**: `SqliteMemoryStore` is authoritative for data persistence, monotonic record versioning, and transaction integrity.
- **Advisory Component**: The `VectorIndex` and graph projections are **advisory derived projections**. They never alter canonical record status or grant execution authority.
- **Non-Authority Principle**: Stored memories, procedural playbooks, and graph relations are inert data. They **never** become execution leases, policy overrides, or permission grants.

---

## 10. State Machine & Lifecycle Transitions

### 10.1 Memory Record Lifecycle

```
[PROPOSED] ──► (Human / Policy Decision) ──► [ACTIVE]
                                                 │
                  ┌──────────────────────────────┴──────────────────────────────┐
                  ▼                                                             ▼
             [ARCHIVED]                                                   [TOMBSTONED]
                  │                                                             │
                  ▼                                                             ▼
           (Retention Purge)                                       (Atomic Cascade Forgetting)
                  │                                                             │
                  ▼                                                             ▼
              [PURGED]                                              [NODES & EDGES REVOKED]
```

- **Valid Transitions**:
  - `PROPOSED` → `ACTIVE` (on approval)
  - `PROPOSED` → `REJECTED` (on rejection)
  - `ACTIVE` → `ACTIVE` (version bump via optimistic lock)
  - `ACTIVE` → `ARCHIVED` (retention policy expiry)
  - `ACTIVE` → `TOMBSTONED` (explicit deletion / right-to-be-forgotten)
  - `ARCHIVED` → `TOMBSTONED`
- **Invalid Transitions**:
  - `TOMBSTONED` → `ACTIVE` (strictly forbidden; terminal state)
  - `TOMBSTONED` → `PROPOSED`
  - Version downgrade (e.g. `v3` → `v2`) (optimistic lock failure)

---

## 11. Failure & Recovery Model

1. **SQLite Database Lock / Busy Contention**:
   - SQLite WAL (Write-Ahead Logging) mode enabled (`PRAGMA journal_mode = WAL;`).
   - Busy timeout configured to 5,000 ms (`PRAGMA busy_timeout = 5000;`).
   - Retries with exponential backoff on `SQLITE_BUSY`.
2. **Crash During Cascade Tombstone**:
   - All multi-table updates execute within `BEGIN IMMEDIATE TRANSACTION`.
   - If the process terminates abruptly mid-transaction, SQLite's WAL automatically rolls back the uncommitted transaction upon next connection startup, maintaining data consistency.
3. **Database File Corruption**:
   - Integrity check on startup (`PRAGMA integrity_check;`).
   - If corrupt, fail safe and emit critical alert per operational runbook `RB-002` / `RB-020`.
4. **Vector Dimension Mismatch**:
   - Vectors submitted with incorrect dimensions (e.g. 512 when 384 expected) are rejected with a structured `400 Validation Error` prior to index mutation.

---

## 12. Performance & Resource Bounds

To prevent unbounded resource consumption on host workstations and CI runners:

- **Max Database File Size**: Default soft ceiling 500 MB (alert at 80%).
- **Graph Traversal Limits**:
  - `maxDepth`: Clamped to `4` (default `2`).
  - `limit`: Clamped to `100` nodes and `100` edges (default `25`).
- **Vector Search Bounds**:
  - `maxCandidates`: Top `50` closest items.
  - `vectorDimensions`: Bounded to 384 (or 1536) float32 values per embedding.
  - In-memory vector cache bounded to `10,000` active embeddings per workspace.
- **Search Pagination**:
  - `limit`: Default 10, max 100.
  - `offset`: Bounded to prevent deep pagination abuse.
- **Token Budgeting**:
  - `maxTokenBudget`: Default 2,000 tokens for formatted context blocks.

---

## 13. Test Strategy

The verification matrix for Task 062 requires comprehensive coverage across unit, contract, security, and vertical-slice suites:

1. **Contracts Suite (`packages/contracts/tests/memory-vector-contracts.test.ts`)**:
   - Schema validation for vector embeddings, similarity search requests, and distance metrics.
   - Rejection of negative topK, invalid distance metrics, and non-array vectors.
2. **SQLite Memory Store Unit Tests (`services/backend/tests/memory/sqlite-memory-store.test.ts`)**:
   - Complete CRUD operations on SQLite backend.
   - Optimistic locking and version conflict handling (`MemoryVersionConflictError`).
   - Transactional rollback on simulated failure during atomic cascade tombstoning.
   - Multi-tenant isolation verification across separate tenant databases/partitions.
   - Graph BFS query execution against indexed SQL tables.
3. **Vector Index Unit Tests (`services/backend/tests/memory/vector-index.test.ts`)**:
   - Cosine similarity computation accuracy against known geometric vectors.
   - Top-K ranking, minimum similarity score thresholding.
   - Empty index and dimension mismatch error handling.
4. **Security Hardening Suite (`tests/hardening/memory-persistence-security.test.ts`)**:
   - Explicit tests for `062-SEC-01` through `062-SEC-07`.
   - SQL injection attempts in query strings, tags, and graph labels.
   - Secret leakage prevention into database columns.
   - Cross-tenant vector search bleed prevention.
5. **Vertical Slice End-to-End Test (`tests/vertical-slice/memory-persistence-vertical-slice.test.ts`)**:
   - Real disk-backed flow: Ingest memory atom → persist to SQLite → derive graph node/edge → index vector embedding → search by vector similarity → retrieve and format inert context → tombstone atom → verify atomic cascade deletion across SQLite and VectorIndex.

---

## 14. Implementation Boundary

### Belongs to Task 062:

- Canonical contracts for vector embeddings and similarity search (`packages/contracts/src/memory/vector.ts`).
- SQLite storage engine implementation (`services/backend/src/memory/sqlite-memory-store.ts`).
- In-process cosine similarity vector indexing engine (`services/backend/src/memory/vector-index.ts`).
- Database schema DDL migrations and WAL initialization scripts.
- Atomic transaction management for cascade tombstoning and graph revocation.
- Integrating `SqliteMemoryStore` into `MemoryService`, `MemoryController`, and `handleMemoryRoutes`.
- Adversarial security test suite (`tests/hardening/memory-persistence-security.test.ts`).
- End-to-end persistent vertical slice test (`tests/vertical-slice/memory-persistence-vertical-slice.test.ts`).

### Does NOT Belong to Task 062:

- Heavy external database server requirements (PostgreSQL, Neo4j, Milvus) that break CI portability.
- Web Dashboard Multi-Agent View UI (reserved for Task 063 / Candidate 2).
- Cloud State Sync & Enterprise RBAC (deferred to Sprint 3).
- Modification of Task 061 Local AI native execution or VRAM offloading code.
- Modification of Task 060 Multi-Agent delegation or ACP dispatch code.

---

## 15. Dependency-Ordered Implementation Plan

### Step 1: Canonical Vector & Persistence Contracts

- **Files**: `packages/contracts/src/memory/vector.ts`, `packages/contracts/src/memory/index.ts`, `packages/contracts/src/index.ts`.
- **Changes**: Define `VectorEmbeddingSchema`, `VectorSearchRequestSchema`, `VectorSearchResponseSchema`, `DistanceMetricSchema`.
- **Validation**: New unit test `packages/contracts/tests/memory-vector-contracts.test.ts` passes.

### Step 2: In-Process Vector Similarity Index

- **Files**: `services/backend/src/memory/vector-index.ts`.
- **Changes**: Implement normalized cosine distance ranking with tenant/workspace partition scoping.
- **Validation**: Unit test `services/backend/tests/memory/vector-index.test.ts` passes.

### Step 3: SQLite Storage Engine (`SqliteMemoryStore`)

- **Files**: `services/backend/src/memory/sqlite-memory-store.ts`, `services/backend/src/memory/migrations/schema.sql`.
- **Changes**: Implement `IMemoryStore` with tables `memory_records`, `memory_proposals`, `episodes`, `playbooks`, `graph_nodes`, `graph_edges`, `vector_embeddings`. Enforce WAL mode, foreign keys, and atomic transactions.
- **Validation**: Unit test `services/backend/tests/memory/sqlite-memory-store.test.ts` passes.

### Step 4: Service & Route Integration

- **Files**: `services/backend/src/memory/memory-service.ts`, `services/backend/src/memory/memory-controller.ts`, `services/backend/src/memory/memory-routes.ts`.
- **Changes**: Connect vector search endpoints (`POST /v1/memory/search/vector`), bind `SqliteMemoryStore` into `MemoryService`.
- **Validation**: Existing memory routes and tests continue to pass.

### Step 5: Security Hardening & Regression Suite

- **Files**: `tests/hardening/memory-persistence-security.test.ts`.
- **Changes**: Implement 062-SEC-01 through 062-SEC-07 security tests.
- **Validation**: All hardening tests pass cleanly.

### Step 6: End-to-End Vertical Slice

- **Files**: `tests/vertical-slice/memory-persistence-vertical-slice.test.ts`.
- **Changes**: Implement complete disk persistence vertical slice.
- **Validation**: End-to-end flow passes without regressions.

---

## 16. Acceptance Criteria

1. Exact canonical identity established as **Sprint 2 Milestone 3: Persistent Distributed Graph Store, ACID Transactional Persistence & Vector Search**.
2. Baseline SHA `0abdb31424cfe3ddf64443b8e4cf1f501af659d7` recorded and verified in sync with `origin/main`.
3. Task 061 closure confirmed with green CI runs `34443768519` and `34443987469`.
4. Confirmation that Task 062 implementation has not been started.
5. Existing memory architecture completely inventoried.
6. Zero duplicate subsystems proposed (extends existing `IMemoryStore` and `MemoryService`).
7. 7 proposed security invariants (`062-SEC-01..07`) defined.
8. ACID transaction and rollback model for atomic forgetting defined.
9. Strict memory and graph traversal bounds established.
10. Test strategy and vertical slice defined.
11. No implementation code, tests, or configurations modified during discovery.

---

## 17. Open Risks & Ambiguities

- **CI Portability for SQLite**: Must ensure zero native build dependencies (e.g. use built-in `node:sqlite` or prebuilt WASM/pure-JS fallback) so GitHub Actions CI remains fast, deterministic, and 100% portable.
- **Vector Dimension Standardization**: Standardize on a fixed embedding dimension (e.g. 384 dimensions matching MiniLM or 1536 matching standard embeddings) with strict dimension validation on ingest.

---

## 18. Discovery Conclusion

Task 062 is fully analyzed and ready for implementation upon user authorization. The milestone directly addresses the technical debt and candidate roadmap established at the conclusion of Sprint 1, transitioning the memory subsystem from ephemeral process memory to robust, ACID-backed disk persistence with semantic vector search.
