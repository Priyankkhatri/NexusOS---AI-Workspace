# TASK 054 — DISCOVERY REPORT

## Sprint 1 Milestone 6: Plugin SDK, Extensibility & Governed Third-Party Integration Foundation

**Mode:** DISCOVERY ONLY (No source code, tests, or configurations modified)  
**Date:** 2026-09-09  
**Baseline HEAD SHA:** `4cb221fa19d81c96e0c78ad1092e50b90dea902f`  
**Branch:** `main` (synchronized with `origin/main`)

---

### 1. EXECUTIVE SUMMARY

Task 054 represents **Sprint 1 Milestone 6: Plugin SDK, Extensibility & Governed Third-Party Integration Foundation**.

Following the completion and remote CI verification of Tasks 049 through 053 (Workflow DAG, Filesystem Sandbox Hardening, Local AI Engine, Human-in-the-Loop Desktop Approvals, and Web Dashboard Platform), the platform's core multi-plane foundation (Control Plane, Desktop Agent, AI Runtime, and Experience Plane) is fully operational.

Task 054 activates the **Ecosystem Plane** by establishing:

1. The official **`@nexusos/plugin-sdk`** developer surface (in `packages/plugin-sdk/`) adhering to strict monorepo dependency boundaries.
2. Canonical plugin manifest, package signature, lifecycle, and invocation contracts in `@nexusos/contracts`.
3. Governed integration between the Desktop Agent's existing **Task 045 Plugin Runtime** (`rt:plugin-v1`), the Control Plane's policy/task lifecycle, and third-party extension code.
4. Fail-closed security boundaries enforcing cryptographic verification, tenant/workspace isolation, capability-scoped execution leases, and resource quotas.

**STRICT COMPLIANCE DIRECTIVE:**
This document is a **DISCOVERY AUDIT ONLY**. No production code, tests, manifests, or configurations have been created or modified during this pass.

---

### 2. BASELINE GIT RECONCILIATION

- **`git rev-parse HEAD`**: `4cb221fa19d81c96e0c78ad1092e50b90dea902f`
- **`git branch --show-current`**: `main`
- **`git status --short`**: Clean (0 modified files, 0 staged changes, 0 untracked files)
- **`origin/main` Relationship**: Current local `HEAD` exactly matches `origin/main` (`4cb221fa19d81c96e0c78ad1092e50b90dea902f`).
- **Recent Git Log (`git log -n 5 --oneline`)**:
  - `4cb221f` docs(task-053): add Task 053 discovery and completion reports
  - `56c2dea` feat(dashboard): implement Task 053 web dashboard platform and activity/approval observability
  - `446f23f` feat(hitl): Sprint 1 Milestone 4 — Human-in-the-Loop Desktop Approval Interceptor & Native UI Integration (Task 052)
  - `42b243e` style(docs): format task_051_completion_report.md per prettier
  - `40205c3` feat(desktop-agent): implement Task 051 local AI model router & engine integration
- **Verification**: The working tree is in a pristine state at the accepted Task 053 final SHA.

---

### 3. EXACT TASK IDENTITY

- **Task Identifier**: `TASK-054` (Task 054)
- **Canonical Title**: `TASK 054: SPRINT 1 MILESTONE 6 — PLUGIN SDK, EXTENSIBILITY & GOVERNED THIRD-PARTY INTEGRATION FOUNDATION`
- **Sprint / Milestone**: Sprint 1, Milestone 6 (Ecosystem Plane Kickoff)
- **Backlog & Roadmap Mapping**:
  - **Enterprise PRD v3**: Section 5.9 (CON-001 through CON-006: Connector, Plugin, and MCP Registry), Section 15 (Plugin & MCP Platform), Section 38 (Plugin Sandbox), and Roadmap Phase 1/Phase 2 (`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`).
  - **Architecture Bible**: Section 1.1 (Ecosystem Plane), Section 2.3 (`packages/plugin-sdk/`), Section 13 (Plugin Runtime, Lifecycle, and Sandbox Tiers 0–3), Section 15.2 (Trust Boundaries).
  - **Sprint 0 Blueprint & AI Coding Standards**: Section 28 (`packages/plugin-sdk/` package definition, isolated dependency rules).
