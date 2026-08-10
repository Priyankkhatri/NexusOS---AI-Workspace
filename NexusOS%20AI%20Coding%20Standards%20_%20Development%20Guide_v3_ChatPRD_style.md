# NexusOS AI Coding Standards & Development Guide

## Document Control

  -----------------------------------------------------------------------
  Field                               Value
  ----------------------------------- -----------------------------------
  Status                              Engineering constitution

  Product                             NexusOS

  Scope                               All NexusOS source code,
                                      infrastructure, contracts, tooling,
                                      documentation, and AI-assisted
                                      development

  Authority                           Inherits NexusOS Enterprise PRD v3,
                                      Architecture Bible, Desktop Agent
                                      EDD, Backend EDD, AI Runtime EDD,
                                      Experience Platform EDD, and API
                                      Contract Specification

  Normative language                  MUST, MUST NOT, SHOULD, SHOULD NOT,
                                      MAY retain the meanings defined by
                                      the Architecture Bible

  Architecture changes                Prohibited through routine
                                      implementation; require accepted
                                      ADR

  Implementation code                 Out of scope

  Primary development environment     Governed NexusOS monorepo

  Primary AI development systems      Antigravity, Codex,
                                      GPT/Gemini/Groq-based agents,
                                      approved local models
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## Authority and Conformance

This document is the official engineering constitution for NexusOS
implementation.

It incorporates by reference:

1.  NexusOS Enterprise PRD v3.
2.  NexusOS Architecture Bible --- Pre-EDD Foundation.
3.  NexusOS Desktop Agent Engineering Design Document.
4.  NexusOS Backend Engineering Design Document.
5.  NexusOS AI Runtime Engineering Design Document.
6.  NexusOS Experience Platform Engineering Design Document.
7.  NexusOS API Contract Specification.

The Architecture Bible remains normative for system boundaries,
ownership, trust, contracts, event-driven communication, leases, policy,
security, observability, deployment, and ADR governance.

The EDDs remain normative for subsystem implementation boundaries.

The API Contract Specification remains normative for inter-system
communication.

This document governs how contributors implement those decisions.

No contributor may silently redefine a parent decision.

If a conflict is discovered:

1.  Stop if it affects architecture, security, authorization, data
    ownership, contracts, destructive behavior, or a trust boundary.
2.  Identify the conflicting statements.
3.  Identify affected components.
4.  Assess implementation impact.
5.  Propose an ADR or explicit clarification.
6.  Do not silently choose a preferred interpretation.

------------------------------------------------------------------------

# 1. Engineering Constitution

## 1.1 Engineering Philosophy

NexusOS engineering MUST optimize for:

-   Durability
-   Explicit contracts
-   Modularity
-   Replaceability
-   Security-by-default
-   Least privilege
-   Observable behavior
-   Testability
-   Performance
-   Operational recoverability
-   Accessibility
-   Clear ownership
-   Reproducibility
-   Controlled evolution
-   Safe AI-assisted development

The engineering system must make unsafe behavior difficult to implement
accidentally.

## 1.2 Core Principles

  -----------------------------------------------------------------------
  Principle                           Standard
  ----------------------------------- -----------------------------------
  Architecture                        Preserve established boundaries and
                                      invariants

  Contracts                           Implement against versioned
                                      contracts, never assumptions

  Security                            Fail closed for authority and
                                      sensitive operations

  Reliability                         Prefer durable state and explicit
                                      reconciliation

  Observability                       Material behavior must be traceable

  Replaceability                      Providers and adapters remain
                                      replaceable

  Testing                             Validate behavior at appropriate
                                      risk layers

  Performance                         Respect explicit resource and
                                      latency budgets

  Ownership                           Every critical artifact has an
                                      owner

  AI development                      AI agents implement approved
                                      architecture; they do not silently
                                      redesign it
  -----------------------------------------------------------------------

## 1.3 Normative Terms

  Term         Meaning
  ------------ ----------------------------------------
  MUST         Mandatory requirement
  MUST NOT     Prohibited behavior
  SHOULD       Expected unless justified otherwise
  SHOULD NOT   Strongly discouraged
  MAY          Optional
  BLOCKER      Finding that prevents merge or release

## 1.4 Engineering Invariants

Contributors MUST preserve:

1.  Policy engine authority.
2.  Immutable auditability of externally observable mutations.
3.  Idempotency or reconciliation for mutations.
4.  Data classification and access boundaries.
5.  Capability-based execution.
6.  Signed, expiring execution leases.
7.  Service-owned canonical data.
8.  Compensation, snapshots, or explicit irreversibility for destructive
    actions.
9.  Offline authority restrictions.
10. Server-side authorization.
11. Plugin and connector isolation.
12. Provider neutrality.
13. Versioned public contracts.
14. Explicit observability.
15. Bounded retries, concurrency, budgets, and recursion.

------------------------------------------------------------------------

# 2. Source-of-Truth Hierarchy

When implementing a task, inspect sources in this order:

