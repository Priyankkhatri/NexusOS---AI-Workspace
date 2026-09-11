import {
  EvolutionDeliveryStatus,
  EvolutionOutboxRecord,
  EvolutionOutboxRecordInput,
  EvolutionReceipt,
  GraphExtractionResult,
  MemoryStatus,
  OUTBOX_MAX_ATTEMPTS_DEFAULT,
  computeOutboxBackoffMs,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  IGraphEvolutionEngine,
  IMemoryEvolutionProcessor,
  MemoryServiceContext,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from './types.js';
import { Logger } from '../observability/logger.js';

export interface MemoryEvolutionProcessorOptions {
  store: IMemoryStore;
  engine: IGraphEvolutionEngine;
  logger?: Logger;
  nowProvider?: () => string;
  maxAttempts?: number;
}

/**
 * In-Process Transactional Outbox Processor (Task 066 Phase 3 Hardening)
 *
 * Guarantees at-least-once delivery with deterministic idempotent convergence
 * for knowledge graph evolution.
 *
 * Invariants Enforced:
 * - 066-P3-R-01: Atomic registration & recovery of evolution work.
 * - 066-P3-R-03: Duplicate delivery is idempotent.
 * - 066-P3-R-05: Restart recovery processes pending/retryable work.
 * - 066-P3-R-07: Re-enters GraphEvolutionEngine governance (no bypass).
 * - 066-P3-R-08: Tenant/workspace boundaries survive outbox lifecycle.
 */
export class MemoryEvolutionProcessor implements IMemoryEvolutionProcessor {
  private readonly store: IMemoryStore;
  private readonly engine: IGraphEvolutionEngine;
  private readonly logger: Logger;
  private readonly now: () => string;
  private readonly maxAttempts: number;

  constructor(options: MemoryEvolutionProcessorOptions) {
    this.store = options.store;
    this.engine = options.engine;
    this.logger = options.logger ?? new Logger('info');
    this.now = options.nowProvider ?? (() => new Date().toISOString());
    this.maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS_DEFAULT;
  }

  /**
   * Process a single outbox record with optimistic leasing, governance re-entry,
   * bounded retries, and dead-letter handling.
   */
  public async processRecord(
    outboxRecord: EvolutionOutboxRecord | EvolutionOutboxRecordInput,
    callerCtx?: MemoryServiceContext,
  ): Promise<EvolutionReceipt> {
    const tenantId = outboxRecord.tenantId;
    const workspaceId = outboxRecord.workspaceId;
    const recordId = outboxRecord.id;

    // 1. Check if already completed (Idempotency)
    if (outboxRecord.status === EvolutionDeliveryStatus.COMPLETED) {
      return {
        evolutionId: outboxRecord.id,
        tenantId,
        workspaceId,
        memoryRecordId: outboxRecord.memoryRecordId,
        memoryVersion: outboxRecord.memoryVersion,
        acceptedNodes: [],
        acceptedEdges: [],
        supersededNodeIds: [],
        supersededEdgeIds: [],
        rejectedNodes: [],
        rejectedEdges: [],
        evolvedAt: this.now(),
        executionDurationMs: 0,
        idempotentSkip: true,
      };
    }

    // 2. Claim the record to prevent concurrent processing (Atomic claim)
    if (this.store.claimOutboxRecord) {
      const claimed = await this.store.claimOutboxRecord(recordId, tenantId, workspaceId);
      if (!claimed) {
        // Another concurrent worker claimed it or it is not eligible
        return {
          evolutionId: outboxRecord.id,
          tenantId,
          workspaceId,
          memoryRecordId: outboxRecord.memoryRecordId,
          memoryVersion: outboxRecord.memoryVersion,
          acceptedNodes: [],
          acceptedEdges: [],
          supersededNodeIds: [],
          supersededEdgeIds: [],
          rejectedNodes: [],
          rejectedEdges: [],
          evolvedAt: this.now(),
          executionDurationMs: 0,
          idempotentSkip: true,
        };
      }
    }

    // 3. Re-verify Tenant & Workspace Isolation (066-P3-R-08)
    const ctx: MemoryServiceContext = callerCtx ?? {
      tenantId,
      workspaceId,
      principalId: 'system:evolution-processor',
      roles: ['system'],
    };

    if (ctx.tenantId !== tenantId || ctx.workspaceId !== workspaceId) {
      const errorMsg = `066-P3-R-08: Security boundary mismatch between context (${ctx.tenantId}/${ctx.workspaceId}) and outbox record (${tenantId}/${workspaceId}).`;
      if (this.store.updateOutboxStatus) {
        await this.store.updateOutboxStatus(recordId, tenantId, workspaceId, {
          status: EvolutionDeliveryStatus.DEAD_LETTER,
          lastError: errorMsg,
          processedAt: this.now(),
        });
      }
      throw new MemorySecurityViolationError(errorMsg);
    }

    try {
      // 4. Validate Parent Memory Record Liveness & Status (066-P3-R-07)
      const parentRecord = await this.store.getById(
        outboxRecord.memoryRecordId,
        tenantId,
        workspaceId,
      );

      if (!parentRecord) {
        const errorMsg = `066-P3-SEC-04: Cannot evolve graph for non-existent or TOMBSTONED parent memory record '${outboxRecord.memoryRecordId}'.`;
        if (this.store.updateOutboxStatus) {
          await this.store.updateOutboxStatus(recordId, tenantId, workspaceId, {
            status: EvolutionDeliveryStatus.DEAD_LETTER,
            lastError: errorMsg,
            processedAt: this.now(),
          });
        }
        throw new MemorySecurityViolationError(errorMsg);
      }

      if (parentRecord.status !== MemoryStatus.ACTIVE) {
        const errorMsg = `066-P3-SEC-04: Cannot evolve graph from inactive parent memory record '${parentRecord.id}' (status: ${parentRecord.status}).`;
        if (this.store.updateOutboxStatus) {
          await this.store.updateOutboxStatus(recordId, tenantId, workspaceId, {
            status: EvolutionDeliveryStatus.DEAD_LETTER,
            lastError: errorMsg,
            processedAt: this.now(),
          });
        }
        throw new MemorySecurityViolationError(errorMsg);
      }

      // 5. Extract or resolve candidate fact payload
      let candidates: GraphExtractionResult;
      const rawPayload = outboxRecord.evolutionPayload as
        | { candidates?: GraphExtractionResult }
        | undefined;
      if (rawPayload?.candidates && Array.isArray(rawPayload.candidates.nodes)) {
        candidates = rawPayload.candidates;
      } else {
        // Fallback to extracting from parent via engine's extractor
        const extractor = (this.engine as any).getExtractor?.();
        if (extractor) {
          candidates = await extractor.extract(parentRecord);
        } else {
          throw new Error(
            `Outbox record ${recordId} has no candidate payload and extractor is unavailable.`,
          );
        }
      }

      // 6. Invoke Governed GraphEvolutionEngine (066-P3-R-07 Governance Re-entry)
      const receipt = await this.engine.evolveCandidates(parentRecord, candidates, ctx, {
        evolutionId: outboxRecord.id,
      });

      // 7. Mark Outbox Record COMPLETED upon successful persistence
      if (this.store.updateOutboxStatus) {
        await this.store.updateOutboxStatus(recordId, tenantId, workspaceId, {
          status: EvolutionDeliveryStatus.COMPLETED,
          processedAt: this.now(),
          lastError: null,
        });
      }

      this.logger.info(`Outbox evolution successfully completed: ${recordId}`, {
        details: {
          outboxId: recordId,
          memoryId: parentRecord.id,
          memoryVersion: parentRecord.version,
          idempotentSkip: receipt.idempotentSkip,
        },
      });

      return receipt;
    } catch (err) {
      const isSecurityError =
        err instanceof MemorySecurityViolationError || err instanceof MemorySecretDetectedError;

      const currentAttempts = (outboxRecord.attemptCount ?? 0) + 1;
      const maxAttempts = outboxRecord.maxAttempts ?? this.maxAttempts;
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (isSecurityError || currentAttempts >= maxAttempts) {
        // Permanent failure -> Mark DEAD_LETTER (never discarded silently)
        if (this.store.updateOutboxStatus) {
          await this.store.updateOutboxStatus(recordId, tenantId, workspaceId, {
            status: EvolutionDeliveryStatus.DEAD_LETTER,
            attemptCount: currentAttempts,
            lastError: errorMessage,
            processedAt: this.now(),
          });
        }
        this.logger.error(`Outbox evolution failed permanently -> DEAD_LETTER: ${recordId}`, {
          details: {
            outboxId: recordId,
            attempts: currentAttempts,
            maxAttempts,
            error: errorMessage,
          },
        });
      } else {
        // Transient failure -> Schedule bounded retry with exponential backoff
        const backoffMs = computeOutboxBackoffMs(currentAttempts);
        const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

        if (this.store.updateOutboxStatus) {
          await this.store.updateOutboxStatus(recordId, tenantId, workspaceId, {
            status: EvolutionDeliveryStatus.FAILED,
            attemptCount: currentAttempts,
            nextAttemptAt,
            lastError: errorMessage,
          });
        }
        this.logger.warn(
          `Outbox evolution transiently failed -> FAILED (retry scheduled): ${recordId}`,
          {
            details: {
              outboxId: recordId,
              attempts: currentAttempts,
              nextAttemptAt,
              backoffMs,
              error: errorMessage,
            },
          },
        );
      }

      throw err;
    }
  }

  /**
   * Drain eligible pending, retryable failed, and expired lease records.
   * Bound by limit to prevent busy looping or resource exhaustion.
   */
  public async drainPending(options?: {
    tenantId?: string;
    workspaceId?: string;
    limit?: number;
    ignoreLeaseTimeout?: boolean;
  }): Promise<{ processed: number; completed: number; failed: number }> {
    if (!this.store.listPendingOutboxRecords) {
      return { processed: 0, completed: 0, failed: 0 };
    }

    const limit = Math.min(options?.limit ?? 50, 100);
    const eligibleRecords = await this.store.listPendingOutboxRecords({
      tenantId: options?.tenantId,
      workspaceId: options?.workspaceId,
      limit,
      ignoreLeaseTimeout: options?.ignoreLeaseTimeout,
    });

    let completed = 0;
    let failed = 0;

    for (const record of eligibleRecords) {
      try {
        await this.processRecord(record);
        completed++;
      } catch (err) {
        failed++;
        this.logger.warn(`Failed draining outbox record ${record.id}: ${String(err)}`);
      }
    }

    return {
      processed: eligibleRecords.length,
      completed,
      failed,
    };
  }
}
