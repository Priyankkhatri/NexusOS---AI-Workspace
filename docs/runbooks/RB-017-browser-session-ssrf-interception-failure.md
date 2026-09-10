# RB-017: Operational Runbook — Browser Automation CDP Crash & SSRF Defense

**Failure Domain:** Browser Automation Runtime, Ephemeral Sessions & SSRF Defense  
**Severity:** HIGH (P1) / CRITICAL (P0)  
**Owning Subsystem:** Desktop Browser Runtime (`apps/desktop-agent/src/runtimes/browser`), Browser Contracts (`packages/contracts/src/browser`)  
**Target Process:** `BrowserRuntime`, `ChromeDevToolsBridge`, `SSRFInterceptor`

---

## 1. Symptoms & Impact

### Symptoms

- Browser navigation request is blocked with security error `SSRF_ATTEMPT_BLOCKED` or `PRIVATE_IP_ACCESS_DENIED`.
- Automation session aborts with `CDP_SESSION_DISCONNECTED` or Chrome headless worker process crashes unexpectedly.
- Browser instance fails to clean up ephemeral session storage upon task completion (`SESSION_LEAK_DETECTED`).
- Screenshot capture fails or contains masked sensitive elements (`SCREENSHOT_MASKING_APPLIED`).

### Impact

- Malicious navigation to internal network targets (e.g. `169.254.169.254`, `localhost`, `10.0.0.0/8`) is intercepted fail-closed.
- Automated web scraping or testing tasks stall if headless Chrome crashes or runs out of shared memory (`/dev/shm`).
- Sensitive session cookies or credentials from previous tasks could leak if ephemeral profiles fail to purge.

---

## 2. Detection & Observability

- **Security Alerts:**
  - Alert `055-SEC-02`: SSRF interception blocked forbidden target IP/hostname.
  - Alert `055-SEC-01`: Ephemeral profile directory reuse or incomplete destruction.
- **Log Events:**
  - `level: "error"` emitted by `SSRFInterceptor`: `Blocked forbidden navigation to metadata or private IP address`.
  - Message: `CDP connection severed unexpectedly` or `Browser process exited with code 1`.
  - Fields: `requestedUrl`, `resolvedIp`, `sessionId`, `tenantId`.

---

## 3. Immediate Containment

1. **Terminate Hanging Chrome Processes:**
   If headless browser processes become orphaned:
   ```powershell
   Get-Process -Name "chrome" | Where-Object { $_.CommandLine -like "*--headless*" } | Stop-Process -Force
   ```
2. **Purge Ephemeral Profile Directories:**
   Delete temporary browser session directories:
   - On Windows: Clean `AppData/Local/Temp/nexus-browser-session-*`.
3. **Verify SSRF Defense State:**
   Confirm the SSRF firewall blocked the navigation and no response payload was captured.

---

## 4. Diagnosis Procedures

1. **Analyze Target URL & DNS Resolution:**
   Check if the requested URL attempts DNS rebinding or points to internal infrastructure:
   - Verify resolution of target host: Ensure it does not resolve to `127.0.0.1`, `10.x`, `192.168.x`, or link-local `169.254.169.254`.
2. **Inspect CDP Connection Logs:**
   Examine DevTools Protocol WebSocket events leading up to the disconnect:
   - Check for browser crashes caused by memory pressure or page scripts exceeding resource limits.
3. **Verify Cryptographic Action Receipts:**
   Confirm that before the crash, executed browser actions generated valid signed receipts with evidence hashes.

---

## 5. Safe Actions & Recovery

1. **Re-initialize Browser Session:**
   Submit a new browser task; the runtime will generate a fresh ephemeral profile with clean cookie jars.
2. **Configure Allowlisted Domains (if legitimate internal target):**
   If a specific internal domain is legitimately required and authorized by corporate policy:
   - Update `allowedDomainPatterns` in the browser runtime configuration with human approval.
3. **Increase Headless Chrome Shared Memory:**
   If the browser crashed on heavy web pages:
   - Pass flag `--disable-dev-shm-usage` or increase host pagefile memory allocation.

---

## 6. Verification After Recovery

1. Run browser security invariant test suite:
   ```bash
   pnpm --filter @nexusos/desktop-agent test tests/vertical-slice/browser-security-invariants.test.ts
   ```
   **Expected Response:** All session isolation, SSRF prevention, and action receipt tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Browser Runtime Lead / Security Operations.
- **Prevention:** Enforce strict asynchronous DNS resolution and IP address validation before dispatching navigation commands to the Chrome CDP interface.
