# Deployment & Release Guide — NexusOS

This document defines the deployment topologies, packaging processes, and release safety procedures for NexusOS.

---

## 1. Deployment Topology & Environments

NexusOS supports tiered deployment environments per Blueprint Section 84:

| Environment          | Purpose                   | Datastore & Services                         | Credentials                                        |
| :------------------- | :------------------------ | :------------------------------------------- | :------------------------------------------------- |
| **Local**            | Developer workstation     | In-memory / SQLite, local mock servers       | Dev secrets only (`IdentityConfigSchema` defaults) |
| **CI / Integration** | Automated PR gates        | GitHub Actions runners, ephemeral containers | Synthetic secrets injected via GitHub Secrets      |
| **Staging**          | Pre-production validation | Clustered backend services, test database    | Dedicated non-production keys                      |
| **Production**       | Live end-user system      | Clustered microservices, HA persistence      | HashiCorp Vault / Cloud KMS secrets                |

---

## 2. Service Build & Packaging

Build all workspace artifacts using the canonical build command:

```powershell
npm run build
```

This compiles TypeScript source into production-ready JavaScript bundles:

- `packages/contracts/dist/`
- `services/backend/dist/`
- `services/identity/dist/`
- `services/orchestrator/dist/`
- `apps/desktop-agent/dist/`
- `runtimes/local-ai/dist/`

---

## 3. Database Migration Deployment Safety Gate

Per Blueprint Section 90, database schema migrations must adhere to strict safety gates:

1. **Pre-Deployment Backup:** A full database snapshot must be completed before applying migrations.
2. **Backward Compatibility:** All migrations must support N-1 running application code during rolling deployments.
3. **Execution Command:**
   ```powershell
   npm run migrate --workspace=services/backend
   ```
4. **Failure Recovery:** If a migration fails during deployment, follow [RB-007: Failed Migration](runbooks/RB-007-failed-migration.md).

---

## 4. Desktop Agent Update Distribution

- **Staged Rollout:** Desktop Agent updates are distributed in waves (1% ➔ 10% ➔ 50% ➔ 100%).
- **Cryptographic Verification:** Downloaded binaries are verified for SHA-256 integrity and code-signing before invocation.
- **Dual Partition / Staging Fallback:** The agent maintains the Last Known Good (LKG) version. If the new binary fails startup health checks, the supervisor automatically rolls back.
- **Rollback Runbook:** See [RB-009: Deployment Rollback](runbooks/RB-009-deployment-rollback.md).
