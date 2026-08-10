# NexusOS Experience Platform Engineering Design Document (EDD)

## Document Control

| Field | Value |
| --- | --- |
| Status | Authoritative experience-layer engineering blueprint |
| Scope | Web dashboard, Windows desktop experience surfaces, mobile-supervision-compatible responsive experience, IDE-adjacent experience contracts, and shared experience system |
| Authority | Inherits NexusOS Enterprise PRD v3, Architecture Bible, Desktop Agent EDD, Backend EDD, and AI Runtime EDD |
| Architecture changes | Prohibited; a conflict or exception requires an accepted ADR |
| Non-scope | Frontend implementation code, independent authorization, desktop tool execution, workflow orchestration, policy definition, or service/datastore redesign |
| Normative language | MUST, MUST NOT, SHOULD, and MAY retain Architecture Bible meanings |

## Authority and Conformance

This EDD is subordinate to and incorporates by reference:

1. NexusOS Enterprise PRD v3.
2. NexusOS Architecture Bible — Pre-EDD Foundation.
3. NexusOS Desktop Agent EDD.
4. NexusOS Backend EDD.
5. NexusOS AI Runtime EDD.

The Experience Platform is the experience plane. It presents policy-filtered state; collects user intent, scoped approvals, and human overrides; renders evidence; and provides transparent supervision of execution. It MUST NOT become an authorization authority, execution authority, policy engine, graph owner, secrets store, or direct desktop-control path. Backend and Policy services remain authoritative for identity, policy, grants, approvals, canonical state, and audit. AI Runtime remains authoritative for planning, graph proposals, reasoning, routing, reflection, and recovery recommendations. Desktop Agent remains the local execution boundary.

All calls use versioned API, real-time, event-derived read-model, and ACP-adjacent contracts already established by the parent documents. The experience client never writes another service datastore, never trusts client state as truth, and never renders unredacted protected data merely because it was locally cached.

## Experience Platform Invariants

1. The UI displays authority; it does not create authority by itself.
2. Every consequential user action is reauthorized by the owning backend domain at submission time.
3. Every action, approval, override, export, install, and security-sensitive view is correlated to immutable audit evidence.
4. Experience state is a projection of canonical server/runtime state, with explicitly bounded optimistic local state.
5. Secrets, raw credentials, protected artifact content, and sensitive model context are never exposed in UI telemetry, client logs, URLs, clipboard, or broad browser storage.
6. Untrusted content, model output, plugin output, and browser-derived content are visibly distinguished from trusted system state.
7. Failure must be informative to users and fail closed for authority.
8. The desktop and web experiences expose the same task semantics; capability availability may differ by device, platform, and policy.
9. Keyboard access, screen-reader semantics, reduced motion, contrast, localization readiness, and responsive supervision are baseline quality requirements.
10. A feature that changes a parent contract, trust boundary, service boundary, persistence dependency, or architectural invariant requires an ADR.

# 1\. Experience Philosophy

## 1.1 Product mental model

NexusOS is an operational workspace, not a chat transcript. Users move through five visible layers:

1. Command: state an outcome using chat, a structured task, a saved workflow, or an approved trigger.
2. Plan: inspect scope, assumptions, tools, cost, permissions, evidence requirements, and approval checkpoints.
3. Execute: observe bounded work on selected devices and connected services.
4. Supervise: approve, pause, intervene, replace, recover, or stop work.
5. Learn: inspect memories, knowledge, artifacts, outcomes, and reusable workflows under policy.

The interface makes the currently relevant layer primary and keeps the rest one interaction away. Chat is a command and explanation surface; task and activity views remain the canonical operational surfaces.

## 1.2 Design principles

| Principle | Experience requirement |
| --- | --- |
| Autonomy with boundaries | Clearly disclose task mode, device, scope, permissions, cost ceiling, and next consequential action before execution. |
| Observable by default | Material steps have a human-readable narrative, timestamp, actor, evidence link, correlation ID, and expandable technical detail. |
| Local-first trust | Show device locality, connectivity, local/offline eligibility, and data destination without implying local execution when work is cloud-based. |
| Reversible by design | Prefer draft, preview, diff, snapshot, checkpoint, restore, and explicit irreversibility labels. |
| Progressive capability | New users receive guided narrow-scope paths; experts can use command palette, shortcuts, split panes, filters, and saved views. |
| Policy outside the model | Explain policy decisions as system-enforced rules, not as model preference or refusal language. |
| Evidence before confidence | Claims, plans, summaries, and completions link to source evidence and indicate uncertainty. |
| Minimal cognitive load | Use progressive disclosure, stable locations, predictable status vocabulary, and a single primary decision per high-risk moment. |

## 1.3 AI-first interaction philosophy

AI assists with intent capture, plan explanation, summarization, navigation, filtering, and artifact creation. It never masks execution state, silently changes task scope, or makes an approval decision on behalf of the user.

Reasoning display is tiered:

* Default: concise intent, plan, current step, evidence, assumptions, confidence, and next action.
* Inspect: tool/capability selected, model routing rationale where policy permits, inputs/outputs, event sequence, and safe diagnostics.
* Authorized engineering/admin mode: correlation-linked structured records, redacted traces, policy decision references, and protocol metadata.

The interface MUST NOT imply access to hidden chain-of-thought. “Reasoning” UI contains auditable decision summaries, assumptions, evidence, checks performed, and uncertainty—not private model deliberation.

## 1.4 Trust, transparency, and explainability

Trust indicators use plain language plus structured detail:

* Status: planning, awaiting approval, queued, running, paused, blocked, reconciling, completed, failed, canceled, expired.
* Authority: task-scoped, session-scoped, persistent, expired, revoked, or unavailable.
* Evidence: verified receipt, source-backed, unverified claim, missing, conflicting, or stale.
* Data handling: local device, NexusOS control plane, connected service, approved model provider, or unavailable.
* Consequence: reversible, snapshot available, compensatable, or irreversible.

