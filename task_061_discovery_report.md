# Task 061 Discovery Report

**Sprint 2 Milestone 2 — Discovery Phase**

---

## 1. Exact Task Identity

Authoritative repository documentation, architectural blueprints, subsystem EDDs, and sprint planning artifacts were analyzed to determine the canonical identity and scope of Task 061.

### 1.1 Candidate Identification

#### PRIMARY / AUTHORITATIVE: Candidate 1

- **Canonical Title**: `TASK 061: SPRINT 2 MILESTONE 2 — NATIVE QUANTIZED LOCAL-AI MODEL EXECUTION, VRAM OFFLOADING & HARDWARE-ACCELERATED INFERENCE (ONNX / GGUF / LLAMA.CPP)`
- **Sprint**: Sprint 2
- **Milestone**: Milestone 2
- **Owning Subsystem(s)**:
  - AI Runtime (`apps/desktop-agent/src/runtimes/local-ai`, `runtimes/local-ai`)
  - Shared Contracts (`packages/contracts/src/ai`)
  - Desktop Agent Host Plane (`apps/desktop-agent`)
- **Authoritative Sources**:
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 4 (Item 2: Native Quantized Local-AI Model Execution (vLLM / ONNX) [CANDIDATE])
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 3 Table 1 ("Native GGUF / ONNX Weight Execution" — Owner: AI Runtime Team)
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 6 (Sprint 2 Sequencing: Phase 1 Item 1: Native Model Execution & VRAM Offloading)
  - `SPRINT_1_COMPLETION_REPORT.md` — Section 8 Item 1 ("Local AI Engine Real Weight Loading: Sprint 1 local AI runtime includes full mock and fallback adapters with circuit breaking; native ONNX / GGUF model execution is scheduled for Sprint 2.")
  - `docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md` — Section 35 (Local Model Ecosystem: Ollama, LM Studio, llama.cpp, GGUF, ONNX, CUDA, ROCm, CPU)
  - `docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md` — Section 9 (Local AI Runtime, 9.1–9.5)
  - `docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md` — Section 5 (Model Routing, Inference, and Multi-Provider Governance)
- **Business Objective**:
  Empower the desktop agent to execute real quantized generative LLM inference locally on user workstations without leaking proprietary company prompts to third-party cloud APIs. Guarantee deterministic performance by measuring host VRAM/RAM headroom, streaming tokens through prompt-isolated boundaries, and gracefully falling back to CPU quantization when GPU VRAM limits are saturated.
- **Architectural Objective**:
  Replace or augment the simulated mock loops in `apps/desktop-agent/src/runtimes/local-ai/provider-adapters.ts` with real native model weight execution bindings (e.g., GGUF via `node-llama-cpp` or ONNX Runtime Node). Connect dynamic layer offloading between CPU RAM and GPU VRAM based on real-time headroom sampled from `HardwareDetector`. Enforce cryptographic lease validation, prompt template neutralization, token rate budgets, process isolation, and tamper-resistant evidence digests.

#### ALTERNATIVE: Candidate 2

- **Canonical Title**: `TASK 061: SPRINT 2 MILESTONE 2 — PERSISTENT DISTRIBUTED GRAPH STORE & VECTOR SEARCH (SQLITE / NEO4J / EMBEDDINGS)`
- **Sprint**: Sprint 2
- **Milestone**: Milestone 2
- **Owning Subsystem(s)**:
  - Backend Memory Subsystem (`services/backend/src/memory`)
  - Shared Contracts (`packages/contracts/src/memory`)
- **Authoritative Sources**:
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 4 (Item 3: Persistent Distributed Graph Store & Vector Search [CANDIDATE])
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 3 Table 1 ("Persistent Distributed Graph Store" — Owner: Platform Data Team)
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 6 (Sprint 2 Sequencing: Phase 1 Item 2: Persistent SQLite/Vector Graph Store)
  - `SPRINT_1_COMPLETION_REPORT.md` — Section 8 Item 2 ("In-Memory Store Default: Memory and graph projections currently use the in-memory MemoryStore suitable for single-node development; distributed database persistence (e.g. SQLite / Neo4j) is planned for Sprint 2.")
- **Objective**:
  Transition episodic memory records, procedural playbooks, and knowledge graph projections from the ephemeral in-memory `MemoryStore` into a persistent SQLite / vector database backing store with ACID transactions, atomic tombstoning, and semantic vector similarity search.
- **Why Alternative**:
  In `docs/SPRINT_2_READINESS_AND_BACKLOG.md` Section 6, "Persistent SQLite/Vector Graph Store" is listed as Item 2 under Phase 1, directly following "Native Model Execution & VRAM Offloading". If project leadership prefers persisting the memory graph before connecting real AI model execution, this candidate would take precedence.

