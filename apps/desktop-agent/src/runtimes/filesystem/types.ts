import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';
import {
  FilesystemOperation,
  CANONICAL_FS_CAPABILITIES,
  resolveFilesystemOperation,
  computeFilesystemEvidenceChecksum,
} from '@nexusos/contracts';

export {
  FilesystemOperation,
  CANONICAL_FS_CAPABILITIES,
  resolveFilesystemOperation,
  computeFilesystemEvidenceChecksum,
};

export enum FilesystemOperationName {
  READ = 'fs:read',
  WRITE = 'fs:write',
  LIST = 'fs:list',
  STAT = 'fs:stat',
  COPY = 'fs:copy',
  MOVE = 'fs:move',
  DELETE = 'fs:delete',
}

export interface FilesystemResourceLimits {
  /** Maximum file size in bytes for read/write operations (default: 50MB) */
  maxFileSizeByte: number;
  /** Maximum directory entries returned for list operations (default: 1000) */
  maxDirectoryEntries: number;
  /** Maximum recursion depth for directory operations (default: 10) */
  maxRecursionDepth: number;
}

export const DEFAULT_FILESYSTEM_RESOURCE_LIMITS: FilesystemResourceLimits = {
  maxFileSizeByte: 50 * 1024 * 1024, // 50MB
  maxDirectoryEntries: 1000,
  maxRecursionDepth: 10,
};

export interface Preconditions {
  /** Assert file exists before operation */
  expectedExists?: boolean;
  /** Assert file does not exist before operation */
  expectedNotExists?: boolean;
  /** Assert expected SHA-256 content hash matches existing file */
  expectedHash?: string;
  /** Assert expected file size in bytes matches existing file */
  expectedSize?: number;
}

export interface FilesystemOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: AuthenticatedContext;
  allowedRoots: string[];
  workspaceId?: string;
  isReadOnly?: boolean;
  limits?: Partial<FilesystemResourceLimits>;
}

export interface ReadFileRequest {
  path: string;
  encoding?: 'utf-8' | 'base64' | 'binary';
}

export interface WriteFileRequest {
  path: string;
  content: string | Buffer;
  encoding?: 'utf-8' | 'base64' | 'binary';
  preconditions?: Preconditions;
  overwrite?: boolean;
}

export interface ListDirectoryRequest {
  path: string;
  recursive?: boolean;
  maxEntries?: number;
}

export interface StatFileRequest {
  path: string;
}

export interface CopyFileRequest {
  sourcePath: string;
  destinationPath: string;
  preconditions?: Preconditions;
  overwrite?: boolean;
}

export interface MoveFileRequest {
  sourcePath: string;
  destinationPath: string;
  preconditions?: Preconditions;
  overwrite?: boolean;
}

export interface DeleteFileRequest {
  path: string;
  preconditions?: Preconditions;
  permanent?: boolean;
}

export interface FileMetadataResult {
  path: string;
  canonicalPath: string;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  createdAt: string;
  modifiedAt: string;
  sha256Hash?: string;
}

export interface DirectoryEntryResult {
  name: string;
  path: string;
  canonicalPath: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
}

export interface ListDirectoryResponse {
  entries: DirectoryEntryResult[];
  totalEntries: number;
  truncated: boolean;
}

export interface FilesystemOperationResult<T = unknown> {
  success: boolean;
  operation: FilesystemOperationName;
  resourcePath: string;
  canonicalPath: string;
  bytesProcessed?: number;
  data?: T;
  preHash?: string;
  postHash?: string;
  snapshotId?: string;
  evidenceId: string;
  evidenceChecksum?: string;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}

/**
 * Unified execution request passed to FilesystemRuntime.execute()
 * Compatible with AgentOrchestrator and direct capability invocations.
 */
export interface FilesystemExecutionRequest {
  operationName?: FilesystemOperationName | string;
  operation?: FilesystemOperationName | string;
  action?: string;
  capabilityId?: string;
  workspaceId?: string;
  path?: string;
  resourcePath?: string;
  sourcePath?: string;
  destinationPath?: string;
  content?: string | Buffer;
  encoding?: 'utf-8' | 'base64' | 'binary';
  overwrite?: boolean;
  preconditions?: Preconditions;
  recursive?: boolean;
  maxEntries?: number;
  permanent?: boolean;
  lease?: ExecutionLeaseHeader;
  leaseHeader?: ExecutionLeaseHeader;
  allowedRoots?: string[];
  limits?: Partial<FilesystemResourceLimits>;
  taskId?: string;
  stepId?: string;
  correlationId?: string;
  signal?: AbortSignal;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}
