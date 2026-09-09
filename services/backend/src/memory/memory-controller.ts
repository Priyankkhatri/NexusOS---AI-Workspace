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
}
