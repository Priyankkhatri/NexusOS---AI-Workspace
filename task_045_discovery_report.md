# TASK 045 — DISCOVERY REPORT

## 1. Task Identity

- **Canonical Task Name**: `TASK 045 — PLUGIN RUNTIME & HOST MANAGER ADAPTER — HOST INTEGRATION`
- **Task Number**: Task 045
- **Runtime ID**: `rt:plugin-v1`
- **Runtime Category**: `RuntimeCategory.PLUGIN` (`PLUGIN`)
- **Authoritative Specifications**:
  - **Desktop Agent EDD**: Section 3.8 (_Plugin Host Manager_), Section 12 (_Plugin Runtime — Lifecycle, Isolation, SDK, Sandbox & Marketplace Integration_), Section 18.6 (_Plugin Loading Sequence Diagram_), Section 1.4 (_Trust Boundaries: Plugin/MCP Host_)
  - **Enterprise PRD**: Section 5.9 (_CON-001 Connector, Plugin, and MCP Registry_), Section 15 (_Plugin and MCP Platform_), Section 38 (_Plugin Sandbox_), Section 7.2 (_Untrusted Content & Tool Isolation_)
  - **Sprint 0 Blueprint**: Host-Integration Series (Tasks 041–045: Device, Filesystem, Terminal, Browser, Plugin)
  - **Task 044 Completion Report**: `apps/desktop-agent/docs/task-044-completion-report.md`
- **Repository Baseline**:
  - **Branch**: `main`
  - **HEAD Commit**: `0874b99` (`docs(desktop-agent): create Task 044 completion report`)
  - **Tracking**: `HEAD == origin/main` (synchronized)
  - **Working Tree**: Clean (`nothing to commit, working tree clean`)
  - **Task 044 Status**: COMPLETE & VERIFIED
  - **Task 045 Status**: NOT STARTED (Discovery Phase Only)

---

## 2. Executive Summary

Task 045 is the final host-integration milestone of the core tool runtime series (following Task 041 Device, Task 042 Filesystem, Task 043 Terminal, and Task 044 Browser). While core plugin validation, catalog persistence, quarantine governance, and policy gate components already exist in `apps/desktop-agent/src/runtimes/plugin/`, they remain unintegrated with the `DesktopAgent` host composition root, `RuntimeRegistry`, `CapabilityRegistry`, and the authenticated Named Pipe IPC pipeline.

Task 045 integrates `PluginRuntime` (`rt:plugin-v1`), `PluginVerifier`, `PluginCatalog`, `PluginQuarantineStore`, and `PluginPolicyGateway` into `DesktopAgent` (`agent.ts`). It exposes 8 secure, schema-validated IPC method handlers (`plugin.verify`, `plugin.install`, `plugin.activate`, `plugin.invoke`, `plugin.suspend`, `plugin.quarantine`, `plugin.listEntries`, `plugin.listQuarantined`), enforces multi-layered defense (lifecycle state assertion, policy authorization, lease validation, capability scope checks, quarantine checks, resource limits, and output redaction), binds runtime shutdown to agent lifecycle termination, and delivers comprehensive integration and adversarial security test suites (`045-SEC-01` through `045-SEC-12`).

---

## 3. Authoritative Specification Sources

