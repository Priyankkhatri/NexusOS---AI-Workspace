import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EpisodeOutcome,
  PlaybookStatus,
  MemorySourceType,
  MemorySensitivity,
  isPlaybookPlanningEligible,
} from '@nexusos/contracts';
import {
  InMemoryMemoryStore,
  EpisodicLearner,
  MemoryServiceContext,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from '../../src/memory/index.js';

describe('EpisodicLearner Subsystem', () => {
  let store: InMemoryMemoryStore;
  let learner: EpisodicLearner;
  let ctx: MemoryServiceContext;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
    learner = new EpisodicLearner({ store });
    ctx = {
      tenantId: 'tenant-omega',
      workspaceId: 'ws-backend',
      principalId: 'user-lead',
    };
  });

  it('records an episodic run with node receipts and human decisions', async () => {
    const episode = await learner.recordEpisode(
      {
        taskId: 'task-build-101',
        executionId: 'exec-001',
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        goal: 'Build typescript packages and verify types',
        planGraphVersion: 1,
        outcome: EpisodeOutcome.SUCCESS,
        summary: 'All packages compiled cleanly with zero type errors.',
        nodeReceipts: [
          {
            nodeId: 'node-1',
            capability: 'filesystem.read',
            status: 'COMPLETED',
            durationMs: 30,
            outputSummary: 'Read 5 package.json files',
          },
          {
            nodeId: 'node-2',
            capability: 'terminal.execute',
            status: 'COMPLETED',
            durationMs: 450,
            outputSummary: 'Compiled successfully in 450ms',
          },
        ],
        humanDecisions: [
          {
            decisionId: 'dec-1',
            action: 'APPROVED',
            principalId: ctx.principalId,
            timestamp: new Date().toISOString(),
            rationale: 'Approved terminal build step',
          },
        ],
        keyDecisions: ['Ran with frozen lockfile', 'Emitted sourcemaps'],
        errorPatterns: [],
        tags: ['build', 'typescript'],
        sensitivity: MemorySensitivity.INTERNAL,
        provenance: {
          sourceType: MemorySourceType.TASK_EXECUTION,
          creatorPrincipalId: ctx.principalId,
          timestamp: new Date().toISOString(),
        },
        startedAt: new Date(Date.now() - 2000).toISOString(),
        completedAt: new Date().toISOString(),
      },
      ctx,
    );

    assert.ok(episode.id.startsWith('ep-'));
    assert.equal(episode.outcome, EpisodeOutcome.SUCCESS);
    assert.equal(episode.nodeReceipts.length, 2);
    assert.equal(episode.humanDecisions.length, 1);

    // Verify stored and retrievable
    const retrieved = await learner.getEpisode(episode.id, ctx);
    assert.ok(retrieved);
    assert.equal(retrieved?.taskId, 'task-build-101');
  });

  it('lists episodes for a workspace ordered by completedAt descending', async () => {
    await learner.recordEpisode(
      {
        taskId: 'task-1',
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        goal: 'Task 1 goal',
        summary: 'Task 1 summary',
        outcome: EpisodeOutcome.SUCCESS,
        nodeReceipts: [],
        humanDecisions: [],
        keyDecisions: [],
        errorPatterns: [],
        tags: [],
        sensitivity: MemorySensitivity.INTERNAL,
        provenance: {
          sourceType: MemorySourceType.TASK_EXECUTION,
          creatorPrincipalId: ctx.principalId,
          timestamp: new Date().toISOString(),
        },
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date(Date.now() - 4000).toISOString(),
      },
      ctx,
    );

    await learner.recordEpisode(
      {
        taskId: 'task-2',
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        goal: 'Task 2 goal',
        summary: 'Task 2 summary',
        outcome: EpisodeOutcome.SUCCESS,
        nodeReceipts: [],
        humanDecisions: [],
        keyDecisions: [],
        errorPatterns: [],
        tags: [],
        sensitivity: MemorySensitivity.INTERNAL,
        provenance: {
          sourceType: MemorySourceType.TASK_EXECUTION,
          creatorPrincipalId: ctx.principalId,
          timestamp: new Date().toISOString(),
        },
        startedAt: new Date(Date.now() - 2000).toISOString(),
        completedAt: new Date().toISOString(),
      },
      ctx,
    );

    const list = await learner.listEpisodes(ctx);
    assert.equal(list.total, 2);
    assert.equal(list.episodes[0].taskId, 'task-2'); // Most recent first
  });

  it('proposes a procedural playbook defaulting to PROPOSED and not planning-eligible', async () => {
    const playbook = await learner.proposePlaybook(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        title: 'Safe TypeScript Build',
        goalPattern: 'build and verify typescript',
        confidence: 0.85,
        steps: [
          {
            stepIndex: 0,
            capability: 'filesystem.read',
            description: 'Read tsconfig',
          },
        ],
        sourceEpisodeIds: ['ep-101'],
        provenance: {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: 'service:learner',
          timestamp: new Date().toISOString(),
        },
      },
      ctx,
    );

    assert.equal(playbook.status, PlaybookStatus.PROPOSED);
    // 058-SEC-06: confidence < 0.90 without human approval is NOT planning eligible
    assert.equal(isPlaybookPlanningEligible(playbook), false);

    // List playbooks with planningEligibleOnly=true returns empty
    const eligible = await learner.listPlaybooks(ctx, { planningEligibleOnly: true });
    assert.equal(eligible.length, 0);
  });

  it('grants planning eligibility when human approval is attached (058-SEC-06)', async () => {
    const playbook = await learner.proposePlaybook(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        title: 'Governed Deploy Playbook',
        goalPattern: 'deploy to staging',
        confidence: 0.8,
        steps: [
          {
            stepIndex: 0,
            capability: 'terminal.execute',
            description: 'Run deployment',
            suggestedRiskTier: 'HIGH',
          },
        ],
        sourceEpisodeIds: ['ep-201'],
        provenance: {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: 'service:learner',
          timestamp: new Date().toISOString(),
        },
      },
      ctx,
    );

    assert.equal(isPlaybookPlanningEligible(playbook), false);

    // Explicit human approval
    const approved = await learner.approvePlaybook(
      playbook.id,
      { approvedBy: 'lead-devops', notes: 'Approved for production-like use' },
      ctx,
    );

    assert.equal(approved.status, PlaybookStatus.APPROVED);
    assert.equal(isPlaybookPlanningEligible(approved), true);
    assert.equal(approved.humanApproval?.approvedBy, 'lead-devops');

    const eligible = await learner.listPlaybooks(ctx, { planningEligibleOnly: true });
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].id, playbook.id);
  });

  it('automatically grants planning eligibility when confidence >= 0.90 (058-SEC-06)', async () => {
    const playbook = await learner.proposePlaybook(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        title: 'High Confidence Lint Recipe',
        goalPattern: 'run linter across repository',
        confidence: 0.95,
        steps: [
          {
            stepIndex: 0,
            capability: 'terminal.execute',
            description: 'Run eslint',
          },
        ],
        sourceEpisodeIds: ['ep-301'],
        provenance: {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: 'service:learner',
          timestamp: new Date().toISOString(),
        },
      },
      ctx,
    );

    assert.equal(isPlaybookPlanningEligible(playbook), true);
    const eligible = await learner.listPlaybooks(ctx, { planningEligibleOnly: true });
    assert.equal(eligible.length, 1);
  });

  it('rejects cross-workspace episode recording (058-SEC-03)', async () => {
    await assert.rejects(
      () =>
        learner.recordEpisode(
          {
            taskId: 'task-cross',
            tenantId: ctx.tenantId,
            workspaceId: 'other-workspace',
            goal: 'Cross workspace goal',
            summary: 'Cross workspace summary',
            outcome: EpisodeOutcome.SUCCESS,
            nodeReceipts: [],
            humanDecisions: [],
            keyDecisions: [],
            errorPatterns: [],
            tags: [],
            sensitivity: MemorySensitivity.INTERNAL,
            provenance: {
              sourceType: MemorySourceType.TASK_EXECUTION,
              creatorPrincipalId: ctx.principalId,
              timestamp: new Date().toISOString(),
            },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
          ctx,
        ),
      MemorySecurityViolationError,
    );
  });

  it('rejects recording episodes containing plaintext secrets (058-SEC-07)', async () => {
    await assert.rejects(
      () =>
        learner.recordEpisode(
          {
            taskId: 'task-secret',
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            goal: 'Connect to database',
            summary: 'Connected with password="SuperSecretPassword123!"',
            outcome: EpisodeOutcome.SUCCESS,
            nodeReceipts: [],
            humanDecisions: [],
            keyDecisions: [],
            errorPatterns: [],
            tags: [],
            sensitivity: MemorySensitivity.INTERNAL,
            provenance: {
              sourceType: MemorySourceType.TASK_EXECUTION,
              creatorPrincipalId: ctx.principalId,
              timestamp: new Date().toISOString(),
            },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
          ctx,
        ),
      MemorySecretDetectedError,
    );
  });
});