- **Owning Subsystems**:
  - **Shared Ecosystem Surface**: `packages/plugin-sdk/` (new package)
  - **Canonical Contracts**: `packages/contracts/src/plugin/` (new canonical contract module)
  - **Desktop Runtime Plane**: `apps/desktop-agent/src/runtimes/plugin/` (existing Task 045 baseline)
  - **Control Plane Gateway / Backend**: `services/backend/src/` (discovery/projection/registry endpoints)
- **Prerequisites Satisfied**:
  - **Task 045 (Desktop Agent Plugin Runtime)**: Baseline `PluginRuntime` (`rt:plugin-v1`), `PluginVerifier`, `PluginCatalog`, `PluginQuarantineStore`, `PluginPolicyGateway`, and 8 IPC handlers already implemented and tested in `apps/desktop-agent`.
  - **Task 049 (DAG Workflows)**: Task graph node execution engine capable of scheduling `plugin.*` capabilities.
  - **Task 050 (Filesystem Sandboxing)**: Path jailing and workspace authorization for plugin filesystem operations.
  - **Task 052 (HITL Approvals)**: Interceptor for high-risk capabilities declaring `requiresApproval: true` or `riskTier: 'HIGH' | 'CRITICAL'`.
  - **Task 053 (Web Dashboard)**: Observability platform and Activity Center capable of projecting plugin events.

---

### 4. AUTHORITATIVE SOURCES

1. **NexusOS Architecture Bible — Pre-EDD Foundation** ([`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)):
   - Section 1.1: Separation between Experience, Control, Runtime, Data, and Ecosystem planes.
   - Section 2.3 & 2.4: Repository hierarchy establishing `packages/plugin-sdk/` with zero dependency on service internals.
   - Section 13.1–13.5: Plugin lifecycle (`Discovered -> Verified -> Installed -> Configured -> Active <-> Suspended / Updating -> Quarantined -> Uninstalled`), Sandbox Tiers 0–3, SDK typed capability APIs.
   - Section 15.2: Threat model covering malicious plugin code, capability escalation, and egress policy.
2. **NexusOS Enterprise PRD v3** ([`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md)):
   - Section 5.9: `CON-001` to `CON-006` connector/plugin registry requirements.
   - Section 15.1–15.4: Manifest requirements (publisher, ID, version, tools, schemas, OAuth scopes, outbound domains, risk tiers).
   - Section 38: Plugin sandbox manager, process isolation, resource ceilings.
3. **NexusOS AI Coding Standards & Sprint 0 Blueprint** ([`docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md)):
   - Package rules: Contracts and SDKs must be implementation-independent.
4. **Desktop Agent EDD** ([`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md)):
   - Section 3.8 & Section 12: Desktop agent plugin host and capability execution.