#### ALTERNATIVE: Candidate 3

- **Canonical Title**: `TASK 061: SPRINT 2 MILESTONE 2 — WEB DASHBOARD MULTI-AGENT COLLABORATION VIEW, FEDERATION TIMELINE & APPROVAL COCKPIT`
- **Sprint**: Sprint 2
- **Milestone**: Milestone 2
- **Owning Subsystem(s)**:
  - Experience Platform (`apps/web-dashboard`)
  - Shared Contracts (`packages/contracts/src/acp`)
- **Authoritative Sources**:
  - `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 6 (Sprint 2 Sequencing: Phase 2 Item 4: Web Dashboard Multi-Agent View & Timeline)
- **Objective**:
  Build user-facing UI in `apps/web-dashboard` to visualize the multi-agent delegation tree, sub-agent execution receipts, federated ACP messages, and hierarchical approval workflows introduced in Task 060.
- **Why Alternative**:
  Task 060 successfully delivered the backend and contract layers for multi-agent delegation. Candidate 3 directly follows up on Task 060 to expose these capabilities to operators in the Web Dashboard.

#### GOVERNANCE / HOUSEKEEPING: Candidate 4

- **Title**: `TASK 061: SPRINT 2 CONTRACT VERSIONING INITIALIZATION & METADATA BUMP (@nexusos/contracts@0.2.0-sprint1)`
- **Sprint**: Sprint 2
- **Milestone**: Housekeeping / Governance
- **Source**: `docs/SPRINT_2_READINESS_AND_BACKLOG.md` — Section 5 (Contract Versioning Roadmap).
- **Rationale**:
  Bumps `@nexusos/contracts` package version to `0.2.0-sprint1` reflecting contracts delivered across Sprint 1. Typically integrated into feature milestones rather than executed as a standalone feature task.

#### CONFLICTING / DEFERRED: Candidate 5

- **Title**: `CLOUD STATE SYNC & ENTERPRISE RBAC`
- **Status**: Formally **DEFERRED** to Sprint 3 in `docs/SPRINT_2_READINESS_AND_BACKLOG.md` Section 4 Item 4. Must NOT be implemented in Task 061.

---

### 1.2 Separation of Fact, Inference, and Open Question

#### FACT

1. Task 060 completed Sprint 2 Milestone 1 (`TASK 060: SPRINT 2 MILESTONE 1 — ADVANCED MULTI-AGENT COLLABORATION, FEDERATED ACP & AUTONOMOUS SUB-AGENT DELEGATION`) at commit `70062f284dd02f9f0233b02f0a9772cad6147f9c` with green GitHub Actions CI run `34440725214`.
2. In `docs/SPRINT_2_READINESS_AND_BACKLOG.md` Section 6, Sprint 2 Phase 1 lists two unexecuted items:
   - Item 1: Native Model Execution & VRAM Offloading (`local-ai`)
   - Item 2: Persistent SQLite/Vector Graph Store (`services/memory`)
3. `SPRINT_1_COMPLETION_REPORT.md` Section 8 explicitly documents: "Sprint 1 local AI runtime includes full mock and fallback adapters with circuit breaking; native ONNX / GGUF model execution is scheduled for Sprint 2."
4. `apps/desktop-agent/src/runtimes/local-ai/provider-adapters.ts` currently implements simulated mock loops yielding token strings (`"[Ollama Model ...]: Simulated streamed reasoning..."`), rather than executing native compiled model weights.
5. All 1150 cumulative monorepo tests are passing across 239 test suites with zero failures.

#### INFERENCE

1. Candidate 1 (`TASK 061: SPRINT 2 MILESTONE 2 — NATIVE QUANTIZED LOCAL-AI MODEL EXECUTION, VRAM OFFLOADING & HARDWARE-ACCELERATED INFERENCE (ONNX / GGUF / LLAMA.CPP)`) represents the primary authoritative progression for Sprint 2 Milestone 2, addressing the top item in the Sprint 2 candidate backlog and technical debt register.
2. Candidate 2 (Persistent Distributed Graph Store) and Candidate 3 (Web Dashboard Multi-Agent View) represent valid alternative options depending on architectural priorities.

#### OPEN QUESTION

- **ADR-061-01**: Does project leadership require Candidate 1 (Native Quantized Local AI Model Execution & VRAM Offloading), Candidate 2 (Persistent SQLite/Vector Graph Store), or Candidate 3 (Web Dashboard Multi-Agent View) for the Task 061 implementation phase?
- _Resolution_: This Discovery Report establishes the complete authoritative plan and analysis for **Candidate 1 (Primary / Authoritative)** while preserving exact specifications and trade-offs for all candidates.

---

## 2. Baseline / Repository State

- **Current Git HEAD SHA**: `70062f284dd02f9f0233b02f0a9772cad6147f9c`
- **Remote Origin HEAD**: `70062f284dd02f9f0233b02f0a9772cad6147f9c` (In exact sync on `main`)
- **Working Tree**: Completely clean (0 modified files, 0 untracked files)
- **Monorepo Build State**: Clean (`pnpm -r run build` compiles all 8 packages/services/apps cleanly via `tsc`)
- **Monorepo Typecheck**: Clean (`tsc --noEmit` exits 0 with 0 errors)
- **Monorepo Linter**: Clean (`eslint .` reports 0 errors)
- **Code Formatting**: Clean (`prettier --check` passes across entire repository)
- **Monorepo Test Suite Baseline**:
  - Total Tests: **1150 tests**
  - Total Test Suites: **239 suites**
  - Pass: **1150**, Fail: **0**, Skipped: **0**
- **Architecture Boundaries**: Validated clean via `node scripts/validate-repo.js`
- **Security & Secret Scanner**: Validated clean via `node scripts/security-scan.js`
- **Recent CI Pipeline**: Run `34440725214` on `main` concluded with status **`success`** in 1m51s.

---

## 3. Authoritative Requirements

### 3.1 Candidate 1 Requirements (Primary): Native Quantized Local AI Execution

#### Functional Requirements:

1. **Real Model Execution Bindings**:
   - Transition from mock token simulation to real model execution for quantized formats (GGUF via `node-llama-cpp` or ONNX Runtime Node bindings).
   - Support model weight discovery, verification, and loading for standard lightweight instruction models (e.g. Phi-3 Mini 3.8B, Llama-3-8B-Instruct-Q4_K_M, or TinyLlama 1.1B).
2. **Dynamic VRAM / RAM Layer Offloading**:
   - Calculate optimal layer distribution across GPU VRAM and system RAM based on hardware profile metrics from `HardwareDetector`.
   - Adhere to the strict 80% maximum VRAM ceiling (`MAX_VRAM_PERCENT = 0.8`) and 70% maximum RAM ceiling (`MAX_RAM_PERCENT = 0.7`).
3. **Deterministic Quantized Fallback**:
   - If VRAM is saturated and `allowCpuFallback: true`, dynamically reconfigure model loading for CPU quantization execution.
   - If both GPU VRAM and CPU RAM thresholds are exceeded, fail closed with explicit resource exhaustion errors.
4. **Token Streaming & Context Management**:
   - Stream generated token chunks through `PromptTemplateIsolationService` with real-time control token neutralization.
   - Enforce bounded context windows (max prompt 128 KB, max output 8,192 tokens, timeout 120s).

#### Security & Authority Requirements:

1. **Cryptographic Lease Scope Enforcement (`061-SEC-01`)**:
   - Mandatory verification of `ai:inference` or `ai:write` scopes within an unexpired `ExecutionLeaseHeader`.
   - Rejection of expired, revoked, or tampered execution leases.
2. **Tenant & Workspace Boundary Isolation (`061-SEC-02`)**:
   - Enforce strict equality between request `tenantId`, lease `tenant_id`, and host identity.
   - Reject cross-tenant model execution requests.
3. **Prompt Template Neutralization (`061-SEC-03`)**:
   - Strip null bytes, normalize Unicode to NFC, and defang adversarial prompt injection tokens (`<|im_start|>`, `[INST]`, `<<SYS>>`, `<s>`, `<|endoftext|>`).
4. **Loopback Endpoint Enforcement (`061-SEC-04`)**:
   - Prevent SSRF by validating that all provider endpoints are strictly bound to loopback addresses (`127.0.0.1`, `localhost`, `::1`).
5. **Tamper-Resistant Evidence Digest (`061-SEC-05`)**:
   - Calculate deterministic SHA-256 evidence digest (`computeModelEvidenceChecksum`) binding `requestId`, `taskId`, `leaseId`, `tenantId`, `modelId`, `provider`, `promptHash`, `outputHash`, and `cpuFallback`.

### 3.2 Candidate 2 Requirements: Persistent Distributed Graph Store

- Disk-backed SQLite storage engine implementing `IMemoryStore`.
- ACID transaction boundaries for episodic memory ingestion and graph node/edge upserts.
- Atomic cascading tombstoning ensuring that deleting an entity removes all connected edges and dependent playbooks.
- Bounded BFS subgraph traversal (`maxDepth <= 4`) with depth limits enforced at the SQL query level.
- Vector similarity search indexing for semantic memory retrieval.

### 3.3 Candidate 3 Requirements: Web Dashboard Multi-Agent View

- Visual representation of the hierarchical sub-agent delegation tree in `apps/web-dashboard`.
- Real-time streaming of federated ACP messages (`delegation:request`, `progress:update`, `cancellation:cascade`).
- Operator cockpit for inspecting composite execution receipts, evidence Merkle trees, and HITL approvals.

---

## 4. Existing Implementation Inventory

| Component Path                                                      | Current State           | Owner Subsystem       | Purpose & Capability                                                                                                           | Task 061 Impact                                                  |
| :------------------------------------------------------------------ | :---------------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| `packages/contracts/src/ai/index.ts`                                | Complete (Task 051)     | Shared Contracts      | Exports `ModelProviderTypeSchema`, `ModelHardwareBudgetSchema`, `ModelInferenceRequestSchema`, `computeModelEvidenceChecksum`. | **EXTEND** with native binding options and layer offload config. |
| `apps/desktop-agent/src/runtimes/local-ai/types.ts`                 | Complete (Task 051)     | Local AI Runtime      | Defines `HardwareProfile`, `ResourceReservation`, `ModelArtifact`, `InferenceRequest`, `ILocalModelProvider`.                  | **REUSE** domain types and resource bounds.                      |
| `apps/desktop-agent/src/runtimes/local-ai/hardware-detector.ts`     | Complete (Task 051)     | Local AI Runtime      | Detects CPU architecture, cores, total RAM, free RAM, GPU adapters, VRAM, and thermal state.                                   | **REUSE** for hardware headroom sampling.                        |
| `apps/desktop-agent/src/runtimes/local-ai/resource-governor.ts`     | Complete (Task 051)     | Local AI Runtime      | Enforces 80% VRAM ceiling, 70% RAM ceiling, and CPU fallback routing.                                                          | **EXTEND** to calculate layer offloading splits.                 |
| `apps/desktop-agent/src/runtimes/local-ai/prompt-isolation.ts`      | Complete (Task 051)     | Local AI Runtime      | Normalizes text to NFC, defangs control tokens, and wraps prompt boundaries.                                                   | **REUSE** for all streaming token passes.                        |
| `apps/desktop-agent/src/runtimes/local-ai/provider-adapters.ts`     | Mock / Simulation       | Local AI Runtime      | Contains simulated string token generation loops for Ollama, LLaMA, LM Studio, ONNX, and CPU fallback.                         | **REPLACE / EXTEND** with native weight execution adapters.      |
| `apps/desktop-agent/src/runtimes/local-ai/model-cache-manager.ts`   | Complete (Task 051)     | Local AI Runtime      | Content-addressed model artifact storage, SHA-256 verification, and quota eviction.                                            | **REUSE** for downloading and verifying model weights.           |
| `apps/desktop-agent/src/runtimes/local-ai/model-runtime-manager.ts` | Complete (Task 051)     | Local AI Runtime      | Manages model lifecycles, validates cryptographic leases, and coordinates inference dispatch.                                  | **EXTEND** to manage native model handles and process lifecycle. |
| `apps/desktop-agent/src/runtimes/local-ai/runtime.ts`               | Complete (Task 051)     | Local AI Runtime      | Integrates Local AI into Desktop Agent orchestrator execution boundary.                                                        | **REUSE** orchestrator routing.                                  |
| `apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`         | Complete (Task 051/060) | Desktop Orchestration | Dispatches task nodes to runtimes under validated execution leases.                                                            | **LEAVE UNTOUCHED**                                              |
| `services/backend/src/leases/lease-issuer.ts`                       | Complete (Task 047/060) | Backend Leases        | Issues signed single and delegated execution leases with scope bindings.                                                       | **REUSE** for `ai:inference` authority.                          |

---

## 5. Architectural Authority Map

```
┌────────────────────────────────────────────────────────────────────────┐
│ NEXUSOS ARCHITECTURAL AUTHORITY MAP                                    │
├──────────────────┬──────────────────────┬──────────────────────────────┤
│ SUBSYSTEM        │ CANONICAL AUTHORITY  │ TASK 061 MAY REUSE / MUST NOT│
├──────────────────┼──────────────────────┼──────────────────────────────┤
│ Lease Authority  │ LeaseIssuer (Backend)│ REUSE cryptographic leases;  │
│                  │                      │ MUST NOT self-issue leases   │
│ Model Routing    │ ModelRouter (AI EDD) │ REUSE provider selection;    │
│                  │                      │ MUST NOT override policy     │
│ Resource Safety  │ ResourceGovernor (DA)│ REUSE VRAM/RAM limits;       │
│                  │                      │ MUST NOT exceed 80% VRAM     │
│ Prompt Isolation │ PromptIsolation (DA) │ REUSE control neutralization;│
│                  │                      │ MUST NOT pass raw tokens     │
│ Cache & Weights  │ ModelCacheManager(DA)│ REUSE SHA-256 checksums;     │
│                  │                      │ MUST NOT load unverified GGUF│
│ Evidence & Audit │ computeModelEvidence │ REUSE deterministic SHA-256; │
│                  │                      │ MUST NOT alter evidence schema│
│ Task Hierarchy   │ DelegationCoordinator│ REUSE parent-child lineage;  │
│                  │                      │ MUST NOT bypass bounds       │
└──────────────────┴──────────────────────┴──────────────────────────────┘
```

---

## 6. Security Threat Model

| Threat ID      | Threat Description                                                                                                                       | Trust Boundary                                       | Authority Owner                                         | Enforcement Location                                | Required Test                                                                           |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------- | :------------------------------------------------------ | :-------------------------------------------------- | :-------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **061-SEC-01** | **Unauthenticated / Scope-Escalated Inference**: Caller executes local AI inference without a valid `ai:inference` or `ai:write` lease.  | Desktop Agent Host $\leftrightarrow$ Local AI Engine | LeaseIssuer / PolicyEvaluator                           | `ModelRuntimeManager.executeInferenceDirect`        | Attempt execution without lease or with wrong scopes; verify fail-closed rejection.     |
| **061-SEC-02** | **Cross-Tenant Context Contamination**: Caller requests inference using model or lease from another tenant.                              | Tenant Boundary                                      | Identity Service                                        | `ModelRuntimeManager`                               | Provide mismatched `tenantId`; verify immediate rejection.                              |
| **061-SEC-03** | **Prompt Injection & Control Token Hijacking**: Untrusted prompt contains LLM control tokens (`<                                         | im_start                                             | >`, `[INST]`) attempting to escape system instructions. | Untrusted Input $\leftrightarrow$ Local LLM Context | Prompt Isolation Service                                                                | `PromptTemplateIsolationService.isolatePrompt` | Submit adversarial prompt with control tokens; verify neutralization to `[escaped:...]`. |
| **061-SEC-04** | **Host Resource Starvation (OOM / DoS)**: Massive inference request allocates excessive VRAM/RAM crashing the OS or competing processes. | Local AI Engine $\leftrightarrow$ Host OS Hardware   | ResourceGovernor                                        | `ResourceGovernor.reserveResources`                 | Request model exceeding 80% VRAM and 70% RAM; verify fail-closed admission rejection.   |
| **061-SEC-05** | **SSRF via Provider Endpoint**: Malicious task specifies remote HTTP endpoint for local model provider to probe internal networks.       | Local AI Engine $\leftrightarrow$ Network Subsystem  | Provider Adapters                                       | `validateLoopbackEndpoint`                          | Supply non-loopback URL (`http://169.254.169.254`); verify `ENDPOINT_DISALLOWED` error. |
| **061-SEC-06** | **Tampered Model Weight Execution**: Corrupted or malicious model weights loaded into native runtime process.                            | Storage Artifact $\leftrightarrow$ Execution Memory  | ModelCacheManager                                       | `ModelCacheManager.verifyArtifactIntegrity`         | Alter SHA-256 hash or file contents; verify refusal to load.                            |
| **061-SEC-07** | **Evidence Forgery / Non-Repudiation Failure**: Model execution produces untracked or tampered evidence receipts.                        | Local AI Runtime $\leftrightarrow$ Orchestrator      | Shared Contracts                                        | `computeModelEvidenceChecksum`                      | Alter promptHash or outputHash; verify evidence checksum validation fails.              |

