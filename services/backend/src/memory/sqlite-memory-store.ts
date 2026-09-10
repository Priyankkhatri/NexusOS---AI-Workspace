import { DatabaseSync } from 'node:sqlite';
import {
  MemoryRecord,
  MemorySearchRequest,
  MemoryProposal,
  MemoryStatus,
  MemorySensitivity,
  SENSITIVITY_HIERARCHY,
  EpisodicEpisode,
  ProceduralPlaybookProposal,
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphQueryRequest,
  MemoryGraphQueryResponse,
  isPlaybookPlanningEligible,
  VectorEmbedding,
  VectorSearchRequest,
  VectorSearchResponse,
  DEFAULT_VECTOR_DIMENSION,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  MemoryNotFoundError,
  MemoryVersionConflictError,
  VectorDimensionMismatchError,
} from './types.js';
import { VectorIndex } from './vector-index.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { Logger } from '../observability/logger.js';

export interface SqliteMemoryStoreOptions {
  dbPath?: string;
  databasePath?: string;
  vectorDimensions?: number;
  maxVectorsPerWorkspace?: number;
  logger?: Logger;
  simulateFailure?: boolean;
}

/**
 * Authoritative Disk-Backed SQLite Persistent Memory Store
 *
 * Implements IMemoryStore with Node 24 native node:sqlite (DatabaseSync).
 *
 * Invariants & Guarantees:
 * - 062-SEC-01: Multi-tenant and workspace partitioning on every query and table.
 * - 062-SEC-02: 100% parameterized SQL preventing SQL injection.
 * - 062-SEC-03: Atomic cascade tombstoning with explicit transaction rollback.
 * - 062-SEC-04: Secret redaction prior to persistence.
 * - 062-SEC-05: Bounded graph traversal (maxDepth <= 4, limit <= 100).
 * - 062-SEC-06: Pre-filtering vector search by tenant, workspace, and sensitivity.
 * - 062-SEC-07: Stored data remains inert non-authoritative advisory context.
 */
export class SqliteMemoryStore implements IMemoryStore {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly vectorDimensions: number;
  private readonly vectorIndex: VectorIndex;
  private readonly logger?: Logger;

  public simulateFailure = false;
  public simulateFailureInCascade = false;

  constructor(options?: SqliteMemoryStoreOptions) {
    this.dbPath = options?.dbPath ?? options?.databasePath ?? ':memory:';
    this.vectorDimensions = options?.vectorDimensions ?? DEFAULT_VECTOR_DIMENSION;
    this.logger = options?.logger;
    this.simulateFailure = options?.simulateFailure ?? false;

    this.vectorIndex = new VectorIndex({
      dimensions: this.vectorDimensions,
      maxVectorsPerWorkspace: options?.maxVectorsPerWorkspace ?? 10_000,
      logger: this.logger,
    });

    this.db = new DatabaseSync(this.dbPath);
    this.configurePragmas();
    this.runMigrations();
    this.hydrateVectorIndex();
  }

  public getDatabase(): DatabaseSync {
    return this.db;
  }

  public getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  private configurePragmas(): void {
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA synchronous = NORMAL;');

    const integrity = this.db.prepare('PRAGMA integrity_check;').all() as Array<{
      integrity_check: string;
    }>;
    if (!integrity || integrity.length === 0 || integrity[0].integrity_check !== 'ok') {
      throw new Error(`062-SEC-01: SQLite integrity check failed on ${this.dbPath}`);
    }
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );
    `);

    const currentVersionRow = this.db
      .prepare('SELECT MAX(version) as max_v FROM schema_migrations;')
      .get() as { max_v: number | null };

    const currentVersion = currentVersionRow?.max_v ?? 0;

    if (currentVersion < 1) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(`
          -- 1. Memory Records
          CREATE TABLE IF NOT EXISTS memory_records (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            class TEXT NOT NULL,
            status TEXT NOT NULL,
            sensitivity TEXT NOT NULL,
            title TEXT,
            content TEXT NOT NULL,
            summary TEXT,
            confidence REAL NOT NULL DEFAULT 1.0,
            tags TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            provenance TEXT NOT NULL,
            retention_policy TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            tombstoned_at TEXT,
            PRIMARY KEY (tenant_id, workspace_id, id)
          );

          CREATE INDEX IF NOT EXISTS idx_memory_records_lookup
            ON memory_records (tenant_id, workspace_id, status);

          -- 2. Memory Proposals
          CREATE TABLE IF NOT EXISTS memory_proposals (
            proposal_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            class TEXT NOT NULL,
            content TEXT NOT NULL,
            title TEXT,
            confidence REAL NOT NULL,
            sensitivity TEXT NOT NULL,
            provenance TEXT NOT NULL,
            suggested_ttl_seconds INTEGER,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            resolved_by TEXT,
            reason TEXT,
            PRIMARY KEY (tenant_id, workspace_id, proposal_id)
          );

          -- 3. Episodic Episodes
          CREATE TABLE IF NOT EXISTS episodes (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            goal TEXT NOT NULL,
            outcome TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (tenant_id, workspace_id, id)
          );

          CREATE INDEX IF NOT EXISTS idx_episodes_lookup
            ON episodes (tenant_id, workspace_id, completed_at DESC);

