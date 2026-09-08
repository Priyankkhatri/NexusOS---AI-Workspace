# Operational Runbooks Index

This directory contains the authoritative operational runbooks for Nexus AI / NexusOS, established under Sprint 0 Milestone M7 (Blueprint Section 65).

Each runbook follows a strict 8-section incident response schema designed for rapid diagnosis, safe containment, reliable remediation, and post-incident verification.

---

## 1. Runbook Catalog & Incident Triage Matrix

| Runbook ID                                            | Title                                        | Failure Domain                                     | Severity                  | Owning Subsystem                          | Target Component                           |
| :---------------------------------------------------- | :------------------------------------------- | :------------------------------------------------- | :------------------------ | :---------------------------------------- | :----------------------------------------- |
| [RB-001](runbooks/RB-001-service-startup-failure.md)  | **Service Startup Failure**                  | Process Lifecycle, Port Conflicts & Configuration  | CRITICAL (P0) / HIGH (P1) | Platform Engineering / Core Runtime       | `ServiceLifecycleManager`, `ExpressServer` |
| [RB-002](runbooks/RB-002-database-failure.md)         | **Database Connection Failure & Corruption** | Persistence Layer, SQLite Locks & Connection Pools | CRITICAL (P0) / HIGH (P1) | Persistence Subsystem                     | `DatabaseBoundary`, `SQLiteConnection`     |
| [RB-003](runbooks/RB-003-event-bus-failure.md)        | **Event Bus Failure & IPC Disruption**       | IPC / ACP Channels & Event Propagation             | HIGH (P1)                 | Event Architecture                        | `EventBus`, `ChannelManager`, `IPCHost`    |
| [RB-004](runbooks/RB-004-desktop-disconnect.md)       | **Desktop Agent Disconnect & Crash**         | Desktop Daemon, Process Supervisor & Heartbeats    | HIGH (P1) / MEDIUM (P2)   | Client Architecture                       | `ProcessSupervisor`, `HeartbeatEmitter`    |
| [RB-005](runbooks/RB-005-ai-runtime-failure.md)       | **AI Runtime Engine Failure**                | LLM Engine, Memory Pressure & Context Overflow     | HIGH (P1)                 | AI Engineering                            | `LocalLLMRuntime`, `ContextWindowManager`  |
| [RB-006](runbooks/RB-006-provider-outage.md)          | **Provider Outage & Rate Limiting**          | External AI APIs, Circuit Breakers & Failover      | MEDIUM (P2) / LOW (P3)    | AI Gateway / Integrations                 | `CircuitBreaker`, `ProviderFallbackRouter` |
| [RB-007](runbooks/RB-007-failed-migration.md)         | **Failed Schema Migration**                  | Schema Migrations & Persistent State Transitions   | HIGH (P1)                 | Control-Plane Persistence & Desktop State | `DatabaseBoundary`, `StateManager`         |
| [RB-008](runbooks/RB-008-certificate-secret-issue.md) | **Certificate & Secret Issues**              | Security Credentials, Token Expiry & Vault Refs    | HIGH (P1)                 | Identity & Access, Local Vault            | `JwtValidator`, `LocalVaultUpdateHost`     |
| [RB-009](runbooks/RB-009-deployment-rollback.md)      | **Deployment Rollback**                      | Deployment Regressions & Staged Rollback           | CRITICAL (P0) / HIGH (P1) | Platform & Release Engineering            | `UpdateManager`, `ProcessSupervisor`       |
| [RB-010](runbooks/RB-010-corrupted-local-state.md)    | **Corrupted Local State**                    | Encrypted State, SQLite Persistence & Client Cache | MEDIUM (P2) / HIGH (P1)   | Desktop Agent State Management            | `StateManager`, `EncryptedStore`           |

---

## 2. Standard Incident Response Lifecycle

When an operational incident occurs, responders must follow this operational flow:

```
[ALERT / DETECTION]
        │
        ▼
[1. CONTAINMENT]  ──► Halt cascading failures, isolate nodes, freeze corrupting writes
        │
        ▼
[2. DIAGNOSIS]    ──► Run triage commands, inspect structured logs, check health probes
        │
        ▼
[3. REMEDIATION]  ──► Execute safe recovery actions (failover, restart, rollback)
        │
        ▼
[4. VERIFICATION] ──► Run automated test probes, verify HTTP 200 on /health/readiness
        │
        ▼
[5. EVIDENCE]     ──► Collect sanitized logs, metrics, timelines for post-mortem
```

---

## 3. Severity Levels & Escalation Criteria

- **P0 (CRITICAL):** Complete service outage, total control-plane unavailability, or active data corruption. Immediate containment and escalation to engineering leads within 15 minutes.
- **P1 (HIGH):** Degraded service operation, failed migrations, partial client disconnects, or authentication failures. Remediation target < 1 hour.
- **P2 (MEDIUM):** External provider degradation with active fallback, localized cache corruption, or elevated latency. Remediation target < 4 hours.
- **P3 (LOW):** Non-impacting transient errors, warnings, or cosmetic telemetry anomalies. Resolved in normal engineering flow.

---

## 4. Runbook Maintenance & Quality Standard

Each runbook in this repository MUST maintain the standard 8-part schema:

1. Symptoms & Impact
2. Detection & Observability
3. Immediate Containment
4. Diagnosis Procedures
5. Safe Actions, Recovery & Remediation
6. Verification After Recovery
7. Escalation & Rollback
8. Evidence Collection

Runbooks must reference **real commands, endpoints, and components** that exist in the codebase.