No status uses color as its only signal. The user can expand any material task event to see “what happened,” “why,” “what changed,” “what was used,” and “what can I do next.”

# 2\. Information Architecture

## 2.1 Application map

```
flowchart TB
  APP\[NexusOS Experience\] --> HOME\[Dashboard\]
  APP --> CHAT\[AI Chat\]
  APP --> TASKS\[Tasks\]
  APP --> ACT\[Activity Center\]
  APP --> WS\[Workspaces\]
  APP --> WF\[Workflow Builder\]
  APP --> MEM\[Memory Explorer\]
  APP --> KG\[Knowledge Graph\]
  APP --> MARKET\[Plugin and Skills Marketplace\]
  APP --> NOTIF\[Notifications\]
  APP --> DEV\[Developer Tools\]
  APP --> ADMIN\[Admin Console\]
  APP --> SETTINGS\[Settings\]
  TASKS --> DETAIL\[Task Detail\]
  ACT --> EXEC\[Execution Inspector\]
  WS --> FILES\[Workspace Files and Artifacts\]
```

Primary navigation is workspace-scoped unless clearly marked personal or organization-scoped. The selected workspace is globally visible and changing it resets workspace projections, search scope, notifications, and permission-sensitive panels. Cross-workspace views require explicit filter selection and server-side authorization.

## 2.2 Navigation model

| Level | Surface | Purpose | Persistence |
| --- | --- | --- | --- |
| Global | Sidebar, command palette, workspace switcher | Move between primary domains and create work | Last safe user preference, device-local only |
| Context | Header breadcrumbs, tabs, filters | Move within a domain | URL/deep-link state where non-sensitive |
| Task | Execution graph, inspector tabs, artifact tabs | Supervise one task | Task ID and server projection |
| Overlay | Dialog, sheet, floating panel, command palette | Focused decision or preview | Ephemeral; recoverable draft only |
| Desktop | Tray menu and native notification | Urgent state and local supervision entry | No protected content persistence |

Deep links MAY identify resources but MUST NOT contain secrets, signed artifact URLs, raw prompts, protected query terms, approval tokens, or personally sensitive text. A deep link resolves to an authorized server-side resource check.

## 2.3 Global search and command palette

The command palette is the keyboard-first control plane for navigation and safe actions. It supports:

* navigation and recent surfaces;
* create task, choose workspace/device/mode, and attach approved artifacts;
* search tasks, artifacts, workflows, memories, integrations, people, and settings;
* invoke non-destructive quick actions;
* open contextual commands only after policy-filtered availability is known.

Destructive, external, and permission-changing actions never execute as one keystroke. They open a confirmation surface with impact and reauthorization. Search indexes remain server-authorized; local recent-item caches contain only minimal non-sensitive labels and clear on sign-out/workspace revocation.

## 2.4 Navigation state and recovery

Navigation state includes selected workspace, active route, task inspector tab, filters, split-view widths, and local unsent drafts. URLs are canonical for shareable non-sensitive navigation. Layout preferences are device-local, versioned, resettable, and never treated as task state. On invalidated access, the client removes protected cached views, returns to a safe parent route, and explains that access or retention changed without revealing inaccessible resource details.

# 3\. Global Layout System

## 3.1 Shell hierarchy

```
flowchart TB
  SHELL\[Application Shell\]
  SHELL --> SIDE\[Adaptive Sidebar\]
  SHELL --> TOP\[Header and Context Bar\]
  SHELL --> MAIN\[Primary Content Region\]
  SHELL --> RIGHT\[Optional Inspector Panel\]
  SHELL --> STATUS\[Status Bar\]
  SHELL --> DOCK\[Task and Utility Dock\]
  SHELL --> OVERLAY\[Dialogs, Panels, Command Palette\]
```

The shell preserves orientation: workspace, current location, real-time connection state, active task count, approval count, and user/account menu remain discoverable without competing with task content.

## 3.2 Layout responsibilities and boundaries

| Subsystem | Responsibilities | Non-responsibilities |
| --- | --- | --- |
| Sidebar | global navigation, workspace context, pinned views, badges | task authorization or hidden background navigation |
| Header | breadcrumb, scope, contextual controls, search | duplicate primary actions that belong in content |
| Status bar | connection, sync, selected device, background activity, accessibility notices | detailed execution log |
| Dock | minimized active tasks, downloads, uploads, running utilities | canonical task state |
| Panels | evidence, inspector, diff, artifact, logs, graph detail | permanent navigation replacement |
| Windows/tabs | multitask supervision and compare views | unbounded background resource use |

## 3.3 Desktop, responsive, and window behavior

Desktop layout supports a persistent sidebar, two- or three-column task detail, resizable split view, detachable operational panels where supported, and keyboard navigation. Tablet collapses secondary navigation and inspector into sheets. Mobile prioritizes task creation, approval, notification, task status, evidence review, emergency pause/stop, and concise activity; dense graph editing, log analysis, and multi-panel operations display a supported-limits message rather than a degraded unsafe control.

Breakpoints are semantic rather than device-branded:

* Compact: one primary pane; inspector becomes modal sheet.
* Medium: contextual rail or collapsible inspector.
* Expanded: persistent navigation plus primary/secondary panels.
* Wide: three-pane supervision, graph comparison, and parallel artifact review.

Window geometry, sidebar collapse state, panel sizes, pinned tabs, and dock order persist locally after debounce. The system clamps restored positions to visible display bounds and removes stale references after app version migration. Layout restoration MUST NOT reopen protected content without current authorization.

## 3.4 Focus and overlay rules

Only one modal decision dialog may block a window at a time. Approval, security, and destructive-action dialogs trap focus, announce purpose, restore focus on closure, and cannot be dismissed by accidental backdrop interaction when a decision is required. Floating panels are non-modal, keyboard reachable, escape-dismissible where safe, and never obscure an active approval consequence statement.

