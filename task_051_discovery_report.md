# Task 051 — Discovery Report

## Sprint 1 Milestone 3: Local AI Model Router & ONNX / Llama Engine Integration

**Date:** 2026-09-09  
**Mode:** DISCOVERY ONLY  
**Baseline HEAD SHA:** `757b4ac3dd36d3d9758130f48e93361e1be62bc5`  
**Owning Subsystems:** AI Runtime Subsystem (`apps/desktop-agent/src/runtimes/local-ai/`, `runtimes/local-ai/`), Desktop Agent Orchestration Plane (`apps/desktop-agent/src/orchestrator/`), and Shared Contracts (`packages/contracts/src/`)  
**Status:** COMPLETE (Discovery Only — Implementation Not Started)

---

## 1. Exact Task Identity

- **Task Identifier:** `Task 051`
- **Canonical Task Title:** `TASK 051: SPRINT 1 MILESTONE 3 — LOCAL AI MODEL ROUTER & ONNX / LLAMA ENGINE INTEGRATION`
- **Sprint / Milestone:** `Sprint 1 — Milestone 3: Local AI Model Router & ONNX / Llama Engine Integration`
- **Sprint 1 Track / Week:** `Sprint 1 Week 2: AI Integration & Experience Plane` (Item 3)
- **Owning Subsystem(s):**
  - AI Runtime Subsystem: `apps/desktop-agent/src/runtimes/local-ai/` & `runtimes/local-ai/`
  - Desktop Agent Orchestrator: `apps/desktop-agent/src/orchestrator/agent-orchestrator.ts` & `runtime-router.ts`
  - Desktop Agent Host: `apps/desktop-agent/src/agent.ts`
  - Shared Contracts: `packages/contracts/src/ai/` (or `packages/contracts/src/models/`) and `packages/contracts/src/index.ts`
- **Preceding Frontier:** `Task 050: Sprint 1 Milestone 2 — Desktop Agent Filesystem & Sandbox Runtime Hardening (OS Directory Jail, Canonical Path Enforcement & Workspace Authorization)` (Verified GREEN in CI Run `34308449610`, commit `0818d3a` / doc `757b4ac3dd36d3d9758130f48e93361e1be62bc5`)
- **Authority Derivation:**
  - _Sprint 1 Readiness and Backlog Specification_ ([`docs/SPRINT_1_READINESS_AND_BACKLOG.md`](docs/SPRINT_1_READINESS_AND_BACKLOG.md)), Section 4 (`Sprint 1 Candidate Backlog`, Item 3) & Section 5 (`Recommended Sprint 1 Sequencing`, Week 2)
  - _NexusOS Sprint 0 Implementation Blueprint_ ([`docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md`](docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md)), Section 25 (`Local AI Foundation`) & Section 59 (`Sprint 1 Candidate Work` — "model routing")
  - _NexusOS AI Runtime Engineering Design Document (EDD)_ ([`docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md`](docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md)), Section 9 (`Model Router`), Section 17 (`AI Runtime Contracts`), Section 18 (`Security`)
  - _NexusOS Desktop Agent Engineering Design Document (EDD)_ ([`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`](docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md)), Section 9 (`Local AI Runtime`), Section 18.7 (`Local AI execution`)
  - _NexusOS Architecture Bible_ ([`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`](docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)), Section 9 (`Model Router`) & Section 10 (`Local AI`)
  - _NexusOS Enterprise PRD v3_ ([`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`](docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md)), Section 33 (`Model Benchmark Engine`), Section 34 (`Model Training & Continuous Improvement`), Section 35 (`Local Model Ecosystem`)

---

## 2. Why Task 051 Is Next

1. **Authoritative Roadmap Sequencing:**
   Per [`docs/SPRINT_1_READINESS_AND_BACKLOG.md`](docs/SPRINT_1_READINESS_AND_BACKLOG.md), Section 5 ("Recommended Sprint 1 Sequencing"), the canonical ordering of Sprint 1 tasks is strictly stratified into two consecutive tracks:

   - **Week 1: Runtime & Orchestration Foundations**
     - Item 1: Multi-Step Workflow Graph Execution (`services/orch`) -> **COMPLETED in Task 049**
     - Item 2: Desktop Filesystem Sandbox Hardening (`apps/desktop-agent`) -> **COMPLETED in Task 050**
   - **Week 2: AI Integration & Experience Plane**
     - Item 3: Local AI Engine Integration (`runtimes/local-ai`) -> **AUTHORITATIVE NEXT (Task 051)**
     - Item 4: Human-in-the-Loop Desktop Approval UI (`apps/desktop-agent/src/ui/`) -> **Task 052**
     - Item 5: Web Dashboard Experience Platform (`apps/web-dashboard`) -> **Task 053**

