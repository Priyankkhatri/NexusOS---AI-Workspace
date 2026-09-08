# Task 050 — Discovery Report

## Sprint 1 Milestone 2: Desktop Agent Filesystem & Sandbox Runtime Hardening (OS Directory Jail, Canonical Path Enforcement & Workspace Authorization)

**Date:** 2026-09-08  
**Mode:** DISCOVERY ONLY  
**Baseline HEAD SHA:** `c8f6d5498bdc5a05473bf0acf548b6fd80a08639`  
**Owning Subsystems:** Desktop Agent Runtime Plane (`apps/desktop-agent/src/runtimes/filesystem/`, `apps/desktop-agent/src/orchestrator/`) & Shared Contracts (`packages/contracts/src/`)  
**Status:** COMPLETE (Discovery Only — Implementation Not Started)

---

## 1. Exact Task Identity

- **Task Identifier:** `Task 050`
- **Canonical Title:** `TASK 050: SPRINT 1 MILESTONE 2 — DESKTOP AGENT FILESYSTEM & SANDBOX RUNTIME HARDENING (OS DIRECTORY JAIL, CANONICAL PATH ENFORCEMENT & WORKSPACE AUTHORIZATION)`
- **Sprint / Milestone:** `Sprint 1 — Milestone 2: Desktop Agent Filesystem & Sandbox Runtime Hardening`
- **Sprint 1 Track:** `Sprint 1 Week 1: Runtime & Orchestration Foundations` (Item 2)
- **Owning Subsystems:**
  - Desktop Agent Filesystem Runtime: `apps/desktop-agent/src/runtimes/filesystem/`
  - Desktop Agent Orchestrator: `apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`
  - Shared Contracts: `packages/contracts/src/`
