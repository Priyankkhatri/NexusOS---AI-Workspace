import crypto from 'node:crypto';
import {
  MemoryRecord,
  MemoryCreateRequest,
  MemoryCreateRequestSchema,
  MemoryUpdateRequest,
  MemoryUpdateRequestSchema,
  MemorySearchRequest,
  MemorySearchRequestSchema,
  MemorySearchResponse,
  MemorySearchResultItem,
  MemoryProposal,
  MemoryTombstoneResponse,
  MemoryStatus,
  estimateTokenCount,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  MemoryServiceContext,
  MemoryNotFoundError,
  MemorySecurityViolationError,
} from './types.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { Logger } from '../observability/logger.js';

export interface MemoryServiceOptions {
  store: IMemoryStore;
  logger?: Logger;
  nowProvider?: () => string;
}

export class MemoryService {
  private readonly store: IMemoryStore;
  private readonly logger: Logger;
  private readonly now: () => string;

  constructor(options: MemoryServiceOptions) {
    this.store = options.store;
    this.logger = options.logger ?? new Logger('info');
    this.now = options.nowProvider ?? (() => new Date().toISOString());
  }

  /**
   * 056-SEC-02: Enforces that context and request share identical tenant and workspace.
   */
  private assertTenantAndWorkspaceMatch(
    context: MemoryServiceContext,
    target: { tenantId?: string; workspaceId?: string },
  ): void {
    if (!context.tenantId || !context.workspaceId) {
      throw new MemorySecurityViolationError(
        '056-SEC-02: Missing required tenantId or workspaceId in caller context.',
      );
    }
    if (target.tenantId && target.tenantId !== context.tenantId) {
      throw new MemorySecurityViolationError(
        `056-SEC-02: Tenant mismatch. Caller tenant '${context.tenantId}' cannot access '${target.tenantId}'.`,
      );
    }
    if (target.workspaceId && target.workspaceId !== context.workspaceId) {
      throw new MemorySecurityViolationError(
        `056-SEC-02: Workspace mismatch. Caller workspace '${context.workspaceId}' cannot access '${target.workspaceId}'.`,
      );
    }
  }

