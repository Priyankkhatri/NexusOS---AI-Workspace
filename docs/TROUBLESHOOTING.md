# Troubleshooting & Diagnostic Guide — NexusOS

This guide provides operational triage steps and quick-resolution workflows for common developer and production issues.

---

## 1. Quick Diagnostic Triage Table

| Symptom                         | Probable Cause                           | Immediate Action                                | Primary Runbook                                       |
| :------------------------------ | :--------------------------------------- | :---------------------------------------------- | :---------------------------------------------------- |
| Port `3000` or `3001` in use    | Stale background process running         | Kill PID via `netstat -ano \| findstr :3000`    | [RB-001](runbooks/RB-001-service-startup-failure.md)  |
| Database locked or busy         | SQLite file lock held by another process | Check active connections; clear WAL lock        | [RB-002](runbooks/RB-002-database-failure.md)         |
| Event bus dropped messages      | IPC pipe broken or buffer overflow       | Inspect channel state; restart IPC host         | [RB-003](runbooks/RB-003-event-bus-failure.md)        |
| Desktop Agent missing in tray   | Process crash or supervisor exit         | Check agent logs in `apps/desktop-agent/logs`   | [RB-004](runbooks/RB-004-desktop-disconnect.md)       |
| AI model out of memory          | Context window or VRAM exceeded          | Prune context buffer; check memory limit        | [RB-005](runbooks/RB-005-ai-runtime-failure.md)       |
| External API 429 Rate Limit     | Provider quota exceeded                  | Activate fallback router; wait for reset        | [RB-006](runbooks/RB-006-provider-outage.md)          |
| Schema migration failed         | Constraint violation or bad SQL          | Halt restart loop; restore pre-migration backup | [RB-007](runbooks/RB-007-failed-migration.md)         |
| JWT validation error / 401      | Expired token or clock skew (>5s)        | Re-sync host clock (`w32tm /resync`)            | [RB-008](runbooks/RB-008-certificate-secret-issue.md) |
| Bad release crashing on boot    | Broken build deployed                    | Execute LKG rollback                            | [RB-009](runbooks/RB-009-deployment-rollback.md)      |
| Decryption error in agent state | Corrupted `state.enc` file               | Quarantine corrupted file; restore `.bak`       | [RB-010](runbooks/RB-010-corrupted-local-state.md)    |

---

## 2. Common Developer Diagnostic Commands

### 2.1 Check Workspace Build Health

```powershell
# Clean build all workspaces
npm run build

# Run typechecker across all packages and services
npm run typecheck
```

### 2.2 Verify Service Health Probes

```powershell
# Probe control-plane backend
Invoke-RestMethod -Uri "http://localhost:3000/health/liveness"
Invoke-RestMethod -Uri "http://localhost:3000/health/readiness"
```

### 2.3 Search Recent Structured Logs

```powershell
# Find all errors across backend logs
Select-String -Path "services/backend/logs/*.log" -Pattern "error|fatal"

# Find token or auth errors
Select-String -Path "services/identity/logs/*.log" -Pattern "JwtValidator|401"
```

---

## 3. Escalation Procedure

When an issue cannot be resolved using local diagnostic steps or runbooks:

1. Preserve un-redacted diagnostic logs in a secure quarantine area.
2. Note the exact Git commit SHA and environment topology.
3. Open an issue with the triage team following the incident reporting template in [RUNBOOKS.md](RUNBOOKS.md).