2. **Dependency on Task 050 and Resolving the Orchestrator Fallthrough Disconnect:**
   Task 049 established multi-step DAG task execution, and Task 050 established hardened filesystem runtime execution with OS directory jailing and cryptographic evidence chaining. In a multi-step enterprise agent DAG workflow, filesystem file operations and AI model reasoning are the twin core capabilities (e.g. read files from workspace -> submit to local AI model for code generation/analysis -> write generated artifacts back to workspace).
   However, inspection of the current codebase reveals a critical orchestrator gap identical to the one discovered in Task 050:
   In [`apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`](apps/desktop-agent/src/orchestrator/agent-orchestrator.ts) (lines 356–405):

   ```typescript
   if ((category === 'filesystem' || category === 'fs') && this.filesystemRuntime) {
     executionOutput = await this.filesystemRuntime.execute(runtimePayload);
   } else if (category === 'terminal' && this.terminalRuntime) {
     ...
   } else if (category === 'browser' && this.browserRuntime) {
     ...
   } else if (category === 'plugin' && this.pluginRuntime) {
     ...
   } else if (category === 'device' && this.deviceRuntime) {
     ...
   } else if (category === 'memory' && this.memoryCache) {
     ...
   } else {
     // Default simulated/mock execution payload
     executionOutput = {
       executed: true,
       capabilityId: request.capabilityId,
       runtimeCategory: request.runtimeCategory,
       payload: request.payload,
     };
   }
   ```

   `AgentOrchestrator` does **NOT** receive `LocalAiRuntime` in its constructor, has **NO** branch for `category === 'local-ai' || category === 'localai'`, and `LocalAiRuntime` lacks a canonical `execute()` entrypoint. As a result, any DAG workflow task specifying a local AI capability (`localAi.generate`) falls through to simulated/mock execution!

3. **Why Task 051 Must Precede Following Tasks (Task 052 & Task 053):**
   - **Task 052 (Human-in-the-Loop Approval UI):** Native desktop approval dialogs intercept high-risk operations (e.g., local AI model actions, terminal executions, destructive file writes). The actual local AI model router and engine must be integrated before the approval interceptor wraps it.
   - **Task 053 (Web Dashboard Experience Platform):** Real-time task visualization and telemetry streaming in the React/Vite dashboard require real model inference telemetry, token metering, and hardware utilization profiles emitted by the underlying local AI runtime.

---

## 3. Authoritative Requirements

The requirements are derived from four authoritative architectural documents:

### 3.1 Sprint 1 Readiness and Backlog Specification (`docs/SPRINT_1_READINESS_AND_BACKLOG.md`, Section 4, Item 3)

- **Owning Subsystem:** AI Runtime (`runtimes/local-ai`)
- **Applicable Contracts:** `ModelInferenceRequest`, `ModelInferenceResponse`
- **Objective:** Connect runtime router to real local model inference engine with GPU acceleration.
- **Acceptance Criteria:**
  1. Dynamic detection of host GPU / VRAM capabilities.
  2. Fallback to CPU quantized models if VRAM budget is exceeded.
  3. Strict prompt template isolation preventing prompt injection leakage.

### 3.2 NexusOS AI Runtime EDD (`docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md`)

- **Section 9.1–9.3 (Model Router & Routing Pipeline):**
  - "Model Router receives typed requests and selects/invokes a policy-eligible cloud or local provider adapter."
  - "Routing algorithm: 1. Apply policy, residency, data-class, provider allowlist, and model lifecycle hard filters. 2. Validate requested capability, context capacity, output schema, and local hardware admission. 3. Reserve budget. 4. Score candidates... 5. Select primary and compatible fallback chain. 6. Invoke through adapter... 7. Validate result contract, meter usage, publish health/quality signals, and settle budget."
- **Section 9.5 (Failure, Security, and Scale):**
  - "Provider timeout, rate limit, invalid stream, schema failure, safety refusal, model drift, local OOM, or unavailable compliant fallback returns a typed failure."
  - "Providers receive minimized prompts and no secrets."
- **Section 17 (AI Runtime Contracts):**
  - "All contracts are schema-versioned, additive by default, idempotent where retried, trace-propagated, tenant scoped, classification aware."
- **Section 18.1 (Prompt Injection Resistance):**
  - "External content is labeled untrusted and structurally separated from system constraints, task goals, policy, and tool contracts. Injection heuristics, provenance, schema validation, critic review, capability allowlists, and approval gates operate outside model text. The Runtime treats instructions found in documents, websites, emails, tool results, or model output as data unless explicitly transformed by a policy-approved workflow."
