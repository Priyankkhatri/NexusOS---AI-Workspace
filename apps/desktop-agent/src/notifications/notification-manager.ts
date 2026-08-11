import crypto from 'node:crypto';
import { EventEnvelope } from '@nexusos/contracts';
import { StructuredLogger } from '../telemetry/structured-logger.js';
import { TelemetryManager } from '../telemetry/telemetry-manager.js';
import { NotificationPolicyGate } from './notification-policy-gate.js';
import { NotificationQueue } from './notification-queue.js';
import {
  INotificationManager,
  INotificationPolicyGate,
  INotificationQueue,
  NotificationAction,
  NotificationCategory,
  NotificationItem,
  NotificationMetrics,
  NotificationPriority,
} from './types.js';

export class NotificationManager implements INotificationManager {
  public readonly queue: INotificationQueue;
  public readonly policyGate: INotificationPolicyGate;

  constructor(
    queue?: INotificationQueue,
    policyGate?: INotificationPolicyGate,
    private readonly logger: StructuredLogger = new StructuredLogger('NotificationManager'),
    private readonly telemetryManager?: TelemetryManager,
    private isLockScreenActive: boolean = false,
  ) {
    this.queue = queue || new NotificationQueue();
    this.policyGate = policyGate || new NotificationPolicyGate();
  }

  public setLockScreenActive(isActive: boolean): void {
    this.isLockScreenActive = isActive;

    // When lock screen activates, retroactively redact all pending items
    if (isActive) {
      const pending = this.queue.peekAll();
      for (const item of pending) {
        if (!item.isPrivacyRedacted) {
          const redacted = this.policyGate.sanitizeAndRedact(item, true);
          this.queue.updateItem(item.id, redacted);
        }
      }
    }
  }

  public notify(params: {
    category: NotificationCategory;
    priority: NotificationPriority;
    title: string;
    message: string;
    taskId?: string;
    correlationId?: string;
    coalesceKey?: string;
    actions?: NotificationAction[];
    ttlSeconds?: number;
    metadata?: Record<string, unknown>;
  }): NotificationItem {
    const now = new Date();
    const id = crypto.randomUUID();
    const expiresAt = params.ttlSeconds
      ? new Date(now.getTime() + params.ttlSeconds * 1000).toISOString()
      : undefined;

    const rawItem: NotificationItem = {
      id,
      timestamp: now.toISOString(),
      category: params.category,
      priority: params.priority,
      title: params.title,
      message: params.message,
      taskId: params.taskId,
      correlationId: params.correlationId,
      coalesceKey: params.coalesceKey,
      actions: params.actions,
      expiresAt,
      isPrivacyRedacted: false,
      isRead: false,
      metadata: params.metadata,
    };

    // 1. Sanitize & Redact via Policy Gate
    const sanitizedItem = this.policyGate.sanitizeAndRedact(rawItem, this.isLockScreenActive);

    // 2. Enqueue into Queue
    const result = this.queue.enqueue(sanitizedItem);

    // 3. Emit structured log & telemetry trace
    this.logger.info(`Notification [${sanitizedItem.category}] ${sanitizedItem.title}`, {
      notificationId: sanitizedItem.id,
      priority: sanitizedItem.priority,
      status: result.status,
      isPrivacyRedacted: sanitizedItem.isPrivacyRedacted,
    });

    if (this.telemetryManager) {
      this.telemetryManager.trackTrace('notification_delivered', {
        notificationId: sanitizedItem.id,
        category: sanitizedItem.category,
        priority: sanitizedItem.priority,
      });
    }

    return result.item;
  }

  public notifyEventEnvelope(envelope: EventEnvelope): NotificationItem | null {
    if (!envelope) return null;

    let category: NotificationCategory = 'SYSTEM_INFO';
    let priority: NotificationPriority = 'NORMAL';
    let title = 'System Event';
    let message = `Event ${envelope.schema_id} received.`;

    if (envelope.schema_id.startsWith('nexusos.events.security')) {
      category = 'SECURITY_ALERT';
      priority = 'CRITICAL';
      title = 'Security Alert';
      message = (envelope.payload?.message as string) || 'Security policy event detected.';
    } else if (envelope.schema_id.startsWith('nexusos.events.policy')) {
      category = 'POLICY_APPROVAL';
      priority = 'HIGH';
      title = 'Policy Approval Required';
      message = (envelope.payload?.message as string) || 'Operation requires policy revalidation.';
    } else if (envelope.schema_id.startsWith('nexusos.events.recovery')) {
      category = 'RECOVERY_INTERVENTION';
      priority = 'CRITICAL';
      title = 'Crash Recovery Action Required';
      message =
        (envelope.payload?.message as string) || 'Process recovery requires user verification.';
    } else if (envelope.schema_id.startsWith('nexusos.events.agent.state')) {
      category = 'TASK_STATUS';
      priority = 'NORMAL';
      title = 'Agent Lifecycle Update';
      message = `Agent state changed to ${String(envelope.payload?.state || 'UNKNOWN')}.`;
    }

    return this.notify({
      category,
      priority,
      title,
      message,
      correlationId: envelope.correlation_id,
      coalesceKey: `event:${envelope.schema_id}`,
      ttlSeconds: priority === 'CRITICAL' ? 86400 : 3600, // Critical notifications retain longer TTL
      metadata: envelope.payload,
    });
  }

  public executeNotificationAction(
    notificationId: string,
    actionId: string,
    providedAuthToken?: string,
    expectedTaskId?: string,
    expectedCorrelationId?: string,
  ): { success: boolean; reason?: string } {
    const all = this.queue.peekAll();
    const item = all.find((i) => i.id === notificationId);

    if (!item) {
      return { success: false, reason: 'Notification not found.' };
    }

    // Revalidate action authorization with context binding
    const validation = this.policyGate.validateActionExecution(
      item,
      actionId,
      providedAuthToken,
      expectedTaskId,
      expectedCorrelationId,
    );
    if (!validation.allowed) {
      this.logger.warn(`Notification action failed authorization`, {
        notificationId,
        actionId,
        reason: validation.reason,
      });
      return { success: false, reason: validation.reason };
    }

    // Mark notification read upon successful action execution
    this.queue.markRead(notificationId);

    this.logger.info(`Notification action executed successfully`, {
      notificationId,
      actionId,
    });

    return { success: true };
  }

  public getHealthMetrics(): NotificationMetrics {
    return this.queue.getMetrics();
  }
}
