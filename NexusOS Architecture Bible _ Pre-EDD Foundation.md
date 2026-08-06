# NexusOS Architecture Bible — Pre-EDD Foundation

## Document Control

| Field | Value |
| --- | --- |
| Status | Foundational architecture standard |
| Authority | Architecture source of truth for Engineering Design Documents (EDDs) |
| Product source | NexusOS Enterprise PRD, Version 3 |
| Scope | Engineering architecture, contracts, boundaries, quality attributes, and evolution rules |
| Non-scope | Product requirements, user experience specification, implementation code, delivery plans |
| Primary execution plane | Windows-first desktop agent |
| Primary control plane | Cloud control plane with future private and self-hosted deployment modes |
| Change control | Architectural changes require an accepted ADR |

## How to Use This Document

This is the parent architecture for NexusOS. Every EDD must:

1. Reference this document and the applicable ADRs.
2. Reuse the contracts, trust boundaries, ownership rules, and invariants herein.
3. Identify any conflict explicitly.
4. Propose an ADR before changing a normative decision.
5. Avoid redefining product behavior already defined by the PRD.

Normative terms: MUST and MUST NOT are mandatory; SHOULD is expected unless an ADR records an exception; MAY is optional.

---

# 1\. System Philosophy

## 1.1 AI Operating System Philosophy

NexusOS is an AI operating system: a durable, policy-governed control plane that converts authorized intent into observable execution across local devices, cloud services, models, agents, connectors, plugins, and human supervision surfaces.

It is not architected as a single chatbot, a monolithic automation engine, or a collection of direct SaaS integrations. Its defining engineering property is separation between intent, decisioning, policy, execution, state, and observation.

| Plane | Architectural responsibility | Must not own |
| --- | --- | --- |
| Experience plane | Present state, collect intent and approvals | Authorization truth or execution authority |
| Control plane | Plan, authorize, schedule, coordinate, recover | Direct privileged OS operations |
| Runtime plane | Execute bounded leases and emit evidence | Global policy definition |
| Data plane | Persist canonical state, artifacts, memory, audit | Business-process orchestration |
| Ecosystem plane | Register and govern extensions | Bypass paths around policy |

## 1.2 Core Principles

| Principle | Decision | Why it exists | Main trade-off | Extension strategy |
| --- | --- | --- | --- | --- |
| Modular architecture | Stable domain contracts and independently deployable modules | Limits blast radius and allows technology replacement | More interface and operational overhead | Extract modules only after contract maturity |
| Event driven | Domain events carry asynchronous state changes | Supports durable workflows, replay, observability and loose coupling | Eventual consistency | Versioned schemas and replay-safe projections |
| Replaceability | Providers, models, runtimes, transports and stores use adapters | Avoids lock-in and supports changing AI ecosystem | Adapter maintenance cost | Capability registries and compatibility suites |
| High cohesion | Each service owns a narrow domain and its data | Preserves correctness and accountability | Cross-domain flows need orchestration | Explicit APIs/events only |
| Loose coupling | No direct cross-service datastore writes | Enables safe independent evolution | More integration work | Contract testing and anti-corruption layers |
| Fault isolation | Failures are contained by process, service, queue, tenant and capability boundaries | Automation failures must not become platform failures | Duplicate controls and fallbacks | Circuit breakers and bulkheads by default |
| Least privilege | All execution is capability-scoped, conditional and revocable | Agent behavior cannot be trusted as a security boundary | Additional approval and policy complexity | Extend scopes, not blanket permissions |
| Human override | Humans can pause, replace, fork, rollback and stop graph execution | Maintains control over autonomous systems | Requires immutable graph versioning | Override engine remains policy-governed |
| Offline first | Local runtime remains useful under explicit offline leases | Devices and networks are unreliable | Reconciliation complexity | Offline eligibility is a contract attribute |
| Backward compatibility | Contracts evolve additively and readers tolerate prior versions | Multi-year agent, plugin and enterprise support | Slower removal of legacy forms | Sunset through version windows and migrations |

## 1.3 Architectural Invariants

1. The policy engine, not a model, is the final authority on tool invocation.
2. Every externally observable mutation has an immutable audit record and correlation ID.
3. Every command is idempotent or has a reconciliation procedure before retry.
4. Sensitive data is referenced, access-controlled, and redacted; it is not copied into broad event payloads or prompts by default.
5. Every extension runs through a manifest, capability contract, policy evaluation, and observable lifecycle.
6. Every runtime action executes under a signed, expiring lease tied to a policy snapshot.
7. Every service owns its data; other services interact through APIs, commands, and events.
8. Every destructive or high-risk action has a compensation, snapshot, or explicit irreversibility declaration.
9. A disconnected device MUST NOT infer fresh authority for high-risk or remote mutations.
10. A UI client is never trusted to enforce authorization.

## 1.4 Trust Model

```
flowchart LR
  U\[Human / Administrator\] --> XP\[Experience Plane\]
  XP --> CP\[Cloud Control Plane\]
  CP --> PE\[Policy Decision + Enforcement\]
  CP --> DG\[Device Gateway\]
  DG --> DA\[Desktop Agent\]
  DA --> SR\[Sandboxed Tool Runner\]
  SR --> EX\[External Systems\]
  CP --> MP\[Model Provider Boundary\]
  CP --> EP\[Plugin / MCP Boundary\]

```

`classDef trusted fill:#dff0d8,stroke:#357a38;`  

`classDef untrusted fill:#f8d7da,stroke:#9d2525;`  

`class CP,PE,DG trusted;`  

`class EX,MP,EP untrusted;`  

Trust is contextual, not binary. The cloud control plane is trusted to enforce NexusOS policy, but each service still receives a narrowly scoped workload identity. The device is independently authenticated but treated as a potentially compromised execution environment. External content, model output, plugin output, and MCP output are untrusted data.

## 1.5 Decision Record: Modular Event-Driven Control Plane

| Field | Decision |
| --- | --- |
| Why | NexusOS coordinates long-lived, distributed, policy-sensitive work across unreliable networks and replaceable execution providers. |
| Alternatives | Monolithic application; synchronous request chain; direct agent-to-tool automation. |
| Decision | Domain-oriented modular architecture with durable commands, events, and leased execution. |
| Trade-offs | Operational complexity, schema governance, eventual consistency. |
| Scalability | Independently scale gateways, workers, event consumers, storage and runtimes. |
| Risks | Event duplication, schema drift, debugging complexity. |
| Mitigation | Idempotency, schema registry, trace propagation, replay tests. |
| Extension | New capabilities integrate through registries, events and adapters rather than privileged core changes. |

