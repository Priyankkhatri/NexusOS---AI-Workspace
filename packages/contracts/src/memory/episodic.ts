import { z } from 'zod';
import {
  MemoryProvenanceSchema,
  MemoryRetentionPolicySchema,
  MemorySensitivity,
  MemorySensitivitySchema,
} from './base.js';

// ---------------------------------------------------------------------------
// 1. Episode Outcomes & Node Receipt Summaries
// ---------------------------------------------------------------------------

export enum EpisodeOutcome {
  SUCCESS = 'SUCCESS',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
  FAILED = 'FAILED',
}

export const EpisodeOutcomeSchema = z.nativeEnum(EpisodeOutcome);

export const NodeReceiptSummarySchema = z.object({
  nodeId: z.string().min(1),
  capability: z.string().min(1),
  status: z.enum(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED']),
  durationMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  evidenceHash: z.string().optional(),
  outputSummary: z.string().max(2048).optional(),
});

export type NodeReceiptSummary = z.infer<typeof NodeReceiptSummarySchema>;

export const HumanDecisionRecordSchema = z.object({
  decisionId: z.string().min(1),
  action: z.enum(['APPROVED', 'DENIED', 'TIMED_OUT']),
  principalId: z.string().min(1),
  scope: z.string().optional(),
  timestamp: z.string().datetime(),
  rationale: z.string().max(1024).optional(),
});

export type HumanDecisionRecord = z.infer<typeof HumanDecisionRecordSchema>;

// ---------------------------------------------------------------------------
// 2. Episodic Episode Contract
// ---------------------------------------------------------------------------

export const EpisodicEpisodeSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  executionId: z.string().optional(),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  goal: z.string().min(1),
  planGraphVersion: z.number().int().positive().default(1),
  outcome: EpisodeOutcomeSchema,
  summary: z.string().min(1),
  nodeReceipts: z.array(NodeReceiptSummarySchema).default([]),
  humanDecisions: z.array(HumanDecisionRecordSchema).default([]),
  keyDecisions: z.array(z.string()).default([]),
  errorPatterns: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  sensitivity: MemorySensitivitySchema.default(MemorySensitivity.INTERNAL),
  provenance: MemoryProvenanceSchema,
  retentionPolicy: MemoryRetentionPolicySchema.optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type EpisodicEpisode = z.infer<typeof EpisodicEpisodeSchema>;
export type EpisodicEpisodeInput = z.input<typeof EpisodicEpisodeSchema>;

// ---------------------------------------------------------------------------
// 3. Procedural Playbook Proposals & Governed Eligibility (058-SEC-06)
// ---------------------------------------------------------------------------

export enum PlaybookStatus {
  PROPOSED = 'PROPOSED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PLANNING_ELIGIBLE = 'PLANNING_ELIGIBLE',
}

export const PlaybookStatusSchema = z.nativeEnum(PlaybookStatus);

export const PlaybookStepRecipeSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  capability: z.string().min(1),
  description: z.string().min(1),
  suggestedRiskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW'),
  expectedInputs: z.record(z.unknown()).optional(),
});

export type PlaybookStepRecipe = z.infer<typeof PlaybookStepRecipeSchema>;

export const PlaybookApprovalSchema = z.object({
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
  approvalId: z.string().min(1),
  notes: z.string().optional(),
});

export type PlaybookApproval = z.infer<typeof PlaybookApprovalSchema>;

export const ProceduralPlaybookProposalSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(256),
  goalPattern: z.string().min(1),
  description: z.string().optional(),
  status: PlaybookStatusSchema.default(PlaybookStatus.PROPOSED),
  confidence: z.number().min(0).max(1),
  steps: z.array(PlaybookStepRecipeSchema).min(1),
  sourceEpisodeIds: z.array(z.string().min(1)).min(1),
  successCount: z.number().int().nonnegative().default(1),
  failureCount: z.number().int().nonnegative().default(0),
  humanApproval: PlaybookApprovalSchema.optional(),
  sensitivity: MemorySensitivitySchema.default(MemorySensitivity.INTERNAL),
  provenance: MemoryProvenanceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProceduralPlaybookProposal = z.infer<typeof ProceduralPlaybookProposalSchema>;
export type ProceduralPlaybookProposalInput = z.input<typeof ProceduralPlaybookProposalSchema>;

/**
 * 058-SEC-06: Playbooks derived from episodes MUST default to PROPOSED.
 * They MUST NOT automatically become planning-eligible merely because they were observed repeatedly.
 * Planning eligibility requires:
 *   confidence >= 0.90
 *   OR
 *   explicit human approval.
 */
export function isPlaybookPlanningEligible(playbook: ProceduralPlaybookProposal): boolean {
  if (playbook.status === PlaybookStatus.REJECTED) {
    return false;
  }

  // Explicit human approval grants eligibility
  if (playbook.status === PlaybookStatus.APPROVED || playbook.humanApproval) {
    return true;
  }

  // Explicit status set
  if (playbook.status === PlaybookStatus.PLANNING_ELIGIBLE) {
    return true;
  }

  // Automatic high-confidence threshold requirement
  if (playbook.confidence >= 0.9) {
    return true;
  }

  return false;
}
