# Task 043 — Terminal Runtime & Process Supervisor Adapter — Host Integration

## Completion Report

**Date:** 2026-08-21
**Branch:** `main`
**Status:** ✅ COMPLETE
**Task Scope:** NexusOS Desktop Agent — Host Integration Series

---

## 1. Summary

Task 043 wired the pre-existing `TerminalRuntime` core and `ProcessSupervisor` into the `DesktopAgent` composition root (`agent.ts`), delivering fully authorized IPC method handlers for terminal command execution, process kill, and process listing operations — all protected by multi-layer security controls per the Desktop Agent EDD Section 3.6 and PRD Section 5.6.

---

## 2. Authoritative References

| Reference                      | Section               | Title                                            |
| ------------------------------ | --------------------- | ------------------------------------------------ |
| Desktop Agent EDD              | Section 3.6           | Terminal Execution Runtime Architecture          |
| PRD                            | Section 5.6 / DEV-001 | Command Execution Security & Process Supervision |
| Task 042 Completion Report     | —                     | Filesystem Runtime Baseline                      |
| `task_043_discovery_report.md` | —                     | Task 043 Discovery Baseline                      |

---

## 3. Deliverables

### 3.1 Zod IPC Request Schemas

**File:** `apps/desktop-agent/src/runtimes/terminal/schemas.ts`

| Schema                                   | Purpose                                            |
| ---------------------------------------- | -------------------------------------------------- |
| `TerminalExecuteCommandIPCRequestSchema` | Validates `terminal.executeCommand` IPC parameters |
| `TerminalKillProcessIPCRequestSchema`    | Validates `terminal.killProcess` IPC parameters    |
| `TerminalListProcessesIPCRequestSchema`  | Validates `terminal.listProcesses` IPC parameters  |

All schemas require `leaseHeader: ExecutionLeaseHeader` and are exported via `apps/desktop-agent/src/runtimes/terminal/index.ts`.

### 3.2 Policy & Registry Authorizations

| File                                                  | Change                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `apps/desktop-agent/src/runtimes/plugin/policy.ts`    | Annotated `RuntimeCategory.TERMINAL` authorization           |
| `apps/desktop-agent/src/registry/runtime-registry.ts` | Annotated `RuntimeCategory.TERMINAL` descriptor registration |

### 3.3 Capability Descriptors (CapabilityRegistry)

Registered in `apps/desktop-agent/src/agent.ts`:

| Capability ID             | Scope            | isDangerous |
| ------------------------- | ---------------- | ----------- |
| `terminal.executeCommand` | `terminal:write` | `true`      |
| `terminal.killProcess`    | `terminal:write` | `true`      |
| `terminal.listProcesses`  | `terminal:read`  | `false`     |

### 3.4 DesktopAgent Composition Root (agent.ts)

- Imported `TerminalRuntime` and `ProcessSupervisor` from `./runtimes/terminal/index.js`.
- Added `public readonly terminalRuntime: TerminalRuntime` property.
- Added `customTerminalRuntime?: TerminalRuntime` constructor parameter for test injection.
- Instantiated `this.terminalRuntime` with `leaseBoundary`, `ProcessSupervisor`, `PathSecurityService`, and `logger`.
- Registered `rt:terminal-v1` descriptor via `this.runtimeRegistry.registerRuntime(this.terminalRuntime.getDescriptor())`.
- Bound `this.terminalRuntime.shutdown()` to `DesktopAgent.stop()`.

### 3.5 IPC Method Handlers

Registered in `apps/desktop-agent/src/agent.ts`:

| Method                    | Security Controls                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `terminal.executeCommand` | Lifecycle check → Policy authorization → Lease validation → Write scope check → Zod parse → `TerminalRuntime.executeCommand()` → RedactionFilter |
| `terminal.killProcess`    | Lifecycle check → Policy authorization → Lease validation → Write scope check → Zod parse → `TerminalRuntime.killProcess()` → RedactionFilter    |
| `terminal.listProcesses`  | Lifecycle check → Policy authorization → Lease validation → Zod parse → `TerminalRuntime.listProcesses()` → RedactionFilter                      |

### 3.6 ProcessSupervisor Shutdown (`killAll`)

**File:** `apps/desktop-agent/src/runtimes/terminal/process-supervisor.ts`

Added `public killAll(): void` which terminates all active managed child processes during agent shutdown.

### 3.7 TerminalRuntime Shutdown (`shutdown`)

**File:** `apps/desktop-agent/src/runtimes/terminal/runtime.ts`

Added `public shutdown(): void` which delegates to `this.processSupervisor.killAll()`.

---

## 4. Test Coverage

### 4.1 IPC Integration & Lifecycle Tests

**File:** `apps/desktop-agent/tests/local-terminal-ipc.test.ts`

| Test Case | Description                                                               |
| --------- | ------------------------------------------------------------------------- |
| 1         | `terminalRuntime` exposed as `TerminalRuntime` instance                   |
| 2         | `rt:terminal-v1` registered in `RuntimeRegistry` with category `TERMINAL` |
| 3         | Capability descriptors registered in `CapabilityRegistry`                 |
| 4         | `terminal.executeCommand` executes `node -v` via IPC                      |
| 5         | `terminal.listProcesses` returns process list via IPC                     |
| 6         | `terminal.killProcess` responds for unknown process token                 |
| 7         | Reject malformed IPC payload (missing `cwd`)                              |
| 8         | Reject expired execution lease                                            |
| 9         | Reject terminal operations during `STOPPING` lifecycle state              |