---

# 2\. Repository Structure

## 2.1 Repository Strategy

NexusOS SHOULD begin as a governed monorepo with logical ownership boundaries. The desktop agent, shared protocols, web clients, backend services, SDKs, deployment definitions, test harnesses, and architecture artifacts change together frequently during foundational development. A monorepo gives atomic contract changes, uniform security controls, shared code visibility, and reproducible integration testing.

Polyrepos MAY be introduced only when a component has an independent external release cadence, distinct access boundary, materially different build requirements, or mature contract stability.

| Option | Advantages | Disadvantages | Decision |
| --- | --- | --- | --- |
| Monorepo | Atomic changes, unified policy, shared tooling, easy refactors | Larger CI and stricter ownership needs | Recommended foundation |
| Polyrepo | Independent release and access boundaries | Version drift, integration complexity, duplicated tooling | Future exception |
| Hybrid | Separates external SDKs or sensitive infrastructure | Requires strong dependency governance | Allowed with ADR |

## 2.2 Ownership Model

Each directory has a named owning team, technical steward, CODEOWNERS policy, service catalog entry, threat model link, runbook link, and on-call classification.

| Domain | Owner | Primary artifact |
| --- | --- | --- |
| contracts | Platform Architecture | Versioned API, ACP and event schemas |
| control-plane | Orchestration Platform | Workflow, policy integration, leasing |
| device-runtime | Desktop Runtime | Windows agent and local runners |
| data-plane | Data Platform | Canonical stores, retention, retrieval |
| ecosystem | Extensibility Platform | Plugin/MCP/Skill registries and sandbox manager |
| experience | Product Engineering | Web, mobile supervision, IDE surfaces |
| security | Security Engineering | Identity, secrets, policy, supply-chain controls |
| platform | SRE / Developer Productivity | Infrastructure, observability, release tooling |

## 2.3 Folder Hierarchy

```
nexusos/
docs/
architecture/
architecture-bible.md
adrs/
threat-models/
contracts/
packages/
contracts/
api/
events/
acp/
capability-manifests/
sdk/
plugin-sdk/
agent-sdk/
workflow-sdk/
shared/
identity/
policy-types/
observability/
apps/
web-dashboard/
desktop-agent/
mobile-companion/
cli/
services/
api-gateway/
identity/
device-gateway/
task-service/
orchestrator/
policy/
memory/
artifact/
activity/
notifications/
connector-registry/
marketplace/
model-router/
benchmark/
snapshot/
override/
scheduler/
runtimes/
agent-runtime/
plugin-host/
browser-runtime/
local-model-runtime/
tool-runners/
infrastructure/
environments/
modules/
policies/
observability/
tests/
contract/
integration/
e2e/
security/
chaos/
fixtures/
tools/
build/
generators/
local-emulator/
```

## 2.4 Dependency Rules

1. `contracts` has no dependency on applications, services, or runtime implementations.
2. Applications depend on SDKs and contracts, never service internals.
3. Services may depend on contracts and approved shared libraries, never another service database module.
4. Runtimes consume signed contracts and SDKs; they do not import control-plane domain code.
5. Shared packages MUST remain small, stable, dependency-light, and free of hidden network behavior.
6. Circular dependencies are release-blocking defects.

## 2.5 Versioning

* Public APIs, event schemas, ACP schemas, plugin manifests, and SDKs use semantic versioning.
* APIs use explicit major path versioning.
* Events use stable event names and additive schema evolution.
* Desktop agent and service compatibility use a published support matrix.
* Breaking changes require migration tooling, compatibility period, telemetry proving adoption, and an ADR.

---

# 3\. High-Level System Architecture

## 3.1 Logical Component Diagram

```
flowchart TB
WEB\[Web Dashboard\] --> API\[API Gateway\]
MOBILE\[Mobile Supervision\] --> API
IDE\[IDE Adapter\] --> DA
DA\[Windows Desktop Agent\] <-->|mTLS persistent channel| DG\[Device Gateway\]
API --> ID\[Identity Service\]
API --> TS\[Task Service\]
API --> AS\[Activity Service\]
API --> REG\[Connector + Marketplace Registry\]
TS --> ORCH\[Orchestrator\]
ORCH --> POL\[Policy + Permission Engine\]
ORCH --> MR\[Model Router\]
ORCH --> MEM\[Memory Engine\]
ORCH --> SCH\[Scheduler\]
ORCH --> OVR\[Human Override Engine\]
ORCH --> BUS\[(Durable Event Bus)\]
BUS --> WORK\[Cloud Worker Pools\]
BUS --> NOTIF\[Notification Service\]
BUS --> TEL\[Telemetry Pipeline\]
DA --> AR\[Agent Runtime\]
AR --> PR\[Plugin Sandbox Manager\]
AR --> BR\[Browser Runtime\]
AR --> LMR\[Local Model Runtime\]
AR --> TR\[File / Terminal / App Tool Runners\]
PR --> MCP\[MCP Servers / Plugins\]
MR --> CLOUD\[Cloud Model Providers\]
LMR --> LOCAL\[Ollama / LM Studio / llama.cpp / ONNX\]
MEM --> RDB\[(Transactional Store)\]
MEM --> VDB\[(Vector + Search Index)\]
AS --> ELOG\[(Immutable Event / Audit Store)\]
ORCH --> ART\[Artifact + Snapshot Service\]
ART --> OBJ\[(Encrypted Object Storage)\]
REG --> VAULT\[Secrets Vault\]
WORK --> EXT\[External APIs\]
```

## 3.2 Failure Boundaries

| Boundary | Failure containment | Required behavior |
| --- | --- | --- |
| Web client | Presentation failure | Reconnect and rehydrate from server state |
| API gateway | Edge overload or malicious input | Rate limit, validate, reject, preserve backend capacity |
| Control-plane service | Service-specific failure | Circuit break, queue commands, degrade nonessential projections |
| Event bus | Delayed event propagation | Durable retention, consumer recovery, replay |
| Device gateway | Device channel failure | Lease expiry, local spool, reconnect and reconcile |
| Desktop agent | Process or host failure | Crash recovery, signed restart, task reconciliation |
| Tool/plugin host | Untrusted execution failure | Kill/suspend host, preserve evidence, prevent privilege escalation |
| Model provider | Quality/availability failure | Policy-compatible fallback or safe pause |
| External API | Rate limit or ambiguity | Reconcile receipt before retry |

