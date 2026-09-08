# RB-007: Operational Runbook — Failed Migration

**Failure Domain:** Schema Migrations & Persistent State Version Transitions  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Control-Plane Persistence (`services/backend`), Desktop State Manager (`apps/desktop-agent`)  
**Target Component:** `DatabaseBoundary`, `StateManager`

---

## 1. Symptoms & Impact

### Symptoms

- Database initialization or agent startup fails during schema migration step.
- Backend readiness probe fails with `MIGRATION_ERROR` or `SCHEMA_VERSION_MISMATCH`.
- Desktop Agent logs report: `StateManager: Migration failed from version <V_old> to <V_new>`.
- Service process exits to prevent running on an inconsistent or partially migrated schema.

### Impact

- Service cannot boot or accept traffic.
- Existing persisted records may be unreadable if migration was partially applied.
- Risk of data loss if rollback procedure is not executed according to the Migration Safety Gate (Blueprint Section 90).

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `DatabaseBoundary` or `StateManager`
  - Level: `error` or `fatal`
  - Message: `Failed to apply migration: <migrationId>` or `Schema version incompatibility detected`.
- **Exit Codes:**
  - Process exits with code `1` or `MIGRATION_FAILED`.
- **Readiness Status:**
  - `GET /health/readiness` returns HTTP 503 with `status: "DEGRADED"` and migration failure details.

---

## 3. Immediate Containment

1. Halt automated restarts immediately:
   - Prevent repetitive failed migration execution that could compound state damage.
2. Freeze database writes:
   - Ensure no background thread or external process attempts to modify tables in mid-migration state.
3. Protect state backup snapshots:
   - Verify that the pre-migration snapshot created prior to migration execution is intact.

---

## 4. Diagnosis Procedures

1. **Identify Failing Migration ID:**
   Check the migration runner output to determine the exact migration step that failed:
   ```powershell
   # Search logs for migration ID
   Select-String -Path "services/backend/logs/*.log" -Pattern "migration"
   ```
2. **Inspect Migration Failure Reason:**
   - Syntax error in SQL migration script.
   - Constraint violation (e.g. duplicate key on unique index addition).
   - Incompatible type coercion on existing data rows.
   - Filesystem write permission or lock timeout.
3. **Verify Current vs Expected Schema Version:**
   Check the version marker in the database or state metadata file.

---

## 5. Safe Actions & Rollback (Blueprint Section 90)

Per Blueprint Section 90, every migration must declare forward and rollback paths:

1. **Execute Migration Rollback Script:**
   - If migration supports automatic rollback:
     ```powershell
     pnpm --filter @nexusos/backend run migrate:rollback
     ```
   - If manual state rollback is required (Desktop State Manager):
     The `StateManager` creates an atomic journal and backup copy before migration:
     - Check for backup file: `.nexusos-state/<store>.json.backup`
     - Restore backup:
       ```powershell
       Copy-Item ".nexusos-state/state.json.backup" ".nexusos-state/state.json" -Force
       ```
2. **Re-run Schema Verification:**
   Verify that database schema matches the previous known good version.
3. **Validate with Test Suite:**
   ```bash
   node --import tsx/esm --test services/backend/tests/server.test.ts apps/desktop-agent/tests/state-manager.test.ts
   ```

---

## 6. Verification After Recovery

1. Start backend process in test mode:
   - Confirm clean startup without migration errors.
2. Query health readiness:
   ```bash
   curl -i http://127.0.0.1:3000/health/readiness
   ```
   **Expected Response:** HTTP 200 OK with `{"status":"UP","database":"CONNECTED"}`.
3. Verify existing record reads:
   - Confirm that pre-existing tasks and state records can be retrieved successfully.

---

## 7. Escalation & Irreversible Migrations

- If the migration is classified as **Irreversible** per Blueprint Section 90:
  1. DO NOT execute ad-hoc SQL or state surgery without approval.
  2. Restore database from the pre-migration cold backup snapshot.
  3. Escalate immediately to Database Administrator and Platform Architecture Lead.

---

## 8. Evidence Collection

- Save migration execution log and exact error message.
- Capture schema diff between target and current database state.
- Archive the pre-migration database snapshot for post-incident root cause analysis.
