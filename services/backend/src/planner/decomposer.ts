import { WorkflowNode, PlanningStrategy } from '@nexusos/contracts';
import { NormalizedGoal, ICapabilityRegistryBoundary, IAiDecomposerAdapter } from './types.js';

export interface DecompositionResult {
  nodes: WorkflowNode[];
  strategy: PlanningStrategy;
  rationale: string;
  assumptions: string[];
  requiredCapabilities: string[];
}

export class Decomposer {
  constructor(
    private readonly capabilityRegistry: ICapabilityRegistryBoundary,
    private readonly aiAdapter?: IAiDecomposerAdapter,
  ) {}

  /**
   * Decomposes a normalized goal into candidate workflow nodes.
   * Produces PLAN PROPOSALS only (057-SEC-01).
   * Enforces that all capabilities resolve against authoritative registry (057-SEC-04).
   */
  public async decompose(
    goal: NormalizedGoal,
    contextDocuments: string[] = [],
  ): Promise<DecompositionResult> {
    // 1. If AI adapter is configured, attempt governed AI decomposition
    if (this.aiAdapter) {
      try {
        const aiProposal = await this.aiAdapter.decomposeWithAi(goal, contextDocuments);
        if (aiProposal && aiProposal.nodes.length > 0) {
          // 057-SEC-04: Validate all AI-proposed capabilities against authoritative registry
          this.assertCapabilitiesRegistered(aiProposal.nodes);
          return {
            nodes: aiProposal.nodes,
            strategy: aiProposal.strategy || 'SEQUENTIAL',
            rationale: aiProposal.rationale,
            assumptions: aiProposal.assumptions || [],
            requiredCapabilities: Array.from(new Set(aiProposal.nodes.map((n) => n.capabilityId))),
          };
        }
      } catch (err: unknown) {
        // Fall back to deterministic heuristic planner if AI fails or hallucinates
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('HALLUCINATED_CAPABILITY') ||
          message.includes('UNREGISTERED_CAPABILITY')
        ) {
          throw err; // Fail closed on hallucination
        }
      }
    }

