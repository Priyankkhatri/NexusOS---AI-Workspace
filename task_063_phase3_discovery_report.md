# TASK 063 PHASE 3 DISCOVERY REPORT

**Sprint 2 Milestone 4 — Web Dashboard Multi-Agent Collaboration, Persistent Memory/Graph Observability & Governed Agent Activity Experience**
**Phase 3: Persistent Memory Explorer & Knowledge Graph Observability**

---

## 1. Executive Summary

This discovery report establishes the technical architecture, security invariants, data models, accessibility requirements, and implementation blueprint for **Task 063 Phase 3**: the delivery of the **Persistent Memory Explorer** and **Knowledge Graph Observability** views within `apps/web-dashboard`.

### Core Discovery Findings

1. **Existing Backend Substrates**: Task 062 delivered the canonical persistent memory store, vector embedding index, and knowledge graph engine (`@nexusos/contracts/memory`, `services/backend/src/memory/`). Task 063 Phase 1 already exposed authenticated, tenant-isolated read projections for these engines on the Backend REST API (`GET /v1/memory/search`, `GET /v1/memory/:id`, `DELETE /v1/memory/:id`, `POST /v1/memory/vectors/search`, `POST /v1/memory/graph/query`) and extended `DashboardAPIClient` with typed client methods (`searchMemory`, `getMemory`, `deleteMemory`, `searchVectors`, `queryGraph`).
2. **Phase 3 Boundary**: Phase 3 is strictly restricted to **observability and governed inspection** of persistent memory records and knowledge graph relationships. It does **not** create a new memory authority layer, alter backend database schemas, introduce execution runtimes, or permit retrieved memory to grant policy, lease, or capability authority.
3. **Zero External Dependencies**: The knowledge graph visualization will be rendered using bounded, deterministic SVG within the existing Vanilla TypeScript/CSS architecture without importing third-party graph frameworks (no D3, Cytoscape, or Vis.js).
4. **Integration with Existing Lifecycle**: Phase 3 will seamlessly slot into the established 15-second cursor-based polling lifecycle, respecting `document.hidden` visibility pausing and request sequence guards (`memoryRequestId`, `graphRequestId`) to prevent stale asynchronous response overwrite and DOM bloat.

---

## 2. Authoritative Evidence

The scope and requirements for Phase 3 are derived from the following canonical engineering documents:

1. **`docs/EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md`**:
   - **Section 2.1 (Application Map)**: Defines `Tasks`, `Activity Center`, `Memory Explorer`, and `Knowledge Graph` as core operational surfaces of the Experience Platform.
   - **Section 9 (Memory Explorer)**: Defines governed inspection, search, filtering, provenance attribution, confidence ratings, sensitivity classification, retention monitoring, and deletion/tombstone observability for persistent memory objects.
   - **Section 10 (Knowledge Graph)**: Specifies access-filtered derived relationship rendering among memory, tasks, artifacts, workflows, capabilities, and evidence; defines progressive neighborhood expansion, typed edges, and non-authoritative advisory semantics.
2. **`docs/SPRINT_2_READINESS_AND_BACKLOG.md` (Sprint 2 Sequencing)**:
   - Identifies Sprint 2 Milestone 4 as the delivery of the Web Dashboard operational surfaces observing Task 060 multi-agent collaboration and Task 062 persistent knowledge graph persistence.
3. **`task_063_discovery_report.md` (Phase 1 Baseline)**:
   - Established the 3-phase decomposition:
     - _Phase 1_: Backend read-model projections and `DashboardAPIClient` extensions (Completed at `ab2c950a36beb0a990746b31ef1ead52fa1af51e`).
     - _Phase 2_: Agent Roster and Delegation Cockpit (Completed at `38c10ed287b5674d4ca496eacf082cb12d27a160`).
     - _Phase 3_: Persistent Memory Explorer & Knowledge Graph Observability (Current Phase).

---

## 3. Current Architecture

### Web Dashboard Subsystem (`apps/web-dashboard/`)