## 3.3 Deployment Boundary Principles

The control plane does not execute arbitrary desktop commands. The desktop agent does not become a source of global policy truth. Plugins do not receive ambient credentials. Models do not directly invoke privileged tools. These separations are non-negotiable security and maintainability boundaries.

---

# 4\. Core Services

## 4.1 Service Catalog

| Service | Owns | Interfaces | Dependencies | Scaling and lifecycle |
| --- | --- | --- | --- | --- |
| Identity | identities, sessions, org membership | OIDC/OAuth, identity events | KMS, directory adapters | Horizontally scalable; strongly consistent mutations |
| API Gateway | API edge policy and request routing | REST, GraphQL, WebSocket/SSE | Identity, rate limits | Stateless, multi-zone |
| Device Gateway | device connections, command delivery state | mTLS stream, device events | Identity, policy, bus | Connection-sharded; graceful drain |
| Task Service | task metadata and state machine | task APIs, task events | DB, bus, policy | Partition by workspace/task |
| Orchestrator | graph versions, dispatch decisions | commands, ACP, orchestration events | policy, memory, router, queue | Worker-sharded by workflow |
| Policy Engine | decisions, policy versions, grants | decision API, decision events | identity, registry | Low latency, cached signed bundles |
| Permission Engine | grants, approvals, revocation | grant/approval APIs | policy, audit | Strong audit and revocation semantics |
| Event Bus | durable event transport | publish/subscribe/replay | schema registry | Partitioned, retained, monitored |
| Scheduler | schedules and delayed work | schedule commands/events | task service, bus | Sharded timers, idempotent firing |
| Memory Engine | memory objects, retrieval, forgetting | retrieval and ingestion APIs | indexes, policy, artifacts | Split ingestion/query workloads |
| Model Router | provider selection and invocation policy | model request/reply | benchmark, budget, vault | Stateless routing, provider bulkheads |
| Benchmark Engine | capability profiles and evaluations | score APIs/events | artifact store | Batch-oriented, versioned outputs |
| Plugin Runtime | plugin lifecycle and isolation | plugin host protocol | registry, policy, vault | Per-plugin/process resource limits |
| Browser Runtime | browser sessions and action receipts | browser capability API | policy, artifacts | Isolated per session/task |
| Artifact Service | immutable artifacts and access grants | upload/download refs | object store, KMS | Horizontally scalable metadata |
| Snapshot Service | snapshot manifests, restore plans | snapshot commands/events | artifacts, device runtime | Async workers and retention policies |
| Notification Service | delivery attempts/preferences | notification commands/events | providers, activity | Provider-specific queues |
| Telemetry Service | metrics/logs/traces ingestion | OTLP/events | storage and alerting | High-throughput sampling pipeline |
| Configuration Service | typed config and rollout state | config reads/events | policy, secrets | Versioned immutable releases |
| Updater | agent release channels and rollout state | update manifest protocol | signing, telemetry | staged cohorts and rollback |
| Secrets Vault | credential material and leases | secret reference/lease API | KMS/HSM | isolated, audited, rotation-capable |

## 4.2 Service Boundary Rules

* A service may write only its owned canonical datastore.
* Reads of another service's canonical state use an API, replicated projection, or event-derived read model.
* Cross-service workflows use orchestration and sagas, not distributed transactions.
* Every service provides health, readiness, dependency status, metrics, traces, structured logs, and a runbook.
* Every service must define overload behavior, retry policy, data classification, retention, and disaster recovery tier.

## 4.3 Lifecycle Standard

```
stateDiagram-v2
\[\] --> Provisioned
Provisioned --> Healthy: readiness checks pass
Healthy --> Degraded: dependency or SLO breach
Degraded --> Healthy: recovery
Degraded --> Draining: controlled shutdown / deploy
Healthy --> Draining
Draining --> Stopped: in-flight work transferred or checkpointed
Stopped --> Provisioned

```

---

# *5. AI Runtime*

## *5.1 Runtime Layers*

```
flowchart TB
GOAL\[Authorized Goal\] --> CB\[Context Builder\]
CB --> PLAN\[Planner\]
PLAN --> EG\[Versioned Execution Graph\]
EG --> DE\[Decision Engine\]
DE --> CE\[Capability Engine\]
CE --> PE\[Policy Evaluation\]
PE --> MR\[Model Router\]
MR --> AR\[Agent Runtime\]
AR --> TOOLS\[Tool / Agent Delegation\]
TOOLS --> OBS\[Evidence + Events\]
OBS --> RE\[Reflection + Critic\]
RE --> EG
OBS --> FR\[Retry + Failure Recovery\]
FR --> EG

```

## *5.2 Responsibilities and Contracts*

| Component | Responsibility | Contract output | Non-responsibility |
| --- | --- | --- | --- |
| Context Builder | Assemble minimal policy-permitted context | cited context bundle | Broad data retrieval without purpose |
| Planner | Produce constrained graph alternatives | graph draft and assumptions | Policy approval |
| Execution Graph | Immutable plan versions and node state | graph manifest | Direct tool execution |
| Decision Engine | Resolve runtime choices within policy | decision receipt | Override authority |
| Capability Engine | Match steps to approved agents/tools | capability binding | Grant issuance |
| Agent Runtime | Execute a leased step | evidence bundle and status | Global orchestration |
| Reflection Engine | Compare expected versus observed outcomes | findings/replan request | Silent permission expansion |
| Retry Engine | Classify retries and backoff | retry schedule | Repeat unknown mutations |
| Failure Recovery | Reconcile, compensate, escalate | recovery plan | Conceal failure |
| Task Optimizer | Reduce cost/latency under quality constraints | alternative strategy | Change user objective |
| Budget Engine | Reserve and enforce token/time/tool budgets | budget decision | Override policy |
| Benchmark Engine | Supply versioned quality/capability signals | score profile | Production routing alone |

## *5.3 Execution Graph Standard*

*A graph node MUST include: stable node ID, graph version, objective, input references, output contract, risk tier, capability requirements, lease constraints, timeout, idempotency key, retry policy, approval checkpoint, budget, expected evidence, compensation strategy, and trace context.*

*Graphs are append-only versions. A human override, replan, or runtime recovery produces a new graph version linked to its predecessor.*

## *5.4 Agent Lease Sequence*