    // 2. Deterministic archetype planning for hermetic execution
    return this.decomposeDeterministic(goal);
  }

  private decomposeDeterministic(goal: NormalizedGoal): DecompositionResult {
    const nodes: WorkflowNode[] = [];
    const assumptions: string[] = [];
    let strategy: PlanningStrategy = 'SEQUENTIAL';
    let rationale = '';

    const path = (goal.parameters['detectedPath'] as string) || 'workspace/target.txt';
    const url = (goal.parameters['detectedUrl'] as string) || 'https://example.com';
    const timeout = Math.min(goal.constraints.timeoutMs || 30000, 300000);

    switch (goal.archetype) {
      case 'FILE_INSPECTION': {
        rationale = 'Inspect file contents and generate a structured analysis report.';
        assumptions.push(`File is readable within authorized workspace root (${path}).`);

        const inspectCap =
          path.endsWith('/') || !path.includes('.')
            ? 'filesystem.listDirectory'
            : 'filesystem.readFile';

        nodes.push({
          nodeId: 'step-1-inspect',
          capabilityId: inspectCap,
          runtimeCategory: this.capabilityRegistry.getCategory(inspectCap) || 'filesystem',
          payload: { path },
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-2-analyze',
          capabilityId: 'localAi.generate',
          runtimeCategory: this.capabilityRegistry.getCategory('localAi.generate') || 'ai',
          payload: {
            prompt: `Analyze the inspection output of ${path} and summarize key findings.`,
          },
          dependencies: ['step-1-inspect'],
          timeoutMs: timeout,
        });
        break;
      }

      case 'FILE_TRANSFORMATION': {
        rationale = 'Read source data, perform content transformation, and commit output file.';
        assumptions.push('Source data exists and target workspace location is writable.');

        nodes.push({
          nodeId: 'step-1-read',
          capabilityId: 'filesystem.readFile',
          runtimeCategory:
            this.capabilityRegistry.getCategory('filesystem.readFile') || 'filesystem',
          payload: { path },
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-2-transform',
          capabilityId: 'localAi.generate',
          runtimeCategory: this.capabilityRegistry.getCategory('localAi.generate') || 'ai',
          payload: {
            prompt: `Transform the input content according to objective: ${goal.normalizedObjective}`,
          },
          dependencies: ['step-1-read'],
          timeoutMs: timeout,
        });

        const outputPath = path.includes('.')
          ? path.replace(/(\.[^.]+)$/, '.transformed$1')
          : `${path}.output`;

        nodes.push({
          nodeId: 'step-3-write',
          capabilityId: 'filesystem.writeFile',
          runtimeCategory:
            this.capabilityRegistry.getCategory('filesystem.writeFile') || 'filesystem',
          payload: { path: outputPath, content: '${{ nodes.step-2-transform.output.content }}' },
          dependencies: ['step-2-transform'],
          compensationPayload: { action: 'deleteFile', path: outputPath },
          timeoutMs: timeout,
        });
        break;
      }

      case 'RESEARCH_AUTOMATION': {
        rationale =
          'Navigate to research URL, extract clean text, synthesize summary, and release session.';
        assumptions.push(`Domain is allowed by network policy (${url}).`);

        nodes.push({
          nodeId: 'step-1-navigate',
          capabilityId: 'browser.navigate',
          runtimeCategory: this.capabilityRegistry.getCategory('browser.navigate') || 'browser',
          payload: { url },
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-2-extract',
          capabilityId: 'browser.extractText',
          runtimeCategory: this.capabilityRegistry.getCategory('browser.extractText') || 'browser',
          payload: { selector: 'body' },
          dependencies: ['step-1-navigate'],
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-3-synthesize',
          capabilityId: 'localAi.generate',
          runtimeCategory: this.capabilityRegistry.getCategory('localAi.generate') || 'ai',
          payload: {
            prompt: `Summarize extracted web research: \${{ nodes.step-2-extract.output.text }}`,
          },
          dependencies: ['step-2-extract'],
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-4-close',
          capabilityId: 'browser.close',
          runtimeCategory: this.capabilityRegistry.getCategory('browser.close') || 'browser',
          payload: {},
          dependencies: ['step-2-extract'],
          timeoutMs: 5000,
        });

        strategy = 'ADAPTIVE_HYBRID'; // step-3 and step-4 can execute in parallel after extract
        break;
      }

      case 'WORKFLOW_PIPELINE': {
        rationale =
          'Verify environment prerequisites, execute managed build/test command, and report.';
        assumptions.push('Target project directory has build tools configured.');

        nodes.push({
          nodeId: 'step-1-check',
          capabilityId: 'filesystem.listDirectory',
          runtimeCategory:
            this.capabilityRegistry.getCategory('filesystem.listDirectory') || 'filesystem',
          payload: { path: '.' },
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-2-run',
          capabilityId: 'terminal.execute',
          runtimeCategory: this.capabilityRegistry.getCategory('terminal.execute') || 'terminal',
          payload: { command: 'npm test' },
          dependencies: ['step-1-check'],
          timeoutMs: timeout,
        });

        nodes.push({
          nodeId: 'step-3-report',
          capabilityId: 'localAi.generate',
          runtimeCategory: this.capabilityRegistry.getCategory('localAi.generate') || 'ai',
          payload: {
            prompt: `Summarize pipeline outcome for ${goal.normalizedObjective}`,
          },
          dependencies: ['step-2-run'],
          timeoutMs: timeout,
        });
        break;
      }

      default: {
        rationale =
          'Query device and environment context to establish baseline for requested goal.';
        nodes.push({
          nodeId: 'step-1-info',
          capabilityId: 'device.queryInfo',
          runtimeCategory: this.capabilityRegistry.getCategory('device.queryInfo') || 'device',
          payload: {},
          timeoutMs: 5000,
        });

        nodes.push({
          nodeId: 'step-2-plan',
          capabilityId: 'localAi.generate',
          runtimeCategory: this.capabilityRegistry.getCategory('localAi.generate') || 'ai',
          payload: {
            prompt: `Process task goal: ${goal.normalizedObjective}`,
          },
          dependencies: ['step-1-info'],
          timeoutMs: timeout,
        });
        break;
      }
    }

    // 057-SEC-04: Authoritatively validate all generated capabilities
    this.assertCapabilitiesRegistered(nodes);

    // Apply forbidden capabilities check from constraints
    if (
      goal.constraints.forbiddenCapabilities &&
      goal.constraints.forbiddenCapabilities.length > 0
    ) {
      const forbiddenSet = new Set(goal.constraints.forbiddenCapabilities);
      for (const node of nodes) {
        if (forbiddenSet.has(node.capabilityId)) {
          throw new Error(
            `FORBIDDEN_CAPABILITY: Goal decomposition generated node '${node.nodeId}' with forbidden capability '${node.capabilityId}'.`,
          );
        }
      }
    }

    const requiredCapabilities = Array.from(new Set(nodes.map((n) => n.capabilityId)));

    return {
      nodes,
      strategy,
      rationale,
      assumptions,
      requiredCapabilities,
    };
  }

  /**
   * 057-SEC-04: Assert that every proposed capability exists in the registry.
   */
  public assertCapabilitiesRegistered(nodes: WorkflowNode[]): void {
    for (const node of nodes) {
      if (!this.capabilityRegistry.isRegistered(node.capabilityId)) {
        throw new Error(
          `HALLUCINATED_CAPABILITY: Decomposed node '${node.nodeId}' proposes unregistered capability '${node.capabilityId}'.`,
        );
      }
    }
  }
}