- **Preceding Frontier:** `Task 049: Sprint 1 Milestone 1 — Multi-Step Workflow Graph Execution & Control-Plane Orchestration (DAG Task Foundation)` (Verified GREEN in CI Run `34252511202` and doc run `34252741711`, commit `c8f6d5498bdc5a05473bf0acf548b6fd80a08639`)
- **Authority Derivation:**
  - _Sprint 1 Readiness and Backlog Specification_ ([`docs/SPRINT_1_READINESS_AND_BACKLOG.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/SPRINT_1_READINESS_AND_BACKLOG.md)), Section 4 (`Sprint 1 Candidate Backlog`, Item 2) & Section 5 (`Recommended Sprint 1 Sequencing`, Week 1)
  - _NexusOS Sprint 0 Implementation Blueprint_ ([`docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md)), Section 59 (`Sprint 1 Candidate Work` — "Desktop filesystem runtime; workflow graph execution")
  - _NexusOS Desktop Agent Engineering Design Document (EDD)_ ([`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md)), Section 3.5 (`Filesystem Runtime`) & Section 10 (`Filesystem Runtime` — 10.1 Authorization and path safety, 10.2 Operations, 10.3 Watching/search/snapshots)
  - _NexusOS Architecture Bible_ ([`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)), Section 7.2 (`Filesystem Manager`), Section 13.3 (`Sandbox Tiers — Tier 2`), and Invariant 12 (`Sandbox external tools and plugins; never grant ambient host authority`)
  - _NexusOS Enterprise PRD v3_ ([`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md)), Section 4.3 & 7.2 (`Filesystem & Workspace Isolation`)

---

## 2. Why This Is the Next Task

Following the successful implementation, verification, and remote CI pass of Task 049 (commit `c8f6d54`), Task 050 is the authoritative and strictly ordered next task for the following reasons:

1. **Explicit Roadmap Sequencing:**
   As specified in [`docs/SPRINT_1_READINESS_AND_BACKLOG.md`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs/SPRINT_1_READINESS_AND_BACKLOG.md) (Section 5: Recommended Sprint 1 Sequencing), Week 1 is dedicated to "Runtime & Orchestration Foundations":

   - **Item 1:** Multi-Step Workflow Graph Execution (`services/orch` / backend control plane) -> **Completed in Task 049**.
   - **Item 2:** Desktop Filesystem Sandbox Hardening (`apps/desktop-agent`) -> **Authoritative Next (Task 050)**.

2. **Resolving a Critical Orchestration Disconnect in the Desktop Agent:**
   In Task 049, multi-step workflow graphs were wired into the Control Plane and Desktop Agent workflow engine. When `AgentOrchestrator` executes scheduled task nodes, lines 352–355 of [`apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/orchestrator/agent-orchestrator.ts) contain:

   ```typescript
   if (category === 'filesystem' && this.filesystemRuntime) {
     executionOutput = await (
       this.filesystemRuntime as unknown as { execute: (p: unknown) => Promise<unknown> }
     ).execute(runtimePayload);
   }
   ```

   However, `FilesystemRuntime` currently does **NOT** implement an `execute()` method. It only provides low-level disparate methods (`readFile`, `writeFile`, `listDirectory`, etc.). As a result, no workflow graph or scheduled task can execute filesystem capabilities through `AgentOrchestrator` without crashing or falling through to mock execution!

3. **Bridging from Simulated Capabilities to Governed Real Runtimes:**
   Task 047 and Task 049 proved end-to-end governance using the lightweight `DeviceRuntime` (`device.queryInfo`). Enterprise AI tasks operate primarily on local project code, artifacts, configurations, and logs. Real filesystem execution must be hardened with strict OS directory jailing before higher-level AI planner and terminal execution features can safely be introduced in subsequent milestones.

4. **Eliminating Security Vulnerabilities in Local Filesystem Operations:**
   While `PathSecurityService` implements preliminary normalization and relative check logic, it currently lacks:
   - Real OS directory jail boundaries bound to a specific workspace ID.
   - Rejection of NTFS Alternate Data Streams (e.g. `file.txt:stream`, `file.txt::$DATA`).
   - A hard-coded sensitive OS system path blacklist (protecting Windows system directories, user SSH keys, cloud tokens, browser keystores).
   - Strict separation of read-only vs. mutating write capabilities requiring explicit per-workspace authorization.
   - Deterministic cryptographic audit evidence chaining for file mutations.

---

## 3. Authoritative Requirements

The requirements are derived from four authoritative sources:

### 3.1 Sprint 1 Readiness and Backlog Specification (`docs/SPRINT_1_READINESS_AND_BACKLOG.md`, Section 4, Item 2)

- **Agent enforces strict path traversal protections:** Deepen filesystem runtime sandboxing with real OS directory jail constraints, `..` escape rejection, and symlink canonicalization.
- **Explicit per-workspace authorization:** Write capabilities require explicit authorization bound to the targeted workspace directory.
- **Cryptographic audit evidence:** Full cryptographic audit evidence (pre/post content SHA-256 hashes, byte counts, task/lease IDs) captured for all file modifications.

### 3.2 Desktop Agent EDD (`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`)

- **Section 3.5 (Filesystem Runtime):**
  - "Execute authorized local file operations with canonical path resolution, precondition checks, snapshots, evidence, and recovery semantics."
  - "Failure handling: deny traversal, reparse-point ambiguity, alternate data stream ambiguity, unsupported filesystem semantics, sharing violation, changed precondition, and protected/sensitive path."
- **Section 10.1 (Authorization and path safety):**
  - "Every operation begins with canonicalization under an approved root, including drive normalization, relative traversal resolution, reparse-point/symlink handling, UNC policy, case behavior, alternate data streams, and file identity capture."
  - "Trusted folders are explicit policy/configuration selectors. System directories, credential stores, SSH/key paths, browser credential stores, and configured sensitive patterns receive heightened protection."
  - "Access to a child through a reparse point outside an authorized root is denied unless policy explicitly authorizes the final resolved target."
- **Section 10.2 (Operations):**
  - "Read, list, search, copy, move, rename, create, write, archive, extract, metadata inspection, preview, duplicate detection, and supported structured-file operations use typed requests with preconditions."
  - "Mutations capture before/after metadata, actor, task/step, policy decision, content hash where feasible, and snapshot/receipt references."
- **Section 1.2 (Non-responsibilities):**
  - "The Desktop Agent MUST NOT: Execute arbitrary user/model/plugin instructions without a valid lease, capability binding, and runtime policy decision."

### 3.3 Architecture Bible (`docs/Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md`)

- **Section 7.2 (Filesystem Manager):**
  - "path normalization, allowlists, snapshots, safe mutations; block escape/symlink ambiguity; emit evidence."
- **Section 13.3 (Sandbox Tiers — Tier 2):**
  - Local tool integration must enforce process isolation, filesystem allowlists, and resource limits.
- **Invariant 12:** "Sandbox external tools and plugins; never grant ambient host authority."

### 3.4 Enterprise PRD v3 (`docs/PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md`)

- **Section 4.3 & 7.2:**
  - Strict workspace directory boundaries; zero leakage across workspace trees.
  - All file mutations must be auditable and roll-backable via snapshot references.

---

## 4. Existing Architecture / Components

The repository already contains foundational filesystem building blocks implemented during Sprint 0, which must be extended rather than replaced:

1. **`PathSecurityService`** ([`apps/desktop-agent/src/runtimes/filesystem/path-security.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/runtimes/filesystem/path-security.ts)):

   - Implements `normalizePath(rawPath)`, `validatePath(targetPath, allowedRoots)`, and `isSubpath(target, parent)`.
   - Handles Windows drive normalization (`c:\` -> `C:\`), device prefix rejection (`\\.\`, `\\?\`), and basic `realpathSync` resolution.
   - _Gaps to address:_ Lacks NTFS alternate data stream (ADS) rejection, lacks protected system directory blacklist, and lacks jail token checking.

2. **`FilesystemRuntime`** ([`apps/desktop-agent/src/runtimes/filesystem/runtime.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/runtimes/filesystem/runtime.ts)):

   - Implements discrete methods: `readFile`, `writeFile`, `listDirectory`, `statFile`, `copyFile`, `moveFile`, `deleteFile`.
   - Contains `executeProtectedOperation<T>` handling lease validation, scope checking, path security, and event envelope generation.
   - _Gaps to address:_ Missing the unified `execute(rawRequest: FilesystemOperationRequest)` method called by `AgentOrchestrator`; missing write authorization boundary based on workspace registration.

3. **`SnapshotManager`** ([`apps/desktop-agent/src/runtimes/filesystem/snapshot.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/runtimes/filesystem/snapshot.ts)):

   - Creates point-in-time snapshots of files before mutating operations (write, delete, move).
   - Generates SHA-256 content hashes and stores copies in a local snapshot directory.
   - _Gaps to address:_ Must be tied into cryptographic mutation evidence records chaining pre/post hashes for audit settlement.

4. **`AgentOrchestrator`** ([`apps/desktop-agent/src/orchestrator/agent-orchestrator.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/src/orchestrator/agent-orchestrator.ts)):

   - Orchestrates task execution across runtimes (`device`, `filesystem`, `terminal`, `browser`).
   - Expects `this.filesystemRuntime.execute(runtimePayload)` to return a standardized `executionOutput`.

5. **Existing Filesystem Test Suites**:
   - [`apps/desktop-agent/tests/filesystem-path-security.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/tests/filesystem-path-security.test.ts) (14 tests)
   - [`apps/desktop-agent/tests/filesystem-runtime.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/tests/filesystem-runtime.test.ts) (13 tests)
   - [`apps/desktop-agent/tests/local-filesystem-ipc.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/tests/local-filesystem-ipc.test.ts) (12 tests)
   - [`apps/desktop-agent/tests/local-filesystem-security-hardening.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/apps/desktop-agent/tests/local-filesystem-security-hardening.test.ts) (14 tests)

---

## 5. Dependencies on Tasks 040–049

Task 050 directly builds on the completed foundations of Tasks 040 through 049:

| Task         | Component Built                | Task 050 Dependency                                                                                                                                                                   |
| :----------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Task 040** | Process Supervisor & Lifecycle | `FilesystemRuntime` respects `AgentLifecycleState` (rejects execution if agent is stopping or unready).                                                                               |
| **Task 041** | Encrypted Vault                | Sandboxed file operations never access or leak encrypted vault directories (`.vault`).                                                                                                |
| **Task 044** | Redaction Filter & Logger      | All filesystem logs, error messages, and event payloads pass through `RedactionFilter`.                                                                                               |
| **Task 047** | Governed Vertical Slice        | Single-task lease validation, receipt generation, and HMAC-SHA256 signature verification.                                                                                             |
| **Task 048** | Sprint 0 DoD & Readiness       | Formal criteria verifying repository stability, resource baselines, and test repeatability.                                                                                           |
| **Task 049** | Multi-Step DAG Orchestration   | **Critical Prerequisite:** Allows workflow nodes (`fs.readFile`, `fs.writeFile`) to be declared in a DAG, leased by backend, and dispatched to Desktop Agent for sandboxed execution. |

---

## 6. Proposed Implementation Boundary

To satisfy all requirements without architectural deviation, the implementation will touch the following modules:

```
apps/desktop-agent/
  src/runtimes/filesystem/
    ├── workspace-jail.ts          [NEW]     Workspace directory jail manager & workspace authorization
    ├── path-security.ts           [MODIFY]  Add ADS checks, system path blacklist, reparse re-check
    ├── runtime.ts                 [MODIFY]  Add unified execute() dispatcher & mutation evidence chaining
    ├── types.ts                   [MODIFY]  Add FilesystemOperationRequest/Result schemas and JailConfig
    └── index.ts                   [MODIFY]  Export workspace jail components
  src/orchestrator/
    └── agent-orchestrator.ts      [MODIFY]  Cleanly invoke FilesystemRuntime.execute without type-casting hack
packages/contracts/
  src/
    ├── filesystem/                [NEW]     Canonical filesystem schemas & operation contracts
    └── index.ts                   [MODIFY]  Re-export filesystem contracts
tests/vertical-slice/
  ├── filesystem-sandbox-hardening.test.ts   [NEW] Governed workflow vertical slice with real filesystem nodes
  └── filesystem-security-invariants.test.ts [NEW] Dedicated 050-SEC-01 to 050-SEC-05 invariant test suite
```

---

## 7. Contracts / APIs / Protocols

### 7.1 Canonical Capability Identifiers & Scopes

All operations must support both colon-separated and dot-separated canonical identifiers:

| Operation          | Canonical Capability ID        | Lease Scope Required                           | Mutating |
| :----------------- | :----------------------------- | :--------------------------------------------- | :------- |
| **Read File**      | `fs.readFile` / `fs:read`      | `capability:fs:read`                           | No       |
| **Write File**     | `fs.writeFile` / `fs:write`    | `capability:fs:write`                          | **Yes**  |
| **List Directory** | `fs.listDirectory` / `fs:list` | `capability:fs:list` / `capability:fs:read`    | No       |
| **Stat File**      | `fs.statFile` / `fs:stat`      | `capability:fs:stat` / `capability:fs:read`    | No       |
| **Copy File**      | `fs.copyFile` / `fs:copy`      | `capability:fs:copy` / `capability:fs:write`   | **Yes**  |
| **Move File**      | `fs.moveFile` / `fs:move`      | `capability:fs:move` / `capability:fs:write`   | **Yes**  |
| **Delete File**    | `fs.deleteFile` / `fs:delete`  | `capability:fs:delete` / `capability:fs:write` | **Yes**  |

### 7.2 Unified `FilesystemOperationRequest` Schema (to be added in contracts)

```typescript
export interface FilesystemOperationRequest {
  operationName: FilesystemOperationName | string;
  workspaceId: string;
  path: string;
  destinationPath?: string;
  content?: string | Buffer;
  encoding?: 'utf-8' | 'base64' | 'binary';
  overwrite?: boolean;
  preconditions?: Preconditions;
  leaseHeader: ExecutionLeaseHeader;
}
```

### 7.3 Workspace Directory Jail Configuration

```typescript
export interface WorkspaceDirectoryJailConfig {
  workspaceId: string;
  tenantId: string;
  rootPath: string;
  isReadOnly?: boolean;
  maxStorageSizeBytes?: number;
}
```

---

## 8. Security Requirements (050-SEC-01 to 050-SEC-05)

The implementation must enforce 5 non-negotiable security invariants:

### 050-SEC-01: Strict OS Directory Jail Enforcement

- **Requirement:** Every filesystem operation must be strictly confined within the registered workspace root directory.
- **Fail-Closed Behavior:** Any operation attempting to escape via relative traversal (`../`, `..\`), absolute drive targeting (`C:\Windows\...`), or NT namespace devices (`\\.\`, `\\?\`, `//./`) must immediately fail with `PATH_OUTSIDE_SCOPE`.

### 050-SEC-02: Reparse Point & Junction Escape Prevention

- **Requirement:** Symlinks, hardlinks, and Windows NTFS directory junctions pointing outside the workspace jail must be rejected.
- **Fail-Closed Behavior:** Both pre-resolution and post-canonicalization (`fs.realpathSync`) paths are verified. If the resolved target falls outside the authorized jail root, access is denied with `SYMLINK_SCOPE_ESCAPE`.

### 050-SEC-03: Sensitive Host OS Path Blacklist & ADS Protection

- **Requirement:** The agent must unconditionally protect host operating system files, user credential stores, and hidden metadata streams.
- **Protected Paths:**
  - Windows directories: `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`
  - User secrets: `.ssh`, `.aws`, `.azure`, `.kube`, `.gnupg`, `.npmrc`, `.git-credentials`
  - Browser credential stores: Chrome/Edge `User Data\Default\Network\Cookies`, `Login Data`
  - NTFS Alternate Data Streams: Path strings containing `:` (except the Windows drive letter `C:`) such as `file.txt:stream` or `::$DATA` are strictly rejected with `ADS_PROHIBITED`.
- **Fail-Closed Behavior:** Denied immediately with `PROTECTED_PATH_DENIED`.

### 050-SEC-04: Explicit Per-Workspace Write Authorization

- **Requirement:** Modifying operations (`writeFile`, `copyFile`, `moveFile`, `deleteFile`) require both:
  1. A lease granting the appropriate write scope (`capability:fs:write`).
  2. The target workspace jail must NOT be configured as read-only.
- **Fail-Closed Behavior:** An agent possessing only read scopes attempting to write or delete files fails closed with `WRITE_NOT_AUTHORIZED`.

### 050-SEC-05: Cryptographic Mutation Evidence Chaining

- **Requirement:** Every file mutation (write, copy, move, delete) must capture:
  1. Pre-mutation snapshot ID (via `SnapshotManager`).
  2. Pre-mutation SHA-256 hash (or null if new file).
  3. Post-mutation SHA-256 hash (or null if deleted).
  4. Total bytes processed.
  5. Cryptographic evidence checksum linking `taskId`, `leaseId`, and file hashes into the audit event envelope.
- **Fail-Closed Behavior:** Failure to capture snapshot or hash halts the mutation and aborts the task.

---

## 9. Test & Validation Requirements

The task will introduce two new test suites and verify all existing suites:

1. **Unit & Component Suites**:

   - `packages/contracts/tests/filesystem-contracts.test.ts`: Verify schemas, operation enums, and jail configurations.
   - `apps/desktop-agent/tests/workspace-directory-jail.test.ts`: Verify workspace jail registration, path containment, and read-only enforcement.
   - Updated `apps/desktop-agent/tests/filesystem-path-security.test.ts`: Verify ADS blocking, sensitive path blacklist, and symlink escape checks.
   - Updated `apps/desktop-agent/tests/filesystem-runtime.test.ts`: Verify the new unified `execute()` dispatcher.

2. **Vertical Slice End-to-End Suite** ([`tests/vertical-slice/filesystem-sandbox-hardening.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/tests/vertical-slice/filesystem-sandbox-hardening.test.ts)):

   - Multi-step workflow: Node 1 writes project file into workspace jail -> Node 2 reads and transforms file -> Node 3 moves file to build output.
   - Proves complete vertical slice execution through HTTP intake -> composite lease -> ACP dispatch -> `WorkflowEngine` -> `AgentOrchestrator` -> `FilesystemRuntime.execute()`.

3. **Dedicated Security Invariants Suite** ([`tests/vertical-slice/filesystem-security-invariants.test.ts`](file:///c:/Users/priya/Desktop/Nexus%20AI/tests/vertical-slice/filesystem-security-invariants.test.ts)):

   - `050-SEC-01`: Relative traversal (`../../etc/passwd`, `..\..\Windows`) rejected.
   - `050-SEC-02`: External junction/symlink escape rejected.
   - `050-SEC-03`: Access to `.ssh` or `C:\Windows` rejected; NTFS ADS stream rejected.
   - `050-SEC-04`: Write attempt with read-only lease rejected fail-closed.
   - `050-SEC-05`: Evidence hash integrity and snapshot creation verified on file mutation.

4. **Quality Gates**:
   - `npm run typecheck` (0 errors)
   - `npm run lint` (0 errors)
   - `npm run format:check` (100% clean)
   - `npm test` (All 775+ existing tests + new tests PASS with 0 failures)
   - `npm run validate` (Repository boundary check PASS)
   - `npm run security` (0 secrets detected)
   - GitHub Actions CI workflow completion with SUCCESS.

---

## 10. In Scope

- Creation of `WorkspaceDirectoryJail` service managing workspace roots and jail boundaries.
- Hardening of `PathSecurityService` with NTFS Alternate Data Stream (ADS) filtering and sensitive OS path blacklisting.
- Implementation of the unified `FilesystemRuntime.execute(request)` method matching `AgentOrchestrator` requirements.
- Integration of `FilesystemRuntime` into `AgentOrchestrator` with typed parameter forwarding.
- Cryptographic mutation evidence chaining with pre/post SHA-256 hashes and snapshot references.
- Contract schemas in `@nexusos/contracts` for filesystem operations.
- E2E vertical slice and security invariant test suites.

---

## 11. Out of Scope

- Browser Runtime sandboxing (scheduled for subsequent Sprint 1 milestone).
- Terminal Runtime OS process jailing / Windows AppContainer sandboxing (separate Sprint 1 track).
- Cloud storage providers (AWS S3, Azure Blob, Google Cloud Storage adapters).
- Standalone Web Dashboard UI (`apps/web-dashboard`).
- Local AI model ONNX/Llama engine integration (Sprint 1 Week 2, Item 3).
- Modification of existing Sprint 0 runbooks or ADRs.

---

## 12. Risks / Ambiguities

| Risk / Ambiguity                          | Impact | Mitigation Strategy                                                                                                                                                                                                                            |
| :---------------------------------------- | :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows vs. POSIX Path Handling**       | High   | Standardize on normalized forward slashes internally for comparison, but preserve OS-specific drive letters (`C:`) and canonical `fs.realpathSync` casing.                                                                                     |
| **Non-Existent Destination Paths**        | Medium | When creating new files, the file does not exist yet for `fs.realpathSync`. Canonicalize the nearest existing ancestor directory, resolve the basename, and verify jail containment.                                                           |
| **Junction Points on Windows CI Runners** | Medium | GitHub Actions Windows runners may have symlink creation privileges restricted unless developer mode is enabled. Use mock directory trees and node `fs.symlinkSync(..., 'junction')` which works without elevated admin privileges on Windows. |
| **Performance Overhead of File Hashing**  | Low    | Restrict automatic pre/post content hashing to files $\le$ 50MB (governed by `DEFAULT_FILESYSTEM_RESOURCE_LIMITS.maxFileSizeByte`).                                                                                                            |

---

## 13. Recommended Implementation Sequence

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: CONTRACTS & VALIDATION LAYER (@nexusos/contracts)              │
│ - Define FilesystemOperationSchema, FilesystemCapabilityRequestSchema   │
│ - Define WorkspaceDirectoryJailConfigSchema                             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ PHASE 2: WORKSPACE DIRECTORY JAIL & PATH SECURITY HARDENING            │
│ - Create WorkspaceDirectoryJail service in apps/desktop-agent           │
│ - Add sensitive OS blacklist and NTFS Alternate Data Stream (ADS) checks│
│ - Add unit tests in apps/desktop-agent/tests/                           │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ PHASE 3: UNIFIED EXECUTE DISPATCHER & MUTATION EVIDENCE CHAINING        │
│ - Implement FilesystemRuntime.execute(request) with capability mapping  │
│ - Chain pre/post SHA-256 hashes and snapshot references in events       │
│ - Connect FilesystemRuntime cleanly into AgentOrchestrator              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ PHASE 4: E2E VERTICAL SLICE & SECURITY INVARIANTS TEST SUITES           │
│ - Author tests/vertical-slice/filesystem-sandbox-hardening.test.ts      │
│ - Author tests/vertical-slice/filesystem-security-invariants.test.ts    │
│ - Register new suites in root package.json                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│ PHASE 5: QUALITY GATES, CI AUDIT & COMPLETION REPORT                    │
│ - Run typecheck, lint, format, test, validate, security                 │
│ - Commit, push, and verify remote GitHub Actions CI run                 │
│ - Produce task_050_completion_report.md                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Baseline Verification & Discovery Confirmation

- **Baseline HEAD SHA:** `c8f6d5498bdc5a05473bf0acf548b6fd80a08639`
- **Discovery-Only Confirmation:** CONFIRMED. This activity was strictly investigative and analytical.
- **Exact Report Path:** `task_050_discovery_report.md`
- **Implementation Code State:** CONFIRMED. **Zero lines of implementation code were modified or deleted.**
- **Task 051+ Status:** CONFIRMED. Task 051+ has NOT been started.
