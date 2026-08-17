import { NotificationManager } from '../../notifications/notification-manager.js';

export interface IDeviceNotificationAdapter {
  showNotification(
    title: string,
    body: string,
    actionId?: string,
    context?: { taskId: string; workspaceId: string },
  ): Promise<boolean>;
}

export class DefaultDeviceNotificationAdapter implements IDeviceNotificationAdapter {
  constructor(private readonly notificationManager?: NotificationManager) {}

  public async showNotification(
    title: string,
    body: string,
    actionId?: string,
    context?: { taskId: string; workspaceId: string },
  ): Promise<boolean> {
    if (this.notificationManager) {
      await this.notificationManager.notify({
        category: 'SYSTEM_INFO',
        priority: 'NORMAL',
        title,
        message: body,
        taskId: context?.taskId,
        actions: actionId ? [{ actionId, label: actionId, requiresRevalidation: true }] : undefined,
      });
      return true;
    }

    // Default mock notification delivery receipt for test environments
    return true;
  }
}
