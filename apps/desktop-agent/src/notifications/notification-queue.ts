import fs from 'node:fs';
import path from 'node:path';
import {
  INotificationQueue,
  NotificationItem,
  NotificationMetrics,
  NotificationPriority,
} from './types.js';

const PRIORITY_WEIGHT: Record<NotificationPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export class NotificationQueue implements INotificationQueue {
  private readonly items: NotificationItem[] = [];
  private totalDelivered = 0;
  private expiredCount = 0;
  private coalescedCount = 0;
  private isQueueFull = false;
  private readonly hardCapacity: number;
  private readonly queueFilePath?: string;

  constructor(
    private readonly maxCapacity: number = 200,
    storageDir?: string,
  ) {
    this.hardCapacity = maxCapacity * 2;
    if (storageDir) {
      this.queueFilePath = path.join(storageDir, '.nexusos-notifications-queue.json');
      this.loadQueueFromStorage();
    }
  }

  public enqueue(item: NotificationItem): {
    status: 'ENQUEUED' | 'COALESCED' | 'REJECTED';
    item: NotificationItem;
  } {
    if (!item) {
      throw new Error('Cannot enqueue null or undefined notification item.');
    }

    this.purgeExpired();

    // 1. Coalesce duplicate notifications matching coalesceKey (GUARD AGAINST DOWNGRADING CRITICAL NOTIFICATIONS!)
    if (item.coalesceKey && item.coalesceKey.trim().length > 0) {
      const existingIdx = this.items.findIndex(
        (i) => i.coalesceKey === item.coalesceKey && !i.isRead,
      );
      if (existingIdx !== -1) {
        const existingItem = this.items[existingIdx];
        // Only permit coalescing if incoming item priority >= existing item priority
        if (PRIORITY_WEIGHT[item.priority] >= PRIORITY_WEIGHT[existingItem.priority]) {
          this.items[existingIdx] = {
            ...item,
            id: existingItem.id, // retain original ID
            timestamp: item.timestamp,
          };
          this.coalescedCount++;
          this.persistQueueToStorage();
          return { status: 'COALESCED', item: this.items[existingIdx] };
        }
      }
    }

    // 2. Capacity & Backpressure Management (NEVER SILENTLY DISCARD CRITICAL ITEMS VIA SHIFT!)
    if (this.items.length >= this.maxCapacity) {
      if (item.priority === 'CRITICAL' || item.priority === 'HIGH') {
        // Evict oldest LOW/NORMAL notification to preserve CRITICAL item
        const nonCriticalIdx = this.items.findIndex(
          (i) => i.priority === 'LOW' || i.priority === 'NORMAL',
        );
        if (nonCriticalIdx !== -1) {
          this.items.splice(nonCriticalIdx, 1);
        } else if (this.items.length >= this.hardCapacity) {
          // Hard capacity ceiling full of CRITICAL/HIGH items! Reject new enqueue safely
          this.isQueueFull = true;
          return { status: 'REJECTED', item };
        }
      } else {
        // Drop new LOW/NORMAL item when queue is full
        return { status: 'REJECTED', item };
      }
    }

    this.items.push(item);
    this.totalDelivered++;
    this.persistQueueToStorage();
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
    if (this.items.length < this.hardCapacity) {
      this.isQueueFull = false;
    }
    this.persistQueueToStorage();
    return purged;
  }

  public markRead(id: string): boolean {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.isRead = true;
      this.persistQueueToStorage();
      return true;
    }
    return false;
  }

  public updateItem(id: string, updated: NotificationItem): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this.items[idx] = { ...updated, id }; // Preserve original ID
      this.persistQueueToStorage();
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
      isQueueFull: this.isQueueFull,
    };
  }

  public clear(): void {
    this.items.length = 0;
    this.isQueueFull = false;
    this.persistQueueToStorage();
  }

  private persistQueueToStorage(): void {
    if (!this.queueFilePath) return;
    try {
      const dir = path.dirname(this.queueFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.queueFilePath}.tmp`;
      const data = JSON.stringify(this.items);
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.queueFilePath);
    } catch {
      this.isQueueFull = true;
    }
  }

  private loadQueueFromStorage(): void {
    if (!this.queueFilePath) return;
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const raw = fs.readFileSync(this.queueFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as NotificationItem[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id && item.priority) {
              this.items.push(item);
            }
          }
        }
      }
    } catch {
      // Ignore corrupted disk file
    }
  }
}
