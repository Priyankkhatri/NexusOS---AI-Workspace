# RB-004: Operational Runbook — Desktop Agent Disconnect

**Failure Domain:** Desktop Agent ↔ Control Plane Connectivity (ACP Bridge)  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Desktop Agent Host (`apps/desktop-agent`), ACP Bridge (`services/backend`)  
**Target Component:** `ControlPlaneClient`, `ACPDispatchBridge`

---

## 1. Symptoms & Impact

### Symptoms

- Desktop Agent state transitions to `DISCONNECTED` or `OFFLINE`.
- Control Plane dispatch bridge reports: `Target agent '<agentId>' not registered or offline`.
- Heartbeat probe fails with missing heartbeat acknowledgment (`HEARTBEAT_TIMEOUT`).
- Active dispatched tasks hang in `DISPATCHED` state without transitioning to `EXECUTING`.

### Impact

- Control Plane cannot route newly approved tasks to the target Desktop Agent.
- Local capabilities on the host device cannot be invoked remotely.
- In-flight execution leases may expire before execution receipts can be returned to the control plane.

---

## 2. Detection & Observability

- **Control Plane Logs:**
  - Component: `ACPDispatchBridge`
  - Level: `warn` or `error`
  - Message: `Failed to dispatch task: Target agent is not connected` or `Heartbeat missed for agent`.
- **Desktop Agent Logs:**
  - Component: `ControlPlaneClient`
  - Message: `Control plane connection lost` or `Reconnection attempt failed`.
  - Level: `warn`
- **Task State Machine:**
  - Tasks stay in `DISPATCHED` state past the task dispatch timeout threshold.

---

## 3. Immediate Containment

1. Mark agent as offline in the control plane dispatch registry:
   - Prevents new tasks from being scheduled to an unreachable endpoint.
2. In-flight lease timeout enforcement:
   - Expired leases (`DEFAULT_LEASE_TTL_SECONDS = 30`) automatically fail closed at the execution boundary (`LEASE_EXPIRED`).
3. Maintain local task state:
   - Desktop Agent must complete locally executing tasks, buffer signed execution receipts in its local state journal, and await reconnect.

---

## 4. Diagnosis Procedures

1. **Verify Local Process Health:**
   Check if the Desktop Agent process is running on the host machine:
   ```powershell
   Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*desktop-agent*" }
   ```
2. **Inspect ACP Stream Transport:**
   - Verify network/named-pipe connectivity between host and control-plane gateway.
   - Test loopback / proxy connectivity if operating behind enterprise proxy.
3. **Verify Agent Authentication Credentials:**
   - Confirm agent JWT or device authentication token has not expired.
   - Check for `UNAUTHENTICATED` or `TOKEN_EXPIRED` in agent logs.
4. **Check Resource Exhaustion:**
   - Verify if host machine is under extreme CPU/memory pressure causing heartbeat thread starvation.

---

## 5. Safe Actions & Recovery

1. **Automatic Reconnection:**
   `ControlPlaneClient` employs exponential backoff with jitter:
   - Wait up to 3 reconnection intervals for automatic socket recovery.
2. **Restart Desktop Agent Service:**
   If the agent is unresponsive or deadlocked:
   ```powershell
   # Restart agent process
   pnpm --filter @nexusos/desktop-agent start
   ```
3. **Re-register Agent with Control Plane:**
   Once reconnected, the agent sends an initial handshake frame with device posture and capability descriptor list.
4. **Settle Buffered Execution Receipts:**
   Upon successful re-registration, the agent drains buffered receipts to the control plane.

---

## 6. Verification After Recovery

1. Verify agent connection in ACP bridge:
   - Check that bridge has a registered target agent handler (`setTargetAgent`).
2. Execute failure injection scenario 7 (Desktop disconnect handling):
   ```bash
   node --import tsx/esm --test tests/vertical-slice/failure-injection.test.ts
   ```
3. Execute end-to-end task test:
   ```bash
   node --import tsx/esm --test tests/vertical-slice/governed-vertical-slice.test.ts
   ```
   **Expected Result:** Task completes through `SUBMITTED → POLICY_EVALUATED → LEASED → DISPATCHED → EXECUTING → RECEIPT_VERIFIED → COMPLETED`.

---

## 7. Escalation & Rollback

- If the agent fails to reconnect after 3 restarts:
  1. Verify device registration and re-pair agent identity via `AgentIdentity.bindDevice()`.
  2. Inspect enterprise firewall rules blocking outgoing WebSocket / named-pipe connections.
- If unresolvable within 20 minutes:
  - Escalate to Desktop Platform Engineering on-call.

---

## 8. Evidence Collection

- Capture agent `telemetry.log` and console standard output.
- Record timestamps of the last received heartbeat frame and disconnect event.
- Export diagnostic bundle via `telemetryManager.exportDiagnosticBundle()`.
