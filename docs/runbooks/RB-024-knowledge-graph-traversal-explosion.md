# RB-024: Knowledge Graph Traversal Explosion & Dashboard Feed Disruption

**Runbook ID**: RB-024  
**Sprint**: Sprint 2 — Task 062/063 (Graph Projection Engine & Dashboard)  
**Severity**: HIGH  
**Owner**: Platform Operations / NexusOS Backend Engineering  
**Version**: 1.0.0 | 2026-09-10

---

## 1. Purpose / Scope

This runbook covers operational failures in the NexusOS knowledge graph projection subsystem
(`GraphProjectionEngine`, `SqliteMemoryStore.queryGraph()`) and the Web Dashboard graph feed
(`DashboardAPIClient.queryGraph()`). It applies when:

- A graph traversal query exceeds bounds and consumes excessive memory or CPU
- A cycle in the graph causes traversal to loop non-terminatingly
- The bounded traversal limits (`maxDepth ≤ 4`, `limit ≤ 100`) are violated or insufficient
- The dashboard graph view (`#view-graph`) stops loading or displays stale/no data
- A `DashboardAPIError` on the `POST /v1/memory/graph/query` endpoint disrupts the UI feed

**Subsystem Authority**:

- Backend: `services/backend/src/memory/graph-projection-engine.ts`, `sqlite-memory-store.ts`
- Dashboard: `apps/web-dashboard/src/api/client.ts` (`queryGraph` method)

**Traversal Safety Invariants** (062-SEC-05):

- `maxDepth ≤ 4` (enforced in `DashboardAPIClient.queryGraph` and backend handler)
- `limit ≤ 100` nodes per query result
- Cycles must be detected and skipped by the traversal algorithm

---

## 2. Detection / Symptoms

| Signal                                                       | Where to Look                                                     |
| :----------------------------------------------------------- | :---------------------------------------------------------------- |
| Backend response time > 5s for `POST /v1/memory/graph/query` | Backend observability logs / dashboard network tab                |
| Dashboard `#view-graph` spinner never resolves               | Browser console `DashboardAPIError` for graph endpoint            |
| Node count in query response approaching 100 every query     | Indicates nearly-full result sets; depth/breadth explosion        |
| Backend memory (RSS) spiking during graph traversal          | Process memory monitor                                            |
| `058-SEC-03` security violation in graph engine logs         | Cross-tenant graph access attempt detected                        |
| Graph shows cycles — same nodes appearing multiple times     | Cycle detection not engaged (should be impossible; indicates bug) |
| `GET /v1/memory/graph/query` returning 500                   | Unhandled error in graph traversal — inspect backend logs         |

---

## 3. Immediate Containment

1. **Reduce query bounds at the client**:

   - `DashboardAPIClient.queryGraph` enforces `maxDepth = Math.min(maxDepth, 4)` and
     `limit = Math.min(limit, 100)`. These cannot be overridden by the caller.
   - If dashboard UI allows user input for depth/limit, temporarily disable those controls.

2. **Kill the stuck backend request** (if identifiable):

   - Backend queries run synchronously on the SQLite connection. A stuck traversal will block
     the Node.js event loop.
   - Restart the backend service if the event loop is blocked and the process is unresponsive.

3. **Isolate the offending graph query**:
   - Identify the `startNodeId`, `nodeTypes`, and `edgeTypes` parameters from backend logs
     for the last query that triggered the explosion.
   - Block or rate-limit further queries using those parameters at the HTTP router level.

---

## 4. Diagnosis

### 4.1 Traversal Bounds Audit

The backend `SqliteMemoryStore.queryGraph()` enforces bounds before executing traversal:

```
maxDepth: clamped to min(requested, 4)
limit:    clamped to min(requested, 100)
```

**Check**: What depth and limit were actually applied? Inspect the backend request handler logs.
If a very dense sub-graph (many edges per node) is being traversed at depth 4, even 100 nodes
may generate significant work.

### 4.2 Cycle Detection Verification

The graph traversal algorithm uses a `visited` set to skip already-encountered node IDs.
Cycles should be benign. Verify cycle detection is active:

1. Check if the same `nodeId` appears multiple times in the result `nodes` array.
2. If so, this indicates a cycle detection regression — escalate immediately.

### 4.3 Dashboard Feed Disruption

If the graph view (`#view-graph`) is broken in the dashboard:

1. Open browser DevTools → Network → filter `graph/query`.
2. Check the response status and body:
   - `200` with empty `nodes: []` — no data matches the query (normal for empty workspace).
   - `400` — client sent invalid parameters (check `DashboardAPIClient` enforcement).
   - `500` — backend graph traversal error (check backend logs).
   - `401/403` — authentication or policy failure (check JWT token validity).

### 4.4 Cross-Tenant Graph Access (Security Event)

`GraphProjectionEngine.upsertNode()` and `queryGraph()` enforce:

```
ctx.tenantId === node.tenantId && ctx.workspaceId === node.workspaceId
```

