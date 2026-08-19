import { z } from 'zod';

export const NotificationPrioritySchema = z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
export const NotificationCategorySchema = z.enum([
  'SECURITY_ALERT',
  'POLICY_APPROVAL',
  'RECOVERY_INTERVENTION',
  'TASK_STATUS',
  'SYSTEM_INFO',
]);

export const NotificationActionSchema = z.object({
  actionId: z.string().min(1),
  label: z.string().min(1),
  requiresRevalidation: z.boolean(),
  targetCommand: z.string().optional(),
});

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  category: NotificationCategorySchema,
  priority: NotificationPrioritySchema,
  title: z.string().min(1),
  message: z.string().min(1),
  taskId: z.string().optional(),
  correlationId: z.string().optional(),
  coalesceKey: z.string().optional(),
  actions: z.array(NotificationActionSchema).optional(),
  expiresAt: z.string().datetime().optional(),
  isPrivacyRedacted: z.boolean(),
  isRead: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── IPC Request Schemas ────────────────────────────────────────────────────

/**
 * notification.dispatch — submit a structured notification for delivery.
 * Coalesce keys MUST be non-empty when provided to prevent silent merging.
 */
export const NotificationDispatchRequestSchema = z.object({
  category: NotificationCategorySchema,
  priority: NotificationPrioritySchema,
  title: z.string().min(1).max(256),
  message: z.string().min(1).max(2048),
  taskId: z.string().optional(),
  correlationId: z.string().optional(),
  coalesceKey: z.string().min(1).optional(),
  actions: z.array(NotificationActionSchema).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
  tenantId: z.string().optional(),
});

/**
 * notification.listPending — retrieve pending (unread) notifications.
 * maxCount is bounded to prevent unbounded IPC response payloads.
 */
export const NotificationListPendingRequestSchema = z.object({
  maxCount: z.number().int().positive().max(200).optional(),
  tenantId: z.string().optional(),
});

/**
 * notification.markRead — mark a specific notification as read.
 */
export const NotificationMarkReadRequestSchema = z.object({
  notificationId: z.string().uuid(),
  tenantId: z.string().optional(),
});

/**
 * notification.executeAction — execute a notification action.
 * authToken is REQUIRED and must be non-empty; notification click alone is
 * never sufficient authorization (TOCTOU / MANDATORY REVALIDATION boundary).
 */
export const NotificationExecuteActionRequestSchema = z.object({
  notificationId: z.string().uuid(),
  actionId: z.string().min(1),
  authToken: z.string().min(1),
  expectedTaskId: z.string().optional(),
  expectedCorrelationId: z.string().optional(),
  tenantId: z.string().optional(),
});

/**
 * notification.getMetrics — retrieve notification queue health metrics.
 */
export const NotificationGetMetricsRequestSchema = z.object({
  tenantId: z.string().optional(),
});

/**
 * notification.setLockScreen — update lock-screen privacy active state.
 * When isActive=true all pending items are retroactively privacy-redacted.
 */
export const NotificationSetLockScreenRequestSchema = z.object({
  isActive: z.boolean(),
  tenantId: z.string().optional(),
});
