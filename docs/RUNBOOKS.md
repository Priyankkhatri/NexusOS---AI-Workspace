# Operational Runbooks Index

This directory contains the authoritative operational runbooks for Nexus AI / NexusOS, established under Sprint 0 Milestone M7 and expanded under Sprint 1 Milestone 11 (Blueprint Sections 52, 65).

Each runbook follows a strict 8-section incident response schema designed for rapid diagnosis, safe containment, reliable remediation, and post-incident verification.

---

## 1. Runbook Catalog & Incident Triage Matrix

### Sprint 0 Foundational Runbooks (RB-001 through RB-010)

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

### Sprint 1 Subsystem Runbooks (RB-011 through RB-020)

| Runbook ID                                                                   | Title                                                  | Failure Domain                                     | Severity                  | Owning Subsystem                           | Target Component                            |
| :--------------------------------------------------------------------------- | :----------------------------------------------------- | :------------------------------------------------- | :------------------------ | :----------------------------------------- | :------------------------------------------ |
| [RB-011](runbooks/RB-011-dag-workflow-failure.md)                            | **DAG Workflow Execution & Deadlock**                  | Multi-Step Workflow Graph Execution & Topo Cycle   | HIGH (P1)                 | Control-Plane Task Subsystem               | `TaskController`, `WorkflowEngine`          |
| [RB-012](runbooks/RB-012-sandbox-filesystem-jail-violation.md)               | **Filesystem Sandbox Jail Violation**                  | Desktop Filesystem Sandbox & Path Traversal Jail   | CRITICAL (P0) / HIGH (P1) | Desktop Agent Filesystem Runtime           | `FilesystemSandboxRuntime`, `PathValidator` |
| [RB-013](runbooks/RB-013-local-ai-engine-hardware-fault.md)                  | **Local AI Engine Hardware & Inference Fault**         | Local AI Model Inference, VRAM & Fallback Router   | HIGH (P1) / MEDIUM (P2)   | AI Runtime Subsystem                       | `LocalAiModelRouter`, `ResourceGovernor`    |
| [RB-014](runbooks/RB-014-hitl-approval-timeout-ipc-loss.md)                  | **HITL Approval Timeout & Notification Loss**          | HITL Desktop Approval Interceptor & Desktop IPC    | HIGH (P1) / MEDIUM (P2)   | Desktop Agent UI & HITL Contracts          | `ApprovalInterceptor`, `NotificationHost`   |
| [RB-015](runbooks/RB-015-web-dashboard-stream-disconnection.md)              | **Web Dashboard Stream Disconnection & Telemetry Lag** | Web Dashboard Live Event Streaming & Telemetry     | MEDIUM (P2) / LOW (P3)    | Experience Platform & Backend Event Stream | `WebDashboardApp`, `EventStreamGateway`     |
| [RB-016](runbooks/RB-016-plugin-signature-quarantine-breach.md)              | **Plugin Signature Tampering & Quarantine**            | Plugin SDK Manifest Verification & Quarantine      | CRITICAL (P0) / HIGH (P1) | Plugin Framework & Runtime Host            | `PluginHost`, `PluginRegistry`              |
| [RB-017](runbooks/RB-017-browser-session-ssrf-interception-failure.md)       | **Browser Automation CDP Crash & SSRF Defense**        | Browser Automation Runtime & SSRF Interception     | HIGH (P1) / CRITICAL (P0) | Desktop Browser Runtime & Contracts        | `BrowserRuntime`, `SSRFInterceptor`         |
| [RB-018](runbooks/RB-018-governed-memory-poisoning-leakage.md)               | **Governed Memory Poisoning & Secret Leakage**         | Governed Persistent Memory, Delimiters & Redaction | CRITICAL (P0) / HIGH (P1) | Backend Memory Subsystem                   | `MemoryService`, `RedactionFilter`          |
| [RB-019](runbooks/RB-019-autonomous-decomposer-replan-exhaustion.md)         | **Goal Decomposer Ambiguity & Replan Exhaustion**      | Autonomous Goal Decomposer & Adaptive Replanner    | HIGH (P1) / MEDIUM (P2)   | Backend Planner Subsystem                  | `PlannerService`, `ReplanCoordinator`       |
| [RB-020](runbooks/RB-020-episodic-graph-cycle-forgetting-cascade-failure.md) | **Memory Graph Explosion & Forgetting Failure**        | Episodic Knowledge Graph & Atomic Forgetting       | HIGH (P1) / MEDIUM (P2)   | Backend Memory Subsystem & Graph Engine    | `GraphProjectionEngine`, `MemoryStore`      |

### Sprint 2 Subsystem Runbooks (RB-021 through RB-024)

| Runbook ID                                                       | Title                                                          | Failure Domain                                              | Severity                  | Owning Subsystem                     | Target Component                                    |
| :--------------------------------------------------------------- | :------------------------------------------------------------- | :---------------------------------------------------------- | :------------------------ | :----------------------------------- | :-------------------------------------------------- |
| [RB-021](runbooks/RB-021-multi-agent-delegation-failure.md)      | **Multi-Agent Delegation Failure & Cascade Cancellation**      | Autonomous Sub-Agent Delegation, Lease Revocation & Fan-Out | HIGH (P1)                 | Backend Agent Subsystem              | `DelegationCoordinator`, `AgentDirectoryService`    |
| [RB-022](runbooks/RB-022-native-ai-vram-exhaustion.md)           | **Native AI Engine VRAM Exhaustion & Hardware Fault**          | VRAM Exhaustion, CPU Fallback & Model Quarantine            | HIGH (P1)                 | Desktop Agent Local-AI Runtime       | `VramOffloader`, `HardwareDetector`, `ModelRuntime` |
| [RB-023](runbooks/RB-023-sqlite-memory-corruption.md)            | **SQLite Memory Store ACID Failure & Vector Index Corruption** | SQLite Persistence, WAL Recovery & VectorIndex Divergence   | CRITICAL (P0) / HIGH (P1) | Backend Memory Subsystem             | `SqliteMemoryStore`, `VectorIndex`                  |
| [RB-024](runbooks/RB-024-knowledge-graph-traversal-explosion.md) | **Knowledge Graph Traversal Explosion & Dashboard Disruption** | Graph Traversal Bounds, Cycle Handling & Dashboard Feed     | HIGH (P1)                 | Backend Graph Engine & Web Dashboard | `GraphProjectionEngine`, `DashboardAPIClient`       |

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