1.  Applicable accepted ADRs
2.  Architecture Bible
3.  Relevant subsystem EDD
4.  API Contract Specification
5.  Enterprise PRD requirements
6.  This Coding Standards guide
7.  Existing implementation conventions
8.  General engineering judgment

This hierarchy does not authorize implementation code to override
architecture or contracts.

## 2.1 Parent-Document Rule

Lower-level documents may select implementation details only when they
do not change parent invariants.

A contributor MUST NOT:

-   Convert a runtime boundary into a direct service dependency.
-   Convert a policy decision into model behavior.
-   Convert an event into an implicit command.
-   Convert a scoped lease into ambient authority.
-   Convert a replaceable adapter into hard-coded provider logic.

------------------------------------------------------------------------

# 3. Repository Standards

## 3.1 Monorepo Strategy

NexusOS begins as a governed monorepo.

Polyrepo extraction requires an accepted ADR demonstrating:

-   Independent release cadence
-   Access boundary
-   Build requirements
-   Contract maturity
-   Operational ownership
-   Versioning strategy

## 3.2 Repository Ownership

Every package, service, runtime, contract, critical datastore, and
infrastructure module MUST have:

-   Owning team
-   Technical steward
-   CODEOWNERS entry
-   Security classification
-   Dependency policy
-   Test ownership
-   Runbook
-   Support/on-call classification

## 3.3 Recommended Logical Structure

``` text
nexusos/
├── docs/
├── architecture/
├── adrs/
├── threat-models/
├── packages/
│   ├── contracts/
│   ├── api/
│   ├── events/
│   ├── acp/
│   ├── capability-manifests/
│   ├── sdk/
│   ├── plugin-sdk/
│   ├── agent-sdk/
│   └── workflow-sdk/
├── apps/
│   ├── web-dashboard/
│   ├── desktop-agent/
│   ├── mobile-companion/
│   └── cli/
├── services/
├── runtimes/
├── infrastructure/
├── tests/
├── tools/
└── scripts/
```

The Sprint 0 Blueprint may refine this structure, but it MUST preserve
the architectural boundaries.

## 3.4 Dependency Graph

CI MUST detect:

-   Circular dependencies
-   Unauthorized imports
-   Cross-service implementation imports
-   Layer violations
-   Forbidden package usage
-   Undeclared dependencies

`contracts` MUST remain implementation-independent.

Applications depend on contracts/SDKs, not service internals.

Services do not write another service's canonical datastore.

Runtimes do not import control-plane domain implementations.

------------------------------------------------------------------------

# 4. Package and Module Boundaries

Every module MUST have:

-   Purpose
-   Owner
-   Public interfaces
-   Allowed dependencies
-   Forbidden dependencies
-   Tests
-   Failure behavior
-   Security classification

## 4.1 Shared Libraries

Shared libraries MUST be:

-   Small
-   Stable
-   Dependency-light
-   Deterministic
-   Free of hidden network behavior
-   Explicitly owned

Shared libraries MUST NOT become dumping grounds for unrelated helpers.

## 4.2 Generated Artifacts

Generated artifacts MUST identify:

-   Generator
-   Generator version
-   Source contract
-   Regeneration command
-   Ownership

Manually editing generated files is prohibited unless the generator
contract explicitly allows it.

------------------------------------------------------------------------

# 5. Architecture Rules

## 5.1 Layered Architecture

Implementation must respect:

-   Experience Plane
-   Control Plane
-   Runtime Plane
-   Data Plane
-   Ecosystem Plane

## 5.2 Dependency Inversion

High-level policy MUST NOT depend directly on concrete low-level
implementations.

Use:

-   Interfaces
-   Ports
-   Adapters
-   Factories
-   Dependency injection
-   Provider-neutral abstractions

## 5.3 SOLID

Apply SOLID where appropriate:

-   Single responsibility
-   Open/closed
-   Liskov substitution
-   Interface segregation
-   Dependency inversion

SOLID MUST NOT be used as justification for needless abstraction.

## 5.4 Composition

Prefer composition over inheritance.

Inheritance is restricted to framework-required patterns or tightly
controlled internal technical hierarchies.

## 5.5 Interface-First Development

Before implementing an externally visible capability:

1.  Locate an existing contract.
2.  Determine whether it is sufficient.
3.  If insufficient, initiate contract change governance.
4.  Define version and compatibility.
5.  Add contract tests.
6.  Obtain required approval.
7.  Implement.

------------------------------------------------------------------------

# 6. Naming Standards

  Artifact                Standard
  ----------------------- --------------------------------------------------------
  Files                   `lower_snake_case` unless ecosystem requires otherwise
  Folders                 `lower_snake_case`
  TypeScript variables    `lowerCamelCase`
  Python variables        `snake_case`
  Constants               `UPPER_SNAKE_CASE`
  Classes                 `PascalCase`
  Types/interfaces        `PascalCase`
  React components        `PascalCase`
  React hooks             `useXxx`
  DB tables               `snake_case`
  DB indexes              `idx_<table>_<purpose>`
  Environment variables   `UPPER_SNAKE_CASE`
  Events/topics           Canonical API Contract names

