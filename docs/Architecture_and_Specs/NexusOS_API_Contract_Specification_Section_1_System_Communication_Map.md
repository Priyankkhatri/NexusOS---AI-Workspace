# NexusOS API Contract Specification

> This document is the official, exclusive, authoritative contract reference defining all cross-service, in-process, and inter-device communication formats in NexusOS. It *must* be interpreted as subordinate to, and compatible with, the architecture, platform boundaries, engineering practices, trust models, and interface contracts frozen in the latest: Enterprise PRD v3, Architecture Bible, Desktop Agent EDD, Backend EDD, AI Runtime EDD, and Experience Platform EDD. Where ambiguity remains, the document is to be extended.

> No schema, event, or contract outside this document is permitted for communication inside NexusOS or with supported extensions. No contract in this document may contradict required architecture or ADRs. No implementation code is to be generated.

## Objective

Define every communication contract in NexusOS. No private, ad-hoc, or undocumented communication is permitted. After reading, no engineer is permitted to invent, omit, or modify any field, error, behavior, or format not explicit in this contract.

---

# Section 1: System Communication Map

## 1.1 Purpose

To provide an exact, unambiguous, complete map (visual and tabular) of every communication channel, architectural ownership, and data exchange in the entire NexusOS platform. This establishes the authoritative boundary for every subsequent schema, protocol, and event definition.

## 1.2 Ownership and Scope

**Owner:** Platform Architecture Team, NexusOS Core Engineering.  

**Consumers:** All NexusOS subsystem engineers, security, QA, product management, DevOps, approved plugin/extension developers.  

**Version:** Contract v1.0 (Bound to PRD v3, Architecture Bible, and EDDs \[see revision history\]).

## 1.3 High-Level System Communication Diagram

```
flowchart TB
    USER\[User/Operator\]
    UI_DASHBOARD\[Web Dashboard\]
    DESKTOP_AGENT\[Windows Desktop Agent\]
    EXP_PLATFORM\[Experience Platform API\]
    API_GATEWAY\[API Gateway\]
    DEVICE_GATEWAY\[Device Gateway\]
    AUTH\[Identity & Auth Service\]
    TASK_SERVICE\[Task Service\]
    ORCHESTRATOR\[Orchestrator\]
    AI_RUNTIME\[AI Runtime\]
    POLICY\[Policy/Permission Engine\]
    REGISTRY\[Marketplace/Plugin Registry\]
    MEMORY\[Memory Service\]
    ARTIFACTS\[Artifact/Snapshot Service\]
    NOTIF\[Notification Service\]
    AUDIT\[Audit Service\]
    SEARCH\[Search Service\]
    ANALYTICS\[Analytics Service\]
    MODEL_ROUTER\[Model Router\]
    MODEL_PROVIDERS\[Model Providers\]
    PLUGIN_RUNTIME\[Plugin Host Runtime\]
    MCP_SERVERS\[MCP/External Plugins\]
    EXTERNAL_PROVIDERS\[External APIs/Clouds\]
    VAULT\[Secrets Vault/KMS\]
    STORAGE\[Encrypted Object Store\]
    EVENT_BUS\[Event Bus\]

    %% User entry points
    USER -->|Browser| UI_DASHBOARD
    USER -->|Windows App| DESKTOP_AGENT

    %% Dashboard/Experience plane
    UI_DASHBOARD -- API/WebSocket --> EXP_PLATFORM
    EXP_PLATFORM -- HTTP/gRPC WS --> API_GATEWAY

    %% Desktop Agent
    DESKTOP_AGENT -- mTLS ACP Stream --> DEVICE_GATEWAY
    DEVICE_GATEWAY -- Event, Lease, Health, Policy --> DESKTOP_AGENT
    DEVICE_GATEWAY -- Events/Broadcasts --> EVENT_BUS

    %% API Gateway
    API_GATEWAY -- REST/GraphQL/WS --> {AUTH, TASK_SERVICE, REGISTRY, SEARCH, MEMORY, ARTIFACTS, NOTIF, AUDIT, ANALYTICS, ORCHESTRATOR, POLICY}

    API_GATEWAY -- Real-time -> EVENT_BUS
    EVENT_BUS -- Subscribed/Published -> {UI_DASHBOARD, ANALYTICS, NOTIF, AUDIT, ARTIFACTS, ORCHESTRATOR}

    %% AI Runtime owned comms
    ORCHESTRATOR -- Plan, Leases -> AI_RUNTIME
    AI_RUNTIME -- Graph, Recommendations, Recovery -> ORCHESTRATOR
    AI_RUNTIME -- Capability, Plan, Model Requests -> MODEL_ROUTER
    MODEL_ROUTER -- Adapter API, Health, Fallback -> MODEL_PROVIDERS

    %% Marketplace / Plugin / MCP
    REGISTRY -- Manifest, Lifecycle, Entitlement APIs -> API_GATEWAY
    REGISTRY -- Discovery, SBOM, Capabilities, Update --> PLUGIN_RUNTIME
    PLUGIN_RUNTIME <--> {DESKTOP_AGENT, BACKEND, REGISTRY}
    PLUGIN_RUNTIME -- MCP Protocols --> MCP_SERVERS
    MCP_SERVERS -- Adapters/Capability Protocols --> EXTERNAL_PROVIDERS

    %% Policy, Auth, Vault, Storage
    POLICY -- Decision APIs/Events --> {API_GATEWAY, ORCHESTRATOR, TASK_SERVICE, REGISTRY, MEMORY}
    VAULT -- Secret Lease APIs --> {DESKTOP_AGENT, API_GATEWAY, PLUGIN_RUNTIME}

    %% Storage/API
    ARTIFACTS -- Object APIs/Access -> STORAGE
    MEMORY -- Context/Evidence/Recall -> ARTIFACTS
    AUDIT -- Immutability/Export APIs -> STORAGE
    ANALYTICS -- Batch Export APIs -> STORAGE

    %% Notification
    NOTIF -- Notify APIs -> {DESKTOP_AGENT, UI_DASHBOARD, API_GATEWAY}

    %% Identity 
    AUTH -- Auth, OIDC, JWT, SSO APIs -> {UI_DASHBOARD, API_GATEWAY, DEVICE_GATEWAY, PLUGIN_RUNTIME}

    %% Search
    SEARCH -- Hybrid Query/APIs -> MEMORY

    %% Analytics
    ANALYTICS -- Metrics APIs/Events -> API_GATEWAY

    %% All relevant contracts must be defined in this document and the mapping above is canonical. Any addition or change requires an ADR and contract/version allocation.

```

