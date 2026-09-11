import { z } from 'zod';
import { MemoryProvenanceSchema } from './base.js';

// ---------------------------------------------------------------------------
// 1. Graph Node & Edge Types
// ---------------------------------------------------------------------------

export enum MemoryGraphNodeType {
  ENTITY = 'ENTITY',
  CONCEPT = 'CONCEPT',
  TASK = 'TASK',
  WORKSPACE = 'WORKSPACE',
  DECISION = 'DECISION',
  ARTIFACT = 'ARTIFACT',
  ERROR_PATTERN = 'ERROR_PATTERN',
}

export const MemoryGraphNodeTypeSchema = z.nativeEnum(MemoryGraphNodeType);

export enum MemoryGraphEdgeType {
  DERIVED_FROM = 'DERIVED_FROM',
  RELATES_TO = 'RELATES_TO',
  SUPERSEDES = 'SUPERSEDES',
  DECIDED_IN = 'DECIDED_IN',
  EXECUTED_BY = 'EXECUTED_BY',
  RESOLVED_BY = 'RESOLVED_BY',
}

export const MemoryGraphEdgeTypeSchema = z.nativeEnum(MemoryGraphEdgeType);

// ---------------------------------------------------------------------------
// 2. Graph Node & Edge Schemas (058-SEC-03, 066-P1-SEC-03)
// ---------------------------------------------------------------------------

export const MemoryGraphNodeSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    nodeType: MemoryGraphNodeTypeSchema,
    label: z.string().min(1).max(256),
    memoryRecordId: z.string().optional(),
    properties: z.record(z.unknown()).default({}),
    confidence: z.number().min(0).max(1).default(1.0),
    provenance: MemoryProvenanceSchema.optional(),
    version: z.number().int().positive().default(1),
    isCurrent: z.boolean().default(true),
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().nullable().optional(),
    supersededBy: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.validTo && data.isCurrent) {
        return false;
      }
      return true;
    },
    {
      message:
        '066-P1-SEC-03: Current graph node cannot have a closed validity window (validTo must be null/undefined when isCurrent is true)',
      path: ['validTo'],
    },
  )
  .refine(
    (data) => {
      if (data.supersededBy && data.isCurrent) {
        return false;
      }
      return true;
    },
    {
      message:
        '066-P1-SEC-03: Current graph node cannot have supersededBy set when isCurrent is true',
      path: ['supersededBy'],
    },
  )
  .refine(
    (data) => {
      if (data.validTo) {
        const fromTime = new Date(data.validFrom ?? data.createdAt).getTime();
        const toTime = new Date(data.validTo).getTime();
        if (fromTime > toTime) {
          return false;
        }
      }
      return true;
    },
    {
      message: '066-P1-SEC-03: validFrom must be less than or equal to validTo',
      path: ['validTo'],
    },
  );

export type MemoryGraphNodeOutput = z.infer<typeof MemoryGraphNodeSchema>;
export type MemoryGraphNode = Omit<MemoryGraphNodeOutput, 'version' | 'isCurrent'> & {
  version?: number;
  isCurrent?: boolean;
};
export type MemoryGraphNodeInput = z.input<typeof MemoryGraphNodeSchema>;

export const MemoryGraphEdgeSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
    edgeType: MemoryGraphEdgeTypeSchema,
    weight: z.number().min(0).default(1.0),
    confidence: z.number().min(0).max(1).default(1.0),
    properties: z.record(z.unknown()).default({}),
    provenance: MemoryProvenanceSchema,
    version: z.number().int().positive().default(1),
    isCurrent: z.boolean().default(true),
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().nullable().optional(),
    supersededBy: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.validTo && data.isCurrent) {
        return false;
      }
      return true;
    },
    {
      message:
        '066-P1-SEC-03: Current graph edge cannot have a closed validity window (validTo must be null/undefined when isCurrent is true)',
      path: ['validTo'],
    },
  )
  .refine(
    (data) => {
      if (data.supersededBy && data.isCurrent) {
        return false;
      }
      return true;
    },
    {
      message:
        '066-P1-SEC-03: Current graph edge cannot have supersededBy set when isCurrent is true',
      path: ['supersededBy'],
    },
  )
  .refine(
    (data) => {
      if (data.validTo) {
        const fromTime = new Date(data.validFrom ?? data.createdAt).getTime();
        const toTime = new Date(data.validTo).getTime();
        if (fromTime > toTime) {
          return false;
        }
      }
      return true;
    },
    {
      message: '066-P1-SEC-03: validFrom must be less than or equal to validTo',
      path: ['validTo'],
    },
  );

