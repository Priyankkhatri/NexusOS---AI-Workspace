import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

export const PreconditionsSchema = z
  .object({
    expectedExists: z.boolean().optional(),
    expectedNotExists: z.boolean().optional(),
    expectedHash: z.string().optional(),
    expectedSize: z.number().int().min(0).optional(),
  })
  .optional();

export const FilesystemResourceLimitsSchema = z
  .object({
    maxFileSizeByte: z.number().int().min(1).optional(),
    maxDirectoryEntries: z.number().int().min(1).optional(),
    maxRecursionDepth: z.number().int().min(1).optional(),
  })
  .optional();

/**
 * filesystem.readFile IPC Request Schema
 */
export const FilesystemReadFileIPCRequestSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  encoding: z.enum(['utf-8', 'base64', 'binary']).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
  limits: FilesystemResourceLimitsSchema,
});

/**
 * filesystem.writeFile IPC Request Schema
 */
export const FilesystemWriteFileIPCRequestSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64', 'binary']).optional(),
  preconditions: PreconditionsSchema,
  overwrite: z.boolean().optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
  limits: FilesystemResourceLimitsSchema,
});

/**
 * filesystem.listDirectory IPC Request Schema
 */
export const FilesystemListDirectoryIPCRequestSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().optional(),
  maxEntries: z.number().int().min(1).max(10000).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
  limits: FilesystemResourceLimitsSchema,
});

/**
 * filesystem.statFile IPC Request Schema
 */
export const FilesystemStatFileIPCRequestSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
});

/**
 * filesystem.copyFile IPC Request Schema
 */
export const FilesystemCopyFileIPCRequestSchema = z.object({
  sourcePath: z.string().min(1, 'Source path is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
  preconditions: PreconditionsSchema,
  overwrite: z.boolean().optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
  limits: FilesystemResourceLimitsSchema,
});

/**
 * filesystem.moveFile IPC Request Schema
 */
export const FilesystemMoveFileIPCRequestSchema = z.object({
  sourcePath: z.string().min(1, 'Source path is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
  preconditions: PreconditionsSchema,
  overwrite: z.boolean().optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
  limits: FilesystemResourceLimitsSchema,
});

/**
 * filesystem.deleteFile IPC Request Schema
 */
export const FilesystemDeleteFileIPCRequestSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  preconditions: PreconditionsSchema,
  permanent: z.boolean().optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
  tenantId: z.string().optional(),
  allowedRoots: z.array(z.string()).optional(),
});

export type FilesystemReadFileIPCRequest = z.infer<typeof FilesystemReadFileIPCRequestSchema>;
export type FilesystemWriteFileIPCRequest = z.infer<typeof FilesystemWriteFileIPCRequestSchema>;
export type FilesystemListDirectoryIPCRequest = z.infer<
  typeof FilesystemListDirectoryIPCRequestSchema
>;
export type FilesystemStatFileIPCRequest = z.infer<typeof FilesystemStatFileIPCRequestSchema>;
export type FilesystemCopyFileIPCRequest = z.infer<typeof FilesystemCopyFileIPCRequestSchema>;
export type FilesystemMoveFileIPCRequest = z.infer<typeof FilesystemMoveFileIPCRequestSchema>;
export type FilesystemDeleteFileIPCRequest = z.infer<typeof FilesystemDeleteFileIPCRequestSchema>;