```
sequenceDiagram
participant O as Orchestrator
participant P as Policy Engine
participant D as Device Gateway
participant A as Agent Runtime
participant T as Tool Runner
participant E as Event Bus
O->>P: evaluate step and current grants
P-->>O: permit + policy snapshot hash
O->>D: issue signed expiring lease
D->>A: deliver lease
A->>A: validate signature, target, expiry, local policy
A->>T: invoke scoped capability
T-->>A: receipt + artifacts
A->>E: emit progress and evidence events
A-->>O: terminal step outcome

```

## *5.5 AI Runtime Decisions*

| Decision | Alternatives | Trade-off | Future scalability | Risk and mitigation |
| --- | --- | --- | --- | --- |
| Graph-based orchestration | Linear chains; free-running agent loops | More state management | Parallelism, retries, handoffs, overrides | Graph complexity; immutable versioning and tooling |
| Capability matching | Hardcoded agent routing | Registry overhead | New agents/models/tools without core edits | Misclassification; policy and benchmark gates |
| Separate reflection | Single-pass completion | Added latency/cost | Quality gates for critical work | Loops; bounded attempts and budgets |
| Budget before execution | Post-hoc metering | Some false rejections | Enterprise cost governance | Estimate inaccuracy; reserve then reconcile |

---

# *6. Desktop Runtime*

## *6.1 Windows Process Architecture*

```
flowchart TB
UI\[Tray / Local UI Process\] --> IPC\[Authenticated Local IPC\]
SVC\[Agent Service / Background Process\] --> IPC
SVC --> CONN\[Cloud Connection Manager\]
SVC --> STATE\[Encrypted State Store\]
SVC --> PM\[Permission Manager\]
SVC --> PL\[Plugin Loader\]
SVC --> UPD\[Update Engine\]
SVC --> DIAG\[Diagnostics\]
SVC --> SUP\[Worker Supervisor\]
SUP --> FILE\[Filesystem Runner\]
SUP --> TERM\[Terminal Runner\]
SUP --> BROW\[Browser Runtime\]
SUP --> APP\[Application / IDE Adapter\]
SUP --> LMODEL\[Local Model Host\]
PL --> PS\[Sandboxed Plugin Hosts\]

```

## *6.2 Process and Thread Rules*

* *The privileged long-lived agent coordinator MUST NOT execute untrusted plugin logic in-process.*
* *Each tool runner is a supervised child process or constrained worker with explicit cancellation ownership.*
* *UI, updater, local model host, browser runtime, and plugin host have separate crash domains.*
* *CPU-intensive work uses bounded worker pools; UI and connection threads never block on model inference, filesystem scans, or process output.*
* *Local IPC authenticates caller identity and uses per-session authorization; it is not an unrestricted localhost API.*

## *6.3 Desktop Subsystems*

| Subsystem | Responsibilities | Failure behavior |
| --- | --- | --- |
| Connection Manager | mTLS channel, sequence ACKs, heartbeat, reconnect | encrypted spool and exponential reconnect |
| State Manager | leases, checkpoints, local event spool, settings | integrity validation before resume |
| Permission Manager | local enforcement of signed grants and OS consent | deny when policy stale or unverifiable |
| Filesystem Manager | path normalization, allowlists, snapshots, safe mutations | block escape/symlink ambiguity; emit evidence |
| Terminal Manager | process tree ownership, environment shaping, output redaction | terminate managed children on cancel |
| Browser Runtime | profile/session isolation, navigation/action receipts | pause on auth/MFA/ambiguous or disallowed action |
| Plugin Loader | manifest checks, lifecycle, host allocation | quarantine crash-looping plugin |
| Update Engine | signed manifests, staged install, rollback | revert on failed health check |
| Scheduler | local offline-eligible delayed work | no fresh authority after expiry |
| Diagnostics | health bundle, redaction, consented export | never upload secrets by default |

## *6.4 Crash Recovery*

*On start, the agent MUST:*

1. *Verify binary and configuration integrity.*
2. *Load encrypted checkpoint state.*
3. *Identify managed child processes and determine ownership safely.*
4. *Validate active lease expiration and policy snapshot compatibility.*
5. *Reconcile event sequence acknowledgements.*
6. *Resume only idempotent or explicitly resumable work.*
7. *Surface any ambiguous external mutation for reconciliation, not automatic repetition.*

## *6.5 Update Decision*

| Why | Alternatives | Trade-offs | Risks | Extension |
| --- | --- | --- | --- | --- |
| Signed staged updater with last-known-good rollback protects an always-on execution endpoint | Manual updates; forced updates; store-only updates | More release infrastructure | Failed migration, downgrade attacks | Multiple channels, enterprise freeze windows, offline packages |

---

# *7. Backend Architecture*

## *7.1 Request and Async Paths*

*Synchronous APIs are used for bounded reads, commands requiring immediate validation, and session establishment. Durable asynchronous commands are used for task execution, notifications, artifact processing, indexing, scheduling, evaluations, and reconciliation.*

```
flowchart LR
C\[Client\] --> G\[API Gateway\]
G --> A\[AuthN/AuthZ\]
A --> S\[Domain Service\]
S --> DB\[(Owned Store)\]
S --> O\[Outbox\]
O --> B\[(Event Bus)\]
B --> W\[Workers / Projections\]
W --> X\[External Provider\]
W --> R\[Result Event\]
R --> S

```

## *7.2 Gateway Standards*

* *Authenticate at the edge; authorize in the owning domain service.*
* *Enforce request size, schema, quotas, rate limits, idempotency, tenancy, and trace creation.*
* *Do not place domain workflow logic in the gateway.*
* *WebSocket/SSE connections are authenticated, workspace-filtered, resumable, and backpressure-aware.*

## *7.3 Persistence Pattern*

*Transactional domain changes and outgoing events use the transactional outbox pattern. Consumers are at-least-once and idempotent. Read models are rebuildable from canonical state and event replay.*

## *7.4 Cache Policy*

*Caches improve performance but never become the sole source of authorization, financial, task terminal-state, audit, or secret truth. Cache entries include tenant scope, version/etag, expiration, and explicit invalidation events.*

## *7.5 Scaling Strategy*

| Layer | Scale unit | Primary signal | Guardrail |
| --- | --- | --- | --- |
| API | request worker | latency, CPU, rate limit saturation | shedding and queue-free reads |
| Device Gateway | connection shard | concurrent sockets, outbound backlog | connection drain and affinity |
| Orchestrator | workflow partition | queue age, step duration | per-tenant concurrency ceilings |
| Workers | capability queue | backlog, provider latency | bounded retries and bulkheads |
| Memory query | query shard | search latency, index load | retrieval budgets and cache |
| Event bus | partition | lag, storage retention | partition key discipline |
| Artifact service | transfer worker | bandwidth, object latency | presigned scoped access |