- **Section 18.2 (Context & Model Isolation):**
  - "Context isolation is enforced by tenant, organization, workspace, actor, task, purpose, classification, and retention."

### 3.3 NexusOS Desktop Agent EDD (`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`)

- **Section 9.1 (Scope and Boundary):**
  - "Local models are policy-governed providers selected by Model Router. The Desktop Agent hosts local inference but does not make global routing decisions. A local model receives only policy-permitted context and cannot invoke tools directly."
- **Section 9.2 (Runtime Adapters):**
  - Supported categories: Ollama, LM Studio, llama.cpp/GGUF, ONNX Runtime, CUDA, ROCm where available, and CPU fallback.
- **Section 9.4 (Hardware and Resource Admission):**
  - "Hardware detector inventories CPU architecture, RAM, GPU adapters, VRAM, supported drivers, NPU capability when available, disk headroom, power/thermal state, and active competing workloads. ResourceGovernor admits inference only when it can reserve declared CPU/RAM/VRAM/disk budgets without violating host safety thresholds. It can select approved quantization/configuration only where supplied by Model Router/model artifact policy; it cannot silently replace a required model."
- **Section 18.7 (Local AI Execution Sequence):**
  - Strict coordinator -> model runtime manager -> resource governor (reserve budget) -> local model host -> streamed result -> release reservation pipeline.

### 3.4 NexusOS Architecture Bible (`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`)

- **Section 9.1 (Provider-Neutral Interface):**
  - "The router receives a typed model request with task class, sensitivity class, capability needs, latency objective, budget, permitted providers, data residency constraints, and fallback policy."
- **Section 9.4 (Fallback Rules):**
  - "Retry only failures classified as transient and safe. Do not move restricted data to a fallback provider lacking policy eligibility. Preserve model request semantics and output validation contract across providers. Record all fallbacks, reason codes, budget impact, and quality uncertainty."
- **Section 10.1 (Local AI Architecture):**
  - Flow: Model Router -> Local Provider Adapter -> Hardware Detector -> VRAM / RAM Planner -> Model Artifact Registry -> Runtime Host.

---

## 4. Existing Architecture

### 4.1 Current Implementation State

The monorepo currently contains the following local AI assets:

1. **Desktop Agent Local AI Subsystem (`apps/desktop-agent/src/runtimes/local-ai/`):**
   - `hardware-detector.ts`: Implements `HardwareDetector` with `DefaultHardwareSampler` sampling CPU architecture, CPU cores, system RAM, free RAM, GPU adapters (name, VRAM bytes, free VRAM bytes), NPU presence, and thermal state with a 5000ms TTL cache.
   - `resource-governor.ts`: Implements `ResourceGovernor` tracking max concurrent inferences (default 2), max system RAM ceiling (70%), and max primary GPU VRAM ceiling (80%). Currently throws `ResourceGovernorError('MODEL_ADMISSION_DENIED')` if VRAM requirement exceeds 80% ceiling.
   - `model-cache-manager.ts`: Implements `ModelCacheManager` maintaining `.nexus-local-ai/staging` and `.nexus-local-ai/models` storage with SHA-256 integrity verification, safe path resolution, and LRU eviction up to 50 GB.
   - `provider-adapters.ts`: Implements provider adapters for `ollama`, `llamacpp`, `lmstudio`, `onnx`, and `cpu_fallback` with loopback endpoint SSRF validation (`validateLoopbackEndpoint`).
   - `model-runtime-manager.ts`: Implements `ModelRuntimeManager` managing model states (`Discovered`, `Ready`, etc.), resource reservations, and streaming token generation with redaction and token/byte limits.
   - `runtime.ts`: Implements `LocalAiRuntime` exposing descriptor `rt:local-ai-v1` with category `RuntimeCategory.LOCAL_AI` and methods `executeInference`, `listModels`, `getHardwareProfile`, `unloadModel`.
   - `schemas.ts`: Implements IPC request schemas (`LocalAiGenerateIPCRequestSchema`, etc.) enforcing `ExecutionLeaseHeaderSchema` validation.
2. **Desktop Agent Host (`apps/desktop-agent/src/agent.ts`):**
   - Registers `rt:local-ai-v1` in `RuntimeRegistry`.
   - Authorizes `RuntimeCategory.LOCAL_AI` in `PluginExecutionPolicy`.
   - Exposes IPC handlers for `localAi.generate`, `localAi.listModels`, `localAi.getHardwareProfile`, `localAi.unloadModel`.
3. **Runtime Router (`apps/desktop-agent/src/orchestrator/runtime-router.ts`):**
   - Contains `'localai'` and `'local-ai'` in `VALID_CATEGORIES`.

### 4.2 Existing Contracts vs. Missing Contracts

