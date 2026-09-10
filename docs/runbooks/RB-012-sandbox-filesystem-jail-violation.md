# RB-012: Operational Runbook — Filesystem Sandbox Jail Violation

**Failure Domain:** Desktop Agent Filesystem Sandbox & Path Jail Enforcement  
**Severity:** CRITICAL (P0) / HIGH (P1)  
**Owning Subsystem:** Desktop Agent Runtime (`apps/desktop-agent/src/runtimes/filesystem`)  
**Target Process:** `FilesystemSandboxRuntime`, `PathValidator`

---

## 1. Symptoms & Impact

### Symptoms

- Desktop Agent rejects a file read/write request with error `PATH_TRAVERSAL_DETECTED` or `OUTSIDE_WORKSPACE_JAIL`.
- Agent detects an attempted symlink resolution escaping the designated workspace directory (`SYMLINK_ESCAPE_ATTEMPT`).
- Security alert triggered indicating an unpermitted path canonicalization attempt containing relative escape sequences (`../` or `..\\`).
- Filesystem capability lease verification fails closed with `UNAUTHORIZED_WORKSPACE_ACCESS`.

### Impact

- Potential directory traversal or sandbox escape attack is intercepted and blocked fail-closed.
- Legitimate workflow tasks targeting misconfigured or unmapped directory paths fail execution.
- File integrity outside the designated workspace root is strictly protected.

---

## 2. Detection & Observability

- **Security Alert:** Alert triggered by `FilesystemSandboxRuntime` with tag `050-SEC-01` or `050-SEC-02`.
- **Log Events:**
  - `level: "error"` or `level: "warn"` with message `Path traversal escape detected` or `Resolved canonical path outside root jail`.
  - Log fields: `requestedPath`, `canonicalPath`, `workspaceRoot`, `tenantId`, `principalId`.
- **Error Codes:** `PATH_TRAVERSAL_DETECTED`, `OUTSIDE_WORKSPACE_JAIL`, `SYMLINK_NOT_PERMITTED`.

---

## 3. Immediate Containment

1. **Verify Fail-Closed State:**
   Confirm the runtime blocked the I/O operation and did not modify or expose host files.
2. **Revoke Offending Capability Lease:**
   If the request came from an untrusted or compromised task/plugin, revoke the active execution lease immediately.
3. **Quarantine Calling Origin:**
   If the violation originated from a third-party plugin or external prompt, place the originating entity into quarantine (`PluginStatus.QUARANTINED`).

---

## 4. Diagnosis Procedures

1. **Inspect Requested Path:**
   Analyze the raw input path provided in the capability arguments:
   - Look for URL-encoded traversal (`%2e%2e%2f`), null-byte injections, or Windows alternate data stream (`::$DATA`) markers.
2. **Inspect Workspace Root Binding:**
   Verify the workspace directory jail configuration for the active tenant:
   - Ensure the configured `workspaceRoot` path exists, is canonicalized, and contains no junction loops.
3. **Inspect Symlink Targets:**
   If a symlink was involved, examine where the link points:
   - Use `Get-Item <Path> | Select-Object -ExpandProperty Target` on Windows.
   - Confirm whether the target path lies entirely within the permitted workspace boundary.

---

## 5. Safe Actions & Recovery

1. **Correct Misconfigured Path Arguments:**
   If the failure was due to an unintentional relative path error by a legitimate user/tool:
   - Ensure paths are passed relative to the workspace root without `..` escape prefixes.
2. **Explicit Workspace Grant:**
   If access to an external directory is legitimately required:
   - Update the workspace boundary policy configuration in `services/policy` with human authorization.
   - Do NOT disable path canonicalization or jail checks under any circumstances.

---

## 6. Verification After Recovery

1. Submit a safe file verification read within the workspace root:
   ```bash
   pnpm --filter @nexusos/desktop-agent test tests/vertical-slice/filesystem-sandbox-hardening.test.ts
   ```
   **Expected Response:** All jail boundary tests pass cleanly; operations outside the root continue to be rejected.

---

## 7. Escalation & Prevention

- **Escalation Path:** Security Engineering / Desktop Agent Core Team.
- **Prevention:** Mandate that all file access in agent tools use canonical path resolution and strict prefix checking against the resolved workspace root before any file descriptors are opened.