| File                                                                        | Section                                                         | Requirement Summary                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`        | **Section 3.8** (_Plugin Host Manager_)                         | Defines purpose: resolve signed plugin packages, enforce lifecycle, allocate sandboxed hosts, pass attenuated capabilities, collect health, and quarantine failures. Interfaces: `IPluginCatalog`, `IPluginVerifier`, `IPluginHostFactory`, `IPluginPolicyGateway`, `IPluginQuarantineStore`. Prohibits unverified/untrusted plugin code in coordinator process. |
| `docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`        | **Section 12** (_Plugin Runtime_)                               | Details lifecycle states: `DISCOVERED`, `VERIFIED`, `INSTALLED`, `ACTIVATED`, `SUSPENDED`, `QUARANTINED`. Verification must check publisher signature, manifest schema, compatibility, and declared capabilities. Invocations must evaluate capability attenuation and policy at runtime.                                                                        |
| `docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`        | **Section 18.6** (_Plugin Loading Sequence_)                    | Mermaid sequence flow: Coordinator → Plugin Verifier → Plugin Host → Permission Manager / Policy Gate → Health & Evidence emission.                                                                                                                                                                                                                              |
| `docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`        | **Section 1.4** (_Trust Boundaries_)                            | Declares Plugin/MCP hosts as untrusted inputs requiring isolated processes, typed host protocol, output resource limits, lease boundaries, and automatic suspend/quarantine on anomaly.                                                                                                                                                                          |
| `docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md` | **Section 5.9** (_CON-001 Connector, Plugin, and MCP Registry_) | Unified integrations area for plugins, local tools, and MCP servers with trust tiers, permission manifests, status, and device-level enforcement.                                                                                                                                                                                                                |
| `docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md` | **Section 15** (_Plugin and MCP Platform_)                      | Packages expose capabilities via declared manifests. Invocations must respect least-privilege scoping, digital signatures, and resource constraints.                                                                                                                                                                                                             |
| `docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md` | **Section 38** (_Plugin Sandbox_)                               | Sandbox tiers, resource governance (`maxConcurrentHosts`, `hostTimeoutMs`, `maxCrashAttempts`), and automated suspension and quarantine flows.                                                                                                                                                                                                                   |
| `apps/desktop-agent/docs/task-044-completion-report.md`                     | **Sections 1–9**                                                | Task 044 completion record establishing the host integration template: schemas, capability descriptors, composition root wiring, IPC handlers, lifecycle hooks, and adversarial security suites. Confirms Task 045+ was NOT started.                                                                                                                             |

---

## 4. Current Repository State

- **Branch**: `main`
- **HEAD Commit**: `0874b9942f729de78b3452992190f3898e0cedcf`
- **Sync**: Perfectly synchronized with `origin/main`
- **Working Tree**: Clean (untracked discovery reports only)
- **Completed Host Integrations**:
  - Task 040: Notification Manager (`rt:notification-v1`)
  - Task 041: Device Runtime (`rt:device-v1`)
  - Task 042: Filesystem Runtime (`rt:filesystem-v1`)
  - Task 043: Terminal Runtime (`rt:terminal-v1`)
  - Task 044: Browser Runtime (`rt:browser-v1`)
- **Task 045 State**: Ready for planning and execution. No source code or tests modified during discovery.

---

## 5. Existing Implementation Audit

| Component                  | Location                                                           | Status            | Evidence                                                                                                                                                      | Task 045 Action                                                                                          |
| -------------------------- | ------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PluginRuntime`            | `apps/desktop-agent/src/runtimes/plugin/runtime.ts`                | EXISTS / COMPLETE | Implements `verifyPluginPackage`, `installPlugin`, `activatePlugin`, `invokePlugin`, `suspendPlugin`, `quarantinePlugin`, `getDescriptor()` (`rt:plugin-v1`). | KEEP / HARDEN: Add `shutdown(): void` method to reset active host count.                                 |
| `PluginVerifier`           | `apps/desktop-agent/src/runtimes/plugin/verifier.ts`               | EXISTS / COMPLETE | Cryptographic signature verification, manifest validation, trust level derivation (`UNVERIFIED`, `VERIFIED_PUBLISHER`, `ENTERPRISE_INTERNAL`).                | KEEP AS-IS (No changes required).                                                                        |
| `PluginCatalog`            | `apps/desktop-agent/src/runtimes/plugin/catalog.ts`                | EXISTS / COMPLETE | In-memory package catalog, state transition validation (blocks QUARANTINED → ACTIVATED/INSTALLED transitions).                                                | KEEP AS-IS (No changes required).                                                                        |
| `PluginQuarantineStore`    | `apps/desktop-agent/src/runtimes/plugin/quarantine-store.ts`       | EXISTS / COMPLETE | Quarantine record storage, query, quarantine lift, crash count tracking.                                                                                      | KEEP AS-IS (No changes required).                                                                        |
| `PluginPolicyGateway`      | `apps/desktop-agent/src/runtimes/plugin/policy-gateway.ts`         | EXISTS / COMPLETE | Evaluates invocation against manifest `requestedCapabilities` and lease scopes (`plugin:<cap>` / `plugin:invoke`).                                            | KEEP AS-IS (No changes required).                                                                        |
| `PluginExecutionPolicy`    | `apps/desktop-agent/src/runtimes/plugin/policy.ts`                 | EXISTS / COMPLETE | `isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)` returns `true`.                                                                                         | KEEP AS-IS (Already authorizes `PLUGIN`).                                                                |
| `PluginTypes`              | `apps/desktop-agent/src/runtimes/plugin/types.ts`                  | EXISTS / COMPLETE | Defines `PluginOperationName`, `PluginPackage`, `PluginManifest`, `PluginResourceLimits`, etc.                                                                | KEEP AS-IS (Exported via `index.ts`).                                                                    |
| IPC Request Schemas        | `apps/desktop-agent/src/runtimes/plugin/schemas.ts`                | **MISSING**       | File does not exist.                                                                                                                                          | **CREATE**: Define Zod schemas for all 8 plugin IPC methods.                                             |
| Capability Descriptors     | `apps/desktop-agent/src/agent.ts`                                  | **MISSING**       | `plugin.*` capabilities not registered in `CapabilityRegistry`.                                                                                               | **CREATE**: Register 8 `plugin.*` capability descriptors in `agent.ts`.                                  |
| Composition Root Wiring    | `apps/desktop-agent/src/agent.ts`                                  | **MISSING**       | `pluginRuntime` property missing from `DesktopAgent`, `rt:plugin-v1` not registered in `runtimeRegistry`.                                                     | **CREATE**: Wire `PluginRuntime` instance, register descriptor, wire into `orchestrator`, bind shutdown. |
| IPC Method Handlers        | `apps/desktop-agent/src/agent.ts`                                  | **MISSING**       | No IPC handlers registered for `plugin.*` methods in `IPCManager`.                                                                                            | **CREATE**: Register 8 authorized, validated IPC method handlers in `agent.ts`.                          |
| IPC Integration Tests      | `apps/desktop-agent/tests/local-plugin-ipc.test.ts`                | **MISSING**       | File does not exist.                                                                                                                                          | **CREATE**: 10-case IPC integration and lifecycle test suite.                                            |
| Adversarial Security Tests | `apps/desktop-agent/tests/local-plugin-security-hardening.test.ts` | **MISSING**       | File does not exist.                                                                                                                                          | **CREATE**: 12-case security regression test suite (`045-SEC-01` to `045-SEC-12`).                       |
| Completion Report          | `apps/desktop-agent/docs/task-045-completion-report.md`            | **MISSING**       | File does not exist.                                                                                                                                          | **CREATE**: Final Task 045 completion documentation.                                                     |