- **Existing Contracts (`packages/contracts/src/`):**
  - Contains `filesystem/`, `tasks/`, `permissions/`, `identity/`, `events/`, `acp/`, `api/`, `errors/`.
  - **MISSING:** There are **NO** AI or Model Inference contracts in `packages/contracts/src/`!
- **Current Deficiencies and Gaps:**
  1. **No Shared Canonical Contracts:** `ModelInferenceRequest` and `ModelInferenceResponse` (mandated by Backlog Item 3) do not exist in `@nexusos/contracts`. Only local types exist in `apps/desktop-agent/src/runtimes/local-ai/types.ts`.
  2. **No Orchestrator Execution Bridge:** `AgentOrchestrator` does not receive `LocalAiRuntime` in its constructor, and `executeTask()` has no dispatch logic for `LOCAL_AI`, causing local AI workflow nodes to fall through to mock execution.
  3. **No Unified `execute()` Method on `LocalAiRuntime`:** `LocalAiRuntime` only offers `executeInference` (returning an `AsyncIterable<InferenceStreamChunk>`), but `AgentOrchestrator` expects a unified `execute(request: LocalAiExecutionRequest): Promise<LocalAiExecutionResult>` returning execution receipts and evidence checksums.
  4. **No Dynamic CPU Quantized Fallback:** `ResourceGovernor` hard-fails with `MODEL_ADMISSION_DENIED` when VRAM is exceeded, instead of gracefully falling back to CPU quantized models.
  5. **No Prompt Template Isolation Service:** Prompts are passed raw without structural boundary delimiters, leaving the system vulnerable to prompt injection and control token attacks.
  6. **Latent Bug in `model-runtime-manager.ts` (Line 110):** `this.leaseBoundary.validateLease(...)` is an `async` function returning a `Promise<LeaseValidationResult>`, but it is called without `await` (`const isLeaseValid = this.leaseBoundary.validateLease(...)`). Because a Promise is truthy, the lease check never fails even on invalid leases!
  7. **No Cryptographically Linked Evidence:** Missing deterministic SHA-256 evidence hashing linking the request, prompt hash, model ID, provider, response output hash, token usage, hardware reservation, task ID, and lease ID.

---

## 5. Dependencies

1. **Task 050 Outputs Relied Upon:**
   - Contract structure patterns in `packages/contracts/src/filesystem/`.
   - Category normalization pattern in `RuntimeRouter` (`runtime-router.ts`).
   - Unified `execute()` dispatch pattern in `AgentOrchestrator` (`agent-orchestrator.ts`).
   - Cryptographic evidence checksum pattern (`computeFilesystemEvidenceChecksum`).
2. **Contracts Relied Upon:**
   - `ExecutionLeaseHeaderSchema` / `ExecutionLeaseHeader` from `@nexusos/contracts`.
   - `TaskExecutionRequest` / `TaskExecutionResult` from `@nexusos/contracts`.
3. **Runtime / Host Dependencies:**
   - `ExecutionLeaseBoundary` (`apps/desktop-agent/src/permissions/lease-boundary.ts`).
   - `PluginExecutionPolicy` (`apps/desktop-agent/src/runtimes/plugin/policy.ts`).
   - `AgentOrchestrator` (`apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`).
   - `RuntimeRouter` (`apps/desktop-agent/src/orchestrator/runtime-router.ts`).
   - `DesktopAgent` (`apps/desktop-agent/src/agent.ts`).
   - `RedactionFilter` (`apps/desktop-agent/src/observability/redaction-filter.ts`).

---

## 6. Proposed Implementation Boundary

### Discovered Facts vs. Implementation Hypotheses

