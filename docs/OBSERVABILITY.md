# Observability & Audit Guide — NexusOS

This guide documents the observability, telemetry, and audit architecture implemented across NexusOS services and client agents.

---

## 1. Pillars of Observability

NexusOS implements an integrated telemetry framework spanning:

1. **Structured Logging:** Standardized JSON log format across all services and runtimes.
2. **Metrics & Health Indicators:** Standard HTTP health probes and counter/gauge telemetry.
3. **Audit Trails & Receipts:** Cryptographically verifiable receipts for all governed agent actions.

---

## 2. Structured Logging & Secret Redaction

All log output conforms to a strict structured schema:

```json
{
  "timestamp": "2026-09-08T12:00:00.000Z",
  "level": "info",
  "service": "backend",
  "correlationId": "corr-uuid-1234",
  "tenantId": "tenant-default",
  "message": "Task dispatched to desktop agent",
  "context": { "taskId": "task-001" }
}
```

### Sensitive Data Masking (`StructuredLoggerRedaction`)

To ensure zero credential leakage, the structured logging middleware intercepts all records:

- **Redacted Fields:** `password`, `token`, `secret`, `authorization`, `privateKey`, `apiKey`.
- **Pattern Matching:** JWT tokens (`eyJ...`) and Bearer headers are masked prior to disk write or network transmission.

---

## 3. Health Probes & Readiness Protocol

Every control-plane service exposes standard health endpoints:

| Endpoint                | Purpose                                                | Success Condition      | Response Code                   |
| :---------------------- | :----------------------------------------------------- | :--------------------- | :------------------------------ |
| `GET /health/liveness`  | Verifies process is alive and event loop is responsive | Server process running | `HTTP 200 OK`                   |
| `GET /health/readiness` | Verifies dependencies (DB, identity, config) are ready | All subsystems healthy | `HTTP 200 OK` (503 if degraded) |
| `GET /health/startup`   | Verifies initial migrations and bootstrap completed    | Bootstrap done         | `HTTP 200 OK`                   |

---

## 4. Telemetry Spooling in Desktop Agent

The Desktop Agent operates in both online and offline network environments:

- **Local Spooling:** When disconnected, events are buffered in an encrypted on-disk spool directory (`data/telemetry_spool/`).
- **Batched Ingestion:** When network connectivity is restored, the `TelemetryHost` batches and drains spooled records to the backend collector.
- **Backpressure & Limits:** If the spool exceeds quota (default 50MB), low-priority debug records are evicted first to safeguard audit integrity.

---

## 5. Audit Trail & Evidence Receipts

For every governed task execution:

1. **Approval Audit:** Records the timestamp, authorizing policy ID, and lease terms.
2. **Capability Evidence:** Desktop runtime captures outputs, exit codes, and hashes.
3. **Receipt Generation:** An immutable task completion receipt is signed and linked to the task history in `services/backend`.
