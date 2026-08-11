import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';

export enum TerminalOperationName {
  EXECUTE = 'term:execute',
  KILL = 'term:kill',
  LIST_PROCESSES = 'term:list_processes',
}

/**
 * Explicit command allowlist permitted per EDD Section 3.6 & PRD Section 5.6 (DEV-001)
 */
export const PERMITTED_COMMAND_ALLOWLIST = new Set<string>([
  'node',
  'node.exe',
  'python',
  'python.exe',
  'python3',
  'python3.exe',
  'git',
  'git.exe',
  'npm',
  'npm.cmd',
  'pnpm',
  'pnpm.cmd',
  'yarn',
  'yarn.cmd',
  'pip',
  'pip.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'cmd',
  'cmd.exe',
]);

/**
 * Base environment variables allowed to be passed to child processes
 */
export const ALLOWED_BASE_ENV_KEYS = new Set<string>([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'TERM',
  'NODE_ENV',
]);

export interface TerminalResourceLimits {
  /** Maximum execution duration in ms (default: 30000ms, max: 300000ms) */
  maxTimeoutMs: number;
  /** Maximum stdout/stderr byte accumulation limit (default: 1MB, max: 10MB) */
  maxOutputSizeBytes: number;
  /** Maximum concurrent managed processes (default: 5) */
  maxConcurrentProcesses: number;
}

export const DEFAULT_TERMINAL_RESOURCE_LIMITS: TerminalResourceLimits = {
  maxTimeoutMs: 30_000,
  maxOutputSizeBytes: 1024 * 1024, // 1MB
  maxConcurrentProcesses: 5,
};

export interface ExecuteCommandRequest {
  /** Executable binary name (must be in PERMITTED_COMMAND_ALLOWLIST) */
  command: string;
  /** Argument vector (must be an array of strings, no raw shell string parsing) */
  args: string[];
  /** Working directory (validated against allowedRoots via PathSecurityService) */
  cwd: string;
  /** Optional sanitized environment overrides */
  env?: Record<string, string>;
  /** Optional timeout in ms */
  timeoutMs?: number;
  /** Optional output size limit in bytes */
  maxOutputSizeBytes?: number;
}

export interface KillProcessRequest {
  processToken: string;
}

export interface TerminalOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: AuthenticatedContext;
  allowedRoots: string[];
  limits?: Partial<TerminalResourceLimits>;
}

export interface ManagedProcessInfo {
  processToken: string;
  pid: number | undefined;
  command: string;
  args: string[];
  cwd: string;
  startTime: string;
  creationTimeMs: number;
  status: 'RUNNING' | 'EXITED' | 'KILLED' | 'TIMED_OUT';
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
}

export interface ExecuteCommandResult {
  success: boolean;
  processToken: string;
  pid?: number;
  command: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  evidenceId: string;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}
