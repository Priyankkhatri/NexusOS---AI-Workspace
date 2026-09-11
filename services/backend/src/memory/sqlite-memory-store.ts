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
  MemoryGraphNodeInput,
  MemoryGraphNodeOutput,
  MemoryGraphNodeSchema,
  MemoryGraphEdgeInput,
  MemoryGraphEdgeOutput,
  MemoryGraphEdgeSchema,
  MemoryGraphQueryRequest,
  MemoryGraphQueryResponse,
  isPlaybookPlanningEligible,
  VectorEmbedding,
  VectorSearchRequest,
  VectorSearchResponse,
  MemoryProvenanceOutput,
  MemorySourceType,
  DEFAULT_VECTOR_DIMENSION,
  GraphEvolutionPlan,
  EvolutionReceipt,
  GraphEvolutionOperationType,
  EvolutionDeliveryStatus,
  EvolutionOutboxRecord,
  EvolutionOutboxRecordInput,
  EvolutionOutboxRecordSchema,
  EvolutionOutboxRecordInputSchema,
  OUTBOX_MAX_ATTEMPTS_DEFAULT,
  OUTBOX_PROCESSING_LEASE_TIMEOUT_MS,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  MemoryNotFoundError,
  MemoryVersionConflictError,
  MemorySecurityViolationError,
  MemoryServiceContext,
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
  public simulateFailureInEvolution = false;
  public simulateFailureInEvolutionMidway = false;

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

    const getVersion = (): number => {
      const row = this.db.prepare('SELECT MAX(version) as max_v FROM schema_migrations;').get() as {
        max_v: number | null;
      };
      return row?.max_v ?? 0;
    };

    let currentVersion = getVersion();

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
      currentVersion = getVersion();
    }

    if (currentVersion < 2) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(`
          -- Additive columns for graph_nodes (066-P1-SEC-03, 066-P1-SEC-05)
          ALTER TABLE graph_nodes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE graph_nodes ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE graph_nodes ADD COLUMN valid_from TEXT;
          ALTER TABLE graph_nodes ADD COLUMN valid_to TEXT;
          ALTER TABLE graph_nodes ADD COLUMN superseded_by TEXT;
          ALTER TABLE graph_nodes ADD COLUMN provenance TEXT NOT NULL DEFAULT '{}';
          ALTER TABLE graph_nodes ADD COLUMN updated_at TEXT;

          UPDATE graph_nodes SET valid_from = created_at WHERE valid_from IS NULL;
          UPDATE graph_nodes SET updated_at = created_at WHERE updated_at IS NULL;

          CREATE INDEX IF NOT EXISTS idx_graph_nodes_current
            ON graph_nodes (tenant_id, workspace_id, is_current);

          -- Additive columns for graph_edges (066-P1-SEC-03, 066-P1-SEC-05)
          ALTER TABLE graph_edges ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE graph_edges ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE graph_edges ADD COLUMN valid_from TEXT;
          ALTER TABLE graph_edges ADD COLUMN valid_to TEXT;
          ALTER TABLE graph_edges ADD COLUMN superseded_by TEXT;
          ALTER TABLE graph_edges ADD COLUMN updated_at TEXT;

          UPDATE graph_edges SET valid_from = created_at WHERE valid_from IS NULL;
          UPDATE graph_edges SET updated_at = created_at WHERE updated_at IS NULL;

          CREATE INDEX IF NOT EXISTS idx_graph_edges_current
            ON graph_edges (tenant_id, workspace_id, is_current);

          INSERT INTO schema_migrations (version, applied_at, description)
          VALUES (2, datetime('now'), 'Task 066 Graph Evolution Temporal & Versioned Foundation');
        `);
        this.db.exec('COMMIT;');
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }
      currentVersion = getVersion();
    }

    if (currentVersion < 3) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(`
          -- Additive columns for graph_nodes and graph_edges (066-P3-R-04 Monotonic Version Fencing)
          ALTER TABLE graph_nodes ADD COLUMN last_memory_version INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE graph_edges ADD COLUMN last_memory_version INTEGER NOT NULL DEFAULT 1;

          -- Memory Evolution Outbox Table (066-P3-R-01 Durable Transactional Outbox)
          CREATE TABLE IF NOT EXISTS memory_evolution_outbox (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            memory_record_id TEXT NOT NULL,
            memory_version INTEGER NOT NULL,
            candidate_set_hash TEXT NOT NULL,
            evolution_payload TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            next_attempt_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            processed_at TEXT,
            last_error TEXT,
            PRIMARY KEY (tenant_id, workspace_id, id)
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedup
            ON memory_evolution_outbox (tenant_id, workspace_id, id);

          CREATE INDEX IF NOT EXISTS idx_outbox_status_next
            ON memory_evolution_outbox (status, next_attempt_at);

          CREATE INDEX IF NOT EXISTS idx_outbox_scope
            ON memory_evolution_outbox (tenant_id, workspace_id, status);

          CREATE INDEX IF NOT EXISTS idx_outbox_mem_ver
            ON memory_evolution_outbox (tenant_id, workspace_id, memory_record_id, memory_version);

          INSERT INTO schema_migrations (version, applied_at, description)
          VALUES (3, datetime('now'), 'Task 066 Phase 3 Durable Outbox & Version Fencing');
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

  public async create(
    record: MemoryRecord,
    outboxItem?: EvolutionOutboxRecordInput,
  ): Promise<MemoryRecord> {
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

    this.db.exec('BEGIN IMMEDIATE;');
    try {
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

      if (outboxItem) {
        const validatedOutbox = EvolutionOutboxRecordInputSchema.parse(outboxItem);
        const outboxStmt = this.db.prepare(`
          INSERT INTO memory_evolution_outbox (
            id, tenant_id, workspace_id, memory_record_id, memory_version,
            candidate_set_hash, evolution_payload, status, attempt_count,
            max_attempts, next_attempt_at, created_at, updated_at, processed_at, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, workspace_id, id) DO NOTHING;
        `);

        outboxStmt.run(
          validatedOutbox.id,
          validatedOutbox.tenantId,
          validatedOutbox.workspaceId,
          validatedOutbox.memoryRecordId,
          validatedOutbox.memoryVersion,
          validatedOutbox.candidateSetHash,
          JSON.stringify(validatedOutbox.evolutionPayload ?? {}),
          validatedOutbox.status ?? EvolutionDeliveryStatus.PENDING,
          validatedOutbox.attemptCount ?? 0,
          validatedOutbox.maxAttempts ?? OUTBOX_MAX_ATTEMPTS_DEFAULT,
          validatedOutbox.nextAttemptAt ?? null,
          validatedOutbox.createdAt,
          validatedOutbox.updatedAt ?? validatedOutbox.createdAt,
          validatedOutbox.processedAt ?? null,
          validatedOutbox.lastError ?? null,
        );
      }

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore rollback errors if already rolled back
      }
      throw err;
    }

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
    outboxItem?: EvolutionOutboxRecordInput,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
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

      if (outboxItem) {
        const validatedOutbox = EvolutionOutboxRecordInputSchema.parse(outboxItem);
        const outboxStmt = this.db.prepare(`
          INSERT INTO memory_evolution_outbox (
            id, tenant_id, workspace_id, memory_record_id, memory_version,
            candidate_set_hash, evolution_payload, status, attempt_count,
            max_attempts, next_attempt_at, created_at, updated_at, processed_at, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, workspace_id, id) DO NOTHING;
        `);

        outboxStmt.run(
          validatedOutbox.id,
          validatedOutbox.tenantId,
          validatedOutbox.workspaceId,
          validatedOutbox.memoryRecordId,
          validatedOutbox.memoryVersion,
          validatedOutbox.candidateSetHash,
          JSON.stringify(validatedOutbox.evolutionPayload ?? {}),
          validatedOutbox.status ?? EvolutionDeliveryStatus.PENDING,
          validatedOutbox.attemptCount ?? 0,
          validatedOutbox.maxAttempts ?? OUTBOX_MAX_ATTEMPTS_DEFAULT,
          validatedOutbox.nextAttemptAt ?? null,
          validatedOutbox.createdAt,
          validatedOutbox.updatedAt ?? validatedOutbox.createdAt,
          validatedOutbox.processedAt ?? null,
          validatedOutbox.lastError ?? null,
        );
      }

      this.db.exec('COMMIT;');
      return updated;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }
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
  // Knowledge Graph Operations (062-SEC-05, 066-P1-SEC-02, 066-P1-SEC-03)
  // -------------------------------------------------------------------------

  public async saveGraphNode(
    node: MemoryGraphNodeInput,
    options?: { expectedVersion?: number },
  ): Promise<MemoryGraphNodeOutput> {
    this.checkFailure();
    const validated = MemoryGraphNodeSchema.parse(node);

    const existing = await this.getGraphNode(
      validated.id,
      validated.tenantId,
      validated.workspaceId,
    );

    if (existing) {
      const currentVersion = existing.version;

      // 066-P1-SEC-02: Optimistic Locking check
      if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, options.expectedVersion);
      }

      // 066-P1-SEC-02: Monotonicity check: cannot roll version backwards
      if (node.version !== undefined && node.version < currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, node.version);
      }

      // 066-P1-SEC-02: Compute next monotonic version
      let nextVersion = currentVersion + 1;
      if (node.version !== undefined && node.version > currentVersion) {
        nextVersion = node.version;
      }

      const validFrom = validated.validFrom ?? existing.validFrom ?? existing.createdAt;
      const updatedAt = validated.updatedAt ?? new Date().toISOString();

      const stmt = this.db.prepare(`
        UPDATE graph_nodes SET
          node_type = ?,
          label = ?,
          confidence = ?,
          memory_record_id = ?,
          properties = ?,
          provenance = ?,
          version = ?,
          is_current = ?,
          valid_from = ?,
          valid_to = ?,
          superseded_by = ?,
          updated_at = ?,
          last_memory_version = ?
        WHERE tenant_id = ? AND workspace_id = ? AND id = ? AND version = ?;
      `);

      const result = stmt.run(
        validated.nodeType,
        validated.label,
        validated.confidence,
        validated.memoryRecordId ?? null,
        JSON.stringify(validated.properties ?? {}),
        validated.provenance ? JSON.stringify(validated.provenance) : '{}',
        nextVersion,
        validated.isCurrent ? 1 : 0,
        validFrom,
        validated.validTo ?? null,
        validated.supersededBy ?? null,
        updatedAt,
        validated.lastMemoryVersion ?? existing.lastMemoryVersion ?? 1,
        validated.tenantId,
        validated.workspaceId,
        validated.id,
        currentVersion,
      );

      if (result.changes === 0) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, currentVersion);
      }

      const updatedNode: MemoryGraphNodeOutput = {
        ...validated,
        validFrom,
        version: nextVersion,
        lastMemoryVersion: validated.lastMemoryVersion ?? existing.lastMemoryVersion ?? 1,
        updatedAt,
      };
      return updatedNode;
    } else {
      if (
        options?.expectedVersion !== undefined &&
        options.expectedVersion !== 0 &&
        options.expectedVersion !== 1
      ) {
        throw new MemoryVersionConflictError(validated.id, 0, options.expectedVersion);
      }

      const initialVersion = node.version ?? 1;
      const validFrom = validated.validFrom ?? validated.createdAt;
      const updatedAt = validated.updatedAt ?? validated.createdAt;
      const lastMemoryVersion = validated.lastMemoryVersion ?? 1;

      const stmt = this.db.prepare(`
        INSERT INTO graph_nodes (
          id, tenant_id, workspace_id, node_type, label, confidence,
          memory_record_id, properties, provenance, version, is_current,
          valid_from, valid_to, superseded_by, created_at, updated_at,
          last_memory_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      stmt.run(
        validated.id,
        validated.tenantId,
        validated.workspaceId,
        validated.nodeType,
        validated.label,
        validated.confidence,
        validated.memoryRecordId ?? null,
        JSON.stringify(validated.properties ?? {}),
        validated.provenance ? JSON.stringify(validated.provenance) : '{}',
        initialVersion,
        validated.isCurrent ? 1 : 0,
        validFrom,
        validated.validTo ?? null,
        validated.supersededBy ?? null,
        validated.createdAt,
        updatedAt,
        lastMemoryVersion,
      );

      const createdNode: MemoryGraphNodeOutput = {
        ...validated,
        validFrom,
        version: initialVersion,
        lastMemoryVersion,
        updatedAt,
      };
      return createdNode;
    }
  }

  public async getGraphNode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphNodeOutput | null> {
    this.checkFailure();
    const row = this.db
      .prepare('SELECT * FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND id = ?;')
      .get(tenantId, workspaceId, id) as any;

    if (!row) return null;
    return this.rowToGraphNode(row);
  }

  public async saveGraphEdge(
    edge: MemoryGraphEdgeInput,
    options?: { expectedVersion?: number },
  ): Promise<MemoryGraphEdgeOutput> {
    this.checkFailure();
    const validated = MemoryGraphEdgeSchema.parse(edge);

    const existing = await this.getGraphEdge(
      validated.id,
      validated.tenantId,
      validated.workspaceId,
    );

    if (existing) {
      const currentVersion = existing.version;

      // 066-P1-SEC-02: Optimistic Locking check
      if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, options.expectedVersion);
      }

      // 066-P1-SEC-02: Monotonicity check: cannot roll version backwards
      if (edge.version !== undefined && edge.version < currentVersion) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, edge.version);
      }

      // 066-P1-SEC-02: Compute next monotonic version
      let nextVersion = currentVersion + 1;
      if (edge.version !== undefined && edge.version > currentVersion) {
        nextVersion = edge.version;
      }

      const validFrom = validated.validFrom ?? existing.validFrom ?? existing.createdAt;
      const updatedAt = validated.updatedAt ?? new Date().toISOString();

      const stmt = this.db.prepare(`
        UPDATE graph_edges SET
          edge_type = ?,
          source_node_id = ?,
          target_node_id = ?,
          confidence = ?,
          weight = ?,
          properties = ?,
          provenance = ?,
          version = ?,
          is_current = ?,
          valid_from = ?,
          valid_to = ?,
          superseded_by = ?,
          updated_at = ?,
          last_memory_version = ?
        WHERE tenant_id = ? AND workspace_id = ? AND id = ? AND version = ?;
      `);

      const result = stmt.run(
        validated.edgeType,
        validated.sourceNodeId,
        validated.targetNodeId,
        validated.confidence,
        validated.weight,
        JSON.stringify(validated.properties ?? {}),
        JSON.stringify(validated.provenance),
        nextVersion,
        validated.isCurrent ? 1 : 0,
        validFrom,
        validated.validTo ?? null,
        validated.supersededBy ?? null,
        updatedAt,
        validated.lastMemoryVersion ?? existing.lastMemoryVersion ?? 1,
        validated.tenantId,
        validated.workspaceId,
        validated.id,
        currentVersion,
      );

      if (result.changes === 0) {
        throw new MemoryVersionConflictError(validated.id, currentVersion, currentVersion);
      }

      const updatedEdge: MemoryGraphEdgeOutput = {
        ...validated,
        validFrom,
        version: nextVersion,
        lastMemoryVersion: validated.lastMemoryVersion ?? existing.lastMemoryVersion ?? 1,
        updatedAt,
      };
      return updatedEdge;
    } else {
      if (
        options?.expectedVersion !== undefined &&
        options.expectedVersion !== 0 &&
        options.expectedVersion !== 1
      ) {
        throw new MemoryVersionConflictError(validated.id, 0, options.expectedVersion);
      }

      const initialVersion = edge.version ?? 1;
      const validFrom = validated.validFrom ?? validated.createdAt;
      const updatedAt = validated.updatedAt ?? validated.createdAt;
      const lastMemoryVersion = validated.lastMemoryVersion ?? 1;

      const stmt = this.db.prepare(`
        INSERT INTO graph_edges (
          id, tenant_id, workspace_id, edge_type, source_node_id, target_node_id,
          confidence, weight, properties, provenance, version, is_current,
          valid_from, valid_to, superseded_by, created_at, updated_at,
          last_memory_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      stmt.run(
        validated.id,
        validated.tenantId,
        validated.workspaceId,
        validated.edgeType,
        validated.sourceNodeId,
        validated.targetNodeId,
        validated.confidence,
        validated.weight,
        JSON.stringify(validated.properties ?? {}),
        JSON.stringify(validated.provenance),
        initialVersion,
        validated.isCurrent ? 1 : 0,
        validFrom,
        validated.validTo ?? null,
        validated.supersededBy ?? null,
        validated.createdAt,
        updatedAt,
        lastMemoryVersion,
      );

      const createdEdge: MemoryGraphEdgeOutput = {
        ...validated,
        validFrom,
        version: initialVersion,
        lastMemoryVersion,
        updatedAt,
      };
      return createdEdge;
    }
  }

  public async getGraphEdge(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphEdgeOutput | null> {
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
    const asOfTime = request.asOf ? new Date(request.asOf).getTime() : null;
    const includeSuperseded = request.includeSuperseded ?? false;

    // Fetch tenant + workspace scoped nodes and edges from SQLite
    const nodeRows = this.db
      .prepare(
        'SELECT * FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND confidence >= ?;',
      )
      .all(tenantId, workspaceId, minConfidence) as any[];

    const wsNodes = new Map<string, MemoryGraphNodeOutput>();
    for (const r of nodeRows) {
      const node = this.rowToGraphNode(r);
      let isVisible = true;
      if (asOfTime !== null) {
        const from = new Date(node.validFrom ?? node.createdAt).getTime();
        const to = node.validTo ? new Date(node.validTo).getTime() : Infinity;
        isVisible = from <= asOfTime && asOfTime < to;
      } else if (!includeSuperseded) {
        isVisible = Boolean(node.isCurrent);
      }

      if (isVisible && (!allowedNodeTypes || allowedNodeTypes.has(node.nodeType))) {
        wsNodes.set(node.id, node);
      }
    }

    const edgeRows = this.db
      .prepare(
        'SELECT * FROM graph_edges WHERE tenant_id = ? AND workspace_id = ? AND confidence >= ?;',
      )
      .all(tenantId, workspaceId, minConfidence) as any[];

    const wsEdges: MemoryGraphEdgeOutput[] = [];
    for (const r of edgeRows) {
      const edge = this.rowToGraphEdge(r);
      let isVisible = true;
      if (asOfTime !== null) {
        const from = new Date(edge.validFrom ?? edge.createdAt).getTime();
        const to = edge.validTo ? new Date(edge.validTo).getTime() : Infinity;
        isVisible = from <= asOfTime && asOfTime < to;
      } else if (!includeSuperseded) {
        isVisible = Boolean(edge.isCurrent);
      }

      if (isVisible && (!allowedEdgeTypes || allowedEdgeTypes.has(edge.edgeType))) {
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
      const resultEdges: MemoryGraphEdgeOutput[] = [];
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

      // Also clean up any edges whose provenance directly cites this memory record
      const provEdgeDel = this.db
        .prepare(
          `DELETE FROM graph_edges
           WHERE tenant_id = ? AND workspace_id = ?
             AND json_extract(provenance, '$.sourceId') = ?;`,
        )
        .run(tenantId, workspaceId, memoryRecordId);
      revokedEdges += Number(provEdgeDel.changes);

      return { revokedNodes, revokedEdges };
    } else {
      // Even if no nodes were directly owned, clean up edges citing this memory record
      const provEdgeDel = this.db
        .prepare(
          `DELETE FROM graph_edges
           WHERE tenant_id = ? AND workspace_id = ?
             AND json_extract(provenance, '$.sourceId') = ?;`,
        )
        .run(tenantId, workspaceId, memoryRecordId);
      return { revokedNodes: 0, revokedEdges: Number(provEdgeDel.changes) };
    }
  }

  // -------------------------------------------------------------------------
  // Governed Graph Evolution Batch Operation (Task 066 Phase 3)
  // -------------------------------------------------------------------------

  public async evolveGraph(
    plan: GraphEvolutionPlan,
    ctx?: MemoryServiceContext,
  ): Promise<EvolutionReceipt> {
    this.checkFailure();
    const startTime = performance.now();

    if (ctx) {
      if (ctx.tenantId !== plan.tenantId || ctx.workspaceId !== plan.workspaceId) {
        throw new MemorySecurityViolationError(
          `066-P3-SEC-02: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot evolve graph in (${plan.tenantId}/${plan.workspaceId}).`,
        );
      }
    }

    if (this.simulateFailureInEvolution) {
      throw new Error(
        '066-P3-SEC-07-SIMULATED-FAIL: Injected evolution failure before transaction',
      );
    }

    if (plan.operations.length === 0) {
      return {
        evolutionId: plan.evolutionId,
        tenantId: plan.tenantId,
        workspaceId: plan.workspaceId,
        memoryRecordId: plan.memoryRecordId,
        memoryVersion: plan.memoryVersion,
        acceptedNodes: [],
        acceptedEdges: [],
        supersededNodeIds: [],
        supersededEdgeIds: [],
        rejectedNodes: [],
        rejectedEdges: [],
        evolvedAt: new Date().toISOString(),
        executionDurationMs: Math.round(performance.now() - startTime),
        idempotentSkip: true,
      };
    }

    const acceptedNodes: string[] = [];
    const acceptedEdges: string[] = [];
    const supersededNodeIds: string[] = [];
    const supersededEdgeIds: string[] = [];

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const op of plan.operations) {
        if (op.operationType === GraphEvolutionOperationType.ADD_NODE) {
          if (!op.node) {
            throw new Error('ADD_NODE operation requires node payload');
          }
          const node = MemoryGraphNodeSchema.parse(op.node);
          if (node.tenantId !== plan.tenantId || node.workspaceId !== plan.workspaceId) {
            throw new MemorySecurityViolationError(
              `066-P3-SEC-02: Node tenant/workspace mismatch in evolution plan`,
            );
          }

          const existing = this.db
            .prepare(
              'SELECT id, version FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND id = ?;',
            )
            .get(node.tenantId, node.workspaceId, node.id) as
            | { id: string; version: number }
            | undefined;

          if (!existing) {
            const initialVersion = node.version ?? 1;
            const validFrom = node.validFrom ?? node.createdAt;
            const updatedAt = node.updatedAt ?? node.createdAt;
            const lastMemoryVersion = node.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            this.db
              .prepare(
                `
              INSERT INTO graph_nodes (
                id, tenant_id, workspace_id, node_type, label, confidence,
                memory_record_id, properties, provenance, version, is_current,
                valid_from, valid_to, superseded_by, created_at, updated_at,
                last_memory_version
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `,
              )
              .run(
                node.id,
                node.tenantId,
                node.workspaceId,
                node.nodeType,
                node.label,
                node.confidence,
                node.memoryRecordId ?? null,
                JSON.stringify(node.properties ?? {}),
                node.provenance ? JSON.stringify(node.provenance) : '{}',
                initialVersion,
                node.isCurrent ? 1 : 0,
                validFrom,
                node.validTo ?? null,
                node.supersededBy ?? null,
                node.createdAt,
                updatedAt,
                lastMemoryVersion,
              );
          }
          acceptedNodes.push(node.id);
        } else if (op.operationType === GraphEvolutionOperationType.REFINE_NODE) {
          if (!op.node) {
            throw new Error('REFINE_NODE operation requires node payload');
          }
          const node = MemoryGraphNodeSchema.parse(op.node);
          const existing = this.db
            .prepare(
              'SELECT version, is_current FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND id = ?;',
            )
            .get(node.tenantId, node.workspaceId, node.id) as
            | { version: number; is_current: number }
            | undefined;

          if (!existing) {
            throw new MemoryNotFoundError(node.id);
          }

          const currentVersion = existing.version;
          if (op.expectedVersion !== undefined && op.expectedVersion !== currentVersion) {
            throw new MemoryVersionConflictError(node.id, currentVersion, op.expectedVersion);
          }

          const nextVersion = currentVersion + 1;
          const updatedAt = node.updatedAt ?? new Date().toISOString();
          const lastMemoryVersion = node.lastMemoryVersion ?? plan.memoryVersion ?? 1;

          const updateStmt = this.db.prepare(`
            UPDATE graph_nodes SET
              label = ?,
              confidence = ?,
              properties = ?,
              provenance = ?,
              version = ?,
              updated_at = ?,
              last_memory_version = ?
            WHERE tenant_id = ? AND workspace_id = ? AND id = ? AND version = ?;
          `);

          const result = updateStmt.run(
            node.label,
            node.confidence,
            JSON.stringify(node.properties ?? {}),
            node.provenance ? JSON.stringify(node.provenance) : '{}',
            nextVersion,
            updatedAt,
            lastMemoryVersion,
            node.tenantId,
            node.workspaceId,
            node.id,
            currentVersion,
          );

          if (result.changes === 0) {
            throw new MemoryVersionConflictError(node.id, currentVersion, currentVersion);
          }
          acceptedNodes.push(node.id);
        } else if (op.operationType === GraphEvolutionOperationType.SUPERSEDE_NODE) {
          const targetId = op.targetId;
          if (!targetId) {
            throw new Error('SUPERSEDE_NODE operation requires targetId');
          }

          const existing = this.db
            .prepare(
              'SELECT version, is_current FROM graph_nodes WHERE tenant_id = ? AND workspace_id = ? AND id = ?;',
            )
            .get(plan.tenantId, plan.workspaceId, targetId) as
            | { version: number; is_current: number }
            | undefined;

          if (!existing) {
            throw new MemoryNotFoundError(targetId);
          }

          const currentVersion = existing.version;
          if (op.expectedVersion !== undefined && op.expectedVersion !== currentVersion) {
            throw new MemoryVersionConflictError(targetId, currentVersion, op.expectedVersion);
          }

          const validTo = op.validTo ?? new Date().toISOString();
          const supersededBy = op.supersededBy ?? op.node?.id ?? null;
          const nextVersion = currentVersion + 1;
          const lastMemoryVersion = plan.memoryVersion ?? 1;

          const updateStmt = this.db.prepare(`
            UPDATE graph_nodes SET
              is_current = 0,
              valid_to = ?,
              superseded_by = ?,
              version = ?,
              updated_at = ?,
              last_memory_version = ?
            WHERE tenant_id = ? AND workspace_id = ? AND id = ? AND version = ?;
          `);

          const result = updateStmt.run(
            validTo,
            supersededBy,
            nextVersion,
            validTo,
            lastMemoryVersion,
            plan.tenantId,
            plan.workspaceId,
            targetId,
            currentVersion,
          );

          if (result.changes === 0) {
            throw new MemoryVersionConflictError(targetId, currentVersion, currentVersion);
          }
          supersededNodeIds.push(targetId);

          if (op.node) {
            const newNode = MemoryGraphNodeSchema.parse(op.node);
            const initialVersion = newNode.version ?? 1;
            const validFrom = newNode.validFrom ?? validTo;
            const updatedAt = newNode.updatedAt ?? validTo;
            const newNodeLastMemoryVersion = newNode.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            this.db
              .prepare(
                `
              INSERT INTO graph_nodes (
                id, tenant_id, workspace_id, node_type, label, confidence,
                memory_record_id, properties, provenance, version, is_current,
                valid_from, valid_to, superseded_by, created_at, updated_at,
                last_memory_version
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `,
              )
              .run(
                newNode.id,
                newNode.tenantId,
                newNode.workspaceId,
                newNode.nodeType,
                newNode.label,
                newNode.confidence,
                newNode.memoryRecordId ?? null,
                JSON.stringify(newNode.properties ?? {}),
                newNode.provenance ? JSON.stringify(newNode.provenance) : '{}',
                initialVersion,
                1,
                validFrom,
                null,
                null,
                newNode.createdAt,
                updatedAt,
                newNodeLastMemoryVersion,
              );
            acceptedNodes.push(newNode.id);
          }
        } else if (op.operationType === GraphEvolutionOperationType.ADD_EDGE) {
          if (!op.edge) {
            throw new Error('ADD_EDGE operation requires edge payload');
          }
          const edge = MemoryGraphEdgeSchema.parse(op.edge);
          if (edge.tenantId !== plan.tenantId || edge.workspaceId !== plan.workspaceId) {
            throw new MemorySecurityViolationError(
              `066-P3-SEC-02: Edge tenant/workspace mismatch in evolution plan`,
            );
          }

          const existing = this.db
            .prepare(
              'SELECT id FROM graph_edges WHERE tenant_id = ? AND workspace_id = ? AND id = ?;',
            )
            .get(edge.tenantId, edge.workspaceId, edge.id);

          if (!existing) {
            const initialVersion = edge.version ?? 1;
            const validFrom = edge.validFrom ?? edge.createdAt;
            const updatedAt = edge.updatedAt ?? edge.createdAt;
            const lastMemoryVersion = edge.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            this.db
              .prepare(
                `
              INSERT INTO graph_edges (
                id, tenant_id, workspace_id, edge_type, source_node_id, target_node_id,
                confidence, weight, properties, provenance, version, is_current,
                valid_from, valid_to, superseded_by, created_at, updated_at,
                last_memory_version
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `,
              )
              .run(
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
                initialVersion,
                edge.isCurrent ? 1 : 0,
                validFrom,
                edge.validTo ?? null,
                edge.supersededBy ?? null,
                edge.createdAt,
                updatedAt,
                lastMemoryVersion,
              );
          }
          acceptedEdges.push(edge.id);
        } else if (op.operationType === GraphEvolutionOperationType.SUPERSEDE_EDGE) {
          const targetId = op.targetId;
          if (!targetId) {
            throw new Error('SUPERSEDE_EDGE operation requires targetId');
          }

          const existing = this.db
            .prepare(
              'SELECT version FROM graph_edges WHERE tenant_id = ? AND workspace_id = ? AND id = ?;',
            )
            .get(plan.tenantId, plan.workspaceId, targetId) as { version: number } | undefined;

          if (!existing) {
            throw new MemoryNotFoundError(targetId);
          }

          const currentVersion = existing.version;
          if (op.expectedVersion !== undefined && op.expectedVersion !== currentVersion) {
            throw new MemoryVersionConflictError(targetId, currentVersion, op.expectedVersion);
          }

          const validTo = op.validTo ?? new Date().toISOString();
          const supersededBy = op.supersededBy ?? op.edge?.id ?? null;
          const nextVersion = currentVersion + 1;
          const lastMemoryVersion = plan.memoryVersion ?? 1;

          const updateStmt = this.db.prepare(`
            UPDATE graph_edges SET
              is_current = 0,
              valid_to = ?,
              superseded_by = ?,
              version = ?,
              updated_at = ?,
              last_memory_version = ?
            WHERE tenant_id = ? AND workspace_id = ? AND id = ? AND version = ?;
          `);

          const result = updateStmt.run(
            validTo,
            supersededBy,
            nextVersion,
            validTo,
            lastMemoryVersion,
            plan.tenantId,
            plan.workspaceId,
            targetId,
            currentVersion,
          );

          if (result.changes === 0) {
            throw new MemoryVersionConflictError(targetId, currentVersion, currentVersion);
          }
          supersededEdgeIds.push(targetId);

          if (op.edge) {
            const newEdge = MemoryGraphEdgeSchema.parse(op.edge);
            const initialVersion = newEdge.version ?? 1;
            const validFrom = newEdge.validFrom ?? validTo;
            const updatedAt = newEdge.updatedAt ?? validTo;
            const newEdgeLastMemoryVersion = newEdge.lastMemoryVersion ?? plan.memoryVersion ?? 1;

            this.db
              .prepare(
                `
              INSERT INTO graph_edges (
                id, tenant_id, workspace_id, edge_type, source_node_id, target_node_id,
                confidence, weight, properties, provenance, version, is_current,
                valid_from, valid_to, superseded_by, created_at, updated_at,
                last_memory_version
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `,
              )
              .run(
                newEdge.id,
                newEdge.tenantId,
                newEdge.workspaceId,
                newEdge.edgeType,
                newEdge.sourceNodeId,
                newEdge.targetNodeId,
                newEdge.confidence,
                newEdge.weight,
                JSON.stringify(newEdge.properties ?? {}),
                JSON.stringify(newEdge.provenance),
                initialVersion,
                1,
                validFrom,
                null,
                null,
                newEdge.createdAt,
                updatedAt,
                newEdgeLastMemoryVersion,
              );
            acceptedEdges.push(newEdge.id);
          }
        }

        if (this.simulateFailureInEvolutionMidway) {
          throw new Error('066-P3-SEC-07-SIMULATED-FAIL: Injected mid-batch evolution failure');
        }
      }

      this.db.exec('COMMIT;');

      return {
        evolutionId: plan.evolutionId,
        tenantId: plan.tenantId,
        workspaceId: plan.workspaceId,
        memoryRecordId: plan.memoryRecordId,
        memoryVersion: plan.memoryVersion,
        acceptedNodes,
        acceptedEdges,
        supersededNodeIds,
        supersededEdgeIds,
        rejectedNodes: [],
        rejectedEdges: [],
        evolvedAt: new Date().toISOString(),
        executionDurationMs: Math.round(performance.now() - startTime),
        idempotentSkip: false,
      };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore rollback errors if already rolled back
      }
      throw err;
    }
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

  // -------------------------------------------------------------------------
  // Durable Outbox Operations (066-P3-R-01, 066-P3-R-02, 066-P3-R-05)
  // -------------------------------------------------------------------------

  public async createOutboxRecord(
    record: EvolutionOutboxRecordInput,
  ): Promise<EvolutionOutboxRecord> {
    this.checkFailure();
    const validated = EvolutionOutboxRecordInputSchema.parse(record);
    const now = new Date().toISOString();
    const createdAt = validated.createdAt ?? now;
    const updatedAt = validated.updatedAt ?? createdAt;

    const stmt = this.db.prepare(`
      INSERT INTO memory_evolution_outbox (
        id, tenant_id, workspace_id, memory_record_id, memory_version,
        candidate_set_hash, evolution_payload, status, attempt_count,
        max_attempts, next_attempt_at, created_at, updated_at, processed_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, workspace_id, id) DO NOTHING;
    `);

    stmt.run(
      validated.id,
      validated.tenantId,
      validated.workspaceId,
      validated.memoryRecordId,
      validated.memoryVersion,
      validated.candidateSetHash,
      JSON.stringify(validated.evolutionPayload ?? {}),
      validated.status ?? EvolutionDeliveryStatus.PENDING,
      validated.attemptCount ?? 0,
      validated.maxAttempts ?? OUTBOX_MAX_ATTEMPTS_DEFAULT,
      validated.nextAttemptAt ?? null,
      createdAt,
      updatedAt,
      validated.processedAt ?? null,
      validated.lastError ?? null,
    );

    const saved = await this.getOutboxRecord(
      validated.id,
      validated.tenantId,
      validated.workspaceId,
    );
    if (!saved) {
      throw new Error(`Failed to retrieve created or coalesced outbox record: ${validated.id}`);
    }
    return saved;
  }

  public async getOutboxRecord(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<EvolutionOutboxRecord | null> {
    this.checkFailure();
    const row = this.db
      .prepare(
        `SELECT * FROM memory_evolution_outbox
         WHERE tenant_id = ? AND workspace_id = ? AND id = ?;`,
      )
      .get(tenantId, workspaceId, id) as any;

    if (!row) return null;
    return this.rowToOutboxRecord(row);
  }

  public async listPendingOutboxRecords(options?: {
    tenantId?: string;
    workspaceId?: string;
    limit?: number;
    olderThanMs?: number;
    ignoreLeaseTimeout?: boolean;
  }): Promise<EvolutionOutboxRecord[]> {
    this.checkFailure();
    const nowIso = new Date().toISOString();
    const leaseCutoff = new Date(Date.now() - OUTBOX_PROCESSING_LEASE_TIMEOUT_MS).toISOString();

    let sql = `
      SELECT * FROM memory_evolution_outbox
      WHERE (
        status = 'PENDING'
        OR (status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
        OR (status = 'PROCESSING' AND ${options?.ignoreLeaseTimeout ? '1=1' : 'updated_at <= ?'})
      )
    `;
    const params: any[] = [nowIso];
    if (!options?.ignoreLeaseTimeout) {
      params.push(leaseCutoff);
    }

    if (options?.tenantId && options?.workspaceId) {
      sql += ' AND tenant_id = ? AND workspace_id = ?';
      params.push(options.tenantId, options.workspaceId);
    }

    sql += ' ORDER BY created_at ASC LIMIT ?;';
    params.push(Math.min(options?.limit ?? 50, 100));

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.rowToOutboxRecord(r));
  }

  public async claimOutboxRecord(
    id: string,
    tenantId: string,
    workspaceId: string,
    options?: { ignoreLeaseTimeout?: boolean },
  ): Promise<boolean> {
    this.checkFailure();
    const nowIso = new Date().toISOString();
    const leaseCutoff = new Date(Date.now() - OUTBOX_PROCESSING_LEASE_TIMEOUT_MS).toISOString();

    const sql = `
      UPDATE memory_evolution_outbox
      SET status = 'PROCESSING', updated_at = ?
      WHERE tenant_id = ? AND workspace_id = ? AND id = ? AND (
        status = 'PENDING'
        OR (status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
        OR (status = 'PROCESSING' AND ${options?.ignoreLeaseTimeout ? '1=1' : 'updated_at <= ?'})
      );
    `;
    const params = [nowIso, tenantId, workspaceId, id, nowIso];
    if (!options?.ignoreLeaseTimeout) {
      params.push(leaseCutoff);
    }

    const result = this.db.prepare(sql).run(...params);
    return Number(result.changes) > 0;
  }

  public async updateOutboxStatus(
    id: string,
    tenantId: string,
    workspaceId: string,
    update: {
      status: EvolutionDeliveryStatus;
      attemptCount?: number;
      lastError?: string | null;
      nextAttemptAt?: string | null;
      processedAt?: string | null;
    },
  ): Promise<EvolutionOutboxRecord> {
    this.checkFailure();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE memory_evolution_outbox SET
        status = ?,
        attempt_count = COALESCE(?, attempt_count),
        next_attempt_at = ?,
        last_error = ?,
        processed_at = COALESCE(?, processed_at),
        updated_at = ?
      WHERE tenant_id = ? AND workspace_id = ? AND id = ?;
    `);

    stmt.run(
      update.status,
      update.attemptCount !== undefined ? update.attemptCount : null,
      update.nextAttemptAt ?? null,
      update.lastError ?? null,
      update.processedAt !== undefined
        ? update.processedAt
        : update.status === EvolutionDeliveryStatus.COMPLETED
          ? now
          : null,
      now,
      tenantId,
      workspaceId,
      id,
    );

    const updated = await this.getOutboxRecord(id, tenantId, workspaceId);
    if (!updated) {
      throw new Error(`Outbox record not found after update: ${id}`);
    }
    return updated;
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
      DELETE FROM memory_evolution_outbox;
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

  private rowToGraphNode(row: any): MemoryGraphNodeOutput {
    let provenance: MemoryProvenanceOutput | undefined = undefined;
    if (row.provenance && row.provenance !== '{}') {
      try {
        const parsed = JSON.parse(row.provenance);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          provenance = {
            ...parsed,
            verified: Boolean(parsed.verified),
          };
        }
      } catch {
        provenance = undefined;
      }
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      nodeType: row.node_type,
      label: row.label,
      confidence: row.confidence ?? 1.0,
      memoryRecordId: row.memory_record_id ?? undefined,
      properties: JSON.parse(row.properties || '{}'),
      provenance,
      version: row.version ?? 1,
      lastMemoryVersion: row.last_memory_version ?? 1,
      isCurrent: row.is_current !== undefined ? Boolean(row.is_current) : true,
      validFrom: row.valid_from ?? row.created_at,
      validTo: row.valid_to ?? undefined,
      supersededBy: row.superseded_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }

  private rowToGraphEdge(row: any): MemoryGraphEdgeOutput {
    let provenance: MemoryProvenanceOutput;
    try {
      const parsed = row.provenance ? JSON.parse(row.provenance) : {};
      if (parsed && parsed.sourceType && parsed.creatorPrincipalId && parsed.timestamp) {
        provenance = {
          ...parsed,
          verified: Boolean(parsed.verified),
        };
      } else {
        provenance = {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: 'system:legacy',
          timestamp: row.created_at,
          verified: false,
        };
      }
    } catch {
      provenance = {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: 'system:legacy',
        timestamp: row.created_at,
        verified: false,
      };
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      edgeType: row.edge_type,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      confidence: row.confidence ?? 1.0,
      weight: row.weight ?? 1.0,
      properties: JSON.parse(row.properties || '{}'),
      provenance,
      version: row.version ?? 1,
      lastMemoryVersion: row.last_memory_version ?? 1,
      isCurrent: row.is_current !== undefined ? Boolean(row.is_current) : true,
      validFrom: row.valid_from ?? row.created_at,
      validTo: row.valid_to ?? undefined,
      supersededBy: row.superseded_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }

  private rowToOutboxRecord(row: any): EvolutionOutboxRecord {
    let payload: Record<string, unknown> | undefined = undefined;
    if (row.evolution_payload) {
      try {
        payload = JSON.parse(row.evolution_payload);
      } catch {
        payload = undefined;
      }
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      memoryRecordId: row.memory_record_id,
      memoryVersion: row.memory_version,
      candidateSetHash: row.candidate_set_hash,
      evolutionPayload: payload,
      status: row.status as EvolutionDeliveryStatus,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts ?? OUTBOX_MAX_ATTEMPTS_DEFAULT,
      nextAttemptAt: row.next_attempt_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      processedAt: row.processed_at ?? null,
      lastError: row.last_error ?? null,
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
