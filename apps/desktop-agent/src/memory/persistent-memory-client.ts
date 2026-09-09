import {
  MemoryRecord,
  MemoryRecordSchema,
  MemoryCreateRequest,
  MemoryCreateRequestSchema,
  MemoryUpdateRequest,
  MemoryUpdateRequestSchema,
  MemorySearchRequest,
  MemorySearchRequestSchema,
  MemorySearchResponse,
  MemorySearchResponseSchema,
  MemorySearchResultItem,
  MemoryProposal,
  MemoryProposalSchema,
  MemoryTombstoneResponse,
  MemoryTombstoneResponseSchema,
  formatRetrievedContext,
  FormatRetrievedContextOptions,
  FormattedRetrievedContextResult,
} from '@nexusos/contracts';
import { MemoryCacheManager } from './memory-cache-manager.js';

export interface PersistentMemoryClientConfig {
  backendUrl: string;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  authToken?: string;
  fetchFn?: typeof fetch;
  l1Cache?: MemoryCacheManager;
}

export class PersistentMemoryClient {
  private readonly backendUrl: string;
  public readonly tenantId: string;
  public readonly workspaceId: string;
  public readonly principalId: string;
  private readonly authToken?: string;
  private readonly fetchFn: typeof fetch;
  public readonly l1Cache?: MemoryCacheManager;

  constructor(config: PersistentMemoryClientConfig) {
    if (!config.backendUrl) {
      throw new Error('backendUrl is required for PersistentMemoryClient.');
    }
    if (!config.tenantId || !config.workspaceId || !config.principalId) {
      throw new Error(
        '056-SEC-02: tenantId, workspaceId, and principalId are required to initialize PersistentMemoryClient.',
      );
    }

    this.backendUrl = config.backendUrl.replace(/\/+$/, '');
    this.tenantId = config.tenantId;
    this.workspaceId = config.workspaceId;
    this.principalId = config.principalId;
    this.authToken = config.authToken;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.l1Cache = config.l1Cache;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-tenant-id': this.tenantId,
      'x-workspace-id': this.workspaceId,
      'x-principal-id': this.principalId,
    };
    if (this.authToken) {
      headers['authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /**
   * Create a persistent memory record in the backend.
   */
  public async createMemory(
    request: Omit<MemoryCreateRequest, 'tenantId' | 'workspaceId' | 'ownerId'> & {
      ownerId?: string;
    },
  ): Promise<MemoryRecord> {
    const fullRequest: MemoryCreateRequest = {
      ...request,
      tenantId: this.tenantId,
      workspaceId: this.workspaceId,
      ownerId: request.ownerId || this.principalId,
    };

    const validated = MemoryCreateRequestSchema.parse(fullRequest);

    const res = await this.fetchFn(`${this.backendUrl}/v1/memory`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(validated),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Failed to create persistent memory (${res.status}): ${errorBody}`);
    }

    const json = await res.json();
    const record = MemoryRecordSchema.parse(json);

    // Optional L1 cache write
    if (this.l1Cache) {
      await this.l1Cache.put(`mem:${record.id}`, record, {
        taskId: 'persistent-memory',
        workspaceId: this.workspaceId,
        ttlMs: 300_000,
      });
    }

    return record;
  }

  /**
   * Retrieve a memory record by ID with access enforcement.
   */
  public async getMemory(id: string): Promise<MemoryRecord | null> {
    if (!id) return null;

    // Check L1 cache
    if (this.l1Cache) {
      const cached = await this.l1Cache.get<MemoryRecord>(`mem:${id}`, {
        taskId: 'persistent-memory',
        workspaceId: this.workspaceId,
      });
      if (cached) {
        return cached;
      }
    }

    const res = await this.fetchFn(`${this.backendUrl}/v1/memory/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Failed to get persistent memory '${id}' (${res.status}): ${errorBody}`);
    }

    const json = await res.json();
    const record = MemoryRecordSchema.parse(json);

    if (this.l1Cache) {
      await this.l1Cache.put(`mem:${record.id}`, record, {
        taskId: 'persistent-memory',
        workspaceId: this.workspaceId,
        ttlMs: 300_000,
      });
    }

    return record;
  }

  /**
   * Search persistent memory with authorization filtering and ranking.
   */
  public async searchMemory(
    request: Omit<MemorySearchRequest, 'tenantId' | 'workspaceId'>,
  ): Promise<MemorySearchResponse> {
    const fullRequest: MemorySearchRequest = {
      ...request,
      tenantId: this.tenantId,
      workspaceId: this.workspaceId,
    };

    const validated = MemorySearchRequestSchema.parse(fullRequest);

    const queryParams = new URLSearchParams();
    if (validated.query) queryParams.set('query', validated.query);
    if (validated.classes && validated.classes.length > 0)
      queryParams.set('classes', validated.classes.join(','));
    if (validated.tags && validated.tags.length > 0)
      queryParams.set('tags', validated.tags.join(','));
    if (validated.maxSensitivity) queryParams.set('maxSensitivity', validated.maxSensitivity);
    if (validated.minConfidence) queryParams.set('minConfidence', String(validated.minConfidence));
    if (validated.limit) queryParams.set('limit', String(validated.limit));
    if (validated.offset) queryParams.set('offset', String(validated.offset));
    if (validated.maxTokenBudget)
      queryParams.set('maxTokenBudget', String(validated.maxTokenBudget));

    const url = `${this.backendUrl}/v1/memory/search?${queryParams.toString()}`;
    const res = await this.fetchFn(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Failed to search persistent memory (${res.status}): ${errorBody}`);
    }

    const json = await res.json();
    return MemorySearchResponseSchema.parse(json);
  }

  /**
   * Update a memory record with optimistic locking.
   */
  public async updateMemory(id: string, updates: MemoryUpdateRequest): Promise<MemoryRecord> {
    const validated = MemoryUpdateRequestSchema.parse(updates);

    const res = await this.fetchFn(`${this.backendUrl}/v1/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(validated),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Failed to update persistent memory '${id}' (${res.status}): ${errorBody}`);
    }

    const json = await res.json();
    const record = MemoryRecordSchema.parse(json);

    if (this.l1Cache) {
      await this.l1Cache.remove(`mem:${id}`);
    }

    return record;
  }

