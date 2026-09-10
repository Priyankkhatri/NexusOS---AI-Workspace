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
 * Provides multi-tenant partitioning, version-aware atomic updates, tombstones, safe search,
 * episodic episode persistence, procedural playbooks, and knowledge graph projections.
 */
export class InMemoryMemoryStore implements IMemoryStore {
  // Primary storage: composite key "tenantId:workspaceId:memoryId" -> MemoryRecord
  private readonly records = new Map<string, MemoryRecord>();
  // Proposals storage: "tenantId:workspaceId:proposalId" -> MemoryProposal
  private readonly proposals = new Map<string, MemoryProposal>();
  // Episodes storage: "tenantId:workspaceId:episodeId" -> EpisodicEpisode
  private readonly episodes = new Map<string, EpisodicEpisode>();
  // Playbooks storage: "tenantId:workspaceId:playbookId" -> ProceduralPlaybookProposal
  private readonly playbooks = new Map<string, ProceduralPlaybookProposal>();
  // Graph nodes: "tenantId:workspaceId:nodeId" -> MemoryGraphNode
  private readonly graphNodes = new Map<string, MemoryGraphNode>();
  // Graph edges: "tenantId:workspaceId:edgeId" -> MemoryGraphEdge
  private readonly graphEdges = new Map<string, MemoryGraphEdge>();

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

  // -------------------------------------------------------------------------
  // Core Memory CRUD
  // -------------------------------------------------------------------------

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
    if (!existing) {
      throw new MemoryNotFoundError(id);
    }

    if (existing.status === MemoryStatus.TOMBSTONED) {
      throw new MemoryNotFoundError(id);
    }

    // Optimistic locking
    if (existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const updated: MemoryRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      workspaceId: existing.workspaceId,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
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
    if (!existing) {
      throw new MemoryNotFoundError(id);
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError(id, existing.version, expectedVersion);
    }

    const tombstoned: MemoryRecord = {
      ...existing,
      status: MemoryStatus.TOMBSTONED,
      tombstonedAt,
      version: existing.version + 1,
      updatedAt: tombstonedAt,
    };

    this.records.set(key, JSON.parse(JSON.stringify(tombstoned)));

    // 058-SEC-05: Cascading tombstone to graph projections and derived compressions
    await this.revokeGraphForMemory(id, tenantId, workspaceId);
    await this.markDerivedCompressionsTombstoned(id, tenantId, workspaceId);

    return JSON.parse(JSON.stringify(tombstoned));
  }

  public async search(
    request: MemorySearchRequest,
  ): Promise<{ records: MemoryRecord[]; total: number }> {
    this.checkFailure();

    const tenantId = request.tenantId;
    const workspaceId = request.workspaceId;
    const allowedStatuses = new Set(request.status ?? [MemoryStatus.ACTIVE]);
    const classes = request.classes ? new Set(request.classes) : null;
    const tags = request.tags ? new Set(request.tags) : null;
    const maxSensitivityRank = request.maxSensitivity
      ? SENSITIVITY_HIERARCHY[request.maxSensitivity]
      : SENSITIVITY_HIERARCHY[MemorySensitivity.RESTRICTED];
    const minConfidence = request.minConfidence ?? 0.0;
    const nowMs = Date.now();

    const matching: MemoryRecord[] = [];

    for (const record of this.records.values()) {
      // 1. Strict Tenant and Workspace Isolation (056-SEC-02)
      if (record.tenantId !== tenantId || record.workspaceId !== workspaceId) {
        continue;
      }

      // 2. Status check
      if (!allowedStatuses.has(record.status)) {
        continue;
      }

      // 3. Expiry check
      if (this.isExpired(record, nowMs)) {
        continue;
      }

      // 4. Sensitivity hierarchy check
      const recordRank = SENSITIVITY_HIERARCHY[record.sensitivity] ?? 0;
      if (recordRank > maxSensitivityRank) {
        continue;
      }

      // 5. Confidence check
      if (record.confidence < minConfidence) {
        continue;
      }

      // 6. Memory class check
      if (classes && !classes.has(record.class)) {
        continue;
      }

      // 7. Owner check
      if (request.ownerId && record.ownerId !== request.ownerId) {
        continue;
      }

      // 8. Tag check
      if (tags) {
        const hasMatchingTag = record.tags.some((t) => tags.has(t));
        if (!hasMatchingTag) {
          continue;
        }
      }

      // 9. Lexical query match
      if (request.query && request.query.trim().length > 0) {
        const q = request.query.toLowerCase();
        const contentMatch = record.content.toLowerCase().includes(q);
        const titleMatch = record.title ? record.title.toLowerCase().includes(q) : false;
        const tagMatch = record.tags.some((t) => t.toLowerCase().includes(q));

        if (!contentMatch && !titleMatch && !tagMatch) {
          continue;
        }
      }

      matching.push(JSON.parse(JSON.stringify(record)));
    }

    const total = matching.length;
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 10;
    const paginated = matching.slice(offset, offset + limit);

    return { records: paginated, total };
  }