5. **Task 045 Completion Report** ([`apps/desktop-agent/docs/task-045-completion-report.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/docs/task-045-completion-report.md)):
   - Preceding baseline implementation details for `PluginRuntime` (`rt:plugin-v1`).

---

### 5. EXISTING REPOSITORY EXTENSIBILITY & TASK 045 INTEGRATION

An exhaustive audit of the codebase reveals that a foundational plugin runtime already exists in the Desktop Agent, completed under **Task 045**:

- **Location**: `apps/desktop-agent/src/runtimes/plugin/`
  - `runtime.ts`: `PluginRuntime` (`rt:plugin-v1`) implementing package verification, installation, activation, invocation, suspension, and quarantine.
  - `verifier.ts`: `PluginVerifier` validating package integrity, SHA-256 hash, and publisher signatures.
  - `catalog.ts`: `PluginCatalog` maintaining in-memory registration and lifecycle state.
  - `quarantine-store.ts`: `PluginQuarantineStore` recording crash counts and quarantine reasons.
  - `policy-gateway.ts`: `PluginPolicyGateway` ensuring invocation requests only target declared manifest capabilities.
  - `schemas.ts`: Zod schemas for local IPC operations.
  - `types.ts`: Internal data types.
- **Desktop Agent Host Integration (`apps/desktop-agent/src/agent.ts`)**:
  - Registered in `RuntimeRegistry` under ID `rt:plugin-v1` and category `PLUGIN`.
  - Registered 8 capability descriptors in `CapabilityRegistry`: `plugin.verify`, `plugin.install`, `plugin.activate`, `plugin.invoke`, `plugin.suspend`, `plugin.quarantine`, `plugin.listEntries`, `plugin.listQuarantined`.
  - Registered 8 IPC handlers on the local named-pipe IPC manager.
- **Critical Architectural Distinction (Task 045 vs. Task 054)**:
  - **Task 045** was an **agent-internal host adapter**: its schemas and types live entirely inside `apps/desktop-agent/src/runtimes/plugin/`, inaccessible to external developers, control-plane backend services, or web dashboard projection.
  - **Task 054** must **NOT** create a second runtime. Instead, Task 054 elevates the contracts to `@nexusos/contracts`, builds the developer SDK in `packages/plugin-sdk/`, and connects the backend control plane and workflow orchestrator to the governed plugin runtime.

---

### 6. ARCHITECTURE & TRUST BOUNDARY AUDIT

The multi-plane trust boundaries for plugins are structured as follows:

```
┌──────────────────────────────────────────────────────────────────┐
│ EXPERIENCE PLANE (Untrusted)                                     │
│ Apps / Web Dashboard (Task 053)                                  │
│ - Displays installed plugins, permissions, health, audit trail  │
│ - Zero authorization authority; all actions dispatch to Backend │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ HTTPS (Authenticated)
┌─────────────────────────────────▼────────────────────────────────┐
│ CONTROL PLANE (Trusted Policy & Coordination)                    │
│ Backend Task Controller / Registry Service                       │
│ - Authenticates tenant & user, checks roles/scopes               │
│ - Evaluates policy snapshot before issuing execution leases      │
│ - Dispatches tasks with signed cryptographic leases             │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ mTLS / ACP Protocol
┌─────────────────────────────────▼────────────────────────────────┐
│ RUNTIME PLANE (Desktop Agent Host Boundary)                      │
│ AgentOrchestrator & Task 045 PluginRuntime                       │
│ - Validates HMAC lease, expiry, tenant, and device binding       │
│ - Intercepts high-risk capabilities for HITL approval (Task 052) │
│ - Resource governor enforces concurrency & timeout budgets       │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ Sandboxed IPC / Worker Process
┌─────────────────────────────────▼────────────────────────────────┐
│ THIRD-PARTY EXTENSION CODE (Untrusted)                          │
│ Plugin Implementation (built using @nexusos/plugin-sdk)         │
│ - Communicates ONLY via typed SDK Host APIs                     │
│ - No direct ambient filesystem, network, or OS access            │
│ - Outputs captured, sanitized, and redacted before storage      │
└──────────────────────────────────────────────────────────────────┘
```

**Key Boundary Rules**:

1. **Third-Party Code is Untrusted**: Plugin code cannot access ambient host APIs (`fs`, `child_process`, `net`, `http`, process environment). All actions must be routed through the SDK host bridge.
2. **Backend is Authoritative for Policy**: The agent never decides whether a plugin _should_ be allowed to execute; it only verifies that a valid signed lease exists.
3. **Desktop Agent is Authoritative for OS Sandboxing**: The desktop agent enforces process limits, timeout timers, and filesystem directory jails.

---

### 7. PLUGIN MANIFEST & IDENTITY AUDIT

Existing manifest definition in `apps/desktop-agent/src/runtimes/plugin/types.ts`:

```typescript
export interface PluginManifest {
  pluginId: string;
  version: string;
  publisher: string;
  name: string;
  description: string;
  requestedCapabilities: string[];
  outboundDomains: string[];
  trustLevel: PluginTrustLevel;
}
```

**Identified Architectural Gaps**:

1. **Schema Validation Location**: Defined only in `apps/desktop-agent`, violating monorepo layer rules when the control plane or SDK needs manifest validation. Must be hoisted to `@nexusos/contracts`.
2. **Missing Canonical Fields (Per PRD Section 15.2)**:
   - `minNexusOsVersion` / `maxNexusOsVersion` (runtime engine compatibility range).
   - `entrypoint` (relative path to plugin script / bundle).
   - `permissions` (differentiated from capabilities: e.g. `storage:workspace`, `network:egress`).
   - `configurationSchema` (JSON schema for user/tenant settings).
   - `riskTier` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL` to bind with Task 052 approval engine).
3. **Cryptographic Identity Verification**:
   - `PluginVerifier` currently validates signature strings against prefixes (`sig_valid_...`). For production extensibility, SHA-256 package hash verification must be formally coupled with public-key signature verification.

---

### 8. SDK CONTRACT SURFACE (`@nexusos/plugin-sdk`)

Per Architecture Bible Section 2.3 and Section 13.4, the developer SDK must reside in `packages/plugin-sdk/` and expose typed interfaces:

```typescript
// Proposed Developer Surface
export interface PluginContext {
  readonly pluginId: string;
  readonly version: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly logger: PluginLogger;
  readonly host: PluginHostAPI;
}

export interface PluginHostAPI {
  // Capability & Tool Invocations
  invokeCapability(
    capabilityId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  // Storage & Artifacts
  saveArtifact(
    name: string,
    content: string | Uint8Array,
    mimeType: string,
  ): Promise<{ artifactId: string }>;
  // Telemetry & Events
  emitEvent(name: string, payload: Record<string, unknown>): void;
}

export interface PluginDefinition {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
  executeCapability?(
    capability: string,
    action: string,
    payload: unknown,
    context: PluginContext,
  ): Promise<unknown>;
}

export function definePlugin(definition: PluginDefinition): PluginDefinition;
```

**Strict Reuse of Existing Contracts**:

- Reuses `ExecutionLeaseHeader` and `ErrorCategory` from `@nexusos/contracts`.
- Reuses `EventEnvelope` from `@nexusos/contracts/events`.
- Reuses Task 052 risk tiers and HITL approval classification.

---

### 9. CAPABILITY & PERMISSION MODEL

1. **Declared vs. Granted**:
   - **Declared**: The plugin manifest explicitly declares `requestedCapabilities` (e.g. `github:pr:read`, `terminal.exec`).
   - **Granted**: At install time, the tenant administrator or user grants approval. At runtime, the control plane issues a signed `ExecutionLeaseHeader` containing permitted `scopes`.
2. **Fail-Closed Double Gate**:
   - **Gate 1 (PolicyGateway)**: `PluginPolicyGateway.evaluateInvocation()` rejects any capability not listed in `manifest.requestedCapabilities` with `UNAUTHORIZED_PLUGIN_CAPABILITY`.
   - **Gate 2 (Lease Check)**: Fails closed with `MISSING_CAPABILITY_SCOPE` if the lease does not include `plugin:<capability>` or `plugin:invoke`.
3. **High-Risk Elevation (Task 052 Interception)**:
   - If a plugin capability is classified as high-risk (e.g. `terminal.exec`, `filesystem.deleteFile`, or `riskTier: 'HIGH'`), it triggers `AgentOrchestrator` HITL prompt before execution.

---

### 10. TENANT & WORKSPACE ISOLATION

- **Tenant Isolation (`045-SEC-08`)**:
  - `Task 045` verified that leases from Tenant A and Tenant B execute in isolation without state leakage.
- **Workspace Containment (`Task 050`)**:
  - When plugins perform file operations, `PathSecurityService` enforces directory jailing to the authorized workspace root.
  - Cross-tenant workspace probing returns `TENANT_MISMATCH`.
- **Secret Isolation**:
  - Plugins never receive raw API keys or database passwords. Secrets are referenced as vault opaque identifiers and injected via secure runtime channels.

---

### 11. LIFECYCLE STATE MACHINE

Authoritative lifecycle per Architecture Bible Section 13.2:

```
DISCOVERED ──(verify)──> VERIFIED ──(install)──> INSTALLED ──(activate)──> ACTIVATED
                                                                                │
                                                                       (suspend)│ (resume)
                                                                                ▼
QUARANTINED <──(crash/violation)── [ANY STATE]                    SUSPENDED
```

- **Transitions Handled by Catalog**:
  - `INSTALLED` -> `ACTIVATED`: Safe.
  - `ACTIVATED` -> `SUSPENDED`: Safe.
  - `SUSPENDED` -> `ACTIVATED`: Safe.
  - `QUARANTINED` -> `ACTIVATED`: **STRICTLY BLOCKED** (enforced by `045-SEC-05`).
  - Quarantine lift requires explicit administrative action.

---

### 12. RESOURCE & PERFORMANCE GOVERNANCE

- **Limits Structure (`PluginResourceLimits`)**:
  - `maxConcurrentHosts`: Maximum active plugin instances (default: `5`). Exceeding triggers `PLUGIN_HOST_LIMIT_EXCEEDED` (`045-SEC-06`).
  - `hostTimeoutMs`: Hard execution timeout (default: `30000ms`).
  - `maxCrashAttempts`: Auto-quarantine threshold (default: `3` crashes).
- **Process & Memory Ceilings**:
  - Plugin memory usage is bound by parent worker/host allocation.
  - Output payloads are limited to 10MB to prevent memory exhaustion.

---

### 13. OBSERVABILITY, AUDIT & EVIDENCE

- **Canonical Event Emission**:
  - `nexusos.events.plugin.verify.v1`
  - `nexusos.events.plugin.install.v1`
  - `nexusos.events.plugin.activate.v1`
  - `nexusos.events.plugin.invocation_completed.v1`
  - `nexusos.events.plugin.suspend.v1`
  - `nexusos.events.plugin.quarantine.v1`
  - `nexusos.events.plugin.denied.v1`
  - `nexusos.events.plugin.error.v1`
- **Audit Provenance**:
  - Each event is wrapped in a canonical `EventEnvelope` containing `taskId`, `leaseId`, `agentId`, `tenantId`, `pluginId`, `evidenceId`, and `occurred_at`.
  - Secret redaction via `RedactionFilter` ensures credentials never appear in event streams or logs (`045-SEC-11`).

---

### 14. FAILURE MODES & RECOVERY

| Failure Scenario               | Immediate System Reaction                                                   | Recovery / State Impact                                                |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Signature Mismatch**         | `PluginVerifier` returns `valid: false`, `PLUGIN_SIGNATURE_INVALID`.        | Package rejected; not added to catalog.                                |
| **Undeclared Capability**      | `PluginPolicyGateway` denies call with `UNAUTHORIZED_PLUGIN_CAPABILITY`.    | Invocation halted; task transitions to `FAILED`.                       |
| **Expired Lease**              | `ExecutionLeaseBoundary` fails with `LEASE_EXPIRED`.                        | Rejected before plugin execution; no state corruption.                 |
| **Crash Loop**                 | `quarantineStore` tracks crash count. On 3rd crash, moves to `QUARANTINED`. | Plugin suspended and quarantined; cannot be reactivated until cleared. |
| **Host Limit Exceeded**        | Rejects with `PLUGIN_HOST_LIMIT_EXCEEDED`.                                  | Returns transient failure; queues or fails task gracefully.            |
| **Orphaned State on Teardown** | `PluginRuntime.shutdown()` resets host count and clears resources.          | Zero resource leaks on agent termination (`045-SEC-12`).               |

---

### 15. DASHBOARD & EXPERIENCE PLANE INTEGRATION

- **Role of the Web Dashboard (Task 053)**:
  - The dashboard is an **untrusted observer** (`053-SEC-01` through `053-SEC-06`).
  - It exposes a unified Integrations tab (`CON-001`) showing:
    - Installed plugins and version metadata.
    - Active lifecycle state (`INSTALLED`, `ACTIVATED`, `SUSPENDED`, `QUARANTINED`).
    - Declared capabilities and granted permissions.
    - Real-time audit events in the Activity Center.
  - Controls (Enable/Disable/Install) call authoritative Backend API routes (`POST /v1/plugins/:id/...`), never local UI state mutation.

---

### 16. SECURITY THREAT MODEL & INVARIANT MAPPING

A threat assessment identifies the core risks for third-party extensibility:

1. **Malicious Package Injection (Supply Chain)**: Forged signature, tampered bundle.
   - _Mitigation_: Cryptographic signature verification and bundle SHA-256 hashing.
2. **Capability / Scope Escalation**: Plugin attempts to call terminal or filesystem outside declared manifest.
   - _Mitigation_: Two-factor authorization (manifest declaration + execution lease scope check).
3. **Tenant Boundary Escape**: Plugin invokes capabilities across tenant lines.
   - _Mitigation_: Tenant ID binding inside HMAC-signed lease; cross-tenant calls fail closed.
4. **Denial of Service / Host Starvation**: Runaway loops or crash loops.
   - _Mitigation_: Concurrency budget (`maxConcurrentHosts`), hard execution timeout, auto-quarantine.
5. **Secret Exfiltration**: Egress of credentials through plugin output.
   - _Mitigation_: Deep regex redaction filter applied to all IPC returns and logs.

---

### 17. EXISTING TESTS & BASELINE COVERAGE

Existing plugin test suites:

- **`apps/desktop-agent/tests/local-plugin-ipc.test.ts`**: 10 tests validating all 8 IPC method handlers and runtime registry integration.
- **`apps/desktop-agent/tests/local-plugin-security-hardening.test.ts`**: 12 dedicated security invariant tests (`045-SEC-01` through `045-SEC-12`).
- **Total Monorepo Baseline**: **`888/888` tests passing** across 155 suites.

---

### 18. TEST MATRIX FOR FUTURE TASK 054 IMPLEMENTATION

When Task 054 implementation begins, the following test matrix should be established:

#### Functional Suite (`packages/plugin-sdk/tests/`, `services/backend/tests/plugins.test.ts`):

- `definePlugin()` helper creates valid plugin definitions with typed context.
- Plugin manifest schema validation passes for valid packages and rejects malformed fields.
- Backend routes for plugin catalog listing and status projection return expected payloads.
- Integration between `@nexusos/plugin-sdk` and `PluginRuntime` executes successfully.

#### Security Invariants Suite (`tests/vertical-slice/plugin-security-invariants.test.ts`):

- `054-SEC-01`: Cryptographic Package Integrity & Signature Verification (tampered hashes or bad signatures fail closed).
- `054-SEC-02`: Capability & Manifest Isolation (undeclared capabilities or missing lease scopes fail closed).
- `054-SEC-03`: Strict Tenant & Workspace Boundary Enforcement (cross-tenant plugin invocation rejected).
- `054-SEC-04`: Quarantine Enforcement & Illegal Lifecycle Transition Protection (quarantined plugins cannot invoke or activate).
- `054-SEC-05`: Resource Governance & Timeout Ceilings (concurrency limits and timeouts enforced).
- `054-SEC-06`: Secret Redaction & Protected-Data Containment (credentials never returned in plugin outputs).

---

### 19. RECOMMENDED IMPLEMENTATION SEQUENCE

1. **Step 1: Canonical Contracts Extension**:
   - Define `packages/contracts/src/plugin/` exporting `PluginManifestSchema`, `PluginPackageSchema`, `PluginTrustLevelSchema`, and invocation interfaces.
   - Re-export from `packages/contracts/src/index.ts`.
2. **Step 2: Plugin SDK Package Creation (`packages/plugin-sdk/`)**:
   - Create `packages/plugin-sdk` workspace with `package.json`, `tsconfig.json`, and clean exports (`definePlugin`, `PluginContext`, `PluginHostAPI`).
   - Wire into monorepo root workspaces and `tsconfig.json`.
3. **Step 3: Harmonize Desktop Agent Plugin Runtime**:
   - Update `apps/desktop-agent/src/runtimes/plugin/` to consume canonical contracts from `@nexusos/contracts`.
   - Preserve all existing Task 045 security mechanisms and IPC handlers.
4. **Step 4: Backend Control-Plane Integration**:
   - Add backend endpoints (`GET /v1/plugins`, `GET /v1/plugins/:id`) for dashboard projection.
5. **Step 5: Dedicated Security Invariants Test Suite**:
   - Implement `tests/vertical-slice/plugin-security-invariants.test.ts`.
6. **Step 6: Full Monorepo Quality Gates & CI**:
   - Run typecheck, lint, format:check, validate, security, and full monorepo test suite.

---

### 20. ALLOWED & FORBIDDEN DIRECTORIES FOR IMPLEMENTATION

#### ALLOWED DIRECTORIES (Future Implementation):

- `packages/contracts/src/plugin/` (canonical schemas and types)
- `packages/contracts/src/index.ts` (contract re-exports)
- `packages/plugin-sdk/` (new SDK package)
- `apps/desktop-agent/src/runtimes/plugin/` (align with canonical contracts)
- `services/backend/src/plugins/` (if backend projection/controller needed)
- `tests/vertical-slice/plugin-security-invariants.test.ts` (new vertical slice test suite)
- `package.json`, `pnpm-lock.yaml`, `tsconfig.json` (workspace registration)

#### FORBIDDEN DIRECTORIES:

- `apps/web-dashboard/` (unless minimal projection contract consumption is required; avoid rewriting dashboard)
- `runtimes/local-ai/` (Task 051 completed subsystem)
- `services/policy/` (core policy evaluator is complete; use existing interfaces)
- `services/identity/` (completed subsystem)
- `infrastructure/` (cloud deployment files out of scope)
- Any Task 055+ candidate areas.

---

### 21. ACCEPTANCE CRITERIA FOR TASK 054 COMPLETION

1. `@nexusos/plugin-sdk` package is established in `packages/plugin-sdk` with clean typecheck and zero circular dependencies.
2. Canonical plugin contracts are published in `@nexusos/contracts`.
3. Existing Task 045 `PluginRuntime` in `apps/desktop-agent` is preserved and harmonized with canonical contracts.
4. Dedicated vertical-slice security invariants suite (`tests/vertical-slice/plugin-security-invariants.test.ts`) passes 100%.
5. All 888+ monorepo tests pass with zero regressions.
6. All monorepo quality gates (`typecheck`, `lint`, `format:check`, `validate`, `security`) pass cleanly.
7. Remote GitHub Actions CI run is verified GREEN for the exact commit SHA.

---

### 22. RISKS & OPEN QUESTIONS

1. **Process-Level Worker Isolation (Tier 2/Tier 3 Sandbox)**:
   - _Current State_: `PluginRuntime` simulates sandboxed host execution (`mockHostResult.executedInSandboxHost = true`).
   - _Roadmap Plan_: Future production hardening will isolate plugins into child processes / Web Worker sandboxes. For Sprint 1 Milestone 6, in-process boundary isolation with Zod schema checks, lease boundaries, and timeout limits is the target.
2. **Third-Party Package Distribution & Registry**:
   - _Resolution_: Packaging and distribution are decoupled; Task 054 establishes the runtime and SDK contracts. A full cloud registry / marketplace is scheduled for subsequent phases.

---

### 23. DISCOVERY CONCLUSION & NEXT STEPS

Discovery is complete. The architectural boundaries, contracts, Task 045 baseline integration, and test matrix for Task 054 have been fully mapped and verified.

**STRICT STOP CONDITION APPLIED**:  
No implementation code has been written. Awaiting user review and authorization before proceeding to implementation planning.
