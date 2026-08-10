# NexusOS Backend Services (`services/`)

This directory houses backend control plane microservices defined by the [Backend EDD](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md).

---

## ⚙️ Planned Control Plane Services (Phase 1+)

- `gateway/`: API Gateway handling authentication, rate limiting, routing, and correlation ID propagation.
- `orchestrator/`: Durable task orchestrator decomposing goals into task graphs and managing execution leases.
- `policy-engine/`: Server-side policy engine evaluating capabilities, permissions, and security constraints.
- `memory-service/`: Context management and vector memory service.
- `telemetry-service/`: Structured log aggregation, trace routing, and audit trail record persistence.
- `connector-registry/`: External service integration and connector credential registry.

---

## 🛑 Subsystem Status

> [!NOTE]
> Monorepo foundation scaffolding only. Product implementation will occur in Phase 1+.
