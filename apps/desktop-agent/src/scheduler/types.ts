import { TaskExecutionRequest, TaskExecutionResult, TaskStatus } from '../orchestrator/types.js';

export type QueuePriorityLane = 'CRITICAL' | 'INTERACTIVE' | 'NORMAL' | 'RETRY' | 'BACKGROUND';

export interface ScheduledTaskItem {
  request: TaskExecutionRequest;
  priorityLane: QueuePriorityLane;
  tenantId: string;
  queuedAt: number;
  expiresAt: number;
  retryCount: number;
  nextRetryAt?: number;
}

export interface QueueMetrics {
  queuedCount: number;
  activeCount: number;
  maxCapacity: number;
  perLaneCounts: Record<QueuePriorityLane, number>;
  tenantCounts: Record<string, number>;
}

export interface IExecutionQueue {
  enqueue(item: ScheduledTaskItem): boolean;
  dequeue(): ScheduledTaskItem | null;
  peek(): ScheduledTaskItem | null;
  remove(taskId: string, tenantId?: string): ScheduledTaskItem | null;
  getSize(): number;
  getTenantCount(tenantId: string): number;
  getLaneCount(lane: QueuePriorityLane): number;
  pruneExpired(now: number): ScheduledTaskItem[];
  applyAging(now: number): void;
}

export interface ITaskScheduler {
  scheduleTask(request: TaskExecutionRequest): Promise<TaskExecutionResult>;
  cancelScheduledTask(taskId: string, tenantId?: string, reason?: string): Promise<boolean>;
  getScheduledTaskStatus(taskId: string, tenantId?: string): TaskStatus | null;
  getQueueMetrics(): QueueMetrics;
  initialize(): Promise<void>;
}
