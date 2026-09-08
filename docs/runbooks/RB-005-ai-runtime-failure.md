# RB-005: Operational Runbook — AI Runtime Failure

**Failure Domain:** Local AI Execution Plane & Hardware Acceleration  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Local AI Runtime (`apps/desktop-agent/src/runtimes/local-ai/`)  
**Target Component:** `LocalAiRuntime`, `ResourceGovernor`, `ModelCacheManager`

---

## 1. Symptoms & Impact

### Symptoms

- Local inference requests fail with `RESOURCE_LIMIT_EXCEEDED`, `MODEL_UNAVAILABLE`, or `INFERENCE_TIMEOUT`.
- Task execution graph stalls at local AI inference nodes.
- GPU acceleration fails, triggering unplanned CPU fallback or hardware detection warnings.
- Memory governor rejects execution requests due to system RAM (>70%) or VRAM (>80%) exhaustion.

### Impact

- Local language model operations (summarization, parameter extraction, code interpretation) fail.
- Tasks requiring `rt:local-ai-v1` capabilities cannot complete.
- Desktop Agent experience degrades to remote-only or non-AI fallback execution.

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `LocalAiRuntime`, `ResourceGovernor`
  - Level: `error` or `warn`
  - Messages:
    - `ResourceGovernor: Request exceeds system RAM or VRAM thresholds`
    - `ModelCacheManager: Checksum verification failed for model artifact`
    - `Inference execution exceeded timeout limit of 120000ms`
- **Error Codes:**
  - `RESOURCE_GOVERNOR_EXHAUSTION`
  - `MODEL_CHECKSUM_MISMATCH`
  - `INFERENCE_TIMEOUT`
  - `CONCURRENCY_LIMIT_EXCEEDED`

---

## 3. Immediate Containment

1. Throttle concurrent inference requests:
   - Ensure the runtime enforces `MAX_CONCURRENT_INFERENCES = 2` to prevent memory thrashing.
2. Shed non-essential AI load:
   - Reject background / batch inferences to preserve system responsiveness for interactive user tasks.
3. Free unreserved memory:
   - Trigger `ResourceGovernor.release()` for any dangling or cancelled task reservations.

---

## 4. Diagnosis Procedures

1. **Check System Resource Posture:**
   Query current hardware profile and utilization:
   ```powershell
   # Inspect host memory status
   Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory
   ```
2. **Verify Model Artifact Integrity:**
   - Verify that model weights cached on disk match their declared SHA-256 checksum in `ModelArtifactSchema`.
   - Inspect `.nexusos-models/` or configured cache directory for corrupted or truncated weight files.
3. **Inspect Hardware Detection Output:**
   - Check if `HardwareDetector.getProfile()` correctly discovered GPU adapters and VRAM capacity.
   - If sampler threw an exception, verify fallback sampler operation.
4. **Check Input Payload Size:**
   - Confirm prompt does not exceed `MAX_PROMPT_BYTES = 131072` (128 KB).

---

## 5. Safe Actions & Recovery

1. **Evict Corrupted Model Weights:**
   If a model artifact fails integrity checks:
   - Remove corrupted cache file: `Remove-Item .nexusos-models/<modelId> -Force`
   - ModelCacheManager will re-download/verify clean artifact on next request.
2. **Reset Resource Governor:**
   If reservation counters are desynchronized due to an unhandled crash:
   - Restarting `DesktopAgent` resets governor counters cleanly to baseline.
3. **Run AI Runtime Regression Suite:**
   Validate runtime operation against the unit and security test suites:
   ```bash
   node --import tsx/esm --test apps/desktop-agent/tests/local-ai-hardware-detector.test.ts apps/desktop-agent/tests/local-ai-resource-governor.test.ts apps/desktop-agent/tests/local-ai-security-hardening.test.ts
   ```

---

## 6. Verification After Recovery

1. Submit a governed diagnostic inference request via Desktop Agent IPC (`localai.infer`).
2. Verify that `ResourceGovernor.reserve()` succeeds and `ResourceGovernor.release()` clears counters.
3. Verify test passes:
   ```bash
   node --import tsx/esm --test apps/desktop-agent/tests/local-ai-host-ipc.test.ts
   ```
   **Expected Result:** 10/10 tests passing.

---

## 7. Escalation & Rollback

- If local GPU driver crashes repeatedly (TDR error):
  1. Temporarily force CPU-only provider adapter mode in configuration.
  2. Fall back to cloud model router if remote provider is configured.
- If unresolvable within 30 minutes:
  - Escalate to AI Runtime Subsystem Lead.

---

## 8. Evidence Collection

- Capture hardware detection profile JSON.
- Record memory governor metrics (active reservations, RAM/VRAM percent).
- Save inference timeout error stack trace and correlation ID.