---

## 7. Tenant / Workspace / Identity Boundaries

1. **Tenant Identity Validation**:
   - `tenantId` is immutable and bound cryptographically inside the signed `ExecutionLeaseHeader`.
   - `ModelRuntimeManager` compares request `tenantId` with lease `tenant_id` using strict string equality.
2. **Workspace Isolation**:
   - Model storage paths are confined to tenant-specific or global approved cache directories (`.nexus-local-ai/models`).
   - Relative path traversal (`..`), UNC paths, and symlink escapes outside the designated model cache are rejected.
3. **Correlation & Lineage Binding**:
   - Every inference request binds `taskId`, `requestId`, and optional `correlationId`.
   - Evidence records cryptographically link output text to caller task identity.

---

## 8. Canonical Contract Gap

### Existing Contracts (`packages/contracts/src/ai/index.ts`):

- `ModelProviderTypeSchema` (`ollama`, `llamacpp`, `lmstudio`, `onnx`, `cpu_fallback`)
- `LocalAiOperation` (`local-ai:generate`, `local-ai:list-models`, `local-ai:get-hardware-profile`, `local-ai:unload-model`)
- `ModelHardwareBudgetSchema` (`maxVramBytes`, `maxRamBytes`, `allowCpuFallback`)
- `PromptIsolationPolicySchema` (`strictSeparation`, `neutralizeControlTokens`)
- `ModelInferenceRequestSchema` & `ModelInferenceResponseSchema`
- `computeModelEvidenceChecksum`

