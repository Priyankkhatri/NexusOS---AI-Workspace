import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { INotificationPolicyGate, NotificationAction, NotificationItem } from './types.js';

export class NotificationPolicyGate implements INotificationPolicyGate {
  constructor(private readonly redactionFilter: RedactionFilter = new RedactionFilter()) {}

  public sanitizeAndRedact(
    item: NotificationItem,
    isLockScreenActive: boolean = false,
  ): NotificationItem {
    if (!item) return item;

    // 1. Sanitize against HTML/JSON control character injection
    const sanitizedTitle = this.sanitizeText(item.title);
    const sanitizedMessage = this.sanitizeText(item.message);

    // 2. Secret Redaction via RedactionFilter
    const cleanTitle = this.redactionFilter.redactString(sanitizedTitle);
    let cleanMessage = this.redactionFilter.redactString(sanitizedMessage);
    const cleanMetadata = item.metadata
      ? this.redactionFilter.redactObject(item.metadata)
      : undefined;

    let isPrivacyRedacted = false;

    // 3. Lock-Screen Privacy Enforcement
    if (isLockScreenActive && item.category !== 'SYSTEM_INFO') {
      cleanMessage = '[LOCK_SCREEN_PRIVACY] Sensitive content hidden while device is locked.';
      isPrivacyRedacted = true;
    }

    // 4. Sanitize Actions
    const cleanActions: NotificationAction[] | undefined = item.actions?.map((act) => ({
      ...act,
      label: this.redactionFilter.redactString(this.sanitizeText(act.label)),
      requiresRevalidation: true, // Actions ALWAYS require revalidation
    }));

    return {
      ...item,
      title: cleanTitle,
      message: cleanMessage,
      actions: cleanActions,
      metadata: cleanMetadata,
      isPrivacyRedacted,
    };
  }

  public validateActionExecution(
    item: NotificationItem,
    actionId: string,
    providedAuthToken?: string,
  ): { allowed: boolean; reason?: string } {
    if (!item) {
      return { allowed: false, reason: 'Notification record not found.' };
    }

    // Check if notification has expired
    if (item.expiresAt && new Date(item.expiresAt).getTime() < Date.now()) {
      return { allowed: false, reason: 'Notification has expired. Action cannot be executed.' };
    }

    const action = item.actions?.find((a) => a.actionId === actionId);
    if (!action) {
      return { allowed: false, reason: `Action ID '${actionId}' not found on notification.` };
    }

    // MANDATORY REVALIDATION BOUNDARY: Notifications are NEVER authorization proof!
    if (!providedAuthToken || providedAuthToken.trim().length === 0) {
      return {
        allowed: false,
        reason:
          'Action execution requires valid revalidation auth token. Notification click alone is not authorization proof.',
      };
    }

    return { allowed: true };
  }

  private sanitizeText(str: string): string {
    if (!str) return '';
    return str
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      .replaceAll(String.fromCharCode(0), ''); // Strip null control chars
  }
}