| Component                | Discovered Fact                                                                                                   | Implementation Hypothesis / Proposed Change                                                                                                                                                                                                      |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- | ---- | ------ | ------- | --------------------------------------------- |
| **Shared Contracts**     | `packages/contracts/src/` has no `ai/` or `models/` directory; `ModelInferenceRequest` only cited in backlog.     | Create `packages/contracts/src/ai/index.ts` defining `ModelInferenceRequestSchema`, `ModelInferenceResponseSchema`, and `computeModelEvidenceChecksum`. Export via `packages/contracts/src/index.ts`.                                            |
| **Prompt Isolation**     | No prompt template isolation exists in the codebase; prompts are concatenated or passed raw.                      | Create `apps/desktop-agent/src/runtimes/local-ai/prompt-isolation.ts` providing `PromptTemplateIsolationService` that wraps system/user/context in structural boundaries (`<                                                                     | system | >`, `<                                                                  | user | >`, `< | context | >`) and escapes adversarial injection tokens. |
| **Resource Governor**    | Throws `MODEL_ADMISSION_DENIED` immediately if VRAM exceeds 80% ceiling; no fallback exists.                      | Enhance `ResourceGovernor` and `ModelRuntimeManager` to detect when VRAM exceeds budget and, when `allowCpuFallback: true`, automatically route to CPU quantized adapter (`cpu_fallback` or quantized GGUF) while recording the fallback reason. |
| **LocalAiRuntime**       | Lacks an `execute()` method; only has `executeInference` streaming method.                                        | Add `execute(request: LocalAiExecutionRequest): Promise<LocalAiExecutionResult>` to `LocalAiRuntime`, matching `FilesystemRuntime.execute()`.                                                                                                    |
| **AgentOrchestrator**    | Does not have `localAiRuntime` injected, and `executeTask()` falls through to simulated execution for `LOCAL_AI`. | Inject `localAiRuntime?: LocalAiRuntime` into `AgentOrchestrator` constructor and route `category === 'local-ai'                                                                                                                                 |        | category === 'localai'`to`this.localAiRuntime.execute(runtimePayload)`. |
| **RuntimeRouter**        | Resolves `'localai'` and `'local-ai'` to different strings.                                                       | Normalize both `'localai'` and `'local-ai'` to canonical category `'local-ai'`.                                                                                                                                                                  |
| **DesktopAgent**         | Instantiates `localAiRuntime` at line 871, long after `AgentOrchestrator` at line 207.                            | Move instantiation of `LocalAiRuntime` before `AgentOrchestrator` (matching `FilesystemRuntime`), and pass it into `AgentOrchestrator`.                                                                                                          |
| **Lease Validation Bug** | Line 110 of `model-runtime-manager.ts` calls `this.leaseBoundary.validateLease(...)` without `await`.             | Fix line 110 to `const leaseDecision = await this.leaseBoundary.validateLease(...)` and check `leaseDecision.valid`.                                                                                                                             |

### Boundary Guardrails

- **What should change:**
  - `packages/contracts/src/ai/index.ts` (NEW)
  - `packages/contracts/src/index.ts` (MODIFY: re-export AI contracts)
  - `packages/contracts/tests/contracts.test.ts` (MODIFY: add schema and evidence tests)
  - `apps/desktop-agent/src/runtimes/local-ai/prompt-isolation.ts` (NEW)
  - `apps/desktop-agent/src/runtimes/local-ai/resource-governor.ts` (MODIFY: VRAM oversubscription fallback)
  - `apps/desktop-agent/src/runtimes/local-ai/model-runtime-manager.ts` (MODIFY: lease await fix, prompt isolation integration, evidence computation)
  - `apps/desktop-agent/src/runtimes/local-ai/runtime.ts` (MODIFY: add `execute()` method)
  - `apps/desktop-agent/src/runtimes/local-ai/index.ts` (MODIFY: export new classes and types)
  - `apps/desktop-agent/src/orchestrator/runtime-router.ts` (MODIFY: normalize `'local-ai'`)
  - `apps/desktop-agent/src/orchestrator/agent-orchestrator.ts` (MODIFY: constructor injection and execution routing)
  - `apps/desktop-agent/src/agent.ts` (MODIFY: instantiate `localAiRuntime` before orchestrator)
  - New test suites:
    - `tests/vertical-slice/local-ai-security-invariants.test.ts` (NEW)
    - `tests/vertical-slice/local-ai-engine-integration.test.ts` (NEW)
- **What should NOT change:**
  - Do NOT modify `services/backend/`, `services/identity/`, `services/policy/`.
  - Do NOT modify filesystem runtime or filesystem tests (`apps/desktop-agent/src/runtimes/filesystem/`).
  - Do NOT modify terminal, browser, or device runtimes.
  - Do NOT implement web dashboard UI (Task 053) or desktop approval UI (Task 052).
  - Do NOT regress any of the 801 existing passing tests.

---

## 7. Contracts / APIs / Protocols

### 7.1 New Canonical Schemas (`packages/contracts/src/ai/index.ts`)

1. **`ModelProviderTypeSchema`:**

   ```typescript
   export const ModelProviderTypeSchema = z.enum([
     'ollama',
     'llamacpp',
     'lmstudio',
     'onnx',
     'cpu_fallback',
   ]);
   export type ModelProviderType = z.infer<typeof ModelProviderTypeSchema>;
   ```

