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
