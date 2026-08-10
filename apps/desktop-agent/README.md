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

| Module                   | File                                        | Purpose                                            |
| ------------------------ | ------------------------------------------- | -------------------------------------------------- |
| Config                   | `src/config/index.ts`                       | Zod-validated agent configuration from env vars    |
| Lifecycle Manager        | `src/lifecycle/index.ts`                    | State machine with validated transitions           |
| Agent Identity           | `src/identity/agent-identity.ts`            | Device identity, fingerprint, attestation boundary |
| Control Plane Client     | `src/communication/control-plane-client.ts` | Registration, heartbeat, disconnect interface      |
| Capability Registry      | `src/registry/capability-registry.ts`       | Capability vs permission separation                |
| Runtime Registry         | `src/registry/runtime-registry.ts`          | Runtime descriptors with zero-executable guard     |
| Execution Lease Boundary | `src/permissions/lease-boundary.ts`         | Lease schema validation, expiry, policy check      |
| Local State Store        | `src/state/local-state-store.ts`            | Immutable state snapshots (in-memory)              |
| Agent Logger             | `src/observability/agent-logger.ts`         | Structured logging with secret key redaction       |
| Sandbox Isolation        | `src/sandbox/isolation-boundary.ts`         | Logical isolation policy (OS sandbox planned)      |
| Agent Orchestrator       | `src/agent.ts`                              | Startup, registration, heartbeat, shutdown         |

## Security Boundaries

1. **Zero-Executable Foundation**: The `RuntimeRegistry` rejects any runtime
   descriptor with `isExecutable: true`. No filesystem, terminal, browser,
   or model execution is possible in this foundation layer.

2. **Lease Validation**: Every execution request must pass through the
   `ExecutionLeaseBoundary`, which validates the lease schema against
   `@nexusos/contracts`, checks expiration, and evaluates policy via
   `@nexusos/policy`.

3. **Secret Redaction**: The `AgentLogger` redacts any log detail key
   containing "secret", "token", "password", or "key".

4. **Immutable State**: Identity objects and state snapshots are frozen
   via `Object.freeze()`.

5. **Sandbox Isolation**: Logical isolation is enabled by default. OS-level
   process sandboxing is planned for future runtime phases.

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
in Task 03A and are deferred to future phases:

- Filesystem Runtime
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