2. **`ModelInferenceRequestSchema`:**

   ```typescript
   export const ModelInferenceRequestSchema = z.object({
     requestId: z.string().uuid(),
     taskId: z.string().min(1),
     stepId: z.string().optional(),
     correlationId: z.string().optional(),
     tenantId: z.string().uuid(),
     leaseHeader: ExecutionLeaseHeaderSchema,
     modelId: z
       .string()
       .min(1)
       .max(128)
       .regex(/^[a-zA-Z0-9._:\-\/]+$/),
     provider: ModelProviderTypeSchema.default('onnx'),
     prompt: z.string().min(1).max(131072), // 128 KB max
     systemPrompt: z.string().max(32768).optional(), // 32 KB max
     contextDocuments: z.array(z.string().max(65536)).max(10).optional(),
     temperature: z.number().min(0.0).max(2.0).default(0.7),
     maxTokens: z.number().int().min(1).max(8192).default(2048),
     stopSequences: z.array(z.string().max(64)).max(8).optional(),
     hardwareBudget: z
       .object({
         maxVramBytes: z.number().nonnegative().optional(),
         maxRamBytes: z.number().nonnegative().optional(),
         allowCpuFallback: z.boolean().default(true),
       })
       .default({ allowCpuFallback: true }),
     isolationPolicy: z
       .object({
         strictSeparation: z.boolean().default(true),
         neutralizeControlTokens: z.boolean().default(true),
       })
       .default({ strictSeparation: true, neutralizeControlTokens: true }),
     streaming: z.boolean().default(false),
   });
   export type ModelInferenceRequest = z.infer<typeof ModelInferenceRequestSchema>;
   ```

3. **`ModelInferenceResponseSchema`:**

   ```typescript
   export const ModelInferenceResponseSchema = z.object({
     requestId: z.string().uuid(),
     taskId: z.string().min(1),
     modelId: z.string(),
     provider: ModelProviderTypeSchema,
     content: z.string(),
     finishReason: z.enum(['stop', 'length', 'cancel', 'error']),
     usage: z.object({
       promptTokens: z.number().nonnegative(),
       completionTokens: z.number().nonnegative(),
       totalTokens: z.number().nonnegative(),
     }),
     hardwareProfileUsed: z.object({
       gpuAccelerated: z.boolean(),
       vramAllocatedBytes: z.number().nonnegative(),
       ramAllocatedBytes: z.number().nonnegative(),
       cpuFallback: z.boolean(),
       fallbackReason: z.string().optional(),
     }),
     durationMs: z.number().nonnegative(),
     evidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
     redacted: z.boolean().default(false),
   });
   export type ModelInferenceResponse = z.infer<typeof ModelInferenceResponseSchema>;
   ```

4. **`computeModelEvidenceChecksum`:**
   ```typescript
   export function computeModelEvidenceChecksum(params: {
     taskId: string;
     leaseId: string;
     modelId: string;
     provider: string;
     promptHash: string;
     outputHash: string;
     cpuFallback: boolean;
     totalTokens: number;
   }): string {
     return crypto
       .createHash('sha256')
       .update(
         [
           params.taskId,
           params.leaseId,
           params.modelId,
           params.provider,
           params.promptHash,
           params.outputHash,
           String(params.cpuFallback),
           String(params.totalTokens),
         ].join(':'),
         'utf8',
       )
       .digest('hex');
   }
   ```

---

## 8. Security Requirements

Derived strictly from the Architecture Bible, AI Runtime EDD, Desktop Agent EDD, and PRD:

| Security Invariant                                       | Identifier   | Description                                                                                                                                                                                                                                                                                                             | Failure Mode                                   |
| :------------------------------------------------------- | :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- | ------ | ---- | ------ | ------- | ----------------------------------------------- | -------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Execution Lease Enforcement**                          | `051-SEC-01` | Every model inference request must carry a valid `ExecutionLeaseHeader` with non-expired timestamp, valid HMAC signature, and `ai:inference` or `ai:write` scope. Missing, expired, unverified, or scope-deficient leases fail closed.                                                                                  | `LEASE_DENIED` / `MALFORMED_LEASE`             |
| **Prompt Template Isolation & Injection Neutralization** | `051-SEC-02` | System prompts, user instructions, and external context documents must be structurally isolated using strict XML/boundary tags (`<                                                                                                                                                                                      | system                                         | >`, `< | user | >`, `< | context | >`). Adversarial delimiter injection tokens (`< | im_start | >`, `< | endoftext | >`, `[INST]`, `<<SYS>>`) in user or document payloads must be escaped/neutralized before reaching the model engine. | `PROMPT_INJECTION_DETECTED` / Sanitized |
| **VRAM Budget Governance & Dynamic CPU Fallback**        | `051-SEC-03` | Host GPU VRAM allocations must never exceed the 80% safety ceiling. If VRAM is exceeded and `allowCpuFallback: true`, the system must gracefully fall back to CPU quantized inference without exceeding RAM (70%) safety limits. If `allowCpuFallback: false`, the system must fail closed with `VRAM_BUDGET_EXCEEDED`. | `VRAM_BUDGET_EXCEEDED` / Governed CPU Fallback |
| **Provider Loopback SSRF Restriction**                   | `051-SEC-04` | Local model providers (Ollama, LM Studio, llama.cpp) must strictly bind to loopback endpoints (`127.0.0.1`, `localhost`, `::1`). Any attempt to supply external or non-loopback IP/domain addresses fails closed with `ENDPOINT_DISALLOWED`.                                                                            | `ENDPOINT_DISALLOWED`                          |
| **Tenant Isolation & Cryptographic Evidence Chaining**   | `051-SEC-05` | Cross-tenant model access attempts fail closed with `TENANT_MISMATCH`. Model outputs must pass through `RedactionFilter` to redact secrets/PII. Every completed or failed inference must compute a deterministic SHA-256 evidence checksum binding task, lease, prompt, and output.                                     | `TENANT_MISMATCH` / Evidence emitted           |