# 4\. Design System

## 4.1 Design-system responsibilities

The Design System supplies semantic tokens, accessible primitives, composite patterns, responsive behavior, localization rules, motion behavior, and visual regression contracts. It does not determine product policy, access control, task semantics, or feature-specific business rules.

## 4.2 Tokens and themes

Token layers are: foundation → semantic → component → product-surface. Components consume semantic tokens only. Theme changes never require feature-specific CSS or hard-coded colors.

| Token family | Required semantics |
| --- | --- |
| Typography | font family, scale, line height, weight, code style, numeric alignment |
| Spacing | base unit, density scale, touch target, panel gaps, grid rhythm |
| Color | background, surface, text, border, focus, action, status, risk, data classification |
| Elevation | base, raised, overlay, modal, critical attention; shadow and border alternatives |
| Motion | duration, easing, entrance, exit, progress, reduced-motion substitutions |
| Shape | radii, control geometry, focus-ring offsets |
| Z-index | named layers only; no arbitrary feature stacking |

Dark mode, light mode, system mode, high contrast, and organization-approved theme variants share semantic contrast requirements. Glassmorphism is restricted to secondary chrome and overlays with guaranteed text contrast, visible boundaries, blur fallback, and reduced-transparency support. It MUST NOT obscure approval, warning, evidence, or data-classification information.

## 4.3 Typography, icons, and motion

UI typography prioritizes scanability; code, commands, IDs, diff content, and logs use a legible monospaced family. Font scaling respects browser/OS settings. Icons have text alternatives, never serve as the only indicator for irreversible action, and align to a documented iconography vocabulary.

Motion is informative: task progress, panel transitions, graph focus, and state changes may animate within 150–250 ms by default. Reduced motion substitutes opacity/state changes and disables continuous decorative movement. Streaming regions avoid layout thrash and do not force scroll movement when users inspect prior content.

## 4.4 Theme engine state

Theme state is personal preference constrained by organization policy and accessibility overrides. Precedence is: forced accessibility/organization requirement → user explicit theme → system preference → product default. Theme changes apply atomically, are previewable, and are locally stored without leaking workspace content.

# 5\. Component Library

## 5.1 Component architecture

```
flowchart TB
  TOK\[Semantic Tokens\] --> PRIM\[Accessible Primitives\]
  PRIM --> COMP\[Composite Components\]
  COMP --> PAT\[Experience Patterns\]
  PAT --> PAGE\[Pages and Workspaces\]
  PAGE --> QA\[Visual, A11y, Interaction Contracts\]
```

All components define controlled/uncontrolled state boundaries, loading/empty/error/disabled states, keyboard contract, accessible name, focus behavior, responsive behavior, telemetry events, and test fixtures. Components may render server-provided data but do not make authorization assumptions.

## 5.2 Required component families

| Family | Core requirements |
| --- | --- |
| Buttons and menus | intent/risk variants, loading protection, keyboard invocation, confirmation handoff |
| Cards, lists, tables | virtualization, sort/filter state, empty/loading/error states, row actions with accessible labels |
| Dialogs and sheets | focus management, consequence summary, safe dismiss rules, no nested modal dead ends |
| Forms | field-level validation, server errors, draft recovery, input purpose/autocomplete policy |
| Editors | autosave draft boundary, version/conflict indicators, markdown/code/plain-text modes, sanitization |
| Timeline and logs | ordered sequence, filtering, redaction indicators, follow-live control, export governance |
| Search and command palette | debounced authorized queries, keyboard traversal, result provenance/scope |
| Charts and graphs | data table alternative, keyboard exploration, accessible summaries, progressive rendering |
| Progress | determinate/indeterminate distinction, phase names, time uncertainty, cancellation status |
| AI components | citations, assumptions, confidence, action proposal, approval request, streaming states |
| Workflow components | nodes, edges, ports, validation states, minimap, keyboard graph operations |
| Plugin components | trust tier, publisher verification, compatibility, permissions, health, update/rollback state |

## 5.3 Shared failure behavior

Every component supports skeleton/loading, no-data, partial-data, unauthorized, offline, retryable-error, terminal-error, and stale-data states where applicable. Error UI shows an action-safe explanation, retry eligibility, correlation ID on inspect, and a path to diagnostic/support workflow. It never renders raw stack traces, tokens, internal policy expressions, or another tenant’s identifiers.

# 6\. AI Chat Experience

## 6.1 Responsibilities and non-responsibilities

Chat captures intent, answers within permitted context, creates task drafts, explains plans, streams safe progress summaries, gathers clarification, and links users to operational surfaces. It MUST NOT conceal a task’s canonical state, execute privileged actions directly, or substitute text acknowledgement for a backend approval.

## 6.2 Conversation state

```
stateDiagram-v2
  \[\*\] --> Draft
  Draft --> Sending
  Sending --> Streaming
  Streaming --> AwaitingUserInput
  Streaming --> TaskDraftAvailable
  TaskDraftAvailable --> Planning
  Planning --> AwaitingApproval
  AwaitingApproval --> Executing
  Executing --> Completed
  Executing --> Blocked
  Draft --> Discarded
  Streaming --> Failed
```

Chat state is scoped to conversation, workspace, actor, and selected task/device. Local drafts can be restored after refresh only when encrypted/local-storage policy permits; attachments are represented by authorized artifact references, not copied into broad client state.

## 6.3 Conversation layout and flows

The composer includes workspace, device, task mode, attachment, voice, and submit controls. A task-affecting prompt first creates a task draft with an explicit title, selected workspace/device, inferred constraints, and mode. The user may inspect and edit before planning when policy or ambiguity requires it.

