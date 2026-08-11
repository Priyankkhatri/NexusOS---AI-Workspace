import { INotificationQueue, NotificationItem, NotificationMetrics } from './types.js';

export class NotificationQueue implements INotificationQueue {
  private readonly items: NotificationItem[] = [];
  private totalDelivered = 0;
  private expiredCount = 0;
  private coalescedCount = 0;

  constructor(private readonly maxCapacity: number = 200) {}

  public enqueue(item: NotificationItem): {
    status: 'ENQUEUED' | 'COALESCED' | 'REJECTED';
    item: NotificationItem;
  } {
    if (!item) {
      throw new Error('Cannot enqueue null or undefined notification item.');
    }

    this.purgeExpired();

    // 1. Coalesce duplicate notifications matching coalesceKey
    if (item.coalesceKey && item.coalesceKey.trim().length > 0) {
      const existingIdx = this.items.findIndex(
        (i) => i.coalesceKey === item.coalesceKey && !i.isRead,
      );
      if (existingIdx !== -1) {
        this.items[existingIdx] = {
          ...item,
          id: this.items[existingIdx].id, // retain original ID
          timestamp: item.timestamp,
        };
        this.coalescedCount++;
        return { status: 'COALESCED', item: this.items[existingIdx] };
      }
    }

    // 2. Capacity & Backpressure Management
    if (this.items.length >= this.maxCapacity) {
      if (item.priority === 'CRITICAL' || item.priority === 'HIGH') {
        // Evict oldest LOW/NORMAL notification to preserve CRITICAL item
        const nonCriticalIdx = this.items.findIndex(
          (i) => i.priority === 'LOW' || i.priority === 'NORMAL',
        );
        if (nonCriticalIdx !== -1) {
          this.items.splice(nonCriticalIdx, 1);
        } else {
          // If queue is full of CRITICAL/HIGH items, shift oldest HIGH
          this.items.shift();
        }
      } else {
        // Drop new LOW/NORMAL item when queue is full
        return { status: 'REJECTED', item };
      }
    }

    this.items.push(item);
    this.totalDelivered++;
    return { status: 'ENQUEUED', item };
  }

  public peekAll(): NotificationItem[] {
    this.purgeExpired();
    return [...this.items];
  }

  public popPending(maxCount: number = 50): NotificationItem[] {
    this.purgeExpired();
    const unread = this.items.filter((i) => !i.isRead);
    const count = Math.min(maxCount, unread.length);
    return unread.slice(0, count);
  }

  public purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) {
        this.items.splice(i, 1);
        purged++;
      }
    }

    this.expiredCount += purged;
    return purged;
  }

  public markRead(id: string): boolean {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.isRead = true;
      return true;
    }
    return false;
  }

  public getMetrics(): NotificationMetrics {
    this.purgeExpired();
    const criticalCount = this.items.filter((i) => i.priority === 'CRITICAL').length;
    const pendingCount = this.items.filter((i) => !i.isRead).length;

    return {
      totalDelivered: this.totalDelivered,
      pendingCount,
      expiredCount: this.expiredCount,
      coalescedCount: this.coalescedCount,
      criticalCount,
    };
  }

  public clear(): void {
    this.items.length = 0;
  }
}
