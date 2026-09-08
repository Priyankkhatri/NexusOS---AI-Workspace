# RB-009: Operational Runbook — Deployment Rollback

**Failure Domain:** Deployment Regressions, Failed Updates & Staged Rollback  
**Severity:** CRITICAL (P0) / HIGH (P1)  
**Owning Subsystem:** Platform & Release Engineering, Desktop Agent Supervisor  
**Target Component:** `UpdateManager`, `ProcessSupervisor`, `LkgConfigStore`

---

## 1. Symptoms & Impact

### Symptoms

- Freshly deployed version fails health probes or crashes immediately upon boot (CrashLoopBackoff).
- Critical regression discovered in control-plane API or desktop agent runtime post-release.
- Desktop Agent `UpdateManager` reports verification error (hash mismatch, signature invalid) during staged update.
- Process supervisor triggers automated failover to Last Known Good (LKG) binary/configuration.

### Impact

- Service disruption or degraded capability for connected clients.
- Automated workflows stalled until stable release is restored.
- Incomplete updates may leave client binaries in inconsistent state if atomic swap fails.

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `UpdateManager` (`apps/desktop-agent/src/update/`)
  - Level: `error`
  - Message: `[UpdateManager] Update verification failed` or `[UpdateManager] Invoking LKG rollback`.
  - Component: `ProcessSupervisor`
  - Message: `Service process exited abnormally N times within window. Initiating rollback.`
- **Health Indicators:**
  - `GET /health/liveness` fails consecutively for >3 probe cycles.
  - Sentry / telemetry events show sudden error rate spike (>5%) immediately following deployment timestamp.

---

## 3. Immediate Containment

1. **Halt Update Distribution:**
   - Immediately suspend auto-update publishing or CDN staging to prevent further desktop agents from downloading the bad release.
2. **Prevent Write Corruption:**
   - If the new release includes data schema changes, verify whether schema migrations are backwards-compatible before rolling back binary.
3. **Freeze Orchestration Tasks:**
   - Temporarily pause task dispatch queue in `services/orchestrator` during the rollback window.

---

## 4. Diagnosis Procedures

1. **Verify Current vs LKG Version:**
   Check the current deployed version and the recorded LKG metadata:
   ```powershell
   # Inspect package.json version
   Get-Content package.json | Select-String "version"
   ```
2. **Inspect Update Manager Logs:**
   ```powershell
   Select-String -Path "apps/desktop-agent/logs/*.log" -Pattern "UpdateManager"
   ```
3. **Check Crash Reason:**
   Inspect stderr and structured logs from the failed deployment:
   ```powershell
   Select-String -Path "logs/*.log" -Pattern "FATAL|UnhandledPromiseRejection"
   ```

---

## 5. Safe Actions, Recovery & Remediation

1. **Desktop Agent Automatic LKG Rollback:**
   The `UpdateManager` maintains an atomic backup of the previous working executable and configuration. If automatic rollback failed:

   ```powershell
   # Restore LKG configuration state
   Copy-Item "apps/desktop-agent/data/config.lkg.json" "apps/desktop-agent/data/config.json" -Force
   ```

2. **Control-Plane Backend Rollback:**

   - If deployed via git tag or container:
     ```powershell
     # Checkout previous known good tag/commit
     git checkout <LKG_COMMIT_SHA>
     # Clean and rebuild
     npm run build
     ```
   - Restart the service:
     ```powershell
     npm run start
     ```

3. **Re-run Quality & Health Verification:**
   Immediately verify the restored version:
   ```powershell
   npm run validate
   npm test
   ```

---

## 6. Verification After Recovery

1. **Service Readiness Check:**
   Confirm readiness endpoint returns healthy:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/health/readiness"
   ```
   Expect: `HTTP 200` with `status: "SERVING"` or `"HEALTHY"`.
2. **Desktop Agent Heartbeat Verification:**
   Verify the agent reconnects and publishes status to telemetry host.
3. **Run Hardening Test Suite:**
   ```powershell
   npx vitest run apps/desktop-agent/tests/update-manager.test.ts
   ```

---

## 7. Escalation & Rollback

- If schema migrations were already applied and are not backwards-compatible, invoke **RB-007 (Failed Migration)** rollback procedures before completing application rollback.
- Escalate to Release Team Lead and Incident Commander immediately upon P0 rollback initiation.

---

## 8. Evidence Collection

Collect the following diagnostic artifacts:

- Git commit SHA and build ID of failed deployment.
- Exact stack trace or crash log causing deployment rollback.
- LKG state verification logs confirming successful rollback.
- Incident timeline: deployment time, failure detected time, rollback complete time.