Any `MemorySecurityViolationError` with `058-SEC-03` in the message is a **security event**,
not a routine operational failure. See escalation section.

### 4.5 Dashboard Client Bound Enforcement

Verify `DashboardAPIClient.queryGraph` enforces bounds. From `client.ts`:

```typescript
maxDepth: options.maxDepth !== undefined ? Math.min(Math.max(1, options.maxDepth), 4) : undefined,
limit: options.limit !== undefined ? Math.min(Math.max(1, options.limit), 100) : undefined,
```

If a client is calling the backend API directly (bypassing the `DashboardAPIClient`), bounds
may not be enforced at the client layer. Backend enforcement is the authoritative limit.

---

## 5. Recovery

### 5.1 Reduce Query Scope

For an overly broad query:

1. Add `nodeTypes` filter to restrict traversal to specific node types (e.g., `'ENTITY'` only).
2. Reduce `maxDepth` to 1 or 2 for exploratory queries.
3. Start with a specific `startNodeId` rather than open-ended traversal.

### 5.2 Backend Restart After Event Loop Block

If the Node.js backend process is blocked by a synchronous SQLite traversal:

1. Kill the backend process: `taskkill /F /PID <pid>` (Windows) or `kill -9 <pid>` (Linux).
2. Restart the backend service.
3. The `SqliteMemoryStore` will re-open the database and re-hydrate the `VectorIndex` on startup.
4. Confirm startup integrity check passes.

### 5.3 Dashboard Feed Recovery

After backend is healthy:

1. Refresh the dashboard — the `#view-graph` polling will automatically reconnect.
2. If the dashboard retains stale error state: hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).
3. Confirm `DashboardAPIClient.queryGraph()` receives a `200` response with valid `nodes` and `edges`.

### 5.4 Cycle Correction (Graph Data Issue)

If cycles are present in graph data that the traversal should not produce:

1. Identify the cycle: node A → edge → node B → edge → node A.
2. The `GraphProjectionEngine` uses `visited` set to prevent re-visiting; cycles are handled
   algorithmically.
3. If the same edge relation appears multiple times (duplicate edge upserts), clean up via
   `SqliteMemoryStore` direct query (backup first).

### 5.5 Bounded Recovery for Dense Sub-Graphs

If a specific sub-graph is legitimately dense (e.g., an entity with 200+ edges):

1. Use pagination: break large queries into multiple smaller queries using `startNodeId`
   to anchor each query at a specific depth entry point.
2. Use `edgeTypes` filter to select only the relevant relationship types.
3. Reduce `limit` to 20–30 for dashboard display purposes.

---

## 6. Verification

1. Confirm `POST /v1/memory/graph/query` with `maxDepth: 4, limit: 100` completes in < 500ms
   for a normal-density workspace.
2. Confirm dashboard `#view-graph` section loads without spinner timeout.
3. Verify cycle detection: insert a test node chain with a back-edge; confirm traversal terminates
   and does not return duplicate nodes.
4. Run dashboard and memory security test suites:
   ```
   node --import tsx/esm --test tests/vertical-slice/dashboard-security-invariants.test.ts
   node --import tsx/esm --test tests/hardening/memory-persistence-security.test.ts
   ```

---

## 7. Escalation

| Trigger                                           | Action                                                                                |
| :------------------------------------------------ | :------------------------------------------------------------------------------------ |
| `058-SEC-03` cross-tenant graph access detected   | **Security escalation** — potential tenant isolation breach. Investigate immediately. |
| Event loop permanently blocked by graph query     | Backend engineering — synchronous SQLite query optimization required                  |
| Traversal result always exactly 100 nodes         | Investigate graph density — consider pagination or restricting nodeTypes              |
| Dashboard graph view never loads on any workspace | Frontend engineering — `DashboardAPIClient.queryGraph` or SSE stream investigation    |
| Graph nodes accumulating without bound            | Memory subsystem review — tombstone process not running or bounds not enforced        |

---

## 8. Prevention / Lessons Learned

- **Always specify `nodeTypes` and `edgeTypes` filters** in production graph queries to limit
  traversal breadth — open-ended traversal of a dense graph will hit the 100-node limit.
- **Use `startNodeId`** to anchor traversal at a known important entity rather than global graph
  traversal.
- **Keep `maxDepth ≤ 2` for dashboard display queries** — depth 4 is the maximum allowed but
  rarely needed for readable visualizations.
- **Monitor node/edge count per workspace** — graphs growing beyond 10,000 nodes per workspace
  should trigger the disk-backed SQLite strategy (already implemented in `SqliteMemoryStore`).
- **Graph is advisory, not authoritative** — the Knowledge Graph is a projection for context
  enrichment. It must not be used as an authorization or policy decision source (058-SEC-01 /
  062-SEC-07).
- **Test dense sub-graphs** during load testing — a single entity with many edges can cause
  performance degradation at depth 3–4.
