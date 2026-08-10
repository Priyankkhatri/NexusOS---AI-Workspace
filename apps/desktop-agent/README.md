# @nexusos/desktop-agent

**NexusOS Desktop Agent Foundation — Local Execution Plane**

The Desktop Agent runs locally on the user's machine and acts as the
runtime-plane executor for NexusOS. It receives bounded, signed, expiring
work leases from the control plane; validates authority locally; executes
only within approved capabilities; and emits evidence, state, and
audit-linked events.

> **Sprint 0 / Phase 1 / Task 03A** — This is the foundational scaffold.
> No dangerous runtimes (filesystem, browser, terminal, camera, microphone)
> are executable at this level.

## Architecture

```
┌──────────────────────────────────────────────┐
│              DesktopAgent (Orchestrator)       │
│                                               │
│  ┌─────────────┐  ┌─────────────────────────┐│
│  │ Lifecycle    │  │ Identity Provider       ││
│  │ Manager     │  │ (Device ID, Fingerprint)││
│  └─────────────┘  └─────────────────────────┘│
│                                               │
│  ┌─────────────┐  ┌─────────────────────────┐│
│  │ Capability  │  │ Runtime Registry        ││
│  │ Registry    │  │ (Zero-Executable Guard) ││
│  └─────────────┘  └─────────────────────────┘│
│                                               │
│  ┌─────────────┐  ┌─────────────────────────┐│
│  │ Execution   │  │ Sandbox Isolation       ││
│  │ Lease       │  │ Boundary                ││
│  │ Boundary    │  │                         ││
│  └─────────────┘  └─────────────────────────┘│
│                                               │
│  ┌─────────────┐  ┌─────────────────────────┐│
│  │ Control     │  │ Local State Store       ││
│  │ Plane       │  │ (In-Memory)             ││
│  │ Client      │  │                         ││
│  └─────────────┘  └─────────────────────────┘│
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ Agent Logger (Secret Redaction)         │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## Lifecycle States

Per the Desktop Agent EDD Section 2.4:

| State    | Description                                    |
| -------- | ---------------------------------------------- |
| STOPPED  | Initial/terminal state                         |
| STARTING | Initialization, identity loading, registration |
| READY    | Fully operational, heartbeating                |
| DEGRADED | Heartbeat/dependency issue, limited operation  |
| STOPPING | Graceful shutdown in progress                  |
| FAILED   | Unrecoverable error                            |

Valid transitions are enforced by the `AgentLifecycleManager` state machine.

## Modules

| Module                   | File                                        | Purpose                                                        |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------- |
| Config                   | `src/config/index.ts`                       | Zod-validated agent configuration from env vars                |
| Lifecycle Manager        | `src/lifecycle/index.ts`                    | State machine with validated transitions                       |
| Agent Identity           | `src/identity/agent-identity.ts`            | Software-derived device fingerprint (NOT hardware attestation) |
| Control Plane Client     | `src/communication/control-plane-client.ts` | Registration, heartbeat, disconnect interface                  |
| Capability Registry      | `src/registry/capability-registry.ts`       | Capability vs permission separation                            |
| Runtime Registry         | `src/registry/runtime-registry.ts`          | Runtime descriptors with zero-executable guard                 |
| Execution Lease Boundary | `src/permissions/lease-boundary.ts`         | Lease schema validation, expiry, policy check                  |
| Local State Store        | `src/state/local-state-store.ts`            | Immutable state snapshots (in-memory)                          |
| Agent Logger             | `src/observability/agent-logger.ts`         | Structured logging with secret key redaction                   |
| Sandbox Isolation        | `src/sandbox/isolation-boundary.ts`         | Logical isolation policy (OS sandbox planned)                  |
| Agent Orchestrator       | `src/agent.ts`                              | Startup, registration, heartbeat, shutdown                     |

## Security Boundaries

1. **Zero-Executable Foundation**: The `RuntimeRegistry` enforces a
   `RuntimeExecutionPolicy`. The default `FoundationExecutionPolicy` rejects
   any runtime descriptor with `isExecutable: true`. Future runtime phases
   must inject an explicit policy that gates enablement through the required
   authorization chain (see "Future Runtime Enablement" below).

2. **Lease Validation**: Every execution request must pass through the
   `ExecutionLeaseBoundary`, which validates the lease schema against
   `@nexusos/contracts`, checks expiration, and evaluates policy via
   `@nexusos/policy`.

3. **Secret Redaction**: The `AgentLogger` redacts any log detail key
   containing "secret", "token", "password", or "key".

4. **Immutable State**: Identity objects and state snapshots are frozen
   via `Object.freeze()`.

5. **Sandbox Isolation**: Logical permission boundaries are active by
   default (`enableLogicalIsolation: true`). This is **not** OS-level
   process sandboxing — `enableOSProcessSandbox` is explicitly `false`.
   Actual OS-level isolation (Windows Job Objects, AppContainers, etc.)
   is planned for future runtime phases.

6. **Device Fingerprint ≠ Hardware Attestation**: The `deviceFingerprint`
   is a deterministic SHA-256 hash derived from the configured device ID.
   It does **not** prove physical hardware identity, TPM-backed key
   binding, or machine authenticity. The `verifyHardwareAttestation()`
   boundary returns `NOT_IMPLEMENTED` in the foundation layer. Future
   phases may integrate Windows TPM 2.0 or platform attestation APIs.

## Future Runtime Enablement

Runtime execution is gated by a `RuntimeExecutionPolicy`. To enable a
runtime in a future task:

```
Runtime registered (non-executable descriptor)
        ↓
