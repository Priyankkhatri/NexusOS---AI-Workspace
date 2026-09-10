# RB-019: Operational Runbook — Goal Decomposer Ambiguity & Replan Exhaustion

**Failure Domain:** Autonomous Workflow Orchestrator, Adaptive Replanner & Capability Registry  
**Severity:** HIGH (P1) / MEDIUM (P2)  
**Owning Subsystem:** Backend Planner Subsystem (`services/backend/src/planner`), Planner Contracts (`packages/contracts/src/planner`)  
**Target Process:** `PlannerService`, `GoalNormalizer`, `ReplanCoordinator`

---

## 1. Symptoms & Impact

### Symptoms

- Goal decomposition request `POST /v1/tasks/plan` fails with HTTP 422 Unprocessable Entity and error code `AMBIGUOUS_GOAL`.
- Adaptive replan request `POST /v1/tasks/replan` fails with error `EXCEEDS_MAX_REPLAN_ITERATIONS` (iteration > 3).
- Decomposer rejects proposed plan with error `UNREGISTERED_CAPABILITY` or `HALLUCINATED_CAPABILITY`.
- Plan proposal fails closed because generated DAG exceeds safety bounds (`EXCEEDS_MAX_NODES > 50`, `EXCEEDS_MAX_DEPTH > 10`).

### Impact

- Vague, under-specified, or adversarial goal prompts are prevented from triggering hallucinated plans.
- Adaptive replanning loops are bounded strictly to 3 iterations, preventing infinite retry billing and execution storms.
- Unregistered capabilities cannot be injected into active workflow proposals.

---

## 2. Detection & Observability

- **API Error Responses:**
  - HTTP 422: `AmbiguousGoalException` with structured details (`missingDeliverables`, `clarificationPrompts`).
  - HTTP 400: `PlanComplexityExceededException` or `MaxReplanIterationsExceededException`.
- **Log Events:**
  - `level: "warn"` emitted by `GoalNormalizer`: `Goal input rejected as ambiguous: insufficient specification`.
  - `level: "error"` emitted by `ReplanCoordinator`: `Replan iteration 4 rejected: maximum iterations reached`.
  - Log fields: `planId`, `originalWorkflowId`, `replanIteration`, `failedNodeId`.

---

## 3. Immediate Containment

1. **Verify Terminal State of Failed Workflow:**
   Ensure the workflow that exhausted its 3 replan iterations has transitioned to terminal `FAILED`:
   - Confirm no new execution leases are issued for the workflow lineage.
2. **Review Ambiguity Clarifications:**
   Check the `AmbiguousGoalDetails` returned to the client to confirm which deliverables or constraints were missing.
3. **Verify Proposal Status (057-SEC-01):**
   Confirm that all generated plans remain in status `PROPOSED` and cannot auto-execute without HITL approval and policy permitting.

---

## 4. Diagnosis Procedures

1. **Inspect Goal Text & Extraction Archetype:**
   Analyze the raw prompt passed to `GoalNormalizer`:
   - Check if prompt was too brief (e.g. "fix it", "do something") or contained prompt injection delimiters.
2. **Inspect Node Failure Evidence:**
   In an adaptive replan failure, examine the evidence from `failedNodeId`:
   - Check whether the node failed due to non-deterministic environmental issues or permanent capability bugs.
3. **Inspect Capability Registry Matching:**
   Verify whether all steps in the proposal map to active capabilities registered in `CapabilityRegistry`:
   - Capabilities must be present in the authoritative registry; custom unverified capability strings are strictly rejected.

---

## 5. Safe Actions & Recovery

1. **Refine Goal Specification:**
   Provide explicit deliverables, parameters, and constraints in the client request:
   ```json
   {
     "goal": "Read daily report file, aggregate quarterly metrics, and output PDF summary",
     "deliverables": ["quarterly_summary.pdf"],
     "parameters": { "targetQuarter": "Q3" }
   }
   ```
2. **Execute Manual Compensation / Rollback:**
   If a workflow failed at replan iteration 3:
   - Review preserved completed nodes in `preservedCompletedNodes` to verify which mutations succeeded.
   - Execute manual cleanup for uncompensated side effects.
3. **Extend Capability Registry (if new tool legitimately needed):**
   If a valid tool capability was flagged as hallucinated:
   - Register the capability in `CapabilityRegistry` with explicit risk tier and permissions.

---

## 6. Verification After Recovery

1. Run planner engine and security tests:
   ```bash
   pnpm --filter @nexusos/backend test services/backend/tests/planner/planner-security.test.ts
   ```
   **Expected Response:** All complexity limit, capability validation, and replan capping tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Autonomous Systems Lead / Planner Subsystem Team.
- **Prevention:** Mandate structured goal input forms in client UIs with required deliverable fields to eliminate ambiguity before hitting the API.
