# Task 065 Discovery Report

**Sprint 3 Milestone 1 — Local-AI Model Manifest Specification, Secure Artifact Lifecycle & Inference Benchmarking**

- **Date**: 2026-09-10
- **Authoritative Baseline SHA**: `7384c35c3ed713da036617b74c256f1d9b027058`
- **Preceding Frontier**: Task 064 (Sprint 2 Milestone 5 — Sprint 2 Exit Gate: Hardening, Quality Gate Finalization & Sprint 3 Readiness) — closed and pushed to `origin/main`.
- **Status**: DISCOVERY COMPLETE — READY FOR IMPLEMENTATION PLAN

---

## 1. Task Identity

### Authoritative Identity

- **Canonical Title**: `TASK 065: SPRINT 3 MILESTONE 1 — LOCAL-AI MODEL MANIFEST SPECIFICATION, SECURE ARTIFACT LIFECYCLE & INFERENCE BENCHMARKING`
- **Alternative Title**: `TASK 065: SPRINT 3 MILESTONE 1 (CANDIDATE S3-01) — END-TO-END MODEL WEIGHT INTEGRATION & INFERENCE BENCHMARKING`
- **Sprint**: Sprint 3
- **Milestone**: Milestone 1 (Sprint 3 Initialization)
- **Owning Subsystem**: Desktop Agent Local-AI Runtime Subsystem (`apps/desktop-agent/src/runtimes/local-ai/`) & Shared AI Contracts (`packages/contracts/src/ai/`)
- **Dependencies**: Task 061 (Native Local-AI Runtime, VRAM Offloader, Hardware Detector) and Task 064 (Sprint 2 Exit Gate). All are complete, tested, and verified green.
- **Business Objective**: Complete the local inference foundation delivered in Sprint 2 by formalizing the canonical GGUF/ONNX model manifest schema in `@nexusos/contracts`, implementing the secure model acquisition, verification, caching, and quarantine lifecycle in `ModelCacheManager`, and delivering a repeatable, truthful inference benchmarking harness on reference developer hardware (NVIDIA GeForce RTX 3050 6GB Laptop GPU + AMD Ryzen 5 8645HS) that enforces strict memory safety ceilings without sacrificing CI portability.

### Expected Completion Criteria

1. Canonical model manifest and artifact acquisition schemas added to `@nexusos/contracts/src/ai/` (`ModelManifestSchema`, `ModelArtifactSourceSchema`, `ModelDownloadRequestSchema`, `ModelDownloadProgressSchema`, `InferenceBenchmarkResultSchema`).
2. `ModelCacheManager` in `apps/desktop-agent/src/runtimes/local-ai/model-cache-manager.ts` extended with a secure, SSRF-guarded, chunked streaming download lifecycle (`downloadArtifact()`) with progress reporting and immediate quarantine on SHA-256 digest mismatch.
3. Reference hardware benchmarking runner (`scripts/benchmark-local-ai.js`) measuring tokens/second, time-to-first-token (TTFT), and VRAM/RAM allocation under Q4_K_M and Q5_K_M quantization schemes, reporting truthfully (`cpuFallback: true` vs `gpuAccelerated: true`) with zero fabricated GPU claims.
4. Security hardening suite `tests/hardening/local-ai-model-manifest-security.test.ts` exercising invariants `065-SEC-01` through `065-SEC-08`.
5. Vertical slice test `tests/vertical-slice/local-ai-benchmarking-vertical-slice.test.ts` verifying end-to-end model manifest validation, secure acquisition, cache placement, execution planning, and inference evidence verification.
6. All repository quality gates remain 100% green: `build`, `typecheck`, `lint`, `format:check`, `validate`, `security`, and full test suite (`pnpm test` passing 1,316+ tests).

---

## 2. Repository Baseline

### Baseline Verification (Live Audit)

| Property                        | Value                                                                                          |            Verification Status             |
| :------------------------------ | :--------------------------------------------------------------------------------------------- | :----------------------------------------: |
| **Current HEAD**                | `7384c35c3ed713da036617b74c256f1d9b027058`                                                     |      Verified (`git rev-parse HEAD`)       |
| **Remote HEAD (`origin/main`)** | `7384c35c3ed713da036617b74c256f1d9b027058`                                                     |   Verified (`git rev-parse origin/main`)   |
| **Synchronization**             | `HEAD == origin/main`                                                                          |                 **MATCH**                  |
| **Working Tree Status**         | Clean (0 modified, 0 untracked)                                                                |      Verified (`git status --short`)       |
| **Active Sprint**               | Sprint 3 (Sprint 2 formally closed at Task 064)                                                | Verified (`SPRINT_2_COMPLETION_REPORT.md`) |
| **Full Test Suite Status**      | 1,316 passed / 1,316 total (293 suites, 0 failures, ~110s)                                     |               Verified live                |
| **Reference Hardware Profile**  | CPU: AMD Ryzen 5 8645HS (12 cores) / GPU: NVIDIA RTX 3050 6GB (6,144 MiB VRAM) / RAM: 15.23 GB |         Verified in Task 061 & 064         |