---

## 6. Requirements

### 6.1 Functional Requirements

- **FR-01 (Verification)**: IPC callers can submit a plugin package (`pkg`) for cryptographic signature and manifest schema verification via `plugin.verify`.
- **FR-02 (Installation)**: Validated plugin packages can be installed into the catalog via `plugin.install`. Quarantined plugins must be rejected.
- **FR-03 (Activation)**: Installed plugins can transition to active state via `plugin.activate`. Quarantined plugins must not activate.
- **FR-04 (Invocation)**: Active plugins can be invoked via `plugin.invoke` if and only if the requested capability is declared in the manifest, the execution lease grants the scope, the plugin is not quarantined, and concurrent host limits are not exceeded.
- **FR-05 (Suspension)**: Active plugins can be suspended via `plugin.suspend`.
- **FR-06 (Quarantine)**: Failing, crashing, or suspicious plugins can be quarantined via `plugin.quarantine` with an explicit reason.
- **FR-07 (Catalog & Quarantine Query)**: Registered plugins and active quarantine records can be queried via `plugin.listEntries` and `plugin.listQuarantined`.

### 6.2 Architectural Requirements

- **AR-01 (Composition Root)**: `DesktopAgent` must instantiate and expose `public readonly pluginRuntime: PluginRuntime`, accept `customPluginRuntime?: PluginRuntime` in constructor for test injection, and register `rt:plugin-v1` in `RuntimeRegistry`.
- **AR-02 (Orchestrator Integration)**: Pass `this.pluginRuntime` into `AgentOrchestrator` constructor so task routing executes real plugin invocations.
- **AR-03 (Non-Duplication)**: Reuse existing `PluginVerifier`, `PluginCatalog`, `PluginQuarantineStore`, and `PluginPolicyGateway` rather than reinventing validation or storage.