          -- 4. Procedural Playbooks
          CREATE TABLE IF NOT EXISTS playbooks (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            title TEXT NOT NULL,
            goal_pattern TEXT NOT NULL,
            status TEXT NOT NULL,
            confidence REAL NOT NULL,
            approved_by TEXT,
            approved_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (tenant_id, workspace_id, id)
          );

          -- 5. Knowledge Graph Nodes
          CREATE TABLE IF NOT EXISTS graph_nodes (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            node_type TEXT NOT NULL,
            label TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 1.0,
            memory_record_id TEXT,
            properties TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            PRIMARY KEY (tenant_id, workspace_id, id)
          );

          CREATE INDEX IF NOT EXISTS idx_graph_nodes_mem
            ON graph_nodes (tenant_id, workspace_id, memory_record_id);

          -- 6. Knowledge Graph Edges
          CREATE TABLE IF NOT EXISTS graph_edges (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            edge_type TEXT NOT NULL,
            source_node_id TEXT NOT NULL,
            target_node_id TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 1.0,
            weight REAL NOT NULL DEFAULT 1.0,
            properties TEXT NOT NULL DEFAULT '{}',
            provenance TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            PRIMARY KEY (tenant_id, workspace_id, id)
          );

          CREATE INDEX IF NOT EXISTS idx_graph_edges_src
            ON graph_edges (tenant_id, workspace_id, source_node_id);

          CREATE INDEX IF NOT EXISTS idx_graph_edges_tgt
            ON graph_edges (tenant_id, workspace_id, target_node_id);

          -- 7. Vector Embeddings
          CREATE TABLE IF NOT EXISTS vector_embeddings (
            id TEXT NOT NULL,
            memory_record_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            values_blob TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            normalized INTEGER NOT NULL DEFAULT 0,
            metric TEXT NOT NULL DEFAULT 'COSINE',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            PRIMARY KEY (tenant_id, workspace_id, memory_record_id)
          );

          INSERT INTO schema_migrations (version, applied_at, description)
          VALUES (1, datetime('now'), 'Task 062 Initial Persistent Schema');
        `);
        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }
    }
  }

  private hydrateVectorIndex(): void {
    const rows = this.db
      .prepare(
        `SELECT v.id, v.memory_record_id, v.tenant_id, v.workspace_id, v.values_blob,
                v.dimensions, v.normalized, v.metric, v.metadata, v.created_at,
                r.sensitivity, r.status, r.class, r.tags
         FROM vector_embeddings v
         LEFT JOIN memory_records r
           ON v.tenant_id = r.tenant_id AND v.workspace_id = r.workspace_id AND v.memory_record_id = r.id;`,
      )
      .all() as any[];

    for (const row of rows) {
      if (row.status === MemoryStatus.TOMBSTONED) continue;
      try {
        this.vectorIndex.upsert({
          id: row.id,
          memoryRecordId: row.memory_record_id,
          tenantId: row.tenant_id,
          workspaceId: row.workspace_id,
          values: JSON.parse(row.values_blob),
          dimensions: row.dimensions,
          normalized: Boolean(row.normalized),
          metric: row.metric,
          sensitivity: row.sensitivity,
          status: row.status ?? MemoryStatus.ACTIVE,
          classes: row.class ? [row.class] : undefined,
          tags: row.tags ? JSON.parse(row.tags) : undefined,
          metadata: JSON.parse(row.metadata || '{}'),
          createdAt: row.created_at,
        });
      } catch (e) {
        if (this.logger) {
          this.logger.warn(`Failed to hydrate vector embedding ${row.id}: ${e}`);
        }
      }
    }
  }

  private checkFailure(): void {
    if (this.simulateFailure) {
      throw new Error('062-STORE-FAIL: SQLite storage backend simulated connection failure.');
    }
  }

  // -------------------------------------------------------------------------
  // Memory Records CRUD & Search
  // -------------------------------------------------------------------------

  public async create(record: MemoryRecord): Promise<MemoryRecord> {
    this.checkFailure();

    // 062-SEC-04: Secret Sanitization before persistence
    RedactionFilter.assertNoSecrets(record.content, 'Memory record content');
    if (record.title) {
      RedactionFilter.assertNoSecrets(record.title, 'Memory record title');
    }
    if (record.summary) {
      RedactionFilter.assertNoSecrets(record.summary, 'Memory record summary');
    }

    const stmt = this.db.prepare(`
      INSERT INTO memory_records (
        id, tenant_id, workspace_id, owner_id, class, status, sensitivity,
        title, content, summary, confidence, tags, metadata, provenance,
        retention_policy, version, created_at, updated_at, tombstoned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    stmt.run(
      record.id,
      record.tenantId,
      record.workspaceId,
      record.ownerId,
      record.class,
      record.status,
      record.sensitivity,
      record.title ?? null,
      record.content,
      record.summary ?? null,
      record.confidence,
      JSON.stringify(record.tags),
      JSON.stringify(record.metadata),
      JSON.stringify(record.provenance),
      record.retentionPolicy ? JSON.stringify(record.retentionPolicy) : null,
      record.version,
      record.createdAt,
      record.updatedAt,
      record.tombstonedAt ?? null,
    );

    return JSON.parse(JSON.stringify(record));
  }

