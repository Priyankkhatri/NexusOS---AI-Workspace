# RB-002: Operational Runbook — Database Failure

**Failure Domain:** Control-Plane Persistence & Database Boundary  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Control-Plane Backend (`services/backend`)  
**Target Component:** `DatabaseBoundary` (`services/backend/src/database/boundary.ts`)

---

## 1. Symptoms & Impact

### Symptoms

- Health readiness probe `GET /health/readiness` fails with HTTP 503 Service Unavailable.
- Health payload reports: `{"status":"DEGRADED","database":"DISCONNECTED"}`.
- Storage operations fail with errors such as `STORAGE_DISCONNECTED`, `QUERY_FAILED`, or `CONNECTION_TIMEOUT`.
- Backend logs emit `level: "error"` indicating database boundary connectivity loss.

### Impact

- Tasks cannot be persisted or retrieved from persistent store.
- Task status updates cannot be saved across process restarts.
- System transitions to read-only or in-memory fallback mode (if configured).

---

## 2. Detection & Observability

- **HTTP Status:** HTTP 503 returned on readiness probe:
  ```bash
  curl -i http://127.0.0.1:3000/health/readiness
  ```
- **Log Events:**
  - Component: `DatabaseBoundary`
  - Message: `Database connection error` or `Health check query failed`.
  - Level: `error`
- **Error Codes:**
  - `STORAGE_DISCONNECTED`
  - `DATABASE_UNAVAILABLE`
  - `MIGRATION_ERROR`

---

## 3. Immediate Containment

1. Isolate the failing backend instance from load-balancer ingress:
   - Automated health checks will fail readiness (`/health/readiness`), taking the instance out of rotation.
2. Prevent state corruption:
   - Ensure the database connection pool does not execute partial or uncommitted writes.
3. In-memory tasks safeguard:
   - Active in-memory tasks held by `TaskController` remain isolated in process memory; do not terminate process forcefully without draining in-flight requests.

---

## 4. Diagnosis Procedures

1. **Verify Database Connection State:**
   Inspect current database connectivity status using the database boundary health check:
   - Confirm whether database initialization succeeded during `DatabaseBoundary.connect()`.
2. **Inspect Storage File / Connection String Permissions:**
   - In SQLite/local storage mode: verify that the database file path exists and has read/write permissions for the service user.
   - Verify filesystem is not out of inodes or disk space (`df -h` or `Get-PSDrive`).
3. **Review Migration Logs:**
   - Check if a recent migration attempt failed midway, leaving schema in locked state.
   - Verify `appliedMigrations` in the database boundary.

---

## 5. Safe Actions & Recovery

1. **Trigger Database Boundary Reconnect:**
   If using the programmatic boundary or restart cycle:
   ```powershell
   # Restart the backend service cleanly
   pnpm --filter @nexusos/backend restart
   ```
2. **Verify Database Directory Permissions:**
   Ensure the database storage path directory is writable:
   ```powershell
   Test-Path -Path ".nexusos-data" -PathType Container
   ```
3. **Execute Storage Boundary Tests:**
   Validate database boundary operation against the test suite:
   ```bash
   node --import tsx/esm --test services/backend/tests/server.test.ts
   ```

---

## 6. Verification After Recovery

1. Query readiness endpoint:
   ```bash
   curl -i http://127.0.0.1:3000/health/readiness
   ```
   **Expected Response:** HTTP 200 OK with `{"status":"UP","database":"CONNECTED"}`.
2. Verify task intake and persistence:
   ```bash
   curl -X POST http://127.0.0.1:3000/v1/tasks \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <valid_token>" \
     -d '{"title":"Health Check Task","targetAgentId":"...","capabilityId":"device.queryInfo","runtimeCategory":"DEVICE","requestedScope":"device:read"}'
   ```

---

## 7. Escalation & Rollback

- If disk corruption is detected:
  1. Halt backend process.
  2. Restore database file from the latest validated backup snapshot.
  3. Re-run schema migration validation.
- If unresolvable within 20 minutes:
  - Escalate to Data / Backend Infrastructure Lead.

---

## 8. Evidence Collection

- Capture database error logs from `services/backend`.
- Record snapshot of database file metadata (size, permissions, timestamps).
- Archive `GET /health/readiness` payload responses.
