# Local Development Guide — NexusOS

This guide explains how to set up, build, test, and run the NexusOS development environment locally.

---

## 1. Prerequisites & Toolchain Verification

NexusOS enforces pinned toolchain versions for reproducible builds across all environments:

| Tool           | Required Version            | Verification Command | Notes                                         |
| :------------- | :-------------------------- | :------------------- | :-------------------------------------------- |
| **Node.js**    | `v24.14.1` (or >=20.19.0)   | `node --version`     | Defined in `.nvmrc`                           |
| **pnpm**       | `v11.21.0` (or `npm`)       | `pnpm --version`     | Pinned via `packageManager` in `package.json` |
| **TypeScript** | `v5.7.3`                    | `npx tsc --version`  | Exact dependency in devDependencies           |
| **Python**     | `3.12+`                     | `python --version`   | Defined in `.python-version`                  |
| **OS**         | Windows 10/11, macOS, Linux | System info          | Primary Desktop Agent target is Windows       |

---

## 2. Initial Setup

1. **Clone the Repository:**

   ```powershell
   git clone https://github.com/Priyankkhatri/NexusOS---AI-Workspace.git
   cd "Nexus AI"
   ```

2. **Install Dependencies (Frozen Lockfile):**

   ```powershell
   pnpm install --frozen-lockfile
   # Or using npm:
   npm install
   ```

   > [!NOTE]
   > Do not add or bump dependencies in `package.json` without an approved architecture review.

3. **Build All Workspaces:**
   ```powershell
   pnpm -r run build
   # Or using root script:
   npm run build
   ```

---

## 3. Running Services Locally

### 3.1 Control-Plane Backend (`services/backend`)

The backend provides the HTTP API gateway, health endpoints, and task orchestration interface:

```powershell
npm run start --workspace=services/backend
```

- **Port:** `3000` (configurable via `PORT` environment variable)
- **Liveness Probe:** `http://localhost:3000/health/liveness`
- **Readiness Probe:** `http://localhost:3000/health/readiness`
- **Task API:** `http://localhost:3000/v1/tasks`

### 3.2 Identity Service (`services/identity`)

Provides JWT token validation, OIDC compatibility, and cryptographic signing:

```powershell
npm run start --workspace=services/identity
```

- **Port:** `3001` (configurable via `IDENTITY_PORT`)
- **Default Issuer:** `https://auth.nexusos.internal`
- **Default Audience:** `nexusos-control-plane`

### 3.3 Desktop Agent (`apps/desktop-agent`)

The local agent host managing Windows IPC channels, system tray UI, and execution runtimes:

```powershell
npm run start --workspace=apps/desktop-agent
```

- **IPC Protocol:** Named Pipes / Local Unix Domain Sockets
- **UI:** System Tray Host (`apps/desktop-agent/src/ui/`)
- **Encrypted Store:** AES-256-GCM local encrypted state file

### 3.4 Local AI Runtime (`runtimes/local-ai`)

Executes local inference routing, prompt isolation, and model context management:

```powershell
npm run start --workspace=runtimes/local-ai
```

---

## 4. Canonical Quality Gates & Testing

Before committing changes, developers must run the canonical quality gate suite:

```powershell
# 1. Format check
npm run format:check

# 2. Linting
npm run lint

# 3. Typechecking
npm run typecheck

# 4. Full test suite (all unit, contract, and integration tests)
npm test

# 5. Composite repository validation (format, lint, typecheck, build)
npm run validate

# 6. Security scan (dependency audit and secret detection)
npm run security
```

---

## 5. Running the Governed Vertical Slice

To execute the Task 047 vertical slice test verifying control-plane authentication, policy evaluation, task execution, and observable event emission:

```powershell
# Run the control-plane vertical slice test suite
npx vitest run services/backend/tests/vertical-slice.test.ts
```

---

## 6. Common Local Troubleshooting

| Symptom                                           | Cause                                              | Resolution                                                      |
| :------------------------------------------------ | :------------------------------------------------- | :-------------------------------------------------------------- |
| `EADDRINUSE: port 3000 already in use`            | Another process is bound to port 3000              | Find and terminate the process: `netstat -ano \| findstr :3000` |
| `ERR_PNPM_OUTDATED_LOCKFILE`                      | Dependencies were modified without lockfile update | Run `pnpm install` or revert unintended `package.json` edits    |
| `TS2307: Cannot find module '@nexusos/contracts'` | Contracts package not built                        | Run `npm run build --workspace=packages/contracts`              |
| `StateManager: Authentication tag mismatch`       | Corrupted local state file                         | Refer to [RB-010](runbooks/RB-010-corrupted-local-state.md)     |