### Contract Additions Required for Task 061 (Candidate 1):

1. **`NativeModelBindingSchema`**:
   - Discriminated schema for native runtime options (`ENGINE_LLAMACPP_NATIVE`, `ENGINE_ONNX_NATIVE`, `ENGINE_FALLBACK_SIMULATOR`).
2. **`VramLayerOffloadProfileSchema`**:
   - Encapsulates offloading metrics: `totalLayers`, `gpuLayers`, `cpuLayers`, `gpuMemoryAllocatedBytes`, `cpuMemoryAllocatedBytes`.
3. **`ModelQuantizationTypeSchema`**:
   - Standard quantization formats: `Q4_K_M`, `Q5_K_M`, `Q8_0`, `FP16`, `INT8`.

---

## 9. State / Data / Persistence

| State Object                      | Owner                         | Lifecycle                                                 | Storage Technology                               | Tenancy                                   | Idempotency / Recovery                     |
| :-------------------------------- | :---------------------------- | :-------------------------------------------------------- | :----------------------------------------------- | :---------------------------------------- | :----------------------------------------- |
| **Model Weights (.gguf / .onnx)** | `ModelCacheManager`           | Content-addressed, quota-managed                          | Local disk filesystem (`.nexus-local-ai/models`) | Shared read-only cache; checksum-verified | Immutable, verified by SHA-256 before load |
| **Active Model Process / Handle** | `ModelRuntimeManager`         | Ephemeral (loaded on demand, unloaded on idle/timeout)    | Host RAM / GPU VRAM                              | In-memory process boundary                | Process termination on shutdown or crash   |
| **Resource Reservations**         | `ResourceGovernor`            | Ephemeral (acquired during inference, released on finish) | In-memory active map                             | Host hardware level                       | Auto-release on timeout or exception       |
| **Inference Evidence Receipts**   | Desktop Agent / Backend Tasks | Monotonic, permanent audit log                            | Backend DB / Task store                          | Tenant-bound                              | Deterministic SHA-256 evidence digest      |