Runtime capability declared in CapabilityRegistry
        ↓
Runtime authorization/policy requirements satisfied
        ↓
Valid execution lease obtained
        ↓
Custom RuntimeExecutionPolicy injected into RuntimeRegistry
        ↓
Runtime descriptor registered as executable
```

The foundation remains fail-closed. No runtime can become executable by
merely removing a guard — an explicit, policy-authorized mechanism is
required.

## Implemented Runtimes

### Filesystem Runtime (`@nexusos/desktop-agent/runtimes/filesystem`)

The Filesystem Runtime is the first executable tool runtime enabled in Task 03B. It operates under `FilesystemExecutionPolicy`, which authorizes `RuntimeCategory.FILESYSTEM` while keeping all other categories fail-closed.

**Key Security Controls:**

1. **Centralized Path Security (`PathSecurityService`)**: Canonical path resolution, traversal prevention (`..`, `..\`, null bytes, device paths), and strict scope checking against authorized root directories. Symlinks pointing outside authorized scopes trigger `SYMLINK_SCOPE_ESCAPE`.
2. **Policy & Lease Authorization**: Every operation requires a valid `ExecutionLeaseHeader` containing the required capability scope (`fs:read`, `fs:write`, `fs:list`, `fs:stat`, `fs:copy`, `fs:move`, `fs:delete`).
3. **Precondition Enforcement**: Supports asserting file existence, non-existence, expected file size, and SHA-256 hash before mutation to prevent stale overwrites.
4. **Atomic Safe Writes**: Writes use `.tmp` file buffering, fsync, and atomic rename replacement.
5. **Snapshots**: Captures before-mutation backup copies and metadata for overwrites, moves, and deletes.
6. **Resource Governance**: Enforces `maxFileSizeByte`, `maxDirectoryEntries`, and `maxRecursionDepth`.
7. **Evidence & Non-Disclosure**: Emits structured `EventEnvelope` events (`nexusos.events.filesystem.*.v1`). Raw file content and secrets are **never** logged or included in event payloads.

## Dependencies

| Package              | Purpose                             |
| -------------------- | ----------------------------------- |
| `@nexusos/contracts` | Shared schemas, lease header, types |
| `@nexusos/backend`   | Logger infrastructure               |
| `@nexusos/identity`  | AuthenticatedContext for lease eval |
| `@nexusos/policy`    | PolicyEvaluator for lease decisions |
| `zod`                | Schema validation                   |

## Not Yet Implemented

The following modules from the Desktop Agent EDD are **not** implemented
yet and are deferred to future phases:

- Terminal Runtime
- Browser Runtime
- Plugin Host Manager
- Local Model Host / AI Runtime
- Clipboard / Device Runtime
- Secrets Vault Client
- Task Scheduler / Execution Engine
- Health Monitor / Crash Recovery
- Update Manager
- Notification Manager
- IPC Manager (named pipes)
- Telemetry Manager
- Memory Cache
