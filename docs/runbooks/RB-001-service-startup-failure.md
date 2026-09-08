# RB-001: Operational Runbook — Service Startup Failure

**Failure Domain:** Control-Plane Backend & Desktop Agent Service Startup  
**Severity:** CRITICAL (P0/P1)  
**Owning Subsystem:** Control-Plane Backend (`services/backend`), Desktop Agent Host (`apps/desktop-agent`)  
**Target Process:** `BackendApp`, `DesktopAgent`

---

## 1. Symptoms & Impact

### Symptoms

- Backend HTTP process terminates immediately upon launch with non-zero exit code (e.g., `EADDRINUSE`, `ERR_SOCKET_BAD_PORT`).
- Health liveness check endpoint `GET /health/liveness` fails to respond or connection is refused (`ECONNREFUSED`).
- Desktop Agent fails to bind local IPC named pipe or Unix domain socket (`\\.\pipe\nexusos-desktop-ipc`).
- Process supervisor reports crash loop during startup sequence.

### Impact

- Tasks cannot be submitted via HTTP (`POST /v1/tasks`).
- Desktop Agent cannot receive task dispatch requests or communicate with the control plane.
- Local capabilities are unavailable to the user or caller.

---

## 2. Detection & Observability

- **HTTP Status:** Non-responsive or connection refused on configured port (default `PORT=3000`).
- **Log Events:**
  - `level: "fatal"` or `level: "error"` emitted by `LifecycleManager` or `Logger`.
  - Message: `Failed to start backend service` or `IPC server failed to listen`.
  - Code: `STARTUP_FAILED`, `EADDRINUSE`, `PORT_CONFLICT`.
- **Health Check Probes:**
  - `GET http://127.0.0.1:3000/health/liveness` returns connection refused or HTTP 503.
  - `GET http://127.0.0.1:3000/health/readiness` fails to return `status: "UP"`.

---

## 3. Immediate Containment

1. Prevent restart loops from exhausting system file descriptors or logging resources:
   - Temporarily pause automatic systemd / service supervisor respawn if crash count exceeds 5.
2. Isolate traffic:
   - Route ingress gateway traffic away from the failing backend instance to healthy replicas.
3. Check for zombie or stale process holding the bound socket or port:
   - On Windows: `netstat -ano | findstr :3000`
   - On Linux/macOS: `lsof -i :3000`

---

## 4. Diagnosis Procedures

1. **Verify Port Availability:**
   Check if another process is occupying the target port:
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
   ```
2. **Verify Configuration & Environment Variables:**
   Confirm required environment parameters are present and conform to `BackendConfigSchema`:
   - `PORT`: Integer between 1 and 65535.
   - `HOST`: Valid IPv4 or IPv6 address (default `0.0.0.0`).
   - `NODE_ENV`: Must be `development`, `test`, or `production`.
   - `LOG_LEVEL`: One of `debug`, `info`, `warn`, `error`, `fatal`.
3. **Inspect Startup Trace Logs:**
   Examine standard error output for uncaught exceptions or schema validation failures (`ZodError`).
4. **Verify Dependency Accessibility:**
   Ensure database directory or mock state path is writable and filesystem permissions are granted.

---

## 5. Safe Actions & Recovery

1. **Terminate Conflicting Process (if authorized):**
   If a stale instance of `BackendApp` or rogue process is occupying port 3000:
   ```powershell
   Stop-Process -Id <PID> -Force
   ```
2. **Override Port Configuration (if necessary):**
   If port 3000 is reserved by an essential system service, configure an alternate port:
   ```powershell
   $env:PORT = "3001"
   pnpm --filter @nexusos/backend start
   ```
3. **Clean Stale Named Pipe (Desktop Agent):**
   If the Desktop Agent IPC named pipe was left dangling after an improper shutdown:
   - Restart the Desktop Agent process; `IPCManager.start()` performs automatic socket cleanup if previous handle is stale.

---

## 6. Verification After Recovery

1. Query liveness endpoint:
   ```bash
   curl -i http://127.0.0.1:3000/health/liveness
   ```
   **Expected Response:** HTTP 200 OK with `{"status":"UP","version":"0.1.0"}`.
2. Query readiness endpoint:
   ```bash
   curl -i http://127.0.0.1:3000/health/readiness
   ```
   **Expected Response:** HTTP 200 OK with `{"status":"UP","database":"CONNECTED"}`.
3. Execute canonical sanity test:
   ```bash
   node --import tsx/esm --test services/backend/tests/server.test.ts
   ```

---

## 7. Escalation & Rollback

- If startup failure is caused by an incompatible code revision or breaking configuration schema:
  1. Roll back the deployment package to the last known good (LKG) commit SHA.
  2. Verify build integrity via `pnpm -r run build`.
  3. Re-run `npm run typecheck` to confirm build consistency.
- If unresolvable within 15 minutes:
  - Escalate to Backend Platform Engineering on-call.

---

## 8. Evidence Collection

- Capture process console standard error output: `stderr.log`.
- Record snapshot of environment variables (with secrets redacted).
- Capture port binding snapshot: `netstat -ano > port_bindings.txt`.
- Record correlation ID from failing startup lifecycle log.