---

# *8. Memory Engine*

## *8.1 Memory Taxonomy*

| Memory type | Canonical purpose | Retention posture | Retrieval eligibility |
| --- | --- | --- | --- |
| Working memory | Current step and task context | ephemeral | task only |
| Short memory | Recent task summaries and temporary context | time-bounded | workspace/task policy |
| Long memory | Durable approved facts and preferences | explicit policy and review | scoped by owner/workspace |
| Workspace memory | Shared project knowledge | workspace lifecycle | membership and classification |
| Conversation memory | Conversation-derived summary and citations | configurable | conversation/task scope |
| Semantic memory | Concepts, entities, relationships | provenance and confidence required | access-aware |
| Knowledge graph | Typed relationships and lineage | governed lifecycle | query policy constrained |

## *8.2 Logical Architecture*

```
flowchart TB
IN\[Ingestion Request\] --> CL\[Classification + Consent\]
CL --> EX\[Extraction + Provenance\]
EX --> CM\[Compression / Summarization\]
CM --> MS\[Memory Store\]
MS --> KI\[Keyword Index\]
MS --> VI\[Vector Index\]
MS --> KG\[Knowledge Graph\]
Q\[Context Request\] --> PA\[Policy Filter\]
PA --> HS\[Hybrid Search\]
HS --> RR\[Ranking + Reranking\]
RR --> CB\[Cited Context Bundle\]

```

## *8.3 Retrieval and Ranking*

*Hybrid ranking combines access eligibility, source authority, confidence, semantic similarity, lexical relevance, recency, task affinity, graph proximity, and duplication penalties. Policy filtering occurs before semantic retrieval output is exposed to a caller.*

## *8.4 Compression, Snapshots, Forgetting*

*Memory compression preserves: source references, factual claims, confidence, sensitivity labels, entity links, timestamps, and a lossiness classification. A summary never replaces immutable source provenance. Snapshots support audit and restore of memory state. Forgetting is implemented as immediate retrieval revocation followed by deletion propagation across indexes, caches, replicas, and backups according to retention policy.*

## *8.5 Decision Matrix*

| Decision | Alternatives | Chosen approach | Trade-off | Extension |
| --- | --- | --- | --- | --- |
| Search | Vector-only; keyword-only | Hybrid with graph signals | More infrastructure | Specialized indexes at scale |
| Writes | Fully automatic; fully manual | Policy-governed candidate and approved writes | Some friction | Confidence-calibrated automation |
| Scope | Global pool | owner/workspace/device scoped | Less accidental reuse | Federated enterprise retrieval |
| Storage | Prompt-only history | durable typed memory records | Lifecycle complexity | New memory classes via schema registry |

---

# *9. Model Router*

## *9.1 Provider-Neutral Interface*

*All model providers, including local runtimes, implement a provider adapter. The router receives a typed model request with task class, sensitivity class, capability needs, latency objective, budget, permitted providers, data residency constraints, and fallback policy.*

## *9.2 Routing Pipeline*

```
flowchart LR
R\[Model Request\] --> P\[Policy Eligibility\]
P --> C\[Capability Scoring\]
C --> H\[Health + Latency Filter\]
H --> B\[Budget Reservation\]
B --> S\[Selection / Fallback Chain\]
S --> I\[Provider Invocation\]
I --> M\[Metering + Quality Signals\]
M --> BENCH\[Benchmark Profile Update\]

```

## *9.3 Scoring*

*Candidate score is a policy-bounded weighted function of capability fit, benchmark quality, tool-use reliability, context capacity, observed latency, availability, estimated cost, data governance, local/offline availability, and user/admin preference. Policy eligibility is a hard filter, never a soft score.*

## *9.4 Fallback Rules*

1. *Retry only failures classified as transient and safe.*
2. *Do not move restricted data to a fallback provider lacking policy eligibility.*
3. *Preserve model request semantics and output validation contract across providers.*
4. *Record all fallbacks, reason codes, budget impact, and quality uncertainty.*
5. *Pause when no compliant provider is available.*

## *9.5 Health and Offline Routing*

*Adapters continuously publish provider health: availability, latency percentiles, error classes, rate limits, capability flags, and model version. Local routing is eligible only after hardware, artifact integrity, runtime health, and policy requirements are satisfied.*

---

# *10. Local AI*

## *10.1 Local Model Runtime Architecture*

```
flowchart TB
MR\[Model Router\] --> LPA\[Local Provider Adapter\]
LPA --> HD\[Hardware Detector\]
HD --> VP\[VRAM / RAM Planner\]
VP --> MAR\[Model Artifact Registry\]
MAR --> DL\[Download + Verification Manager\]
DL --> RH\[Runtime Host\]
RH --> O\[Ollama\]
RH --> L\[LM Studio\]
RH --> LC\[llama.cpp / GGUF\]
RH --> ON\[ONNX Runtime\]
RH --> GPU\[CUDA / ROCm\]
RH --> CPU\[CPU Fallback\]

```

## *10.2 Decisions*

| Area | Decision | Why | Trade-off | Extension |
| --- | --- | --- | --- | --- |
| Runtime support | Adapter layer for Ollama, LM Studio, llama.cpp/GGUF and ONNX | Supports ecosystem diversity | Capability variance | Add runtimes through conformance suite |
| Acceleration | Detect CUDA/ROCm where supported; CPU fallback | Broad Windows compatibility | Different quality/latency profiles | Future NPU providers |
| Model acquisition | Registry-backed downloads with checksum/signature verification | Prevents tampered artifacts | Registry maintenance | Enterprise mirrors and air-gapped packs |
| Customization | Prefer RAG and LoRA/QLoRA/PEFT | Lower cost and stronger governance than foundation training | Quality limits | Approved fine-tuned artifact lifecycle |
| Hardware planning | Admission control based on VRAM/RAM/disk/thermal budget | Prevents host instability | Conservative scheduling | Dynamic multi-model packing |

## *10.3 Model Lifecycle*

*States: discovered, requested, downloading, verifying, installed, compatible, warming, ready, draining, inactive, quarantined, deleted. Artifact records contain provenance, hash, license metadata, quantization, compatibility, vulnerability status, policy labels, and retention.*

## *10.4 RAG and LoRA Boundaries*