### 6.3 Security Requirements

- **SR-01 (Fail-Closed Lifecycle)**: Reject all plugin IPC requests if agent lifecycle state is `STOPPING`, `STOPPED`, or `FAILED`.
- **SR-02 (Policy Authorization)**: Enforce `PluginExecutionPolicy.isRuntimeCategoryAuthorized(RuntimeCategory.PLUGIN)` before processing any plugin request.
- **SR-03 (Execution Lease Validation)**: Require a valid, unexpired `ExecutionLeaseHeader` verified by `ExecutionLeaseBoundary.validateLease()`.
- **SR-04 (Capability Scope Enforcement)**: Enforce required scopes for mutating operations (`plugin:install`, `plugin:activate`, `plugin:invoke`, `plugin:suspend`, `plugin:quarantine`, `write`, `admin`, `*`).
- **SR-05 (Quarantine Invariant)**: Disallow installation, activation, or invocation of quarantined plugins. Disallow direct transition from `QUARANTINED` to `ACTIVATED` or `INSTALLED`.
- **SR-06 (Signature Authority & Trust)**: Enforce cryptographic signature verification and derive trust levels from signature authority, not self-declared manifest claims.
- **SR-07 (Manifest Capability Attenuation)**: Prohibit invoking capabilities not explicitly declared in `manifest.requestedCapabilities`.
- **SR-08 (Resource Limit Protection)**: Enforce `maxConcurrentHosts` resource quotas to prevent runaway process/host exhaustion.
- **SR-09 (Secret Redaction)**: Sanitize all plugin responses, error messages, and trace attributes using `RedactionFilter`.
- **SR-10 (Tenant Isolation)**: Reject cross-tenant plugin execution where lease context tenant does not match active subject tenant.

### 6.4 Lifecycle Requirements

- **LR-01 (Graceful Shutdown)**: `PluginRuntime` must provide a `shutdown(): void` method.
- **LR-02 (Stop Binding)**: `this.pluginRuntime.shutdown()` must be called during `DesktopAgent.stop()` to reset active host allocations.

### 6.5 IPC/API Surface Requirements

- **IR-01 (8 IPC Methods)**:
  1. `plugin.verify`
  2. `plugin.install`
  3. `plugin.activate`
  4. `plugin.invoke`
  5. `plugin.suspend`
  6. `plugin.quarantine`
  7. `plugin.listEntries`
  8. `plugin.listQuarantined`
- **IR-02 (Strict Zod Schemas)**: All 8 methods must validate parameters using strict Zod schemas defining types, string lengths, object structures, and `ExecutionLeaseHeaderSchema`.

### 6.6 Testing Requirements

- **TR-01 (Integration Suite)**: 10-case IPC integration and lifecycle test suite (`apps/desktop-agent/tests/local-plugin-ipc.test.ts`).
- **TR-02 (Adversarial Security Suite)**: 12-case security regression suite (`apps/desktop-agent/tests/local-plugin-security-hardening.test.ts`, `045-SEC-01` to `045-SEC-12`).