Streaming messages use semantic chunks: response narrative, plan change, evidence citation, approval request, artifact, warning, and completion. The transcript has a “follow latest” control and never forces scroll when the user has navigated upward. Long logs, diffs, graph details, and artifacts open in side panels or task detail.

## 6.4 Reasoning, evidence, and thinking states

Thinking UI shows: understanding request, retrieving permitted context, preparing plan, validating permissions, waiting for approval, dispatching, observing work, verifying evidence, or recovering. It does not display fabricated step-by-step internal reasoning.

Evidence cards show source type, origin, timestamp, relevance, classification visibility, citation anchor, and confidence. Conflicting or insufficient evidence is labeled and linked to task recovery/clarification. Model-generated claims without evidence are clearly marked as generated analysis.

## 6.5 Approval and intervention in chat

Approval cards must display action, target, reason, consequence, reversibility, relevant preview, scope options, expiration, and alternatives: approve once, approve task-scoped, narrow scope, deny, pause, or open task. Clicking any choice calls the authoritative backend approval endpoint and renders the returned decision. A stale card becomes non-actionable and directs the user to refresh/open task.

## 6.6 Attachments, artifacts, images, voice, and code

Attachments undergo client-side type/size preflight and server-side authorization, classification, malware/content policy, and artifact ingestion. The chat renders only safe previews. Voice is explicit opt-in with recording indicator, transcription review, locale choice, and no background capture. Image input shows source and processing status. Code blocks provide syntax-aware display, copy with sensitive-content warning when applicable, diff view, and open-in-artifact/IDE actions. No clipboard operation silently exports protected content.

# 7\. Activity Center

## 7.1 Purpose

Activity Center is the canonical human-facing event projection for work across tasks, devices, agents, workflows, plugins, and approvals. It turns normalized event streams into an ordered, filterable, redacted narrative without replacing immutable audit records.

## 7.2 Data flow

```
flowchart LR
  BUS\[Canonical Events\] --> ACT\[Activity Service Projection\]
  ACT --> RT\[Real-time Channel\]
  ACT --> UI\[Activity Center\]
  UI --> FILTER\[Authorized Filters and Search\]
  UI --> DETAIL\[Evidence, Task, Artifact, Approval Detail\]
```

The client receives cursor-based, workspace-filtered pages and resumable live events. It deduplicates by event ID, preserves server ordering semantics, and labels delayed/out-of-order projections rather than inventing a sequence.

## 7.3 Execution inspector

Task activity includes live execution graph, current node, phase progress, tool/category, agent role, device, elapsed duration, retry/reconciliation status, resource/budget summaries where permitted, evidence, and available controls. Technical logs are separate from human-readable activity and are rendered with explicit redaction notices, severity, search, time range, and follow-live toggle.

## 7.4 Failure and recovery UX

Failures are categorized using canonical classes: validation, authorization, transient infrastructure, provider capacity, external ambiguity, security, invariant violation, cancellation, and deadline. The UI tells the user whether no change occurred, a change is confirmed, a result is uncertain, recovery is running, or intervention is required. Recovery actions are scoped: retry only if the owning service permits; reconcile; replan; restore snapshot; replace agent/model through approved override; or stop.

# 8\. Workflow Builder

## 8.1 Boundary

Workflow Builder is a governed authoring and inspection surface. Backend Workflow Service owns publication, lifecycle, permissions, and history. AI Runtime owns graph planning semantics. The Builder renders and submits versioned workflow manifests through existing contracts; it MUST NOT create direct execution, policy, or publication bypasses.

## 8.2 Editor structure

```
flowchart LR
  LIB\[Node and Template Library\] --> CANVAS\[Workflow Canvas\]
  CANVAS --> INS\[Node Inspector\]
  CANVAS --> VAL\[Validation Panel\]
  CANVAS --> SIM\[Simulation and Evidence Preview\]
  VAL --> PUB\[Review and Publish Request\]
```

The editor has node library, canvas, outline, inspector, validation panel, history/version comparison, simulation, and publish/review flow. Node types map directly to AI Runtime graph types: action, decision, condition, fork/join, bounded loop, retry, timeout, compensation, approval, checkpoint, delegation, terminal. Unsupported or policy-ineligible nodes are visible as unavailable with remediation rather than hidden.

## 8.3 Interaction and state management

Canvas edits are local drafts with immutable version lineage. Autosave is debounced and conflict-aware; publication creates a new version only after server validation. Drag-and-drop is accessible through keyboard add/move/connect operations. Connections validate port types, dependency cycles, required evidence, timeout, budget, approval placement, compensation declaration, and capability compatibility.

Simulation never executes real side effects. It uses approved synthetic fixtures, read-only metadata, or explicit sandbox capabilities and is visibly labeled. A simulation result cannot be reused as production evidence.

## 8.4 History, publishing, and recovery

History shows version author, timestamp, change summary, validation status, compatibility, policy impacts, and linked execution outcomes. Publish requires scoped authorization, impact preview, approval requirements, and backend response. On conflict, the user sees both versions and chooses merge/rebase/discard; no silent last-writer-wins behavior. Rollback selects a prior compatible version through backend lifecycle; it never erases history.

# 9\. Memory Explorer

## 9.1 Boundary and responsibilities

Memory Explorer lets authorized users inspect, search, filter, correct, pin, propose, export, and delete memory objects. Memory Service remains canonical owner of memory metadata, consent, lineage, retention, retrieval, and deletion propagation.

## 9.2 Information model

Views include conversation memory, workspace memory, knowledge, procedural/playbook memory, artifact-backed memory, candidates awaiting review, timeline, relationships, and version history. Each memory card shows scope, source, owner, confidence, classification, retention, last use, links, and retrieval eligibility. Visibility reflects current access, not historical browser cache.

## 9.3 Search, relationships, and deletion