- **Technology Stack**: Vanilla TypeScript (ESNext modules) and Vanilla CSS, compiled directly via `tsc` into `dist/`.
- **Navigation & Routing**: Single-page application shell with accessible sidebar navigation (`#app-nav`) switching sections (`.view`) via `switchView(view)`.
- **State Management**: Centralized singleton `state: AppState` in `main.ts` managing view state, filters, sequence IDs, and cached records.
- **Client Networking**: `DashboardAPIClient` (`src/api/client.ts`) utilizing standard Fetch API with in-memory authentication token closure (`getAuthToken`), normalized `DashboardAPIError`, and tenant/workspace headers (`X-Workspace-ID`).
- **Real-Time Synchronization**: 15-second timer-based polling loop (`startPolling()`, `refreshCurrentView()`), automatically paused when tab is in background via `visibilitychange` listener (`document.hidden`).
- **Security & Hygiene**: All server projections are treated as untrusted and passed through `sanitizeHTML()`. Request sequence counters drop out-of-order stale responses.
- **Accessibility**: Strict adherence to WCAG 2.2 AA (semantic landmarks, ARIA live regions, keyboard navigation, color-independent status indicators, reduced motion support).

---

## 4. Memory Explorer Gap Analysis

### Canonical Contracts (`packages/contracts/src/memory/base.ts`)

