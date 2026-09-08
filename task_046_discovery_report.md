# Task 046 Discovery Report

## Local AI Runtime & Hardware Acceleration Adapter — Host Integration

**Document Version:** 1.0.0  
**Status:** DISCOVERY COMPLETE — READY FOR PLANNING & IMPLEMENTATION  
**Author:** NexusOS Desktop Agent Core Team  
**Date:** 2026-09-08  
**Repository Baseline:** `e4b361d1ccb2fb496e61363b6de225d7a44dda41` (origin/main)  
**CI Baseline:** GitHub Actions Run ID `34189502128` (SUCCESS)  
**Test Baseline:** 658/658 tests passing across 101 suites

---

## 1. Executive Summary

Task 046 represents the final subsystem in the **NexusOS Desktop Agent Host Integration Series** (Tasks 041–046), following Device Runtime (Task 041), Filesystem Runtime (Task 042), Terminal Runtime (Task 043), Browser Runtime (Task 044), and Plugin Runtime (Task 045).

While core local AI runtime components—`ModelRuntimeManager`, `HardwareDetector`, `ResourceGovernor`, `ModelCacheManager`, and provider adapters (`Ollama`, `llama.cpp`, `LM Studio`, `ONNX`, `CPU Fallback`)—were developed during early Sprint 0 (Task 03T) and reside in `apps/desktop-agent/src/runtimes/local-ai/`, they currently exist in an **unintegrated and unhardened state** on the host plane:

1. `rt:local-ai-v1` is **not registered** in `RuntimeRegistry`.
2. `RuntimeCategory.LOCAL_AI` is **fail-closed** in `PluginExecutionPolicy.isRuntimeCategoryAuthorized()`.
3. No `localAi.*` capability descriptors are registered in `CapabilityRegistry`.
4. The existing `localAi.*` IPC method handlers in `agent.ts` are unhardened stubs: they lack strict Zod request schema validation, do not validate `ExecutionLeaseHeader`, bypass capability scope enforcement, do not assert active agent lifecycle states (`STOPPING`/`STOPPED`/`FAILED`), and access internal cache properties via un-typechecked reflection (`['modelCacheManager']`).
5. No host-integration test suites exist to verify Local AI IPC and multi-layer host security boundaries.

Task 046 bridges this gap by establishing the canonical `LocalAiRuntime` (`rt:local-ai-v1`), authorizing `RuntimeCategory.LOCAL_AI` in `PluginExecutionPolicy`, defining Zod IPC schemas with mandatory `ExecutionLeaseHeaderSchema` validation, registering 4 authorized capabilities (`localAi.generate`, `localAi.listModels`, `localAi.getHardwareProfile`, `localAi.unloadModel`), wiring multi-layer defense-in-depth IPC handlers into `DesktopAgent` (`agent.ts`), binding graceful lifecycle termination to `DesktopAgent.stop()`, and introducing comprehensive functional IPC and adversarial security test suites (`046-SEC-01` through `046-SEC-12`).

---

## 2. Baseline Verification

| Metric / Check   | Value                                      | Verification Method             | Status      |
| :--------------- | :----------------------------------------- | :------------------------------ | :---------- |
| **Git Branch**   | `main`                                     | `git branch --show-current`     | Verified    |
| **Commit SHA**   | `e4b361d1ccb2fb496e61363b6de225d7a44dda41` | `git rev-parse HEAD`            | Verified    |
| **Remote Sync**  | Perfectly aligned with `origin/main`       | `git rev-parse origin/main`     | Verified    |
| **Working Tree** | Clean (zero uncommitted changes)           | `git status --short`            | Verified    |
| **GitHub CI**    | Run ID `34189502128`                       | `gh run view 34189502128`       | **SUCCESS** |
| **Local Tests**  | 658/658 tests passing across 101 suites    | `npm test`                      | **GREEN**   |
| **Typecheck**    | 0 errors                                   | `npm run typecheck`             | **GREEN**   |
| **Linter**       | 0 errors (122 pre-existing warnings)       | `npm run lint`                  | **GREEN**   |
| **Formatting**   | 100% compliant (Biome)                     | `npm run format:check`          | **GREEN**   |
| **Boundaries**   | Architecture boundaries valid              | `node scripts/validate-repo.js` | **GREEN**   |
| **Security**     | 0 secrets detected                         | `node scripts/security-scan.js` | **GREEN**   |

---

## 3. Authoritative Sources

The requirements, invariants, and constraints for Task 046 are derived exclusively from the following normative sources:

| Document                | Section           | Title / Invariant                                       | Relevance to Task 046                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :---------------------- | :---------------- | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop Agent EDD**   | Section 1.1       | _Responsibilities_                                      | Provide bounded local execution through local-model runtimes; enforce local policy and capability grants at execution time.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Desktop Agent EDD**   | Section 1.4       | _Trust Boundaries_                                      | "Local model: generated text/tool proposals \| no direct tools, schema validation, policy gate outside model \| Reject invalid output".                                                                                                                                                                                                                                                                                                                                                                                       |
| **Desktop Agent EDD**   | Section 2.1       | _Process Architecture_                                  | `SUP --> MODEL[Local Model Host]` — resource-contained child process running provider adapters, artifact loading, and inference; prohibited from invoking tools directly.                                                                                                                                                                                                                                                                                                                                                     |
| **Desktop Agent EDD**   | Section 3.1       | _Module Catalog_                                        | `Model Runtime Manager \| local provider lifecycle/admission \| supervisor, model registry \| fallback/pause`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Desktop Agent EDD**   | Section 9         | _Local AI Runtime_                                      | **Section 9.1**: Policy-governed local models selected by Model Router; agent hosts local inference without making global routing decisions.<br>**Section 9.2**: Runtime adapters (Ollama, LM Studio, llama.cpp, ONNX Runtime, CUDA, ROCm, CPU fallback).<br>**Section 9.3**: Model lifecycle & cache (`Discovered` → `Ready` → `Quarantined`), immutable SHA-256 artifacts, LRU quota eviction.<br>**Section 9.4**: Hardware & resource admission via `HardwareDetector` and `ResourceGovernor` (RAM max 70%, VRAM max 80%). |
| **Desktop Agent EDD**   | Section 18.7      | _Local AI Execution Sequence_                           | Mermaid flow: Coordinator → Model Runtime Manager → Resource Governor (RAM/VRAM/CPU reservation) → Local Model Host (load/stream) → Release reservation → Validated result.                                                                                                                                                                                                                                                                                                                                                   |
| **Enterprise PRD**      | Section 5.10 / 14 | _Local Model Environments_                              | Ollama, LM Studio, llama.cpp, GGUF, ONNX, CUDA, ROCm, CPU support. Hardware benchmarking, VRAM planning, model cache, offline model packs.                                                                                                                                                                                                                                                                                                                                                                                    |
| **Sprint 0 Blueprint**  | Section 52 (M3)   | _Device Foundation_                                     | Desktop Agent runtime registry, capability bindings, lease validation, cancellation hooks.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Sprint 0 Blueprint**  | Section 78        | _Operating Constraints_                                 | Invariant 7: "No foundation-model training is part of Sprint 0."                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Task 045 Completion** | Docs              | `apps/desktop-agent/docs/task-045-completion-report.md` | Preceding task completion record establishing the host integration template and confirming Task 046 is the next step.                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 4. Task Frontier Verification

An audit of the git commit history confirms the exact task boundary:

- **Task 040** (`task_040_completion_report.md`): Notification Manager & Policy Gate Integration (`rt:notification-v1`).
- **Task 041** (`apps/desktop-agent/docs/task-041-completion-report.md`): Device Runtime & Hardware Posture Adapter (`rt:device-v1`).
- **Task 042** (`apps/desktop-agent/docs/task-042-completion-report.md`): Filesystem Runtime & Path Security Adapter (`rt:filesystem-v1`).
- **Task 043** (`apps/desktop-agent/docs/task-043-completion-report.md`): Terminal Runtime & Process Supervisor Adapter (`rt:terminal-v1`).
- **Task 044** (`apps/desktop-agent/docs/task-044-completion-report.md`): Browser Runtime & Domain Security Adapter (`rt:browser-v1`).
- **Task 045** (`apps/desktop-agent/docs/task-045-completion-report.md`): Plugin Runtime & Host Manager Adapter (`rt:plugin-v1`).
- **Pre-Task-046 Reconciliation** (`42d8fcb`, `30689d1`, `e4b361d`): Canonical test command aligned, 4 omitted host-integration suites included, `terminal.listProcesses` contract assertion resolved, CI verified GREEN at 658 tests.
- **Task 046 Status**: **NOT STARTED.** No Task 046 source code, schemas, descriptors, or tests have been created.
- **Task 047+ Status**: NOT STARTED. No Milestone M6 vertical slice or subsequent work exists.

---

## 5. Existing Local AI Runtime Inventory

The existing implementation in `apps/desktop-agent/src/runtimes/local-ai/` comprises 6 modules delivered in Task 03T:

| Module                | File Path                  | Primary Classes / Exports                                                                                                                                                                                                                                | Key Responsibilities & Invariants                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :-------------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Types & Schemas**   | `types.ts`                 | `ModelLifecycleState`, `InferenceState`, `ProviderType`, `HardwareProfile`, `GpuAdapterInfo`, `ResourceReservation`, `ModelArtifact`, `InferenceRequest`, `InferenceStreamChunk`, `ILocalModelProvider`, `InferenceRequestSchema`, `ModelArtifactSchema` | Defines domain types and boundary constants:<br>• `MAX_PROMPT_BYTES = 131072` (128 KB prompt ceiling)<br>• `MAX_OUTPUT_TOKENS = 8192`<br>• `MAX_OUTPUT_BYTES = 1048576` (1 MB text ceiling)<br>• `INFERENCE_TIMEOUT_MS = 120000` (120s timeout)<br>• `MAX_CONCURRENT_INFERENCES = 2`<br>• `MAX_RAM_PERCENT = 0.7` (70% system RAM limit)<br>• `MAX_VRAM_PERCENT = 0.8` (80% GPU VRAM limit)                                                                   |
| **Hardware Detector** | `hardware-detector.ts`     | `HardwareDetector`, `DefaultHardwareSampler`, `IHardwareSampler`                                                                                                                                                                                         | Inventories CPU architecture, core count, total/free RAM via `node:os`. Discovers GPU adapters (`GpuAdapterInfo`: name, VRAM bytes, free VRAM bytes, driver version), NPU presence, and thermal state (`normal`/`throttled`/`critical`). Caches profiles with a 5,000ms TTL.                                                                                                                                                                                  |
| **Resource Governor** | `resource-governor.ts`     | `ResourceGovernor`, `ResourceGovernorError`                                                                                                                                                                                                              | Enforces admission control before model execution. Rejects requests exceeding 2 concurrent inferences (`RESOURCE_EXHAUSTED`), or exceeding 70% physical RAM or 80% primary GPU VRAM (`MODEL_ADMISSION_DENIED`). Tracks reservations with transactional UUIDs; guarantees idempotent, zero-floor release.                                                                                                                                                      |
| **Model Cache**       | `model-cache-manager.ts`   | `ModelCacheManager`, `ModelCacheError`                                                                                                                                                                                                                   | Manages local model artifact storage (`.nexus-local-ai/staging` and `models`). Enforces anti-path-traversal and symlink escape checks via `resolveSafePath()`. Computes and verifies SHA-256 digests. Implements LRU capacity eviction protecting in-use models against a 50 GB quota.                                                                                                                                                                        |
| **Provider Adapters** | `provider-adapters.ts`     | `OllamaAdapter`, `LlamaCppAdapter`, `LmStudioAdapter`, `OnnxAdapter`, `CpuFallbackAdapter`, `ProviderAdapterFactory`, `validateLoopbackEndpoint()`                                                                                                       | Provides unified streaming generation across local inference providers. Implements SSRF defense via `validateLoopbackEndpoint()`, restricting HTTP endpoints strictly to loopback (`127.0.0.1`, `localhost`, `::1`).                                                                                                                                                                                                                                          |
| **Runtime Manager**   | `model-runtime-manager.ts` | `ModelRuntimeManager`, `ModelRuntimeError`                                                                                                                                                                                                               | Coordinates the inference lifecycle: validates `InferenceRequestSchema`, re-validates execution lease, queries `HardwareDetector`, reserves capacity in `ResourceGovernor`, dispatches to provider adapter, streams chunks while enforcing token/byte limits, redacts output via `RedactionFilter`, releases reservation in `finally`, manages model load/unload lifecycle states (`Inactive` → `Ready` → `Quarantined`), and supports graceful `shutdown()`. |

---

## 6. Existing Host Integration & Identified Gaps

Inspection of `apps/desktop-agent/src/agent.ts` reveals that while `ModelRuntimeManager` is constructed at line 651, its host-plane integration is incomplete and insecure:

```typescript
// agent.ts lines 651 & 886-899
this.modelRuntimeManager = new ModelRuntimeManager(this.leaseBoundary, '.nexus-local-ai');

this.ipcManager.registerMethodHandler('localAi.listModels', async () => {
  return this.modelRuntimeManager['modelCacheManager'].listCatalog();
});
this.ipcManager.registerMethodHandler('localAi.getHardwareProfile', async () => {
  return this.modelRuntimeManager['hardwareDetector'].getProfile();
});
this.ipcManager.registerMethodHandler('localAi.generate', async (params) => {
  const req = params as unknown as import('./runtimes/local-ai/types.js').InferenceRequest;
  const chunks = [];
  for await (const chunk of this.modelRuntimeManager.executeInference(req)) {
    chunks.push(chunk);
  }
  return { chunks };
});
this.ipcManager.registerMethodHandler('localAi.unloadModel', async (params) => {
  const { modelId } = params as { modelId: string };
  await this.modelRuntimeManager.unloadModel(modelId);
  return { success: true, modelId };
});
```

### Critical Gaps:

1. **No Runtime Descriptor or Registration**: No `LocalAiRuntime` class exists with a canonical `getDescriptor(): ToolRuntimeDescriptor` returning `rt:local-ai-v1`. `RuntimeRegistry` does not contain `rt:local-ai-v1`.
2. **Policy Fail-Closed**: `PluginExecutionPolicy.isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI)` returns `false`. Any attempt to register an executable `LOCAL_AI` runtime descriptor currently throws `RuntimeRegistrySecurityError`.
3. **No Capability Descriptors**: `CapabilityRegistry` registers zero `localAi.*` capabilities.
4. **No Zod Schemas**: `apps/desktop-agent/src/runtimes/local-ai/schemas.ts` does not exist. The existing handlers use unsafe TypeScript type assertions (`params as unknown as ...`).
5. **No Lease Enforcement at IPC Ingress**: The existing IPC handlers do not call `this.leaseBoundary.validateLease(req.leaseHeader)`. Unauthenticated or expired callers could invoke inference directly.
6. **No Capability Scope Enforcement**: No check exists for `ai:inference`, `ai:read`, or `ai:write` scopes.
7. **No Lifecycle Assertion**: The handlers do not check `this.lifecycle.getState()`, permitting calls during `STOPPING`, `STOPPED`, or `FAILED` states.
8. **No Output Redaction or Telemetry**: IPC outputs do not pass through `RedactionFilter.redactObject()` and do not emit structured telemetry traces.
9. **Private Property Access**: `localAi.listModels` and `localAi.getHardwareProfile` access internal private properties via `this.modelRuntimeManager['modelCacheManager']`.
10. **Constructor Injection Missing**: `DesktopAgent` constructor does not accept `customLocalAiRuntime?: LocalAiRuntime` or `customModelRuntimeManager?: ModelRuntimeManager`, preventing isolated dependency injection in tests.

---

## 7. RuntimeRegistry Analysis

`apps/desktop-agent/src/registry/runtime-registry.ts` already defines the enum member:

```typescript
export enum RuntimeCategory {
  ...
  LOCAL_AI = 'LOCAL_AI',
  ...
}
```

### Invariants:

1. `RuntimeRegistry.registerRuntime(descriptor)` enforces that if `descriptor.isExecutable === true`, the registered `RuntimeExecutionPolicy` must allow it via `allowExecutableRegistration(descriptor)`.
2. The runtime ID must follow the repository's universal naming standard:
   - `runtimeId`: `'rt:local-ai-v1'`
   - `category`: `RuntimeCategory.LOCAL_AI`
   - `version`: `'0.1.0-sprint0'`
   - `isExecutable`: `true`
   - `supportedActions`: `['generate', 'list_models', 'get_hardware_profile', 'unload_model']`
3. Registration must occur during `DesktopAgent` construction alongside its peer runtimes (`rt:device-v1`, `rt:filesystem-v1`, `rt:terminal-v1`, `rt:browser-v1`, `rt:plugin-v1`).

---

## 8. CapabilityRegistry Analysis

Four discrete capabilities must be registered in `CapabilityRegistry` within `apps/desktop-agent/src/agent.ts`:

| Capability ID                | Category  | Description                                                                       | Dangerous  | Required Scope                                 |
| :--------------------------- | :-------- | :-------------------------------------------------------------------------------- | :--------- | :--------------------------------------------- |
| `localAi.generate`           | `runtime` | Execute local model inference with token streaming and hardware admission control | **`true`** | `ai:inference` (or `ai:write` / `admin` / `*`) |
| `localAi.listModels`         | `runtime` | List cached and installed local AI model artifacts in the catalog                 | `false`    | `ai:read` (or `admin` / `*`)                   |
| `localAi.getHardwareProfile` | `runtime` | Retrieve host hardware profile, GPU acceleration posture, and memory budgets      | `false`    | `ai:read` (or `admin` / `*`)                   |
| `localAi.unloadModel`        | `runtime` | Unload an active local model from memory and release accelerator allocations      | **`true`** | `ai:write` (or `admin` / `*`)                  |

---

## 9. IPC Contract Analysis

Task 046 requires formal Zod request schemas in `apps/desktop-agent/src/runtimes/local-ai/schemas.ts`:

### 1. `localAi.generate`

- **Channel**: `localAi.generate`
- **Request Schema**: `LocalAiGenerateIPCRequestSchema`
  - `modelId`: `z.string().min(1).max(128).regex(ModelIdPattern)`
  - `provider`: `z.enum(['ollama', 'llamacpp', 'lmstudio', 'onnx', 'cpu_fallback'])`
  - `prompt`: `z.string().min(1).refine(Buffer.byteLength(val) <= 131072)`
  - `systemPrompt`: `z.string().optional().refine(...)`
  - `temperature`: `z.number().min(0).max(2).optional()`
  - `maxTokens`: `z.number().int().positive().max(8192).optional()`
  - `stopSequences`: `z.array(z.string()).max(10).optional()`
  - `tenantId`: `z.string().min(1)`
  - `deviceId`: `z.string().min(1)`
  - `callerId`: `z.string().min(1)`
  - `correlationId`: `z.string().min(1)`
  - `leaseHeader`: `ExecutionLeaseHeaderSchema` (mandatory)
- **Response Envelope**: `{ chunks: InferenceStreamChunk[] }` (redacted)
- **Required Scope**: `ai:inference` | `ai:write` | `admin` | `*`

### 2. `localAi.listModels`

- **Channel**: `localAi.listModels`
- **Request Schema**: `LocalAiListModelsIPCRequestSchema`
  - `leaseHeader`: `ExecutionLeaseHeaderSchema` (mandatory)
- **Response Envelope**: `{ models: ModelArtifact[] }`
- **Required Scope**: `ai:read` | `admin` | `*`