*RAG is a retrieval architecture and MUST use the same data classification, access checks, provenance, and deletion semantics as Memory Engine retrieval. LoRA and other parameter-efficient adaptations MUST use approved datasets, versioned artifacts, evaluation gates, rollback, and explicit data-rights provenance. NexusOS does not define foundation-model training architecture.*

---

# *11. Event Bus*

## *11.1 Event Model*

*The event bus is the primary asynchronous backbone. Events report facts that occurred; commands request work; queries retrieve state. Commands MUST NOT be disguised as events.*

```
flowchart LR
P\[Producer\] --> V\[Schema Validation\]
V --> O\[Outbox / Publisher\]
O --> T\[Topic Partition\]
T --> C1\[Consumer Group A\]
T --> C2\[Consumer Group B\]
C1 --> DLQ\[Dead Letter Queue\]
T --> RP\[Replay Consumer\]

```

## *11.2 Envelope Standard*

*Every event includes: event ID, event name, schema ID/version, producer identity, tenant/workspace scope, aggregate reference, correlation ID, causation ID, occurred timestamp, trace context, classification, payload reference or payload, and retention class.*

## *11.3 Topics and Ordering*

*Ordering is guaranteed only within a partition. Partition keys follow the strongest single-writer aggregate: task ID for task state, device ID for device streams, plugin installation ID for lifecycle, and workspace ID only when ordering across that workspace is required and throughput permits it.*

## *11.4 Delivery, Retry and DLQ*

*At-least-once delivery is the default. Consumers MUST be idempotent using event IDs and aggregate versions. Retries use bounded exponential backoff with jitter. Terminal failures are moved to a DLQ with reason, attempt history, payload reference, correlation links, alerting, and safe replay controls.*

## *11.5 Replay and Persistence*

*Event retention is class-based. Audit and compliance events have immutable retention requirements. Operational events may compact or expire. Replaying events MUST be isolated from production side effects through replay mode, idempotency, and projection-specific guards.*

---

# *12. Communication*

## *12.1 Desktop ↔ Backend Protocol*

*The agent establishes an outbound TLS 1.3 mutually authenticated persistent channel. Message envelopes are versioned and authenticated. The protocol supports heartbeats, acknowledgements, sequence IDs, resumable sessions, flow control, signed commands, encryption, compression for eligible payloads, and encrypted local spooling.*

## *12.2 ACP: Agent Communication Protocol*

| Field | Requirement |
| --- | --- |
| Identity | sender and recipient runtime/service identities |
| Correlation | message, correlation and causation IDs |
| Authority | policy snapshot hash and signed delegated authority |
| Schema | schema ID/version and typed body contract |
| Reliability | explicit delivery class, timeout, idempotency key |
| Security | no plaintext secrets; sensitive references are artifact-backed |
| Observability | trace hints, classification and audit linkage |

## *12.3 Streaming and Backpressure*

*Streams MUST expose producer sequence number, consumer acknowledgement, resumable cursor, maximum in-flight window, and explicit terminal marker. Backpressure is enforced at each hop; logs and progress updates may be sampled, but state transitions and approval events may not be silently dropped.*

## *12.4 Conflict Resolution*

*Single-writer state is authoritative for task graphs, grants, approvals, and leases. Mergeable user-authored drafts may use explicit merge functions. All other conflicts require orchestrator-mediated reconciliation, preserving both versions and emitting a conflict event.*

---

# *13. Plugin Runtime*

## *13.1 Plugin Architecture*

*A plugin is a signed, versioned capability package. A plugin may expose local adapters, cloud connectors, UI extensions, workflows, provider adapters, or MCP integration, but it cannot bypass the core permission, policy, audit, or secrets systems.*

## *13.2 Lifecycle*

```
stateDiagram-v2
\[\] --> Discovered
Discovered --> Verified: signature and manifest checks
Verified --> Installed: explicit authorization
Installed --> Configured: grants + secret references
Configured --> Active: health gate passes
Active --> Suspended: policy, user or anomaly action
Suspended --> Active: reauthorized
Active --> Updating
Updating --> Active: validation passes
Updating --> Quarantined: validation or behavior failure
Quarantined --> Uninstalled
```

## 13.3 Sandbox Tiers

| Tier | Use case | Controls |
| --- | --- | --- |
| Tier 0 | Declarative/UI-only | no execution, no secrets |
| Tier 1 | Low-risk remote connector | scoped OAuth, egress allowlist, schema validation |
| Tier 2 | Local tool integration | process isolation, filesystem/network allowlists, resource limits |
| Tier 3 | High-risk or unverified plugin | strongest available sandbox, draft-only or explicit approval, enhanced monitoring |

## 13.4 SDK and Contract Rules

The SDK exposes typed capability APIs, not raw ambient host access. Plugin manifests declare permissions, data classes, outbound domains, tool schemas, compatibility range, telemetry behavior, publisher signature, and risk tier. Host APIs perform policy checks at invocation time.

## 13.5 Marketplace Integration

Marketplace installation resolves dependency graph, publisher verification, entitlement, compatibility, required grants, secret bindings, and rollout channel. Hot reload is allowed only for development or explicitly safe declarative assets; executable upgrades require lifecycle health gates and rollback.

---

# 14\. Database Architecture

## 14.1 Logical Storage Model

| Data domain | Canonical store type | Consistency priority | Notes |
| --- | --- | --- | --- |
| identity, tasks, grants, approvals | relational transactional store | strong | authoritative state machines |
| events and audit | append-only event/log store | durable ordered per key | immutable evidence |
| artifacts and snapshots | encrypted object storage | durable | manifest-based access |
| cache, presence, short leases | in-memory/distributed cache | ephemeral | never source of truth |
| memory semantic retrieval | vector/search index | eventual | canonical metadata elsewhere |
| graph relations | graph projection/store | eventual or governed | provenance-backed relationships |
| telemetry analytics | columnar analytical store | eventual | aggregate and diagnostic data |

## 14.2 Entity Boundaries

Task Service owns tasks, graph references and task state. Policy owns policy definitions, grants and decision records. Memory owns memory metadata and retrieval lineage. Artifact owns artifact metadata and access grants. Identity owns principals and membership. No service writes another domain's tables.

## 14.3 Index Philosophy

Indexes are created to support explicit query patterns, tenant isolation, lifecycle cleanup, and observability. Every index has an owning query, cardinality expectation, write cost assessment, and retention impact. Full scans across tenants are prohibited in online paths.

## 14.4 Archiving and Sharding