- **`MemoryRecord`**:
  - `id: string` (UUID or deterministic ID)
  - `tenantId: string`, `workspaceId: string`, `ownerId: string`
  - `class: MemoryClass` (`WORKING`, `EPISODIC`, `SEMANTIC`, `PROCEDURAL`, `ARTIFACT`)
  - `status: MemoryStatus` (`ACTIVE`, `PROPOSED`, `TOMBSTONED`, `ARCHIVED`)
  - `sensitivity: MemorySensitivity` (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`)
  - `title?: string`, `content: string`, `summary?: string`
  - `confidence: number` (0.0 to 1.0)
  - `tags: string[]`
  - `metadata: Record<string, unknown>`
  - `provenance: MemoryProvenance` (`sourceType`, `sourceId`, `creatorPrincipalId`, `timestamp`, `verified`)
  - `retentionPolicy?: { ttlSeconds?, expiresAt? }`
  - `version: number`, `createdAt: string`, `updatedAt: string`, `tombstonedAt?: string`
- **`MemorySearchRequest` & `MemorySearchResponse`**:
  - Filter parameters: `query`, `classes`, `maxSensitivity`, `status`, `minConfidence`, `tags`, `limit` ($\le 100$), `offset`.
  - Response items: `items: MemorySearchResultItem[]` with `record`, `score`, `lexicalScore`, `semanticScore`, `citationToken`, `estimatedTokens`.

### Existing Backend Endpoints

- `GET /v1/memory/search`: Scoped to authenticated tenant, accepts query string filters.
- `GET /v1/memory/:id`: Retrieves single memory record.
- `DELETE /v1/memory/:id?expectedVersion=N`: Tombstones record with optimistic concurrency check.

### Required UI Capabilities (Gaps in `apps/web-dashboard/`)

1. **Navigation Entry**: Add `nav-memory` ("Memory") to sidebar navigation and register `'memory'` in `AppState['currentView']`.
2. **View Section (`#view-memory`)**:
   - **Search & Filter Toolbar**: Text search input, Class filter dropdown (`All Classes`, `Working`, `Episodic`, `Semantic`, `Procedural`, `Artifact`), Sensitivity filter (`All`, `Public`, `Internal`, `Confidential`, `Restricted`), Status filter (`Active`, `Archived`, `Tombstoned`), and manual Refresh button.
   - **Search Results Grid / List**: Responsive feed of memory cards displaying title, class badge, sensitivity pill, confidence meter, relative timestamp, citation token, and summary/excerpt.
   - **Memory Detail Modal / Inspector**: Accessible modal or drawer for deep inspection of full content, metadata JSON, provenance attribution (source actor, verification status, timestamps), retention expiry, and version history.
   - **Explicit Authority Disclaimer**: Visual banner emphasizing that retrieved memory is **advisory data only** and confers zero execution or policy permissions.
   - **Governed Tombstone Affordance**: Optional governed "Tombstone Record" action with confirmation dialog, passing `expectedVersion` to prevent race conditions.

---

## 5. Knowledge Graph Gap Analysis

### Canonical Contracts (`packages/contracts/src/memory/graph.ts`)

- **`MemoryGraphNode`**:
  - `id: string`, `tenantId: string`, `workspaceId: string`
  - `nodeType: MemoryGraphNodeType` (`ENTITY`, `CONCEPT`, `TASK`, `WORKSPACE`, `DECISION`, `ARTIFACT`, `ERROR_PATTERN`)
  - `label: string`, `memoryRecordId?: string`, `confidence: number`, `properties: Record<string, unknown>`, `createdAt: string`
- **`MemoryGraphEdge`**:
  - `id: string`, `tenantId: string`, `workspaceId: string`
  - `sourceNodeId: string`, `targetNodeId: string`
  - `edgeType: MemoryGraphEdgeType` (`DERIVED_FROM`, `RELATES_TO`, `SUPERSEDES`, `DECIDED_IN`, `EXECUTED_BY`, `RESOLVED_BY`)
  - `weight: number`, `confidence: number`, `provenance: MemoryProvenance`, `createdAt: string`
- **`MemoryGraphQueryRequest` & `Response`**:
  - Traversal bounds: `maxDepth: 1..4` (default 2), `limit: 1..100` (default 25).
  - Returns `nodes: MemoryGraphNode[]`, `edges: MemoryGraphEdge[]`, `traversalDepth`, `totalNodes`, `totalEdges`.

### Existing Backend Endpoints

- `POST /v1/memory/graph/query`: Bounded graph traversal query executed by `services/backend/src/memory/memory-controller.ts`.

### Required UI Capabilities (Gaps in `apps/web-dashboard/`)

1. **Navigation Entry**: Add `nav-graph` ("Graph") to sidebar navigation and register `'graph'` in `AppState['currentView']`.
2. **View Section (`#view-graph`)**:
   - **Graph Toolbar**: Node type filter dropdown, Edge type filter dropdown, Traversal depth selector (1 to 4), and Refresh button.
   - **Dual-Panel Cockpit Layout**:
     - _Left Panel (Canvas / SVG Visualization)_: Clean, bounded interactive SVG rendering graph nodes as color-coded glyphs and edges as directed arrows. Includes zoom/pan or reset controls, and cycle-safe rendering.
     - _Right Panel (Entity & Relationship Inspector)_: Detailed card displaying selected node attributes (label, type, confidence, connected edges, linked memory record) or selected edge attributes (type, source, target, weight, provenance).
   - **Accessible Table Fallback**: Accessible HTML table or structured list beneath or toggleable over the SVG canvas to satisfy WCAG 2.2 AA screen-reader requirements.
   - **Bounds & Truncation Transparency**: Clear indicator showing rendered node/edge counts and alerting when backend maximums (100) are reached.

---

## 6. Security Threat Model

| Threat ID    | Threat Description                                  | Attack Vector                                                                                                 | Mitigation / Invariant                                                                                                                   |
| :----------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **T-063-07** | **Cross-Site Scripting (XSS) in Memory Content**    | Adversary injects `<script>` or event handlers in memory `title`, `content`, `tags`, or metadata.             | **063-SEC-07**: Pass all attributes through `sanitizeHTML()`; render body text in text-safe containers.                                  |
| **T-063-08** | **Advisory Confusion & Prompt Injection**           | Memory contains system directives or delimiters (e.g. `<retrieved_context>`, `SYSTEM:`) misleading operators. | **063-SEC-08**: Visibly isolate memory in quarantine containers; neutralize adversarial delimiters; enforce non-authoritative semantics. |
| **T-063-09** | **Credential & Secret Exposure**                    | Memory records contain persisted API keys, tokens, or private certificates.                                   | **063-SEC-09**: Client inspector masks high-entropy token patterns; backend sanitization (`056-SEC-03`) enforced.                        |
| **T-063-10** | **Cross-Tenant / Cross-Workspace Data Leak**        | Malicious UI request attempts to probe foreign tenant or unauthorized workspace memory/graph data.            | **063-SEC-10**: Strict token-derived tenant scoping; query parameter overrides rejected; unauthorized workspaces return empty lists.     |
| **T-063-11** | **Denial of Service via Unbounded Graph Rendering** | Cyclic or dense graph data causes recursive rendering loops or DOM exhaustion.                                | **063-SEC-11**: Hard bounds on nodes ($\le 100$) and edges ($\le 100$); cycle detection via visited Sets; depth clamped to 4.            |
| **T-063-12** | **Stale Response Race Conditions & DOM Bloat**      | Rapid user typing or slow network results in out-of-order responses overwriting newer state.                  | **063-SEC-12**: Sequence counters (`memoryRequestId`, `graphRequestId`) discard stale responses; container replacement is idempotent.    |

---

## 7. Proposed Security Invariants (063-SEC-07 to 063-SEC-12)

### `063-SEC-07`: Memory & Graph Untrusted Content XSS Neutralization

- All dynamic fields from memory records (`title`, `content`, `summary`, `tags`, `ownerId`) and graph elements (`label`, `properties`) must be sanitized using `sanitizeHTML()` before insertion into the DOM.
- No memory content may be inserted via unescaped string interpolation or unsafe `innerHTML`.

### `063-SEC-08`: Advisory Memory Boundaries & Authority Containment

- Retrieved memory records are presented strictly as **inert observational data**.
- Memory cards and detail inspectors must prominently display an advisory badge: `Advisory Data Only — Non-Authoritative`.
- The UI must never infer or grant execution permissions, capability leases, policy exemptions, or administrative access based on retrieved memory objects.

### `063-SEC-09`: Secret Redaction & Token Masking in Inspection Panes

- The memory inspector and metadata viewer must never display raw credentials, HMAC signing keys, or authentication tokens.
- Dynamic key-value pairs matching sensitive key names (`*secret*`, `*token*`, `*password*`, `*private*`, `*key*`) must be masked in the inspector.

### `063-SEC-10`: Strict Tenant & Workspace Data Isolation

- Memory and graph projections must strictly scope to the authenticated user's `tenantId` established by the session token.
- Attempts to supply alternative `tenantId` parameters via query strings or request bodies must be completely disregarded.
- Cross-tenant queries must return zero results without leaking existence.

### `063-SEC-11`: Bounded Graph Traversal, Cycle Protection & Truncation Transparency

- The Knowledge Graph visualizer must enforce hard rendering bounds: `nodes <= 100`, `edges <= 100`, `depth <= 4`.
- The layout engine must track visited node IDs to guarantee cycle termination on circular relationships.
- When backend data exceeds boundary limits, a prominent `.truncation-notice` must inform the operator of partial rendering.

### `063-SEC-12`: Sequence-Guarded Asynchronous State & Idempotent DOM Lifecycles

- Asynchronous data fetches for memory search and graph queries must increment and check monotonically increasing request sequence IDs (`memoryRequestId`, `graphRequestId`).
- Out-of-order responses arriving after a subsequent request must be discarded immediately.
- Refresh operations must overwrite container content idempotently without accumulating DOM nodes or event listeners.

---

## 8. Polling & State Integration

### Existing Architecture Reuse

- **Single Global Timer**: Phase 3 will **not** instantiate any new `setInterval` timers. The existing 15-second polling loop in `main.ts` (`state.pollingInterval`) will be reused.
- **View-Aware Refresh**: In `refreshCurrentView()`, `loadViewData(state.currentView)` will be extended with cases for `'memory'` and `'graph'`.
- **Visibility Pause**: Polling will remain automatically paused when the document is hidden (`document.hidden`), preserving system resources and preventing background network chatter.

### Proposed State Additions in `AppState`

```typescript
interface AppState {
  // Existing fields...
  currentView:
    | 'overview'
    | 'tasks'
    | 'approvals'
    | 'activity'
    | 'agents'
    | 'delegations'
    | 'memory'
    | 'graph';

  // Phase 3: Memory Explorer State
  memoryItems: MemorySearchResultItem[];
  memoryTotal: number;
  memorySearchQuery: string;
  memoryClassFilter: string;
  memoryStatusFilter: string;
  memorySensitivityFilter: string;
  selectedMemoryRecord: MemoryRecord | null;
  memoryRequestId: number;

  // Phase 3: Knowledge Graph State
  graphNodes: MemoryGraphNode[];
  graphEdges: MemoryGraphEdge[];
  graphNodeTypeFilter: string;
  graphEdgeTypeFilter: string;
  graphMaxDepth: number;
  selectedGraphNode: MemoryGraphNode | null;
  selectedGraphEdge: MemoryGraphEdge | null;
  graphRequestId: number;
}
```

---

## 9. Accessibility Requirements (WCAG 2.2 AA)

1. **Semantic Landmarks & Headings**:
   - Each view begins with an `<h1>` (`Memory Explorer`, `Knowledge Graph`).
   - Major view sections use `<section>` with `aria-labelledby` pointing to panel headings.
2. **Keyboard Navigation & Focus Management**:
   - All interactive items (cards, filter selects, search inputs, graph nodes, retry buttons) have standard tab stops with high-contrast `:focus-visible` outlines.
   - Modals (Memory Detail Inspector) implement focus trapping and `Escape` key closure.
3. **Screen Reader Live Regions**:
   - Search result counts and status updates are announced politely via `aria-live="polite"`.
   - Error states use `role="alert"`.
4. **Accessible Alternative for Knowledge Graph**:
   - While the SVG canvas provides visual spatial representation, an accessible tabular view (`role="table"`) or structured list of nodes and edges is provided to allow full screen-reader and non-visual exploration.
   - SVG nodes include `role="button"`, `tabindex="0"`, and descriptive `aria-label` attributes (`Node: [Label], Type: [Type]`).
5. **Reduced Motion**:
   - `@media (prefers-reduced-motion: reduce)` disables SVG transition animations and spinner rotations.
6. **Color Independence**:
   - Memory sensitivity and status indicators combine color accents with textual labels and distinct geometric status dots.

---

## 10. Dependency Analysis

- **Third-Party Dependencies Needed**: **ZERO**.
- **Frontend Frameworks**: No React, Vue, Svelte, or Angular.
- **Graph Frameworks**: No D3, Cytoscape, Vis.js, or Sigma.js.
  - _Rationale_: A lightweight, deterministic SVG layout engine (e.g. radial/depth-layered layout) can be implemented in less than 150 lines of Vanilla TypeScript. It avoids bundle bloat, eliminates security supply-chain risks, maintains instant loading performance, and gives complete control over accessibility attributes.
- **Transpilation & Bundling**: Standard `tsc` building to `apps/web-dashboard/dist/`.

---

## 11. Exact File-Level Implementation Plan

### 1. Files to Modify (Required)

- `apps/web-dashboard/index.html`:
  - Add navigation buttons `#nav-memory` and `#nav-graph`.
  - Add `<section id="view-memory">` (search input, filters, results grid, detail modal, empty/loading/error containers).
  - Add `<section id="view-graph">` (traversal controls, SVG canvas, inspector sidebar, accessible table fallback, empty/loading/error containers).
- `apps/web-dashboard/src/index.css`:
  - Section 26: Memory Explorer styles (`.memory-grid`, `.memory-card`, `.sensitivity-pill`, `.confidence-bar`, `.modal-detail`).
  - Section 27: Knowledge Graph layout & SVG styling (`.graph-cockpit-layout`, `.graph-svg`, `.graph-node`, `.graph-edge`, `.graph-arrow`).
  - Section 28: Graph Inspector & accessible table styles (`.graph-inspector`, `.graph-table`).
- `apps/web-dashboard/src/main.ts`:
  - Update `AppState` with `'memory'` and `'graph'` views and their respective filter and sequence state.
  - Implement `initMemoryView()`, `loadMemory()`, `renderMemoryResults()`, `openMemoryDetail()`, `closeMemoryDetail()`.
  - Implement `initGraphView()`, `loadGraph()`, `renderGraph()`, `renderGraphInspector()`, `calculateGraphLayout()`.
  - Extend `loadViewData(view)` to refresh memory or graph data during active polling.
  - Export renderers and layout helpers for testing.
- `tests/vertical-slice/dashboard-security-invariants.test.ts`:
  - Extend test suite with dedicated Phase 3 tests validating `063-SEC-07` through `063-SEC-12`.

### 2. Files to Create (Optional / Modular)

- `apps/web-dashboard/src/graph/layout.ts` (optional):
  - Deterministic, bounded radial or layered DAG layout calculator keeping `main.ts` lean.

### 3. Backend & Contract Files (FROZEN — Must NOT be Modified)

- `packages/contracts/src/memory/` (all files frozen)
- `services/backend/src/memory/memory-controller.ts` (frozen)
- `services/backend/src/memory/memory-routes.ts` (frozen)
- `services/backend/src/memory/sqlite-memory-store.ts` (frozen)

---

## 12. Implementation Phasing

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: MEMORY EXPLORER HTML & CSS FOUNDATION               │
│ - Add #nav-memory and #view-memory to index.html            │
│ - Implement Section 26 styling in index.css                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ STEP 2: MEMORY EXPLORER CONTROLLER & RENDERING LOGIC        │
│ - Wire initMemoryView, loadMemory, renderMemoryResults      │
│ - Implement safe modal detail inspector & tombstone action  │
│ - Enforce sequence guards and sanitizeHTML                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ STEP 3: KNOWLEDGE GRAPH HTML & CSS COCKPIT                  │
│ - Add #nav-graph and #view-graph to index.html              │
│ - Implement Section 27-28 styling in index.css             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ STEP 4: KNOWLEDGE GRAPH CONTROLLER & SVG VISUALIZATION      │
│ - Wire initGraphView, loadGraph, queryGraph                 │
│ - Deterministic SVG node/edge layout with cycle protection  │
│ - Node/edge selection and inspector panel rendering         │
│ - Accessible table fallback rendering                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ STEP 5: POLLING & VIEW INTEGRATION                          │
│ - Add memory and graph to loadViewData and switchView       │
│ - Verify pause-on-hidden and memory leak prevention         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ STEP 6: SECURITY & UI INVARIANT TESTS                       │
│ - Add 063-SEC-07 to 063-SEC-12 tests in vertical slice suite│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ STEP 7: QUALITY GATES & CI VERIFICATION                     │
│ - Run build, typecheck, lint, format, validate, test        │
│ - Commit atomically and verify exact GitHub Actions run     │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. Validation Gates

The implementation must pass the following local quality gates before committing:

1. `pnpm build`: Monorepo TypeScript compilation across all packages and services.
2. `pnpm typecheck`: Strict type check (`tsc --noEmit`).
3. `pnpm lint`: ESLint check with 0 errors.
4. `pnpm format:check`: Prettier check verifying all modified files adhere to style rules.
5. `pnpm run validate`: Monorepo architecture boundary validation.
6. `pnpm run security`: Secret scanner ensuring no tokens or keys are leaked.
7. `pnpm test`: Full monorepo automated test suite passing with 0 failures.
8. **Final GitHub Actions CI**: Exact run for the pushed SHA must be 100% green.

---

## 14. Out-of-Scope Items

To preserve strict scope boundaries, the following are strictly **forbidden** in Phase 3:

- Modifying backend SQLite persistence, vector tables, or graph query logic.
- Adding WebSocket, SSE, or background sync workers.
- Introducing a frontend framework (React, Vue, Svelte) or third-party graph library (D3, Cytoscape).
- Implementing write/mutation features that grant execution authority from memory.
- Cloud synchronization or federated memory sharing.
- Altering Task 060 multi-agent delegation or lease authorities.
- Commencing Task 064+ roadmap items.

---

## 15. Open Questions & Risks

1. **Question**: Should the Memory Explorer allow executing a governed "Tombstone" action directly from the UI, or remain 100% read-only?
   - _Resolution_: The prompt confirms Phase 3 is "strictly read/observability oriented", but also asks "whether deletion/forgetting should be represented as an action or merely observed". The recommended approach is to provide a strictly governed "Tombstone Record" affordance that calls `DELETE /v1/memory/:id?expectedVersion=N` with a confirmation modal, while clearly labeling it as a database tombstone that revokes indexing rather than an authority mutation. If strictly read-only is preferred, the button can be omitted and status displayed as `ACTIVE` vs `TOMBSTONED`.
2. **Risk**: Dense graphs with high connectivity causing visual overlapping in simple SVG layout.
   - _Resolution_: Limit default depth to 2 and default node count to 25. Provide depth controls (1..4) and node type filters. Use a concentric or force-relaxed radial layout algorithm to maintain readability.

---

## 16. Discovery Conclusion

Task 063 Phase 3 has a clean, well-defined implementation path that completes Milestone 4 by delivering the Memory Explorer and Knowledge Graph views. All necessary backend projections and client APIs are already fully in place from Phase 1. The implementation requires zero external dependencies, strictly complies with zero-trust UI security guarantees, seamlessly integrates into the existing 15-second polling lifecycle, and ensures complete accessibility across all operational surfaces.

---

_End of Task 063 Phase 3 Discovery Report._
