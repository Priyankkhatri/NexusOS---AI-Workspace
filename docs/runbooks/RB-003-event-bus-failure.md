# RB-003: Operational Runbook — Event Bus Failure

**Failure Domain:** Control-Plane Event Backbone & Observability Pipeline  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Control-Plane Backend (`services/backend/src/events/`)  
**Target Component:** `EventPublisherBoundary`, `InMemoryEventPublisherBoundary`

---

## 1. Symptoms & Impact

### Symptoms

- Task lifecycle state changes occur (e.g., `SUBMITTED`, `LEASED`, `DISPATCHED`), but corresponding event envelopes (`nexusos.events.task.*`) are not received by consumers.
- Asynchronous subscribers (audit logger, telemetry bridge, notifications) stop receiving updates.
- Event publication promises reject with `EVENT_PUBLISH_FAILED` or `PUBLISHER_DISCONNECTED`.
- Spool backpressure increases in the event pipeline.

### Impact

- Audit trail observability is degraded; event evidence is delayed or dropped.
- Telemetry streams cannot trace end-to-end task execution in real time.
- Dependent event-driven services fail to trigger downstream actions.

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `EventPublisherBoundary`
  - Level: `error` or `warn`
  - Message: `Failed to publish event envelope` or `Subscriber queue full`.
  - Schema IDs affected: `nexusos.events.task.*`, `nexusos.events.policy.denial`, `nexusos.events.security`.
- **Metrics / Observables:**
  - Event publish failure counter increases.
  - Telemetry spool depth reaches backpressure threshold (>80% capacity).

---

## 3. Immediate Containment

1. Do NOT crash the task processing pipeline:
   - In accordance with NexusOS fail-safe guidelines, task state machine transitions must complete even if non-critical observability publishing encounters intermittent transport errors.
2. Enable local memory spooling:
   - Verify that events are preserved in the in-memory fallback buffer (`publishedEvents`) until transport recovers.
3. Apply backpressure:
   - If publisher buffer exceeds capacity, throttle intake of non-critical debug telemetry while preserving critical audit and security events.

---

## 4. Diagnosis Procedures

1. **Inspect Event Envelope Validity:**
   Confirm whether failing events conform to the contract schema (`createEventEnvelope`):
   - Check `eventId` (UUIDv4), `eventType`, `schemaVersion`, `source`, `correlationId`, `payload`.
   - Malformed payloads rejected by schema validation must be identified in error logs.
2. **Check Subscriber Status:**
   - Determine if a specific subscriber has registered an unhandled rejection causing publisher backpressure.
   - Inspect event handler execution timeouts.
3. **Verify Event Publisher Lifecycle:**
   - Check if `EventPublisherBoundary.start()` was called during backend boot sequence.

---

## 5. Safe Actions & Recovery

1. **Flush In-Memory Event Spool:**
   If using the buffered publisher, trigger manual flush:
   - In automated test / dev environment: `publisher.clear()` or drain pending queue.
2. **Restart Publisher Boundary:**
   If publisher is in a disconnected or stalled state, restart the publisher instance within the backend composition root.
3. **Re-verify with Test Suite:**
   ```bash
   node --import tsx/esm --test services/backend/tests/tasks.test.ts
   ```

---

## 6. Verification After Recovery

1. Publish test event envelope:
   - Verify that publishing `nexusos.events.task.created` resolves successfully without throwing.
2. Verify vertical slice event emission:
   ```bash
   node --import tsx/esm --test tests/vertical-slice/governed-vertical-slice.test.ts
   ```
   **Expected Result:** Vertical slice passes and verifies receipt of `nexusos.events.task.created`, `nexusos.events.task.leased`, `nexusos.events.task.dispatched`, and `nexusos.events.task.completed`.

---

## 7. Escalation & Rollback

- If event drops violate compliance audit requirements:
  1. Notify Security & Compliance Officer immediately.
  2. Switch to strict synchronous audit logging (`PolicyAuditLogger`).
- If unresolvable within 30 minutes:
  - Escalate to Backend Platform Engineering Lead.

---

## 8. Evidence Collection

- Capture event publication error stack traces.
- Extract correlation IDs of dropped event envelopes.
- Save snapshot of in-memory publisher queue size.