### 3. `localAi.getHardwareProfile`

- **Channel**: `localAi.getHardwareProfile`
- **Request Schema**: `LocalAiGetHardwareProfileIPCRequestSchema`
  - `leaseHeader`: `ExecutionLeaseHeaderSchema` (mandatory)
- **Response Envelope**: `HardwareProfile`
- **Required Scope**: `ai:read` | `admin` | `*`

### 4. `localAi.unloadModel`

- **Channel**: `localAi.unloadModel`
- **Request Schema**: `LocalAiUnloadModelIPCRequestSchema`
  - `modelId`: `z.string().min(1).max(128).regex(ModelIdPattern)`
  - `leaseHeader`: `ExecutionLeaseHeaderSchema` (mandatory)
- **Response Envelope**: `{ success: boolean, modelId: string }`
- **Required Scope**: `ai:write` | `admin` | `*`

---

## 10. Policy & Authorization Analysis

### 1. Policy Gate Modification

In `apps/desktop-agent/src/runtimes/plugin/policy.ts`:

```typescript
export class PluginExecutionPolicy implements RuntimeExecutionPolicy {
  public isRuntimeCategoryAuthorized(category: RuntimeCategory): boolean {
    return (
      category === RuntimeCategory.PLUGIN ||
      category === RuntimeCategory.BROWSER ||
      category === RuntimeCategory.TERMINAL ||
      category === RuntimeCategory.FILESYSTEM ||
      category === RuntimeCategory.CLIPBOARD ||
      category === RuntimeCategory.DEVICE ||
      category === RuntimeCategory.VAULT ||
      category === RuntimeCategory.UPDATER ||
      category === RuntimeCategory.HEALTH ||
      category === RuntimeCategory.CONFIG ||
      category === RuntimeCategory.STATE ||
      category === RuntimeCategory.TELEMETRY ||
      category === RuntimeCategory.NOTIFICATION ||
      category === RuntimeCategory.LOCAL_AI // Task 046 Authorization
    );
  }
}
```

_Note:_ Remaining unintegrated categories (`CAMERA`, `MICROPHONE`) remain strictly **fail-closed**.

### 2. Standard Defense-in-Depth Pipeline per Handler

Each IPC handler registered in `agent.ts` must execute the established 8-step pipeline:

1. **Lifecycle Assertion**: Reject immediately if `AgentLifecycleState` is `STOPPING`, `STOPPED`, or `FAILED`.
2. **Policy Check**: Verify `isRuntimeCategoryAuthorized(RuntimeCategory.LOCAL_AI)`.
3. **Lease Validation**: Execute `await this.leaseBoundary.validateLease(req.leaseHeader)`.
4. **Scope Verification**: Verify caller lease grants the required scope (`ai:inference`, `ai:read`, `ai:write`).
5. **Schema Validation**: Parse input payload using Zod schema.
6. **Runtime Invocation**: Delegate to `LocalAiRuntime` / `ModelRuntimeManager`.
7. **Telemetry Tracking**: Record audit event via `telemetryManager.trackTrace()`.
8. **Sanitization**: Pass result and error messages through `RedactionFilter`.

---

## 11. Hardware Acceleration Scope

### 1. Exact Categorization

- **ALREADY EXISTS**:
  - `HardwareDetector` and `DefaultHardwareSampler`: OS-level sampling of CPU cores, architecture, RAM, GPU adapters, VRAM, and thermal state.
  - `ResourceGovernor`: Dynamic enforcement of 70% physical RAM and 80% primary GPU VRAM ceiling limits.
  - Provider Adapters: Ollama, llama.cpp, LM Studio, ONNX Runtime, and CPU Fallback.
  - SSRF loopback constraint (`validateLoopbackEndpoint`).
- **MISSING FOR TASK 046 (IN SCOPE)**:
  - Host integration of `HardwareDetector` and `ResourceGovernor` into `LocalAiRuntime` and `agent.ts`.
  - Exposing the hardware profile via authorized, lease-governed `localAi.getHardwareProfile` IPC channel.
  - Test injection support for custom `HardwareDetector` / `IHardwareSampler` in `DesktopAgent`.
  - Adversarial verification of resource rejection when physical capacity is exceeded (`046-SEC-09`).
- **DEFERRED TO TASK 047+ / POST-SPRINT-0 (OUT OF SCOPE)**:
  - Native Windows DirectML C++ Win32/COM bindings.
  - Headless WebGPU node add-on compilation.
  - Vulkan compute shader pipelines.
  - Proprietary vendor driver compilation (CUDA Toolkit / ROCm binaries).
  - Dynamic weight quantization and on-device LoRA adapter training.

---

## 12. Lifecycle & Shutdown Analysis

1. **Initialization (`DesktopAgent.start()`)**:
   - `modelRuntimeManager.initialize()` creates `.nexus-local-ai/staging` and `.nexus-local-ai/models` cache directories.
