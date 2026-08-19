import { EventEnvelope } from '@nexusos/contracts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type EventPriority = 'CRITICAL' | 'NON_CRITICAL';
export type TelemetryItemType = 'METRIC' | 'TRACE' | 'EVENT' | 'DIAGNOSTIC';

export interface LogRecord {
  id: string;
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  correlationId?: string;
  taskId?: string;
  stepId?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
  priority: EventPriority;
}

export interface TelemetryItem {
  itemId: string;
  timestamp: string;
  type: TelemetryItemType;
  name: string;
  value?: number;
  attributes: Record<string, unknown>;
  priority: EventPriority;
}

export interface TelemetryBatch {
  batchId: string;
  agentId: string;
  createdAt: string;
  items: TelemetryItem[];
  batchHash: string;
}

export interface SpoolMetrics {
  totalItemsSpooled: number;
  criticalItemsCount: number;
  nonCriticalItemsCount: number;
  evictedItemsCount: number;
  spoolCapacityBytes: number;
  spoolUsedBytes: number;
  isBackpressureActive: boolean;
  isCriticalSpoolFull: boolean;
}

/**
 * Interface Definitions for Task 03I
 */
export interface IRedactionFilter {
  redactString(text: string): string;
  redactObject<T>(obj: T): T;
  redactError(err: Error | unknown): { message: string; stack?: string; code?: string };
}

export interface IBackpressureController {
  shouldSampleLog(level: LogLevel, priority: EventPriority): boolean;
  isBackpressureActive(): boolean;
  getMetrics(): SpoolMetrics;
  recordItemAdded(priority: EventPriority, estimatedBytes: number): void;
  recordItemEvicted(count?: number): void;
}

export interface ITelemetrySpool {
  enqueueItem(item: TelemetryItem): boolean;
  enqueueEventEnvelope(envelope: EventEnvelope): boolean;
  popBatch(maxItems?: number): TelemetryItem[];
  getSpoolMetrics(): SpoolMetrics;
  clearSpool(): void;
}

export interface IStructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, err?: Error | unknown, context?: Record<string, unknown>): void;
  fatal(message: string, err?: Error | unknown, context?: Record<string, unknown>): void;
  setCorrelationContext(correlationId?: string, taskId?: string, stepId?: string): void;
}

export interface DiagnosticBundle {
  bundleId: string;
  generatedAt: string;
  agentId: string;
  metrics: SpoolMetrics;
  spoolItemCount: number;
  hash: string;
}

export interface ITelemetryManager {
  logger: IStructuredLogger;
  spool: ITelemetrySpool;
  trackMetric(name: string, value: number, attributes?: Record<string, unknown>): void;
  trackTrace(name: string, attributes?: Record<string, unknown>): void;
  trackEventEnvelope(envelope: EventEnvelope): void;
  flush(): Promise<TelemetryBatch | null>;
  verifyBatchIntegrity(batch: TelemetryBatch): boolean;
  getHealthMetrics(): SpoolMetrics;
  exportDiagnosticBundle(targetDir?: string): Promise<DiagnosticBundle>;
}

import { z } from 'zod';
import {
  TelemetryTrackMetricRequestSchema,
  TelemetryTrackTraceRequestSchema,
  TelemetryFlushRequestSchema,
  TelemetryGetMetricsRequestSchema,
  TelemetryExportDiagnosticBundleRequestSchema,
} from './schemas.js';

export type TelemetryTrackMetricRequest = z.infer<typeof TelemetryTrackMetricRequestSchema>;
export type TelemetryTrackTraceRequest = z.infer<typeof TelemetryTrackTraceRequestSchema>;
export type TelemetryFlushRequest = z.infer<typeof TelemetryFlushRequestSchema>;
export type TelemetryGetMetricsRequest = z.infer<typeof TelemetryGetMetricsRequestSchema>;
export type TelemetryExportDiagnosticBundleRequest = z.infer<
  typeof TelemetryExportDiagnosticBundleRequestSchema
>;