Names MUST express domain meaning.

Generic names such as `Helper`, `Manager`, `Utils`, and `Common` SHOULD
be avoided unless their scope is truly generic.

------------------------------------------------------------------------

# 7. Language and Framework Standards

## 7.1 Python

Use:

-   Type annotations
-   Black or approved formatter
-   Ruff/approved linting
-   mypy or approved type checker
-   Pydantic at contract boundaries
-   Structured logging
-   Explicit dependency injection

Avoid unnecessary metaprogramming and magic behavior.

## 7.2 TypeScript

Use:

-   Strict mode
-   Explicit public types
-   `readonly` where appropriate
-   Generated contract types
-   ESLint
-   Prettier

Unbounded `any` is prohibited.

## 7.3 React / Experience Platform

Prefer:

-   Function components
-   Hooks
-   Strict props
-   Accessible interactions
-   Feature boundaries
-   Testable state transitions
-   Explicit server/client boundaries

No direct backend/database/desktop implementation imports.

## 7.4 Next.js

Use the approved routing/rendering model.

Presentation components MUST NOT become unauthorized data-access layers.

## 7.5 Electron / Desktop

Renderer processes MUST NOT receive unrestricted Node privileges.

IPC MUST use authenticated, versioned contracts.

Sensitive capabilities remain behind Desktop Agent execution boundaries.

## 7.6 FastAPI

Use:

-   Type-annotated endpoints
-   Explicit Pydantic schemas
-   Dependency injection
-   Input validation
-   OpenAPI
-   Structured errors
-   Contract-generated types where available

## 7.7 SQL

Use:

-   Parameterized queries
-   Migration tooling
-   Explicit ownership
-   Transaction boundaries
-   Tested schema changes
-   Compatibility checks

## 7.8 Shell

Use:

-   ShellCheck
-   Safe quoting
-   No secrets
-   Explicit error handling
-   Destructive-operation safeguards

------------------------------------------------------------------------

# 8. Dependency Governance

## 8.1 Dependency Evaluation

Every new dependency requires assessment of:

-   Purpose
-   Existing alternatives
-   Maintenance health
-   License
-   Security history
-   Provenance
-   Transitive dependency impact
-   Runtime/bundle impact
-   Compatibility
-   Performance
-   Long-term ownership

## 8.2 Dependency Requirements

Dependencies MUST:

-   Be lockfile-pinned
-   Pass vulnerability scanning
-   Pass license policy
-   Have known provenance
-   Be reproducibly installable

## 8.3 AI Dependency Rule

AI agents MUST NOT add dependencies merely because they make
implementation easier.

An AI proposing a dependency MUST report:

-   Package
-   Version
-   Purpose
-   Alternatives
-   Security/license findings
-   Affected packages
-   Approval required

------------------------------------------------------------------------

# 9. Configuration and Secrets

## 9.1 Configuration

Configuration MUST be:

-   Typed
-   Versioned where material
-   Validated
-   Observable
-   Environment-appropriate
-   Safe to roll back

Security baselines cannot be overridden by ordinary configuration.

## 9.2 Secrets

Secrets MUST use approved vault/credential facilities.

Secrets MUST NOT appear in:

-   Source control
-   Logs
-   Events
-   Traces
-   Prompts
-   Screenshots
-   Crash dumps
-   Artifacts
-   Plugin exports
-   Generated documentation

AI agents MUST treat secret exposure as a blocker.

------------------------------------------------------------------------

# 10. Error Handling and Recovery

All components MUST use the standard error taxonomy.

Errors MUST be:

-   Classified
-   Actionable
-   Traceable
-   Sanitized
-   Observable

## 10.1 Retry

Retries MUST be:

-   Bounded
-   Classified
-   Backoff-aware
-   Idempotency-aware
-   Budget-aware

Do not retry ambiguous external mutations.

## 10.2 Timeout

Remote, process, model, browser, plugin, and failure-prone operations
MUST have explicit timeouts.

## 10.3 Circuit Breakers

Remote providers and unstable dependencies SHOULD use circuit breakers.

## 10.4 Recovery

Recovery MUST prefer:

-   Reconciliation
-   Checkpoints
-   Compensation
-   Snapshots
-   Safe pause

over blind repetition.

------------------------------------------------------------------------

# 11. Logging and Observability

Logs MUST be structured.

Minimum context where applicable:

-   Timestamp
-   Severity
-   Service
-   Component
-   Correlation ID
-   Request ID
-   Trace ID
-   Task/step ID
-   Outcome
-   Classification

Never log secrets or unapproved sensitive data.

## 11.1 Audit

Security, authorization, approvals, destructive actions, configuration
changes, plugin lifecycle, device trust, and privileged operations MUST
produce audit evidence.

## 11.2 Traceability

A task correlation ID MUST propagate through:

