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
    return { ...item };
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
}
