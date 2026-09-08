# NexusOS Architecture Index

This document provides a comprehensive architectural map of the NexusOS multi-plane platform as established across Sprint 0 Milestones M0 through M7.

---

## 1. Multi-Plane System Overview

NexusOS divides responsibility across four strictly isolated architectural planes:

```
┌─────────────────────────────────────────────────────────────┐
│                      EXPERIENCE PLANE                       │
│      Tray UI Host (apps/desktop-agent) / Dashboard API      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WSS / IPC
┌──────────────────────────────▼──────────────────────────────┐
│                       CONTROL PLANE                         │
│  services/backend       services/identity   services/orch   │
│  (API Gateway, DB)      (JWT/Auth, RBAC)    (Task FSM)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ ACP (Agent Control Protocol)
┌──────────────────────────────▼──────────────────────────────┐
│                    DEVICE EXECUTION PLANE                   │
│   apps/desktop-agent (Process Supervisor, Local Vault)       │
│   Runtimes: Terminal, Filesystem, Browser, Device, State    │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC / Pipe
┌──────────────────────────────▼──────────────────────────────┐
│                      AI RUNTIME PLANE                       │
│    runtimes/local-ai (Model Router, Context Manager)        │
│    Local Engines (ONNX, Llama) & Cloud Fallback Gateway     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Plane Responsibilities & Boundaries

### 2.1 Control Plane

- **`services/backend`**: Hosts the public HTTP API gateway, Express server, database boundary (`DatabaseBoundary`), migration runners, and standard health endpoints (`/health/liveness`, `/health/readiness`).
- **`services/identity`**: Enforces zero-trust authentication via cryptographic JWT tokens, provides OIDC identity integration, and manages secret key precedence.
- **`services/orchestrator`**: Finite state machine governing task lifecycle (`PENDING` → `APPROVED` → `EXECUTING` → `COMPLETED` / `FAILED` / `CANCELLED`), lease timers, and event bus emissions.

### 2.2 Device Execution Plane

- **`apps/desktop-agent`**: Windows client daemon supervising local worker runtimes.
  - **Process Supervisor**: Monitors worker health and enforces resource quotas.
  - **Local Vault**: Enforces encrypted secret leases and token masking (`StructuredLoggerRedaction`).
  - **Execution Runtimes**: Isolated runtimes for filesystem, terminal, clipboard, browser, and OS device integration.
  - **State Manager**: Atomic encrypted local storage (AES-256-GCM) with automated LKG rollback.

### 2.3 AI Runtime Plane

- **`runtimes/local-ai`**: Local inference router managing model execution graphs, context windows, prompt safety checks, and provider circuit breakers.

### 2.4 Contracts Layer

- **`packages/contracts`**: Single source of truth for Zod schemas, TypeScript types, ACP envelopes, event structures, and error codes (`NexusError`). Pure library with zero external runtime dependencies.

---

## 3. Core Architectural Invariants

1. **Policy-Gated Execution:** No task capability may execute on the device without cryptographic lease evaluation and policy approval from the control plane.
2. **Datastore Isolation:** Services own their persistent state exclusively. Direct cross-service database access or foreign-key coupling across service boundaries is strictly prohibited.
3. **Secret Masking:** Raw tokens, API keys, and sensitive prompts must be redacted by logging middleware before emitting to disk or telemetry.
4. **Resilient Rollback:** State mutations and binary updates must support Last Known Good (LKG) fallback to guarantee recovery from power loss or regression.

---

## 4. Key Specifications & Architectural References

- 📐 **[Architecture Bible](Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)**: Foundational platform rules and invariants.
- 📜 **[API Contract Specification](Architecture_and_Specs/NexusOS_API_Contract_Specification_Section_1_System_Communication_Map.md)**: Endpoints, protocols, and envelopes.
- 🤖 **[AI Runtime EDD](EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md)**: AI execution architecture.
- ⚙️ **[Backend EDD](EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md)**: Control plane service architecture.
- 💻 **[Desktop Agent EDD](EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md)**: Windows client architecture.
- 🌐 **[Experience Platform EDD](EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md)**: Experience layer specifications.
