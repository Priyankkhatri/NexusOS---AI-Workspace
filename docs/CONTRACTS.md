# NexusOS Shared Contracts Guide

This document describes the design, structure, and governance of the NexusOS shared contracts package (`@nexusos/contracts`).

---

## 1. Package Overview (`packages/contracts`)

The `@nexusos/contracts` package is the authoritative contract layer across all NexusOS subsystems. It contains:

- **Zod Schemas**: Runtime validation for inbound and outbound boundaries.
- **TypeScript Types**: Inferred static types ensuring compile-time safety across workspaces.
- **Error Taxonomy**: Unified error codes (`NexusError`) and HTTP status mappings.
- **ACP (Agent Control Protocol)**: Structured envelopes for control-plane-to-desktop-agent communications.

> [!IMPORTANT] > **Dependency Invariant:** `@nexusos/contracts` must remain completely free of heavy external runtime dependencies (only `zod` is permitted). It must never import from services or apps.

---

## 2. Core Contract Domains

### 2.1 Task & Lifecycle Contracts

- `TaskSchema`: Defines task identifiers, tenant IDs, priority, and parameters.
- `TaskStatus`: Strict lifecycle state machine:
  `PENDING` ➔ `APPROVED` ➔ `EXECUTING` ➔ `COMPLETED` / `FAILED` / `CANCELLED`
- `TaskExecutionGraph`: Node-edge dependency representation of multi-step agent actions.

### 2.2 Agent Control Protocol (ACP)

Defines bidirectional communication between the control plane and Desktop Agent:

- `AcpMessage`: Standard envelope containing `messageId`, `timestamp`, `correlationId`, and `payload`.
- `AcpCommand`: Control directives dispatched to local runtimes (e.g. `EXECUTE_CAPABILITY`, `CANCEL_TASK`).
- `AcpEvent`: Status events emitted by local runtimes (e.g. `CAPABILITY_STARTED`, `PROGRESS_UPDATE`, `EVIDENCE_COLLECTED`).

### 2.3 Event Bus Envelopes

Standard envelope structure for asynchronous pub/sub messaging:

```typescript
interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  source: string;
  timestamp: string;
  correlationId: string;
  tenantId: string;
  payload: T;
}
```

### 2.4 Error Taxonomy (`NexusError`)

Standardized error codes ensuring consistent client and telemetry handling:

- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `POLICY_DENIED` (403)
- `LEASE_EXPIRED` (401)
- `RESOURCE_EXHAUSTED` (429)
- `VALIDATION_FAILED` (400)
- `INTERNAL_ERROR` (500)

---

## 3. Contract Versioning & Evolution Rules

1. **Additive Evolution:** Fields added to schemas must be optional (`.optional()`) or have sensible defaults (`.default()`) to prevent breaking existing consumers.
2. **No Field Repurposing:** Existing field names or semantics must never be redefined.
3. **Deprecation Notice:** Deprecated fields must follow a two-release deprecation cycle before removal.
4. **Validation Test Suite:** All contract modifications must pass the contract test suite:
   ```powershell
   npx vitest run packages/contracts
   ```
