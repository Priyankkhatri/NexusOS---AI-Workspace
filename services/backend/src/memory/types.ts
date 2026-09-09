import { MemoryRecord, MemorySearchRequest, MemoryProposal } from '@nexusos/contracts';

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