Partition high-volume datasets by time and tenant/workspace as appropriate. Archive cold audit, event and artifact metadata according to retention policy while preserving legal-hold semantics. Shard only after measured load requires it; use stable tenant-aware routing keys to avoid future rebalancing disruption.

---

# 15\. Security

## 15.1 Security Architecture

Security is layered: identity, device trust, authorization, runtime isolation, data protection, supply chain controls, detection, response, and recovery. No single layer—including model safety—is relied upon as a complete control.

## 15.2 Trust Boundaries and Threats

| Boundary | Representative threat | Required control |
| --- | --- | --- |
| User to web | session theft, CSRF, privilege confusion | OIDC, MFA, secure sessions, server authorization |
| Cloud to device | impersonation, command tampering | mTLS, signed leases, nonce/expiry, device revocation |
| Runtime to tool | command injection, privilege escalation | capability checks, isolation, input validation |
| Plugin/MCP | malicious code or excessive scopes | signing, manifest review, sandbox, egress policy |
| Model/provider | data exposure, unsafe output | policy gating, minimized context, output validation |
| Storage | disclosure or deletion | encryption, access grants, backups, immutable audit |
| Build pipeline | dependency or release compromise | SBOM, provenance, signing, protected CI |

## 15.3 Secrets

Secrets are stored only in the vault or platform credential facilities. Callers receive short-lived scoped secret leases or opaque references. Secrets MUST NOT appear in logs, events, traces, prompts, artifacts, crash dumps, source control, or plugin configuration exports.

## 15.4 Encryption

Use modern transport encryption for all network paths, envelope encryption at rest for protected data, KMS/HSM-backed key management, key rotation, tenant-aware access policies, and cryptographic erasure where supported. Cryptographic design choices require dedicated ADR and security review.

## 15.5 Audit and Incident Recovery

Audit events are append-only, integrity protected, actor-attributed, and queryable by correlation ID. Incident response supports tenant-wide policy lockdown, device revocation, connector disablement, secret rotation, provider disablement, artifact access revocation, and forensic preservation.

---

# 16\. Observability

## 16.1 Telemetry Model

Every service and runtime emits structured logs, metrics, traces, events, health state, and diagnostic metadata through a standardized observability SDK. Telemetry is tenant/classification aware and redacted before export.

## 16.2 Required Signals

| Signal | Minimum contents |
| --- | --- |
| Logs | timestamp, severity, component, correlation ID, safe error details |
| Metrics | latency, errors, saturation, throughput, queue age, resource use |
| Traces | end-to-end request/task/ACP spans with causation links |
| Events | domain lifecycle facts and user-visible activity projections |
| Health | liveness, readiness, dependency health, version and config revision |
| Diagnostics | consented, redacted host/service state bundle |

## 16.3 Dashboard Standards

Dashboards must cover service health, task reliability, queue backlog, agent/device fleet health, provider routing, model cost/quality, plugin behavior, security denials, and SLO error budgets. Every alert routes to a runbook and includes scope, correlation context, customer impact classification, and mitigation guidance.

## 16.4 Traceability

A task correlation ID begins at task creation and is propagated to graph nodes, leases, ACP messages, tool receipts, artifacts, model invocations, events, audit records, logs, and notifications. Causation IDs describe the triggering event or command.

---

# 17\. Deployment

## 17.1 Cloud Topology

```
flowchart TB
DNS\[Global DNS / Edge\] --> WAF\[WAF + API Edge\]
WAF --> API\[Stateless API Services\]
API --> SVC\[Control Plane Services\]
SVC --> BUS\[Durable Event Bus\]
SVC --> DB\[(Multi-AZ Transaction Store)\]
SVC --> OBJ\[(Encrypted Object Storage)\]
SVC --> VAULT\[Vault / KMS\]
BUS --> WRK\[Worker Pools\]
SVC --> OBS\[Observability Platform\]
DG\[Device Gateway Fleet\] --> BUS
```

## 17.2 Environment Strategy

Development, integration, staging, security evaluation, dogfood, and production are isolated environments with independently managed credentials and data. Production data never enters lower environments except approved, minimized, sanitized datasets.

## 17.3 CI/CD Principles

* Build provenance, SBOM, signed artifacts, policy checks, tests, vulnerability scanning, and infrastructure validation are release gates.
* Deployments are declarative and reproducible.
* Feature flags separate deployment from exposure.
* Migrations are backward compatible, observable, resumable, and reversible where possible.

## 17.4 Release and Rollback

Cloud services use canary and progressive rollout by default; blue-green is used when full environment swaps provide lower risk. Desktop channels are internal, beta, and stable with cohort targeting. Rollback requires artifact provenance verification and data migration compatibility assessment.

---

# 18\. Engineering Principles

Every engineer and EDD MUST comply with the following:

1. Never hardcode providers, models, connectors, IDEs, transports, or storage vendors into domain logic.
2. Use adapters and versioned interfaces for replaceable dependencies.
3. Communicate asynchronous cross-domain state through the event bus.
4. Do not write another service's datastore.
5. Make every external mutation idempotent or explicitly reconcilable.
6. Log every destructive action and retain user-visible evidence where policy permits.
7. Build observability into every module before production readiness.
8. Design modules to be independently replaceable.
9. Prefer composition over inheritance.
10. Prefer asynchronous execution for long-running, remote, or failure-prone work.
11. Never expose secrets in code, logs, prompts, events, or diagnostics.
12. Sandbox external tools and plugins; never grant ambient host authority.
13. Make services testable through dependency injection, contract tests, and deterministic clocks/IDs where appropriate.
14. Make features measurable with explicit telemetry and success/failure states.
15. Version every external API, event schema, plugin manifest, and ACP message.
16. Enforce authorization server-side and at execution time.
17. Treat external content and model output as untrusted input.
18. Preserve backward compatibility; deprecate deliberately with migration paths.
19. Prefer durable state transitions over inferred client state.
20. Fail closed for authority and fail informative for users.
21. Bound retries, concurrency, tokens, time, resource use, and recursion.
22. Include data classification, retention, privacy, and deletion behavior in every design.
23. Require an ADR for a new persistent cross-cutting dependency or changed invariant.
24. Do not introduce implementation shortcuts that bypass policy, audit, or registry controls.

---

# 19\. Architecture Decision Records (ADR)

## 19.1 ADR Policy

An ADR is required for decisions affecting system-wide contracts, trust boundaries, persistence, deployment topology, model/provider strategy, security posture, runtime isolation, public APIs, or long-term operability. ADRs are immutable once accepted; superseding ADRs replace decisions without erasing historical rationale.

