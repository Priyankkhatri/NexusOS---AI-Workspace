import crypto from 'node:crypto';
import {
  EpisodicEpisode,
  EpisodicEpisodeInput,
  EpisodicEpisodeSchema,
  ProceduralPlaybookProposal,
  ProceduralPlaybookProposalInput,
  ProceduralPlaybookProposalSchema,
  PlaybookStatus,
  PlaybookStepRecipe,
  isPlaybookPlanningEligible,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  IEpisodicLearner,
  MemoryServiceContext,
  MemoryNotFoundError,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from './types.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { Logger } from '../observability/logger.js';

export interface EpisodicLearnerOptions {
  store: IMemoryStore;
  logger?: Logger;
  nowProvider?: () => string;
}

/**
 * Episodic Learner Subsystem
 * Converts completed governed task executions into immutable historical episode records
 * and synthesizes candidate procedural playbooks.
 *
 * STORED MEMORY IS DATA, NOT AUTHORITY (058-SEC-01).
 * Playbooks default to PROPOSED and require confidence >= 0.90 or explicit human approval (058-SEC-06).
 */
export class EpisodicLearner implements IEpisodicLearner {
  private readonly store: IMemoryStore;
  private readonly logger: Logger;
  private readonly now: () => string;

  constructor(options: EpisodicLearnerOptions) {
    this.store = options.store;
    this.logger = options.logger ?? new Logger('info');
    this.now = options.nowProvider ?? (() => new Date().toISOString());
  }

  /**
   * Records a completed task execution run into an episodic memory record.
   * Enforces 058-SEC-03 (tenant/workspace) and 058-SEC-07 (secret redaction).
   */
  public async recordEpisode(
    input: Omit<EpisodicEpisodeInput, 'id' | 'createdAt'>,
    ctx: MemoryServiceContext,
  ): Promise<EpisodicEpisode> {
    // 058-SEC-03: Strict tenant & workspace validation
    if (ctx.tenantId !== input.tenantId || ctx.workspaceId !== input.workspaceId) {
      throw new MemorySecurityViolationError(
        `058-SEC-03: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot record episode in (${input.tenantId}/${input.workspaceId}).`,
      );
    }

    // 058-SEC-07: Scan input for secrets before persistence
    this.assertNoSecrets(input.goal, 'Episode goal');
    this.assertNoSecrets(input.summary, 'Episode summary');
    for (const d of input.keyDecisions ?? []) {
      this.assertNoSecrets(d, 'Episode key decision');
    }
    for (const r of input.nodeReceipts ?? []) {
      if (r.outputSummary) {
        this.assertNoSecrets(r.outputSummary, `Node receipt '${r.nodeId}' output summary`);
      }
      if (r.error) {
        this.assertNoSecrets(r.error, `Node receipt '${r.nodeId}' error`);
      }
    }
    for (const h of input.humanDecisions ?? []) {
      if (h.rationale) {
        this.assertNoSecrets(h.rationale, `Human decision '${h.decisionId}' rationale`);
      }
    }

    const episodeId = `ep-${crypto.randomUUID()}`;
    const episode: EpisodicEpisode = EpisodicEpisodeSchema.parse({
      ...input,
      id: episodeId,
      createdAt: this.now(),
    });

    const saved = await this.store.saveEpisode(episode);
    this.logger.info(`Episodic record saved: ${saved.id} (Task: ${saved.taskId})`, {
      details: {
        episodeId: saved.id,
        taskId: saved.taskId,
        outcome: saved.outcome,
        receiptsCount: saved.nodeReceipts.length,
      },
    });

    return saved;
  }

  public async getEpisode(id: string, ctx: MemoryServiceContext): Promise<EpisodicEpisode | null> {
    if (!id || !ctx.tenantId || !ctx.workspaceId) return null;
    return this.store.getEpisode(id, ctx.tenantId, ctx.workspaceId);
  }

  public async listEpisodes(
    ctx: MemoryServiceContext,
    options?: { limit?: number; offset?: number },
  ): Promise<{ episodes: EpisodicEpisode[]; total: number }> {
    return this.store.listEpisodes(
      ctx.tenantId,
      ctx.workspaceId,
      options?.limit ?? 50,
      options?.offset ?? 0,
    );
  }

  /**
   * Synthesizes or proposes a procedural playbook from episodes.
   * 058-SEC-06: Playbooks MUST default to PROPOSED status.
   * They NEVER automatically become planning-eligible merely because they were observed.
   */
  public async proposePlaybook(
    input: Omit<ProceduralPlaybookProposalInput, 'id' | 'createdAt' | 'updatedAt'>,
    ctx: MemoryServiceContext,
  ): Promise<ProceduralPlaybookProposal> {
    if (ctx.tenantId !== input.tenantId || ctx.workspaceId !== input.workspaceId) {
      throw new MemorySecurityViolationError(
        `058-SEC-03: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot propose playbook in (${input.tenantId}/${input.workspaceId}).`,
      );
    }

    // 058-SEC-07: Scan candidate playbook for secrets
    this.assertNoSecrets(input.title, 'Playbook title');
    this.assertNoSecrets(input.goalPattern, 'Playbook goal pattern');
    if (input.description) {
      this.assertNoSecrets(input.description, 'Playbook description');
    }
    for (const step of input.steps) {
      this.assertNoSecrets(step.description, `Playbook step ${step.stepIndex} description`);
      if (step.expectedInputs) {
        for (const [key, val] of Object.entries(step.expectedInputs)) {
          if (typeof val === 'string') {
            this.assertNoSecrets(val, `Playbook step ${step.stepIndex} parameter '${key}'`);
          }
        }
      }
    }

    // 058-SEC-06: Force default to PROPOSED unless explicitly set
    const status = input.status ?? PlaybookStatus.PROPOSED;

    const playbookId = `pb-${crypto.randomUUID()}`;
    const playbook: ProceduralPlaybookProposal = ProceduralPlaybookProposalSchema.parse({
      ...input,
      id: playbookId,
      status,
      createdAt: this.now(),
      updatedAt: this.now(),
    });

    const saved = await this.store.savePlaybook(playbook);
    this.logger.info(
      `Procedural playbook proposal created: ${saved.id} (Status: ${saved.status})`,
      {
        details: {
          playbookId: saved.id,
          confidence: saved.confidence,
          planningEligible: isPlaybookPlanningEligible(saved),
        },
      },
    );

    return saved;
  }

  /**
   * Explicit human approval of a procedural playbook.
   * Reuses human-in-the-loop decision semantics (Task 052 authority) to grant planning eligibility.
   */
  public async approvePlaybook(
    playbookId: string,
    approval: { approvedBy: string; notes?: string },
    ctx: MemoryServiceContext,
  ): Promise<ProceduralPlaybookProposal> {
    const existing = await this.store.getPlaybook(playbookId, ctx.tenantId, ctx.workspaceId);
    if (!existing) {
      throw new MemoryNotFoundError(`Playbook proposal '${playbookId}' not found in workspace.`);
    }

    const updated: ProceduralPlaybookProposal = {
      ...existing,
      status: PlaybookStatus.APPROVED,
      humanApproval: {
        approvedBy: approval.approvedBy,
        approvedAt: this.now(),
        approvalId: `appr-${crypto.randomUUID()}`,
        notes: approval.notes,
      },
      updatedAt: this.now(),
    };

    const saved = await this.store.savePlaybook(updated);
    this.logger.info(`Procedural playbook approved by human: ${saved.id}`, {
      details: {
        playbookId: saved.id,
        approvedBy: approval.approvedBy,
      },
    });

    return saved;
  }

  public async getPlaybook(
    playbookId: string,
    ctx: MemoryServiceContext,
  ): Promise<ProceduralPlaybookProposal | null> {
    return this.store.getPlaybook(playbookId, ctx.tenantId, ctx.workspaceId);
  }

  public async listPlaybooks(
    ctx: MemoryServiceContext,
    options?: { planningEligibleOnly?: boolean },
  ): Promise<ProceduralPlaybookProposal[]> {
    return this.store.listPlaybooks(ctx.tenantId, ctx.workspaceId, options);
  }

  /**
   * Helper to derive step recipes from executed node receipts.
   */
  public static extractStepRecipesFromReceipts(
    receipts: EpisodicEpisode['nodeReceipts'],
  ): PlaybookStepRecipe[] {
    return receipts
      .filter((r) => r.status === 'COMPLETED')
      .map((r, idx) => ({
        stepIndex: idx,
        capability: r.capability,
        description: `Execute capability ${r.capability}${r.outputSummary ? `: ${r.outputSummary.slice(0, 80)}` : ''}`,
        suggestedRiskTier: 'LOW',
      }));
  }

  private assertNoSecrets(text: string, contextDescription: string): void {
    const scan = RedactionFilter.scanForSecrets(text);
    if (scan.found) {
      throw new MemorySecretDetectedError(
        `058-SEC-07: ${contextDescription} contains prohibited secret/credential data (${scan.secretTypes.join(', ')}). Persistent storage rejected fail-closed.`,
      );
    }
  }
}