See the visual flow diagram above. No private, side channel, or ambiguous communication is permitted. Every line above corresponds to a documented contract to be defined in the following sections.

**Channel Key**

* REST: HTTPS/RESTful API
* WS: WebSocket/Server-Sent Events channel (authenticated, cursor-based)
* mTLS ACP: Mutual TLS, Agent Communication Protocol stream
* gRPC WS: Structured binary channel used for streaming events/data in select control-plane contexts
* Event Bus: Durable eventing pipeline (at-least-once delivery, topic/partitioned, canonical ordering)
* Manifest/Plugin/MCP Protocols: Typed, versioned contract-driven registration and execution channels
* OAuth/OIDC/SAML: Standards-based identity protocols; see Authentication Contracts section

## 1.4 Trust Boundaries (per Architecture Bible)

* **Dashboard/Experience Plane:** Untrusted client; all authority, permission, policy, and identity enforced server-side (Backend/Control Plane).
* **Desktop Agent:** Authenticated; must not be trusted beyond signed/expiring lease and device identity; never authority source for broader identity/policy/mutation without Backend event.
* **Plugin/MCP/External Provider:** Explicitly untrusted perimeter; strong signature, manifest, sandbox, evidence, and contract boundaries.
* **Model Provider:** Policy-eligible, data-minimized channel with no ambient trust; bounded prompts, egress, and provenance only.
* **Event Bus:** Canonical durability, ordering, and audit evidence; never used as a blind command channel.

## 1.5 Table: Major System Interactions

| Producer | Consumer | Contract Location | Path/Protocol | Auth | Evented | Streaming | Partitioned | Durable | Audit? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | API Gateway | REST, WS | /api/..., /ws/... | OAuth2/OIDC | Y | Y | N | N | Y |
| API Gateway | Backend Services | REST | /v1/... | JWT, OIDC | Y | Y | Y | Y | Y |
| Desktop Agent | Device Gateway | mTLS ACP | device-gateway | Device JWT/mTLS | Y | Y | N | Y | Y |
| Device Gateway | Event Bus | Event API | event-bus | mTLS | Y | N | Y | Y | Y |
| Orchestrator | AI Runtime | Internal API | API/gRPC | JWT, Internal Key | N | Y | N | Y | Y |
| AI Runtime | Model Router | Internal API | API/gRPC | JWT, Internal Key | N | Y | N | Y | Y |
| Model Router | Model Providers | Adapter Protocol | HTTPS/gRPC/local | Provider Key | N | Y | Y | N | Y |
| Memory | Artifact Service | REST | /v1/artifacts | JWT, OIDC | Y | N | N | Y | Y |
| Backend | Plugin Runtime | REST, Manifest | /v1/plugins... | JWT | Y | N | N | N | Y |
| Plugin Runtime | MCP Servers | MCP Protocol | plugin-host | Registration Token | Y | Y | Y | Partial | Partial |
| Experience API | Notification Service | REST | /v1/notifications | JWT | Y | N | N | Y | Y |
| Policy | Backend | Internal Event API | event-bus | JWT | Y | N | Y | Y | Y |
| Storage | All Services | S3/API | /v1/objects | Service Token | Y | N | N | Y | Y |

