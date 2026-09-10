# RB-020: Operational Runbook — Memory Graph Explosion & Forgetting Failure

**Failure Domain:** Episodic Memory Knowledge Graph, Memory Compression & Atomic Forgetting  
**Severity:** HIGH (P1) / MEDIUM (P2)  
**Owning Subsystem:** Memory Subsystem (`services/backend/src/memory`), Memory Contracts (`packages/contracts/src/memory`)  
**Target Process:** `GraphProjectionEngine`, `MemoryCompressor`, `MemoryService`

---

## 1. Symptoms & Impact

### Symptoms

- Graph query request `POST /v1/memory/graph/query` fails with HTTP 400 and error `TRAVERSAL_DEPTH_EXCEEDED` (requested `maxDepth > 4`).
- Graph retrieval encounters cyclic references, leading to query timeouts or duplicate edge accumulation.
- Tombstoning a primary memory atom fails to delete associated graph nodes/edges or leaves orphaned compressions active (`CASCADE_TOMBSTONE_FAILED`).
- Memory compression request fails with error `UNCITED_COMPRESSION_REJECTED` or lossiness classification missing.

### Impact

- Graph retrieval queries stall or consume excessive CPU/memory if cyclic traversals are not bounded.
- Stale, deleted, or privacy-forgotten data might linger in graph projections if atomic cascade revocation fails.
- Lossiness and provenance tracking is compromised if un-cited compression summaries are stored.

---

## 2. Detection & Observability

- **API Errors:**
  - HTTP 400 Bad Request with error `maxDepth cannot exceed 4` from `MemoryGraphQueryRequestSchema`.
  - HTTP 500 Internal Server Error on database transaction rollback during cascade tombstoning.
- **Log Events:**
  - `level: "error"` emitted by `GraphProjectionEngine`: `Graph traversal depth exceeded maximum limit of 4`.
  - `level: "error"` emitted by `MemoryService`: `Failed to revoke graph projections for tombstoned memory: atom rollback triggered`.
  - Correlation fields: `tenantId`, `workspaceId`, `rootNodeId`, `memoryId`.

---

## 3. Immediate Containment

1. **Verify Depth Clamping:**
   Confirm the graph engine strictly clamps or rejects queries exceeding `maxDepth = 4` (058-SEC-03).
2. **Halt Heavy Graph Queries:**
   If a client submits repeated multi-hop graph queries causing high latency, throttle the client's rate limit.
3. **Verify Atomic Tombstone State:**
   Check whether the tombstoned memory atom is returned by `getMemory` or `searchMemory`:
   - It MUST return null / empty list.

---

## 4. Diagnosis Procedures

1. **Inspect Graph Traversal Visited Sets:**
   Verify whether the BFS query engine correctly tracks `visitedNodeIds` and `visitedEdgeIds`:
   - Duplicate edges must be deduplicated when traversing bidirectional semantic relationships.
2. **Inspect Cascade Revocation Transactions:**
   Check whether `revokeGraphForMemory(memoryId)` and `markDerivedCompressionsTombstoned(memoryId)` executed in the same atomic unit of work.
3. **Verify Compression Citations:**
   Confirm that all compressed records contain valid `citations` with non-empty `sourceMemoryId`, `snippet`, and `contentHash` (SHA-256).

---

## 5. Safe Actions & Recovery

1. **Re-execute Cascade Forgetting Manually:**
   If an atom was tombstoned but graph nodes were orphaned due to a crash during commit:
   - Call the cleanup utility:
     ```bash
     curl -X POST http://127.0.0.1:3000/v1/memory/graph/purge-orphans \
       -H "Authorization: Bearer <ADMIN_TOKEN>"
     ```
2. **Prune Graph Edges:**
   Delete disconnected or stale edges referencing nonexistent node IDs.
3. **Clamp Query Depth in Client SDK:**
   Ensure client queries set `maxDepth` between 1 and 3 for standard contextual lookups.

---

## 6. Verification After Recovery

1. Run episodic memory and graph projection tests:
   ```bash
   pnpm --filter @nexusos/backend test services/backend/tests/memory/graph-projection.test.ts
   pnpm --filter @nexusos/backend test tests/vertical-slice/episodic-memory-vertical-slice.test.ts
   ```
   **Expected Response:** All BFS bounding, cycle safety, and atomic cascade revocation tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Data Engineering / Memory Intelligence Lead.
- **Prevention:** Always enforce cycle detection using visited sets in all graph traversal algorithms, and wrap memory tombstoning and graph revocation in a single transactional boundary.
