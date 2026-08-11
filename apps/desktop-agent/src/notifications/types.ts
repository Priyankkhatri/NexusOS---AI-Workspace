import { EventEnvelope } from '@nexusos/contracts';

export type NotificationPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
export type NotificationCategory =
  | 'SECURITY_ALERT'
  | 'POLICY_APPROVAL'
  | 'RECOVERY_INTERVENTION'
  | 'TASK_STATUS'
  | 'SYSTEM_INFO';

export interface NotificationAction {
  actionId: string;
  label: string;
  requiresRevalidation: boolean;
  targetCommand?: string;
}

export interface NotificationItem {
  id: string;
  timestamp: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  taskId?: string;
  correlationId?: string;
  coalesceKey?: string;
  actions?: NotificationAction[];
  expiresAt?: string;
  isPrivacyRedacted: boolean;
  isRead: boolean;
  metadata?: Record<string, unknown>;
}

export interface NotificationMetrics {
  totalDelivered: number;
  pendingCount: number;
  expiredCount: number;
  coalescedCount: number;
  criticalCount: number;
  isQueueFull: boolean;
}

export interface INotificationQueue {
  enqueue(item: NotificationItem): {
    status: 'ENQUEUED' | 'COALESCED' | 'REJECTED';
    item: NotificationItem;
  };
  peekAll(): NotificationItem[];
  popPending(maxCount?: number): NotificationItem[];
  purgeExpired(): number;
  markRead(id: string): boolean;
  getMetrics(): NotificationMetrics;
  clear(): void;
}

export interface INotificationPolicyGate {
  sanitizeAndRedact(item: NotificationItem, isLockScreenActive?: boolean): NotificationItem;
  validateActionExecution(
    item: NotificationItem,
    actionId: string,
    providedAuthToken?: string,
    expectedTaskId?: string,
    expectedCorrelationId?: string,
  ): { allowed: boolean; reason?: string };
}

export interface INotificationManager {
  queue: INotificationQueue;
  policyGate: INotificationPolicyGate;
  notify(params: {
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
  }): NotificationItem;
  notifyEventEnvelope(envelope: EventEnvelope): NotificationItem | null;
  executeNotificationAction(
    notificationId: string,
    actionId: string,
    providedAuthToken?: string,
    expectedTaskId?: string,
    expectedCorrelationId?: string,
  ): { success: boolean; reason?: string };
  getHealthMetrics(): NotificationMetrics;
}