Search is hybrid and server-authorized. Filters include memory type, workspace, owner, source, confidence, sensitivity, retention, date, and relationship. The UI explains that results are ranked and may be incomplete under access constraints.

Edits create versioned corrections with provenance. Delete requests describe immediate retrieval revocation and asynchronous propagation to indexes, caches, replicas, exports, and backups according to policy. Legal-hold or retention restrictions are clearly stated. The UI never promises physical deletion timing beyond the canonical service contract.

# 10\. Knowledge Graph

## 10.1 Purpose and boundary

Knowledge Graph renders access-filtered derived relationships among memory, tasks, artifacts, workflows, capabilities, evidence, failures, and recoveries. It is not an authority source and cannot expose hidden relationships across workspace, tenant, classification, or retention boundaries.

## 10.2 Graph interaction

The graph supports progressive neighborhood expansion, typed edges, timeline playback, relationship path inspection, dependency visualization, search, filters, and list/table fallback. Large graphs use level-of-detail aggregation, background layout, virtualization, and server-side pagination. Users can freeze layout, focus a path, compare versions, and open underlying evidence.

Every node/edge has source provenance, confidence, timestamp/version, and relationship type. Low-confidence inferred relationships are visually and textually distinct from verified links. Deletion/revocation events remove eligible graph projections immediately from the user session and trigger a refresh marker.

# 11\. Plugin Marketplace

## 11.1 Responsibilities and boundaries

Marketplace provides discovery and governed install/update experiences for plugins, MCP servers, Skills, connectors, and model/provider extensions. Registry remains canonical owner of manifest, signing, compatibility, installation, entitlement, lifecycle, and trust metadata. The Marketplace never executes a plugin for validation or bypasses policy/secret binding.

## 11.2 Discovery and trust presentation

Discovery supports categories, tags, use cases, supported devices, permissions, trust tier, publisher, verified status, compatibility, offline behavior, ratings, organization catalog availability, and update state. Ratings/reviews are clearly separate from security verification. Search results disclose whether an item is public, private organization, deprecated, suspended, or unavailable to the selected workspace/device.

## 11.3 Install flow

```
sequenceDiagram
  participant U as User/Admin
  participant M as Marketplace UI
  participant R as Registry
  participant P as Policy
  participant V as Vault/Connector Flow
  U->>M: Select install
  M->>R: Request compatibility and dependency resolution
  R->>P: Evaluate policy eligibility
  P-->>R: Decision and required approvals
  R-->>M: Manifest, permissions, dependencies, risks
  U->>M: Confirm scopes/configuration
  M->>V: Authorized OAuth/secret binding flow
  V-->>R: Opaque binding reference
  R-->>M: Installation lifecycle state
```

The permission review uses plain language and technical detail: capabilities, data classes, domains, local access, secret types, sandbox tier, telemetry, required approvals, dependencies, publisher signature, and rollback behavior. Installation is incomplete until required configuration and health gates succeed.

## 11.4 Updates, failure, and recovery

Updates show changelog, changed permissions, compatibility changes, rollout channel, required reauthorization, and rollback availability. Permission expansion requires fresh review. Failed install/configuration enters a resumable state with safe diagnostics. Quarantined/suspended extensions display reason category, impact on tasks/workflows, and authorized remediation; details are role-filtered.

# 12\. Settings

## 12.1 Structure

Settings are grouped by scope and clearly labeled:

* Account: profile, sessions, MFA, personal preferences, data export.
* Workspace: membership-visible preferences, defaults, retention summaries, workspace integrations.
* AI and Models: allowed providers/models, routing preferences within policy, budgets, local model status.
* Permissions: grants, approvals, device/application access, revocations.
* Desktop: device pairing, tray, startup, local folders, browser profiles, diagnostics, update channel where permitted.
* Privacy and Security: data handling, memory controls, connected sessions, trusted devices, audit access.
* Notifications: channels, quiet hours, lock-screen privacy, escalation behavior.
* Themes and Accessibility: theme, contrast, density, motion, keyboard preferences.
* Advanced and Developer: API keys, webhook settings, MCP development, logs, experimental flags where role permitted.

## 12.2 Settings state and safety

Each setting declares scope, owner, effective policy source, current value, inheritance, last changed actor/time, validation, and rollback behavior. Client-side optimistic state is allowed only for low-risk personal presentation preferences. Security, permission, model, privacy, device, integration, and organization settings wait for canonical confirmation.

Sensitive controls require step-up authentication where defined by Identity/Policy. Changing a setting surfaces dependent effects, active-task impact, and whether existing grants/workflows are affected. The client never displays secret values after entry; it displays opaque binding status and rotation metadata only.

# 13\. Admin Experience

## 13.1 Roles and scope

Admin Console is role-filtered and organization-scoped. It presents organization, members, roles, policies, audit, billing, usage, devices, analytics, marketplace governance, and enterprise controls. It does not embed policy implementation logic; all changes use authoritative APIs and produce audited outcomes.

## 13.2 Major modules

| Module | User outcomes | Guardrails |
| --- | --- | --- |
| Organizations | organization profile, workspaces, templates | ownership transfer and deletion require heightened confirmation |
| Members and roles | invite, deactivate, role change, access review | least privilege preview, MFA/SSO policy, audit |
| Policies | inspect effective policy, propose/manage approved policy versions | simulation/diff before apply, inheritance visibility, no client enforcement |
| Audit | search/export immutable records | redaction, legal hold, export authorization/watermarking |
| Billing and usage | budgets, attribution, invoices/entitlements | no raw payment secrets, bounded export |
| Devices | trust, posture, version, revoke, groups | revocation confirmation and impact summary |
| Analytics | adoption, reliability, approvals, security trends | aggregation/minimum cohort privacy controls |

## 13.3 Policy administration UX

