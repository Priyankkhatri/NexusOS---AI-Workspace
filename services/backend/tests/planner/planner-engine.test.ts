import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GoalNormalizer,
  Decomposer,
  DependencyAnalyzer,
  PlanSynthesizer,
  PlannerService,
  defaultCapabilityRegistry,
  AmbiguousGoalException,
} from '../../src/planner/index.js';
import { GoalDecompositionRequestSchema } from '@nexusos/contracts';
import { MemoryService, InMemoryMemoryStore } from '../../src/memory/index.js';

describe('Planner Engine — Functional Unit Tests', () => {
  const defaultTenantId = 'e0000000-0000-4000-8000-000000000001';
  const defaultWorkspaceId = 'e0000000-0000-4000-8000-000000000002';
  const defaultUserId = 'e0000000-0000-4000-8000-000000000003';
  const defaultAgentId = 'e0000000-0000-4000-8000-000000000004';

  let normalizer: GoalNormalizer;
  let decomposer: Decomposer;
  let dependencyAnalyzer: DependencyAnalyzer;
  let planSynthesizer: PlanSynthesizer;
  let memoryService: MemoryService;
  let plannerService: PlannerService;

  beforeEach(() => {
    normalizer = new GoalNormalizer();
    decomposer = new Decomposer(defaultCapabilityRegistry);
    dependencyAnalyzer = new DependencyAnalyzer();
    planSynthesizer = new PlanSynthesizer(defaultCapabilityRegistry);
    memoryService = new MemoryService({ store: new InMemoryMemoryStore() });
    plannerService = new PlannerService({
      memoryService,
      capabilityRegistry: defaultCapabilityRegistry,
    });
  });

  describe('Goal Normalizer', () => {
    it('normalizes a valid high-level goal and detects file inspection archetype', () => {
      const normalized = normalizer.normalize({
        goal: 'Inspect and list files in the project directory src/utils',
      });

      assert.equal(normalized.archetype, 'FILE_INSPECTION');
      assert.equal(normalized.isAmbiguous, false);
      assert.ok(normalized.deliverables.length > 0);
      assert.equal(normalized.constraints.timeoutMs, 300000);
      assert.equal(normalized.constraints.maxNodes, 50);
    });

    it('detects file transformation archetype and extracts detected path', () => {
      const normalized = normalizer.normalize({
        goal: 'Read config file src/config.json, transform it, and write to dist/config.json',
      });

      assert.equal(normalized.archetype, 'FILE_TRANSFORMATION');
      assert.equal(normalized.isAmbiguous, false);
      assert.ok(normalized.parameters.detectedPath);
    });

    it('detects research automation archetype and extracts detected URL', () => {
      const normalized = normalizer.normalize({
        goal: 'Browse the web documentation at https://example.com/docs and extract API summaries',
      });

      assert.equal(normalized.archetype, 'RESEARCH_AUTOMATION');
      assert.equal(normalized.parameters.detectedUrl, 'https://example.com/docs');
    });

    it('detects workflow pipeline archetype', () => {
      const normalized = normalizer.normalize({
        goal: 'Execute pipeline: compile code, build and test all modules',
      });

      assert.equal(normalized.archetype, 'WORKFLOW_PIPELINE');
    });

    it('flags empty or whitespace-only goals as AMBIGUOUS_GOAL with clarification details', () => {
      const normalized = normalizer.normalize({ goal: '    ' });
      assert.equal(normalized.isAmbiguous, true);
      assert.equal(normalized.ambiguityDetails?.code, 'AMBIGUOUS_GOAL');
      assert.ok(normalized.ambiguityDetails?.clarificationPrompts?.length ?? 0 > 0);
      assert.ok(normalized.ambiguityDetails?.missingDeliverables?.length ?? 0 > 0);
    });

    it('flags overly vague / unresolvable goals as AMBIGUOUS_GOAL with suggestions', () => {
      const normalized = normalizer.normalize({ goal: 'fix it' });
      assert.equal(normalized.isAmbiguous, true);
      assert.equal(normalized.ambiguityDetails?.code, 'AMBIGUOUS_GOAL');
      assert.ok(normalized.ambiguityDetails?.suggestedAlternatives?.length ?? 0 > 0);
    });

    it('throws AmbiguousGoalException when plannerService receives an ambiguous goal', async () => {
      const request = {
        tenantId: defaultTenantId,
        workspaceId: defaultWorkspaceId,
        targetAgentId: defaultAgentId,
        submittedBy: defaultUserId,
        goal: 'fix it',
      };

      const authContext = {
        tenantId: defaultTenantId,
        principal: {
          type: 'USER',
          userId: defaultUserId,
          roles: ['operator'],
        },
      };

      await assert.rejects(
        async () => {
          await plannerService.planGoal(request, authContext);
        },
        (err: unknown) => {
          assert.ok(err instanceof AmbiguousGoalException);
          assert.equal(err.details?.code, 'AMBIGUOUS_GOAL');
          assert.ok(err.details?.clarificationPrompts?.length ?? 0 > 0);
          return true;
        },
      );
    });

    it('enforces safety bounds on custom constraints during normalization', () => {
      const normalized = normalizer.normalize({
        goal: 'Scan filesystem directory src/lib',
        constraints: {
          timeoutMs: 500000, // exceeds 300,000 ms
          maxNodes: 100, // exceeds 50
          requireHumanApprovalAbove: 'HIGH',
        },
      });

      // Clamped to safety limits
      assert.equal(normalized.constraints.timeoutMs, 300000);
      assert.equal(normalized.constraints.maxNodes, 50);
      assert.equal(normalized.constraints.requireHumanApprovalAbove, 'HIGH');
    });
  });

  describe('Decomposer', () => {
    it('generates registered capability nodes for FILE_INSPECTION archetype', async () => {
      const normalized = normalizer.normalize({
        goal: 'Inspect and find files in src/',
      });

      const decomposition = await decomposer.decompose(normalized);

      assert.ok(decomposition.nodes.length >= 2);
      assert.equal(decomposition.strategy, 'SEQUENTIAL');
      assert.ok(decomposition.rationale.length > 0);

      // Verify all nodes resolve to registered capabilities
      for (const node of decomposition.nodes) {
        assert.ok(defaultCapabilityRegistry.isRegistered(node.capabilityId));
      }
    });

    it('generates registered capability nodes for RESEARCH_AUTOMATION archetype', async () => {
      const normalized = normalizer.normalize({
        goal: 'Browse https://nexusos.dev/docs and summarize content',
      });

      const decomposition = await decomposer.decompose(normalized);

      assert.ok(decomposition.nodes.length >= 2);
      for (const node of decomposition.nodes) {
        assert.ok(defaultCapabilityRegistry.isRegistered(node.capabilityId));
      }
    });

    it('generates registered capability nodes for FILE_TRANSFORMATION archetype', async () => {
      const normalized = normalizer.normalize({
        goal: 'Read input.txt, transform it, and write output.txt',
      });

      const decomposition = await decomposer.decompose(normalized);

      assert.ok(decomposition.nodes.length >= 2);
      for (const node of decomposition.nodes) {
        assert.ok(defaultCapabilityRegistry.isRegistered(node.capabilityId));
      }
    });
  });

  describe('Dependency Analyzer', () => {
    it('builds sequential edges and validates valid DAG', async () => {
      const normalized = normalizer.normalize({
        goal: 'Inspect directory src/',
      });
      const decomposition = await decomposer.decompose(normalized);

      // Build sequential edges from nodes
      const edges = [];
      for (let i = 0; i < decomposition.nodes.length - 1; i++) {
        edges.push({
          fromNodeId: decomposition.nodes[i].nodeId,
          toNodeId: decomposition.nodes[i + 1].nodeId,
        });
      }

      const analyzed = dependencyAnalyzer.analyze(decomposition.nodes, edges);

      assert.equal(analyzed.valid, true);
      assert.equal(analyzed.nodeCount, decomposition.nodes.length);
      assert.equal(analyzed.edgeCount, decomposition.nodes.length - 1);
      assert.ok(analyzed.depth <= 10);
      assert.equal(analyzed.strategy, 'SEQUENTIAL');
    });

    it('detects duplicate node IDs fail-closed', () => {
      const duplicateNodes = [
        {
          nodeId: 'node-1',
          capabilityId: 'filesystem.readFile',
          runtimeCategory: 'FILESYSTEM',
          payload: {},
        },
        {
          nodeId: 'node-1',
          capabilityId: 'filesystem.writeFile',
          runtimeCategory: 'FILESYSTEM',
          payload: {},
        },
      ];

      const analyzed = dependencyAnalyzer.analyze(duplicateNodes, []);
      assert.equal(analyzed.valid, false);
      assert.ok(
        analyzed.errorMessage?.includes('Duplicate') || analyzed.errorCode?.includes('DUPLICATE'),
      );
    });

    it('detects cycles in custom edges fail-closed', () => {
      const nodes = [
        {
          nodeId: 'node-1',
          capabilityId: 'filesystem.readFile',
          runtimeCategory: 'FILESYSTEM',
          payload: {},
        },
        {
          nodeId: 'node-2',
          capabilityId: 'filesystem.writeFile',
          runtimeCategory: 'FILESYSTEM',
          payload: {},
        },
      ];

      const cycleEdges = [
        { fromNodeId: 'node-1', toNodeId: 'node-2' },
        { fromNodeId: 'node-2', toNodeId: 'node-1' },
      ];

      const analyzed = dependencyAnalyzer.analyze(nodes, cycleEdges);
      assert.equal(analyzed.valid, false);
      assert.equal(analyzed.errorCode, 'DAG_CYCLE_DETECTED');
    });
  });

  describe('Plan Synthesizer', () => {
    it('synthesizes a PROPOSED DAG proposal with correct risk tier and approval requirements', async () => {
      const rawRequest = GoalDecompositionRequestSchema.parse({
        tenantId: defaultTenantId,
        workspaceId: defaultWorkspaceId,
        targetAgentId: defaultAgentId,
        submittedBy: defaultUserId,
        goal: 'Read input.txt, transform it, and save output.txt',
      });
      const normalized = normalizer.normalize(rawRequest);
      const decomposition = await decomposer.decompose(normalized);
      const edges = [];
      for (let i = 0; i < decomposition.nodes.length - 1; i++) {
        edges.push({
          fromNodeId: decomposition.nodes[i].nodeId,
          toNodeId: decomposition.nodes[i + 1].nodeId,
        });
      }
      const analyzed = dependencyAnalyzer.analyze(decomposition.nodes, edges);

      const proposal = planSynthesizer.synthesize(rawRequest, normalized, decomposition, analyzed);

      // Proposal must NOT be executable
      assert.equal(proposal.status, 'PROPOSED');
      assert.equal(proposal.dag.nodes.length, analyzed.nodeCount);
      assert.ok(proposal.rationale.length > 0);
      assert.ok(Array.isArray(proposal.assumptions));
      // Writing to filesystem is tier MEDIUM risk, requires approval
      assert.equal(proposal.requiresHumanApproval, true);
      assert.equal(proposal.estimatedRiskTier, 'MEDIUM');
      assert.ok(proposal.plannerVersion.length > 0);
    });
  });

  describe('Planner Service End-to-End', () => {
    it('coordinates goal decomposition request with memory search and produces valid proposal', async () => {
      const request = {
        tenantId: defaultTenantId,
        workspaceId: defaultWorkspaceId,
        targetAgentId: defaultAgentId,
        submittedBy: defaultUserId,
        goal: 'Inspect files in src/planner directory',
      };

      const authContext = {
        tenantId: defaultTenantId,
        principal: {
          type: 'USER',
          userId: defaultUserId,
          roles: ['operator'],
        },
      };

      const response = await plannerService.planGoal(request, authContext);

      assert.ok(response.planId);
      assert.equal(response.status, 'PROPOSED');
      assert.equal(response.tenantId, defaultTenantId);
      assert.equal(response.workspaceId, defaultWorkspaceId);
      assert.ok(response.dag.nodes.length >= 2);
      assert.ok(response.plannerVersion);
    });
  });
});