### 6.7 Documentation Requirements

- **DR-01 (Completion Report)**: Create `apps/desktop-agent/docs/task-045-completion-report.md`.

---

## 7. Architecture / Integration Map

```
Named Pipe IPC Caller
         │
         ▼
[IPCManager.registerMethodHandler('plugin.invoke')]
         │
         ├── 1. Agent Lifecycle State Check (STOPPING / STOPPED / FAILED → reject)
         ├── 2. PluginExecutionPolicy.isRuntimeCategoryAuthorized(PLUGIN)
         ├── 3. ExecutionLeaseBoundary.validateLease(leaseHeader)
         ├── 4. Scope Check (plugin:invoke | plugin:<cap> | write | admin | *)
         ├── 5. Zod Schema Parse (PluginInvokeIPCRequestSchema)
         │
         ▼
[DesktopAgent.pluginRuntime.invokePlugin(request, context)]
         │
         ├── 1. Quarantine Check (quarantineStore.isQuarantined)
         ├── 2. Catalog Entry Check (catalog.getEntry → state === 'ACTIVATED')
         ├── 3. Policy Gateway Check (policyGateway.evaluateInvocation)
         │      ├── Manifest Capability Match (manifest.requestedCapabilities)
         │      └── Lease Scope Match (plugin:<cap> | plugin:invoke)
         ├── 4. Resource Governor Check (activeHostsCount < maxConcurrentHosts)
         ├── 5. Sandboxed Host Execution (mock host execution)
         └── 6. Event Emission (nexusos.events.plugin.invocation_completed.v1)
         │
         ▼
[RedactionFilter.redactObject(result)]
         │
         ▼
[TelemetryManager.trackTrace('plugin_invoke_ipc')]
         │
         ▼
IPC Caller (Sanitized JSON Response)
```

---

## 8. Security Threat Model

| ID           | Threat                                                 | Attack Surface                                         | Defense                                                                                                   | Required Test                                            |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `045-SEC-01` | Tampered / forged plugin package signature             | `plugin.verify` / `plugin.install`                     | Cryptographic signature verification via `PluginVerifier` rejecting forged/unsigned bundles               | `local-plugin-security-hardening.test.ts` (`045-SEC-01`) |
| `045-SEC-02` | Manifest capability escalation                         | `plugin.invoke`                                        | `PluginPolicyGateway` asserts requested capability is declared in signed manifest `requestedCapabilities` | `local-plugin-security-hardening.test.ts` (`045-SEC-02`) |
| `045-SEC-03` | Ambient execution without lease scope                  | `plugin.invoke`                                        | IPC handler and `PluginPolicyGateway` enforce required scope in `ExecutionLeaseHeader`                    | `local-plugin-security-hardening.test.ts` (`045-SEC-03`) |
| `045-SEC-04` | Quarantined plugin invocation / installation bypass    | `plugin.install` / `plugin.activate` / `plugin.invoke` | `PluginQuarantineStore.isQuarantined()` check rejects all operations on quarantined plugins               | `local-plugin-security-hardening.test.ts` (`045-SEC-04`) |
| `045-SEC-05` | Illegal state transition from QUARANTINED to ACTIVATED | `plugin.activate` / `catalog.setPluginState`           | State machine guards in `PluginCatalog` disallow direct transition out of QUARANTINED state               | `local-plugin-security-hardening.test.ts` (`045-SEC-05`) |
| `045-SEC-06` | Resource exhaustion via concurrent plugin hosts        | `plugin.invoke`                                        | `PluginRuntime` enforces `maxConcurrentHosts` ceiling, rejecting requests when host quota saturated       | `local-plugin-security-hardening.test.ts` (`045-SEC-06`) |
| `045-SEC-07` | Expired / invalid execution lease                      | All `plugin.*` IPC methods                             | `ExecutionLeaseBoundary.validateLease()` fails closed on expired/invalid leases                           | `local-plugin-security-hardening.test.ts` (`045-SEC-07`) |
| `045-SEC-08` | Cross-tenant execution / isolation breach              | `plugin.invoke`                                        | Context binding validates tenant ID against active lease context                                          | `local-plugin-security-hardening.test.ts` (`045-SEC-08`) |
| `045-SEC-09` | Invocations during agent termination                   | All `plugin.*` IPC methods                             | Agent lifecycle check rejects requests during `STOPPING`, `STOPPED`, or `FAILED` states                   | `local-plugin-security-hardening.test.ts` (`045-SEC-09`) |
| `045-SEC-10` | Malformed / schema-violating payload                   | All `plugin.*` IPC methods                             | Strict Zod schemas reject invalid fields, missing keys, or out-of-bounds parameters                       | `local-plugin-security-hardening.test.ts` (`045-SEC-10`) |
| `045-SEC-11` | Secret leakage in plugin execution outputs or errors   | All `plugin.*` IPC responses                           | `RedactionFilter` string/object sanitization removes sensitive credentials from responses                 | `local-plugin-security-hardening.test.ts` (`045-SEC-11`) |
| `045-SEC-12` | Orphan host state retention on agent shutdown          | `DesktopAgent.stop()`                                  | `PluginRuntime.shutdown()` cleans up active hosts and resets allocation counters                          | `local-plugin-security-hardening.test.ts` (`045-SEC-12`) |

