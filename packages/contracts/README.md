# `@nexusos/contracts` — Shared NexusOS Contract Foundation

This package provides implementation-independent TypeScript interfaces, schemas, common identifiers, error taxonomies, and contract envelopes for the NexusOS enterprise platform.

---

## 🏛️ Governance & Authority

This package is strictly governed by the authoritative specifications in [`docs/`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs):

1. **NexusOS API Contract Specification** (`docs/Architecture_and_Specs/`)
2. **NexusOS Architecture Bible** (`docs/Architecture_and_Specs/`)
3. **NexusOS Engineering Design Documents (EDDs)** (`docs/EDDs/`)

### 🛑 Architectural Boundaries & Invariants

- **MUST NOT** import service implementations, runtime engines, database adapters, or frontend UI components.
- **MUST NOT** contain business logic or network transport logic.
- **MUST NOT** invent unapproved public protocol semantics or ad-hoc communication fields.

---

## 📦 Package Modules & Exports

### 1. `identity`

Common UUID-based identifier types and schemas (`TenantId`, `UserId`, `DeviceId`, `RequestId`, `CorrelationId`, `TaskId`, `LeaseId`, `IdentityClaimsSchema`).

### 2. `errors`

Standard error category taxonomy (`ErrorCategory`) and structured error envelope schema (`NexusOSErrorSchema`, `createNexusOSError`).

### 3. `api`

Base REST API request and response envelopes (`APIRequestMetaSchema`, `APISuccessResponseSchema`, `APIErrorResponseSchema`, `serializeContract`, `deserializeContract`).

### 4. `events`

Canonical Event Envelope schema (`EventEnvelopeSchema`, `createEventEnvelope`) matching PRD Section 1395 and API Contract Specification.

### 5. `acp`

Agent Communication Protocol envelope schema (`ACPMessageEnvelopeSchema`, `createACPMessageEnvelope`) matching PRD Section 1284.

### 6. `permissions`

Execution Lease header schema (`ExecutionLeaseHeaderSchema`) matching Architecture Bible Section 5.6.

---

## ⚡ Usage Example

```typescript
import {
  createEventEnvelope,
  createNexusOSError,
  ErrorCategory,
  EventEnvelopeSchema,
  serializeContract,
  deserializeContract,
} from '@nexusos/contracts';

// 1. Create a validated canonical event envelope
const event = createEventEnvelope(
  'nexusos.system.task.created',
  '1.0',
  'orchestrator-service',
  'b7f4a203-1234-4567-89ab-cdef01234567',
  { taskId: 'task-123', status: 'PENDING' },
);

// 2. Serialize for network transmission
const payloadJson = serializeContract(EventEnvelopeSchema, event);

// 3. Deserialize & validate on receiver side
const received = deserializeContract(EventEnvelopeSchema, payloadJson);
```

---

## 🧪 Testing

Run contract validation unit tests:

```bash
pnpm --filter @nexusos/contracts test
```
