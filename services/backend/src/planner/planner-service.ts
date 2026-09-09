import {
  GoalDecompositionRequest,
  GoalDecompositionRequestSchema,
  GoalDecompositionResponse,
  AdaptiveReplanRequest,
  AdaptiveReplanRequestSchema,
  AdaptiveReplanResponse,
  AmbiguousGoalDetails,
  formatRetrievedContext,
} from '@nexusos/contracts';
import {
  IPlannerService,
  ICapabilityRegistryBoundary,
  IPlannerMemoryBoundary,
  IAiDecomposerAdapter,
} from './types.js';
import { DefaultCapabilityRegistry } from './capability-registry.js';
import { GoalNormalizer } from './goal-normalizer.js';
import { Decomposer } from './decomposer.js';
import { DependencyAnalyzer } from './dependency-analyzer.js';
import { PlanSynthesizer } from './plan-synthesizer.js';
import { ReplanCoordinator } from './replan-coordinator.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { AuthenticatedContextLike } from '../tasks/controller.js';

export interface PlannerServiceOptions {
  capabilityRegistry?: ICapabilityRegistryBoundary;
  memoryService?: IPlannerMemoryBoundary;
  aiAdapter?: IAiDecomposerAdapter;
}

export class AmbiguousGoalException extends Error {
  public readonly details: AmbiguousGoalDetails | undefined;
  constructor(details?: AmbiguousGoalDetails) {
    super('Goal is structurally ambiguous and cannot be safely decomposed.');
    this.name = 'AmbiguousGoalException';
    this.details = details;
  }
}

export class PlannerService implements IPlannerService {
  private readonly capabilityRegistry: ICapabilityRegistryBoundary;
  private readonly memoryService?: IPlannerMemoryBoundary;
  private readonly normalizer: GoalNormalizer;
  private readonly decomposer: Decomposer;
  private readonly analyzer: DependencyAnalyzer;
  private readonly synthesizer: PlanSynthesizer;
  private readonly replanCoordinator: ReplanCoordinator;

  constructor(options: PlannerServiceOptions = {}) {
    this.capabilityRegistry = options.capabilityRegistry || new DefaultCapabilityRegistry();
    this.memoryService = options.memoryService;
    this.normalizer = new GoalNormalizer();
    this.decomposer = new Decomposer(this.capabilityRegistry, options.aiAdapter);
    this.analyzer = new DependencyAnalyzer();
    this.synthesizer = new PlanSynthesizer(this.capabilityRegistry);
    this.replanCoordinator = new ReplanCoordinator(this.capabilityRegistry);
  }

  /**
   * Transforms an abstract goal into a policy-governed DAG proposal (057-SEC-01).
   * Enforces multi-tenant isolation (057-SEC-02), complexity limits (057-SEC-03),
   * capability allowlists (057-SEC-04), and memory injection defense (057-SEC-06).
   */
  public async planGoal(
    rawRequest: unknown,
    authContext: AuthenticatedContextLike,
  ): Promise<GoalDecompositionResponse> {
    // 057-SEC-02: Authenticated context must be present and match request
    if (!authContext || !authContext.tenantId || !authContext.principal) {
      throw new Error(
        'UNAUTHENTICATED: Valid authenticated context is required for goal planning.',
      );
    }

    const request: GoalDecompositionRequest = GoalDecompositionRequestSchema.parse(rawRequest);

    if (request.tenantId !== authContext.tenantId) {
      throw new Error(
        `CROSS_TENANT_FORBIDDEN: Target tenantId '${request.tenantId}' does not match authenticated tenant '${authContext.tenantId}'.`,
      );
    }

    // 056-SEC-03 & 057-SEC-06: Ensure no secrets are embedded in goal or parameters
    RedactionFilter.assertNoSecrets(request.goal, 'GoalDecompositionRequest.goal');
    if (request.parameters) {
      RedactionFilter.assertNoSecrets(
        JSON.stringify(request.parameters),
        'GoalDecompositionRequest.parameters',
      );
    }

    // 1. Goal Normalization
    const normalizedGoal = this.normalizer.normalize(request);
    if (normalizedGoal.isAmbiguous) {
      throw new AmbiguousGoalException(normalizedGoal.ambiguityDetails);
    }

    // 2. Governed Context Retrieval (057-SEC-02 & 057-SEC-06)
    const contextDocuments: string[] = [];
    if (this.memoryService) {
      try {
        const searchFn = this.memoryService.searchMemory
          ? this.memoryService.searchMemory.bind(this.memoryService)
          : this.memoryService.search
            ? this.memoryService.search.bind(this.memoryService)
            : undefined;

        if (searchFn) {
          const memResults = await searchFn(
            {
              query: normalizedGoal.normalizedObjective,
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              limit: 5,
              minConfidence: 0.5,
            },
            {
              tenantId: request.tenantId,
              workspaceId: request.workspaceId,
              principalId: authContext.principal.userId,
            },
          );

          if (memResults.items && memResults.items.length > 0) {
            // Format under <<<UNTRUSTED_RETRIEVED_MEMORY>>> boundary
            const formatted = formatRetrievedContext(memResults.items, { maxTokens: 2000 });
            contextDocuments.push(formatted.formattedContext);
          }
        }
      } catch {
        // Degrade safely if memory service is unreachable; do not fail closed on optional context
      }
    }

    // 3. Governed Decomposition
    const decomposition = await this.decomposer.decompose(normalizedGoal, contextDocuments);

    // 4. Dependency Analysis & Topology Validation
    const analysis = this.analyzer.analyze(decomposition.nodes);
    if (!analysis.valid) {
      throw new Error(`PLAN_VALIDATION_FAILED: ${analysis.errorCode} - ${analysis.errorMessage}`);
    }

    // 5. Plan Synthesis
    const proposal = this.synthesizer.synthesize(request, normalizedGoal, decomposition, analysis);

    return proposal;
  }

  /**
   * Generates an immutable successor graph proposal upon node execution failure (057-SEC-05).
   */
  public async replanGoal(
    rawRequest: unknown,
    authContext: AuthenticatedContextLike,
  ): Promise<AdaptiveReplanResponse> {
    if (!authContext || !authContext.tenantId || !authContext.principal) {
      throw new Error('UNAUTHENTICATED: Valid authenticated context is required for replanning.');
    }

    const request: AdaptiveReplanRequest = AdaptiveReplanRequestSchema.parse(rawRequest);

    if (request.tenantId !== authContext.tenantId) {
      throw new Error(
        `CROSS_TENANT_FORBIDDEN: Target tenantId '${request.tenantId}' does not match authenticated tenant '${authContext.tenantId}'.`,
      );
    }

    // Coordinate replan using monotonic versioning and hard iteration limits
    return this.replanCoordinator.coordinateReplan(request);
  }
}