Policy pages distinguish configured policy, effective policy, inherited policy, and runtime decision. Before a policy change, admins see affected workspaces/devices/extensions, potential task interruption, precedence, and rollback path. Simulation is a non-authoritative decision preview using declared sample inputs and version references. Applying policy is asynchronous, audited, observable, and reports propagation state; the UI never claims immediate device enforcement until signed bundle delivery/acknowledgement confirms it.

# 14\. Real-Time Experience

## 14.1 Contract and state

Web real-time clients use authenticated, workspace-filtered, resumable WebSocket/SSE contracts through API Gateway. The client provides cursor, acknowledgement where the contract requires it, bounded buffer, reconnect backoff, token refresh, and explicit resync. Server state remains authoritative.

```
stateDiagram-v2
  \[\*\] --> Connecting
  Connecting --> Connected: authenticated and subscribed
  Connected --> Reconnecting: transport loss/token renewal
  Reconnecting --> Resyncing: cursor accepted or snapshot needed
  Resyncing --> Connected
  Connected --> Offline: user/network unavailable
  Offline --> Connecting
  Connected --> Revoked: access removed
  Revoked --> \[\*\]
```

## 14.2 Streaming, notifications, presence, collaboration

Streaming content uses stable event IDs and semantic units. Progress rendering is monotonic only when event contract guarantees it; otherwise it displays “updated” rather than false percent completion. Notifications are derived from durable events and are not approval proof. Presence is opt-in/policy-controlled, minimal, and avoids exposing sensitive task titles or activity. Live collaboration uses server-mediated roles, conflict indicators, immutable versions, and explicit cursor/selection privacy boundaries.

## 14.3 Offline behavior

The experience client supports read-only cached shell and explicitly marked stale task/activity summaries where policy permits. It can retain local drafts and queue only non-authoritative intent submissions with idempotency keys; submissions requiring current policy, approval, export, install, secret binding, or destructive action wait for reconnect. Offline UI never claims a task has started, stopped, or been approved until canonical acknowledgement arrives.

# 15\. State Management

## 15.1 State model

```
flowchart TB
  SERVER\[Canonical Backend and Runtime State\] --> CACHE\[Authorized Query Cache\]
  RT\[Real-time Event Stream\] --> CACHE
  CACHE --> VIEW\[Derived View State\]
  LOCAL\[Local UI Preferences and Drafts\] --> VIEW
  VIEW --> ACTION\[Intent Submission\]
  ACTION --> SERVER
```

State classes:

| State | Owner | Client behavior |
| --- | --- | --- |
| Global/session | Identity and Workspace services | hydrate at boot; clear on sign-out/revocation |
| Workspace | Workspace/Policy projections | key cache by workspace and policy version |
| Task | Task Service and execution projections | authoritative server state with event updates |
| Chat | conversation/task services | stream with resumable cursor and draft isolation |
| Workflow | Workflow Service/AI Runtime references | immutable versions; local draft separate |
| Plugin | Registry and device health | lifecycle projection; no assumed availability |
| Connection | client transport | local finite state machine; never authority |
| Offline | client/device network state | stale labels, queue safe drafts only |

## 15.2 Cache, synchronization, and conflict resolution

All cache entries include tenant/workspace scope, resource ID, authorization context/version where available, ETag/version, freshness, and invalidation behavior. Sensitive content uses memory-only or encrypted policy-approved persistence; no secrets or broad artifact content is persisted by default.

Optimistic updates are permitted only for reversible, low-risk UI preferences and explicitly idempotent domain commands with server reconciliation. Approvals, permissions, revocations, policy changes, external mutations, installations, and task terminal state are never optimistically finalized.

Conflict hierarchy follows Architecture Bible: single-writer canonical state wins for tasks, grants, approvals, leases, and workflow publication; merge functions apply only to declared mergeable drafts; all other conflicts require server-mediated reconciliation. The UI renders conflict source/version and offers safe actions.

# 16\. Accessibility

The target is WCAG 2.2 AA for web and key desktop flows, with platform-native accessibility APIs for desktop surfaces.

## 16.1 Required accessibility contracts

* Every action is keyboard reachable with visible focus and logical tab order.
* Semantic landmarks, headings, labels, descriptions, error associations, and live-region announcements are present.
* Approval, task status, upload, streaming, and error updates announce without excessive interruption.
* Contrast meets theme-specific targets; color is never the only signal.
* Reduced motion, high contrast, text scaling, zoom, and forced-colors modes are supported.
* Drag-and-drop has keyboard equivalents and non-spatial alternatives.
* Graphs/charts provide text summary, data table/list alternative, and keyboard exploration.
* Timeouts show expiration and allow extension where policy permits.
* Localization architecture supports locale-aware date/time, number, plural, directionality, strings, and future RTL layouts.

## 16.2 Accessibility testing

Automated linting and axe-style checks are baseline only. Manual tests cover screen readers, keyboard-only operation, magnification, high contrast, reduced motion, mobile screen readers, native approval notifications, complex tables, code/log views, graph editor, and emergency controls. Accessibility regressions in approval, task control, authentication, or security settings are release blockers.

# 17\. Performance

## 17.1 Experience budgets

| Interaction | Target |
| --- | --- |
| Initial authenticated shell usable | p75 under 2.5 s on supported network/device profile |
| Route transition from cached data | under 200 ms visual feedback; data may continue streaming |
| Standard API-backed list interaction p95 | under 500 ms excluding network/provider delay |
| Task status freshness p95 when connected | under 3 s, per backend objective |
| Device event delivery visibility p95 when connected | under 2 s after user-visible projection availability |
| Command palette open | under 100 ms after shell ready |
| Input response | under 100 ms for local typing/selection |
| Large timeline/table | virtualized; no main-thread long task above 50 ms sustained target |

## 17.2 Strategy

