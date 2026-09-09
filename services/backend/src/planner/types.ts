import {
  GoalDecompositionResponse,
  AdaptiveReplanResponse,
  PlanningConstraints,
  PlanRiskTier,
  AmbiguousGoalDetails,
  PlanningStrategy,
  MemorySearchRequest,
  MemorySearchResponse,
} from '@nexusos/contracts';
import { WorkflowNode } from '@nexusos/contracts';

/**
 * Task Archetype Classifications recognized by deterministic decomposer
 */
export type TaskArchetype =
  | 'FILE_INSPECTION'
  | 'FILE_TRANSFORMATION'
  | 'RESEARCH_AUTOMATION'
  | 'WORKFLOW_PIPELINE'
  | 'GENERIC';

/**
 * Normalized representation of user intent
 */
export interface NormalizedGoal {
  originalGoal: string;
  normalizedObjective: string;
  deliverables: string[];
  constraints: PlanningConstraints;
  archetype: TaskArchetype;
  parameters: Record<string, unknown>;
  isAmbiguous: boolean;
  ambiguityDetails?: AmbiguousGoalDetails;
}

/**
 * Authoritative Capability Registry Boundary (057-SEC-04)
 */
export interface ICapabilityRegistryBoundary {
  isRegistered(capabilityId: string): boolean;
  getCategory(capabilityId: string): string | undefined;
  getRiskTier(capabilityId: string): PlanRiskTier;
  listRegisteredCapabilities(): string[];
}

/**
 * Memory Service Boundary for context retrieval (057-SEC-02 & 056 reuse)
 */
export interface IPlannerMemoryBoundary {
  searchMemory?(
    request: MemorySearchRequest,
    context: {
      tenantId: string;
      workspaceId?: string;
      principalId?: string;
    },
  ): Promise<MemorySearchResponse>;
  search?(
    request: MemorySearchRequest,
    context: {
      tenantId: string;
      workspaceId?: string;
      principalId?: string;
    },
  ): Promise<MemorySearchResponse>;
}

/**
 * Pluggable AI adapter for open-ended decomposition when AI is available
 */
export interface IAiDecomposerAdapter {
  decomposeWithAi(
    goal: NormalizedGoal,
    contextDocuments?: string[],
  ): Promise<{
    nodes: WorkflowNode[];
    strategy?: PlanningStrategy;
    rationale: string;
    assumptions?: string[];
  } | null>;
}

/**
 * Planner Service Interface
 */
export interface IPlannerService {
  planGoal(request: unknown, authContext: unknown): Promise<GoalDecompositionResponse>;
  replanGoal(request: unknown, authContext: unknown): Promise<AdaptiveReplanResponse>;
}