### 4.2 Adversarial Security Regression Tests

**File:** `apps/desktop-agent/tests/local-terminal-security-hardening.test.ts`

| Case ID    | Description                                                              |
| ---------- | ------------------------------------------------------------------------ |
| 043-SEC-01 | Deny command not in permitted allowlist (`curl`)                         |
| 043-SEC-02 | Deny `powershell -Command` shell-string execution                        |
| 043-SEC-03 | Deny `powershell -c` shell-string shorthand                              |
| 043-SEC-04 | Deny `cmd /c` shell-string execution                                     |
| 043-SEC-05 | Deny path traversal outside `allowedRoots` (`../..`)                     |
| 043-SEC-06 | Deny absolute path escaping to system root                               |
| 043-SEC-07 | Deny execution with missing `term:execute` capability scope              |
| 043-SEC-08 | Deny `terminal.executeCommand` IPC without write scope                   |
| 043-SEC-09 | Deny `terminal.killProcess` IPC without write scope                      |
| 043-SEC-10 | Deny IPC call during `STOPPING` lifecycle state                          |
| 043-SEC-11 | Deny `powershell -EncodedCommand` (Base64 bypass attempt)                |
| 043-SEC-12 | Deny sensitive env key injection (`SECRET_TOKEN`, `API_KEY`, `password`) |

---

## 5. Commit History

| Commit    | Message                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `0c948c4` | `feat(desktop-agent): define Task 043 Terminal Runtime IPC request and response Zod schemas`         |
| `ee6fa7f` | `feat(desktop-agent): authorize TERMINAL runtime category in PluginExecutionPolicy`                  |
| `5f7b9c5` | `feat(desktop-agent): register rt:terminal-v1 descriptor in RuntimeRegistry`                         |
| `6b879ea` | `feat(desktop-agent): register Terminal capability descriptors in CapabilityRegistry`                |
| `3f1dbef` | `feat(desktop-agent): wire TerminalRuntime into DesktopAgent composition root`                       |
| `085ee03` | `feat(desktop-agent): register authorized terminal execution IPC handler`                            |
| `aa8e70e` | `feat(desktop-agent): register authorized terminal kill and list IPC handlers`                       |
| `a16e1d0` | `fix(desktop-agent): harden TerminalRuntime lifecycle and process supervisor shutdown boundary`      |
| `4cf09d4` | `test(desktop-agent): add Terminal IPC integration and lifecycle test suite`                         |
| `275fad5` | `test(desktop-agent): add Task 043 adversarial security regression suite (043-SEC-01 to 043-SEC-12)` |
| `193e663` | `style(desktop-agent): apply Prettier formatting to Task 043 sources and tests`                      |
| _(this)_  | `docs(desktop-agent): create Task 043 completion report`                                             |

---

## 6. Security Architecture Diagram

```
IPC Caller
    │
    ▼
[IPCManager.registerMethodHandler('terminal.executeCommand')]
    │
    ├── 1. Lifecycle State Check (STOPPING/STOPPED/FAILED → reject)
    ├── 2. PluginExecutionPolicy.isRuntimeCategoryAuthorized(TERMINAL)
    ├── 3. ExecutionLeaseBoundary.validateLease(leaseHeader)
    ├── 4. Write Scope Check (terminal:write | admin | *)
    ├── 5. Zod Schema Parse (TerminalExecuteCommandIPCRequestSchema)
    │
    ▼
[TerminalRuntime.executeCommand(request, context)]
    │
    ├── 1. Lease & Policy Re-validation
    ├── 2. Capability Scope Check (term:execute required)
    ├── 3. Command Allowlist Validation
    ├── 4. Argument Vector Type Check (Array.isArray)
    ├── 5. Shell Interpreter Flag Guard (powershell/cmd -c/-Command/etc.)
    ├── 6. PathSecurityService.validatePath(cwd, allowedRoots)
    │
    ▼
[ProcessSupervisor.executeSupervisedProcess(request, limits)]
    │
    ├── spawn(command, args, { shell: false })
    ├── stdio buffer truncation (maxOutputSizeBytes)
    ├── timeout enforcement (maxTimeoutMs)
    └── environment sanitization (ALLOWED_BASE_ENV_KEYS only)
    │
    ▼
[RedactionFilter.redactObject(result)] → IPC Caller
```

---

## 7. Preserved Backward Compatibility

- Tasks 03A–042 are fully intact.
- No existing `TerminalRuntime` core logic was changed.
- No cloud/control-plane terminal execution was modified.
- No GUI terminal windows were created.
- `ExecutionLeaseBoundary`, `PluginExecutionPolicy`, and `PathSecurityService` were not bypassed.
- `shell: false` is preserved in `ProcessSupervisor.executeSupervisedProcess`.

---

## 8. Task 044 Status

**Task 044 — Browser Runtime Host Integration: NOT STARTED.**

Per user directive: _"Do NOT start Task 044."_