Use route-level lazy loading, component/code splitting, virtualized lists/tables/logs, progressive graph rendering, image/artifact thumbnails, cache-aware prefetching, request deduplication, pagination/cursors, streaming, and background workers for expensive layout/search processing. Bundle budgets are owned per route and monitored by CI. The client must not load heavy graph/editor/analytics modules in routine chat/task creation paths.

Performance degradation favors function over decoration: disable nonessential animation, defer previews, collapse large trees, summarize old streaming chunks, and offer “load more” rather than blocking task control. No performance optimization may omit security redaction, authorization refresh, or audit-relevant confirmation.

# 18\. Security

## 18.1 Session and UI security

Authentication follows Identity contracts: short-lived access, protected refresh handling, session visibility/revocation, step-up authentication, secure logout, CSRF/origin protection, and authenticated real-time channels. The client never assumes a visible button proves access; every mutation is server-authorized.

Sensitive UI uses redacted-by-default rendering, explicit reveal controls where permitted, timeout/re-hide behavior, anti-caching headers/contracts, no sensitive values in route state, and restricted screen/clipboard behavior where platform capability permits. The product must state platform limitations honestly; clipboard cannot be universally secured after user copies content.

## 18.2 Permission-aware and approval UI

Permission state is rendered as granted, pending, denied, expired, revoked, inherited, unavailable, or requires OS consent. A grant view includes subject, scope, actions, conditions, duration, source, and revoke path. Approval UI is distinct from chat confirmation and includes impact, destination, reversibility, evidence, expiration, scope alternatives, and authoritative decision receipt.

## 18.3 Redaction and content safety

Client logging, analytics, session replay, error reporting, screenshots, DOM inspection, exports, and support bundles use redaction rules before transmission. Session replay is disabled by default for sensitive routes and must mask user-entered and protected fields. Untrusted content is labeled and sanitized before display; it cannot render executable content, modify UI policy, or create trusted-system visual affordances.

# 19\. Observability

## 19.1 Experience telemetry

The Experience Platform emits structured, privacy-aware telemetry using the standard observability SDK. Every event includes safe route/component context, workspace/tenant scope where permitted, correlation/causation ID, client version, accessibility/theme context when consented, performance timing, and error category. It never includes secrets, raw attachment content, full prompt text by default, private artifact content, or sensitive approval payloads.

## 19.2 Metrics

* Core Web/Desktop vitals, route load, bundle size, long tasks, render latency, input delay, memory use.
* UX: task creation completion, plan review rate, approval comprehension/decision latency, recovery success, time to find evidence, command palette use, abandonment.
* Reliability: real-time reconnect, stale projection rate, cache invalidation, client error rate, failed mutations, offline queue outcomes.
* Accessibility: keyboard completion, focus trap failures, screen-reader announcement failures, contrast/regression results.
* Security: unauthorized view/mutation responses, redaction failures, clipboard warning interactions, session/reveal timeout events.

## 19.3 Errors, traces, and replay

Errors show safe correlation IDs and propagate trace context to backend requests. Session replay integration is consented, sampled, redacted, route-restricted, retention-controlled, and disabled for credentials, approval body details, artifact previews, private memory, admin policy editing, and other designated sensitive surfaces. Operators can connect a client event to task, graph, approval, audit, and device traces without exposing protected payloads.

# 20\. Testing

## 20.1 Test matrix

| Layer | Coverage |
| --- | --- |
| Unit | state reducers, selectors, formatting, token/theme behavior, validation, redaction, accessibility helpers |
| Component | keyboard/focus, ARIA, loading/error/offline states, responsive variants, telemetry safety |
| Contract | API/GraphQL, WebSocket/SSE cursors, event schemas, authorization/error mappings, feature compatibility |
| Integration | task/chat/activity synchronization, approval flows, workflow drafts, memory/graph filtering, marketplace install state |
| Visual regression | themes, density, responsive layouts, status/risk states, graph and artifact panels |
| Accessibility | automated and manual assistive-technology journeys |
| Performance | bundle budgets, list virtualization, long-stream rendering, graph scale, reconnect behavior |
| End-to-end | PRD core journeys across web and desktop companion controls |
| Security | XSS/content sanitization, authz UI bypass attempts, cache leakage, redaction, CSRF/origin, clipboard/export controls |
| Chaos/recovery | event duplication, cursor gaps, network loss, stale policy, revocation, server partial outage, conflicting edits |

## 20.2 Quality gates for every major page

Each major page must document and pass:

* Definition of Done: scope, owner, state model, interfaces, empty/loading/error/offline states, telemetry, and runbook link.
* Acceptance Criteria: user outcome, authorized actions, evidence visibility, responsive behavior, and deep-link behavior.
* Performance Budget: route JS/CSS/media contribution, render/list/graph budgets, API/streaming behavior.
* Accessibility Checklist: keyboard, focus, semantic structure, contrast, screen-reader announcements, reduced motion, zoom, localization.
* Security Checklist: authorization recheck, cache/redaction, safe URL state, logging/replay masking, sensitive action confirmation.
* Testing Matrix: unit, component, contract, integration, visual, a11y, performance, E2E, security, and recovery coverage proportional to risk.
* Failure Recovery: retry/reconnect, stale state, conflict, revocation, offline, partial data, and escalation behavior.

Release blockers include skipped or ambiguous approval UI, cross-workspace data display, secret/protected-content exposure, inaccessible emergency control, unbounded rendering/resource regression, missing task evidence linkage, unsafe optimistic mutation, or inability to recover from a real-time cursor gap.

# 21\. Major Page Specifications and Quality Gates

## 21.1 Dashboard

Responsibilities: orient users, surface active work, approvals, device health, recent outcomes, cost/budget alerts, and safe quick starts. Non-responsibilities: replace detailed task investigation or provide unfiltered global analytics.

State: selected workspace; dashboard query/filter state; server cards; live status; local dismissed low-priority notices. Flow: select workspace → inspect attention item → open task/approval/device → act through authoritative surface. Dependencies: Task, Activity, Device, Approval, Usage, Notification services. Offline: cached timestamped summary only; no task-control claims.

