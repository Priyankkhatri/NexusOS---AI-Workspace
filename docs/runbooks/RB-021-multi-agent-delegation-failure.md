# RB-021: Multi-Agent Delegation Failure & Cascade Cancellation

**Runbook ID**: RB-021  
**Sprint**: Sprint 2 — Task 060 (Autonomous Sub-Agent Delegation)  
**Severity**: HIGH  
**Owner**: Platform Operations / NexusOS Backend Engineering  
**Version**: 1.0.0 | 2026-09-10

---

## 1. Purpose / Scope

This runbook covers operational failures within the NexusOS autonomous sub-agent delegation
subsystem (`DelegationCoordinator`, `AgentDirectoryService`). It applies when:

- A delegated child sub-task fails or becomes unresponsive
- A parent task cannot receive a child `ExecutionReceipt`
- Delegation depth or fan-out limits are breached
- A lease is revoked mid-delegation, causing in-flight tasks to orphan
- A compensation cascade is required to roll back committed delegations

**Subsystem Authority**: `services/backend/src/agents/`  
**Safety Limits**: `MAX_DEPTH = 3`, `MAX_FAN_OUT = 5` (from `DELEGATION_SAFETY_LIMITS`)

---

## 2. Detection / Symptoms

| Signal | Where to Look |
|:---|:---|
| `DelegationStatus` stuck in `PENDING` or `IN_PROGRESS` | Backend logs: `[DelegationCoordinator]` |
| `DELEGATION_DEPTH_EXCEEDED` error in task logs | Backend error logs with `delegationDepth > 3` |
| `SCOPE_AMPLIFICATION_FORBIDDEN` error | Attenuation guard rejecting child request |
| Child agent stops sending heartbeats > 45s | `AgentDirectoryService` heartbeat TTL expiry |
| `FAN_OUT_LIMIT_EXCEEDED` — too many parallel delegations | Backend logs: `fanOut > 5` rejection |
| Missing `ExecutionReceipt` from child after timeout | Delegation session TTL expiry |
| `LEASE_REVOKED` propagation not reaching children | IPC / cancellation path log gaps |

**Baseline normal state**: All `DelegationStatus` values resolve to `COMPLETED` or `CANCELLED`
within the session TTL. `AgentDirectoryService` shows all registered agents as `HEALTHY`.

---

## 3. Immediate Containment

1. **Identify stuck delegations**: Query in-memory delegation sessions via backend diagnostic
   endpoint (if exposed) or inspect logs for `delegationId` with stale `IN_PROGRESS` status.

2. **Revoke the parent task**:
   - Trigger `DelegationCoordinator.revokeParentTask(taskId)` to propagate a
     `LEASE_REVOKED` signal across all active child delegations for that task.
   - This marks all child delegation sessions as `CANCELLED` and prevents new delegations
     from being accepted under the revoked task.

3. **Isolate the faulty child agent**:
   - Remove the child agent from `AgentDirectoryService` using `deregisterAgent(agentId, tenantId)`.
   - This prevents further task assignments to the faulty agent.

4. **Stop fan-out escalation**:
   - If `MAX_FAN_OUT` is being violated, reject incoming `delegateSubTask` calls at the
     coordinator level until the count drops below the limit.

---

## 4. Diagnosis

### 4.1 Identify the Delegation Chain

Examine the `delegation_lineage` field in `DelegationSession` to trace the full call path from root
orchestrator to the failing leaf agent.

```
Root Task → delegationId-A (depth=1) → delegationId-B (depth=2) → FAILED (depth=3)
```

### 4.2 Scope Attenuation Check

If a child was rejected: confirm `verifyScopeAttenuation(parentScopes, childScopes)` returns
`valid: true`. Any `SCOPE_AMPLIFICATION_FORBIDDEN` indicates the child attempted to request
capabilities exceeding its parent lease — a security event, not a bug.

### 4.3 Lease / TTL Expiry

Inspect `DelegationSession.expiresAt` (Unix ms). If `Date.now() > expiresAt`, the delegation
session expired before the child completed. This is normal under high load — increase `timeoutMs`
in the delegation request (must be ≤ `DELEGATION_SAFETY_LIMITS.MAX_TIMEOUT_MS`).

### 4.4 Heartbeat TTL Expiry

Agents become `UNHEALTHY` after 45 seconds without a heartbeat. Check the last heartbeat
timestamp in `AgentRecord.lastHeartbeatAt`. If `Date.now() - lastHeartbeatAt > heartbeatTtlMs`,
the agent is stale.

### 4.5 Compensation Payload

Inspect `DelegationSession.compensationPayload` — the parent task provides this to guide rollback.
If compensation data is missing, the parent task may not have registered undo instructions.

---

## 5. Recovery

### 5.1 Localized Compensation (Preferred)

If the child task carried a `compensationPayload`, execute the compensation action defined by the
parent task's orchestration plan. This is application-specific but typically involves:

- Reverting file system writes (if the child executed filesystem operations)
- Cancelling any pending external API calls initiated by the child

### 5.2 Parent Cancellation Cascade

```
DelegationCoordinator.cancelDelegationsByParentTask(parentTaskId)
```

This marks all `IN_PROGRESS` child delegations as `CANCELLED` and emits cancellation events
to the owning parent task's orchestration context.

### 5.3 Agent Re-registration

After fixing the faulty agent, re-register it with `AgentDirectoryService.registerAgent(...)`.
New registrations receive `HEALTHY` status and a fresh heartbeat window.

### 5.4 Idempotent Retry

Each delegation carries an `idempotencyKey`. If retrying a failed delegation, re-use the original
`idempotencyKey` — the coordinator will return the existing session instead of creating a duplicate.

---

## 6. Verification

After applying recovery:

1. Confirm all `DelegationSession` entries for the affected `parentTaskId` are in
   `COMPLETED` or `CANCELLED` status.
2. Verify `AgentDirectoryService.listAgents(tenantId)` shows all expected agents as `HEALTHY`.
3. Confirm scope attenuation (`verifyScopeAttenuation`) passes cleanly for any re-issued
   delegation request.
4. Run targeted tests: `node --import tsx/esm --test tests/hardening/multi-agent-delegation-security.test.ts`

---

## 7. Escalation

| Trigger | Action |
|:---|:---|
| Cascade propagation failure (children not receiving `LEASE_REVOKED`) | Escalate to NexusOS Backend Engineering — IPC / cancellation path investigation |
| `SCOPE_AMPLIFICATION_FORBIDDEN` events in production | Security escalation — potential capability escalation attempt |
| Recurring fan-out violations (`MAX_FAN_OUT` exceeded repeatedly) | Orchestration plan review — reduce delegation breadth |
| Agent fails to re-register after restart | Desktop-Agent IPC investigation (RB-004 may apply) |

---

## 8. Prevention / Lessons Learned

- **Set explicit `timeoutMs`** in all delegation requests — never rely on the default.
- **Register compensation payloads** for all stateful child delegations (file I/O, external calls).
- **Monitor delegation depth** — orchestration plans must stay within `MAX_DEPTH = 3`.
- **Agent heartbeat discipline** — agents must send heartbeats every 30s (well within the 45s TTL).
- **Idempotency key hygiene** — always generate idempotency keys deterministically from task inputs
  so retries are safe.
