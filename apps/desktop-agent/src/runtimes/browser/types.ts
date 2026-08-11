import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';

export enum BrowserOperationName {
  NAVIGATE = 'brw:navigate',
  EXTRACT = 'brw:extract',
  INTERACT = 'brw:interact',
  SCREENSHOT = 'brw:screenshot',
  DOWNLOAD = 'brw:download',
  UPLOAD = 'brw:upload',
  CLEAR_SESSION = 'brw:clear_session',
}

export interface BrowserResourceLimits {
  /** Maximum active browser sessions per agent instance (default: 3) */
  maxConcurrentSessions: number;
  /** Navigation timeout in ms (default: 30000ms) */
  navigationTimeoutMs: number;
  /** Maximum DOM extraction payload size in bytes (default: 1MB) */
  maxExtractionSizeBytes: number;
  /** Maximum screenshot size in bytes (default: 5MB) */
  maxScreenshotSizeBytes: number;
  /** Maximum file download payload size in bytes (default: 50MB) */
  maxDownloadSizeBytes: number;
}

export const DEFAULT_BROWSER_RESOURCE_LIMITS: BrowserResourceLimits = {
  maxConcurrentSessions: 3,
  navigationTimeoutMs: 30_000,
  maxExtractionSizeBytes: 1024 * 1024, // 1MB
  maxScreenshotSizeBytes: 5 * 1024 * 1024, // 5MB
  maxDownloadSizeBytes: 50 * 1024 * 1024, // 50MB
};

export interface BrowserSession {
  sessionId: string;
  taskId: string;
  workspaceId: string;
  profilePath: string;
  createdAt: string;
  activeUrl?: string;
  cookies: Record<string, string>;
  history: string[];
}

export interface NavigateRequest {
  sessionId: string;
  url: string;
  allowedDomains: string[];
}

export interface ExtractRequest {
  sessionId: string;
  selector?: string;
  maxSizeBytes?: number;
}

export interface InteractRequest {
  sessionId: string;
  selector: string;
  actionType: 'click' | 'fill' | 'submit';
  value?: string;
  isSensitiveForm?: boolean;
}

export interface ScreenshotRequest {
  sessionId: string;
  destinationPath: string;
  format?: 'png' | 'jpeg';
}

export interface DownloadRequest {
  sessionId: string;
  downloadUrl: string;
  redirectUrl?: string;
  destinationPath: string;
  allowedDomains: string[];
}

export interface UploadRequest {
  sessionId: string;
  selector: string;
  sourceFilePath: string;
}

export interface ClearSessionRequest {
  sessionId: string;
}

export interface BrowserOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: AuthenticatedContext;
  allowedRoots: string[];
  limits?: Partial<BrowserResourceLimits>;
}

export interface BrowserOperationResult<T = unknown> {
  success: boolean;
  operation: BrowserOperationName;
  sessionId: string;
  activeUrl?: string;
  bytesProcessed?: number;
  data?: T;
  humanInterventionRequired?: boolean;
  interventionReason?: string;
  evidenceId: string;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}
