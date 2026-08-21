import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

export const TerminalExecuteCommandIPCRequestSchema = z.object({
  command: z.string().min(1, 'Command executable name is required'),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1, 'Working directory (cwd) is required'),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  maxOutputSizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .optional(),
  allowedRoots: z.array(z.string()).min(1).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export const TerminalKillProcessIPCRequestSchema = z.object({
  processToken: z.string().min(1, 'Process token is required'),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export const TerminalListProcessesIPCRequestSchema = z.object({
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type TerminalExecuteCommandIPCRequest = z.infer<
  typeof TerminalExecuteCommandIPCRequestSchema
>;
export type TerminalKillProcessIPCRequest = z.infer<typeof TerminalKillProcessIPCRequestSchema>;
export type TerminalListProcessesIPCRequest = z.infer<typeof TerminalListProcessesIPCRequestSchema>;
