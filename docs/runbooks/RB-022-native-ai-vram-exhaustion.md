# RB-022: Native AI Engine VRAM Exhaustion & Hardware Fault

**Runbook ID**: RB-022  
**Sprint**: Sprint 2 — Task 061 (Native Quantized Local-AI Execution)  
**Severity**: HIGH  
**Owner**: Platform Operations / Desktop Agent Engineering  
**Version**: 1.0.0 | 2026-09-10

---

## 1. Purpose / Scope

This runbook covers operational failures in the NexusOS native quantized local-AI runtime
(`ModelRuntimeManager`, `VramOffloader`, `HardwareDetector`, `ResourceGovernor`). It applies when:

- VRAM is exhausted during active model inference
- A model cannot load due to hardware capability mismatch
- The runtime falls back to CPU with degraded performance
- The hardware detector produces incorrect or stale profile data
- A model artifact fails integrity verification and is quarantined

**Subsystem Authority**: `apps/desktop-agent/src/runtimes/local-ai/`  
**Safety Ceilings**: `MAX_VRAM_PERCENT = 0.80`, `MAX_RAM_PERCENT = 0.70`

> **Important**: Native GPU inference validation in CI is not possible without physical GPU
> hardware in the test environment. The local-AI runtime operates on CPU fallback in CI.
> VRAM measurements are only meaningful on the target developer workstation.

---

## 2. Detection / Symptoms

| Signal                                                      | Where to Look                                                |
| :---------------------------------------------------------- | :----------------------------------------------------------- |
| `VramOffloaderError(INVALID_HARDWARE)` in logs              | Desktop agent: `[VramOffloader]` log stream                  |
| Model stuck loading — no inference responses                | `[ModelRuntimeManager]` load timeout                         |
| `ENDPOINT_DISALLOWED` error from `validateLoopbackEndpoint` | Provider adapter SSRF guard triggered                        |
| Inference latency > 30s for simple prompts                  | CPU fallback active; GPU path unavailable                    |
| `NATIVE_ENGINE_UNAVAILABLE` in provider adapter logs        | LlamaCpp or ONNX engine not initialized                      |
| High process RSS growing unboundedly                        | Memory leak in model weights or KV cache                     |
| Thermal throttling warnings                                 | `HardwareProfile.thermalState = 'throttled'` or `'critical'` |

---

## 3. Immediate Containment

1. **Force CPU fallback**: Set `allowCpuFallback: true` and `preferredBackend: 'cpu_fallback'`
   in the inference request to bypass GPU path immediately.

2. **Unload active models**: Evict the model from cache via `ModelCacheManager.evict(modelId)`.
   This frees VRAM and RAM for recovery.

3. **Invalidate hardware cache**: Call `HardwareDetector.invalidateCache()` to force a fresh
   hardware profile sample on the next request — stale profiles may have caused incorrect
   placement planning.

4. **Stop accepting new inference requests**: Pause the inference queue at the
   `ModelRuntimeManager` level until VRAM pressure is resolved.

---

## 4. Diagnosis

### 4.1 Hardware Profile Audit

Examine the `HardwareProfile` produced by `HardwareDetector.getProfile()`:

```
totalRamBytes:    16,376,832,000  (≈ 15.2 GB system RAM)
freeRamBytes:     2,147,483,648   (≈ 2.0 GB free — LOW)
gpuAdapters[0]:
  name:           NVIDIA GeForce RTX 3050 6GB Laptop GPU
  vramBytes:      6,442,450,944   (6 GB total VRAM)
  freeVramBytes:  524,288,000     (512 MB free — CRITICAL)
thermalState:     throttled
```

A `freeVramBytes` value approaching zero indicates VRAM exhaustion.

### 4.2 Placement Plan Review

Re-run `VramOffloader.planLayerOffload(hardwareProfile, modelRequirements)` and inspect:

- `placement.gpuLayers` — layers assigned to GPU
- `placement.cpuLayers` — layers spilled to system RAM
- `isCpuFallback` — whether GPU path was skipped
- `fallbackReason` — the exact reason for CPU fallback

### 4.3 Model Integrity Verification

If the model artifact fails a checksum or size validation during load, the `ModelCacheManager`
will quarantine the artifact. Check quarantine state by inspecting the model cache status:

- Verify the model file hash matches the expected `checksum` in the model manifest.
- If the download was incomplete (file size mismatch), re-download the model weight file.

### 4.4 SSRF Guard False Positive

If `validateLoopbackEndpoint` is blocking a valid local endpoint:

- Confirm the endpoint URL resolves to `127.0.0.1`, `localhost`, or `::1`.
- Non-loopback addresses are prohibited by design (061-SEC-01). Remote inference endpoints
  are never permitted in NexusOS.

### 4.5 CPU Fallback Condition Diagnostic

CPU fallback is activated when:

- `freeVramBytes < modelWeightBytes + kvCacheBytes` (model does not fit)
- `allowCpuFallback = true` (operator has permitted fallback)
- `gpuAdapters.length === 0` (no GPU detected)

Verify which condition applies from the `InferenceExecutionPlan.fallbackReason` field.

---

## 5. Recovery

### 5.1 VRAM Reclamation

1. Evict all cached models: `ModelCacheManager.evictAll()`.
2. Wait for VRAM to be released (typically immediate after model unload).
3. Re-sample hardware: `HardwareDetector.invalidateCache()` then `getProfile()`.
4. Confirm `freeVramBytes` has recovered to an acceptable level (> model size × 1.25 headroom).
5. Reload only the required model with `modelRuntimeManager.loadModel(modelId)`.

### 5.2 Model Re-download After Quarantine

1. Identify the quarantined model file path from the cache manager state.
2. Delete the quarantined artifact.
3. Re-trigger model download via the Desktop Agent model management command.
4. Re-verify checksum after download completes before enabling the model.

### 5.3 Thermal Throttling Recovery

1. Reduce concurrent inference load immediately (pause model requests).
2. Allow the device to cool until `thermalState` returns to `'normal'`.
3. `HardwareDetector.invalidateCache()` to pick up the updated thermal state.
4. Resume inference with reduced batch size or concurrency.

### 5.4 Fallback-Only Mode

If GPU is persistently unavailable, configure the runtime for CPU-only operation:

- Set `preferredBackend: 'cpu_fallback'` in the `ModelRuntimeManager` configuration.
- This disables GPU path detection and prevents `VRAM exhaustion` errors from occurring.
- Note: CPU inference for large models is significantly slower. Only suitable for small
  quantized models (Q4_K_M, ≤ 3B parameters) on the reference developer workstation.

---

## 6. Verification

1. Run `VramOffloader.planLayerOffload(freshProfile, modelReqs)` — confirm `isCpuFallback`
   reflects the actual hardware state.
2. Confirm `HardwareProfile.thermalState === 'normal'` before resuming GPU inference.
3. Run the local-AI test suite: `node --import tsx/esm --test tests/hardening/local-ai-hardware-security.test.ts`
4. Confirm `validateLoopbackEndpoint('http://127.0.0.1:11434/api/generate')` passes without error.

---

## 7. Escalation

| Trigger                                                  | Action                                                                       |
| :------------------------------------------------------- | :--------------------------------------------------------------------------- |
| VRAM exhaustion persists after model eviction            | OS-level GPU driver investigation; check nvidia-smi or equivalent            |
| `thermalState = 'critical'` — not recovering after pause | Hardware engineering — thermal management fault                              |
| Model quarantined repeatedly (download always corrupt)   | Infrastructure — CDN or model registry integrity issue                       |
| `NATIVE_ENGINE_UNAVAILABLE` with correct installation    | Desktop Agent engineering — native engine binary compatibility investigation |
| SSRF guard blocking requests it should allow             | Security review — loopback detection edge case                               |

---

## 8. Prevention / Lessons Learned

- **Use quantized models** (Q4_K_M recommended) to minimize VRAM footprint on the RTX 3050 6GB.
- **Reserve headroom**: `MAX_VRAM_PERCENT = 0.80` is the ceiling — leave 20% free for OS
  display driver and system overhead.
- **Verify model checksums** before adding models to the cache manifest.
- **Monitor thermal state** proactively — sustained high GPU load on a laptop will throttle.
- **Never hardcode remote endpoints** — all inference must use loopback (`127.0.0.1`) to prevent
  SSRF exposure.
- **Profile before loading** — always call `HardwareDetector.getProfile()` before planning
  layer offload to ensure placement reflects current hardware state.
