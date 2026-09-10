# RB-014: Operational Runbook — HITL Approval Timeout & Notification Loss

**Failure Domain:** Human-in-the-Loop (HITL) Desktop Approval Interceptor & IPC Notification  
**Severity:** HIGH (P1) / MEDIUM (P2)  
**Owning Subsystem:** Desktop Agent UI (`apps/desktop-agent/src/ui`), HITL Contracts (`packages/contracts/src/hitl`)  
**Target Process:** `ApprovalInterceptor`, `NotificationHost`

---

## 1. Symptoms & Impact

### Symptoms

- User submits high-risk task capability (terminal command, external network, destructive file modification), but native desktop prompt fails to appear.
- Task execution hangs waiting for approval and subsequently terminates with error `APPROVAL_TIMED_OUT` after the 60-second window.
- Approval decision submitted from tray UI returns error `STALE_APPROVAL_TOKEN` or `APPROVAL_EXPIRED`.
- Desktop IPC notification channel reports connection failure or queue buffer overflow.

### Impact

- High-risk task nodes fail closed deterministically without execution.
- Workflows requiring manual authorization cannot progress.
- Zero unauthorized privilege escalation occurs (fail-closed design prevents silent bypass).

---

## 2. Detection & Observability

- **Structured Log Events:**
  - `level: "warn"` or `level: "error"` emitted by `ApprovalInterceptor`.
  - Message: `Approval request expired after 60000ms timeout` or `Failed to deliver native approval notification via IPC`.
  - Correlation fields: `approvalRequestId`, `taskId`, `capability`, `riskTier`.
- **Metrics:**
  - `hitl_approvals_timed_out_total`: Rate increase.
  - `hitl_prompt_delivery_latency_ms`: Spike > 2,000ms.
- **Audit Records:**
  - System audit log captures `APPROVAL_TIMEOUT` or `APPROVAL_REFUSED` event with tamper-evident HMAC.

---

## 3. Immediate Containment

1. **Verify Fail-Closed Invariant (052-SEC-02):**
   Ensure the pending capability node was NOT executed upon timeout and zero execution lease was issued.
2. **Clear Expired Approval Requests:**
   Ensure the interceptor cache invalidates stale tokens so they cannot be late-approved.
3. **Verify Tray UI Connectivity:**
   Check if the system tray process is running and connected to the Desktop Agent supervisor.

---

## 4. Diagnosis Procedures

1. **Inspect Desktop Agent IPC Status:**
   Verify the local named pipe or socket connection between the background supervisor and the UI host:
   - On Windows: Check `\\.\pipe\nexusos-desktop-ipc`.
2. **Inspect Notification Queue:**
   Check whether background tasks flooded the approval queue, causing notification drops.
3. **Inspect OS Notification Settings:**
   Confirm that Windows notification permissions / Focus Assist (Do Not Disturb) have not suppressed Desktop Agent toast alerts.

---

## 5. Safe Actions & Recovery

1. **Restart Desktop Tray UI Host:**
   If the tray UI process crashed or became unresponsive:
   ```powershell
   Get-Process -Name "NexusOSTray" -ErrorAction SilentlyContinue | Stop-Process -Force
   Start-Process "apps/desktop-agent/dist/tray-ui.exe"
   ```
2. **Resubmit Workflow Task:**
   Once the UI connection is restored, resubmit the task with fresh correlation and approval tokens.
3. **Extend Approval Timeout (if required for complex human review):**
   If 60 seconds is insufficient for complex reviews, configure custom timeout up to policy maximum (120s):
   - Update `approvalTimeoutMs` in client configuration.

---

## 6. Verification After Recovery

1. Run the HITL security invariant test suite:
   ```bash
   pnpm --filter @nexusos/desktop-agent test tests/vertical-slice/approval-security-invariants.test.ts
   ```
   **Expected Response:** All approval interception, timeout fail-closed, and decision signing tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Desktop Experience Team / Client Security Lead.
- **Prevention:** Implement visual pulse heartbeat in the tray icon indicating connection health, alerting users when IPC is degraded before high-risk tasks are requested.
