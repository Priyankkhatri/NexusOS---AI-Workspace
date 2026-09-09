import {
  MemoryRecord,
  MemorySearchRequest,
  MemoryProposal,
  MemoryStatus,
  MemorySensitivity,
  SENSITIVITY_HIERARCHY,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  MemoryNotFoundError,
  MemoryVersionConflictError,
  MemorySecurityViolationError,
} from './types.js';

export interface InMemoryStoreOptions {
  simulateFailure?: boolean;
}

/**
 * Governed Persistent Memory Store Implementation
 * Provides multi-tenant partitioning, version-aware atomic updates, tombstones, and safe search.
 */
export class InMemoryMemoryStore implements IMemoryStore {
  // Primary storage: composite key "tenantId:workspaceId:memoryId" -> MemoryRecord
  private readonly records = new Map<string, MemoryRecord>();
  // Proposals storage: "tenantId:workspaceId:proposalId" -> MemoryProposal
  private readonly proposals = new Map<string, MemoryProposal>();
  public simulateFailure = false;

  constructor(options?: InMemoryStoreOptions) {
    if (options?.simulateFailure) {
      this.simulateFailure = true;
    }
  }

  private getKey(tenantId: string, workspaceId: string, id: string): string {
    return `${tenantId}:${workspaceId}:${id}`;
  }

  private checkFailure(): void {
    if (this.simulateFailure) {
      throw new Error('056-STORE-FAIL: Persistent memory storage backend unreachable.');
    }
  }

