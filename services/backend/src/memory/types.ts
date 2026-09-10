import {
  MemoryRecord,
  MemorySearchRequest,
  MemoryProposal,
  MemoryCompressionRequest,
  MemoryCompressionResponse,
  EpisodicEpisode,
  EpisodicEpisodeInput,
  ProceduralPlaybookProposal,
  ProceduralPlaybookProposalInput,
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphQueryRequest,
  MemoryGraphQueryResponse,
  VectorEmbedding,
  VectorSearchRequest,
  VectorSearchResponse,
} from '@nexusos/contracts';

export interface MemoryServiceContext {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  roles?: string[];
}

export interface IMemoryStore {
  create(record: MemoryRecord): Promise<MemoryRecord>;
  getById(id: string, tenantId: string, workspaceId: string): Promise<MemoryRecord | null>;
  update(
    id: string,
    tenantId: string,
    workspaceId: string,
    updates: Partial<
      Omit<MemoryRecord, 'id' | 'tenantId' | 'workspaceId' | 'version' | 'createdAt'>
    >,
    expectedVersion: number,
  ): Promise<MemoryRecord>;
  tombstone(
    id: string,
    tenantId: string,
    workspaceId: string,
    tombstonedAt: string,
    expectedVersion?: number,
  ): Promise<MemoryRecord>;
  search(request: MemorySearchRequest): Promise<{ records: MemoryRecord[]; total: number }>;
  saveProposal(proposal: MemoryProposal): Promise<MemoryProposal>;
  getProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<MemoryProposal | null>;
  updateProposal(
    proposalId: string,
    tenantId: string,
    workspaceId: string,
    status: 'APPROVED' | 'REJECTED',
    resolvedBy: string,
    resolvedAt: string,
    reason?: string,
  ): Promise<MemoryProposal>;
  purgeExpired(currentIsoTimestamp: string): Promise<number>;

  // Task 058 Store Extensions: Episodes, Playbooks, Graph & Revocation (058-SEC-03, 058-SEC-05)
  saveEpisode(episode: EpisodicEpisode): Promise<EpisodicEpisode>;
  getEpisode(id: string, tenantId: string, workspaceId: string): Promise<EpisodicEpisode | null>;
  listEpisodes(
    tenantId: string,
    workspaceId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ episodes: EpisodicEpisode[]; total: number }>;

  savePlaybook(playbook: ProceduralPlaybookProposal): Promise<ProceduralPlaybookProposal>;
  getPlaybook(
    id: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<ProceduralPlaybookProposal | null>;
  listPlaybooks(
    tenantId: string,
    workspaceId: string,
    options?: { planningEligibleOnly?: boolean },
  ): Promise<ProceduralPlaybookProposal[]>;

  saveGraphNode(node: MemoryGraphNode): Promise<MemoryGraphNode>;
  getGraphNode(id: string, tenantId: string, workspaceId: string): Promise<MemoryGraphNode | null>;
  saveGraphEdge(edge: MemoryGraphEdge): Promise<MemoryGraphEdge>;
  getGraphEdge(id: string, tenantId: string, workspaceId: string): Promise<MemoryGraphEdge | null>;
  queryGraph(request: MemoryGraphQueryRequest): Promise<MemoryGraphQueryResponse>;
  revokeGraphForMemory(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<{ revokedNodes: number; revokedEdges: number }>;
  markDerivedCompressionsTombstoned(
    sourceMemoryId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<number>;

  // Task 062 Vector Store Extensions (062-SEC-01, 062-SEC-05, 062-SEC-06)
  saveVector?(vector: VectorEmbedding): Promise<VectorEmbedding>;
  getVector?(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<VectorEmbedding | null>;
  deleteVector?(memoryRecordId: string, tenantId: string, workspaceId: string): Promise<boolean>;
  searchVectors?(request: VectorSearchRequest): Promise<VectorSearchResponse>;
}

export interface IMemoryCompressor {
  compress(
    request: MemoryCompressionRequest,
    ctx: MemoryServiceContext,
  ): Promise<MemoryCompressionResponse>;
}

export interface IEpisodicLearner {
  recordEpisode(
    input: Omit<EpisodicEpisodeInput, 'id' | 'createdAt'>,
    ctx: MemoryServiceContext,
  ): Promise<EpisodicEpisode>;
  getEpisode(id: string, ctx: MemoryServiceContext): Promise<EpisodicEpisode | null>;
  listEpisodes(
    ctx: MemoryServiceContext,
    options?: { limit?: number; offset?: number },
  ): Promise<{ episodes: EpisodicEpisode[]; total: number }>;
  proposePlaybook(
    input: Omit<ProceduralPlaybookProposalInput, 'id' | 'createdAt' | 'updatedAt'>,
    ctx: MemoryServiceContext,
  ): Promise<ProceduralPlaybookProposal>;
  approvePlaybook(
    playbookId: string,
    approval: { approvedBy: string; notes?: string },
    ctx: MemoryServiceContext,
  ): Promise<ProceduralPlaybookProposal>;
  getPlaybook(
    playbookId: string,
    ctx: MemoryServiceContext,
  ): Promise<ProceduralPlaybookProposal | null>;
  listPlaybooks(
    ctx: MemoryServiceContext,
    options?: { planningEligibleOnly?: boolean },
  ): Promise<ProceduralPlaybookProposal[]>;
}

export interface IGraphProjectionEngine {
  upsertNode(node: MemoryGraphNode, ctx: MemoryServiceContext): Promise<MemoryGraphNode>;
  upsertEdge(edge: MemoryGraphEdge, ctx: MemoryServiceContext): Promise<MemoryGraphEdge>;
  query(
    request: MemoryGraphQueryRequest,
    ctx: MemoryServiceContext,
  ): Promise<MemoryGraphQueryResponse>;
  revokeProjectionsForMemory(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<{ revokedNodes: number; revokedEdges: number }>;
}

export class MemoryNotFoundError extends Error {
  public readonly code = 'MEMORY_NOT_FOUND';
  constructor(id: string) {
    super(`Memory record '${id}' not found or access denied.`);
    this.name = 'MemoryNotFoundError';
  }
}

export class MemoryVersionConflictError extends Error {
  public readonly code = 'MEMORY_VERSION_CONFLICT';
  constructor(id: string, currentVersion: number, expectedVersion: number) {
    super(
      `056-SEC-06: Memory update conflict for '${id}'. Current version is ${currentVersion}, but expected ${expectedVersion}.`,
    );
    this.name = 'MemoryVersionConflictError';
  }
}

export class MemorySecurityViolationError extends Error {
  public readonly code = 'MEMORY_SECURITY_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'MemorySecurityViolationError';
  }
}

export class MemorySecretDetectedError extends Error {
  public readonly code = 'MEMORY_SECRET_DETECTED';
  constructor(message: string) {
    super(message);
    this.name = 'MemorySecretDetectedError';
  }
}

export class VectorDimensionMismatchError extends Error {
  public readonly code = 'VECTOR_DIMENSION_MISMATCH';
  constructor(expected: number, actual: number) {
    super(
      `062-SEC-05: Vector dimension mismatch: expected dimension ${expected}, but got ${actual}.`,
    );
    this.name = 'VectorDimensionMismatchError';
  }
}

export class VectorIndexError extends Error {
  public readonly code = 'VECTOR_INDEX_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'VectorIndexError';
  }
}
