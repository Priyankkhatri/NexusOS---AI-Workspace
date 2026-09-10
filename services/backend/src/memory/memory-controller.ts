import {
  MemoryRecord,
  MemoryCreateRequest,
  MemoryUpdateRequest,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryProposal,
  MemoryTombstoneResponse,
} from '@nexusos/contracts';
import { MemoryService } from './memory-service.js';
import { MemoryServiceContext } from './types.js';
import { AuthenticatedContextLike } from '../tasks/controller.js';

export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  private extractContext(
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): MemoryServiceContext {
    const principalId =
      authContext.principal.userId ||
      authContext.principal.serviceId ||
      authContext.principal.deviceId ||
      'anonymous';

    return {
      tenantId: authContext.tenantId,
      workspaceId: workspaceIdHeader || 'default',
      principalId,
      roles: authContext.principal.roles,
    };
  }

  public async createMemory(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): Promise<MemoryRecord> {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;

    // Ensure tenantId and workspaceId match authenticated context
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    if (!payload.ownerId) {
      payload.ownerId = context.principalId;
    }

    return this.memoryService.createMemory(payload as unknown as MemoryCreateRequest, context);
  }

  public async getMemory(
    id: string,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): Promise<MemoryRecord | null> {
    const context = this.extractContext(authContext, workspaceIdHeader);
    return this.memoryService.getMemory(id, context);
  }

  public async searchMemory(
    rawQuery: Record<string, unknown>,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): Promise<MemorySearchResponse> {
    const context = this.extractContext(authContext, workspaceIdHeader);

    // Normalize search query
    const searchReq: Record<string, unknown> = {
      ...rawQuery,
      tenantId: context.tenantId,
      workspaceId: (rawQuery.workspaceId as string) || context.workspaceId,
    };

    if (rawQuery.limit) {
      searchReq.limit = Number(rawQuery.limit);
    }
    if (rawQuery.offset) {
      searchReq.offset = Number(rawQuery.offset);
    }
    if (rawQuery.minConfidence) {
      searchReq.minConfidence = Number(rawQuery.minConfidence);
    }
    if (rawQuery.maxTokenBudget) {
      searchReq.maxTokenBudget = Number(rawQuery.maxTokenBudget);
    }
    if (typeof rawQuery.classes === 'string') {
      searchReq.classes = (rawQuery.classes as string).split(',').map((c) => c.trim());
    }
    if (typeof rawQuery.tags === 'string') {
      searchReq.tags = (rawQuery.tags as string).split(',').map((t) => t.trim());
    }

    return this.memoryService.searchMemory(searchReq as unknown as MemorySearchRequest, context);
  }

  public async updateMemory(
    id: string,
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): Promise<MemoryRecord> {
    const context = this.extractContext(authContext, workspaceIdHeader);
    return this.memoryService.updateMemory(id, body as unknown as MemoryUpdateRequest, context);
  }

  public async tombstoneMemory(
    id: string,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
    expectedVersion?: number,
  ): Promise<MemoryTombstoneResponse> {
    const context = this.extractContext(authContext, workspaceIdHeader);
    return this.memoryService.tombstoneMemory(id, context, expectedVersion);
  }

  public async proposeMemory(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): Promise<MemoryProposal> {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    if (!payload.ownerId) {
      payload.ownerId = context.principalId;
    }

    return this.memoryService.proposeMemory(
      payload as unknown as Omit<MemoryProposal, 'proposalId' | 'status' | 'createdAt'>,
      context,
    );
  }

  public async resolveProposal(
    proposalId: string,
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ): Promise<{ proposal: MemoryProposal; memoryRecord?: MemoryRecord }> {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const { status, reason } = (body || {}) as { status: 'APPROVED' | 'REJECTED'; reason?: string };
    return this.memoryService.resolveProposal(proposalId, status, context, reason);
  }

  // -------------------------------------------------------------------------
  // Task 058 Controller Handlers
  // -------------------------------------------------------------------------

  public async compressMemories(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    return this.memoryService.compressMemories(payload as any, context);
  }

  public async recordEpisode(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    return this.memoryService.recordEpisode(payload as any, context);
  }

  public async getEpisode(
    id: string,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    return this.memoryService.getEpisode(id, context);
  }

  public async listEpisodes(
    query: Record<string, unknown>,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const limit = query.limit ? parseInt(String(query.limit), 10) : undefined;
    const offset = query.offset ? parseInt(String(query.offset), 10) : undefined;
    return this.memoryService.listEpisodes(context, { limit, offset });
  }

  public async proposePlaybook(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    return this.memoryService.proposePlaybook(payload as any, context);
  }

  public async approvePlaybook(
    id: string,
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const { approvedBy, notes } = (body || {}) as { approvedBy?: string; notes?: string };
    return this.memoryService.approvePlaybook(
      id,
      { approvedBy: approvedBy || context.principalId, notes },
      context,
    );
  }

  public async listPlaybooks(
    query: Record<string, unknown>,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const planningEligibleOnly =
      query.planningEligibleOnly === 'true' || query.planningEligibleOnly === true;
    return this.memoryService.listPlaybooks(context, { planningEligibleOnly });
  }

  public async queryGraph(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    return this.memoryService.queryGraph(payload as any, context);
  }

  // -------------------------------------------------------------------------
  // Task 062 Vector Operations (062-SEC-01, 062-SEC-06)
  // -------------------------------------------------------------------------

  public async saveVector(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    return this.memoryService.saveVector(payload as any, context);
  }

  public async getVector(
    memoryRecordId: string,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    return this.memoryService.getVector(memoryRecordId, context);
  }

  public async deleteVector(
    memoryRecordId: string,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const success = await this.memoryService.deleteVector(memoryRecordId, context);
    return { success };
  }

  public async searchVectors(
    body: unknown,
    authContext: AuthenticatedContextLike,
    workspaceIdHeader?: string,
  ) {
    const context = this.extractContext(authContext, workspaceIdHeader);
    const payload = (body && typeof body === 'object' ? { ...body } : {}) as Record<
      string,
      unknown
    >;
    payload.tenantId = context.tenantId;
    if (!payload.workspaceId) {
      payload.workspaceId = context.workspaceId;
    }
    if (payload.topK !== undefined) {
      payload.topK = Math.min(Math.max(1, Number(payload.topK)), 50);
    }
    return this.memoryService.searchVectors(payload as any, context);
  }

  public getService(): MemoryService {
    return this.memoryService;
  }
}