  /**
   * Create a canonical persistent memory record.
   * Enforces 056-SEC-02 (tenant/workspace), 056-SEC-03 (secrets), and 056-SEC-04 (provenance).
   */
  public async createMemory(
    request: MemoryCreateRequest,
    context: MemoryServiceContext,
  ): Promise<MemoryRecord> {
    const validated = MemoryCreateRequestSchema.parse(request);
    this.assertTenantAndWorkspaceMatch(context, validated);

    // 056-SEC-03: Secret Sanitization — block material secrets fail-closed
    RedactionFilter.assertNoSecrets(validated.content, 'Memory record content');
    if (validated.title) {
      RedactionFilter.assertNoSecrets(validated.title, 'Memory record title');
    }
    if (validated.summary) {
      RedactionFilter.assertNoSecrets(validated.summary, 'Memory record summary');
    }

    // 056-SEC-04: Provenance Integrity
    if (validated.provenance.sourceType === 'TASK_EXECUTION' && !validated.provenance.sourceId) {
      throw new MemorySecurityViolationError(
        '056-SEC-04: Memory records with TASK_EXECUTION provenance must specify a valid sourceId (taskId).',
      );
    }

    // Autonomous memories without user verification or explicit receipt cannot be set to ACTIVE directly
    if (
      validated.provenance.sourceType === 'SYSTEM_SYNTHESIS' &&
      !validated.provenance.verified &&
      validated.status === MemoryStatus.ACTIVE
    ) {
      throw new MemorySecurityViolationError(
        '056-SEC-04: Unverified autonomous memory synthesis must be submitted as PROPOSED, not ACTIVE.',
      );
    }

    const now = this.now();
    const memoryId = crypto.randomUUID();

    const record: MemoryRecord = {
      ...validated,
      id: memoryId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.store.create(record);

    this.logger.info(`Persistent memory record created: ${saved.id}`, {
      details: {
        memoryId: saved.id,
        tenantId: saved.tenantId,
        workspaceId: saved.workspaceId,
        class: saved.class,
        sensitivity: saved.sensitivity,
        confidence: saved.confidence,
        provenanceType: saved.provenance.sourceType,
      },
    });

    return saved;
  }

  /**
   * Read memory record by ID with access and boundary checks.
   * 056-SEC-02: Non-disclosing null if belongs to different tenant or workspace.
   * 056-SEC-05: Excludes tombstoned or expired records.
   */
  public async getMemory(id: string, context: MemoryServiceContext): Promise<MemoryRecord | null> {
    if (!id || !context.tenantId || !context.workspaceId) {
      return null;
    }

    const record = await this.store.getById(id, context.tenantId, context.workspaceId);
    if (!record) {
      return null;
    }

    // Secondary isolation verification
    if (record.tenantId !== context.tenantId || record.workspaceId !== context.workspaceId) {
      return null;
    }

    return record;
  }

  /**
   * Search memory records with authorization filtering, lexical ranking, and token budgeting.
   */
  public async searchMemory(
    request: MemorySearchRequest,
    context: MemoryServiceContext,
  ): Promise<MemorySearchResponse> {
    const validated = MemorySearchRequestSchema.parse(request);
    this.assertTenantAndWorkspaceMatch(context, validated);

    // Call store search (which already filters out tombstones, expired, wrong tenant/workspace)
    const { records, total } = await this.store.search(validated);

    const terms = validated.query ? validated.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const nowMs = new Date(this.now()).getTime();

    const scoredItems: MemorySearchResultItem[] = records.map((rec) => {
      // 1. Lexical score calculation
      let lexicalScore = 0.5;
      if (terms.length > 0) {
        let hits = 0;
        const text =
          `${rec.title ?? ''} ${rec.content} ${rec.summary ?? ''} ${rec.tags.join(' ')}`.toLowerCase();
        for (const term of terms) {
          if (text.includes(term)) hits++;
        }
        lexicalScore = Math.min(1.0, hits / terms.length);
      }

      // 2. Recency score calculation (half-life of 30 days)
      const ageDays = Math.max(
        0,
        (nowMs - new Date(rec.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      const recencyScore = Math.max(0.1, Math.exp(-ageDays / 30));

      // 3. Semantic score (offline fallback - no external embedding fabricated)
      const semanticScore = 0.0;

      // Overall composite score
      const combinedScore =
        terms.length > 0 ? 0.7 * lexicalScore + 0.3 * recencyScore : recencyScore;
      const score = Math.min(1.0, Math.max(0.0, combinedScore * rec.confidence));

      const citationToken = `CIT-${rec.id.slice(0, 8)}`;
      const estimatedTokens =
        estimateTokenCount(rec.content) + estimateTokenCount(rec.title ?? '') + 15;

      return {
        record: rec,
        score,
        lexicalScore,
        semanticScore,
        recencyScore,
        citationToken,
        estimatedTokens,
      };
    });

    // Sort descending by score
    scoredItems.sort((a, b) => b.score - a.score);

    // Budget packing if maxTokenBudget is requested
    let consumedTokens = 0;
    const budgetedItems: MemorySearchResultItem[] = [];

    const tokenBudget = validated.maxTokenBudget;
    for (const item of scoredItems) {
      if (tokenBudget !== undefined && consumedTokens + item.estimatedTokens > tokenBudget) {
        if (budgetedItems.length === 0) {
          // Allow at least one result if possible, or break
          budgetedItems.push(item);
          consumedTokens += item.estimatedTokens;
        }
        break;
      }
      budgetedItems.push(item);
      consumedTokens += item.estimatedTokens;
    }

    return {
      items: budgetedItems,
      total,
      retrievalMode: 'LEXICAL',
      query: validated.query,
      consumedTokenBudget: consumedTokens,
    };
  }

  /**
   * Update memory record with optimistic locking.
   * 056-SEC-06: Monotonic versioning and conflict detection.
   */
  public async updateMemory(
    id: string,
    request: MemoryUpdateRequest,
    context: MemoryServiceContext,
  ): Promise<MemoryRecord> {
    const validated = MemoryUpdateRequestSchema.parse(request);

    // Secret sanitization on updated content
    if (validated.content) {
      RedactionFilter.assertNoSecrets(validated.content, 'Updated memory content');
    }
    if (validated.title) {
      RedactionFilter.assertNoSecrets(validated.title, 'Updated memory title');
    }
    if (validated.summary) {
      RedactionFilter.assertNoSecrets(validated.summary, 'Updated memory summary');
    }

    const updated = await this.store.update(
      id,
      context.tenantId,
      context.workspaceId,
      validated,
      validated.expectedVersion,
    );

    this.logger.info(`Persistent memory record updated: ${updated.id}`, {
      details: {
        memoryId: updated.id,
        tenantId: updated.tenantId,
        workspaceId: updated.workspaceId,
        version: updated.version,
      },
    });

    return updated;
  }

  /**
   * Tombstone (soft-delete) a memory record.
   * 056-SEC-05: Record is immediately excluded from search and read.
   */
  public async tombstoneMemory(
    id: string,
    context: MemoryServiceContext,
    expectedVersion?: number,
  ): Promise<MemoryTombstoneResponse> {
    if (!id) {
      throw new MemoryNotFoundError(id);
    }

    const tombstonedAt = this.now();
    const result = await this.store.tombstone(
      id,
      context.tenantId,
      context.workspaceId,
      tombstonedAt,
      expectedVersion,
    );

    this.logger.info(`Persistent memory record tombstoned: ${result.id}`, {
      details: {
        memoryId: result.id,
        tenantId: result.tenantId,
        workspaceId: result.workspaceId,
        tombstonedAt,
        version: result.version,
      },
    });

    return {
      memoryId: result.id,
      status: MemoryStatus.TOMBSTONED,
      tombstonedAt,
      version: result.version,
      tenantId: result.tenantId,
      workspaceId: result.workspaceId,
    };
  }

  /**
   * Propose a memory record awaiting explicit approval or review.
   */
  public async proposeMemory(
    proposal: Omit<MemoryProposal, 'proposalId' | 'status' | 'createdAt'>,
    context: MemoryServiceContext,
  ): Promise<MemoryProposal> {
    this.assertTenantAndWorkspaceMatch(context, proposal);

    RedactionFilter.assertNoSecrets(proposal.content, 'Proposed memory content');
    if (proposal.title) {
      RedactionFilter.assertNoSecrets(proposal.title, 'Proposed memory title');
    }

    const fullProposal: MemoryProposal = {
      ...proposal,
      proposalId: crypto.randomUUID(),
      status: 'PENDING',
      createdAt: this.now(),
    };

    const saved = await this.store.saveProposal(fullProposal);

    this.logger.info(`Memory proposal submitted: ${saved.proposalId}`, {
      details: {
        proposalId: saved.proposalId,
        tenantId: saved.tenantId,
        workspaceId: saved.workspaceId,
        class: saved.class,
        confidence: saved.confidence,
      },
    });

    return saved;
  }

  /**
   * Resolve a memory proposal (APPROVE or REJECT).
   * If APPROVED, persists the memory record as ACTIVE.
   */
  public async resolveProposal(
    proposalId: string,
    status: 'APPROVED' | 'REJECTED',
    context: MemoryServiceContext,
    reason?: string,
  ): Promise<{ proposal: MemoryProposal; memoryRecord?: MemoryRecord }> {
    const existing = await this.store.getProposal(
      proposalId,
      context.tenantId,
      context.workspaceId,
    );
    if (!existing) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    const updatedProposal = await this.store.updateProposal(
      proposalId,
      context.tenantId,
      context.workspaceId,
      status,
      context.principalId,
      this.now(),
      reason,
    );

    let createdRecord: MemoryRecord | undefined;
    if (status === 'APPROVED') {
      const createReq: MemoryCreateRequest = {
        tenantId: updatedProposal.tenantId,
        workspaceId: updatedProposal.workspaceId,
        ownerId: updatedProposal.ownerId,
        class: updatedProposal.class,
        content: updatedProposal.content,
        title: updatedProposal.title,
        confidence: updatedProposal.confidence,
        sensitivity: updatedProposal.sensitivity,
        tags: [],
        metadata: {},
        provenance: {
          ...updatedProposal.provenance,
          verified: true,
        },
        retentionPolicy: updatedProposal.suggestedTtlSeconds
          ? { ttlSeconds: updatedProposal.suggestedTtlSeconds }
          : undefined,
        status: MemoryStatus.ACTIVE,
      };

      createdRecord = await this.createMemory(createReq, context);
    }

    return { proposal: updatedProposal, memoryRecord: createdRecord };
  }
}
