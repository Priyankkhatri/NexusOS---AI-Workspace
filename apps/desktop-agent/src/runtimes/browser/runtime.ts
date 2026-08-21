import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
import { DomainSecurityService } from './domain-security.js';
import { BrowserSessionManager } from './session-manager.js';
import {
  BrowserOperationName,
  BrowserOperationRequestContext,
  BrowserOperationResult,
  ClearSessionRequest,
  DEFAULT_BROWSER_RESOURCE_LIMITS,
  DownloadRequest,
  ExtractRequest,
  InteractRequest,
  NavigateRequest,
  ScreenshotRequest,
  UploadRequest,
} from './types.js';

export class BrowserRuntime {
  public static readonly RUNTIME_ID = 'rt:browser-v1';

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly domainSecurity: DomainSecurityService = new DomainSecurityService(),
    public readonly sessionManager: BrowserSessionManager = new BrowserSessionManager(),
    private readonly pathSecurity: PathSecurityService = new PathSecurityService(),
    private readonly logger?: AgentLogger,
  ) {}

  public getDescriptor(): ToolRuntimeDescriptor {
    return Object.freeze({
      runtimeId: BrowserRuntime.RUNTIME_ID,
      category: RuntimeCategory.BROWSER,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: [
        BrowserOperationName.NAVIGATE,
        BrowserOperationName.EXTRACT,
        BrowserOperationName.INTERACT,
        BrowserOperationName.SCREENSHOT,
        BrowserOperationName.DOWNLOAD,
        BrowserOperationName.UPLOAD,
        BrowserOperationName.CLEAR_SESSION,
      ],
    });
  }

  /**
   * Navigates to a target URL within policy domain allowlists and SSRF boundaries.
   */
  public async navigate(
    request: NavigateRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<string>; event: EventEnvelope }> {
    const sec = this.domainSecurity.validateUrl(request.url, request.allowedDomains);
    if (!sec.valid) {
      return this.buildDeniedResult(
        BrowserOperationName.NAVIGATE,
        request.sessionId,
        context,
        sec.error?.code || 'UNAUTHORIZED_DOMAIN',
        sec.error?.message || 'Domain security check failed',
      );
    }

    return this.executeProtectedOperation(
      BrowserOperationName.NAVIGATE,
      request.sessionId,
      context,
      async () => {
        this.sessionManager.updateSessionUrl(request.sessionId, sec.normalizedUrl);

        return {
          activeUrl: sec.normalizedUrl,
          data: sec.normalizedUrl,
          meta: { domain: sec.domain },
        };
      },
    );
  }

  /**
   * Extracts structured page content bounded by size and resource limits.
   */
  public async extractContent(
    request: ExtractRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<string>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      BrowserOperationName.EXTRACT,
      request.sessionId,
      context,
      async (session) => {
        const limits = { ...DEFAULT_BROWSER_RESOURCE_LIMITS, ...context.limits };
        const maxBytes = request.maxSizeBytes ?? limits.maxExtractionSizeBytes;

        const rawContent = `<html><body><main>Structured Content for session ${session.sessionId} at ${session.activeUrl || 'about:blank'}</main></body></html>`;
        const contentBuffer = Buffer.from(rawContent, 'utf-8');
        const truncated = contentBuffer.length > maxBytes;
        const finalContent = truncated
          ? contentBuffer.subarray(0, maxBytes).toString('utf-8')
          : rawContent;

        return {
          activeUrl: session.activeUrl,
          bytesProcessed: contentBuffer.length,
          data: finalContent,
          meta: { truncated },
        };
      },
    );
  }

  /**
   * Interacts with page elements (clicks/fills/submits), automatically pausing for sensitive forms/auth.
   */
  public async interactForm(
    request: InteractRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      BrowserOperationName.INTERACT,
      request.sessionId,
      context,
      async (session) => {
        const lowerSelector = request.selector.toLowerCase();
        const isSensitive =
          request.isSensitiveForm ||
          request.actionType === 'submit' ||
          /password|login|auth|mfa|captcha|paywall|credit[_-]?card|ssn|card|cvv|pin|checkout|pay|purchase|transfer|confirm|delete|account|security|submit|approve|withdraw/i.test(
            lowerSelector,
          );

        if (isSensitive) {
          return {
            activeUrl: session.activeUrl,
            data: false,
            humanInterventionRequired: true,
            interventionReason: `Sensitive form interaction ('${request.selector}', action: '${request.actionType}') requires explicit user authorization per PRD BRW-002/BRW-004.`,
          };
        }

        return {
          activeUrl: session.activeUrl,
          data: true,
        };
      },
    );
  }

  /**
   * Captures page screenshot and writes to an authorized filesystem location.
   */
  public async captureScreenshot(
    request: ScreenshotRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<string>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      BrowserOperationName.SCREENSHOT,
      request.sessionId,
      context,
      async (session) => {
        // Validate destination path against allowedRoots using PathSecurityService
        const pathSec = this.pathSecurity.validatePath(
          request.destinationPath,
          context.allowedRoots,
        );
        if (!pathSec.valid) {
          throw createNexusOSError(
            pathSec.error?.code || 'PATH_OUTSIDE_SCOPE',
            ErrorCategory.AUTHORIZATION,
            `Screenshot destination path outside authorized scope: ${pathSec.error?.message}`,
          );
        }

        const limits = { ...DEFAULT_BROWSER_RESOURCE_LIMITS, ...context.limits };
        const mockPngBuffer = Buffer.from(`MOCK_PNG_SCREENSHOT_${session.sessionId}_${Date.now()}`);

        if (mockPngBuffer.length > limits.maxScreenshotSizeBytes) {
          throw createNexusOSError(
            'SCREENSHOT_TOO_LARGE',
            ErrorCategory.VALIDATION,
            `Screenshot size (${mockPngBuffer.length} bytes) exceeds limit (${limits.maxScreenshotSizeBytes} bytes).`,
          );
        }

        const destDir = path.dirname(pathSec.canonicalPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        fs.writeFileSync(pathSec.canonicalPath, mockPngBuffer);

        return {
          activeUrl: session.activeUrl,
          bytesProcessed: mockPngBuffer.length,
          data: pathSec.canonicalPath,
        };
      },
    );
  }

  /**
   * Downloads a file from an allowed domain and writes it to an authorized filesystem scope.
   */
  public async downloadFile(
    request: DownloadRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<string>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      BrowserOperationName.DOWNLOAD,
      request.sessionId,
      context,
      async (session) => {
        // 1. Validate download URL domain security
        const domainSec = this.domainSecurity.validateUrl(
          request.downloadUrl,
          request.allowedDomains,
        );
        if (!domainSec.valid) {
          throw createNexusOSError(
            domainSec.error?.code || 'UNAUTHORIZED_DOMAIN',
            ErrorCategory.AUTHORIZATION,
            domainSec.error?.message || 'Download URL domain security check failed',
          );
        }

        // 1b. Validate redirect destination if download URL redirects
        if (request.redirectUrl) {
          const redirectSec = this.domainSecurity.validateRedirect(
            request.downloadUrl,
            request.redirectUrl,
            request.allowedDomains,
          );
          if (!redirectSec.valid) {
            throw createNexusOSError(
              redirectSec.error?.code || 'UNAUTHORIZED_REDIRECT',
              ErrorCategory.AUTHORIZATION,
              redirectSec.error?.message || 'Download redirect security check failed',
            );
          }
        }

        // 2. Validate destination file path using PathSecurityService
        const pathSec = this.pathSecurity.validatePath(
          request.destinationPath,
          context.allowedRoots,
        );
        if (!pathSec.valid) {
          throw createNexusOSError(
            pathSec.error?.code || 'PATH_OUTSIDE_SCOPE',
            ErrorCategory.AUTHORIZATION,
            `Download destination path outside authorized scope: ${pathSec.error?.message}`,
          );
        }

        const limits = { ...DEFAULT_BROWSER_RESOURCE_LIMITS, ...context.limits };
        const mockDownloadBuffer = Buffer.from(`MOCK_DOWNLOAD_DATA_${request.downloadUrl}`);

        if (mockDownloadBuffer.length > limits.maxDownloadSizeBytes) {
          throw createNexusOSError(
            'DOWNLOAD_TOO_LARGE',
            ErrorCategory.VALIDATION,
            `Download size (${mockDownloadBuffer.length} bytes) exceeds limit (${limits.maxDownloadSizeBytes} bytes).`,
          );
        }

        const destDir = path.dirname(pathSec.canonicalPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        fs.writeFileSync(pathSec.canonicalPath, mockDownloadBuffer);

        return {
          activeUrl: session.activeUrl,
          bytesProcessed: mockDownloadBuffer.length,
          data: pathSec.canonicalPath,
        };
      },
    );
  }

  /**
   * Uploads a file from an authorized filesystem scope.
   */
  public async uploadFile(
    request: UploadRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      BrowserOperationName.UPLOAD,
      request.sessionId,
      context,
      async (session) => {
        // Validate source file path using PathSecurityService
        const pathSec = this.pathSecurity.validatePath(
          request.sourceFilePath,
          context.allowedRoots,
        );
        if (!pathSec.valid) {
          throw createNexusOSError(
            pathSec.error?.code || 'PATH_OUTSIDE_SCOPE',
            ErrorCategory.AUTHORIZATION,
            `Upload source file path outside authorized scope: ${pathSec.error?.message}`,
          );
        }

        if (!fs.existsSync(pathSec.canonicalPath)) {
          throw createNexusOSError(
            'NOT_FOUND',
            ErrorCategory.NOT_FOUND,
            `Upload source file '${pathSec.canonicalPath}' does not exist.`,
          );
        }

        const stat = fs.statSync(pathSec.canonicalPath);

        return {
          activeUrl: session.activeUrl,
          bytesProcessed: stat.size,
          data: true,
        };
      },
    );
  }

  /**
   * Shuts down the browser runtime by cleaning up all active browser sessions
   * and their profile directories. Safe to call multiple times.
   */
  public shutdown(): void {
    try {
      this.sessionManager.cleanupAbandonedSessions(0);
    } catch {
      // Suppress cleanup errors during shutdown to not block agent stop
    }
    this.logger?.info('BrowserRuntime shutdown: all sessions cleared.', {});
  }

  /**
   * Clears browser session state and profiles.
   */
  public async clearSession(
    request: ClearSessionRequest,
    context: BrowserOperationRequestContext,
  ): Promise<{ result: BrowserOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      BrowserOperationName.CLEAR_SESSION,
      request.sessionId,
      context,
      async () => {
        const cleared = this.sessionManager.clearSession(request.sessionId);
        return {
          data: cleared,
        };
      },
    );
  }

  /**
   * Centralized protected operation boundary.
   */
  private async executeProtectedOperation<T>(
    operation: BrowserOperationName,
    sessionId: string,
    context: BrowserOperationRequestContext,
    action: (session: ReturnType<BrowserSessionManager['getSession']> & {}) => Promise<{
      activeUrl?: string;
      bytesProcessed?: number;
      data: T;
      humanInterventionRequired?: boolean;
      interventionReason?: string;
      meta?: Record<string, unknown>;
    }>,
  ): Promise<{ result: BrowserOperationResult<T>; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    // 1. Lease & Policy Evaluation
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      return this.buildDeniedResult(
        operation,
        sessionId,
        context,
        'LEASE_OR_POLICY_INVALID',
        leaseResult.reason || 'Lease validation failed',
      );
    }

    // 2. Capability Scope Check
    if (!context.lease.scopes.includes(operation)) {
      return this.buildDeniedResult(
        operation,
        sessionId,
        context,
        'MISSING_CAPABILITY_SCOPE',
        `Lease does not grant capability '${operation}'.`,
      );
    }

    // 3. Get Session
    const session = this.sessionManager.getSession(sessionId);
    if (!session && operation !== BrowserOperationName.CLEAR_SESSION) {
      return this.buildDeniedResult(
        operation,
        sessionId,
        context,
        'INVALID_SESSION',
        `Browser session '${sessionId}' was not found.`,
      );
    }

    // 4. Action Execution
    try {
      const outcome = await action(
        (session || { sessionId }) as unknown as Parameters<typeof action>[0],
      );

      const result: BrowserOperationResult<T> = {
        success: !outcome.humanInterventionRequired,
        operation,
        sessionId,
        activeUrl: outcome.activeUrl,
        bytesProcessed: outcome.bytesProcessed,
        data: outcome.data,
        humanInterventionRequired: outcome.humanInterventionRequired,
        interventionReason: outcome.interventionReason,
        evidenceId,
      };

      const schemaEvent = outcome.humanInterventionRequired
        ? 'intervention'
        : operation.replace('brw:', '');
      const eventPayload: Record<string, unknown> = {
        operation,
        sessionId,
        activeUrl: outcome.activeUrl,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        status: outcome.humanInterventionRequired ? 'INTERVENTION_REQUIRED' : 'SUCCESS',
        interventionReason: outcome.interventionReason,
        bytesProcessed: outcome.bytesProcessed,
        ...outcome.meta,
      };

      const event = createEventEnvelope(
        `nexusos.events.browser.${schemaEvent}.v1`,
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      this.logger?.info(`Browser operation completed: ${operation}`, {
        operation,
        sessionId,
        status: eventPayload['status'],
      });

      return { result, event };
    } catch (err) {
      const errCategory = (err as { category?: ErrorCategory }).category || ErrorCategory.SYSTEM;
      const errCode = (err as { code?: string }).code || 'BROWSER_OPERATION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);

      const result: BrowserOperationResult<T> = {
        success: false,
        operation,
        sessionId,
        evidenceId,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const eventPayload: Record<string, unknown> = {
        operation,
        sessionId,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        status: 'FAILED',
        errorCode: errCode,
        errorMessage: errMessage,
      };

      const event = createEventEnvelope(
        'nexusos.events.browser.error.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      return { result, event };
    }
  }

  private buildDeniedResult<T>(
    operation: BrowserOperationName,
    sessionId: string,
    context: BrowserOperationRequestContext,
    code: string,
    message: string,
  ): { result: BrowserOperationResult<T>; event: EventEnvelope } {
    const evidenceId = crypto.randomUUID();

    const result: BrowserOperationResult<T> = {
      success: false,
      operation,
      sessionId,
      evidenceId,
      error: {
        code,
        category: ErrorCategory.AUTHORIZATION,
        message,
      },
    };

    const eventPayload: Record<string, unknown> = {
      operation,
      sessionId,
      taskId: context.lease.task_id,
      leaseId: context.lease.lease_id,
      agentId: context.lease.agent_id,
      tenantId: context.lease.tenant_id,
      status: 'DENIED',
      errorCode: code,
      errorMessage: message,
    };

    const event = createEventEnvelope(
      'nexusos.events.browser.denied.v1',
      '1.0.0',
      context.lease.agent_id,
      context.lease.nonce || context.lease.task_id,
      eventPayload,
    );

    return { result, event };
  }
}