## 1.6 Contract Evolution, Versioning, and Ownership

Every channel, protocol, and event in the diagram above must be backed by a contract definition in this document. Only the documented communication map is permitted; no "protocol invention" is admitted.

* *Contract Ownership:* Every contract is owned by its canonical domain service, as registered in the service catalog and Architecture Bible. Ownership is not transitive.
* *Contract Versioning:* All contracts must use explicit semantic versioning, path versioning, or schema IDs per section 15. Deprecation and migration are governed by ADR, and breaking changes require explicit sunset strategy.

---

**All further sections will define and enumerate the contracts referenced above, starting with REST API schemas in Section 2.**

## 1.7 Contract Registry

All communication contracts MUST be recorded in a global Contract Registry. Each registry entry shall include a unique Contract ID, canonical owning service or team, explicit per-contract semantic versioning, current lifecycle state, published lists of authorized producers and consumers, and explicit dependency mappings to other contracts. The registry is the authoritative source for contract discovery, ownership, and status.

## 1.8 Data Classification

Every contract definition MUST include machine-readable data classification metadata that contains: sensitivity label (e.g., PUBLIC, INTERNAL, CONFIDENTIAL, SECRET), encryption-at-rest and encryption-in-transit requirements, retention policy (purpose, retention duration, and deletion rules), and audit logging requirements (audit event shapes and retention). The Contract Registry SHALL store these fields and enforcement mechanisms (policy engines, runtime checks, and CI gates) MUST reference the registry values to enforce protection controls.

## 1.9 Communication SLOs

For each channel and contract referenced in the system communication map, the owning team MUST declare Service Level Objectives (SLOs) including: latency targets (p95/p99), availability or uptime targets, maximum payload and connection limits, throughput expectations (requests/sec or events/sec), and retry budgets/strategies. These SLOs MUST be recorded in the Contract Registry and used in capacity planning, monitoring, and incident response.

## 1.10 Contract Lifecycle

Contracts MUST advertise a single lifecycle stage chosen from: Draft, Experimental, Beta, Stable, Deprecated, Retired. Movement between stages MUST follow documented migration rules: Draft→Experimental (internal validation), Experimental→Beta (limited external adoption and monitoring), Beta→Stable (validated SLOs and compliance), Stable→Deprecated (announced deprecation window and migration plan), Deprecated→Retired (final removal after migration completion). The lifecycle state and migration plan SHALL be part of the registry entry and linked ADRs and migration timelines are required for any non-Draft transitions.

## 1.11 Dependency Graph

All contract dependencies MUST be declared in the registry and visualized within a central dependency graph. The graph SHALL capture direct and transitive dependencies, version constraints, and compatibility notes. Any proposed change or deprecation MUST trigger an automated impact analysis that enumerates affected consumers and producers, required migration work, and a risk assessment. Impact analysis results MUST be published with the change request and retained in registry history.

## 1.12 Contract Governance

Each contract MUST declare governance roles: Owner (primary accountable team), Reviewer (technical reviewer(s)), Approver (authorization for releases/major changes), and Deprecation Authority (entity that can approve deprecation/retirement). Changes to contracts MUST follow the documented change approval process, include ADR linkage for architectural decisions, and follow the release governance model that specifies versioning, change windows, and rollback procedures. Governance role assignments and approval artifacts SHALL be recorded in the registry.

## 1.13 Engineering Rule

No contract or communication channel MAY be introduced, published, or used in production without first obtaining a registry entry and satisfying governance requirements. Every active communication channel MUST have an assigned Contract ID. These rules SHALL be enforced by design (build-time and CI checks), runtime discovery (service registration and gateway validations), and periodic audits. Violations MUST be escalated to platform governance and remedied following the incident and remediation policies.

These subsections align with the architectural principles stated earlier in this document. They are mandatory governance capabilities: the Contract Registry, data classification, SLO registration, lifecycle management, dependency visualization and impact analysis, formal governance roles and processes, and enforced engineering rules. Together they form the authoritative enterprise communication governance model for NexusOS and are non-negotiable requirements for all engineering phases.

\[Continues in Section 2: REST API Specification...\]