``` text
Task
→ Graph
→ Node
→ Policy Decision
→ Lease
→ ACP
→ Tool Receipt
→ Artifact
→ Event
→ Audit
→ Notification
→ Model/AI Runtime request
```

------------------------------------------------------------------------

# 12. Testing Standards

NexusOS testing validates both conventional software correctness and
agentic safety.

## 12.1 Test Layers

  Layer              Focus
  ------------------ --------------------------------------------------
  Unit               State machines, policy logic, parsers, schemas
  Component          Runners, adapters, model router, connectors
  Contract           API, events, ACP, plugins
  Integration        Services, device gateway, storage, OAuth, queues
  End-to-end         Full user journeys
  Security           AuthZ, injection, secrets, sandbox
  Reliability        Restart, reconnect, replay, outage
  Performance        Latency, throughput, resource budgets
  Accessibility      Keyboard, focus, screen readers
  Agent evaluation   Planning, tool choice, refusal, task success

## 12.2 Coverage

Default minimum for governed core modules:

-   80% unit coverage
-   80% contract coverage

Lower thresholds require an approved exception.

Coverage alone does not prove correctness.

## 12.3 Agent Evaluation

AI behavior MUST be evaluated for:

-   Plan quality
-   Correct tool selection
-   Permission compliance
-   Safe refusal
-   Recovery behavior
-   Evidence quality
-   Regression
-   Prompt-injection resistance

------------------------------------------------------------------------

# 13. Database and Migration Standards

Database changes are controlled changes.

Every migration MUST define:

-   ID
-   Owner
-   Purpose
-   Forward path
-   Compatibility impact
-   Rollback/recovery
-   Data integrity validation
-   Test plan
-   Production risk

## 13.1 Destructive Changes

Explicit approval is required for:

-   Drop table
-   Drop column
-   Truncation
-   Irreversible transformations
-   Bulk deletion
-   Unrecoverable data changes

Prefer:

``` text
Expand
→ Migrate
→ Validate
→ Contract
```

AI agents MUST stop before destructive production changes.

------------------------------------------------------------------------

# 14. API and Event Development

The API Contract Specification is authoritative.

## 14.1 Contract-First

Every public API, event, WebSocket message, ACP message, plugin
contract, or externally consumed schema MUST have:

-   Contract ID
-   Owner
-   Version
-   Schema
-   Classification
-   Compatibility rules
-   Tests

## 14.2 Breaking Changes

Require:

-   Consumer impact analysis
-   Migration plan
-   Deprecation period
-   Approval
-   Version update
-   Release documentation

AI agents MUST NOT invent contract schemas.

------------------------------------------------------------------------

# 15. Git Standards

## 15.1 Branches

Use:

``` text
feature/
bugfix/
hotfix/
refactor/
docs/
chore/
release/
```

## 15.2 Commits

Use Conventional Commits.

Examples:

``` text
feat(runtime): add provider fallback routing
fix(desktop): reconcile expired lease
test(api): add task contract validation
docs(architecture): clarify runtime boundary
```

## 15.3 Pull Requests

Every PR MUST state:

-   Objective
-   Scope
-   Components changed
-   Architecture impact
-   Contract impact
-   Security impact
-   Tests
-   Performance impact
-   Migration impact
-   Documentation impact
-   Known limitations

------------------------------------------------------------------------

# 16. Code Review Guide

## 16.1 Severity

  Severity        Merge rule
  --------------- ---------------------------------
  Blocker         Must fix
  Critical        Must fix
  Major           Must fix unless formally waived
  Minor           Fix or track
  Informational   Optional

## 16.2 Review Checklist

Reviewers MUST verify:

-   Architecture alignment
-   Contract compatibility
-   Security
-   Permission boundaries
-   Data ownership
-   Error handling
-   Tests
-   Observability
-   Performance
-   Accessibility
-   Documentation
-   Compatibility
-   AI change scope

------------------------------------------------------------------------

# 17. AI Development Constitution

AI agents include:

-   Antigravity
-   OpenAI Codex
-   GPT-based agents
-   Gemini-based agents
-   Groq-hosted models
-   Approved local models
-   Future coding agents

All agents are governed by the same engineering constitution.

A stronger model does not receive broader authority.

## 17.1 AI MUST NOT

-   Invent architecture
-   Invent public APIs
-   Invent event schemas
-   Invent permissions
-   Invent service boundaries
-   Add unapproved dependencies
-   Hardcode secrets
-   Bypass security
-   Modify frozen architecture documents
-   Perform destructive operations without approval
-   Silently resolve architectural conflicts
-   Rewrite unrelated modules
-   Add speculative features
-   Hide failures
-   Suppress failing tests without explanation

## 17.2 AI MAY

-   Inspect repositories
-   Analyze architecture
-   Implement approved tasks
-   Add tests
-   Refactor within scope
-   Fix defects
-   Improve documentation
-   Prepare ADR proposals
-   Propose architectural changes without applying them

------------------------------------------------------------------------

