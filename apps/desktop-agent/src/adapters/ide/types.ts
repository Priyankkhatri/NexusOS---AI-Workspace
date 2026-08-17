import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

export type IDEType = 'cursor' | 'vscode' | 'antigravity' | 'generic';

export interface IDECapabilityProfile {
  ideType: IDEType;
  name: string;
  version: string;
  supportedActions: string[];
  workspaceRoots: string[];
}

export interface IDEContextSnapshot {
  ideType: IDEType;
  activeFilePath?: string;
  selectedText?: string;
  cursorLine?: number;
  cursorColumn?: number;
  workspaceRoot: string;
  openFilePaths: string[];
  timestamp: number;
}

export const IDEContextRequestSchema = z.object({
  requestId: z.string().uuid(),
  tenantId: z.string().uuid(),
  deviceId: z.string().uuid(),
  callerId: z.string().min(1),
  ideType: z.enum(['cursor', 'vscode', 'antigravity', 'generic']).optional().default('generic'),
});

export type IDEContextRequest = z.infer<typeof IDEContextRequestSchema>;

export const IDEDiffRequestSchema = z.object({
  requestId: z.string().uuid(),
  tenantId: z.string().uuid(),
  deviceId: z.string().uuid(),
  callerId: z.string().min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
  targetFilePath: z.string().min(1),
  diffContent: z.string().min(1),
  workspaceRoot: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
});

export type IDEDiffRequest = z.infer<typeof IDEDiffRequestSchema>;

export interface IDEDiffResult {
  success: boolean;
  targetFilePath: string;
  bytesWritten?: number;
  backupPath?: string;
  dryRun: boolean;
}

export interface IDEDiagnosticItem {
  filePath: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
}

export class IDEAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'PATH_TRAVERSAL' | 'APPLY_FAILED' | 'INVALID_INPUT',
    public readonly causeError?: unknown,
  ) {
    super(message);
    this.name = 'IDEAdapterError';
  }
}