  // -------------------------------------------------------------------------
  // Proposals
  // -------------------------------------------------------------------------

  public async saveProposal(proposal: MemoryProposal): Promise<MemoryProposal> {
    this.checkFailure();
    const key = this.getKey(proposal.tenantId, proposal.workspaceId, proposal.proposalId);
    const cloned = JSON.parse(JSON.stringify(proposal)) as MemoryProposal;
    this.proposals.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryProposal | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, proposalId);
    const existing = this.proposals.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
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
    const existing = this.proposals.get(key);
    if (!existing) {
      throw new MemoryNotFoundError(`Proposal '${proposalId}' not found.`);
    }

    const updated: MemoryProposal = {
      ...existing,
      status,
      resolvedBy,
      resolvedAt,
      reason,
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

  // -------------------------------------------------------------------------
  // Task 058 Store: Episodic Episodes
  // -------------------------------------------------------------------------

  public async saveEpisode(episode: EpisodicEpisode): Promise<EpisodicEpisode> {
    this.checkFailure();
    const key = this.getKey(episode.tenantId, episode.workspaceId, episode.id);
    const cloned = JSON.parse(JSON.stringify(episode)) as EpisodicEpisode;
    this.episodes.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getEpisode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<EpisodicEpisode | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.episodes.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
  }

  public async listEpisodes(
    tenantId: string,
    workspaceId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ episodes: EpisodicEpisode[]; total: number }> {
    this.checkFailure();
    const matching: EpisodicEpisode[] = [];
    for (const ep of this.episodes.values()) {
      if (ep.tenantId === tenantId && ep.workspaceId === workspaceId) {
        matching.push(JSON.parse(JSON.stringify(ep)));
      }
    }
    matching.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    const total = matching.length;
    const paginated = matching.slice(offset, offset + limit);
    return { episodes: paginated, total };
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Procedural Playbooks
  // -------------------------------------------------------------------------

  public async savePlaybook(
    playbook: ProceduralPlaybookProposal,
  ): Promise<ProceduralPlaybookProposal> {
    this.checkFailure();
    const key = this.getKey(playbook.tenantId, playbook.workspaceId, playbook.id);
    const cloned = JSON.parse(JSON.stringify(playbook)) as ProceduralPlaybookProposal;
    this.playbooks.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getPlaybook(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<ProceduralPlaybookProposal | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const existing = this.playbooks.get(key);
    if (!existing) return null;
    return JSON.parse(JSON.stringify(existing));
  }

  public async listPlaybooks(
    tenantId: string,
    workspaceId: string,
    options?: { planningEligibleOnly?: boolean },
  ): Promise<ProceduralPlaybookProposal[]> {
    this.checkFailure();
    const result: ProceduralPlaybookProposal[] = [];
    for (const pb of this.playbooks.values()) {
      if (pb.tenantId === tenantId && pb.workspaceId === workspaceId) {
        if (options?.planningEligibleOnly) {
          if (isPlaybookPlanningEligible(pb)) {
            result.push(JSON.parse(JSON.stringify(pb)));
          }
        } else {
          result.push(JSON.parse(JSON.stringify(pb)));
        }
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Knowledge Graph Projections (058-SEC-03)
  // -------------------------------------------------------------------------

  public async saveGraphNode(node: MemoryGraphNode): Promise<MemoryGraphNode> {
    this.checkFailure();
    const key = this.getKey(node.tenantId, node.workspaceId, node.id);
    const cloned = JSON.parse(JSON.stringify(node)) as MemoryGraphNode;
    this.graphNodes.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getGraphNode(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphNode | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const node = this.graphNodes.get(key);
    if (!node) return null;
    return JSON.parse(JSON.stringify(node));
  }

  public async saveGraphEdge(edge: MemoryGraphEdge): Promise<MemoryGraphEdge> {
    this.checkFailure();
    const key = this.getKey(edge.tenantId, edge.workspaceId, edge.id);
    const cloned = JSON.parse(JSON.stringify(edge)) as MemoryGraphEdge;
    this.graphEdges.set(key, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  public async getGraphEdge(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryGraphEdge | null> {
    this.checkFailure();
    const key = this.getKey(tenantId, workspaceId, id);
    const edge = this.graphEdges.get(key);
    if (!edge) return null;
    return JSON.parse(JSON.stringify(edge));
  }

  public async queryGraph(request: MemoryGraphQueryRequest): Promise<MemoryGraphQueryResponse> {
    this.checkFailure();

    const tenantId = request.tenantId;
    const workspaceId = request.workspaceId;
    const startNodeId = request.startNodeId;
    const maxDepth = request.maxDepth ?? 2;
    const minConfidence = request.minConfidence ?? 0.0;
    const limit = request.limit ?? 25;
    const allowedNodeTypes = request.nodeTypes ? new Set(request.nodeTypes) : null;
    const allowedEdgeTypes = request.edgeTypes ? new Set(request.edgeTypes) : null;

    // Collect all nodes and edges belonging strictly to this tenant and workspace (058-SEC-03)
    const wsNodes = new Map<string, MemoryGraphNode>();
    for (const n of this.graphNodes.values()) {
      if (n.tenantId === tenantId && n.workspaceId === workspaceId) {
        if (!allowedNodeTypes || allowedNodeTypes.has(n.nodeType)) {
          if (n.confidence >= minConfidence) {
            wsNodes.set(n.id, JSON.parse(JSON.stringify(n)));
          }
        }
      }
    }

    const wsEdges: MemoryGraphEdge[] = [];
    for (const e of this.graphEdges.values()) {
      if (e.tenantId === tenantId && e.workspaceId === workspaceId) {
        if (!allowedEdgeTypes || allowedEdgeTypes.has(e.edgeType)) {
          if (e.confidence >= minConfidence) {
            wsEdges.push(JSON.parse(JSON.stringify(e)));
          }
        }
      }
    }

    // Traversal logic
    if (startNodeId) {
      // Start node must exist within workspace
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
          if (visitedEdgeIds.has(edge.id)) {
            continue;
          }
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

      const nodeIds = new Set(selectedNodes.map((n) => n.id));
      const selectedEdges = resultEdges
        .filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId))
        .slice(0, limit);

      return {
        nodes: selectedNodes,
        edges: selectedEdges,
        traversalDepth: currentDepth,
        tenantId,
        workspaceId,
        totalNodes: selectedNodes.length,
        totalEdges: selectedEdges.length,
      };
    }

    // Unanchored query: return all workspace nodes and matching edges up to limit
    const allNodes = Array.from(wsNodes.values()).slice(0, limit);
    const nodeIds = new Set(allNodes.map((n) => n.id));
    const allEdges = wsEdges
      .filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId))
      .slice(0, limit);

    return {
      nodes: allNodes,
      edges: allEdges,
      traversalDepth: 1,
      tenantId,
      workspaceId,
      totalNodes: allNodes.length,
      totalEdges: allEdges.length,
    };
  }

  // -------------------------------------------------------------------------
  // Task 058 Store: Atomic Forgetting & Graph Revocation (058-SEC-05)
  // -------------------------------------------------------------------------

  public async revokeGraphForMemory(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<{ revokedNodes: number; revokedEdges: number }> {
    this.checkFailure();

    // 1. Find nodes associated with this memoryRecordId
    const targetNodeIds = new Set<string>();
    for (const [key, node] of this.graphNodes.entries()) {
      if (
        node.tenantId === tenantId &&
        node.workspaceId === workspaceId &&
        node.memoryRecordId === memoryRecordId
      ) {
        targetNodeIds.add(node.id);
        this.graphNodes.delete(key);
      }
    }

    // 2. Find and delete edges referencing these nodes
    let deletedEdgesCount = 0;
    for (const [key, edge] of this.graphEdges.entries()) {
      if (edge.tenantId === tenantId && edge.workspaceId === workspaceId) {
        if (targetNodeIds.has(edge.sourceNodeId) || targetNodeIds.has(edge.targetNodeId)) {
          this.graphEdges.delete(key);
          deletedEdgesCount++;
        }
      }
    }

    return {
      revokedNodes: targetNodeIds.size,
      revokedEdges: deletedEdgesCount,
    };
  }

  public async markDerivedCompressionsTombstoned(
    sourceMemoryId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<number> {
    this.checkFailure();
    let updatedCount = 0;
    const now = new Date().toISOString();

    for (const [key, record] of this.records.entries()) {
      if (record.tenantId === tenantId && record.workspaceId === workspaceId) {
        if (record.status === MemoryStatus.TOMBSTONED) {
          continue;
        }

        // Check if metadata contains sourceMemoryIds array citing this memory
        const srcIds = (record.metadata?.sourceMemoryIds as string[] | undefined) ?? [];
        const isCitedInSourceIds = Array.isArray(srcIds) && srcIds.includes(sourceMemoryId);
        const isCitedInSummary =
          record.summary?.includes(sourceMemoryId) || record.content.includes(sourceMemoryId);

        if (isCitedInSourceIds || (record.class === 'EPISODIC' && isCitedInSummary)) {
          const tombstoned: MemoryRecord = {
            ...record,
            status: MemoryStatus.TOMBSTONED,
            tombstonedAt: now,
            version: record.version + 1,
            updatedAt: now,
          };
          this.records.set(key, tombstoned);
          updatedCount++;
        }
      }
    }

    return updatedCount;
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
    this.episodes.clear();
    this.playbooks.clear();
    this.graphNodes.clear();
    this.graphEdges.clear();
  }
}