export type MemoryGraphEdgeOutput = z.infer<typeof MemoryGraphEdgeSchema>;
export type MemoryGraphEdge = Omit<MemoryGraphEdgeOutput, 'version' | 'isCurrent'> & {
  version?: number;
  isCurrent?: boolean;
};
export type MemoryGraphEdgeInput = z.input<typeof MemoryGraphEdgeSchema>;

// ---------------------------------------------------------------------------
// 3. Graph Query Contracts (058-SEC-03: Strict Workspace Isolation)
// ---------------------------------------------------------------------------

export const MemoryGraphQueryRequestSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  startNodeId: z.string().min(1).optional(),
  nodeTypes: z.array(MemoryGraphNodeTypeSchema).optional(),
  edgeTypes: z.array(MemoryGraphEdgeTypeSchema).optional(),
  maxDepth: z.number().int().positive().max(4).default(2),
  minConfidence: z.number().min(0).max(1).default(0.0),
  limit: z.number().int().positive().max(100).default(25),
  asOf: z.string().datetime().optional(),
  includeSuperseded: z.boolean().default(false),
});

export type MemoryGraphQueryRequest = z.input<typeof MemoryGraphQueryRequestSchema>;
export type MemoryGraphQueryRequestOutput = z.infer<typeof MemoryGraphQueryRequestSchema>;

export const MemoryGraphQueryResponseSchema = z.object({
  nodes: z.array(MemoryGraphNodeSchema),
  edges: z.array(MemoryGraphEdgeSchema),
  traversalDepth: z.number().int().nonnegative(),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  totalNodes: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
});

export type MemoryGraphQueryResponse = z.infer<typeof MemoryGraphQueryResponseSchema>;

// ---------------------------------------------------------------------------
// 4. Graph Extraction Candidate Contracts (Task 066 Phase 2)
// ---------------------------------------------------------------------------

export const GraphExtractionCandidateNodeSchema = z.object({
  candidateId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  nodeType: MemoryGraphNodeTypeSchema,
  label: z.string().min(1).max(256),
  memoryRecordId: z.string().min(1),
  properties: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  provenance: MemoryProvenanceSchema,
});

export type GraphExtractionCandidateNode = z.infer<typeof GraphExtractionCandidateNodeSchema>;

export const GraphExtractionCandidateEdgeSchema = z.object({
  candidateId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  edgeType: MemoryGraphEdgeTypeSchema,
  weight: z.number().min(0).default(1.0),
  confidence: z.number().min(0).max(1),
  properties: z.record(z.unknown()).default({}),
  provenance: MemoryProvenanceSchema,
});

export type GraphExtractionCandidateEdge = z.infer<typeof GraphExtractionCandidateEdgeSchema>;

export const GraphExtractionResultSchema = z.object({
  memoryRecordId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  nodes: z.array(GraphExtractionCandidateNodeSchema),
  edges: z.array(GraphExtractionCandidateEdgeSchema),
  truncated: z.boolean().default(false),
  extractedAt: z.string().datetime(),
  executionDurationMs: z.number().nonnegative(),
});

export type GraphExtractionResult = z.infer<typeof GraphExtractionResultSchema>;

export const GraphExtractorOptionsSchema = z.object({
  maxInputBytes: z.number().int().positive().default(32768).optional(),
  maxNodes: z.number().int().positive().default(20).optional(),
  maxEdges: z.number().int().positive().default(30).optional(),
  strictSizeLimit: z.boolean().default(false).optional(),
  minConfidence: z.number().min(0).max(1).default(0.5).optional(),
  extractedAt: z.string().datetime().optional(),
});

export type GraphExtractorOptions = z.infer<typeof GraphExtractorOptionsSchema>;
