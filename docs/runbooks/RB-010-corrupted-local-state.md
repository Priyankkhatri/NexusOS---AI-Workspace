# RB-010: Operational Runbook — Corrupted Local State

**Failure Domain:** Encrypted Local State, SQLite Persistence & Client Cache  
**Severity:** MEDIUM (P2) / HIGH (P1)  
**Owning Subsystem:** Desktop Agent State Management (`apps/desktop-agent`)  
**Target Component:** `StateManager`, `EncryptedStore`, `LocalCache`, `AtomicFileWriter`

---

## 1. Symptoms & Impact

### Symptoms

- Desktop Agent fails to boot with error: `StateCorruptedError: Authentication tag mismatch` or `Failed to decrypt local state`.
- SQLite local cache reports `SQLITE_CORRUPT: database disk image is malformed`.
- Temporary state files (`*.tmp`) remain orphaned in the data directory following an abrupt system shutdown or crash.
- Agent enters safe recovery mode and requests re-initialization.

### Impact

- Local preferences, cached credentials, and offline queue cannot be loaded.
- Desktop Agent cannot resume in-flight offline tasks.
- If uncontained, agent may repeatedly fail startup or crash loop.

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `StateManager` (`apps/desktop-agent/src/state/`)
  - Level: `error`
  - Message: `[StateManager] Decryption integrity check failed (AES-256-GCM tag verification failure)` or `[LocalStore] Database file header invalid`.
- **Exit Codes:**
  - Agent process exits with code `STATE_CORRUPTION_DETECTED` (exit code `12`).
- **Telemetry Indicators:**
  - Crash reporter logs event `state_integrity_failure` with error code `ERR_CRYPTO_INTEGRITY`.

---

## 3. Immediate Containment

1. **Quarantine Corrupted State File:**
   - Do NOT overwrite or immediately delete the corrupted state file. It is required for forensic analysis and potential recovery.
   - Rename `state.enc` to `state.enc.corrupt.<timestamp>`.
2. **Prevent Repeated Decryption Attempts:**
   - Terminate hanging Desktop Agent worker processes to release file locks.

---

## 4. Diagnosis Procedures

1. **Verify State File Existence and Size:**
   Check the data directory for zero-byte or partially written state files:
   ```powershell
   Get-ChildItem -Path "$env:LOCALAPPDATA/NexusAI/data" -Recurse
   ```
2. **Check for Orphaned Atomic Temporary Files:**
   Search for leftover atomic staging files:
   ```powershell
   Get-ChildItem -Path "$env:LOCALAPPDATA/NexusAI/data/*.tmp"
   ```
3. **Inspect Integrity Error in Structured Logs:**
   ```powershell
   Select-String -Path "apps/desktop-agent/logs/*.log" -Pattern "StateManager|integrity"
   ```
4. **Test SQLite Integrity (if SQLite store is in use):**
   ```powershell
   # If sqlite3 is installed:
   sqlite3 "$env:LOCALAPPDATA/NexusAI/data/cache.db" "PRAGMA integrity_check;"
   ```

---

## 5. Safe Actions, Recovery & Remediation

1. **Automatic Journal / Snapshot Recovery:**
   The `StateManager` creates periodic snapshots (`state.bak`). To restore from backup:

   ```powershell
   $dataDir = "$env:LOCALAPPDATA/NexusAI/data"
   if (Test-Path "$dataDir/state.bak") {
       Copy-Item "$dataDir/state.bak" "$dataDir/state.enc" -Force
       Write-Output "Restored state from backup snapshot."
   }
   ```

2. **Clean State Re-initialization (Fallback):**
   If no valid backup exists, reset to factory baseline and re-sync from control plane:

   ```powershell
   $dataDir = "$env:LOCALAPPDATA/NexusAI/data"
   # Quarantine corrupted files
   Move-Item "$dataDir/state.enc" "$dataDir/state.enc.corrupted_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
   # Re-initialize clean state
   npm run clean:state --workspace=apps/desktop-agent
   ```

3. **Re-hydrate State from Control-Plane:**
   Start the Desktop Agent:
   ```powershell
   npm run start --workspace=apps/desktop-agent
   ```
   The agent will authenticate with `services/identity`, re-fetch workspace metadata and remote task history, and establish a fresh encrypted `state.enc`.

---

## 6. Verification After Recovery

1. **Verify State Manager Tests:**
   Run the state security hardening test suite:
   ```powershell
   npx vitest run apps/desktop-agent/tests/state-security-hardening.test.ts
   ```
2. **Verify Desktop Agent Boot:**
   Start the agent and verify the tray icon initializes without state errors.
3. **Verify Read/Write Cycle:**
   Confirm settings modifications are persisted atomically without error.

---

## 7. Escalation & Rollback

- If state corruption occurs repeatedly across multiple desktop agent installations, escalate to Desktop Agent Core team to inspect atomic file write semantics, disk write caching flags, or encryption key derivation changes.

---

## 8. Evidence Collection

Collect the following artifacts:

- Quarantined `state.enc.corrupt.*` file (for offline cryptanalysis).
- Hex dump of the first 128 bytes of the corrupted file (verifies header / IV integrity without exposing user payload).
- OS disk event logs around the timestamp of corruption (detects power failure or bad disk sectors).