# 18. AI Autonomy Model

  ----------------------------------------------------------------------------------------
  Level                   Capability                               Approval
  ----------------------- ---------------------------------------- -----------------------
  L0                      Read/analyze                             None

  L1                      Isolated implementation change           None if scoped

  L2                      Tests/refactoring                        None if
                                                                   contract-preserving

  L3                      Dependency/configuration                 Human approval

  L4                      API/event/schema/migration change        Human approval

  L5                      Architecture/service/security-boundary   Human approval + ADR
                          change                                   
  ----------------------------------------------------------------------------------------

Autonomy applies to the change, not to the model.

------------------------------------------------------------------------

# 19. Human Approval Matrix

  Change                                                 Human approval
  ------------------------------------------------------ -------------------------------------
  Local bug fix                                          Not required if within scope
  Unit tests                                             Not required
  Local refactor                                         Not required if contract-preserving
  New dependency                                         Required
  Dependency removal with impact                         Required
  New API                                                Required
  Breaking API change                                    Required + migration
  New event                                              Required
  Event schema change                                    Required
  Production database migration                          Required
  Destructive migration                                  Required
  Authentication change                                  Required
  Authorization change                                   Required
  Permission change                                      Required
  Security boundary change                               Required
  New service                                            Required + ADR
  Architecture boundary change                           Required + ADR
  Secret configuration                                   Required
  Production deployment                                  Required
  Data deletion                                          Required
  Destructive filesystem action outside approved scope   Required

------------------------------------------------------------------------

# 20. AI Development Lifecycle

Every AI coding task follows:

``` text
Task Intake
    ↓
Read Applicable Documentation
    ↓
Inspect Repository
    ↓
Identify Architecture Boundary
    ↓
Identify Contract Impact
    ↓
Identify Data/Security Impact
    ↓
Determine Autonomy Level
    ↓
Define Change Scope
    ↓
Create Implementation Plan
    ↓
Implement Smallest Safe Change
    ↓
Run Tests
    ↓
Run Static Analysis
    ↓
Run Contract Validation
    ↓
Run Security Checks
    ↓
Review Diff
    ↓
Update Documentation
    ↓
Produce Completion Report
```

## 20.1 Repository Inspection

Before editing, the agent MUST inspect:

-   Existing implementation
-   Relevant tests
-   Applicable EDD
-   API contracts
-   Dependencies
-   Nearby conventions
-   Configuration
-   Security boundaries

It MUST NOT infer implementation solely from filenames.

## 20.2 Smallest Safe Change

Prefer:

``` text
Small change
→ validate
→ test
→ review
→ continue
```

over uncontrolled rewrites.

------------------------------------------------------------------------

# 21. AI Stop Conditions

An AI MUST stop and request clarification when:

-   Documents conflict
-   Contract is missing
-   Data ownership is unclear
-   Permission is unclear
-   Breaking change may occur
-   Security boundary may change
-   Destructive operation is required
-   Production impact is unclear
-   Unapproved dependency is required
-   Database migration is ambiguous
-   Implementation contradicts a frozen contract
-   Tests reveal an architectural inconsistency

The agent MUST report the blocker instead of guessing.

------------------------------------------------------------------------

# 22. AI Change-Scope Control

Every AI task MUST have an explicit scope.

Agents SHOULD NOT:

-   Rewrite entire modules unnecessarily
-   Reformat unrelated files
-   Rename unrelated symbols
-   Upgrade unrelated dependencies
-   Refactor unrelated architecture
-   Change unrelated tests
-   Modify frozen architecture documents
-   Add speculative features

Scope expansion must be reported and approved when it crosses an
authority boundary.

------------------------------------------------------------------------

# 23. AI-Generated Code Trust Pipeline

AI-generated code is untrusted until validated.

``` text
Generated
   ↓
Static Analysis
   ↓
Type Checking
   ↓
Unit Tests
   ↓
Integration Tests
   ↓
Contract Tests
   ↓
Security Scan
   ↓
Dependency Scan
   ↓
Performance Validation
   ↓
Diff Review
   ↓
Human Approval where required
   ↓
Merge
```

Passing tests does not prove architecture or security correctness.

------------------------------------------------------------------------

# 24. Multi-AI Collaboration

Multiple agents may work on NexusOS.

## 24.1 Handoff Contract

An agent handing work to another MUST provide:

-   Task
-   Current state
-   Scope
-   Files changed
-   Contracts touched
-   Tests run
-   Known failures
-   Remaining work
-   Risks
-   Required approvals

## 24.2 Shared Repository Safety

Agents MUST inspect repository state before modifying shared areas.

Agents MUST NOT silently overwrite another agent's work.

Git history and working-tree state are part of implementation context.

------------------------------------------------------------------------

# 25. Security-Sensitive Development

Enhanced review is required for:

-   Authentication
-   Authorization
-   Secrets
-   Cryptography
-   Permissions
-   Sandboxing
-   Browser automation
-   Filesystem access
-   Process execution
-   Plugin execution
-   Remote execution
-   Model tool access
-   Sensitive data
-   Data deletion
-   Supply-chain controls