2. **Graceful Teardown (`DesktopAgent.stop()`)**:
   - `modelRuntimeManager.shutdown()` is bound to `DesktopAgent.stop()`.
   - Idempotently unloads all active models from provider adapters.
   - Clears loaded model state records.
   - Invokes `resourceGovernor.reset()`, releasing all active memory/VRAM reservations and zeroing concurrency counters.
3. **In-Flight Cancellation**:
   - `executeInference` takes an `AbortSignal`. When the agent transitions to `STOPPING`, pending streams abort, releasing reservations in the `finally` block and emitting `finishReason: 'cancel'`.

---

## 13. Security Threat Model

| Threat ID | Threat Vector                  | Attack Mechanism                                                              | Defense Mechanism                                                   |
| :-------- | :----------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| **TM-01** | Unauthorized Ingress           | Caller lacks valid lease or provides forged/expired lease                     | `ExecutionLeaseBoundary.validateLease()`                            |
| **TM-02** | Policy Tampering               | Attempt to invoke Local AI when policy disables category                      | `PluginExecutionPolicy.isRuntimeCategoryAuthorized()`               |
| **TM-03** | Scope Escalation               | Caller with `ai:read` attempts to trigger `localAi.generate` or `unloadModel` | Strict scope verification in IPC handler                            |
| **TM-04** | Prompt Injection / Overflow    | Caller submits massive payload to exhaust memory                              | Zod `MAX_PROMPT_BYTES` (128 KB) constraint                          |
| **TM-05** | Output Flood / DoS             | Runaway model generation consumes memory/disk                                 | Hard `MAX_OUTPUT_TOKENS` (8,192) & `MAX_OUTPUT_BYTES` (1 MB) limits |
| **TM-06** | SSRF Attack                    | Malicious configuration points provider to AWS metadata or internal LAN       | `validateLoopbackEndpoint()` loopback constraint                    |
| **TM-07** | Host OOM / Hardware Exhaustion | Model memory requirements exceed host physical resources                      | `ResourceGovernor` 70% RAM & 80% VRAM ceiling gate                  |
| **TM-08** | Cross-Tenant Leakage           | Caller attempts to query or execute models across tenant boundaries           | Tenant ID binding validation against execution lease                |
| **TM-09** | Secret Disclosure              | Prompts or model outputs leak API keys, tokens, or credentials                | `RedactionFilter` string and object sanitization                    |
| **TM-10** | Path Traversal in Cache        | Malicious model filename attempts to write outside model directory            | `ModelCacheManager.resolveSafePath()` traversal & symlink check     |
| **TM-11** | Model Tampering                | Modified or corrupted model weights staged for execution                      | SHA-256 integrity verification before promotion                     |
| **TM-12** | Lifecycle Race Condition       | Caller submits inference while agent is stopping or shutting down             | Lifecycle state gate denying requests in non-active states          |

---

## 14. Proposed 046-SEC-01..12 Adversarial Test Matrix

The adversarial security regression suite will be implemented in `apps/desktop-agent/tests/local-ai-host-security-hardening.test.ts`:

| Test ID          | Adversarial Scenario Description                                 | Security Boundary Tested  | Expected Rejection / Behavior                   |
| :--------------- | :--------------------------------------------------------------- | :------------------------ | :---------------------------------------------- |
| **`046-SEC-01`** | Request with missing or forged `ExecutionLeaseHeader`            | `ExecutionLeaseBoundary`  | Denied with lease validation error              |
| **`046-SEC-02`** | Request with expired `ExecutionLeaseHeader`                      | `ExecutionLeaseBoundary`  | Denied with lease expired error                 |
| **`046-SEC-03`** | `LOCAL_AI` runtime category disabled in policy                   | `PluginExecutionPolicy`   | Fails closed; denied by execution policy        |
| **`046-SEC-04`** | `localAi.generate` invoked with read-only scope (`ai:read`)      | Capability Scope Boundary | Denied: write/inference scope required          |
| **`046-SEC-05`** | `localAi.unloadModel` invoked with read-only scope (`ai:read`)   | Capability Scope Boundary | Denied: write scope required                    |
| **`046-SEC-06`** | Malformed IPC payload (invalid modelId pattern, negative tokens) | Zod Schema Validation     | Rejected at schema layer before runtime entry   |
| **`046-SEC-07`** | Oversized prompt exceeding 128 KB (`MAX_PROMPT_BYTES`)           | Payload Size Ceiling      | Rejected at schema layer with size error        |
| **`046-SEC-08`** | Cross-tenant access attempt (lease tenant mismatch)              | Tenant Isolation Boundary | Denied with tenant mismatch error               |
| **`046-SEC-09`** | Inference requested when system RAM > 70% or VRAM > 80%          | `ResourceGovernor`        | Denied with `MODEL_ADMISSION_DENIED`            |
| **`046-SEC-10`** | Local AI IPC call submitted during `STOPPING` state              | Agent Lifecycle Boundary  | Fails closed; rejected due to lifecycle state   |
| **`046-SEC-11`** | Sensitive token/credential present in inference prompt/output    | `RedactionFilter`         | Sanitized output with `[REDACTED]` replacement  |
| **`046-SEC-12`** | Non-loopback remote endpoint configured for provider adapter     | SSRF Loopback Boundary    | Throws `ENDPOINT_DISALLOWED` security violation |