---

## 10. Failure & Recovery Semantics

| Failure Scenario                             | Classification        | Recovery Action                                                                                |
| :------------------------------------------- | :-------------------- | :--------------------------------------------------------------------------------------------- |
| **VRAM Exhaustion during Load**              | Fail Closed / Degrade | Trigger `ResourceGovernor` CPU fallback if `allowCpuFallback: true`; otherwise reject request. |
| **System RAM Ceiling Exceeded (>70%)**       | Fail Closed           | Deny inference request with `RESOURCE_BUDGET_EXCEEDED`; do not allocate memory.                |
| **Model Artifact Checksum Mismatch**         | Fail Closed           | Quarantines corrupted file, deletes partial download, rejects load request.                    |
| **Inference Process Hang / Timeout (>120s)** | Compensate / Cancel   | Emit AbortSignal, terminate native inference thread/process, release resource reservation.     |
| **SSRF / Disallowed Endpoint**               | Fail Closed           | Reject immediately with `ENDPOINT_DISALLOWED`; emit security audit event.                      |
| **Adversarial Prompt Token Injection**       | Sanitize & Execute    | Neutralize tokens to `[escaped:...]`, preserve structural boundaries, proceed safely.          |

---

## 11. Performance / Resource Constraints

1. **VRAM Safety Ceiling**: Maximum 80% of detected GPU VRAM (`MAX_VRAM_PERCENT = 0.8`).
2. **RAM Safety Ceiling**: Maximum 70% of total physical RAM (`MAX_RAM_PERCENT = 0.7`).
3. **Maximum Prompt Payload**: 128 KB (`MAX_PROMPT_BYTES = 131072`).
4. **Maximum Output Tokens**: 8,192 tokens (`MAX_OUTPUT_TOKENS = 8192`).
5. **Maximum Output Text Payload**: 1 MB (`MAX_OUTPUT_BYTES = 1048576`).
6. **Inference Execution Timeout**: 120,000 ms (`INFERENCE_TIMEOUT_MS = 120000`).
7. **Concurrency Bound**: Maximum 2 concurrent inference sessions per host (`MAX_CONCURRENT_INFERENCES = 2`).