Security controls MUST NOT be weakened for convenience.

------------------------------------------------------------------------

# 26. Performance Standards

Critical workflows and interfaces MUST have explicit budgets.

Track where applicable:

-   Latency
-   CPU
-   Memory
-   GPU
-   VRAM
-   Network
-   Disk I/O
-   Payload size
-   Startup time
-   Bundle size
-   Queue age
-   Provider latency

The agent resource governor and backend admission controls must prevent
local and cloud workloads from starving critical control traffic.

------------------------------------------------------------------------

# 27. Accessibility

Experience-layer changes MUST address:

-   Keyboard navigation
-   Focus management
-   Screen readers
-   Contrast
-   Reduced motion
-   Semantic structure
-   Accessible labels
-   Error announcements

Target: WCAG 2.2 AA for web and key desktop flows.

------------------------------------------------------------------------

# 28. Documentation Standards

Every service/package MUST provide a README covering:

-   Purpose
-   Ownership
-   Dependencies
-   Setup
-   Interfaces
-   Testing
-   Operations
-   Security

Public or breaking changes MUST update relevant:

-   API contracts
-   Event contracts
-   Changelogs
-   Migration docs
-   ADRs
-   Runbooks

------------------------------------------------------------------------

# 29. CI/CD Enforcement

Important standards SHOULD be machine-enforced.

## 29.1 Pre-Commit

Recommended:

-   Formatter
-   Linter
-   Type checker
-   Secret scanner
-   Fast tests

## 29.2 CI

CI MUST or SHOULD, as appropriate, enforce:

-   Architecture validation
-   Dependency policy
-   Contract validation
-   Unit tests
-   Integration tests
-   Security scanning
-   Vulnerability scanning
-   License policy
-   Secret scanning
-   Documentation checks
-   Performance regression checks

## 29.3 Branch Protection

Protected branches MUST require mandatory checks and required reviews.

------------------------------------------------------------------------

# 30. Definition of Done

A change is complete only when all applicable checks pass:

-   [ ] Requirement satisfied
-   [ ] Architecture aligned
-   [ ] Contract aligned
-   [ ] Security reviewed
-   [ ] Tests pass
-   [ ] Contract tests pass
-   [ ] Performance acceptable
-   [ ] Observability present
-   [ ] Accessibility addressed
-   [ ] Documentation updated
-   [ ] Migration validated
-   [ ] Dependencies validated
-   [ ] Review completed
-   [ ] AI completion report produced where AI contributed

N/A is allowed only with documented reason and reviewer acceptance.

------------------------------------------------------------------------

# 31. Exception Governance

Exceptions follow:

``` text
Exception Request
      ↓
Risk Assessment
      ↓
Owner Assignment
      ↓
Approval
      ↓
Expiration Date
      ↓
Central Registry
      ↓
Periodic Review
      ↓
Remediation
      ↓
Closure
```

Every exception MUST contain:

-   Rule bypassed
-   Reason
-   Scope
-   Risk
-   Owner
-   Approver
-   Creation date
-   Expiration date
-   Remediation plan

Exceptions are temporary by default.

------------------------------------------------------------------------

# 32. Technical Debt Governance

Classify debt as:

-   Architecture
-   Security
-   Performance
-   Test
-   Documentation
-   Operational
-   AI-generated

Material debt SHOULD contain:

-   Owner
-   Severity
-   Impact
-   Tracking reference
-   Remediation target

Security and architecture debt take priority over cosmetic debt.

------------------------------------------------------------------------

# 33. Release Engineering

A release is an atomic, versioned promotion through the approved
pipeline.

Release gates include:

-   Tests
-   Contract compatibility
-   Security validation
-   Migration validation
-   Regression suite
-   SLO readiness
-   Rollback readiness
-   Changelog

Cloud releases SHOULD use progressive delivery.

Desktop releases use signed channels and health-gated rollback.

------------------------------------------------------------------------

# 34. Incident and Hotfix Standards

Hotfixes MUST preserve architecture and security boundaries.

Emergency changes require:

-   Minimal scope
-   Incident reference
-   Appropriate tests
-   Review
-   Post-release verification
-   Follow-up documentation

Emergency status does not grant permission to silently redesign the
platform.

------------------------------------------------------------------------

# 35. Engineering Metrics

Track:

-   Unit/contract coverage
-   Build success
-   Deployment success
-   Bug escape rate
-   Mean time to recovery
-   Performance regression
-   Security findings
-   Dependency vulnerabilities
-   Technical debt
-   AI-generated-code acceptance rate
-   AI rollback rate
-   Review rejection rate
-   Contract violation rate

Metrics MUST NOT incentivize unsafe optimization.

------------------------------------------------------------------------

# 36. AI Completion Report

Meaningful AI implementation work MUST produce:

``` text
Task:
Objective:
Scope:

Files Changed:
Files Added:
Files Deleted:

Dependencies Added:
Dependencies Removed:

Contracts Affected:
Architecture Affected:

Tests Executed:
Static Analysis:
Security Checks:
Performance Checks:

Known Limitations:
Remaining Risks:

Human Approval Required:
Rollback Information:
```

------------------------------------------------------------------------

# 37. Engineering Quality Gates

For every major engineering standard define:

-   Purpose
-   Owner
-   Enforcement mechanism
-   Automation mechanism
-   CI validation
-   Exception process
-   Review cadence

Where a rule can be automatically enforced, documentation-only
enforcement SHOULD be avoided.

------------------------------------------------------------------------

# 38. Feature Engineering Checklist

Before merge:

-   [ ] Requirement has stable identifier
-   [ ] Architecture boundary identified
-   [ ] Contract impact identified
-   [ ] Permission impact identified
-   [ ] Data classification identified
-   [ ] Failure modes documented
-   [ ] Tests added
-   [ ] Observability added
-   [ ] Documentation updated
-   [ ] Rollback/recovery considered
-   [ ] AI scope validated

------------------------------------------------------------------------

# 39. Service Engineering Checklist

-   [ ] Service owner
-   [ ] Canonical data ownership
-   [ ] Public contracts
-   [ ] Dependencies
-   [ ] Security classification
-   [ ] Threat model
-   [ ] SLO
-   [ ] Health/readiness
-   [ ] Metrics
-   [ ] Logs/traces
-   [ ] Runbook
-   [ ] Capacity model
-   [ ] Compatibility matrix
-   [ ] Disaster recovery tier

------------------------------------------------------------------------

# 40. Desktop Engineering Checklist

-   [ ] Lease validation
-   [ ] Local authorization
-   [ ] Capability scope
-   [ ] Process isolation
-   [ ] Resource limits
-   [ ] Cancellation
-   [ ] Checkpointing
-   [ ] Offline behavior
-   [ ] Crash recovery
-   [ ] Evidence
-   [ ] Secret handling
-   [ ] Update/rollback
-   [ ] Windows-specific security validation

------------------------------------------------------------------------

# 41. AI Runtime Engineering Checklist

-   [ ] Stable runtime contract
-   [ ] Context scope
-   [ ] Graph version
-   [ ] Capability binding
-   [ ] Policy gate
-   [ ] Model routing
-   [ ] Budget
-   [ ] Evidence
-   [ ] Reflection
-   [ ] Retry/recovery
-   [ ] Cancellation
-   [ ] Memory permissions
-   [ ] Provider compatibility

------------------------------------------------------------------------

# 42. Plugin Engineering Checklist

-   [ ] Manifest
-   [ ] Publisher identity
-   [ ] Signature
-   [ ] Version
-   [ ] Capabilities
-   [ ] Permissions
-   [ ] Data classes
-   [ ] Network policy
-   [ ] Secret requirements
-   [ ] Sandbox tier
-   [ ] Resource limits
-   [ ] Compatibility
-   [ ] Audit
-   [ ] Quarantine behavior

------------------------------------------------------------------------

# 43. Database Engineering Checklist

-   [ ] Owner
-   [ ] Schema impact
-   [ ] Migration ID
-   [ ] Compatibility
-   [ ] Rollback/recovery
-   [ ] Data integrity validation
-   [ ] Performance impact
-   [ ] Destructive-operation approval
-   [ ] Production migration plan

------------------------------------------------------------------------

# 44. Future Evolution

New languages, frameworks, AI models, coding agents, devices, or
deployment environments MUST inherit these standards.

Future expansion into:

-   macOS
-   Linux
-   Mobile
-   Robotics
-   New AI providers
-   New local runtimes
-   Distributed development

requires compatibility with existing contracts and explicit ADRs where
architecture changes.

New capabilities extend the architecture; they do not bypass it.

------------------------------------------------------------------------

# 45. AI Agent Quick Checklist

Before coding:

-   [ ] Read PRD requirement
-   [ ] Read relevant Architecture Bible section
-   [ ] Read relevant EDD
-   [ ] Read relevant API/event contract
-   [ ] Inspect repository
-   [ ] Identify scope
-   [ ] Identify security impact
-   [ ] Identify contract impact
-   [ ] Identify migration impact
-   [ ] Determine autonomy level

During coding:

-   [ ] Stay within scope
-   [ ] Follow conventions
-   [ ] Avoid unrelated refactoring
-   [ ] Do not invent contracts
-   [ ] Do not bypass permissions
-   [ ] Preserve observability
-   [ ] Stop on ambiguity

After coding:

-   [ ] Tests
-   [ ] Type checking
-   [ ] Linting
-   [ ] Contract validation
-   [ ] Security checks
-   [ ] Diff review
-   [ ] Documentation
-   [ ] Completion report

------------------------------------------------------------------------

# 46. Reviewer Quick Checklist

