import crypto from 'node:crypto';
import type { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import type { RedactionFilter } from '../telemetry/redaction-filter.js';
import {
  type ApprovalDecisionRequest,
  type ApprovalDecisionResult,
  type ApprovalPromptItem,
  type ApprovalPromptRequest,
  ApprovalPromptRequestSchema,
  DEFAULT_PROMPT_TTL_SECONDS,
  UIError,
} from './types.js';

export class NativeApprovalHost {
  private readonly prompts = new Map<string, ApprovalPromptItem>();
  private readonly promptTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly leaseBoundary?: ExecutionLeaseBoundary,
    private readonly redactionFilter?: RedactionFilter,
  ) {}

  /**
   * Presents a new user authorization prompt request and registers it in pending storage.
   */
  public async presentPrompt(request: ApprovalPromptRequest): Promise<ApprovalPromptItem> {
    const parsed = ApprovalPromptRequestSchema.parse(request);

    // Lease header re-validation if leaseBoundary is injected
    if (this.leaseBoundary) {
      const leaseRes = await this.leaseBoundary.validateLease(parsed.leaseHeader);
      if (!leaseRes.valid) {
        throw new UIError(
          'Lease re-validation failed for approval prompt request',
          'UNAUTHORIZED',
        );
      }
    }

    const promptId = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const ttlSeconds = parsed.ttlSeconds || DEFAULT_PROMPT_TTL_SECONDS;
    const expiresAt = now + ttlSeconds * 1000;

    const rawTitle = parsed.title;
    const rawDescription = parsed.description;

    // Apply secret redaction if redactionFilter is available
    const sanitizedTitle = this.redactionFilter
      ? this.redactionFilter.redactString(rawTitle)
      : rawTitle;
    const sanitizedDescription = this.redactionFilter
      ? this.redactionFilter.redactString(rawDescription)
      : rawDescription;

    const item: ApprovalPromptItem = {
      promptId,
      requestId: parsed.requestId,
      leaseId: parsed.leaseHeader.lease_id,
      tenantId: parsed.tenantId || parsed.leaseHeader.tenant_id,
      deviceId: parsed.deviceId,
      title: sanitizedTitle,
      description: sanitizedDescription,
      riskTier: parsed.riskTier,
      actionIdentifier: parsed.actionIdentifier,
      nonce,
      state: 'PENDING',
      createdAt: now,
      expiresAt,
      isLockScreenPrivate: parsed.isLockScreenPrivate ?? false,
      metadata: parsed.metadata,
    };

    this.prompts.set(promptId, item);

    // Schedule auto-expiration timer
    const timer = setTimeout(() => {
      this.performAutoExpire(promptId);
    }, ttlSeconds * 1000);

    if (timer.unref) {
      timer.unref();
    }
    this.promptTimers.set(promptId, timer);

    return { ...item };
  }

  /**
   * Retrieves a prompt item for UI presentation, applying lock-screen privacy sanitization when active.
   */
  public getSanitizedPromptForUI(
    promptId: string,
    isLockScreen = false,
  ): ApprovalPromptItem | undefined {
    const item = this.prompts.get(promptId);
    if (!item) return undefined;

    const copy = { ...item };
    if (isLockScreen || item.isLockScreenPrivate) {
      copy.description = '[REDACTED FOR PRIVACY - SENSITIVE CONTENT]';
      copy.metadata = undefined;
    }
    return copy;
  }

  /**
   * Retrieves a prompt item by ID.
   */
  public getPrompt(promptId: string, tenantId?: string): ApprovalPromptItem | undefined {
    const item = this.prompts.get(promptId);
    if (!item) return undefined;
    if (tenantId && item.tenantId !== tenantId) {
      throw new UIError(`Prompt tenant mismatch for prompt '${promptId}'`, 'TENANT_MISMATCH');
    }
    return { ...item };
  }

  /**
   * Lists all currently pending approval prompts for an authorized tenant.
   */
  public listPendingPrompts(tenantId?: string): ApprovalPromptItem[] {
    const pending: ApprovalPromptItem[] = [];
    const now = Date.now();

    for (const item of this.prompts.values()) {
      if (item.state === 'PENDING' && item.expiresAt > now) {
        if (!tenantId || item.tenantId === tenantId) {
          pending.push({ ...item });
        }
      }
    }

    return pending;
  }

  /**
   * Cancels a pending approval prompt.
   */
  public cancelPrompt(promptId: string, reason = 'Cancelled by system'): boolean {
    const item = this.prompts.get(promptId);
    if (item && item.state === 'PENDING') {
      item.state = 'CANCELLED';
      const timer = this.promptTimers.get(promptId);
      if (timer) {
        clearTimeout(timer);
        this.promptTimers.delete(promptId);
      }
      return true;
    }
    return false;
  }

  /**
   * Performs auto-expiration when timer fires.
   */
  private performAutoExpire(promptId: string): void {
    const item = this.prompts.get(promptId);
    if (item && item.state === 'PENDING') {
      item.state = 'EXPIRED';
    }
    this.promptTimers.delete(promptId);
  }

  /**
   * Submits a user authorization decision (ALLOW / DENY) for a pending prompt under lease validation and replay protection.
   */
  public async submitDecision(request: ApprovalDecisionRequest): Promise<ApprovalDecisionResult> {
    const item = this.prompts.get(request.promptId);
    if (!item) {
      throw new UIError(`Approval prompt '${request.promptId}' not found`, 'PROMPT_NOT_FOUND');
    }

    if (request.tenantId && item.tenantId !== request.tenantId) {
      throw new UIError(
        `Cross-tenant decision submission blocked for prompt '${request.promptId}'`,
        'TENANT_MISMATCH',
      );
    }

    // 1. Double-click & replay race protection: state must be PENDING
    if (item.state !== 'PENDING') {
      throw new UIError(
        `Approval prompt '${request.promptId}' is already resolved in state '${item.state}'`,
        'PROMPT_ALREADY_RESOLVED',
      );
    }

    // 2. Nonce verification
    if (item.nonce !== request.nonce) {
      throw new UIError(
        `Nonce mismatch for approval prompt '${request.promptId}'`,
        'NONCE_MISMATCH',
      );
    }

    // Clear auto-expire timer
    const timer = this.promptTimers.get(request.promptId);
    if (timer) {
      clearTimeout(timer);
      this.promptTimers.delete(request.promptId);
    }

    // 3. TTL Expiration check
    if (Date.now() > item.expiresAt) {
      item.state = 'EXPIRED';
      throw new UIError(`Approval prompt '${request.promptId}' has expired`, 'PROMPT_EXPIRED');
    }

    // 4. Lease TOCTOU protection: re-validate lease header at decision time
    if (this.leaseBoundary) {
      const leaseRes = await this.leaseBoundary.validateLease(request.leaseHeader);
      if (!leaseRes.valid) {
        item.state = 'DENIED';
        throw new UIError(
          'Lease re-validation failed at decision submission time',
          'UNAUTHORIZED',
        );
      }
    }

    // 5. Atomic state transition
    const finalState = request.decision === 'ALLOW' ? 'APPROVED' : 'DENIED';
    item.state = finalState;

    const resolvedAt = Date.now();
    const receiptPayload = `${item.promptId}:${item.requestId}:${request.decision}:${resolvedAt}:${request.nonce}`;
    const receiptHash = crypto.createHash('sha256').update(receiptPayload).digest('hex');

    return {
      promptId: item.promptId,
      requestId: item.requestId,
      decision: request.decision,
      state: finalState,
      resolvedAt,
      receiptHash,
    };
  }

  /**
   * Deterministic shutdown purging all pending timers and cancelling pending prompts.
   */
  public shutdown(): void {
    for (const timer of this.promptTimers.values()) {
      clearTimeout(timer);
    }
    this.promptTimers.clear();

    for (const item of this.prompts.values()) {
      if (item.state === 'PENDING') {
        item.state = 'CANCELLED';
      }
    }
  }
}
