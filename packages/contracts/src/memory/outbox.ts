import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GraphExtractionResult } from './graph.js';

// ---------------------------------------------------------------------------
// 1. Evolution Delivery Status Enum & Schema (Task 066 Reliability Hardening)
// ---------------------------------------------------------------------------

export enum EvolutionDeliveryStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export const EvolutionDeliveryStatusSchema = z.nativeEnum(EvolutionDeliveryStatus);

// ---------------------------------------------------------------------------
// 2. Evolution Outbox Record Schemas (066-P3-R-01, 066-P3-R-02)
// ---------------------------------------------------------------------------

export const EvolutionOutboxRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  memoryRecordId: z.string().min(1),
  memoryVersion: z.number().int().positive(),
  candidateSetHash: z.string().min(1),
  evolutionPayload: z.record(z.unknown()).optional(),
  status: EvolutionDeliveryStatusSchema.default(EvolutionDeliveryStatus.PENDING),
  attemptCount: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(5),
  nextAttemptAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable().optional(),
  lastError: z.string().nullable().optional(),
});

export type EvolutionOutboxRecord = z.infer<typeof EvolutionOutboxRecordSchema>;

export const EvolutionOutboxRecordInputSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  memoryRecordId: z.string().min(1),
  memoryVersion: z.number().int().positive(),
  candidateSetHash: z.string().min(1),
  evolutionPayload: z.record(z.unknown()).optional(),
  status: EvolutionDeliveryStatusSchema.default(EvolutionDeliveryStatus.PENDING).optional(),
  attemptCount: z.number().int().nonnegative().default(0).optional(),
  maxAttempts: z.number().int().positive().default(5).optional(),
  nextAttemptAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  processedAt: z.string().datetime().nullable().optional(),
  lastError: z.string().nullable().optional(),
});

export type EvolutionOutboxRecordInput = z.infer<typeof EvolutionOutboxRecordInputSchema>;

// ---------------------------------------------------------------------------
// 3. Deterministic Idempotency & Hashing Utilities (066-P3-R-02)
// ---------------------------------------------------------------------------

/**
 * Deterministically hashes a candidate fact set by canonicalizing and sorting
 * nodes and edges prior to generating a collision-resistant SHA-256 digest.
 */
export function computeCandidateSetHash(
  candidates: GraphExtractionResult | { nodes: Array<unknown>; edges: Array<unknown> },
): string {
  const nodes = Array.isArray(candidates.nodes) ? [...candidates.nodes] : [];
  const edges = Array.isArray(candidates.edges) ? [...candidates.edges] : [];

  // Sort nodes deterministically by type and label/canonical key
  const normalizedNodes = nodes
    .map((n: any) => ({
      nodeType: String(n.nodeType || ''),
      label: String(n.label || '')
        .trim()
        .toLowerCase(),
      properties: n.properties
        ? Object.keys(n.properties)
            .sort()
            .reduce((acc: any, k) => {
              acc[k] = n.properties[k];
              return acc;
            }, {})
        : {},
    }))
    .sort((a, b) => (a.nodeType + ':' + a.label).localeCompare(b.nodeType + ':' + b.label));

  // Sort edges deterministically by source, target, and edgeType
  const normalizedEdges = edges
    .map((e: any) => ({
      sourceNodeId: String(e.sourceNodeId || ''),
      targetNodeId: String(e.targetNodeId || ''),
      edgeType: String(e.edgeType || ''),
      properties: e.properties
        ? Object.keys(e.properties)
            .sort()
            .reduce((acc: any, k) => {
              acc[k] = e.properties[k];
              return acc;
            }, {})
        : {},
    }))
    .sort((a, b) =>
      (a.sourceNodeId + ':' + a.targetNodeId + ':' + a.edgeType).localeCompare(
        b.sourceNodeId + ':' + b.targetNodeId + ':' + b.edgeType,
      ),
    );

  const payloadString = JSON.stringify({ nodes: normalizedNodes, edges: normalizedEdges });
  return createHash('sha256').update(payloadString).digest('hex').slice(0, 32);
}

/**
 * Computes a deterministic, collision-resistant evolution delivery identity.
 * Same tenant, workspace, memoryRecordId, memoryVersion, and candidateSetHash
 * produce the identical identity.
 */
export function computeEvolutionDeliveryId(
  tenantId: string,
  workspaceId: string,
  memoryRecordId: string,
  memoryVersion: number,
  candidateSetHash: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${memoryRecordId}:${memoryVersion}:${candidateSetHash}`)
    .digest('hex')
    .slice(0, 16);
  return `evo-outbox-${digest}`;
}

// ---------------------------------------------------------------------------
// 4. Retry & Lease Recovery Configurations
// ---------------------------------------------------------------------------

export const OUTBOX_MAX_ATTEMPTS_DEFAULT = 5;
export const OUTBOX_BASE_BACKOFF_MS = 1000; // 1s base
export const OUTBOX_MAX_BACKOFF_MS = 30000; // 30s cap
export const OUTBOX_PROCESSING_LEASE_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Calculates exponential backoff with ceiling.
 */
export function computeOutboxBackoffMs(
  attemptCount: number,
  baseMs = OUTBOX_BASE_BACKOFF_MS,
  maxMs = OUTBOX_MAX_BACKOFF_MS,
): number {
  const exp = Math.min(attemptCount, 6);
  const delay = baseMs * Math.pow(2, exp);
  return Math.min(delay, maxMs);
}
