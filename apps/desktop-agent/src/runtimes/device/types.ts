import { NexusOSError } from '@nexusos/contracts';
import { ExecutionLeaseHeader } from '@nexusos/contracts';

export enum DeviceOperationName {
  CLIPBOARD_READ = 'clipboard:read',
  CLIPBOARD_WRITE = 'clipboard:write',
  CLIPBOARD_CLEAR = 'clipboard:clear',
  DEVICE_QUERY_INFO = 'device:query_info',
  DEVICE_GET_POSTURE = 'device:get_posture',
  DEVICE_SHOW_NOTIFICATION = 'device:show_notification',
}

export interface DeviceRequestContext {
  taskId: string;
  workspaceId: string;
  tenantId: string;
  subjectId: string;
  correlationId: string;
  leaseHeader: ExecutionLeaseHeader;
}

export interface ClipboardReadRequest {
  operationName: DeviceOperationName.CLIPBOARD_READ;
  context: DeviceRequestContext;
}

export interface ClipboardWriteRequest {
  operationName: DeviceOperationName.CLIPBOARD_WRITE;
  text: string;
  context: DeviceRequestContext;
}

export interface ClipboardClearRequest {
  operationName: DeviceOperationName.CLIPBOARD_CLEAR;
  context: DeviceRequestContext;
}

export interface DeviceQueryInfoRequest {
  operationName: DeviceOperationName.DEVICE_QUERY_INFO;
  context: DeviceRequestContext;
}

export interface DeviceGetPostureRequest {
  operationName: DeviceOperationName.DEVICE_GET_POSTURE;
  context: DeviceRequestContext;
}

export interface DeviceNotificationRequest {
  operationName: DeviceOperationName.DEVICE_SHOW_NOTIFICATION;
  title: string;
  body: string;
  actionId?: string;
  context: DeviceRequestContext;
}

export type DeviceOperationRequest =
  | ClipboardReadRequest
  | ClipboardWriteRequest
  | ClipboardClearRequest
  | DeviceQueryInfoRequest
  | DeviceGetPostureRequest
  | DeviceNotificationRequest;

export interface DevicePosture {
  platform: string;
  arch: string;
  nodeVersion: string;
  uptimeSeconds: number;
  hasOSConsent: boolean;
  displayCount: number;
  powerSource: 'ac' | 'battery' | 'unknown';
}

export interface DeviceInfo {
  platform: string;
  arch: string;
  agentVersion: string;
  supportedCapabilities: string[];
}

export interface DeviceOperationResult<T = unknown> {
  success: boolean;
  operationName: DeviceOperationName | string;
  data?: T;
  error?: NexusOSError;
  executedAt: string;
}

export interface DeviceRuntimeConfig {
  maxClipboardSizeBytes: number;
  operationTimeoutMs: number;
  maxConcurrentOperations: number;
}

export const DEFAULT_DEVICE_RUNTIME_CONFIG: DeviceRuntimeConfig = {
  maxClipboardSizeBytes: 1048576, // 1 MB
  operationTimeoutMs: 5000,
  maxConcurrentOperations: 10,
};
