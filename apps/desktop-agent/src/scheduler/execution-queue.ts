import { IExecutionQueue, QueuePriorityLane, ScheduledTaskItem } from './types.js';

export class ExecutionQueue implements IExecutionQueue {
  private readonly lanes: Record<QueuePriorityLane, ScheduledTaskItem[]> = {
    CRITICAL: [],
    INTERACTIVE: [],
    NORMAL: [],
    RETRY: [],
    BACKGROUND: [],
  };

  constructor(
    private readonly maxCapacity: number = 100,
    private readonly maxPerTenantQuota: number = 20,
    private readonly agingThresholdMs: number = 30000,
  ) {}

  public enqueue(item: ScheduledTaskItem): boolean {
    const totalSize = this.getSize();

    // CRITICAL lane bypasses normal capacity up to an emergency reserve of 10 items
    if (item.priorityLane !== 'CRITICAL') {
      if (totalSize >= this.maxCapacity) {
        return false;
      }
      if (this.getTenantCount(item.tenantId) >= this.maxPerTenantQuota) {
        return false;
      }
    } else if (totalSize >= this.maxCapacity + 10) {
      return false;
    }

    this.lanes[item.priorityLane].push(item);
    return true;
  }

  public dequeue(): ScheduledTaskItem | null {
    const now = Date.now();
    const laneOrder: QueuePriorityLane[] = [
      'CRITICAL',
      'INTERACTIVE',
      'NORMAL',
      'RETRY',
      'BACKGROUND',
    ];

    for (const lane of laneOrder) {
      const items = this.lanes[lane];
      if (items.length === 0) {
        continue;
      }

      if (lane === 'RETRY') {
        const retryIndex = items.findIndex((item) => !item.nextRetryAt || now >= item.nextRetryAt);
        if (retryIndex !== -1) {
          return items.splice(retryIndex, 1)[0] || null;
        }
      } else {
        return items.shift() || null;
      }
    }

    return null;
  }

  public peek(): ScheduledTaskItem | null {
    const now = Date.now();
    const laneOrder: QueuePriorityLane[] = [
      'CRITICAL',
      'INTERACTIVE',
      'NORMAL',
      'RETRY',
      'BACKGROUND',
    ];

    for (const lane of laneOrder) {
      const items = this.lanes[lane];
      if (items.length === 0) {
        continue;
      }

      if (lane === 'RETRY') {
        const item = items.find((it) => !it.nextRetryAt || now >= it.nextRetryAt);
        if (item) {
          return item;
        }
      } else {
        return items[0] || null;
      }
    }

    return null;
  }

  public remove(taskId: string, tenantId?: string): ScheduledTaskItem | null {
    const laneOrder: QueuePriorityLane[] = [
      'CRITICAL',
      'INTERACTIVE',
      'NORMAL',
      'RETRY',
      'BACKGROUND',
    ];

    for (const lane of laneOrder) {
      const items = this.lanes[lane];
      const index = items.findIndex((it) => it.request.task_id === taskId);
      if (index !== -1) {
        const item = items[index];
        if (tenantId && item.tenantId !== tenantId) {
          return null; // Cross-tenant removal rejected
        }
        return items.splice(index, 1)[0] || null;
      }
    }

    return null;
  }

  public getSize(): number {
    return (
      this.lanes.CRITICAL.length +
      this.lanes.INTERACTIVE.length +
      this.lanes.NORMAL.length +
      this.lanes.RETRY.length +
      this.lanes.BACKGROUND.length
    );
  }

  public getTenantCount(tenantId: string): number {
    let count = 0;
    for (const lane of Object.keys(this.lanes) as QueuePriorityLane[]) {
      for (const item of this.lanes[lane]) {
        if (item.tenantId === tenantId) {
          count++;
        }
      }
    }
    return count;
  }

  public getLaneCount(lane: QueuePriorityLane): number {
    return this.lanes[lane].length;
  }

  public pruneExpired(now: number): ScheduledTaskItem[] {
    const expired: ScheduledTaskItem[] = [];
    for (const lane of Object.keys(this.lanes) as QueuePriorityLane[]) {
      const items = this.lanes[lane];
      const valid: ScheduledTaskItem[] = [];
      for (const item of items) {
        if (now > item.expiresAt) {
          expired.push(item);
        } else {
          valid.push(item);
        }
      }
      this.lanes[lane] = valid;
    }
    return expired;
  }

  public applyAging(now: number): void {
    const normalItems = this.lanes.NORMAL;
    const remainingNormal: ScheduledTaskItem[] = [];

    for (const item of normalItems) {
      if (now - item.queuedAt >= this.agingThresholdMs) {
        item.priorityLane = 'INTERACTIVE';
        this.lanes.INTERACTIVE.push(item);
      } else {
        remainingNormal.push(item);
      }
    }
    this.lanes.NORMAL = remainingNormal;
  }
}