---

## 3. Authoritative Roadmap Evidence

### Evidence Tracing & Hierarchy

#### FACT 1: Sprint 3 Readiness Document Defines Candidate Ordering (`docs/SPRINT_3_READINESS_AND_BACKLOG.md`)

At the formal close of Sprint 2 (Task 064), the platform engineering team authored [`docs/SPRINT_3_READINESS_AND_BACKLOG.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/SPRINT_3_READINESS_AND_BACKLOG.md). Section 2 explicitly enumerates five candidates for Sprint 3 in deliberate numerical sequence:

- **`CANDIDATE S3-01: End-to-End Model Weight Integration & Inference Benchmarking`**
- **`CANDIDATE S3-02: Real-Time Graph Evolution — Streaming Memory Writes to Knowledge Graph`**
- **`CANDIDATE S3-03: Dashboard Real-Time Agent Telemetry & Delegation Live Tree`**
- **`CANDIDATE S3-04: Plugin SDK — Memory & Graph Write Capability`**
- **`CANDIDATE S3-05: Autonomous Replanning — Memory-Informed Goal Decomposition`**

#### FACT 2: High Priority Technical Debt Attribution (`docs/SPRINT_3_READINESS_AND_BACKLOG.md` §3)

Section 3 ("Technical Debt & Deferrals from Sprint 2") evaluates and prioritizes the unfinished scope of previous tasks:

- **`Real GGUF model download lifecycle`**: Deferred from Task 061, Priority: **HIGH — required for real local-AI usage**.
- **`Memory-informed autonomous replanning`**: Deferred from Task 062 / Sprint 1, Priority: **HIGH — core AI quality improvement**.
- **`Automatic graph derivation from memory content`**: Deferred from Task 062, Priority: **MEDIUM**.
- **`Dashboard live delegation SSE streaming`**: Deferred from Task 063 Phase 2, Priority: **MEDIUM**.
- **`Plugin write capability for memory`**: Deferred from Task 062 / Plugin SDK, Priority: **LOW**.

#### FACT 3: Historical Candidate Numbering Precedent

In `docs/SPRINT_2_READINESS_AND_BACKLOG.md` §4, Sprint 2 items were numbered:

- Item 1: Advanced Multi-Agent Collaboration → Delivered as **Task 060 (Sprint 2 Milestone 1)**
- Item 2: Native Quantized Local-AI Model Execution → Delivered as **Task 061 (Sprint 2 Milestone 2)**
- Item 3: Persistent Distributed Graph Store & Vector Search → Delivered as **Task 062 (Sprint 2 Milestone 3)**
- Item 4: Web Dashboard Multi-Agent View & Timeline → Delivered as **Task 063 (Sprint 2 Milestone 4)**
- Formal Sprint 2 Exit Gate → Delivered as **Task 064 (Sprint 2 Milestone 5)**

By exact structural induction, `CANDIDATE S3-01` represents **Sprint 3 Milestone 1 (Task 065)**.

#### FACT 4: Prior Deferral of Cloud State Sync & Enterprise RBAC

In `docs/SPRINT_2_READINESS_AND_BACKLOG.md` §4 Item 4, "Cloud State Sync & Enterprise RBAC" was marked as `[DEFERRED] Status: Deferred to Sprint 3`. It was subsequently cited across all Sprint 2 discovery reports (Tasks 060 through 064) as an item prohibited from Sprint 2 scope.

#### INFERENCE: Why Cloud State Sync Is Not Sprint 3 Milestone 1

While Cloud State Sync was deferred to "Sprint 3", the repository currently lacks any cloud infrastructure substrate (in `infrastructure/`, `terraform/` and `docker/` are stubs; no remote synchronization control plane exists). In contrast, the local AI runtime (`apps/desktop-agent/src/runtimes/local-ai/`) is already active, tested, and operational on the developer machine, requiring only model manifest and weight acquisition lifecycle completion to provide empirical model execution. Attempting to implement Cloud State Sync before completing the local AI weight foundation would invert the dependency chain.

---

## 4. Candidate Milestones Considered

| Candidate ID                | Name / Scope                                                             | Source Document                                             | Stated Objective                                                                                                 | Dependencies                                               |   Sprint 2 Deferral Status    | Conflict / Blocker                                                                              |                Assessment                 |
| :-------------------------- | :----------------------------------------------------------------------- | :---------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- | :---------------------------: | :---------------------------------------------------------------------------------------------- | :---------------------------------------: |
| **Candidate A (Selected)**  | **End-to-End Model Weight Integration & Inference Benchmarking (S3-01)** | `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 CANDIDATE S3-01 | Define GGUF/ONNX manifest, implement download & checksum verification in `ModelCacheManager`, benchmark RTX 3050 | Task 061 (local-ai runtime)                                |    High-Priority Debt (§3)    | None. Builds on existing local-ai runtime.                                                      |       **AUTHORITATIVE (Task 065)**        |
| **Candidate B (Competing)** | **Cloud State Sync & Enterprise RBAC**                                   | `docs/SPRINT_2_READINESS_AND_BACKLOG.md` §4 Item 4          | Multi-tenant cloud synchronization of task receipts and enterprise directory integration                         | `services/identity`, `services/policy`, `services/backend` | Formally Deferred to Sprint 3 | No cloud infrastructure exists in `infrastructure/`. Premature before local runtimes stabilize. | **DEFERRED to later Sprint 3 / Sprint 4** |
| **Candidate C (Competing)** | **Memory-Informed Autonomous Replanning (S3-05)**                        | `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 CANDIDATE S3-05 | Inject episodic memory & knowledge graph into `ReplanCoordinator` and `Decomposer`                               | Task 062, Sprint 1 Planner                                 |    High-Priority Debt (§3)    | Needs mature local model inference (S3-01) for intelligent semantic replanning.                 |     **SEQUENCED as Task 069 (S3-05)**     |
| **Candidate D (Competing)** | **Real-Time Graph Evolution (S3-02)**                                    | `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 CANDIDATE S3-02 | Extract entities/concepts from `MemoryRecord` content and stream upserts to `GraphProjectionEngine`              | Task 062 (`GraphProjectionEngine`)                         |   Medium-Priority Debt (§3)   | Deriving entities benefits from local inference model (S3-01).                                  |     **SEQUENCED as Task 066 (S3-02)**     |
| **Candidate E (Competing)** | **Dashboard Real-Time Telemetry & Delegation Tree (S3-03)**              | `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 CANDIDATE S3-03 | SSE delegation stream from `DelegationCoordinator` and live tree visualization in web dashboard                  | Task 060, Task 063                                         |   Medium-Priority Debt (§3)   | UI projection improvement; secondary to runtime intelligence.                                   |     **SEQUENCED as Task 067 (S3-03)**     |
| **Candidate F (Competing)** | **Plugin SDK Memory & Graph Write Capability (S3-04)**                   | `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 CANDIDATE S3-04 | Add `PluginMemoryWriteCapability` to `packages/plugin-sdk` with tenant isolation                                 | Task 062, `packages/plugin-sdk`                            |    Low-Priority Debt (§3)     | Expands plugin trust perimeter; requires broader security review.                               |     **SEQUENCED as Task 068 (S3-04)**     |

---

## 5. Canonical Task 065 Selection

### Resolution of Roadmap Ambiguity

The repository presents an apparent ambiguity between two distinct planning signals:

1. **Historical Backlog Deferral**: `docs/SPRINT_2_READINESS_AND_BACKLOG.md` §4 Item 4 states that "Cloud State Sync & Enterprise RBAC" is deferred to Sprint 3.
2. **Current Sprint 3 Readiness Document**: `docs/SPRINT_3_READINESS_AND_BACKLOG.md` §2 explicitly defines Sprint 3 Milestone 1 as `CANDIDATE S3-01: End-to-End Model Weight Integration & Inference Benchmarking`.

### Why Candidate S3-01 is Authoritative for Task 065

1. **Recency and Specificity of Authority**: `docs/SPRINT_3_READINESS_AND_BACKLOG.md` was authored during Task 064 at the exact Sprint 2 exit boundary, superseding the high-level roadmap sketches in Sprint 1's backlog.
2. **Foundation Completeness Before Feature Breadth**: Task 061 delivered the runtime execution boundaries (`VramOffloader`, `HardwareDetector`, `ProviderAdapters`), but explicitly excluded real model weight manifests, external acquisition, and physical hardware benchmarks. Leaving model weights unaddressed leaves the local AI runtime as a simulated/mocked substrate.
3. **Prerequisite for Downstream Sprint 3 Work**:
   - `CANDIDATE S3-02` (Graph Evolution) requires local entity extraction from memory records.
   - `CANDIDATE S3-05` (Memory-Informed Replanning) requires local model execution to summarize past failures.
     Both depend directly on having a validated model weight lifecycle and benchmarked inference engine.
4. **Architectural Grounding**: NexusOS is designed as a local-first AI workspace platform (Enterprise PRD §1). Solidifying local model execution before building cloud sync preserves the local-first architecture invariant.

Therefore, **`CANDIDATE S3-01` is selected as the canonical Task 065.**

---

## 6. Existing Implementation Audit

### A. Already Implemented (Verified at Baseline `7384c35`)

- **`apps/desktop-agent/src/runtimes/local-ai/hardware-detector.ts`**:
  - Probes system RAM and GPU VRAM via platform commands (`nvidia-smi` / WMI).
  - Validated on developer hardware: AMD Ryzen 5 8645HS (12 cores), RTX 3050 6GB Laptop GPU (6,144 MiB VRAM).
- **`apps/desktop-agent/src/runtimes/local-ai/vram-offloader.ts`**:
  - Deterministic layer placement algorithm respecting hard safety limits: `MAX_VRAM_PERCENT = 0.80`, `MAX_RAM_PERCENT = 0.70`.
  - Supports Q4_K_M, Q5_K_M, Q8_0, FP16 quantizations.
- **`apps/desktop-agent/src/runtimes/local-ai/model-cache-manager.ts`**:
  - Directory structure (`stagingDir`, `modelsDir`).
  - Path traversal and symlink escape prevention via `resolveSafePath()`.
  - SHA-256 stream calculation (`computeSha256()`).
  - Model artifact storage and eviction bookkeeping.
- **`apps/desktop-agent/src/runtimes/local-ai/provider-adapters.ts`**:
  - `OllamaAdapter`, `LlamaCppAdapter`, `OnnxAdapter` interfaces.
  - SSRF guard (`validateLoopbackEndpoint()`).
- **`packages/contracts/src/ai/native.ts`**:
  - `NativeEngineDescriptorSchema`, `ModelLayerPlacementSchema`, `InferenceExecutionPlanSchema`, `NativeInferenceEvidenceSchema`.
  - `computeNativeEvidenceChecksum()`.

### B. Partially Implemented

- **`ModelCacheManager`**: Lacks an automated remote acquisition lifecycle (`downloadArtifact()`). Currently only supports importing local files via `importArtifact()`.
- **`LlamaCppAdapter`**: Simulates streamed tokens (`[llama.cpp GGUF Model]: Validated local inference response...`) when native backend is not attached. Does not parse real GGUF header metadata.

### C. Genuinely Missing (Required for Task 065)

1. **Canonical Manifest Contracts** (`packages/contracts/src/ai/manifest.ts`):
   - `ModelManifestSchema`: Formal specification of GGUF/ONNX models, parameter size, context length, quantization format, file byte size, expected SHA-256 digest, and source URLs.
   - `ModelArtifactSourceSchema`: Strict typed origins (e.g. `HUGGING_FACE`, `OLLAMA_REGISTRY`, `LOCAL_CACHE`, `CUSTOM_HTTPS`).
   - `ModelDownloadProgressSchema`: Streaming acquisition event payloads with bytes transferred, total bytes, rate, and ETA.
   - `InferenceBenchmarkResultSchema`: Empirical metrics schema capturing TTFT (ms), generation tokens/sec, VRAM delta (MiB), RAM delta (MiB), layer offload ratio, and truthfulness flag.
2. **Secure Acquisition Engine** (`ModelCacheManager.downloadArtifact()`):
   - Streamed chunk downloading to `staging/` directory.
   - On-the-fly SHA-256 hash accumulator.
   - Strict size ceiling abort (prevents disk-filling attacks).
   - Atomic promotion from `staging/` to `models/` ONLY after SHA-256 match.
   - Immediate quarantine / deletion on hash failure (`065-SEC-03`).
   - Source URL validation against SSRF loopback or HTTPS whitelist (`065-SEC-02`).
3. **Reference Hardware Benchmarking Harness** (`scripts/benchmark-local-ai.js`):
   - Script executing deterministic token generation runs.
   - Measures prompt evaluation time, token generation rate, and VRAM consumption.
   - Truthful execution reporting: flags `cpuFallback: true` if no physical GPU driver is engaged.

### D. Explicitly Deferred

- Multi-gigabyte model weight storage in the Git repository (violates repo size limits).
- Non-portable native binary bindings (`node-llama-cpp` or precompiled CUDA binaries) in monorepo root dependencies that would break GitHub Actions CI.
- External P2P or BitTorrent model distribution.

### E. Forbidden / Out of Scope

- Modifying `SqliteMemoryStore` or `GraphProjectionEngine` (reserved for Task 066 / S3-02).
- Modifying `ReplanCoordinator` (reserved for Task 069 / S3-05).
- Modifying Web Dashboard UI views (reserved for Task 067 / S3-03).
- Modifying `packages/plugin-sdk` (reserved for Task 068 / S3-04).
- Creating a second model cache or bypassing `ModelCacheManager`.

---

## 7. Architecture & Authority Boundaries

### Single Source of Truth Matrix

| Domain                                  | Authoritative Component   | Location                                    | Subordinate / Advisory Consumers   |
| :-------------------------------------- | :------------------------ | :------------------------------------------ | :--------------------------------- |
| **Model Manifest Contracts**            | `@nexusos/contracts`      | `packages/contracts/src/ai/`                | Desktop Agent, Dashboard, Scripts  |
| **Model Artifact Storage & Filesystem** | `ModelCacheManager`       | `apps/desktop-agent/src/runtimes/local-ai/` | Runtime Managers, Adapters         |
| **Hardware Capability & Telemetry**     | `HardwareDetector`        | `apps/desktop-agent/src/runtimes/local-ai/` | VramOffloader, ResourceGovernor    |
| **VRAM Budget & Layer Placement**       | `VramOffloader`           | `apps/desktop-agent/src/runtimes/local-ai/` | Inference Execution Plans          |
| **Execution Authorization & Leases**    | `PolicyEvaluator`         | `services/policy/`                          | Local-AI Runtime, Desktop Agent    |
| **Inference Evidence & Receipts**       | `NativeInferenceEvidence` | `packages/contracts/src/ai/`                | Backend Task Controller, Audit Log |

### Inviolable Governance Principles

1. **Model Cache is NOT Policy Authority**: Having a model cached locally does not authorize an agent to execute inference without a valid, unexpired, cryptographically signed lease from `services/policy`.
2. **Plans are NOT Execution Authority**: An `InferenceExecutionPlan` generated by `VramOffloader` is a technical resource allocation recommendation; it cannot bypass lease scopes.
3. **Truthful Execution Accounting**: If an inference request falls back to CPU due to VRAM limits or lack of native drivers, the evidence digest and telemetry must record `cpuFallback: true` and `gpuAccelerated: false`. Falsification of GPU acceleration is strictly prohibited.
4. **Single Cache Directory Authority**: All model files must be contained within `ModelCacheManager.baseDir`. No other component may write GGUF/ONNX files directly to disk.

---

## 8. Canonical Contract / API Impact

### Proposed New Contract Files (`packages/contracts/src/ai/manifest.ts`)

```typescript
// Proposed schema structures to be implemented in Task 065

export const ModelArtifactSourceTypeSchema = z.enum([
  'HUGGING_FACE',
  'OLLAMA_REGISTRY',
  'LOCAL_STORAGE',
  'TRUSTED_HTTPS',
]);

export const ModelManifestSchema = z.object({
  modelId: z.string().regex(/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_.-]+)?$/),
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  format: z.enum(['gguf', 'onnx']),
  quantization: z.enum(['Q4_K_M', 'Q5_K_M', 'Q8_0', 'FP16', 'FP32']),
  parameterSize: z.string().min(1).max(20), // e.g. "7B", "1.5B"
  contextLength: z.number().int().positive().max(131072),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  source: z.object({
    sourceType: ModelArtifactSourceTypeSchema,
    url: z.string().url(),
    mirrors: z.array(z.string().url()).optional(),
  }),
  metadata: z.record(z.unknown()).default({}),
  signature: z.string().optional(),
});

export const ModelDownloadRequestSchema = z.object({
  manifest: ModelManifestSchema,
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  maxBandwidthBytesPerSec: z.number().int().positive().optional(),
});

export const InferenceBenchmarkResultSchema = z.object({
  benchmarkId: z.string().uuid(),
  modelId: z.string(),
  quantization: z.string(),
  hardwareProfile: z.object({
    gpuName: z.string(),
    totalVramMiB: z.number(),
    systemRamMiB: z.number(),
  }),
  metrics: z.object({
    timeToFirstTokenMs: z.number().nonnegative(),
    tokensPerSecond: z.number().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalDurationMs: z.number().nonnegative(),
    peakVramUsedMiB: z.number().nonnegative(),
    peakRamUsedMiB: z.number().nonnegative(),
    gpuLayerCount: z.number().int().nonnegative(),
    cpuLayerCount: z.number().int().nonnegative(),
  }),
  cpuFallback: z.boolean(),
  gpuAccelerated: z.boolean(),
  timestamp: z.string().datetime(),
});
```

---

## 9. Security Threat Model

| Threat ID    | Threat Name                                     | Vector / Scenario                                                                                                             | Architectural Defense                                                                                                                                      |
| :----------- | :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T-065-01** | **Model Poisoning / Artifact Tampering**        | Attacker tampers with model file in transit or in staging cache to alter LLM weights (backdooring).                           | Mandatory SHA-256 stream computation against pre-signed `ModelManifestSchema`. Zero promotion to `models/` without exact hash match.                       |
| **T-065-02** | **SSRF via Model Download URL**                 | Malicious manifest specifies `http://169.254.169.254/` (cloud metadata) or internal RFC1918 subnets as model download source. | Strict source URL validation: reject cloud metadata addresses, loopback endpoints (unless explicitly configured in dev mode), and enforce HTTPS whitelist. |
| **T-065-03** | **Path Traversal / Symlink Escape**             | `modelId` containing `../../../../Windows/System32/` designed to overwrite system files or write outside model cache.         | `resolveSafePath()` checks canonical path against `baseDir` and verifies `realpathSync()` to block symlink escapes.                                        |
| **T-065-04** | **Disk Exhaustion Denial of Service**           | Model download stream delivers endless bytes (decompression bomb or infinite HTTP stream) exhausting disk space.              | Download stream enforces hard `byteSize` ceiling matching manifest + max cache quota (`maxCacheBytes`). Abort immediately on overflow.                     |
| **T-065-05** | **VRAM Exhaustion / Host OS Crash**             | Oversized model loaded into GPU exceeds physical VRAM (6,144 MiB), causing display driver reset or Windows Blue Screen.       | `VramOffloader` strictly clamps VRAM allocation to `MAX_VRAM_PERCENT = 0.80` (max 4,915 MiB). Extra layers offloaded to RAM or rejected.                   |
| **T-065-06** | **Unauthenticated / Lease-less Model Access**   | Internal component or rogue plugin invokes local model inference without an active task lease.                                | `ModelRuntimeManager` enforces `LeasePolicyBoundary` validation on every inference invocation (`061-SEC-02` regression check).                             |
| **T-065-07** | **Fabrication of Native Acceleration Evidence** | Mock or CPU fallback test claims to have executed on physical GPU in telemetry receipts.                                      | `NativeInferenceEvidence` strictly records `cpuFallback: true` when native hardware acceleration was not engaged. Evidence hash binds hardware telemetry.  |
| **T-065-08** | **Stale / Corrupted Staging Artifact Reuse**    | Partially downloaded model file left in `staging/` is mistakenly loaded or promoted on subsequent restart.                    | Staging directory cleared on startup; files in `staging/` are strictly locked and temporary (`.tmp`), renamed only on complete verification.               |

---

## 10. Proposed 065 Security Invariants

- **`065-SEC-01: Cryptographic Model Manifest Verification`**  
  Every model artifact must be described by a validated `ModelManifestSchema`. Model files must match the manifest's declared SHA-256 digest exactly before being made available for loading.
- **`065-SEC-02: SSRF Guard on Remote Model Acquisition`**  
  Model download URLs must use secure HTTPS protocols and must not resolve to link-local (`169.254.0.0/16`), multicast, or unauthorized internal network addresses.
- **`065-SEC-03: Immediate Quarantine & Destruction of Poisoned Artifacts`**  
  If a downloaded or imported model artifact's SHA-256 digest fails to match the manifest, the file must be immediately deleted or quarantined in a dedicated isolated quarantine directory. It must never be placed into the active model catalog.
- **`065-SEC-04: Strict Path Traversal & Symlink Containment`**  
  Model IDs, file names, and cached paths must be verified through `resolveSafePath()`. Any attempt to resolve paths outside `ModelCacheManager.baseDir` must throw `ModelCacheError(INVALID_PATH)`.
- **`065-SEC-05: Strict Stream Quota & Disk Bounding`**  
  Model downloads must be bounded by both declared manifest file size and the overall cache quota (`maxCacheBytes`). The stream must abort fail-closed if received bytes exceed declared size by even a single byte.
- **`065-SEC-06: VRAM Safety Ceiling & Layer Offload Integrity`**  
  Loading model weights for inference must be constrained by `VramOffloader.planExecution()`. VRAM allocations must never exceed 80% of available physical VRAM, and RAM allocations must never exceed 70% of available system RAM.
- **`065-SEC-07: Cryptographic Lease Binding for Model Execution`**  
  Model execution must be cryptographically bound to a valid execution lease issued by `services/policy`. Unauthenticated or lease-expired model calls must fail closed before hardware execution.
- **`065-SEC-08: Non-Repudiable Evidence Integrity & Truthful Capability Reporting`**  
  Benchmark results and inference evidence must truthfully report execution characteristics. CPU fallback execution must never be represented as native GPU acceleration.

---

## 11. Dependencies

### Monorepo Workspace Dependencies

- `packages/contracts`: Must remain completely independent of backend/desktop runtimes. Only Zod schemas and TypeScript types may be added here.
- `apps/desktop-agent`: Consumes `@nexusos/contracts/ai`. Houses `ModelCacheManager`, `HardwareDetector`, `VramOffloader`, `ProviderAdapters`.
- `services/policy`: Provides lease evaluation for execution authorization.

### External Runtime / System Dependencies

- `node:crypto`: Built-in Node.js crypto module for SHA-256 streaming hashes.
- `node:fs`, `node:path`: Built-in filesystem primitives.
- `node:stream`: For backpressured, memory-safe chunked download streams.
- Reference Hardware: NVIDIA GeForce RTX 3050 6GB Laptop GPU (for physical benchmark capture).
- CI Environment: GitHub Actions (runs in CPU-fallback / mock mode, respecting the Truthfulness Rule).

---

## 12. Exact File / Subsystem Impact

### 1. Required Implementation Files

| Path                                                              |   Action   | Subsystem            | Reason                                                                                         |
| :---------------------------------------------------------------- | :--------: | :------------------- | :--------------------------------------------------------------------------------------------- |
| `packages/contracts/src/ai/manifest.ts`                           | **CREATE** | `@nexusos/contracts` | Canonical Zod schemas for `ModelManifest`, `ModelDownloadRequest`, `InferenceBenchmarkResult`. |
| `packages/contracts/src/ai/index.ts`                              | **MODIFY** | `@nexusos/contracts` | Export new manifest schemas and types from AI contracts barrel.                                |
| `apps/desktop-agent/src/runtimes/local-ai/model-cache-manager.ts` | **MODIFY** | `apps/desktop-agent` | Add `downloadArtifact()` with chunk streaming, progress events, and quarantine logic.          |
| `apps/desktop-agent/src/runtimes/local-ai/types.ts`               | **MODIFY** | `apps/desktop-agent` | Add manifest and benchmark types to local-ai domain types.                                     |
| `scripts/benchmark-local-ai.js`                                   | **CREATE** | Monorepo Scripts     | Repeatable local inference benchmarking script for reference hardware.                         |

### 2. Required Test Files

| Path                                                                |   Action   | Subsystem            | Reason                                                                                     |
| :------------------------------------------------------------------ | :--------: | :------------------- | :----------------------------------------------------------------------------------------- |
| `packages/contracts/tests/ai-manifest-contracts.test.ts`            | **CREATE** | `@nexusos/contracts` | Schema round-trip and validation tests for model manifests.                                |
| `apps/desktop-agent/tests/local-ai-model-cache-download.test.ts`    | **CREATE** | `apps/desktop-agent` | Unit tests for chunked download, progress, quota abort, and hash mismatch quarantine.      |
| `tests/hardening/local-ai-model-manifest-security.test.ts`          | **CREATE** | Security Hardening   | Verification of `065-SEC-01` through `065-SEC-08`.                                         |
| `tests/vertical-slice/local-ai-benchmarking-vertical-slice.test.ts` | **CREATE** | Vertical Slice       | End-to-end manifest validation, download, offload planning, and benchmark metrics capture. |

### 3. Required Governance & Documentation Files

| Path                                 |   Action   | Subsystem            | Reason                                                               |
| :----------------------------------- | :--------: | :------------------- | :------------------------------------------------------------------- |
| `docs/task_065_completion_report.md` | **CREATE** | Governance           | Milestone completion record with exact final SHA and benchmark data. |
| `docs/RESOURCE_BASELINE.md`          | **MODIFY** | Governance           | Record any memory/dist footprint delta after Task 065 additions.     |
| `package.json`                       | **MODIFY** | Governance / Scripts | Register new tests in `test` script.                                 |

### 4. Files That MUST NOT Be Modified

- `services/backend/src/memory/**` (Protected: Persistent memory belongs to Task 062 / Task 066).
- `services/backend/src/planner/**` (Protected: Planner replanning belongs to Task 069).
- `apps/web-dashboard/**` (Protected: Dashboard telemetry belongs to Task 067).
- `packages/plugin-sdk/**` (Protected: Plugin capabilities belong to Task 068).
- `services/identity/**` & `services/policy/**` (Protected: Policy boundary remains immutable).

---

## 13. Implementation Phasing

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: Canonical Manifest Contracts (@nexusos/contracts)   │
│ - Create packages/contracts/src/ai/manifest.ts             │
│ - Export from packages/contracts/src/ai/index.ts            │
│ - Contract tests: ai-manifest-contracts.test.ts             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 2: Secure Model Acquisition in ModelCacheManager       │
│ - Implement downloadArtifact() with chunked streaming       │
│ - Integrate SSRF validation and SHA-256 hash accumulator    │
│ - Implement quarantine on digest mismatch                   │
│ - Unit tests: local-ai-model-cache-download.test.ts         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 3: Benchmark Harness & Reference Hardware Calibration │
│ - Create scripts/benchmark-local-ai.js                      │
│ - Measure TTFT, tokens/sec, and VRAM delta on RTX 3050       │
│ - Verify truthful reporting (cpuFallback flag)              │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 4: Security Hardening & Vertical Slice Verification   │
│ - tests/hardening/local-ai-model-manifest-security.test.ts  │
│ - tests/vertical-slice/local-ai-benchmarking-vertical-slice │
│ - Register in package.json                                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 5: Quality Gate Audit & Milestone Completion Report   │
│ - Run full pnpm test, build, typecheck, lint, format        │
│ - Produce docs/task_065_completion_report.md                │
│ - Update docs/RESOURCE_BASELINE.md                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 14. Validation & Release Gates

To achieve final release sign-off, the eventual implementation must pass all gates:

1. **Monorepo Build**: `pnpm run build` — 100% clean compilation across all workspace projects.
2. **Typecheck**: `pnpm run typecheck` — 0 TypeScript errors (`tsc --noEmit`).
3. **Linter**: `pnpm run lint` — 0 errors.
4. **Code Style**: `pnpm run format:check` — Prettier clean across all touched files.
5. **Monorepo Structure**: `pnpm run validate` — Structural and architectural boundaries pass cleanly.
6. **Secret & Env Scanner**: `pnpm run security` — 0 secrets or credentials detected.
7. **Task 065 Security Hardening**: `node --import tsx/esm --test tests/hardening/local-ai-model-manifest-security.test.ts` — 100% pass on all `065-SEC-*` invariants.
8. **Task 065 Vertical Slice**: `node --import tsx/esm --test tests/vertical-slice/local-ai-benchmarking-vertical-slice.test.ts` — 100% pass on end-to-end model acquisition and benchmarking flow.
9. **Full Test Suite**: `pnpm test` — all existing 1,316 tests + new Task 065 tests pass cleanly with 0 failures.
10. **Clean Working Tree**: `git status --short` returns empty; `HEAD == origin/main`.

---

## 15. Explicit Out-of-Scope Items

- **NO multi-gigabyte model binary files committed to Git**: Test fixtures must use small synthetic GGUF headers / mock buffers (< 1 MB).
- **NO native C++ build toolchain dependencies in monorepo root**: Do not add dependencies that break `pnpm install` on vanilla developer or CI environments without MSVC / CUDA toolchains.
- **NO Cloud Sync or Enterprise RBAC**: Cloud state synchronization remains deferred until local runtimes are completed.
- **NO modification of Persistent Memory or Knowledge Graph**: Graph evolution belongs to Task 066 (S3-02).
- **NO modification of Web Dashboard UI**: Real-time telemetry streaming belongs to Task 067 (S3-03).
- **NO modification of Plugin SDK**: Plugin memory writes belong to Task 068 (S3-04).
- **NO modification of Planner Replanning**: Autonomous replanning belongs to Task 069 (S3-05).

---

## 16. Risks / Open Questions

| Risk / Question                | Impact                                                                                                              | Mitigation Strategy                                                                                                                                                                                                          |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI Runner Lack of GPU**      | CI cannot execute real CUDA kernels and would fail if tests assert physical GPU VRAM allocation.                    | Test harness must use mockable backend interfaces. When running in CI, tests assert that `cpuFallback: true` is truthfully recorded, directly exercising the truthfulness invariant.                                         |
| **External Network Flakiness** | Unit tests relying on external model downloads (e.g. HuggingFace) could fail due to network outages or rate limits. | Automated test suites (`pnpm test`) must use local loopback HTTP fixtures (`http://127.0.0.1:<port>`). External real model downloads are reserved for standalone manual benchmarking runs (`scripts/benchmark-local-ai.js`). |
| **GGUF Format Evolution**      | GGUF specification v2/v3 header parsing variance.                                                                   | Contract schema specifies validated GGUF metadata fields with relaxed extension metadata (`metadata: z.record(z.unknown())`).                                                                                                |

---

## 17. Final Recommendation

1. **Formal Scope Sign-Off**: Accept `TASK 065: SPRINT 3 MILESTONE 1 — LOCAL-AI MODEL MANIFEST SPECIFICATION, SECURE ARTIFACT LIFECYCLE & INFERENCE BENCHMARKING` as the authoritative scope.
2. **Execute Discovery-Only Discipline**: Stop here without source code modifications.
3. **Next Step**: Await user authorization before producing the formal implementation plan and commencing Phase 1.