---

## 12. Observability

- **Structured Audit Events**:
  - `ai.model.load.started`, `ai.model.load.completed`, `ai.model.load.failed`
  - `ai.inference.started`, `ai.inference.chunk`, `ai.inference.completed`, `ai.inference.denied`
  - `ai.resource.governor.fallback.triggered`
- **Correlation**:
  - Every log entry binds `tenantId`, `workspaceId`, `taskId`, `requestId`, `modelId`, and `provider`.
- **Secret Redaction**:
  - Execution lease tokens, API credentials, and raw private prompt segments marked sensitive MUST NOT appear in plaintext logs or telemetry streams.

---

## 13. Testing Gap

| Test Area                            | Target Location                                               | Description                                                                                                                                            |
| :----------------------------------- | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native Contract Validation**       | `packages/contracts/tests/ai-native-contracts.test.ts`        | Verify Zod parsing for native binding configs, offload profiles, and quantization types.                                                               |
| **Dynamic Layer Offload Unit Tests** | `apps/desktop-agent/tests/local-ai-vram-offloader.test.ts`    | Test calculation of CPU vs GPU layer splits across various VRAM headroom profiles.                                                                     |
| **Native Adapter Conformance**       | `apps/desktop-agent/tests/local-ai-native-adapter.test.ts`    | Validate load, stream, unload, cancellation, and fallback mechanics against real or simulated native bindings.                                         |
| **Security Invariants Hardening**    | `tests/hardening/local-ai-hardware-security.test.ts`          | Verify `061-SEC-01` through `061-SEC-07` under adversarial conditions.                                                                                 |
| **Vertical Slice Integration**       | `tests/vertical-slice/local-ai-native-vertical-slice.test.ts` | End-to-end flow: Task Lease $\rightarrow$ Model Request $\rightarrow$ Governor Offload $\rightarrow$ Streaming Output $\rightarrow$ Evidence Checksum. |