  public async getById(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryRecord | null> {
    this.checkFailure();

    const row = this.db
      .prepare(
        `SELECT * FROM memory_records
         WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
      )
      .get(tenantId, workspaceId, id) as any;

    if (!row) return null;

    const record = this.rowToMemoryRecord(row);
    if (record.status === MemoryStatus.TOMBSTONED || this.isExpired(record)) {
      return null;
    }

    return record;
  }

  public async update(
    id: string,
    tenantId: string,
    workspaceId: string,
    updates: Partial<
      Omit<MemoryRecord, 'id' | 'tenantId' | 'workspaceId' | 'version' | 'createdAt'>
    >,
    expectedVersion: number,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    const row = this.db
      .prepare(
        `SELECT * FROM memory_records
         WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
      )
      .get(tenantId, workspaceId, id) as any;

    if (!row) {
      throw new MemoryNotFoundError(id);
    }

    const existing = this.rowToMemoryRecord(row);
    if (existing.status === MemoryStatus.TOMBSTONED) {
      throw new MemoryNotFoundError(id);
    }

    // Optimistic locking (056-SEC-06)
    if (existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    // 062-SEC-04: Secret Sanitization
    if (updates.content) {
      RedactionFilter.assertNoSecrets(updates.content, 'Updated memory content');
    }
    if (updates.title) {
      RedactionFilter.assertNoSecrets(updates.title, 'Updated memory title');
    }
    if (updates.summary) {
      RedactionFilter.assertNoSecrets(updates.summary, 'Updated memory summary');
    }

    const newVersion = existing.version + 1;
    const updatedAt = new Date().toISOString();

    const updated: MemoryRecord = {
      ...existing,
      ...updates,
      version: newVersion,
      updatedAt,
    };

    const stmt = this.db.prepare(`
      UPDATE memory_records SET
        class = ?, status = ?, sensitivity = ?, title = ?, content = ?,
        summary = ?, confidence = ?, tags = ?, metadata = ?, provenance = ?,
        retention_policy = ?, version = ?, updated_at = ?
      WHERE tenant_id = ? AND workspace_id = ? AND id = ?;
    `);

    stmt.run(
      updated.class,
      updated.status,
      updated.sensitivity,
      updated.title ?? null,
      updated.content,
      updated.summary ?? null,
      updated.confidence,
      JSON.stringify(updated.tags),
      JSON.stringify(updated.metadata),
      JSON.stringify(updated.provenance),
      updated.retentionPolicy ? JSON.stringify(updated.retentionPolicy) : null,
      updated.version,
      updated.updatedAt,
      tenantId,
      workspaceId,
      id,
    );

    return updated;
  }

  /**
   * Atomic Cascade Tombstone with Transaction Rollback (062-SEC-03)
   */
  public async tombstone(
    id: string,
    tenantId: string,
    workspaceId: string,
    tombstonedAt: string,
    expectedVersion?: number,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    const row = this.db
      .prepare(
        `SELECT * FROM memory_records
         WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
      )
      .get(tenantId, workspaceId, id) as any;

    if (!row) {
      throw new MemoryNotFoundError(id);
    }

    const existing = this.rowToMemoryRecord(row);
    if (existing.status === MemoryStatus.TOMBSTONED) {
      throw new MemoryNotFoundError(id);
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const newVersion = existing.version + 1;
    const tombstoned: MemoryRecord = {
      ...existing,
      status: MemoryStatus.TOMBSTONED,
      tombstonedAt,
      version: newVersion,
      updatedAt: tombstonedAt,
    };

    // BEGIN ATOMIC CASCAFE TRANSACTION (062-SEC-03)
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      if (this.simulateFailureInCascade) {
        throw new Error('062-SEC-03-SIMULATED-FAIL: Injected failure during cascade transaction');
      }

      // 1. Tombstone record in SQLite
      this.db
        .prepare(
          `UPDATE memory_records
           SET status = ?, tombstoned_at = ?, version = ?, updated_at = ?
           WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
        )
        .run(
          MemoryStatus.TOMBSTONED,
          tombstonedAt,
          newVersion,
          tombstonedAt,
          tenantId,
          workspaceId,
          id,
        );

      // 2. Delete vector embedding row from SQLite
      this.db
        .prepare(
          `DELETE FROM vector_embeddings
           WHERE tenant_id = ? AND workspace_id = ? AND memory_record_id = ?;`,
        )
        .run(tenantId, workspaceId, id);

      // 3. Revoke dependent graph projections
      this.revokeGraphForMemoryInternal(id, tenantId, workspaceId);

      // 4. Mark derived compressions tombstoned
      this.markDerivedCompressionsTombstonedInternal(id, tenantId, workspaceId, tombstonedAt);

      this.db.exec('COMMIT;');

      // Post-commit: evict from in-process VectorIndex projection
      this.vectorIndex.delete(id, tenantId, workspaceId);

      return tombstoned;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore rollback errors if already aborted
      }
      throw err;
    }
  }

