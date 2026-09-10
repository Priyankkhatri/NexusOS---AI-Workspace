# RB-023: SQLite Memory Store ACID Failure & Vector Index Corruption

**Runbook ID**: RB-023  
**Sprint**: Sprint 2 — Task 062 (Persistent SQLite Store, Vector Search & Knowledge Graph)  
**Severity**: CRITICAL  
**Owner**: Platform Operations / NexusOS Backend Engineering  
**Version**: 1.0.0 | 2026-09-10

---

## 1. Purpose / Scope

This runbook covers operational failures in the NexusOS persistent disk-backed memory store
(`SqliteMemoryStore`, `VectorIndex`). It applies when:

- SQLite `CREATE` or `UPDATE` operations fail mid-transaction
- The WAL (Write-Ahead Log) cannot be flushed or checkpointed
- SQLite integrity check fails at startup (`PRAGMA integrity_check`)
- The in-process `VectorIndex` diverges from the SQLite `memory_vectors` table
- A cascade tombstone operation fails part-way through, leaving orphaned records
- `simulateFailure` is inadvertently set in production configuration

**Subsystem Authority**: `services/backend/src/memory/sqlite-memory-store.ts`, `vector-index.ts`  
**Persistence Mode**: `node:sqlite` (`DatabaseSync`) — synchronous, single-process, in-process  
**Supported Isolation**: Multi-tenant via `(tenant_id, workspace_id)` primary key prefix on all tables

> **Architecture Note**: The NexusOS `SqliteMemoryStore` is a **single-process, synchronous**
> SQLite implementation using Node.js 24 `node:sqlite` (`DatabaseSync`). It is NOT a distributed
> database. Recovery procedures assume a single Node.js backend process with exclusive file access.
> Multi-writer distributed scenarios are out of scope for Sprint 2.

---

## 2. Detection / Symptoms

| Signal | Where to Look |
|:---|:---|
| `062-SEC-01: SQLite integrity check failed` at backend startup | Backend boot logs |
| `UNIQUE constraint failed` or `FOREIGN KEY constraint failed` | SQLite error in memory operation logs |
| `SqliteMemoryStoreSimulatedFailureError` in production logs | `simulateFailure` flag accidentally set |
| `VectorDimensionMismatchError` on vector upsert | Vector index receiving mismatched embedding |
| `MemoryVersionConflictError` on update | Optimistic concurrency conflict; stale version |
| `MemoryNotFoundError` on getById of a valid record | Tombstone applied erroneously or wrong tenant context |
| Memory records present in SQLite but absent from VectorIndex | VectorIndex not hydrated on startup |
| Unexplained `null` returns for known record IDs | Cross-tenant query or tombstone misidentified as active |

---

## 3. Immediate Containment

1. **Identify whether the failure is transaction or integrity**:
   - Transaction failure: the operation rolled back atomically — data is consistent, the caller
     received an error. Retry is safe.
   - Integrity failure: detected at startup via `PRAGMA integrity_check` — the database file
     may have been corrupted (e.g., process crash without WAL flush).

2. **Stop accepting new write operations** to the affected workspace:
   - Use the `simulateFailure` flag (TEST ONLY — never set in production) or implement a
     write-pause at the HTTP router layer while recovery runs.

3. **Preserve the database file**: Before any recovery action, copy the `.sqlite` database file
   and its `-wal` and `-shm` companion files to a safe location.

4. **Check for orphaned WAL**: If the backend crashed mid-WAL checkpoint, the WAL file
   (`.sqlite-wal`) may be larger than expected. SQLite will automatically recover the WAL on
   next open — allow this to complete before assuming corruption.

---

## 4. Diagnosis

### 4.1 Integrity Check

On next backend startup, `SqliteMemoryStore` runs:

```sql
PRAGMA integrity_check;
```

Expected result: `ok`. Any other result indicates page-level corruption.

To run manually:
```bash
# On the machine hosting the backend process
node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/path/to/nexusos.sqlite');
  const result = db.prepare('PRAGMA integrity_check;').all();
  console.log(result);
  db.close();
"
```

### 4.2 WAL Recovery Check

WAL mode is enabled for all non-`:memory:` databases (`PRAGMA journal_mode = WAL`). After a crash:

1. Open the database — SQLite automatically replays the WAL.
2. Run integrity check after WAL replay.
3. If integrity check passes, no further action required.

### 4.3 VectorIndex Hydration Divergence

`SqliteMemoryStore` hydrates the in-process `VectorIndex` on construction:

```
constructor → hydrateVectorIndex() → loads all active memory_vectors rows into VectorIndex
```

If the backend was started with an incomplete database or an exception during hydration,
the `VectorIndex` may not reflect the persisted state.

**Diagnosis**: Compare `idx.size(tenantId, workspaceId)` against the count from:

```sql
SELECT COUNT(*) FROM memory_vectors WHERE tenant_id = ? AND workspace_id = ?;
```

Discrepancy indicates a hydration failure.

### 4.4 Cascade Tombstone Failure

The `tombstone()` method operates atomically. If it failed mid-cascade:

1. Check `memory_records` for records with `status = 'TOMBSTONED'` and `tombstoned_at IS NULL`.
2. Check `memory_vectors` for vector entries referencing tombstoned record IDs.
3. Check `graph_nodes` / `graph_edges` for nodes referencing tombstoned records.

Orphaned entries in vectors or graph tables without tombstoned backing records indicate a partial cascade.

### 4.5 Optimistic Concurrency Conflicts

`MemoryVersionConflictError` indicates the `expectedVersion` passed to `update()` does not match
the current record version. This is expected under concurrent write scenarios. Resolve by:

1. Re-reading the current record to get the latest version.
2. Applying the update with the correct `expectedVersion`.

---

## 5. Recovery

### 5.1 WAL Auto-Recovery (Standard Crash Recovery)

SQLite handles WAL recovery automatically. On next backend start:

1. `DatabaseSync(dbPath)` opens the database.
2. SQLite replays the WAL file, recovering committed transactions.
3. `PRAGMA integrity_check` is run by `SqliteMemoryStore.configurePragmas()`.
4. If `ok`, normal startup continues.

No operator action required for WAL recovery — allow the backend to restart.

### 5.2 VectorIndex Rehydration

If VectorIndex diverges from SQLite:

1. Stop the backend.
2. Restart — `hydrateVectorIndex()` runs fresh on construction, reloading all active vectors.
3. Verify `idx.size()` matches the SQLite count.

### 5.3 Repair Orphaned Vector Entries

If `memory_vectors` contains entries for tombstoned records:

```sql
-- Identify orphaned vectors
SELECT mv.id FROM memory_vectors mv
LEFT JOIN memory_records mr ON mr.id = mv.memory_record_id
  AND mr.tenant_id = mv.tenant_id AND mr.workspace_id = mv.workspace_id
WHERE mr.id IS NULL OR mr.status = 'TOMBSTONED';
```

Delete orphaned vector rows manually (requires direct SQLite access with a backup taken first).

### 5.4 Database File Corruption (Integrity Check Failure)

If `PRAGMA integrity_check` returns anything other than `ok`:

1. **Restore from backup** — this is the safest path. NexusOS does not include a built-in
   repair tool for page-level corruption. Restore the last known-good `.sqlite` file.
2. If no backup is available, SQLite's `PRAGMA wal_checkpoint(RESTART)` followed by
   a `.dump` and re-import may recover partial data, but this is a best-effort procedure.

### 5.5 Unblock Optimistic Concurrency

No special recovery needed — `MemoryVersionConflictError` is a safe read-retry signal.
Retry the write operation after re-reading the current record version.

---

## 6. Verification

1. Confirm backend starts successfully with `integrity_check = ok` in boot logs.
2. Confirm `VectorIndex.size(tenantId, workspaceId)` matches SQLite vector count.
3. Execute a write-read cycle via the backend memory API and verify round-trip consistency.
4. Run the full memory persistence test suite:
   ```
   node --import tsx/esm --test tests/hardening/memory-persistence-security.test.ts
   ```
5. Verify cross-tenant isolation: a `getById` with a different `tenantId` returns `null`.

---

## 7. Escalation

| Trigger | Action |
|:---|:---|
| Integrity check fails after WAL recovery | Escalate to data engineering — potential filesystem-level corruption |
| Repeated WAL checkpoint failures | OS-level filesystem investigation; disk health check |
| `simulateFailure = true` found in production config | Immediate incident — code review and configuration audit |
| Cascade tombstone failures producing inconsistent graph state | Backend engineering escalation — transaction rollback path investigation |
| Persistent `MemoryVersionConflictError` under single-writer load | Backend concurrency bug — not expected without concurrent writes |

---

## 8. Prevention / Lessons Learned

- **Enable WAL mode** (already the default for non-`:memory:` paths) — WAL provides significantly
  better crash recovery than DELETE journal mode.
- **Take regular backups**: SQLite is file-based; a scheduled copy of the `.sqlite` file provides
  point-in-time recovery.
- **Never set `simulateFailure = true` in production config** — this is a test-only escape hatch.
- **Use optimistic concurrency (`expectedVersion`)** consistently on all update operations to
  prevent silent overwrites.
- **Verify vector hydration after restart** — check `VectorIndex.size()` matches the database count
  before serving requests after a crash recovery.
- **Enforce tenant/workspace prefixes on all queries** — `(tenant_id, workspace_id, id)` is the
  composite primary key; always include all three in point lookups.