Component hierarchy: shell → dashboard grid → command card / approval inbox / active tasks / device health / recent activity / playbooks / usage summary. Performance: initial above-fold cards prioritize approvals and active tasks; defer analytics. Security: all counts and cards are workspace-filtered. Acceptance: a user can identify the highest-priority next action within one screen and reach it in one interaction.

## 21.2 Tasks and Task Detail

Responsibilities: create, filter, inspect, supervise, pause/resume/cancel, approve, recover, duplicate, archive, and export authorized task evidence. State: canonical task projection, graph, activity cursor, inspector tab, local draft annotations, live connection. Navigation: Tasks list → Task Detail → graph node/evidence/artifact/approval; back preserves filters.

```
flowchart LR
  LIST\[Tasks List\] --> CREATE\[Create Task\]
  LIST --> DETAIL\[Task Detail\]
  DETAIL --> GRAPH\[Execution Graph\]
  DETAIL --> EVID\[Evidence and Artifacts\]
  DETAIL --> APPR\[Approvals\]
  DETAIL --> REC\[Recovery and Overrides\]
```

Failure: unknown outcome renders reconciling; task controls are disabled until server state resolves. Recovery: present only backend-permitted actions and their consequences. Testing: state-transition contract tests, cancellation/revocation E2E, long-history virtualization, accessibility of graph/list alternative.

## 21.3 Workflow Builder

Definition of Done: immutable drafts/version history, keyboard graph authoring, validation, simulation isolation, policy/compatibility reporting, publish/rollback flows, and complete audit links. Performance: progressive canvas layout and node virtualization. Security: no live external execution from simulation; publication server-authorized. Acceptance: an authorized power user can create a valid bounded workflow, understand every required permission/approval, simulate it safely, and submit it for publication.

## 21.4 Memory Explorer and Knowledge Graph

Definition of Done: policy-filtered search, provenance, retention/deletion explanation, version history, graph/list alternative, revoked-content eviction, and export authorization. Performance: server-side search and graph aggregation. Accessibility: full table/list alternative and keyboard graph path exploration. Acceptance: a user can determine source, confidence, scope, and retention of a memory/relationship and request authorized correction/deletion without ambiguity.

## 21.5 Marketplace

Definition of Done: signed-manifest trust display, compatibility/dependency resolution, permission review, secret/OAuth binding handoff, lifecycle statuses, update/rollback and quarantined states. Security: never expose secret values or execute packages client-side. Acceptance: a user can understand exactly what an extension can access, why, where it runs, and how to revoke/uninstall it.

## 21.6 Settings and Admin

Definition of Done: scope/inheritance display, server-confirmed mutations, step-up flow, policy impact preview, propagation status, audit links, and safe rollback where supported. Accessibility: complex policy data has accessible tables and diff summaries. Acceptance: an administrator can distinguish configured, inherited, and effective policy and can verify deployment to devices without assuming immediate enforcement.

# 22\. Future Evolution

## 22.1 Platform expansion

Mobile and tablet remain supervision-first until an approved runtime model expands safely. macOS and Linux use the same experience contracts but disclose capability differences from Desktop Agent platform matrices. AR/VR and voice-first experiences are future views over the same task, evidence, approval, and accessibility semantics; they must not create a second authority model.

## 22.2 Multi-user collaboration and white-label

Collaboration evolves through workspace roles, presence, comments/annotations, task handoffs, immutable draft versions, server-mediated conflict resolution, and auditable approvals. Enterprise white-labeling may theme semantic tokens, logos, domains, catalogs, and navigation configuration, but cannot hide mandatory security, evidence, approval, data-handling, or policy disclosures.

## 22.3 Evolution constraints

Future experience surfaces must preserve policy-enforced authority, server-owned state, signed lease visibility, event/audit traceability, accessibility, data classification, no-secret handling, offline boundaries, and contract compatibility. New cross-cutting client storage, analytics, collaboration transport, rendering engine, or deployment model requires ADR review where it changes parent architecture.

# Appendix A. Experience Event Taxonomy

| Event | Purpose |
| --- | --- |
| `experience_route_viewed` | authorized route and performance measurement |
| `task_draft_started` / `task_submitted` | task creation funnel and correlation |
| `plan_viewed` / `evidence_opened` | transparency and comprehension measurement |
| `approval_presented` / `approval_action_submitted` | approval latency and usability; no sensitive body payload |
| `task_control_requested` | pause/resume/cancel/recovery intent outcome |
| `realtime_resync_started` / `realtime_resync_completed` | live-state health |
| `workflow_validation_viewed` / `workflow_publish_requested` | governed workflow lifecycle |
| `memory_correction_requested` / `memory_deletion_requested` | memory governance activity |
| `extension_install_requested` / `extension_update_requested` | marketplace lifecycle |
| `accessibility_preference_changed` | accessibility adoption, consented and non-sensitive |

# Appendix B. EDD Conformance Checklist

* Inherits all parent documents without redefining architecture.
* Keeps UI outside authorization, policy, execution, and canonical datastore ownership.
* Defines navigation, state, real-time/offline behavior, failure/recovery, performance, accessibility, security, observability, extension points, and testing.
* Uses existing API, event, ACP, lease, policy, registry, artifact, memory, audit, and service boundaries.
* Treats model/plugin/browser/external content as untrusted and labels it appropriately.
* Provides evidence-first, approval-safe, recovery-aware experience flows.
* Requires ADR review for changed trust boundaries, contracts, persistence, or platform-wide behavior.

This EDD defines the NexusOS experience layer as a transparent, accessible, policy-governed operating workspace. Engineering and design teams must expand unresolved implementation detail without weakening any parent invariant or inventing a new architectural assumption.