  public async search(
    request: MemorySearchRequest,
  ): Promise<{ records: MemoryRecord[]; total: number }> {
    this.checkFailure();

    const tenantId = request.tenantId;
    const workspaceId = request.workspaceId;
    const allowedStatuses = request.status ?? [MemoryStatus.ACTIVE];
    const maxSensitivityRank = request.maxSensitivity
      ? SENSITIVITY_HIERARCHY[request.maxSensitivity]
      : SENSITIVITY_HIERARCHY[MemorySensitivity.RESTRICTED];
    const minConfidence = request.minConfidence ?? 0.0;
    const nowMs = Date.now();

    // 062-SEC-02: Parameterized query construction
    const conditions: string[] = ['tenant_id = ?', 'workspace_id = ?', 'confidence >= ?'];
    const params: any[] = [tenantId, workspaceId, minConfidence];

    // Status condition
    const statusPlaceholders = allowedStatuses.map(() => '?').join(', ');
    conditions.push(`status IN (${statusPlaceholders})`);
    params.push(...allowedStatuses);

    if (request.classes && request.classes.length > 0) {
      const classPlaceholders = request.classes.map(() => '?').join(', ');
      conditions.push(`class IN (${classPlaceholders})`);
      params.push(...request.classes);
    }

    if (request.ownerId) {
      conditions.push('owner_id = ?');
      params.push(request.ownerId);
    }

    const sql = `SELECT * FROM memory_records WHERE ${conditions.join(' AND ')};`;
    const rows = this.db.prepare(sql).all(...params) as any[];

    const matching: MemoryRecord[] = [];
    const tagsSet = request.tags ? new Set(request.tags) : null;
    const queryTerm = request.query ? request.query.toLowerCase().trim() : null;

    for (const row of rows) {
      const rec = this.rowToMemoryRecord(row);

      // Sensitivity check
      const rank = SENSITIVITY_HIERARCHY[rec.sensitivity] ?? 0;
      if (rank > maxSensitivityRank) continue;

      // Expiry check
      if (this.isExpired(rec, nowMs)) continue;

      // Tags filter
      if (tagsSet) {
        const hasTag = rec.tags.some((t) => tagsSet.has(t));
        if (!hasTag) continue;
      }

      // Lexical match
      if (queryTerm && queryTerm.length > 0) {
        const contentMatch = rec.content.toLowerCase().includes(queryTerm);
        const titleMatch = rec.title ? rec.title.toLowerCase().includes(queryTerm) : false;
        const summaryMatch = rec.summary ? rec.summary.toLowerCase().includes(queryTerm) : false;
        const tagMatch = rec.tags.some((t) => t.toLowerCase().includes(queryTerm));
        if (!contentMatch && !titleMatch && !summaryMatch && !tagMatch) {
          continue;
        }
      }

      matching.push(rec);
    }

    const total = matching.length;
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 10;
    const records = matching.slice(offset, offset + limit);

    return { records, total };
  }

  public async purgeExpired(currentIsoTimestamp: string): Promise<number> {
    this.checkFailure();
    const nowMs = new Date(currentIsoTimestamp).getTime();
    const rows = this.db
      .prepare(
        "SELECT * FROM memory_records WHERE status != 'TOMBSTONED' AND retention_policy IS NOT NULL;",
      )
      .all() as any[];

    let purgedCount = 0;
    for (const row of rows) {
      const rec = this.rowToMemoryRecord(row);
      if (this.isExpired(rec, nowMs)) {
        await this.tombstone(rec.id, rec.tenantId, rec.workspaceId, currentIsoTimestamp);
        purgedCount++;
      }
    }
    return purgedCount;
  }

  // -------------------------------------------------------------------------
  // Proposals
  // -------------------------------------------------------------------------

  public async saveProposal(proposal: MemoryProposal): Promise<MemoryProposal> {
    this.checkFailure();
    const stmt = this.db.prepare(`
      INSERT INTO memory_proposals (
        proposal_id, tenant_id, workspace_id, owner_id, class, content, title,
        confidence, sensitivity, provenance, suggested_ttl_seconds, status,
        created_at, resolved_at, resolved_by, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, workspace_id, proposal_id) DO UPDATE SET
        status = excluded.status,
        resolved_at = excluded.resolved_at,
        resolved_by = excluded.resolved_by,
        reason = excluded.reason;
    `);

    stmt.run(
      proposal.proposalId,
      proposal.tenantId,
      proposal.workspaceId,
      proposal.ownerId,
      proposal.class,
      proposal.content,
      proposal.title ?? null,
      proposal.confidence,
      proposal.sensitivity,
      JSON.stringify(proposal.provenance),
      proposal.suggestedTtlSeconds ?? null,
      proposal.status,
      proposal.createdAt,
      proposal.resolvedAt ?? null,
      proposal.resolvedBy ?? null,
      proposal.reason ?? null,
    );

    return JSON.parse(JSON.stringify(proposal));
  }

  public async getProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryProposal | null> {
    this.checkFailure();
    const row = this.db
      .prepare(
        `SELECT * FROM memory_proposals
         WHERE tenant_id = ? AND workspace_id = ? AND proposal_id = ?;`,
      )
      .get(tenantId, workspaceId, proposalId) as any;

    if (!row) return null;
    return this.rowToProposal(row);
  }

