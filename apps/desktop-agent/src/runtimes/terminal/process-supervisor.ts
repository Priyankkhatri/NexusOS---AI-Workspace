import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { AgentLogger } from '../../observability/agent-logger.js';
import {
  ALLOWED_BASE_ENV_KEYS,
  DEFAULT_TERMINAL_RESOURCE_LIMITS,
  ExecuteCommandRequest,
  ManagedProcessInfo,
  TerminalResourceLimits,
} from './types.js';

export interface ProcessExecutionOutcome {
  processToken: string;
  pid: number | undefined;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export class ProcessSupervisor {
  private readonly activeProcesses = new Map<
    string,
    {
      info: ManagedProcessInfo;
      child: ChildProcess;
    }
  >();

  constructor(private readonly logger?: AgentLogger) {}

  /**
   * Sanitizes process environment by copying only allowlisted base environment keys
   * and merging safe request overrides (filtering out secret key patterns).
   */
  public sanitizeEnvironment(requestEnv?: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    // 1. Copy allowlisted base environment keys from host process
    for (const key of ALLOWED_BASE_ENV_KEYS) {
      if (process.env[key] !== undefined) {
        sanitized[key] = process.env[key]!;
      }
    }

    // 2. Merge request-specific environment variables if safe
    if (requestEnv) {
      const sensitivePattern = /secret|token|password|key|auth|credential|api_key|private_key/i;

      for (const [key, value] of Object.entries(requestEnv)) {
        if (!sensitivePattern.test(key)) {
          sanitized[key] = value;
        } else {
          this.logger?.warn(
            `Filtered out sensitive environment key '${key}' from process environment.`,
          );
        }
      }
    }

    return sanitized;
  }

  /**
   * Spawns a supervised child process using typed argument vectors (shell: false).
   */
  public async executeSupervisedProcess(
    request: ExecuteCommandRequest,
    limits?: Partial<TerminalResourceLimits>,
  ): Promise<ProcessExecutionOutcome> {
    const effectiveLimits = { ...DEFAULT_TERMINAL_RESOURCE_LIMITS, ...limits };
    const timeoutMs = Math.min(
      request.timeoutMs ?? effectiveLimits.maxTimeoutMs,
      effectiveLimits.maxTimeoutMs,
    );
    const maxOutputSizeBytes = Math.min(
      request.maxOutputSizeBytes ?? effectiveLimits.maxOutputSizeBytes,
      effectiveLimits.maxOutputSizeBytes,
    );

    const processToken = `proc_${crypto.randomUUID()}`;
    const startTimeMs = Date.now();
    const env = this.sanitizeEnvironment(request.env);

    let stdoutBuffer = Buffer.alloc(0);
    let stderrBuffer = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;

    return new Promise<ProcessExecutionOutcome>((resolve, reject) => {
      let child: ChildProcess;

      try {
        // Spawn with shell: false to guarantee typed execve / CreateProcess without shell parsing
        child = spawn(request.command, request.args, {
          cwd: request.cwd,
          env,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        return reject(err);
      }

      const processInfo: ManagedProcessInfo = {
        processToken,
        pid: child.pid,
        command: request.command,
        args: request.args,
        cwd: request.cwd,
        startTime: new Date(startTimeMs).toISOString(),
        creationTimeMs: startTimeMs,
        status: 'RUNNING',
      };

      this.activeProcesses.set(processToken, { info: processInfo, child });

      // Handle Timeout
      const timer = setTimeout(() => {
        timedOut = true;
        processInfo.status = 'TIMED_OUT';
        this.logger?.warn(
          `Process '${processToken}' (PID ${child.pid}) timed out after ${timeoutMs}ms.`,
        );
        this.terminateChild(child);
      }, timeoutMs);

      // Handle Stdout
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBuffer.length + chunk.length > maxOutputSizeBytes) {
          truncated = true;
          const remainingSpace = Math.max(0, maxOutputSizeBytes - stdoutBuffer.length);
          if (remainingSpace > 0) {
            stdoutBuffer = Buffer.concat([stdoutBuffer, chunk.subarray(0, remainingSpace)]);
          }
        } else {
          stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
        }
      });

      // Handle Stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBuffer.length + chunk.length > maxOutputSizeBytes) {
          truncated = true;
          const remainingSpace = Math.max(0, maxOutputSizeBytes - stderrBuffer.length);
          if (remainingSpace > 0) {
            stderrBuffer = Buffer.concat([stderrBuffer, chunk.subarray(0, remainingSpace)]);
          }
        } else {
          stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(processToken);
        reject(err);
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTimeMs;
        processInfo.status = timedOut ? 'TIMED_OUT' : 'EXITED';
        processInfo.exitCode = exitCode;
        processInfo.signal = signal ? String(signal) : null;
        processInfo.durationMs = durationMs;

        this.activeProcesses.delete(processToken);

        resolve({
          processToken,
          pid: child.pid,
          exitCode,
          signal: signal ? String(signal) : null,
          durationMs,
          stdout: stdoutBuffer.toString('utf-8'),
          stderr: stderrBuffer.toString('utf-8'),
          truncated,
          timedOut,
        });
      });
    });
  }

  /**
   * Kills an active managed process by its processToken.
   */
  public killProcess(processToken: string): boolean {
    const entry = this.activeProcesses.get(processToken);
    if (!entry) {
      return false;
    }

    entry.info.status = 'KILLED';
    this.terminateChild(entry.child);
    this.activeProcesses.delete(processToken);
    return true;
  }

  /**
   * Lists active managed background processes.
   */
  public listProcesses(): ManagedProcessInfo[] {
    return Array.from(this.activeProcesses.values()).map((e) => ({ ...e.info }));
  }

  /**
   * Kills all active managed child processes on shutdown.
   */
  public killAll(): void {
    for (const [token, entry] of Array.from(this.activeProcesses.entries())) {
      entry.info.status = 'KILLED';
      this.terminateChild(entry.child);
      this.activeProcesses.delete(token);
    }
  }

  /**
   * Safely terminates child process tree.
   */
  private terminateChild(child: ChildProcess): void {
    if (!child || child.killed || child.exitCode !== null) {
      return;
    }

    try {
      if (process.platform === 'win32' && child.pid) {
        // Windows tree termination
        spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: false });
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill failures if process is already dead
      }
    }
  }
}