---

## 9. Test / Validation Requirements

### 9.1 Existing Relevant Tests

All 801 existing tests must continue to pass with 0 regressions, including:

- `apps/desktop-agent/tests/local-ai-hardware-detector.test.ts`
- `apps/desktop-agent/tests/local-ai-resource-governor.test.ts`
- `apps/desktop-agent/tests/local-ai-model-cache.test.ts`
- `apps/desktop-agent/tests/local-ai-provider-adapters.test.ts`
- `apps/desktop-agent/tests/local-ai-model-runtime-manager.test.ts`
- `apps/desktop-agent/tests/local-ai-security-hardening.test.ts`
- `apps/desktop-agent/tests/local-ai-host-ipc.test.ts`
- `apps/desktop-agent/tests/local-ai-host-security-hardening.test.ts`

### 9.2 New Tests Required for Task 051

1. **Contracts Test Suite Extension (`packages/contracts/tests/contracts.test.ts`):**
   - Validate `ModelInferenceRequestSchema` validation with valid and invalid payloads.
   - Validate `ModelInferenceResponseSchema` validation.
   - Validate `computeModelEvidenceChecksum` determinism and tamper detection.
2. **Dedicated Security Invariants Suite (`tests/vertical-slice/local-ai-security-invariants.test.ts`):**
   - `051-SEC-01`: Missing, expired, invalid signature, or invalid scope leases fail closed.
   - `051-SEC-02`: Adversarial prompt injection tokens (`<|im_start|>`, `[INST]`, etc.) are neutralized and system/user boundaries remain isolated.
   - `051-SEC-03`: VRAM over-allocation triggers dynamic CPU quantized fallback when permitted, or fails closed when prohibited.
   - `051-SEC-04`: Remote/external endpoint URLs are rejected with `ENDPOINT_DISALLOWED`.
   - `051-SEC-05`: Tenant ID mismatch fails closed with `TENANT_MISMATCH`, outputs are redacted, and deterministic SHA-256 evidence checksums are generated.
3. **End-to-End Vertical Slice Suite (`tests/vertical-slice/local-ai-engine-integration.test.ts`):**
   - Multi-step DAG workflow with local AI inference node executed via `AgentOrchestrator.executeTask()`.
   - Category normalization (`local-ai` and `localai`).
   - Dynamic hardware profile detection and model execution with ONNX/llama.cpp.
   - Fallback execution path verification.

### 9.3 Quality Gates & Remote CI

- `npm run typecheck`: 0 errors
- `npm run lint`: 0 errors
- `npm run format:check`: 100% clean
- `npm run validate`: Monorepo structure and architecture boundary check PASS
- `npm run security`: 0 secrets detected
- `npm test`: All test suites PASS (801 + new tests, 0 failures, 0 skipped)
- GitHub Actions CI: Remote CI run must be monitored to green on the final implementation commit SHA.

---

## 10. In Scope / Out of Scope

### In Scope

- Define canonical AI model inference contracts (`ModelInferenceRequest`, `ModelInferenceResponse`, `computeModelEvidenceChecksum`) in `packages/contracts/src/ai/`.
- Implement `PromptTemplateIsolationService` for strict template boundary isolation and prompt injection neutralization.
- Enhance `ResourceGovernor` to support dynamic CPU quantized model fallback when VRAM budget is exceeded.
- Implement canonical `execute(request: LocalAiExecutionRequest)` method on `LocalAiRuntime`.
- Fix unawaited `validateLease` call in `ModelRuntimeManager`.
- Wire `LocalAiRuntime` into `AgentOrchestrator` constructor and `executeTask()` dispatch logic.
- Update `RuntimeRouter` to normalize `'localai'` / `'local-ai'`.
- Update `DesktopAgent` (`agent.ts`) composition root to pass `localAiRuntime` to `AgentOrchestrator`.
- Implement dedicated security invariants suite (`tests/vertical-slice/local-ai-security-invariants.test.ts`).
- Implement end-to-end vertical slice integration suite (`tests/vertical-slice/local-ai-engine-integration.test.ts`).

