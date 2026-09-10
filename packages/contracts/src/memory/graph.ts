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
// 2. Graph Node & Edge Schemas (058-SEC-03)
// ---------------------------------------------------------------------------

export const MemoryGraphNodeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  nodeType: MemoryGraphNodeTypeSchema,
  label: z.string().min(1).max(256),
  memoryRecordId: z.string().optional(),
  properties: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(1.0),
  createdAt: z.string().datetime(),
});

export type MemoryGraphNode = z.infer<typeof MemoryGraphNodeSchema>;

export const MemoryGraphEdgeSchema = z.object({
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
  createdAt: z.string().datetime(),
});

export type MemoryGraphEdge = z.infer<typeof MemoryGraphEdgeSchema>;

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