-   [ ] Architecture aligned
-   [ ] Correct contract used
-   [ ] No unauthorized dependency
-   [ ] Security boundaries preserved
-   [ ] Permission boundaries preserved
-   [ ] Data ownership preserved
-   [ ] Tests sufficient
-   [ ] Observability present
-   [ ] Performance acceptable
-   [ ] Documentation updated
-   [ ] Migration safe
-   [ ] AI scope respected
-   [ ] No unrelated changes

------------------------------------------------------------------------

# 47. Document Governance

  -----------------------------------------------------------------------
  Field                               Rule
  ----------------------------------- -----------------------------------
  Owner                               NexusOS Platform Architecture /
                                      Engineering Governance

  Maintainers                         Designated repository maintainers

  Review                              Major architecture releases and
                                      major implementation phases

  Change                              Proposal → impact analysis → review
                                      → approval → version update

  Exceptions                          Approved through ADR/exception
                                      process

  Versioning                          Semantic/document revision tracking

  Status                              Binding after approval
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 48. Final Engineering Rules

1.  Architecture is not invented during routine implementation.
2.  Contracts are not invented inside feature code.
3.  Security is not optional.
4.  Tests do not replace architecture review.
5.  Passing tests do not justify contract violations.
6.  AI capability does not equal architectural authority.
7.  The smallest safe change is preferred.
8.  Destructive operations require explicit control.
9.  Exceptions expire.
10. Important rules should be automatically enforced.
11. Material changes must be observable.
12. Public contracts must be versioned.
13. Critical artifacts must have owners.
14. Ambiguity must be surfaced.
15. Model output is not policy authority.
16. External content is untrusted.
17. Provider choice is policy-bounded.
18. Offline execution cannot invent fresh authority.
19. A runtime cannot become a policy engine.
20. A UI cannot become an authorization boundary.
21. A plugin cannot receive ambient authority.
22. A service cannot write another service's canonical data.
23. An AI coding agent cannot silently expand its authority.

------------------------------------------------------------------------

# Appendix A --- AI Task Report Template

``` text
TASK
- Identifier:
- Objective:
- User requirement:
- Requested scope:

ARCHITECTURE
- Applicable architecture:
- Applicable EDD:
- Architecture impact:
- ADR required:

CONTRACTS
- Contract IDs:
- API impact:
- Event impact:
- Compatibility impact:

SECURITY
- Classification:
- Permission impact:
- Security-sensitive areas:
- Approval required:

IMPLEMENTATION
- Files changed:
- Files added:
- Files deleted:
- Dependencies changed:

VALIDATION
- Unit tests:
- Integration tests:
- Contract tests:
- Security scans:
- Performance checks:
- Manual verification:

OUTCOME
- Completed:
- Known limitations:
- Remaining risks:
- Rollback information:
- Human approvals:
```

------------------------------------------------------------------------

# Appendix B --- AI Stop Report

``` text
BLOCKED TASK

Reason:
Applicable document:
Conflicting rule / missing information:
Affected components:
Security impact:
Contract impact:
Proposed options:
Required decision:
```

The AI agent MUST use this rather than guessing when a stop condition is
triggered.

------------------------------------------------------------------------

# Appendix C --- Contract Change Checklist

``` text
- [ ] Contract ID exists
- [ ] Owner exists
- [ ] Version identified
- [ ] Producer impact checked
- [ ] Consumer impact checked
- [ ] Data classification checked
- [ ] Security impact checked
- [ ] Compatibility checked
- [ ] Migration plan checked
- [ ] Contract tests updated
- [ ] Documentation updated
- [ ] Deprecation plan where applicable
- [ ] Approval recorded
```

------------------------------------------------------------------------

# Appendix D --- AI Agent Governance Model

NexusOS treats AI coding systems as replaceable engineering
contributors.

The specific model provider is not authoritative.

The repository, frozen architecture, approved contracts, CI gates,
review process, and human governance are authoritative.

Therefore:

``` text
AI Model
   ↓
Coding Agent
   ↓
Repository Rules
   ↓
Architecture / Contracts
   ↓
Validation
   ↓
Review / Approval
   ↓
Merge
```

No model is trusted merely because it is capable.

No local model is exempt from these rules.

No cloud model is exempt from these rules.

No IDE agent is exempt from these rules.

------------------------------------------------------------------------

# Final Requirement

This document is the official engineering constitution for NexusOS
implementation.

All human contributors and AI coding agents MUST remain compatible with:

-   NexusOS Enterprise PRD v3
-   NexusOS Architecture Bible
-   NexusOS Desktop Agent EDD
-   NexusOS Backend EDD
-   NexusOS AI Runtime EDD
-   NexusOS Experience Platform EDD
-   NexusOS API Contract Specification

No contributor may silently change architecture, contracts, permissions,
security boundaries, data ownership, or destructive behavior.

If ambiguity remains, it MUST be surfaced and resolved through the
appropriate engineering governance process.

Implementation code is outside the scope of this document.

The purpose of this standard is to make AI-assisted NexusOS development
controlled, reproducible, reviewable, secure, maintainable, and
scalable.
