# RB-011: Operational Runbook — DAG Workflow Execution & Deadlock

**Failure Domain:** Control-Plane Multi-Step Workflow Graph & DAG Execution  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Control-Plane Task Subsystem (`services/backend/src/tasks`), Task Contracts (`packages/contracts/src/tasks`)  
**Target Process:** `TaskController`, `WorkflowEngine`

---

## 1. Symptoms & Impact

### Symptoms

- Workflow creation request `POST /v1/tasks/graphs` fails with HTTP 400 Bad Request and error code `INVALID_DAG_TOPOLOGY` or `CYCLE_DETECTED`.
- Multi-step workflow stalls in state `EXECUTING`; child nodes never transition to `DISPATCHED` despite parent nodes completing successfully.
- Workflow execution timeout occurs (`WORKFLOW_TIMEOUT_EXCEEDED`) or individual node exceeds TTL lease (`LEASE_EXPIRED`).
- Composite lease validation fails at agent boundary (`COMPOSITE_LEASE_SCOPE_MISMATCH`).

### Impact

- Multi-node automated workflows cannot complete or get stuck in deadlock.
- Dependent tasks fail downstream, causing business process interruption.
- Allocated capability leases remain locked until lease TTL expiry.

---

## 2. Detection & Observability

- **HTTP Status:** HTTP 400 Bad Request on DAG creation, or HTTP 500 on workflow dispatch failure.
- **Structured Log Events:**
  - `level: "error"` emitted by `TaskController` or `DependencyAnalyzer`.
  - Message: `Workflow graph contains cyclic dependencies` or `Failed to evaluate DAG node transition`.
  - Correlation fields: `correlationId`, `tenantId`, `workflowId`, `taskId`.
- **Telemetry Indicators:**
  - Metric: `workflow_execution_duration_ms` spikes or plateaus without terminal status.
  - Alert: Elevated rate of `workflow_node_failed` or `composite_lease_expired`.

---

## 3. Immediate Containment

1. **Halt Stalled Workflow:**
   Issue a cancellation request via the task controller API to release active resource leases:
   ```bash
   curl -X POST http://127.0.0.1:3000/v1/tasks/<workflowId>/cancel \
     -H "Authorization: Bearer <ADMIN_TOKEN>" \
     -H "Content-Type: application/json"
   ```
2. **Prevent Cascade Retries:**
   Ensure caller clients do not enter unbounded retry loops resubmitting topologically invalid graphs.
3. **Quarantine Failing Node:**
   Identify if a specific capability node repeatedly fails policy evaluation or lease issuance.

---

## 4. Diagnosis Procedures

1. **Inspect Graph Topology Validation:**
   Check the submission payload against Kahn's algorithm cycle detection:
   - Ensure all `edges.fromNodeId` and `edges.toNodeId` exist in `nodes`.
   - Verify there are no circular dependency chains (e.g. A -> B -> C -> A).
   - Ensure `validateDAGTopology` passes during contract parsing.
2. **Inspect Node Lease Bindings:**
   Verify the composite lease issued by `LeaseIssuer` encompasses all declared node capabilities:
   - Examine `task.lease.scopes` to ensure every capability invoked by a node is explicitly granted.
3. **Inspect Task State Machine:**
   Check the database record for `task_state`:
   - Confirm nodes followed monotonic transitions: `PENDING` -> `LEASED` -> `DISPATCHED` -> `EXECUTING` -> `RECEIPT_VERIFIED` -> `COMPLETED`.

---

## 5. Safe Actions & Recovery

1. **Re-evaluate Policy & Lease:**
   If a node was rejected due to policy evaluation failure:
   - Review policy rules in `services/policy` to verify whether the actor has sufficient role/scope for all requested nodes.
2. **Correct Dependency Edge Ordering:**
   If the workflow contains unintended edge dependencies, reformulate the DAG with valid topological order and resubmit.
3. **Compensate Failed Branches:**
   If a node failed and compensation logic is triggered, ensure rollback actions complete before re-triggering the workflow.

---

## 6. Verification After Recovery

1. Query workflow status:
   ```bash
   curl -i http://127.0.0.1:3000/v1/tasks/<workflowId> \
     -H "Authorization: Bearer <TOKEN>"
   ```
   **Expected Response:** HTTP 200 OK with `lifecycleState: "COMPLETED"` or `lifecycleState: "CANCELLED"`.
2. Verify all node receipts are verified with valid SHA-256 evidence hashes.

---

## 7. Escalation & Prevention

- **Escalation Path:** Platform Engineering / Workflow Orchestrator Lead.
- **Prevention:** Implement client-side DAG dry-run validation using `validateDAGTopology` in developer tooling before submission to the control plane.