---

## 14. Dependencies & Blockers

- **Prerequisites Satisfied**:
  - Task 051 (Local AI Model Router & Engine Scaffolding): **COMPLETE**.
  - Task 052 (HITL Approval Interceptor): **COMPLETE**.
  - Task 060 (Multi-Agent Collaboration & Federated ACP): **COMPLETE**.
- **Hard Blockers**:
  - **Zero hard blockers**. Monorepo toolchain (Node 24, pnpm 11, TS 5.7) is stable and CI is 100% green.
- **Environmental Considerations**:
  - Local AI native execution on CI environments (Linux GitHub runners) lacks physical NVIDIA GPUs. Tests must verify that `HardwareDetector` and `ResourceGovernor` correctly detect CPU-only environments and deterministically route to CPU-quantized fallback without failing CI.

---

## 15. In Scope

For Candidate 1 (Native Quantized Local AI Model Execution & VRAM Offloading):

1. Extension of contracts in `packages/contracts/src/ai/` to support native engine configurations and layer offloading profiles.
2. Implementation of dynamic layer offloader in `apps/desktop-agent/src/runtimes/local-ai/` computing optimal GPU/CPU splits.
3. Implementation of real/deterministic native adapter conforming to `ILocalModelProvider`.
4. Integration with `ResourceGovernor` and `HardwareDetector` for real-time headroom monitoring.
5. Verification of all security invariants (`061-SEC-01` through `061-SEC-07`).
6. Comprehensive unit, security hardening, and vertical-slice tests.

---

## 16. Out of Scope

- Model training, fine-tuning, or backpropagation (NexusOS does not train foundation models; PRD Section 35).
- Cloud model provider integrations (e.g. OpenAI, Anthropic) — local AI engine is strictly workstation-resident.
- Persistent SQLite vector database implementation (reserved for Candidate 2 / Task 062+).
- Web Dashboard UI updates (reserved for Candidate 3 / Task 062+).
- Distributed multi-node model clustering or remote vLLM cluster management.

---

## 17. Deferred Work

- **Sprint 3**: Cloud State Sync & Enterprise Directory RBAC (`docs/SPRINT_2_READINESS_AND_BACKLOG.md` Section 4 Item 4).
- **Subsequent Milestones**: Persistent distributed vector memory graph, enterprise SAML/OIDC synchronization.

---

## 18. Proposed Files (Candidate 1)

### New Files to Create:

1. `packages/contracts/src/ai/native.ts` — Schemas for native bindings, layer offloading, and quantization types.
2. `packages/contracts/tests/ai-native-contracts.test.ts` — Contract audit and serialization tests.
3. `apps/desktop-agent/src/runtimes/local-ai/vram-offloader.ts` — VRAM/RAM layer offloading calculation engine.
4. `apps/desktop-agent/tests/local-ai-vram-offloader.test.ts` — Offloader unit tests.
5. `tests/hardening/local-ai-hardware-security.test.ts` — Adversarial security hardening suite (`061-SEC-01..07`).
6. `tests/vertical-slice/local-ai-native-vertical-slice.test.ts` — End-to-end vertical-slice test.

### Existing Files to Modify:

1. `packages/contracts/src/ai/index.ts` — Re-export native AI schemas.
2. `packages/contracts/src/index.ts` — Re-export shared contract additions.
3. `apps/desktop-agent/src/runtimes/local-ai/resource-governor.ts` — Integrate layer offloading calculation.
4. `apps/desktop-agent/src/runtimes/local-ai/provider-adapters.ts` — Implement native execution adapter conforming to `ILocalModelProvider`.
5. `apps/desktop-agent/src/runtimes/local-ai/index.ts` — Re-export offloader.
6. `package.json` — Register new test suites in `test` script.

### Files That Must NOT Be Touched:

- `services/identity/**` (Identity and token validation authority must remain unaltered)
- `services/policy/**` (PolicyEvaluator rules remain normative)
- `services/backend/src/agents/**` (Task 060 multi-agent delegation must remain intact)
- `services/backend/src/memory/**` (Governed memory subsystem must not be regressed)

---

## 19. Recommended Implementation Sequence

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CANONICAL CONTRACTS (packages/contracts/src/ai/native.ts)│
│    - NativeModelBindingSchema, VramLayerOffloadSchema       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 2. LAYER OFFLOADER (apps/desktop-agent/src/local-ai)        │
│    - Compute GPU vs CPU layer allocations from headroom     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 3. RESOURCE GOVERNOR EXTENSION                              │
│    - Enforce 80% VRAM ceiling, 70% RAM ceiling, and splits  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 4. NATIVE ADAPTER IMPLEMENTATION                            │
│    - Conforming ILocalModelProvider with streaming tokens   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 5. ADVERSARIAL SECURITY & VERTICAL-SLICE TEST SUITES        │
│    - tests/hardening/local-ai-hardware-security.test.ts     │
│    - tests/vertical-slice/local-ai-native-vertical-slice.ts │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 6. MONOREPO QUALITY GATES & CI VERIFICATION                 │
│    - build, typecheck, lint, format:check, validate, test   │
└─────────────────────────────────────────────────────────────┘
```

---

## 20. Risks / Open Questions / ADR Candidates

1. **Hardware Heterogeneity across Development & CI Environments**:
   - _Risk_: GitHub Actions CI runners do not provide physical NVIDIA GPUs.
   - _Mitigation_: The implementation must treat GPU unavailability as a normal environmental condition: `HardwareDetector` reports 0 VRAM, and `ResourceGovernor` deterministically engages the CPU-quantized fallback adapter without throwing unexpected hardware errors.
2. **Native Dependency Compilation vs. Pure JS / WASM Fallback**:
   - _Risk_: Heavy C++ native node addons can break cross-platform builds if pre-built binaries are missing on Windows or Linux.
   - _Mitigation_: Ensure native engine adapters provide robust fallback interfaces and clean error boundaries that never crash the host agent process.
3. **Candidate Priority Confirmation (ADR-061-01)**:
   - Does project leadership mandate Candidate 1 (Native Local AI Execution & VRAM Offloading) as the immediate focus for Task 061, or should Candidate 2 (Persistent Distributed Graph Store) or Candidate 3 (Web Dashboard Multi-Agent View) be executed first?
   - _Status_: Open for project leadership confirmation before the Task 061 implementation phase begins.

---

## 21. Discovery Conclusion

Sprint 2 Milestone 1 (Task 060) is fully closed, and the repository baseline is 100% clean and green (`1150/1150` tests passing).

The primary candidate for **TASK 061: SPRINT 2 MILESTONE 2 — NATIVE QUANTIZED LOCAL-AI MODEL EXECUTION, VRAM OFFLOADING & HARDWARE-ACCELERATED INFERENCE (ONNX / GGUF / LLAMA.CPP)** is comprehensively researched, architecturally bounded, and unblocked. All authority boundaries, security invariants (`061-SEC-01..07`), and candidate alternatives have been formally cataloged and are ready for implementation upon direction from project leadership.