---

## 15. Test Strategy

### 1. Functional IPC Integration Suite (`local-ai-host-ipc.test.ts`)

10 test cases covering:

1. `DesktopAgent` exposes `localAiRuntime` (and `modelRuntimeManager`).
2. `rt:local-ai-v1` is registered in `RuntimeRegistry` under category `LOCAL_AI`.
3. 4 capability descriptors are registered in `CapabilityRegistry`.
4. `localAi.listModels` returns model catalog array via IPC.
5. `localAi.getHardwareProfile` returns hardware profile via IPC.
6. `localAi.generate` streams inference chunks via IPC.
7. `localAi.unloadModel` unloads active model via IPC.
8. Rejects malformed IPC request payloads via Zod.
9. Rejects expired execution lease headers via lease boundary.
10. `DesktopAgent.stop()` triggers graceful runtime shutdown and resets governor reservations.

### 2. Adversarial Security Regression Suite (`local-ai-host-security-hardening.test.ts`)

12 test cases covering `046-SEC-01` through `046-SEC-12` as defined in Section 14.

### 3. Canonical Test Suite Integration

Update `package.json` root `"test"` script to include both new test files in logical sequence alongside peer host-integration suites.

---

## 16. Expected Files / Modules

### New Files to Create:

1. `apps/desktop-agent/src/runtimes/local-ai/schemas.ts`: Zod IPC request schemas for Local AI operations.
2. `apps/desktop-agent/src/runtimes/local-ai/runtime.ts`: Canonical `LocalAiRuntime` class with `getDescriptor()`.
3. `apps/desktop-agent/src/runtimes/local-ai/index.ts`: Barrel export for the `local-ai` runtime subsystem.
4. `apps/desktop-agent/tests/local-ai-host-ipc.test.ts`: 10-case functional host-integration suite.
5. `apps/desktop-agent/tests/local-ai-host-security-hardening.test.ts`: 12-case adversarial security suite.
6. `apps/desktop-agent/docs/task-046-completion-report.md`: Formal task completion report.

### Existing Files to Modify:

1. `apps/desktop-agent/src/runtimes/plugin/policy.ts`: Authorize `RuntimeCategory.LOCAL_AI`.
2. `apps/desktop-agent/src/agent.ts`:
   - Import `LocalAiRuntime`.
   - Expose `public readonly localAiRuntime: LocalAiRuntime`.
   - Add `customLocalAiRuntime?: LocalAiRuntime` constructor injection parameter.
   - Register `rt:local-ai-v1` in `RuntimeRegistry`.
   - Register 4 capabilities in `CapabilityRegistry`.
   - Implement 4 hardened, lease-validated IPC handlers.
   - Bind `shutdown()` to `DesktopAgent.stop()`.
3. `apps/desktop-agent/src/orchestrator/runtime-router.ts`: Add `'localai'` / `'local-ai'` to `VALID_CATEGORIES`.
4. `package.json`: Include the 2 new test suites in the canonical `"test"` script.
5. `README.md`: Update Task 046 status to complete and record new test baseline (~680 tests).

---

## 17. Dependency Impact

- **Zero New Dependencies**: All required utilities (`crypto`, `fs`, `os`, `path`, `zod`, `@nexusos/contracts`) are already present in the monorepo dependencies.
- **Zero Package Changes**: No changes to `package.json` dependencies or lockfile.
- **Build Impact**: None; standard TypeScript compilation.

---

## 18. In-Scope Boundary

The implementation phase of Task 046 must include ONLY:

- Creation of `apps/desktop-agent/src/runtimes/local-ai/schemas.ts`.
- Creation of `apps/desktop-agent/src/runtimes/local-ai/runtime.ts` and `index.ts`.
- Authorization of `LOCAL_AI` in `PluginExecutionPolicy`.
- Registration of `rt:local-ai-v1` in `RuntimeRegistry`.
- Registration of 4 capability descriptors in `CapabilityRegistry`.
- Hardened IPC handlers for `localAi.generate`, `localAi.listModels`, `localAi.getHardwareProfile`, and `localAi.unloadModel`.
- Graceful shutdown binding.
- Implementation of `local-ai-host-ipc.test.ts` and `local-ai-host-security-hardening.test.ts`.
- Canonical test script update in `package.json`.
- Documentation updates (`task-046-completion-report.md` and `README.md`).

---

## 19. Out-of-Scope Boundary

The following areas are strictly **OUT OF SCOPE** for Task 046 and must NOT be touched:

- Foundation model training, fine-tuning, or LoRA weight creation (violates Blueprint Invariant 7).
- Native C++ DirectML, Vulkan, or WebGPU driver integration.
- Proprietary CUDA / ROCm compiler toolchain installation.
- Cloud Model Router implementation (belongs to control plane).
- OS-level Windows AppContainer / Job Object sandboxing (Milestone M7 / Enterprise hardening).
- Milestone M6 end-to-end vertical slice execution.
- Any modification to Tasks 041–045 runtimes (`Device`, `Filesystem`, `Terminal`, `Browser`, `Plugin`).

---

## 20. Implementation Sequence

The proposed implementation sequence follows the proven pattern from Tasks 041–045:

1. **Step 1: Schemas**: Create `apps/desktop-agent/src/runtimes/local-ai/schemas.ts` defining Zod request schemas.
2. **Step 2: Runtime Adapter**: Create `apps/desktop-agent/src/runtimes/local-ai/runtime.ts` defining `LocalAiRuntime` with `getDescriptor()`, and export via `index.ts`.
3. **Step 3: Policy Authorization**: Update `apps/desktop-agent/src/runtimes/plugin/policy.ts` to authorize `RuntimeCategory.LOCAL_AI`.
4. **Step 4: Composition Root**: Update `apps/desktop-agent/src/agent.ts` to instantiate `LocalAiRuntime`, register descriptor and capabilities, harden IPC handlers, and bind shutdown.
5. **Step 5: Runtime Router**: Update `apps/desktop-agent/src/orchestrator/runtime-router.ts` to recognize `localai`.
6. **Step 6: Functional Tests**: Create `apps/desktop-agent/tests/local-ai-host-ipc.test.ts` (10 cases).
7. **Step 7: Security Tests**: Create `apps/desktop-agent/tests/local-ai-host-security-hardening.test.ts` (12 adversarial cases).
8. **Step 8: Canonical Test Command**: Add new test files to `package.json`.
9. **Step 9: Local Quality Gates**: Execute full test suite, typecheck, lint, formatting check, boundary validation, and security scan.
10. **Step 10: Documentation & Commit**: Create `task-046-completion-report.md`, update `README.md`, commit using Conventional Commits, push to `main`, and verify GitHub Actions CI.

---

## 21. Risks & Open Questions

1. **Test Naming Disambiguation**:
   - Existing tests: `local-ai-hardware-detector.test.ts`, `local-ai-model-cache.test.ts`, `local-ai-model-runtime-manager.test.ts`, `local-ai-provider-adapters.test.ts`, `local-ai-resource-governor.test.ts`, `local-ai-security-hardening.test.ts` (Task 03T unit tests).
   - _Resolution_: Name the new host-integration test suites `local-ai-host-ipc.test.ts` and `local-ai-host-security-hardening.test.ts` to prevent namespace collisions and clearly identify them as the host-level suites for Task 046.
2. **Backward Compatibility with `modelRuntimeManager`**:
   - Some internal components or tests may reference `agent.modelRuntimeManager`.
   - _Resolution_: Retain `public readonly modelRuntimeManager: ModelRuntimeManager` on `DesktopAgent` (either delegating to or shared with `localAiRuntime.modelRuntimeManager`) to preserve 100% backward compatibility.

---

## 22. Acceptance Criteria

Task 046 will be declared COMPLETE only when:

- [ ] `LocalAiRuntime` is implemented and exports `rt:local-ai-v1`.
- [ ] `RuntimeRegistry` contains `rt:local-ai-v1` with category `LOCAL_AI`.
- [ ] `PluginExecutionPolicy` authorizes `LOCAL_AI` while keeping other unintegrated categories fail-closed.
- [ ] 4 capability descriptors (`localAi.generate`, `localAi.listModels`, `localAi.getHardwareProfile`, `localAi.unloadModel`) are registered in `CapabilityRegistry`.
- [ ] 4 hardened IPC handlers are registered in `IPCManager` with full lease and schema validation.
- [ ] `DesktopAgent.stop()` gracefully cleans up runtime and governor resources.
- [ ] All 10 functional tests in `local-ai-host-ipc.test.ts` pass.
- [ ] All 12 adversarial security tests in `local-ai-host-security-hardening.test.ts` (`046-SEC-01` to `046-SEC-12`) pass.
- [ ] Full canonical test suite passes (expect ~680 tests, 0 failures).
- [ ] Monorepo typecheck, lint, format check, repository validation, and security scan pass cleanly.
- [ ] Changes are committed with Conventional Commits and pushed to `origin/main`.
- [ ] GitHub Actions CI workflow for the final HEAD SHA completes with `success`.

---

## 23. Task 047+ Boundary

Upon completion and CI verification of Task 046:

- The entire Host Integration Series (Tasks 041–046) will be complete.
- All six tool runtimes (`Device`, `Filesystem`, `Terminal`, `Browser`, `Plugin`, `Local AI`) will be fully integrated and secured in `DesktopAgent`.
- Task 047+ will initiate **Milestone M6 (Vertical Slice)**, conducting end-to-end integration between the Control Plane, AI Runtime, Desktop Agent, and Dashboard.
- **Task 046 implementation must STOP immediately after Section 22 acceptance criteria are met.**
