import { z } from 'zod';
import {
  MemoryGraphNodeInput,
  MemoryGraphNodeOutput,
  MemoryGraphNodeSchema,
  MemoryGraphEdgeInput,
  MemoryGraphEdgeOutput,
  MemoryGraphEdgeSchema,
} from './graph.js';

// ---------------------------------------------------------------------------
// 1. Evolution Operation Types & Enums
// ---------------------------------------------------------------------------

export enum GraphEvolutionOperationType {
  ADD_NODE = 'ADD_NODE',
  REFINE_NODE = 'REFINE_NODE',
  SUPERSEDE_NODE = 'SUPERSEDE_NODE',
  ADD_EDGE = 'ADD_EDGE',
  SUPERSEDE_EDGE = 'SUPERSEDE_EDGE',
}

export const GraphEvolutionOperationTypeSchema = z.nativeEnum(GraphEvolutionOperationType);

// ---------------------------------------------------------------------------
// 2. Evolution Operation Schema
// ---------------------------------------------------------------------------

export const GraphEvolutionOperationSchema = z.object({
  operationType: GraphEvolutionOperationTypeSchema,
  node: MemoryGraphNodeSchema.optional(),
  edge: MemoryGraphEdgeSchema.optional(),
  targetId: z.string().min(1).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  supersededBy: z.string().optional(),
  validTo: z.string().datetime().optional(),
});

export type GraphEvolutionOperation = {
  operationType: GraphEvolutionOperationType;
  node?: MemoryGraphNodeInput | MemoryGraphNodeOutput;
  edge?: MemoryGraphEdgeInput | MemoryGraphEdgeOutput;
  targetId?: string;
  expectedVersion?: number;
  supersededBy?: string;
  validTo?: string;
};

// ---------------------------------------------------------------------------
// 3. Evolution Plan / Batch Schema
// ---------------------------------------------------------------------------

export const GraphEvolutionPlanSchema = z.object({
  evolutionId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  memoryRecordId: z.string().min(1),
  memoryVersion: z.number().int().positive().optional(),
  operations: z.array(GraphEvolutionOperationSchema).max(100),
  createdAt: z.string().datetime(),
});

export type GraphEvolutionPlan = {
  evolutionId: string;
  tenantId: string;
  workspaceId: string;
  memoryRecordId: string;
  memoryVersion?: number;
  operations: GraphEvolutionOperation[];
  createdAt: string;
};

// ---------------------------------------------------------------------------
// 4. Evolution Rejection Record Schema
// ---------------------------------------------------------------------------

export const EvolutionRejectedNodeSchema = z.object({
  candidateId: z.string().min(1),
  label: z.string().min(1),
  reason: z.string().min(1),
});

export type EvolutionRejectedNode = z.infer<typeof EvolutionRejectedNodeSchema>;

export const EvolutionRejectedEdgeSchema = z.object({
  candidateId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  reason: z.string().min(1),
});

export type EvolutionRejectedEdge = z.infer<typeof EvolutionRejectedEdgeSchema>;

// ---------------------------------------------------------------------------
// 5. Evolution Receipt / Result Schema
// ---------------------------------------------------------------------------

export const EvolutionReceiptSchema = z.object({
  evolutionId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  memoryRecordId: z.string().min(1),
  memoryVersion: z.number().int().positive().optional(),
  acceptedNodes: z.array(z.string()),
  acceptedEdges: z.array(z.string()),
  supersededNodeIds: z.array(z.string()),
  supersededEdgeIds: z.array(z.string()),
  rejectedNodes: z.array(EvolutionRejectedNodeSchema),
  rejectedEdges: z.array(EvolutionRejectedEdgeSchema),
  evolvedAt: z.string().datetime(),
  executionDurationMs: z.number().nonnegative(),
  idempotentSkip: z.boolean().default(false),
});

export type EvolutionReceipt = z.infer<typeof EvolutionReceiptSchema>;

// ---------------------------------------------------------------------------
// 6. Graph Evolution Request & Options Schemas
// ---------------------------------------------------------------------------

export const GraphEvolutionRequestSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  memoryRecordId: z.string().min(1),
  minConfidence: z.number().min(0).max(1).default(0.5),
  evolvedAt: z.string().datetime().optional(),
});

export type GraphEvolutionRequest = z.infer<typeof GraphEvolutionRequestSchema>;

export const GraphEvolutionOptionsSchema = z.object({
  minConfidence: z.number().min(0).max(1).default(0.5).optional(),
  evolvedAt: z.string().datetime().optional(),
  dryRun: z.boolean().default(false).optional(),
});

export type GraphEvolutionOptions = z.infer<typeof GraphEvolutionOptionsSchema>;
