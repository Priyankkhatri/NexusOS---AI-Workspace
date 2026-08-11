import crypto from 'node:crypto';
import {
  createEventEnvelope,
  EventEnvelope,
  createNexusOSError,
  ErrorCategory,
} from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { RuntimeCategory, ToolRuntimeDescriptor } from '../../registry/runtime-registry.js';
import { AgentLogger } from '../../observability/agent-logger.js';
import { PathSecurityService } from '../filesystem/path-security.js';
import { ProcessSupervisor } from './process-supervisor.js';
import {
  ExecuteCommandRequest,
  ExecuteCommandResult,
  KillProcessRequest,
  ManagedProcessInfo,
  PERMITTED_COMMAND_ALLOWLIST,
  TerminalOperationName,
  TerminalOperationRequestContext,
} from './types.js';

export class TerminalRuntime {
  public static readonly RUNTIME_ID = 'rt:terminal-v1';

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly processSupervisor: ProcessSupervisor = new ProcessSupervisor(),
    private readonly pathSecurity: PathSecurityService = new PathSecurityService(),
    private readonly logger?: AgentLogger,
  ) {}

  public getDescriptor(): ToolRuntimeDescriptor {
    return Object.freeze({
      runtimeId: TerminalRuntime.RUNTIME_ID,
      category: RuntimeCategory.TERMINAL,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: [
        TerminalOperationName.EXECUTE,
        TerminalOperationName.KILL,
        TerminalOperationName.LIST_PROCESSES,
      ],
    });
  }

  /**
   * Executes an approved tool command within a supervised child process after lease, policy,
   * command allowlist, and working-directory validation.
   */
  public async executeCommand(
    request: ExecuteCommandRequest,
    context: TerminalOperationRequestContext,
  ): Promise<{ result: ExecuteCommandResult; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    // 1. Lease & Policy Evaluation
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      return this.buildDeniedResult(
        TerminalOperationName.EXECUTE,
        request.command,
        context,
        'LEASE_OR_POLICY_INVALID',
        leaseResult.reason || 'Lease or policy validation failed',
      );
    }

    // 2. Capability Scope Check
    if (!context.lease.scopes.includes(TerminalOperationName.EXECUTE)) {
      return this.buildDeniedResult(
        TerminalOperationName.EXECUTE,
        request.command,
        context,
        'MISSING_CAPABILITY_SCOPE',
        `Lease does not grant capability '${TerminalOperationName.EXECUTE}'. Granted scopes: [${context.lease.scopes.join(', ')}].`,
      );
    }

    // 3. Command Allowlist Validation
    const rawCmd = request.command ? request.command.trim() : '';
    const cmdBasename = rawCmd.split(/[/\\]/).pop()?.toLowerCase() || '';

    if (
      !PERMITTED_COMMAND_ALLOWLIST.has(rawCmd.toLowerCase()) &&
      !PERMITTED_COMMAND_ALLOWLIST.has(cmdBasename)
    ) {
      return this.buildDeniedResult(
        TerminalOperationName.EXECUTE,
        request.command,
        context,
        'UNAUTHORIZED_COMMAND',
        `Command '${request.command}' is not in the permitted tool allowlist. Permitted tools: [${Array.from(PERMITTED_COMMAND_ALLOWLIST).join(', ')}].`,
      );
    }

    // 4. Argument Vector Validation (must be an array)
    if (!Array.isArray(request.args)) {
      return this.buildDeniedResult(
        TerminalOperationName.EXECUTE,
        request.command,
        context,
        'INVALID_ARGUMENT_VECTOR',
        'Command arguments must be passed as an explicit array of strings.',
      );
    }

    // 5. Working Directory Path Security Check
    const pathSec = this.pathSecurity.validatePath(request.cwd, context.allowedRoots);
    if (!pathSec.valid) {
      return this.buildDeniedResult(
        TerminalOperationName.EXECUTE,
        request.command,
        context,
        pathSec.error?.code || 'WORKING_DIRECTORY_OUTSIDE_SCOPE',
        `Working directory '${request.cwd}' is outside authorized scope: ${pathSec.error?.message}`,
      );
    }

    // 6. Execute Supervised Child Process
    try {
      const outcome = await this.processSupervisor.executeSupervisedProcess(
        {
          ...request,
          cwd: pathSec.canonicalPath,
        },
        context.limits,
      );

      // 7. Redact output streams for evidence safety
      const redactedStdout = this.redactText(outcome.stdout);
      const redactedStderr = this.redactText(outcome.stderr);

      const result: ExecuteCommandResult = {
        success: !outcome.timedOut && outcome.exitCode === 0,
        processToken: outcome.processToken,
        pid: outcome.pid,
        command: request.command,
        args: request.args,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        durationMs: outcome.durationMs,
        stdout: redactedStdout,
        stderr: redactedStderr,
        truncated: outcome.truncated,
        evidenceId,
      };

      if (outcome.timedOut) {
        result.error = {
          code: 'COMMAND_TIMEOUT',
          category: ErrorCategory.TIMEOUT,
          message: `Process execution timed out after ${outcome.durationMs}ms.`,
        };
      }

      // 8. Produce Evidence Event Envelope
      const eventPayload: Record<string, unknown> = {
        operation: TerminalOperationName.EXECUTE,
        command: request.command,
        args: request.args,
        cwd: pathSec.canonicalPath,
        processToken: outcome.processToken,
        pid: outcome.pid,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
        truncated: outcome.truncated,
        status: result.success ? 'SUCCESS' : 'FAILED',
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
      };

      const event = createEventEnvelope(
        'nexusos.events.terminal.exited.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      this.logger?.info(`Terminal command executed: ${request.command}`, {
        command: request.command,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
      });

      return { result, event };
    } catch (err) {
      const errCategory = (err as { category?: ErrorCategory }).category || ErrorCategory.SYSTEM;
      const errCode = (err as { code?: string }).code || 'PROCESS_EXECUTION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);

      const result: ExecuteCommandResult = {
        success: false,
        processToken: 'none',
        command: request.command,
        args: request.args,
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdout: '',
        stderr: errMessage,
        truncated: false,
        evidenceId,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const eventPayload: Record<string, unknown> = {
        operation: TerminalOperationName.EXECUTE,
        command: request.command,
        args: request.args,
        cwd: request.cwd,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        status: 'FAILED',
        errorCode: errCode,
        errorMessage: errMessage,
      };

      const event = createEventEnvelope(
        'nexusos.events.terminal.error.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      return { result, event };
    }
  }

  /**
   * Kills a running managed process tree by processToken.
   */
  public async killProcess(
    request: KillProcessRequest,
    context: TerminalOperationRequestContext,
  ): Promise<{ success: boolean; event: EventEnvelope }> {
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      throw createNexusOSError(
        'LEASE_OR_POLICY_INVALID',
        ErrorCategory.AUTHORIZATION,
        leaseResult.reason || 'Lease validation failed',
      );
    }

    if (!context.lease.scopes.includes(TerminalOperationName.KILL)) {
      throw createNexusOSError(
        'MISSING_CAPABILITY_SCOPE',
        ErrorCategory.AUTHORIZATION,
        `Lease does not grant capability '${TerminalOperationName.KILL}'.`,
      );
    }

    const killed = this.processSupervisor.killProcess(request.processToken);

    const event = createEventEnvelope(
      'nexusos.events.terminal.killed.v1',
      '1.0.0',
      context.lease.agent_id,
      context.lease.nonce || context.lease.task_id,
      {
        operation: TerminalOperationName.KILL,
        processToken: request.processToken,
        killed,
      },
    );

    return { success: killed, event };
  }

  /**
   * Lists active managed background processes.
   */
  public async listProcesses(
    context: TerminalOperationRequestContext,
  ): Promise<ManagedProcessInfo[]> {
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      throw createNexusOSError(
        'LEASE_OR_POLICY_INVALID',
        ErrorCategory.AUTHORIZATION,
        leaseResult.reason || 'Lease validation failed',
      );
    }

    if (!context.lease.scopes.includes(TerminalOperationName.LIST_PROCESSES)) {
      throw createNexusOSError(
        'MISSING_CAPABILITY_SCOPE',
        ErrorCategory.AUTHORIZATION,
        `Lease does not grant capability '${TerminalOperationName.LIST_PROCESSES}'.`,
      );
    }

    return this.processSupervisor.listProcesses();
  }

  private redactText(text: string): string {
    if (!text) return '';
    // Apply basic secret pattern redaction for stdout/stderr
    return text.replace(
      /(api[_-]?key|secret|password|token|bearer\s+)[=:\s]+[A-Za-z0-9_\-.~]+/gi,
      '$1=[REDACTED]',
    );
  }

  private buildDeniedResult(
    operation: TerminalOperationName,
    command: string,
    context: TerminalOperationRequestContext,
    code: string,
    message: string,
  ): { result: ExecuteCommandResult; event: EventEnvelope } {
    const evidenceId = crypto.randomUUID();

    const result: ExecuteCommandResult = {
      success: false,
      processToken: 'none',
      command,
      args: [],
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdout: '',
      stderr: message,
      truncated: false,
      evidenceId,
      error: {
        code,
        category: ErrorCategory.AUTHORIZATION,
        message,
      },
    };

    const eventPayload: Record<string, unknown> = {
      operation,
      command,
      taskId: context.lease.task_id,
      leaseId: context.lease.lease_id,
      agentId: context.lease.agent_id,
      tenantId: context.lease.tenant_id,
      status: 'DENIED',
      errorCode: code,
      errorMessage: message,
    };

    const event = createEventEnvelope(
      'nexusos.events.terminal.denied.v1',
      '1.0.0',
      context.lease.agent_id,
      context.lease.nonce || context.lease.task_id,
      eventPayload,
    );

    this.logger?.warn(`Terminal operation denied: ${command}`, {
      operation,
      command,
      code,
      message,
    });

    return { result, event };
  }
}