## 19.2 ADR Template

```
# ADR-XXXX: Short Decision Title
```

## `Status`

`Proposed | Accepted | Superseded | Deprecated`

## `Context`

`What architectural problem, constraint, and evidence require a decision?`

## `Decision Drivers`

`Security, reliability, cost, performance, developer experience, compliance, extensibility.`

## `Alternatives Considered`

`| Alternative | Benefits | Costs / Risks | Why not selected |`

## `Decision`

`State the normative decision and affected boundaries.`

## `Consequences`

`Positive and negative operational, technical, and organizational effects.`

## `Scalability and Extension Strategy`

`How the decision evolves without redesign.`

## `Risks and Mitigations`

`Known failure modes, controls, and ownership.`

## `Migration / Rollout`

`Compatibility, data migration, rollback, telemetry and deprecation plan.`

## `References`

`Architecture Bible chapters, PRD sections, EDDs, threat models, benchmarks.`  

## 19.3 Seed ADRs

| ADR | Decision | Rationale |
| --- | --- | --- |
| ADR-0001 | Modular event-driven control plane | Long-lived distributed tasks need loose coupling and recovery |
| ADR-0002 | Cloud control plane with Windows-first local execution | Remote supervision with local execution boundary |
| ADR-0003 | Signed expiring work leases | Prevents durable ambient device authority |
| ADR-0004 | Capability-based authorization | Dynamic agent actions require resource/action context |
| ADR-0005 | Provider-neutral model router | Supports quality, cost, resilience and data governance |
| ADR-0006 | Durable internal event bus and outbox | Enables reliable integration and observability |
| ADR-0007 | Immutable versioned execution graphs | Enables override, audit and safe recovery |
| ADR-0008 | Plugin sandbox tiers and manifest governance | Limits ecosystem blast radius |
| ADR-0009 | Hybrid, access-aware memory retrieval | Balances semantic recall with provenance and policy |
| ADR-0010 | LoRA/RAG preferred over foundation-model training | Governable adaptation without training platform scope |

---

# 20\. Future Evolution

## 20.1 Ten-Year Evolution Strategy

NexusOS evolves by preserving control-plane invariants while adding adapters, runtimes, deployment modes, and capability providers. New platforms must integrate through contracts; they must not fork policy, audit, identity, or orchestration semantics.

| Evolution | Architectural preparation | Required constraint |
| --- | --- | --- |
| New AI providers | provider adapter and benchmark contracts | policy eligibility precedes routing |
| New IDEs | capability discovery and local adapter SDK | desktop agent remains permission authority |
| macOS/Linux | platform runtime abstraction and capability matrix | no assumed Windows API in contracts |
| Mobile | supervisory client contracts and secure push | no unrestricted executor by default |
| Robotics | device gateway + safety-rated capability profiles | physical action requires stricter policy/override |
| IoT | gateway/fleet identity and constrained protocols | segmented trust and offline reconciliation |
| Edge AI | local provider adapter and artifact registry | hardware/resource admission control |
| Private AI | enterprise provider adapters and residency policy | tenant isolation and audit equivalence |
| Enterprise deployments | deployment profiles and infrastructure contracts | same policy/audit semantics across modes |
| Distributed execution | multi-runner graph scheduling | leases, idempotency and causal tracing |
| Federated agents | ACP directory and delegated authority | no transitive ambient privilege |

## 20.2 Compatibility Architecture

Contracts evolve additively: new optional fields, capabilities, event versions, and adapter feature flags. Capability negotiation occurs at connection and install time. Older agents receive only supported command forms. Unsupported capabilities create explicit blocked outcomes, never silent degradation.

## 20.3 Enterprise and Private Deployment

Future deployment profiles may include single-tenant cloud, customer-managed keys, private model endpoints, self-hosted control plane, isolated network, and air-gapped artifact distribution. The architecture preserves identical policy decision semantics, audit evidence, signed artifacts, and versioned contracts across profiles.

## 20.4 Sunset Policy

Deprecated APIs, schemas, SDK methods, providers, and plugin capabilities require: published deprecation date, compatibility window, migration guide, detection telemetry, customer communication where relevant, and controlled disablement. Emergency security revocation may bypass the normal window but must produce audit and incident records.

---

# Appendix A. EDD Conformance Checklist

An EDD is incomplete unless it documents:

* Architecture Bible chapters and ADRs referenced.
* Scope and explicit non-scope.
* Domain ownership and data ownership.
* APIs, events, schemas, versioning, and compatibility.
* Trust boundaries, threat model, authorization and secrets behavior.
* Failure modes, retry/idempotency, reconciliation and degraded mode.
* Observability signals, SLOs, dashboards and runbooks.
* Data classification, retention, deletion and backup behavior.
* Scaling model, dependencies, capacity and cost considerations.
* Test strategy including contract, integration, security and recovery tests.
* Migration, rollout, rollback and feature-flag plan.
* ADRs required for any exception to this Architecture Bible.

# Appendix B. Standard Decision Matrix

| Criterion | Weight guidance | Questions |
| --- | --- | --- |
| Security and trust | highest | Does it reduce privilege, leakage and supply-chain risk? |
| Reliability | high | Does it recover safely under partial failure? |
| Compatibility | high | Can it coexist with deployed agents/plugins? |
| Operability | high | Can engineers observe, diagnose and roll it back? |
| Extensibility | medium-high | Can providers/platforms change without core redesign? |
| Performance | medium | Does it meet latency and resource budgets? |
| Cost | medium | Is cost bounded, attributable and scalable? |
| Developer productivity | medium | Is the contract understandable and testable? |

# Appendix C. Canonical Failure Classification

| Class | Retry | Human intervention | Example |
| --- | --- | --- | --- |
| Validation | no | fix input/config | schema invalid |
| Authorization | no | grant/approval | permission expired |
| Transient infrastructure | bounded | after exhaustion | timeout, temporary network loss |
| Provider capacity | bounded/fallback | if no compliant fallback | rate limit |
| External ambiguity | reconcile first | if receipt unknown | payment/send state unknown |
| Security | no | security workflow | injection or signature failure |
| Invariant violation | no | engineering incident | impossible state transition |

# Appendix D. Required Architecture Artifacts

Each foundational subsystem maintains: service catalog entry, owner, ADR links, EDD, contract definitions, threat model, data inventory, runbook, SLO, dashboard, dependency map, test matrix, release plan, and retirement/deprecation procedure.