# RB-013: Operational Runbook — Local AI Engine Hardware & Inference Fault

**Failure Domain:** Local AI Model Inference, VRAM Management & Fallback Router  
**Severity:** HIGH (P1) / MEDIUM (P2)  
**Owning Subsystem:** AI Runtime Subsystem (`runtimes/local-ai`, `apps/desktop-agent/src/runtimes/local-ai`)  
**Target Process:** `LocalAiModelRouter`, `ResourceGovernor`

---

## 1. Symptoms & Impact

### Symptoms

- Model inference request fails with error `VRAM_BUDGET_EXCEEDED` or `MODEL_INFERENCE_OOM`.
- Local AI model router triggers automatic fallback circuit breaker (`CIRCUIT_BREAKER_OPEN`).
- Prompt inference latency spikes dramatically (> 30 seconds) or times out (`LOCAL_AI_TIMEOUT`).
- Host machine experiences memory pressure or GPU driver TDR (Timeout Detection and Recovery) event.

### Impact

- Local offline AI tasks (summarization, decomposition, entity extraction) fail or fall back to CPU.
- High memory usage can degrade desktop UI responsiveness.
- Tasks dependent on local LLM capabilities are queued or terminated fail-closed.

---

## 2. Detection & Observability

- **Structured Log Events:**
  - `level: "error"` or `level: "warn"` emitted by `ResourceGovernor` or `ModelRouter`.
  - Message: `VRAM budget overflow detected` or `Tripped circuit breaker to CPU quantized fallback`.
  - Correlation fields: `modelId`, `vramRequestedMb`, `vramAvailableMb`, `quantizationTier`.
- **Metrics:**
  - `ai_inference_duration_ms`: Elevated > 10,000ms.
  - `ai_circuit_breaker_tripped_total`: Non-zero counter increment.
- **Hardware Probes:**
  - `scripts/measure-resource-baseline.js` GPU detection reports insufficient free VRAM.

---

## 3. Immediate Containment

1. **Trip Circuit Breaker to Safe Fallback:**
   Confirm the router has automatically transitioned to quantized CPU inference or deterministic extractive fallback:
   - Verify `router.getCircuitBreakerState()` returns `HALF_OPEN` or `OPEN`.
2. **Release Loaded Model Weights:**
   If a heavy model is locked in GPU memory, trigger cache unloading:
   - Call model router unload hook to free dedicated VRAM.
3. **Throttle Concurrent Inferences:**
   Enforce concurrency limit `maxConcurrentInferences = 1` until memory pressure abates.

---

## 4. Diagnosis Procedures

1. **Probe GPU & VRAM State:**
   Run the hardware probe to evaluate available video memory:
   ```powershell
   nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv
   ```
2. **Check Context Window Size:**
   Inspect the inference request payload:
   - Verify input token count does not exceed the model context window (e.g. 4096 or 8192 tokens).
   - Ensure retrieved context memories are properly truncated and bounded.
3. **Verify Prompt Isolation:**
   Confirm prompt templates do not contain recursive input loops or injection patterns that inflate generation length.

---

## 5. Safe Actions & Recovery

1. **Downscale to Quantized Model:**
   Configure the model router to use a smaller quantization footprint (e.g. 4-bit Q4_K_M instead of 8-bit or 16-bit float):
   - Update config: `AI_MODEL_TIER = "q4_k_m"`.
2. **Restart Model Engine Worker:**
   If the native engine process is hung or orphaned:
   - Terminate the inference subprocess; the supervisor will re-initialize with clean buffers.
3. **Adjust Memory Budget Threshold:**
   Update `maxVramUsagePercent` to 80% to ensure headroom for the OS display compositor.

---

## 6. Verification After Recovery

1. Execute the local AI security and regression suite:
   ```bash
   pnpm --filter @nexusos/desktop-agent test tests/vertical-slice/local-ai-security-invariants.test.ts
   ```
   **Expected Response:** All model routing, circuit breaking, and prompt containment tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** AI Platform Lead / Core Runtime Team.
- **Prevention:** Always check available VRAM before loading models, and mandate deterministic extractive fallback paths for resource-constrained edge environments.