  public async updateProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
    status: 'APPROVED' | 'REJECTED',
    resolvedBy: string,
    resolvedAt: string,
    reason?: string,
  ): Promise<MemoryProposal> {
    this.checkFailure();
    const existing = await this.getProposal(proposalId, tenantId, workspaceId);
    if (!existing) {
      throw new Error(`056-SEC-04: Proposal '${proposalId}' not found.`);
    }

    this.db
      .prepare(
        `UPDATE memory_proposals
         SET status = ?, resolved_by = ?, resolved_at = ?, reason = ?
         WHERE tenant_id = ? AND workspace_id = ? AND proposal_id = ?;`,
      )
      .run(status, resolvedBy, resolvedAt, reason ?? null, tenantId, workspaceId, proposalId);

    return {
      ...existing,
      status,
      resolvedBy,
      resolvedAt,
      reason,
    };
  }

  // -------------------------------------------------------------------------
  // Episodes
  // -------------------------------------------------------------------------

  public async saveEpisode(episode: EpisodicEpisode): Promise<EpisodicEpisode> {
    this.checkFailure();
    const stmt = this.db.prepare(`
      INSERT INTO episodes (
        id, tenant_id, workspace_id, task_id, goal, outcome,
        completed_at, created_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, workspace_id, id) DO UPDATE SET
        goal = excluded.goal,
        outcome = excluded.outcome,
        completed_at = excluded.completed_at,
        data = excluded.data;
    `);

    stmt.run(
      episode.id,
      episode.tenantId,
      episode.workspaceId,
      episode.taskId,
      episode.goal,
      episode.outcome,
      episode.completedAt,
      episode.createdAt,
      JSON.stringify(episode),
    );

    return JSON.parse(JSON.stringify(episode));
  }

  public async getEpisode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<EpisodicEpisode | null> {
    this.checkFailure();
    const row = this.db
      .prepare('SELECT data FROM episodes WHERE tenant_id = ? AND workspace_id = ? AND id = ?;')
      .get(tenantId, workspaceId, id) as { data: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.data);
  }

  public async listEpisodes(
    tenantId: string,
    workspaceId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ episodes: EpisodicEpisode[]; total: number }> {
    this.checkFailure();

    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM episodes WHERE tenant_id = ? AND workspace_id = ?;')
      .get(tenantId, workspaceId) as { cnt: number };

    const total = countRow?.cnt ?? 0;

    const rows = this.db
      .prepare(
        `SELECT data FROM episodes
         WHERE tenant_id = ? AND workspace_id = ?
         ORDER BY completed_at DESC
         LIMIT ? OFFSET ?;`,
      )
      .all(tenantId, workspaceId, limit, offset) as Array<{ data: string }>;

    const episodes = rows.map((r) => JSON.parse(r.data));
    return { episodes, total };
  }

  // -------------------------------------------------------------------------
  // Playbooks
  // -------------------------------------------------------------------------

  public async savePlaybook(
    playbook: ProceduralPlaybookProposal,
  ): Promise<ProceduralPlaybookProposal> {
    this.checkFailure();
    const stmt = this.db.prepare(`
      INSERT INTO playbooks (
        id, tenant_id, workspace_id, title, goal_pattern, status,
        confidence, approved_by, approved_at, created_at, updated_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, workspace_id, id) DO UPDATE SET
        title = excluded.title,
        goal_pattern = excluded.goal_pattern,
        status = excluded.status,
        confidence = excluded.confidence,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = excluded.updated_at,
        data = excluded.data;
    `);

    stmt.run(
      playbook.id,
      playbook.tenantId,
      playbook.workspaceId,
      playbook.title,
      playbook.goalPattern,
      playbook.status,
      playbook.confidence,
      playbook.humanApproval?.approvedBy ?? null,
      playbook.humanApproval?.approvedAt ?? null,
      playbook.createdAt,
      playbook.updatedAt,
      JSON.stringify(playbook),
    );

    return JSON.parse(JSON.stringify(playbook));
  }

  public async getPlaybook(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<ProceduralPlaybookProposal | null> {
    this.checkFailure();
    const row = this.db
      .prepare('SELECT data FROM playbooks WHERE tenant_id = ? AND workspace_id = ? AND id = ?;')
      .get(tenantId, workspaceId, id) as { data: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.data);
  }

  public async listPlaybooks(
    tenantId: string,
    workspaceId: string,
    options?: { planningEligibleOnly?: boolean },
  ): Promise<ProceduralPlaybookProposal[]> {
    this.checkFailure();
    const rows = this.db
      .prepare('SELECT data FROM playbooks WHERE tenant_id = ? AND workspace_id = ?;')
      .all(tenantId, workspaceId) as Array<{ data: string }>;

    const list = rows.map((r) => JSON.parse(r.data) as ProceduralPlaybookProposal);
    if (options?.planningEligibleOnly) {
      return list.filter((p) => isPlaybookPlanningEligible(p));
    }
    return list;
  }

  // -------------------------------------------------------------------------
  // Knowledge Graph Operations (062-SEC-05)
  // -------------------------------------------------------------------------

  public async saveGraphNode(node: MemoryGraphNode): Promise<MemoryGraphNode> {
    this.checkFailure();
    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (
        id, tenant_id, workspace_id, node_type, label, confidence,
        memory_record_id, properties, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, workspace_id, id) DO UPDATE SET
        label = excluded.label,
        confidence = excluded.confidence,
        memory_record_id = excluded.memory_record_id,
        properties = excluded.properties;
    `);

    stmt.run(
      node.id,
      node.tenantId,
      node.workspaceId,
      node.nodeType,
      node.label,
      node.confidence,
      node.memoryRecordId ?? null,
      JSON.stringify(node.properties ?? {}),
      node.createdAt,
    );

    return JSON.parse(JSON.stringify(node));
  }

  public async getGraphNode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphNode | null> {
    this.checkFailure();
    const row = this.db
      .prepare('SELECT * FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND id = ?;')
      .get(tenantId, workspaceId, id) as any;

    if (!row) return null;
    return this.rowToGraphNode(row);
  }

  public async saveGraphEdge(edge: MemoryGraphEdge): Promise<MemoryGraphEdge> {
    this.checkFailure();
    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (
        id, tenant_id, workspace_id, edge_type, source_node_id, target_node_id,
        confidence, weight, properties, provenance, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, workspace_id, id) DO UPDATE SET
        edge_type = excluded.edge_type,
        confidence = excluded.confidence,
        weight = excluded.weight,
        properties = excluded.properties,
        provenance = excluded.provenance;
    `);

    stmt.run(
      edge.id,
      edge.tenantId,
      edge.workspaceId,
      edge.edgeType,
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.confidence,
      edge.weight,
      JSON.stringify(edge.properties ?? {}),
      JSON.stringify(edge.provenance),
      edge.createdAt,
    );

    return JSON.parse(JSON.stringify(edge));
  }

  public async getGraphEdge(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphEdge | null> {
    this.checkFailure();
    const row = this.db
      .prepare('SELECT * FROM graph_edges WHERE tenant_id = ? AND workspace_id = ? AND id = ?;')
      .get(tenantId, workspaceId, id) as any;

    if (!row) return null;
    return this.rowToGraphEdge(row);
  }

  /**
   * Bounded Graph Traversal (062-SEC-05)
   * Hard limits: maxDepth <= 4, limit <= 100
   */
  public async queryGraph(request: MemoryGraphQueryRequest): Promise<MemoryGraphQueryResponse> {
    this.checkFailure();

    const tenantId = request.tenantId;
    const workspaceId = request.workspaceId;
    const startNodeId = request.startNodeId;
    // Strict bounding (062-SEC-05)
    const rawDepth = request.maxDepth ?? 2;
    const maxDepth = Math.max(1, Math.min(4, Number.isFinite(rawDepth) ? rawDepth : 2));
    const rawLimit = request.limit ?? 25;
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 25));
    const minConfidence = request.minConfidence ?? 0.0;
    const allowedNodeTypes = request.nodeTypes ? new Set(request.nodeTypes) : null;
    const allowedEdgeTypes = request.edgeTypes ? new Set(request.edgeTypes) : null;

    // Fetch tenant + workspace scoped nodes and edges from SQLite
    const nodeRows = this.db
      .prepare(
        'SELECT * FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND confidence >= ?;',
      )
      .all(tenantId, workspaceId, minConfidence) as any[];

    const wsNodes = new Map<string, MemoryGraphNode>();
    for (const r of nodeRows) {
      const node = this.rowToGraphNode(r);
      if (!allowedNodeTypes || allowedNodeTypes.has(node.nodeType)) {
        wsNodes.set(node.id, node);
      }
    }

    const edgeRows = this.db
      .prepare(
        'SELECT * FROM graph_edges WHERE tenant_id = ? AND workspace_id = ? AND confidence >= ?;',
      )
      .all(tenantId, workspaceId, minConfidence) as any[];

    const wsEdges: MemoryGraphEdge[] = [];
    for (const r of edgeRows) {
      const edge = this.rowToGraphEdge(r);
      if (!allowedEdgeTypes || allowedEdgeTypes.has(edge.edgeType)) {
        wsEdges.push(edge);
      }
    }

    if (startNodeId) {
      if (!wsNodes.has(startNodeId)) {
        return {
          nodes: [],
          edges: [],
          traversalDepth: 0,
          tenantId,
          workspaceId,
          totalNodes: 0,
          totalEdges: 0,
        };
      }

      const visitedNodes = new Set<string>([startNodeId]);
      const visitedEdgeIds = new Set<string>();
      const resultEdges: MemoryGraphEdge[] = [];
      let currentFrontier = new Set<string>([startNodeId]);
      let currentDepth = 0;

      while (currentFrontier.size > 0 && currentDepth < maxDepth) {
        const nextFrontier = new Set<string>();
        let progressed = false;

        for (const edge of wsEdges) {
          if (visitedEdgeIds.has(edge.id)) continue;

          if (currentFrontier.has(edge.sourceNodeId)) {
            const targetId = edge.targetNodeId;
            if (wsNodes.has(targetId)) {
              visitedEdgeIds.add(edge.id);
              resultEdges.push(edge);
              progressed = true;
              if (!visitedNodes.has(targetId)) {
                visitedNodes.add(targetId);
                nextFrontier.add(targetId);
              }
            }
          } else if (currentFrontier.has(edge.targetNodeId)) {
            const sourceId = edge.sourceNodeId;
            if (wsNodes.has(sourceId)) {
              visitedEdgeIds.add(edge.id);
              resultEdges.push(edge);
              progressed = true;
              if (!visitedNodes.has(sourceId)) {
                visitedNodes.add(sourceId);
                nextFrontier.add(sourceId);
              }
            }
          }
        }

        if (progressed || nextFrontier.size > 0) {
          currentDepth++;
        }
        currentFrontier = nextFrontier;
      }

      const selectedNodes = Array.from(visitedNodes)
        .map((id) => wsNodes.get(id)!)
        .filter(Boolean)
        .slice(0, limit);

      const boundedEdges = resultEdges.slice(0, limit);

      return {
        nodes: selectedNodes,
        edges: boundedEdges,
        traversalDepth: currentDepth,
        tenantId,
        workspaceId,
        totalNodes: selectedNodes.length,
        totalEdges: boundedEdges.length,
      };
    }

    // Default global retrieval bounded by limit
    const nodes = Array.from(wsNodes.values()).slice(0, limit);
    const edges = wsEdges.slice(0, limit);

    return {
      nodes,
      edges,
      traversalDepth: 1,
      tenantId,
      workspaceId,
      totalNodes: nodes.length,
      totalEdges: edges.length,
    };
  }

  public async revokeGraphForMemory(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<{ revokedNodes: number; revokedEdges: number }> {
    this.checkFailure();
    return this.revokeGraphForMemoryInternal(memoryRecordId, tenantId, workspaceId);
  }

  private revokeGraphForMemoryInternal(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): { revokedNodes: number; revokedEdges: number } {
    // Find nodes associated with memory record
    const targetNodes = this.db
      .prepare(
        `SELECT id FROM graph_nodes
         WHERE tenant_id = ? AND workspace_id = ? AND memory_record_id = ?;`,
      )
      .all(tenantId, workspaceId, memoryRecordId) as Array<{ id: string }>;

    const nodeIds = targetNodes.map((n) => n.id);
    let revokedEdges = 0;

    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map(() => '?').join(', ');
      const edgeDel = this.db
        .prepare(
          `DELETE FROM graph_edges
           WHERE tenant_id = ? AND workspace_id = ?
             AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}));`,
        )
        .run(tenantId, workspaceId, ...nodeIds, ...nodeIds);
      revokedEdges = Number(edgeDel.changes);

      const nodeDel = this.db
        .prepare(
          `DELETE FROM graph_nodes
           WHERE tenant_id = ? AND workspace_id = ? AND memory_record_id = ?;`,
        )
        .run(tenantId, workspaceId, memoryRecordId);
      const revokedNodes = Number(nodeDel.changes);

      return { revokedNodes, revokedEdges };
    }

    return { revokedNodes: 0, revokedEdges: 0 };
  }

  public async markDerivedCompressionsTombstoned(
    sourceMemoryId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<number> {
    this.checkFailure();
    return this.markDerivedCompressionsTombstonedInternal(
      sourceMemoryId,
      tenantId,
      workspaceId,
      new Date().toISOString(),
    );
  }

  private markDerivedCompressionsTombstonedInternal(
    sourceMemoryId: string,
    tenantId: string,
    workspaceId: string,
    now: string,
  ): number {
    const rows = this.db
      .prepare(
        `SELECT id, version, provenance, summary, content, class FROM memory_records
         WHERE tenant_id = ? AND workspace_id = ? AND status != 'TOMBSTONED';`,
      )
      .all(tenantId, workspaceId) as any[];

    let updatedCount = 0;
    for (const row of rows) {
      const prov = JSON.parse(row.provenance);
      const isCitedInSourceIds = prov?.sourceId === sourceMemoryId;
      const isCitedInText =
        (row.summary && row.summary.includes(sourceMemoryId)) ||
        (row.content && row.content.includes(sourceMemoryId));

      if (isCitedInSourceIds || (row.class === 'EPISODIC' && isCitedInText)) {
        this.db
          .prepare(
            `UPDATE memory_records
             SET status = ?, tombstoned_at = ?, version = version + 1, updated_at = ?
             WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
          )
          .run(MemoryStatus.TOMBSTONED, now, now, tenantId, workspaceId, row.id);
        updatedCount++;
      }
    }

    return updatedCount;
  }

  // -------------------------------------------------------------------------
  // Vector Embeddings Persistence & Similarity Search
  // -------------------------------------------------------------------------

  public async saveVector(vector: VectorEmbedding): Promise<VectorEmbedding> {
    this.checkFailure();

    // 062-SEC-05: Strict dimension validation
    if (vector.values.length !== this.vectorDimensions) {
      throw new VectorDimensionMismatchError(this.vectorDimensions, vector.values.length);
    }

    const stmt = this.db.prepare(`
      INSERT INTO vector_embeddings (
        id, memory_record_id, tenant_id, workspace_id, values_blob,
        dimensions, normalized, metric, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, workspace_id, memory_record_id) DO UPDATE SET
        id = excluded.id,
        values_blob = excluded.values_blob,
        dimensions = excluded.dimensions,
        normalized = excluded.normalized,
        metric = excluded.metric,
        metadata = excluded.metadata,
        created_at = excluded.created_at;
    `);

    stmt.run(
      vector.id,
      vector.memoryRecordId,
      vector.tenantId,
      vector.workspaceId,
      JSON.stringify(vector.values),
      vector.dimensions,
      vector.normalized ? 1 : 0,
      vector.metric ?? 'COSINE',
      JSON.stringify(vector.metadata ?? {}),
      vector.createdAt,
    );

    // Synchronize to in-process VectorIndex
    const recRow = this.db
      .prepare(
        `SELECT sensitivity, status, class, tags FROM memory_records
         WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
      )
      .get(vector.tenantId, vector.workspaceId, vector.memoryRecordId) as any;

    this.vectorIndex.upsert({
      id: vector.id,
      memoryRecordId: vector.memoryRecordId,
      tenantId: vector.tenantId,
      workspaceId: vector.workspaceId,
      values: vector.values,
      dimensions: vector.dimensions,
      normalized: vector.normalized,
      metric: vector.metric,
      sensitivity: recRow?.sensitivity,
      status: recRow?.status ?? MemoryStatus.ACTIVE,
      classes: recRow?.class ? [recRow.class] : undefined,
      tags: recRow?.tags ? JSON.parse(recRow.tags) : undefined,
      metadata: vector.metadata,
      createdAt: vector.createdAt,
    });

    return JSON.parse(JSON.stringify(vector));
  }

  public async getVector(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<VectorEmbedding | null> {
    this.checkFailure();
    const row = this.db
      .prepare(
        `SELECT * FROM vector_embeddings
         WHERE tenant_id = ? AND workspace_id = ? AND memory_record_id = ?;`,
      )
      .get(tenantId, workspaceId, memoryRecordId) as any;

    if (!row) return null;

    return {
      id: row.id,
      memoryRecordId: row.memory_record_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      values: JSON.parse(row.values_blob),
      dimensions: row.dimensions,
      normalized: Boolean(row.normalized),
      metric: row.metric,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
    };
  }

  public async deleteVector(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.checkFailure();
    const del = this.db
      .prepare(
        `DELETE FROM vector_embeddings
         WHERE tenant_id = ? AND workspace_id = ? AND memory_record_id = ?;`,
      )
      .run(tenantId, workspaceId, memoryRecordId);

    this.vectorIndex.delete(memoryRecordId, tenantId, workspaceId);
    return Number(del.changes) > 0;
  }

  public async searchVectors(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    this.checkFailure();
    return this.vectorIndex.search(request);
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }

  public clear(): void {
    this.db.exec(`
      DELETE FROM memory_records;
      DELETE FROM memory_proposals;
      DELETE FROM episodes;
      DELETE FROM playbooks;
      DELETE FROM graph_nodes;
      DELETE FROM graph_edges;
      DELETE FROM vector_embeddings;
    `);
    this.vectorIndex.clear();
  }

  // -------------------------------------------------------------------------
  // Helper deserializers
  // -------------------------------------------------------------------------

  private rowToMemoryRecord(row: any): MemoryRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      ownerId: row.owner_id,
      class: row.class,
      status: row.status,
      sensitivity: row.sensitivity,
      title: row.title ?? undefined,
      content: row.content,
      summary: row.summary ?? undefined,
      confidence: row.confidence,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      provenance: JSON.parse(row.provenance),
      retentionPolicy: row.retention_policy ? JSON.parse(row.retention_policy) : undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tombstonedAt: row.tombstoned_at ?? undefined,
    };
  }

  private rowToProposal(row: any): MemoryProposal {
    return {
      proposalId: row.proposal_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      ownerId: row.owner_id,
      class: row.class,
      content: row.content,
      title: row.title ?? undefined,
      confidence: row.confidence,
      sensitivity: row.sensitivity,
      provenance: JSON.parse(row.provenance),
      suggestedTtlSeconds: row.suggested_ttl_seconds ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
      resolvedBy: row.resolved_by ?? undefined,
      reason: row.reason ?? undefined,
    };
  }

  private rowToGraphNode(row: any): MemoryGraphNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      nodeType: row.node_type,
      label: row.label,
      confidence: row.confidence,
      memoryRecordId: row.memory_record_id ?? undefined,
      properties: JSON.parse(row.properties || '{}'),
      createdAt: row.created_at,
    };
  }

  private rowToGraphEdge(row: any): MemoryGraphEdge {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      edgeType: row.edge_type,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      confidence: row.confidence,
      weight: row.weight,
      properties: JSON.parse(row.properties || '{}'),
      provenance: JSON.parse(row.provenance || '{}'),
      createdAt: row.created_at,
    };
  }

  private isExpired(record: MemoryRecord, nowMs: number = Date.now()): boolean {
    if (!record.retentionPolicy) {
      return false;
    }
    if (record.retentionPolicy.expiresAt) {
      const exp = new Date(record.retentionPolicy.expiresAt).getTime();
      if (!Number.isNaN(exp) && exp <= nowMs) {
        return true;
      }
    }
    if (record.retentionPolicy.ttlSeconds) {
      const createdMs = new Date(record.createdAt).getTime();
      const expiresAtMs = createdMs + record.retentionPolicy.ttlSeconds * 1000;
      if (expiresAtMs <= nowMs) {
        return true;
      }
    }
    return false;
  }
}