  public async create(record: MemoryRecord): Promise<MemoryRecord> {
    this.checkFailure();

    if (!record.tenantId || !record.workspaceId || !record.id) {
      throw new MemorySecurityViolationError(
        'Cannot create memory record without tenantId, workspaceId, and id.',
      );
    }

    const key = this.getKey(record.tenantId, record.workspaceId, record.id);
    if (this.records.has(key)) {
      throw new Error(`Memory record with ID '${record.id}' already exists in this workspace.`);
    }

    // Deep clone to ensure immutability in store
    const cloned = JSON.parse(JSON.stringify(record)) as MemoryRecord;
    this.records.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getById(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryRecord | null> {
    this.checkFailure();

    if (!id || !tenantId || !workspaceId) {
      return null;
    }

    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.records.get(key);
    if (!existing) {
      return null;
    }

    // Check expiry
    if (this.isExpired(existing)) {
      return null;
    }

    // Check tombstone
    if (existing.status === MemoryStatus.TOMBSTONED) {
      return null;
    }

    return JSON.parse(JSON.stringify(existing));
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

    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.records.get(key);
    if (!existing || existing.status === MemoryStatus.TOMBSTONED || this.isExpired(existing)) {
      throw new MemoryNotFoundError(id);
    }

    // Enforce 056-SEC-06: Monotonic versioning and optimistic lock
    if (existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const nextVersion = existing.version + 1;
    const now = new Date().toISOString();

    const updated: MemoryRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      workspaceId: existing.workspaceId,
      version: nextVersion,
      updatedAt: now,
    };

    this.records.set(key, JSON.parse(JSON.stringify(updated)));
    return JSON.parse(JSON.stringify(updated));
  }

  public async tombstone(
    id: string,
    tenantId: string,
    workspaceId: string,
    tombstonedAt: string,
    expectedVersion?: number,
  ): Promise<MemoryRecord> {
    this.checkFailure();

    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.records.get(key);
    if (!existing || existing.status === MemoryStatus.TOMBSTONED) {
      throw new MemoryNotFoundError(id);
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const nextVersion = existing.version + 1;
    const tombstoned: MemoryRecord = {
      ...existing,
      status: MemoryStatus.TOMBSTONED,
      tombstonedAt,
      version: nextVersion,
      updatedAt: tombstonedAt,
    };

    this.records.set(key, JSON.parse(JSON.stringify(tombstoned)));
    return JSON.parse(JSON.stringify(tombstoned));
  }

  public async search(
    request: MemorySearchRequest,
  ): Promise<{ records: MemoryRecord[]; total: number }> {
    this.checkFailure();

    const { tenantId, workspaceId } = request;
    if (!tenantId || !workspaceId) {
      return { records: [], total: 0 };
    }

    const matched: MemoryRecord[] = [];
    const allowedStatuses = new Set(request.status ?? [MemoryStatus.ACTIVE]);
    const allowedClasses = request.classes ? new Set(request.classes) : null;
    const allowedMaxSensHierarchy = request.maxSensitivity
      ? SENSITIVITY_HIERARCHY[request.maxSensitivity]
      : SENSITIVITY_HIERARCHY[MemorySensitivity.RESTRICTED];

    for (const record of this.records.values()) {
      // 1. Mandatory Tenant and Workspace boundary check
      if (record.tenantId !== tenantId || record.workspaceId !== workspaceId) {
        continue;
      }

      // 2. Tombstone & Expiry defense
      if (record.status === MemoryStatus.TOMBSTONED || this.isExpired(record)) {
        continue;
      }

      // 3. Status check
      if (!allowedStatuses.has(record.status)) {
        continue;
      }

      // 4. Sensitivity ceiling check
      const recordSensHierarchy = SENSITIVITY_HIERARCHY[record.sensitivity];
      if (recordSensHierarchy > allowedMaxSensHierarchy) {
        continue;
      }

      // 5. Class filter check
      if (allowedClasses && !allowedClasses.has(record.class)) {
        continue;
      }

      // 6. Confidence filter check
      if (request.minConfidence !== undefined && record.confidence < request.minConfidence) {
        continue;
      }

      // 7. Owner check
      if (request.ownerId && record.ownerId !== request.ownerId) {
        continue;
      }

      // 8. Tags filter check
      if (request.tags && request.tags.length > 0) {
        const hasAllTags = request.tags.every((t) => record.tags.includes(t));
        if (!hasAllTags) {
          continue;
        }
      }

      // 9. Query text search filter
      if (request.query && request.query.trim()) {
        const terms = request.query.toLowerCase().split(/\s+/).filter(Boolean);
        const searchableText =
          `${record.title ?? ''} ${record.content} ${record.summary ?? ''} ${record.tags.join(' ')}`.toLowerCase();
        const hasMatch = terms.some((term) => searchableText.includes(term));
        if (!hasMatch) {
          continue;
        }
      }

      matched.push(JSON.parse(JSON.stringify(record)));
    }

    const total = matched.length;
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 10;
    const paginated = matched.slice(offset, offset + limit);

    return { records: paginated, total };
  }

  public async saveProposal(proposal: MemoryProposal): Promise<MemoryProposal> {
    this.checkFailure();
    const key = this.getKey(proposal.tenantId, proposal.workspaceId, proposal.proposalId);
    this.proposals.set(key, JSON.parse(JSON.stringify(proposal)));
    return JSON.parse(JSON.stringify(proposal));
  }

  public async getProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryProposal | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, proposalId);
    const found = this.proposals.get(key);
    if (!found) return null;
    return JSON.parse(JSON.stringify(found));
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
    const key = this.getKey(tenantId, workspaceId, proposalId);
    const found = this.proposals.get(key);
    if (!found) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    const updated: MemoryProposal = {
      ...found,
      status,
      resolvedBy,
      resolvedAt,
      reason: reason ?? found.reason,
    };

    this.proposals.set(key, JSON.parse(JSON.stringify(updated)));
    return JSON.parse(JSON.stringify(updated));
  }

  public async purgeExpired(currentIsoTimestamp: string): Promise<number> {
    this.checkFailure();
    let purged = 0;
    const nowMs = new Date(currentIsoTimestamp).getTime();

    for (const [key, record] of this.records.entries()) {
      if (this.isExpired(record, nowMs)) {
        const tombstoned: MemoryRecord = {
          ...record,
          status: MemoryStatus.TOMBSTONED,
          tombstonedAt: currentIsoTimestamp,
          version: record.version + 1,
          updatedAt: currentIsoTimestamp,
        };
        this.records.set(key, tombstoned);
        purged++;
      }
    }
    return purged;
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

  public clear(): void {
    this.records.clear();
    this.proposals.clear();
  }
}