---

## 9. Test Strategy

### 9.1 Unit & Contract Tests

- Zod schema contract tests in `apps/desktop-agent/src/runtimes/plugin/schemas.ts`.
- Pre-existing unit tests in `apps/desktop-agent/tests/plugin-verifier-catalog.test.ts` and `apps/desktop-agent/tests/plugin-runtime.test.ts` must continue to pass 100%.

### 9.2 IPC Integration & Lifecycle Tests (`apps/desktop-agent/tests/local-plugin-ipc.test.ts`)

1. Exposes `pluginRuntime` as `PluginRuntime` instance on `DesktopAgent`.
2. Registers `rt:plugin-v1` in `RuntimeRegistry` with category `PLUGIN`.
3. Registers 8 capability descriptors in `CapabilityRegistry`.
4. Executes `plugin.verify` via IPC with valid and invalid packages.
5. Executes `plugin.install` and `plugin.activate` via IPC.
6. Executes `plugin.invoke` via IPC with manifest-declared capability.
7. Executes `plugin.suspend` via IPC.
8. Executes `plugin.quarantine` via IPC and validates subsequent invocation denial.
9. Executes `plugin.listEntries` and `plugin.listQuarantined` via IPC.
10. Validates `PluginRuntime.shutdown()` on `DesktopAgent.stop()`.

### 9.3 Adversarial Security Regression Suite (`apps/desktop-agent/tests/local-plugin-security-hardening.test.ts`)

12 distinct security test cases covering `045-SEC-01` through `045-SEC-12` as defined in Section 8.

---

## 10. Acceptance Criteria