### Out of Scope

- Training, pre-training, or fine-tuning foundation models.
- Cloud model provider API calls (OpenAI, Anthropic, Gemini API keys/endpoints).
- Human-in-the-loop desktop approval UI (Task 052 / Sprint 1 Milestone 4).
- Web dashboard experience platform (Task 053 / Sprint 1 Milestone 5).
- Modifying other execution runtimes (Filesystem, Terminal, Browser, Plugin, Device).
- Modifications to Task 052+ backlog items.

---

## 11. Risks / Ambiguities

| Risk / Ambiguity                                        | Impact | Mitigation Strategy                                                                                                                                                                                                                      |
| :------------------------------------------------------ | :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unawaited Promise in `ModelRuntimeManager`**          | High   | In `apps/desktop-agent/src/runtimes/local-ai/model-runtime-manager.ts` line 110, `this.leaseBoundary.validateLease(...)` is unawaited. Must be changed to `await this.leaseBoundary.validateLease(...)` and check `leaseDecision.valid`. |
| **Category Alias Ambiguity (`localai` vs. `local-ai`)** | Medium | `RuntimeRouter` allows both, but returns raw string. Normalize both inputs to canonical `'local-ai'` matching the `'fs'` -> `'filesystem'` pattern.                                                                                      |
| **VRAM Detection Variability Across OS Platforms**      | Medium | Linux CI runners in GitHub Actions lack physical GPUs. `DefaultHardwareSampler` must continue to report a valid fallback profile while supporting test mocks that simulate GPU VRAM over-allocation for fallback testing.                |
| **Prompt Injection Evasion via Unicode / Encodings**    | High   | `PromptTemplateIsolationService` must normalize Unicode (NFC), strip null bytes, escape structural delimiters, and encapsulate user inputs inside immutable boundary envelopes.                                                          |

---

## 12. Recommended Implementation Sequence

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 1: CANONICAL CONTRACTS (@nexusos/contracts/src/ai/)               │
│ - Author ModelInferenceRequestSchema, ModelInferenceResponseSchema     │
│ - Author computeModelEvidenceChecksum helper                            │
│ - Export via packages/contracts/src/index.ts and add contract tests     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ STEP 2: PROMPT TEMPLATE ISOLATION SERVICE                               │
│ - Create PromptTemplateIsolationService in local-ai runtime            │
│ - Implement structural boundary encapsulation (<|system|>, <|user|>)   │
│ - Implement control token neutralization and delimiter escaping         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ STEP 3: DYNAMIC VRAM DETECTION & CPU QUANTIZED FALLBACK                 │
│ - Update ResourceGovernor to support CPU fallback on VRAM ceiling       │
│ - Integrate fallback selection into ModelRuntimeManager                 │
│ - Fix unawaited leaseBoundary.validateLease bug in ModelRuntimeManager  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ STEP 4: CANONICAL EXECUTE ENTRYPOINT & ORCHESTRATOR INTEGRATION         │
│ - Implement LocalAiRuntime.execute(request) returning execution result  │
│ - Inject LocalAiRuntime into AgentOrchestrator constructor              │
│ - Handle category 'local-ai' in AgentOrchestrator.executeTask()        │
│ - Normalize 'localai' and 'local-ai' in RuntimeRouter                   │
│ - Update DesktopAgent composition root to wire LocalAiRuntime           │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ STEP 5: SECURITY INVARIANTS & VERTICAL SLICE TEST SUITES                │
│ - Author tests/vertical-slice/local-ai-security-invariants.test.ts      │
│ - Author tests/vertical-slice/local-ai-engine-integration.test.ts       │
│ - Register new test suites in package.json                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ STEP 6: VALIDATION, CI AUDIT & COMPLETION REPORT                        │
│ - Run typecheck, lint, format:check, validate, security, and test       │
│ - Commit, push, and verify remote GitHub Actions CI run                 │
│ - Author task_051_completion_report.md                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Baseline / Discovery Confirmation

- **Baseline HEAD SHA:** `757b4ac3dd36d3d9758130f48e93361e1be62bc5`
- **Discovery-Only Confirmation:** CONFIRMED. This activity was strictly analytical and investigative.
- **Implementation Code State:** CONFIRMED. **Zero lines of implementation code were modified, added, or deleted.**
- **Exact Report Path:** `task_051_discovery_report.md`
- **Task 052+ Status:** CONFIRMED. Task 052+ has NOT been started.