  /**
   * Tombstone a memory record.
   */
  public async tombstoneMemory(
    id: string,
    expectedVersion?: number,
  ): Promise<MemoryTombstoneResponse> {
    const query = expectedVersion !== undefined ? `?expectedVersion=${expectedVersion}` : '';
    const res = await this.fetchFn(
      `${this.backendUrl}/v1/memory/${encodeURIComponent(id)}${query}`,
      {
        method: 'DELETE',
        headers: this.getHeaders(),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(
        `Failed to tombstone persistent memory '${id}' (${res.status}): ${errorBody}`,
      );
    }

    const json = await res.json();
    const result = MemoryTombstoneResponseSchema.parse(json);

    if (this.l1Cache) {
      await this.l1Cache.remove(`mem:${id}`);
    }

    return result;
  }

  /**
   * Propose a memory record awaiting review or approval.
   */
  public async proposeMemory(
    proposal: Omit<
      MemoryProposal,
      'proposalId' | 'tenantId' | 'workspaceId' | 'ownerId' | 'status' | 'createdAt'
    > & {
      ownerId?: string;
    },
  ): Promise<MemoryProposal> {
    const payload = {
      ...proposal,
      tenantId: this.tenantId,
      workspaceId: this.workspaceId,
      ownerId: proposal.ownerId || this.principalId,
    };

    const res = await this.fetchFn(`${this.backendUrl}/v1/memory/proposals`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Failed to propose memory (${res.status}): ${errorBody}`);
    }

    const json = await res.json();
    return MemoryProposalSchema.parse(json);
  }

  /**
   * Resolve a memory proposal (APPROVE or REJECT).
   */
  public async resolveProposal(
    proposalId: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ): Promise<{ proposal: MemoryProposal; memoryRecord?: MemoryRecord }> {
    const res = await this.fetchFn(
      `${this.backendUrl}/v1/memory/proposals/${encodeURIComponent(proposalId)}/decision`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ status, reason }),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(
        `Failed to resolve memory proposal '${proposalId}' (${res.status}): ${errorBody}`,
      );
    }

    const json = (await res.json()) as { proposal: unknown; memoryRecord?: unknown };
    return {
      proposal: MemoryProposalSchema.parse(json.proposal),
      memoryRecord: json.memoryRecord ? MemoryRecordSchema.parse(json.memoryRecord) : undefined,
    };
  }

  /**
   * 056-SEC-01: High-level retrieval and context assembly helper.
   * Retrieves relevant memory records, safely escapes all untrusted content, and
   * packages them into an explicit untrusted container with citation tracking.
   */
  public async retrieveAndFormatContext(
    request: Omit<MemorySearchRequest, 'tenantId' | 'workspaceId'>,
    options?: FormatRetrievedContextOptions,
  ): Promise<FormattedRetrievedContextResult & { items: MemorySearchResultItem[] }> {
    const searchResponse = await this.searchMemory(request);
    const formatted = formatRetrievedContext(searchResponse.items, options);

    return {
      ...formatted,
      items: searchResponse.items,
    };
  }
}