1. `apps/desktop-agent/src/runtimes/plugin/schemas.ts` created with Zod schemas for all 8 IPC methods.
2. `apps/desktop-agent/src/runtimes/plugin/index.ts` exports all schemas and types.
3. `apps/desktop-agent/src/runtimes/plugin/runtime.ts` hardened with `shutdown(): void` method.
4. `apps/desktop-agent/src/agent.ts` wires `this.pluginRuntime`, exposes `public readonly pluginRuntime: PluginRuntime`, accepts `customPluginRuntime?: PluginRuntime` constructor option, passes it to `AgentOrchestrator`, and registers `rt:plugin-v1` in `RuntimeRegistry`.
5. `apps/desktop-agent/src/agent.ts` registers 8 `plugin.*` capabilities in `CapabilityRegistry`.
6. `apps/desktop-agent/src/agent.ts` registers 8 authorized IPC method handlers (`plugin.verify`, `plugin.install`, `plugin.activate`, `plugin.invoke`, `plugin.suspend`, `plugin.quarantine`, `plugin.listEntries`, `plugin.listQuarantined`).
7. `apps/desktop-agent/src/agent.ts` calls `this.pluginRuntime.shutdown()` in `stop()`.
8. `apps/desktop-agent/tests/local-plugin-ipc.test.ts` created and passing 10/10 tests.
9. `apps/desktop-agent/tests/local-plugin-security-hardening.test.ts` created and passing 12/12 security test cases (`045-SEC-01` to `045-SEC-12`).
10. `package.json` test script updated with new test files.
11. `apps/desktop-agent/docs/task-045-completion-report.md` created with complete delivery documentation.
12. `npm run typecheck` passes with 0 TypeScript errors monorepo-wide.
13. `npm run lint` passes with 0 ESLint errors.
14. `npm run format:check` passes with 100% Prettier compliance.
15. `node scripts/validate-repo.js` passes repository boundary rules.
16. `node scripts/security-scan.js` passes with 0 security/secret violations.
17. `npm test` passes 100% of tests monorepo-wide.
18. Clean git working tree and synchronized commits.
19. Task 046+ NOT started.

---

## 11. Task Boundary

### BELONGS TO TASK 045

- Defining Zod schemas for the 8 plugin IPC methods in `src/runtimes/plugin/schemas.ts`.
- Adding `shutdown(): void` to `PluginRuntime`.
- Registering 8 capability descriptors in `CapabilityRegistry` in `agent.ts`.
- Wiring `PluginRuntime` into `DesktopAgent` composition root and `AgentOrchestrator`.
- Registering `rt:plugin-v1` descriptor in `RuntimeRegistry`.
- Implementing 8 secure IPC method handlers in `agent.ts`.
- Binding `this.pluginRuntime.shutdown()` to `DesktopAgent.stop()`.
- Adding IPC integration test suite (`tests/local-plugin-ipc.test.ts`).
- Adding adversarial security test suite (`tests/local-plugin-security-hardening.test.ts`).
- Adding test files to root `package.json` test script.
- Creating `apps/desktop-agent/docs/task-045-completion-report.md`.

### DOES NOT BELONG TO TASK 045

- Redesigning `PluginVerifier`, `PluginCatalog`, `PluginQuarantineStore`, or `PluginPolicyGateway` core algorithms.
- Modifying Tasks 03A–044 implementations, schemas, or tests.
- Implementing cloud control-plane marketplace catalog synchronization.
- Implementing OS-level kernel AppContainer sandboxing processes.
- Task 046+ features.

### DEFERRED TO TASK 046+

- Cloud-hosted Skills Marketplace & billing entitlement integration (PRD Section 15.2 / EDD Section 11).
- Remote third-party plugin download / delta-update transport from cloud marketplace.
- External MCP client stdio/SSE bridge processes.

---

## 12. Ambiguities / Conflicts

1. **Test Concurrency / Named Pipe Port Locking on Windows**:
   - _Observation_: Tests in Node.js test runner on Windows can experience named pipe endpoint collisions (`\\.\pipe\nexusos-desktop-ipc`) if multiple tests attempt to start the `IPCManager` concurrently.
   - _Resolution_: Root `package.json` already specifies `--test-concurrency=1` for `npm test`. Test suites must use unique temp directories and stop agent instances in `afterEach()` hooks.
2. **044-SEC-09 Test Pattern in Pre-existing Browser Hardening**:
   - _Observation_: In `local-browser-security-hardening.test.ts`, `044-SEC-09` attempted to call `browser.createSession` with an expired lease and did not catch the resulting thrown Error from the IPC handler.
   - _Resolution_: In Task 045's `045-SEC-07` security test, explicitly test both rejection behavior (asserting `assert.rejects` or checking `{ success: false }`) to ensure robust assertion patterns.

---

