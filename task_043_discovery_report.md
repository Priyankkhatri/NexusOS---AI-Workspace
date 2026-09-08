# TASK 043 — AUTHORITATIVE DISCOVERY REPORT

## Terminal Runtime & Process Supervisor Adapter — Host Integration

---

### 1. BASELINE

- **Current HEAD**: `bf6852d4cac47493188dd0d2b2074dc7b4b52103`
- **Branch**: `main`
- **`origin/main` Synchronization**: `HEAD == origin/main` (`bf6852d4cac47493188dd0d2b2074dc7b4b52103`)
- **Working Tree Status**: Clean (`nothing to commit, working tree clean`)
- **Latest Completed Task**: Task 042 (Filesystem Runtime & Path Security Adapter — Host Integration, verified green on GitHub Actions CI #126 / Run 32467413315)
- **Task 043 Status**: **UNSTARTED** (Discovery phase only)

---

### 2. AUTHORITATIVE TASK DEFINITION

- **Task ID**: Task 043
- **Official Task Title**: `TASK 043 — TERMINAL RUNTIME & PROCESS SUPERVISOR ADAPTER — HOST INTEGRATION`
- **Authoritative Specifications**:
  - **EDD**: `docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md` — Section 3.6 (Terminal Execution Runtime Architecture)
  - **PRD**: `docs/PRDs/` — Section 5.6 (DEV-001 Command Execution Security & Process Supervision)
  - **Runtime Category**: `RuntimeCategory.TERMINAL` (`rt:terminal-v1`)

---

### 3. WHY THIS IS TASK 043 (EVIDENCE CHAIN)

Following the completion of core substrate tasks (03A–040), the NexusOS Desktop Agent roadmap integrates the four core executable tool runtime engines into the host plane (`DesktopAgent` composition root, `RuntimeRegistry`, `CapabilityRegistry`, `PluginExecutionPolicy`, `IPCManager`, and `ExecutionLeaseBoundary`):

1. **Task 041**: Device Runtime & Hardware Posture Adapter (`rt:device-v1`) — **COMPLETE**
2. **Task 042**: Filesystem Runtime & Path Security Adapter (`rt:filesystem-v1`) — **COMPLETE**
3. **Task 043**: **Terminal Runtime & Process Supervisor Adapter (`rt:terminal-v1`)** — **NEXT IN SEQUENCE**
4. **Task 044**: Browser Runtime & Domain Security Adapter (`rt:browser-v1`) — **FUTURE TASK**

Core implementation for `TerminalRuntime` and `ProcessSupervisor` already exists under `apps/desktop-agent/src/runtimes/terminal/`, but lacks host integration into `DesktopAgent`.

---

### 4. EXISTING IMPLEMENTATION (CORE COMPONENTS)

The following core runtime components are already implemented under `apps/desktop-agent/src/runtimes/terminal/`:

- `apps/desktop-agent/src/runtimes/terminal/runtime.ts`: Core `TerminalRuntime` class implementing command execution, process termination, process listing, command allowlist checking, and working directory validation.
- `apps/desktop-agent/src/runtimes/terminal/process-supervisor.ts`: `ProcessSupervisor` managing child process spawning, stdio buffer accumulation, process timeout enforcement, exit code tracking, and process cleanup.
- `apps/desktop-agent/src/runtimes/terminal/policy.ts`: `TerminalExecutionPolicy` checking command allowlist and argument vector safety.
- `apps/desktop-agent/src/runtimes/terminal/types.ts`: `PERMITTED_COMMAND_ALLOWLIST`, `ALLOWED_BASE_ENV_KEYS`, `ExecuteCommandRequest`, `ExecuteCommandResult`, `ManagedProcessInfo`, `KillProcessRequest`.

---

### 5. MISSING HOST INTEGRATION (ACTIONABLE CHECKLIST)

The following host-integration deliverables must be built for Task 043:

- [ ] **IPC Request Schemas** ([`apps/desktop-agent/src/runtimes/terminal/schemas.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/runtimes/terminal/schemas.ts)): Zod schemas for `terminal.executeCommand`, `terminal.killProcess`, `terminal.listProcesses`.
- [ ] **Policy Authorization** ([`apps/desktop-agent/src/runtimes/plugin/policy.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/runtimes/plugin/policy.ts)): Authorize `RuntimeCategory.TERMINAL` in `PluginExecutionPolicy.isRuntimeCategoryAuthorized()`.
- [ ] **Runtime Descriptor Registration** ([`apps/desktop-agent/src/registry/runtime-registry.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/registry/runtime-registry.ts)): Annotate `RuntimeCategory.TERMINAL` for Task 043.
- [ ] **Capability Registrations** ([`apps/desktop-agent/src/agent.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/agent.ts)): Register descriptors for `terminal.executeCommand` (`isDangerous: true`), `terminal.killProcess`, `terminal.listProcesses`.
- [ ] **Composition Root Wiring** ([`apps/desktop-agent/src/agent.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/agent.ts)): Instantiate `TerminalRuntime` and `ProcessSupervisor` in `DesktopAgent` constructor; register `rt:terminal-v1`.
- [ ] **IPC Method Handlers** ([`apps/desktop-agent/src/agent.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/agent.ts)): Register handlers for `terminal.executeCommand`, `terminal.killProcess`, `terminal.listProcesses` enforcing Zod validation, lifecycle state assertions, `ExecutionLeaseBoundary.validateLease()`, `terminal:write` scope checks, and output sanitization via `RedactionFilter`.
- [ ] **Lifecycle Shutdown Hooks** ([`apps/desktop-agent/src/agent.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/agent.ts)): Bind process termination (`processSupervisor.killAll()`) to `DesktopAgent.stop()`.
- [ ] **IPC Integration Test Suite** ([`apps/desktop-agent/tests/local-terminal-ipc.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/tests/local-terminal-ipc.test.ts)): Integration test suite for terminal IPC operations.
- [ ] **Adversarial Security Test Suite** ([`apps/desktop-agent/tests/local-terminal-security-hardening.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/tests/local-terminal-security-hardening.test.ts)): 12-case security suite (`043-SEC-01` to `043-SEC-12`).
- [ ] **Completion Report** ([`apps/desktop-agent/docs/task-043-completion-report.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/docs/task-043-completion-report.md)): Comprehensive Task 043 completion documentation.

---

### 6. TASK BOUNDARY

#### IN SCOPE (TASK 043)

- Defining Zod schemas for `terminal.executeCommand`, `terminal.killProcess`, `terminal.listProcesses`.
- Authorizing `RuntimeCategory.TERMINAL` in `PluginExecutionPolicy`.
- Registering `rt:terminal-v1` in `RuntimeRegistry` and 3 capability descriptors in `CapabilityRegistry`.
- Wiring `TerminalRuntime` into `DesktopAgent` composition root.
- Registering 3 authorized IPC method handlers in `agent.ts`.
- Binding process cleanup (`ProcessSupervisor.killAll()`) to `DesktopAgent.stop()`.
- Delivering IPC integration & lifecycle unit test suite.
- Delivering 12-case adversarial security test suite (`043-SEC-01` through `043-SEC-12`).
- Creating Task 043 completion report.

#### OUT OF SCOPE (DO NOT IMPLEMENT IN TASK 043)

- Task 044 (Browser Runtime Host Integration).
- Modifying core `TerminalRuntime` / `ProcessSupervisor` logic unless required to solve a concrete security or test failure.
- OS GUI terminal window rendering or interactive PTY pseudo-terminals.
- Cloud/control-plane command execution routing.

---

### 7. SECURITY THREAT MODEL & ADVERSARIAL CASES (`043-SEC-01` → `043-SEC-12`)

| Test ID      | Attack Scenario Description                                                                      | Affected Boundary            | Expected Defense Mechanism                                                           |
| ------------ | ------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| `043-SEC-01` | Command injection attempt via shell metacharacters (e.g. `node; rm -rf /`)                       | IPC Request Handler & Policy | Reject raw shell strings; enforce strict command allowlist and argument vector array |
| `043-SEC-02` | Unauthorized binary execution outside permitted allowlist (e.g. `nc`, `bash`, `powershell -enc`) | `TerminalExecutionPolicy`    | Enforce `PERMITTED_COMMAND_ALLOWLIST` check                                          |
| `043-SEC-03` | Expired or invalid `ExecutionLeaseHeader`                                                        | `ExecutionLeaseBoundary`     | Fail closed at lease boundary check                                                  |
| `043-SEC-04` | Working directory escape outside authorized workspace root (`cwd: ../../..`)                     | `PathSecurityService`        | Enforce canonical working directory scope check against `allowedRoots`               |
| `043-SEC-05` | Dangerous command execution without write scope (`terminal:write` scope missing)                 | IPC Method Handler           | Require explicit `terminal:write` scope in execution lease                           |
| `043-SEC-06` | Runaway process resource exhaustion (infinite loop execution)                                    | `ProcessSupervisor`          | Enforce execution timeout limit (`maxTimeoutMs`) with `SIGKILL` termination          |
| `043-SEC-07` | Excessively large stdout/stderr output flooding                                                  | `ProcessSupervisor`          | Truncate stdio buffer at `maxOutputSizeBytes` limit                                  |
| `043-SEC-08` | Secret token leakage in process command output or error trace                                    | `RedactionFilter`            | Sanitize stdout, stderr, and error messages via `RedactionFilter`                    |
| `043-SEC-09` | Process termination (`killProcess`) targeting unmanaged or cross-tenant process PID              | `ProcessSupervisor`          | Validate `processToken` ownership bound to active task/tenant context                |
| `043-SEC-10` | Command execution attempt during `STOPPING` / `STOPPED` agent state                              | Agent Lifecycle Boundary     | Reject IPC request if agent state is not `READY` / `RUNNING`                         |
| `043-SEC-11` | Unauthorized `TERMINAL` runtime category invocation                                              | `PluginExecutionPolicy`      | Fail closed if `RuntimeCategory.TERMINAL` is not authorized by execution policy      |
| `043-SEC-12` | Orphan process retention on agent shutdown (`DesktopAgent.stop()`)                               | Composition Root Lifecycle   | Execute `ProcessSupervisor.killAll()` on graceful agent shutdown                     |

---

### 8. EXPECTED TEST STRATEGY

1. **IPC Integration Test Suite** (`apps/desktop-agent/tests/local-terminal-ipc.test.ts`):

   - Verify `agent.terminalRuntime` instantiation.
   - Verify `rt:terminal-v1` descriptor in `RuntimeRegistry`.
   - Verify `terminal.executeCommand`, `terminal.killProcess`, `terminal.listProcesses` capabilities in `CapabilityRegistry`.
   - Verify IPC execution of permitted commands (`node`, `git`).
   - Verify process termination via `terminal.killProcess`.
   - Verify process listing via `terminal.listProcesses`.
   - Verify Zod schema validation errors on malformed payloads.
   - Verify lifecycle state rejection during `STOPPING`.

2. **Adversarial Security Test Suite** (`apps/desktop-agent/tests/local-terminal-security-hardening.test.ts`):
   - 12 distinct security test cases covering `043-SEC-01` through `043-SEC-12`.

---

### 9. EXPECTED COMMIT PLAN (12 COMMITS)

1. `feat(desktop-agent): define Task 043 Terminal Runtime IPC request and response Zod schemas`
2. `feat(desktop-agent): authorize TERMINAL runtime category in PluginExecutionPolicy`
3. `feat(desktop-agent): register rt:terminal-v1 descriptor in RuntimeRegistry`
4. `feat(desktop-agent): register Terminal capability descriptors in CapabilityRegistry`
5. `feat(desktop-agent): wire TerminalRuntime into DesktopAgent composition root`
6. `feat(desktop-agent): register authorized terminal execution IPC handler`
7. `feat(desktop-agent): register authorized terminal kill and list IPC handlers`
8. `fix(desktop-agent): harden TerminalRuntime lifecycle and process supervisor shutdown boundary`
9. `test(desktop-agent): add Terminal IPC integration and lifecycle test suite`
10. `test(desktop-agent): add Task 043 adversarial security regression suite (043-SEC-01 to 043-SEC-12)`
11. `style(desktop-agent): apply Prettier formatting to Task 043 sources and tests`
12. `docs(desktop-agent): create Task 043 completion report`

---

### 10. ACCEPTANCE CRITERIA

Before Task 043 can be declared COMPLETE:

1. `npm run build` — 0 TypeScript errors
2. `npm run typecheck` — 0 type errors monorepo-wide
3. `npm run lint` — 0 ESLint errors
4. `npm run format:check` — 100% Prettier compliant
5. `node scripts/validate-repo.js` — PASSED
6. `node scripts/security-scan.js` — PASSED
7. `npm test` — 100% tests passing across monorepo test suite
8. GitHub Actions CI run — 100% GREEN (SUCCESS)
9. Working tree clean (`nothing to commit, working tree clean`)
10. `HEAD == origin/main`
11. Task 044+ remains untouched.

---

### 11. BOUNDARY CONFIRMATION

- Tasks 03A–042 remain 100% intact and passing.
- Task 043 implementation has NOT been started.
- Task 044+ has NOT been started.
