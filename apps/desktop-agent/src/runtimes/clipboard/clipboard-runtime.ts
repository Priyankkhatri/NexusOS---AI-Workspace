import crypto from 'node:crypto';
import type { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import type { RedactionFilter } from '../../telemetry/redaction-filter.js';
import {
  type ClipboardItem,
  type ClipboardReadRequest,
  type ClipboardReadResult,
  type ClipboardWriteRequest,
  type ClipboardWriteResult,
  type IClipboardProvider,
  ClipboardReadRequestSchema,
  ClipboardWriteRequestSchema,
  ClipboardRuntimeError,
  DefaultSystemClipboardProvider,
  MAX_CLIPBOARD_TEXT_BYTES,
  DEFAULT_CLIPBOARD_TTL_SECONDS,
} from './types.js';

export class ClipboardRuntimeManager {
  private readonly provider: IClipboardProvider;
  private autoClearTimer: NodeJS.Timeout | null = null;
  private lastWrittenHash: string | null = null;

  public getLastWrittenHash(): string | null {
    return this.lastWrittenHash;
  }

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly redactionFilter: RedactionFilter,
    provider?: IClipboardProvider,
  ) {
    this.provider = provider ?? new DefaultSystemClipboardProvider();
  }

  /**
   * Reads clipboard text securely under lease policy validation and secret redaction.
   */
  public async readClipboard(request: ClipboardReadRequest): Promise<ClipboardReadResult> {
    const parsed = ClipboardReadRequestSchema.parse(request);

    // 1. Re-validate execution lease header
    const leaseRes = await this.leaseBoundary.validateLease(parsed.leaseHeader);
    if (!leaseRes.valid) {
      throw new ClipboardRuntimeError(
        'Lease re-validation failed for clipboard read operation',
        'READ_DENIED',
      );
    }

    try {
      let rawText = await this.provider.readText();
      if (!rawText) {
        return { redacted: false, wasTruncated: false };
      }

      let wasTruncated = false;
      const maxBytes = parsed.maxBytes || MAX_CLIPBOARD_TEXT_BYTES;
      if (Buffer.byteLength(rawText, 'utf-8') > maxBytes) {
        const buf = Buffer.from(rawText, 'utf-8');
        rawText = buf.subarray(0, maxBytes).toString('utf-8');
        wasTruncated = true;
      }

      // Sanitize secrets from clipboard output
      const sanitized = this.redactionFilter.redactString(rawText);
      const redacted = sanitized !== rawText;

      const contentHash = crypto.createHash('sha256').update(sanitized).digest('hex');

      const item: ClipboardItem = {
        id: crypto.randomUUID(),
        contentType: 'text',
        text: sanitized,
        contentHash,
        sensitivity: redacted ? 'Sensitive' : 'Public',
        timestamp: Date.now(),
      };

      return {
        item,
        redacted,
        wasTruncated,
      };
    } catch (err) {
      if (err instanceof ClipboardRuntimeError) throw err;
      throw new ClipboardRuntimeError('Failed to read system clipboard', 'PROVIDER_ERROR', err);
    }
  }

  /**
   * Writes text to clipboard under lease authorization, secret redaction, and optional TTL auto-clear.
   */
  public async writeClipboard(request: ClipboardWriteRequest): Promise<ClipboardWriteResult> {
    const parsed = ClipboardWriteRequestSchema.parse(request);

    // 1. Re-validate execution lease header
    const leaseRes = await this.leaseBoundary.validateLease(parsed.leaseHeader);
    if (!leaseRes.valid) {
      throw new ClipboardRuntimeError(
        'Lease re-validation failed for clipboard write operation',
        'WRITE_DENIED',
      );
    }

    try {
      const rawText = parsed.text || parsed.buffer?.toString('utf-8') || '';
      
      // Sanitize secrets before writing to system clipboard
      const sanitizedText = this.redactionFilter.redactString(rawText);
      const contentHash = crypto.createHash('sha256').update(sanitizedText).digest('hex');

      await this.provider.writeText(sanitizedText);
      this.lastWrittenHash = contentHash;

      // Cancel previous auto-clear timer if running
      if (this.autoClearTimer) {
        clearTimeout(this.autoClearTimer);
        this.autoClearTimer = null;
      }

      let autoClearScheduled = false;
      const ttlSeconds = parsed.ttlSeconds || DEFAULT_CLIPBOARD_TTL_SECONDS;

      if (parsed.isSensitive) {
        autoClearScheduled = true;
        this.autoClearTimer = setTimeout(() => {
          void this.performAutoClear(contentHash);
        }, ttlSeconds * 1000);
        
        // Unref timer so it doesn't block process exit in Node tests
        if (this.autoClearTimer.unref) {
          this.autoClearTimer.unref();
        }
      }

      return {
        success: true,
        itemHash: contentHash,
        autoClearScheduled,
        ttlSeconds: autoClearScheduled ? ttlSeconds : undefined,
      };
    } catch (err) {
      if (err instanceof ClipboardRuntimeError) throw err;
      throw new ClipboardRuntimeError('Failed to write system clipboard', 'PROVIDER_ERROR', err);
    }
  }

  /**
   * Clears clipboard content if explicit request or auto-clear TTL triggers.
   */
  public async clearClipboard(): Promise<void> {
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    this.lastWrittenHash = null;
    await this.provider.clear();
  }

  /**
   * Returns true if an auto-clear timer is currently scheduled.
   */
  public isAutoClearScheduled(): boolean {
    return this.autoClearTimer !== null;
  }

  /**
   * Explicitly cancels the active auto-clear timer without wiping the clipboard.
   */
  public cancelAutoClear(): boolean {
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = null;
      return true;
    }
    return false;
  }

  /**
   * TOCTOU-safe auto-clearing check: wipes clipboard ONLY if the content hash matches lastWrittenHash.
   */
  public async performAutoClear(expectedHash: string): Promise<boolean> {
    try {
      const currentText = await this.provider.readText();
      const currentHash = crypto.createHash('sha256').update(currentText).digest('hex');

      if (currentHash === expectedHash) {
        await this.provider.clear();
        this.lastWrittenHash = null;
        if (this.autoClearTimer) {
          clearTimeout(this.autoClearTimer);
          this.autoClearTimer = null;
        }
        return true;
      }
      return false; // User altered clipboard; preserve user content
    } catch {
      return false;
    }
  }

  /**
   * Clean shutdown handler clearing pending timers and wiping transient memory state.
   */
  public shutdown(): void {
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    this.lastWrittenHash = null;
  }
}