## 13. Proposed Implementation Plan

### Phase 1 — Zod Schemas & Contract Exports

- Create `apps/desktop-agent/src/runtimes/plugin/schemas.ts` defining:
  - `PluginManifestSchema`, `PluginPackageSchema`, `PluginResourceLimitsSchema`
  - `PluginVerifyPackageIPCRequestSchema`
  - `PluginInstallIPCRequestSchema`
  - `PluginActivateIPCRequestSchema`
  - `PluginInvokeIPCRequestSchema`
  - `PluginSuspendIPCRequestSchema`
  - `PluginQuarantineIPCRequestSchema`
  - `PluginListEntriesIPCRequestSchema`
  - `PluginListQuarantinedIPCRequestSchema`
- Update `apps/desktop-agent/src/runtimes/plugin/index.ts` to export schemas.

### Phase 2 — PluginRuntime Hardening

- Modify `apps/desktop-agent/src/runtimes/plugin/runtime.ts`:
  - Add `public shutdown(): void` method to reset active host allocations and log graceful shutdown.

### Phase 3 — Composition Root & IPC Handler Wiring

- Modify `apps/desktop-agent/src/agent.ts`:
  - Import `PluginRuntime` from `./runtimes/plugin/index.js`.
  - Add `public readonly pluginRuntime: PluginRuntime;` property.
  - Add `customPluginRuntime?: PluginRuntime` constructor parameter.
  - Instantiate `this.pluginRuntime = customPluginRuntime || new PluginRuntime(this.leaseBoundary, undefined, undefined, undefined, undefined, this.logger);`.
  - Pass `this.pluginRuntime` to `this.orchestrator`.
  - Register 8 capability descriptors in `CapabilityRegistry`.
  - Register `this.runtimeRegistry.registerRuntime(this.pluginRuntime.getDescriptor())`.
  - Register 8 IPC method handlers on `this.ipcManager`.
  - Bind `this.pluginRuntime.shutdown()` in `DesktopAgent.stop()`.

### Phase 4 — Test Suites Implementation

- Create `apps/desktop-agent/tests/local-plugin-ipc.test.ts` (10 integration test cases).
- Create `apps/desktop-agent/tests/local-plugin-security-hardening.test.ts` (12 adversarial test cases `045-SEC-01` to `045-SEC-12`).
- Update root `package.json` test script to include the new test files.

### Phase 5 — Quality Gates, Formatting & Completion Report

- Run `npm run format`.
- Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `node scripts/validate-repo.js`, `node scripts/security-scan.js`.
- Run `npm test` and verify 100% passing.
- Create `apps/desktop-agent/docs/task-045-completion-report.md`.

---

## 14. Proposed Commit Sequence

1. `feat(desktop-agent): define Task 045 Plugin Runtime IPC request and response Zod schemas`
2. `fix(desktop-agent): add PluginRuntime shutdown and graceful lifecycle reset`
3. `feat(desktop-agent): register Plugin capability descriptors in CapabilityRegistry`
4. `feat(desktop-agent): wire PluginRuntime into DesktopAgent composition root and orchestrator`
5. `feat(desktop-agent): register authorized plugin verify, install, and activate IPC handlers`
6. `feat(desktop-agent): register authorized plugin invoke, suspend, quarantine, and list IPC handlers`
7. `test(desktop-agent): add Plugin Runtime IPC integration and lifecycle test suite`
8. `test(desktop-agent): add Task 045 adversarial security regression suite (045-SEC-01 to 045-SEC-12)`
9. `style(desktop-agent): apply Prettier formatting to Task 045 sources and tests`
10. `docs(desktop-agent): create Task 045 completion report`

---

## 15. Final Discovery Verification

- Tracked files modified: **0**
- Source code changed: **0**
- Tests changed: **0**
- Dependencies changed: **0**
- Commits created: **0**
- Pushes performed: **0**
- Task 044 remains 100% intact and complete.
- Task 045 implementation NOT started.
