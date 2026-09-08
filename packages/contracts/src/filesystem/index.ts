import crypto from 'node:crypto';
import { z } from 'zod';
import { TenantIdSchema } from '../identity/index.js';
import { ExecutionLeaseHeaderSchema } from '../permissions/index.js';

/**
 * Filesystem Operation Identifier Enum matching Architecture Bible Section 7.2
 */
export enum FilesystemOperation {
  READ = 'fs:read',
  WRITE = 'fs:write',
  LIST = 'fs:list',
  STAT = 'fs:stat',
  COPY = 'fs:copy',
  MOVE = 'fs:move',
  DELETE = 'fs:delete',
}

export const FilesystemOperationSchema = z.nativeEnum(FilesystemOperation);

/**
 * Canonical capability mappings (both dot-notated and colon-notated forms supported)
 */
export const CANONICAL_FS_CAPABILITIES = {
  READ: 'fs.readFile',
  WRITE: 'fs.writeFile',
  LIST: 'fs.listDirectory',
  STAT: 'fs.statFile',
  COPY: 'fs.copyFile',
  MOVE: 'fs.moveFile',
  DELETE: 'fs.deleteFile',
} as const;

/**
 * Resolves a capabilityId string (e.g. 'fs.readFile', 'fs:read', 'filesystem.readFile')
 * into the canonical FilesystemOperation enum, or undefined if not recognized.
 */
export function resolveFilesystemOperation(capabilityId: string): FilesystemOperation | undefined {
  if (!capabilityId || typeof capabilityId !== 'string') {
    return undefined;
  }
  const normalized = capabilityId.trim().toLowerCase();

  // Direct enum match
  if (Object.values(FilesystemOperation).includes(normalized as FilesystemOperation)) {
    return normalized as FilesystemOperation;
  }

  // Dot-notated and prefixed variants
  if (
    normalized === 'fs.readfile' ||
    normalized === 'fs.read' ||
    normalized === 'filesystem.readfile' ||
    normalized === 'filesystem.read' ||
    normalized === 'capability:fs:read'
  ) {
    return FilesystemOperation.READ;
  }
  if (
    normalized === 'fs.writefile' ||
    normalized === 'fs.write' ||
    normalized === 'filesystem.writefile' ||
    normalized === 'filesystem.write' ||
    normalized === 'capability:fs:write'
  ) {
    return FilesystemOperation.WRITE;
  }
  if (
    normalized === 'fs.listdirectory' ||
    normalized === 'fs.list' ||
    normalized === 'filesystem.listdirectory' ||
    normalized === 'filesystem.list' ||
    normalized === 'capability:fs:list'
  ) {
    return FilesystemOperation.LIST;
  }
  if (
    normalized === 'fs.statfile' ||
    normalized === 'fs.stat' ||
    normalized === 'filesystem.statfile' ||
    normalized === 'filesystem.stat' ||
    normalized === 'capability:fs:stat'
  ) {
    return FilesystemOperation.STAT;
  }
  if (
    normalized === 'fs.copyfile' ||
    normalized === 'fs.copy' ||
    normalized === 'filesystem.copyfile' ||
    normalized === 'filesystem.copy' ||
    normalized === 'capability:fs:copy'
  ) {
    return FilesystemOperation.COPY;
  }
  if (
    normalized === 'fs.movefile' ||
    normalized === 'fs.move' ||
    normalized === 'filesystem.movefile' ||
    normalized === 'filesystem.move' ||
    normalized === 'capability:fs:move'
  ) {
    return FilesystemOperation.MOVE;
  }
  if (
    normalized === 'fs.deletefile' ||
    normalized === 'fs.delete' ||
    normalized === 'filesystem.deletefile' ||
    normalized === 'filesystem.delete' ||
    normalized === 'capability:fs:delete'
  ) {
    return FilesystemOperation.DELETE;
  }

  return undefined;
}

/**
 * Workspace Directory Jail Configuration Schema
 */
export const WorkspaceDirectoryJailConfigSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  tenantId: TenantIdSchema,
  rootPath: z.string().min(1),
  isReadOnly: z.boolean().default(false),
  maxStorageSizeBytes: z.number().int().positive().optional(),
});

export type WorkspaceDirectoryJailConfig = z.infer<typeof WorkspaceDirectoryJailConfigSchema>;

/**
 * Preconditions Schema for file mutations
 */
export const FilesystemPreconditionsSchema = z.object({
  expectedExists: z.boolean().optional(),
  expectedNotExists: z.boolean().optional(),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  expectedSize: z.number().int().min(0).optional(),
});

export type FilesystemPreconditions = z.infer<typeof FilesystemPreconditionsSchema>;

/**
 * Unified Filesystem Capability Request Schema
 */
export const FilesystemCapabilityRequestSchema = z.object({
  operationName: z.string().min(1).optional(),
  capabilityId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  path: z.string().min(1),
  destinationPath: z.string().min(1).optional(),
  content: z.union([z.string(), z.instanceof(Buffer)]).optional(),
  encoding: z.enum(['utf-8', 'base64', 'binary']).default('utf-8'),
  overwrite: z.boolean().default(true),
  preconditions: FilesystemPreconditionsSchema.optional(),
  recursive: z.boolean().default(false),
  maxEntries: z.number().int().positive().default(1000),
  permanent: z.boolean().default(false),
  leaseHeader: ExecutionLeaseHeaderSchema.optional(),
  allowedRoots: z.array(z.string()).optional(),
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  correlationId: z.string().optional(),
});

export type FilesystemCapabilityRequest = z.infer<typeof FilesystemCapabilityRequestSchema>;

/**
 * Computes deterministic SHA-256 evidence checksum linking pre/post hashes and task context
 */
export function computeFilesystemEvidenceChecksum(params: {
  taskId: string;
  leaseId: string;
  operation: string;
  canonicalPath: string;
  preHash?: string;
  postHash?: string;
  bytesProcessed?: number;
  snapshotId?: string;
}): string {
  const parts = [
    params.taskId,
    params.leaseId,
    params.operation,
    params.canonicalPath,
    params.preHash || 'none',
    params.postHash || 'none',
    String(params.bytesProcessed ?? 0),
    params.snapshotId || 'none',
  ];
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}
