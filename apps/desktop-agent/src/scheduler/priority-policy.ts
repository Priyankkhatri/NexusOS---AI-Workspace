import { TaskExecutionRequest } from '../orchestrator/types.js';
import { QueuePriorityLane, ScheduledTaskItem } from './types.js';

export class TaskPriorityPolicy {
  constructor(private readonly agingThresholdMs: number = 30000) {}

  public derivePriorityLane(request: TaskExecutionRequest): QueuePriorityLane {
    // Untrusted callers cannot escalate to CRITICAL without agent:foundation scope
    if (
      request.payload?.isCritical === true &&
      request.leaseHeader.scopes?.includes('agent:foundation')
    ) {
      return 'CRITICAL';
    }
    if (request.payload?.isInteractive === true) {
      return 'INTERACTIVE';
    }
    if (request.payload?.isBackground === true) {
      return 'BACKGROUND';
    }
    return 'NORMAL';
  }

  public shouldPromoteForAging(item: ScheduledTaskItem, now: number): boolean {
    return item.priorityLane === 'NORMAL' && now - item.queuedAt >= this.agingThresholdMs;
  }
}
