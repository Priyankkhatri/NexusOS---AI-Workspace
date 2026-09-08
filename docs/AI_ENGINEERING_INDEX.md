# AI Engineering Index — NexusOS

This document serves as the authoritative entry point and navigation index for autonomous coding agents (including Antigravity, Codex, and Claude) operating on the NexusOS repository.

---

## 1. Document Authority Precedence

When encountering conflicting specifications or ambiguity, follow the strict hierarchy of authority:

1. **NexusOS Enterprise PRD** (`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`)
2. **NexusOS Architecture Bible** (`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`)
3. **Subsystem Engineering Design Documents (EDDs)**:
   - Backend EDD (`docs/EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md`)
   - AI Runtime EDD (`docs/EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md`)
   - Desktop Agent EDD (`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`)
   - Experience Platform EDD (`docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md`)
4. **API Contract Specification** (`docs/Architecture_and_Specs/NexusOS_API_Contract_Specification_Section_1_System_Communication_Map.md`)
5. **AI Coding Standards & Development Guide** (`docs/Architecture_and_Specs/NexusOS_AI_Coding_Standards_and_Development_Guide.md`)
6. **Sprint 0 Implementation Blueprint** (`docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md`)
7. **Implementation Source Code**

> [!IMPORTANT] > **Stop Condition:** If an implementation instruction or user prompt contradicts a higher-level parent document, **STOP IMMEDIATELY**. Document the ambiguity, assess the impact, request an ADR or human architecture decision, and wait for approval. Never silently override parent architectural decisions.

---

## 2. Monorepo Architecture & Ownership Domains

| Directory                | Ownership Domain    | Purpose & Architectural Boundary                                                                             |
| :----------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------- |
| `packages/contracts/`    | Contracts Owner     | Shared TypeScript contracts, Zod schemas, error taxonomy, ACP protocols. Zero external runtime dependencies. |
| `services/backend/`      | Backend Owner       | Control-plane API server, task orchestrator, policy enforcement point, database persistence boundary.        |
| `services/identity/`     | Identity Owner      | JWT validation, OIDC token provider, secret key rotation, role-based access control.                         |
| `services/orchestrator/` | Orchestration Owner | Task lifecycle execution, state transitions, event emission, failure reconciliation.                         |
| `apps/desktop-agent/`    | Desktop Agent Owner | Windows execution host, IPC bridge, system tray UI, local vault, device capability execution.                |
| `runtimes/local-ai/`     | AI Runtime Owner    | Local LLM runtime router, prompt isolation, context window management, provider circuit breakers.            |
| `infrastructure/`        | Platform Ops Owner  | Deployment configurations, Dockerfiles, local emulators, CI scripts.                                         |
| `docs/`                  | Architecture Team   | Authoritative specifications, EDDs, PRDs, runbooks, developer guides.                                        |
| `tests/`                 | QA & Engineering    | Monorepo integration, security regression, contract, and Sprint 0 DoD audit tests.                           |

---

## 3. Parallel AI Agent Operating Rules (Blueprint Section 60)

1. **Explicit Scope:** Agents must only modify files within their assigned workstream directory.
2. **Forbidden Overlap:** An agent must not modify `packages/contracts/` unless explicitly assigned a contract update task.
3. **No Cross-Datastore Writes:** Direct cross-service database access is prohibited. All cross-boundary communication must use approved API endpoints, ACP channels, or typed EventBus envelopes.
4. **Frozen Lockfile:** Do not add or bump dependencies without explicit architecture authorization.

---

## 4. AI Agent Merge Gate Checklist (Blueprint Section 92)

Before opening a PR or claiming task completion, verify:

- [ ] **Scope Match:** Changes strictly address the assigned task; no out-of-scope features added.
- [ ] **Contract Integrity:** Schemas and contracts are backward-compatible and fully validated.
- [ ] **Boundary Compliance:** Trust boundaries and isolation invariants are preserved.
- [ ] **Zero Secrets:** No credentials, tokens, or environment files committed.
- [ ] **Tests Green:** All unit, contract, integration, and security tests pass locally (`npm test`).
- [ ] **Quality Gates Green:** `npm run validate` passes (formatting, linting, typecheck, build).
- [ ] **Completion Report:** An evidence-backed completion report is written using the standard template.

---

## 5. Handoff Protocol (Blueprint Section 61)

Every completed agent task must output a structured handoff summary:

```text
Task: <ID and Title>
Status: ACCEPTED | IN_REVIEW | BLOCKED
Scope: <Summary of changes>
Files changed: <List of modified files>
Files added: <List of new files>
Files deleted: <List of deleted files>
Contracts affected: <List or "None">
Architecture impact: <Invariants maintained / verified>
Tests: <Pass count and suites>
Known risks: <Any remaining concerns or limitations>
Next action: <Follow-on workstream or gate>
```

---

## 6. Official Status Model (Blueprint Section 93)

Use only the canonical status values:

- `NOT_STARTED`
- `READY`
- `IN_PROGRESS`
- `BLOCKED`
- `IN_REVIEW`
- `ACCEPTED`
- `REJECTED`
- `DEFERRED`
