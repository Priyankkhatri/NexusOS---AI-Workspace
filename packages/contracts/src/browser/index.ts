import crypto from 'node:crypto';
import { z } from 'zod';
import { TenantIdSchema } from '../identity/index.js';
import { ExecutionLeaseHeaderSchema, ExecutionLeaseHeader } from '../permissions/index.js';

// ---------------------------------------------------------------------------
// 1. Browser Operation Names & Capability Resolution
// ---------------------------------------------------------------------------

export enum BrowserOperationName {
  NAVIGATE = 'brw:navigate',
  EXTRACT = 'brw:extract',
  INTERACT = 'brw:interact',
  SCREENSHOT = 'brw:screenshot',
  DOWNLOAD = 'brw:download',
  UPLOAD = 'brw:upload',
  CLEAR_SESSION = 'brw:clear_session',
}

export const BrowserOperationNameSchema = z.nativeEnum(BrowserOperationName);

export const CANONICAL_BROWSER_CAPABILITIES = {
  CREATE_SESSION: 'browser.createSession',
  NAVIGATE: 'browser.navigate',
  EXTRACT: 'browser.extractContent',
  INTERACT: 'browser.interactForm',
  SCREENSHOT: 'browser.captureScreenshot',
  DOWNLOAD: 'browser.downloadFile',
  UPLOAD: 'browser.uploadFile',
  CLEAR_SESSION: 'browser.clearSession',
  LIST_SESSIONS: 'browser.listSessions',
} as const;

export function resolveBrowserOperation(capabilityId: string): BrowserOperationName | undefined {
  if (!capabilityId || typeof capabilityId !== 'string') {
    return undefined;
  }
  const normalized = capabilityId.trim().toLowerCase();

  if (Object.values(BrowserOperationName).includes(normalized as BrowserOperationName)) {
    return normalized as BrowserOperationName;
  }

  if (
    normalized === 'browser.navigate' ||
    normalized === 'browser:navigate' ||
    normalized === 'brw:navigate' ||
    normalized === 'navigate'
  ) {
    return BrowserOperationName.NAVIGATE;
  }
  if (
    normalized === 'browser.extractcontent' ||
    normalized === 'browser.extract' ||
    normalized === 'browser:extract' ||
    normalized === 'brw:extract' ||
    normalized === 'extract'
  ) {
    return BrowserOperationName.EXTRACT;
  }
  if (
    normalized === 'browser.interactform' ||
    normalized === 'browser.interact' ||
    normalized === 'browser:interact' ||
    normalized === 'brw:interact' ||
    normalized === 'interact'
  ) {
    return BrowserOperationName.INTERACT;
  }
  if (
    normalized === 'browser.capturescreenshot' ||
    normalized === 'browser.screenshot' ||
    normalized === 'browser:screenshot' ||
    normalized === 'brw:screenshot' ||
    normalized === 'screenshot'
  ) {
    return BrowserOperationName.SCREENSHOT;
  }
  if (
    normalized === 'browser.downloadfile' ||
    normalized === 'browser.download' ||
    normalized === 'browser:download' ||
    normalized === 'brw:download' ||
    normalized === 'download'
  ) {
    return BrowserOperationName.DOWNLOAD;
  }
  if (
    normalized === 'browser.uploadfile' ||
    normalized === 'browser.upload' ||
    normalized === 'browser:upload' ||
    normalized === 'brw:upload' ||
    normalized === 'upload'
  ) {
    return BrowserOperationName.UPLOAD;
  }
  if (
    normalized === 'browser.clearsession' ||
    normalized === 'browser:clearsession' ||
    normalized === 'browser:clear_session' ||
    normalized === 'brw:clear_session' ||
    normalized === 'clear_session'
  ) {
    return BrowserOperationName.CLEAR_SESSION;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// 2. Browser Session Lifecycle & Status
// ---------------------------------------------------------------------------

export const BrowserSessionStatusSchema = z.enum(['CREATED', 'ACTIVE', 'CLEARED', 'FAILED']);
export type BrowserSessionStatus = z.infer<typeof BrowserSessionStatusSchema>;

export const BrowserSessionSchema = z.object({
  sessionId: z.string().min(1).max(256),
  taskId: z.string().min(1).max(256),
  workspaceId: z.string().min(1).max(256),
  tenantId: TenantIdSchema.optional(),
  profilePath: z.string().min(1).max(4096),
  createdAt: z.string().datetime(),
  status: BrowserSessionStatusSchema.default('ACTIVE'),
  activeUrl: z.string().max(8192).optional(),
  cookies: z.record(z.string()).default({}),
  history: z.array(z.string()).default([]),
});

export interface BrowserSession {
  sessionId: string;
  taskId: string;
  workspaceId: string;
  tenantId?: string;
  profilePath: string;
  createdAt: string;
  status?: BrowserSessionStatus;
  activeUrl?: string;
  cookies?: Record<string, string>;
  history?: string[];
}

// ---------------------------------------------------------------------------
// 3. Resource Limits
// ---------------------------------------------------------------------------

export const BrowserResourceLimitsSchema = z.object({
  maxConcurrentSessions: z.number().int().positive().max(20).default(3),
  navigationTimeoutMs: z.number().int().positive().max(300_000).default(30_000),
  maxExtractionSizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .default(1024 * 1024), // 1MB
  maxScreenshotSizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(5 * 1024 * 1024), // 5MB
  maxDownloadSizeBytes: z
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024)
    .default(50 * 1024 * 1024), // 50MB
});

export type BrowserResourceLimits = z.infer<typeof BrowserResourceLimitsSchema>;

export const DEFAULT_BROWSER_RESOURCE_LIMITS: BrowserResourceLimits = {
  maxConcurrentSessions: 3,
  navigationTimeoutMs: 30_000,
  maxExtractionSizeBytes: 1024 * 1024,
  maxScreenshotSizeBytes: 5 * 1024 * 1024,
  maxDownloadSizeBytes: 50 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// 4. Domain & Network Security Policy
// ---------------------------------------------------------------------------

export const BrowserDomainPolicySchema = z.object({
  allowedDomains: z.array(z.string().min(1).max(512)).min(1).max(100),
  allowRedirects: z.boolean().default(false),
  blockedSchemes: z
    .array(z.string())
    .default([
      'file:',
      'javascript:',
      'data:',
      'gopher:',
      'ftp:',
      'chrome:',
      'edge:',
      'about:',
      'blob:',
      'ws:',
      'wss:',
      'vbscript:',
    ]),
  blockedDestinations: z
    .array(z.string())
    .default(['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254']),
});

export type BrowserDomainPolicy = z.infer<typeof BrowserDomainPolicySchema>;

// ---------------------------------------------------------------------------
// 5. Canonical Request Schemas
// ---------------------------------------------------------------------------

export const NavigateRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  url: z.string().min(1).max(8192),
  allowedDomains: z.array(z.string().min(1).max(512)).min(1).max(100),
});
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>;

export const ExtractRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  selector: z.string().max(2048).optional(),
  maxSizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .optional(),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

export const InteractRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  selector: z.string().min(1).max(2048),
  actionType: z.enum(['click', 'fill', 'submit']),
  value: z.string().max(65536).optional(),
  isSensitiveForm: z.boolean().optional(),
});
export type InteractRequest = z.infer<typeof InteractRequestSchema>;

export const ScreenshotRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  destinationPath: z.string().min(1).max(4096),
  format: z.enum(['png', 'jpeg']).optional(),
});
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;

export const DownloadRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  downloadUrl: z.string().min(1).max(8192),
  redirectUrl: z.string().max(8192).optional(),
  destinationPath: z.string().min(1).max(4096),
  allowedDomains: z.array(z.string().min(1).max(512)).min(1).max(100),
});
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;

export const UploadRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  selector: z.string().min(1).max(2048),
  sourceFilePath: z.string().min(1).max(4096),
});
export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const ClearSessionRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
});
export type ClearSessionRequest = z.infer<typeof ClearSessionRequestSchema>;

export interface BrowserOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: any;
  allowedRoots: string[];
  workspaceId?: string;
  limits?: Partial<BrowserResourceLimits>;
}

// ---------------------------------------------------------------------------
// 6. Immutable Browser Action Receipt & Evidence
// ---------------------------------------------------------------------------

export const BrowserActionReceiptStatusSchema = z.enum([
  'SUCCESS',
  'DENIED',
  'FAILED',
  'INTERVENTION_REQUIRED',
]);
export type BrowserActionReceiptStatus = z.infer<typeof BrowserActionReceiptStatusSchema>;

export const BrowserActionReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  taskId: z.string().min(1).max(256),
  workspaceId: z.string().min(1).max(256),
  tenantId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  operation: BrowserOperationNameSchema,
  targetUrl: z.string().max(8192).optional(),
  domain: z.string().max(512).optional(),
  status: BrowserActionReceiptStatusSchema,
  timestamp: z.string().datetime(),
  correlationId: z.string().min(1).max(256),
  leaseId: z.string().min(1).max(256),
  evidenceId: z.string().uuid(),
  sha256EvidenceChecksum: z.string().length(64),
  bytesProcessed: z.number().int().min(0).optional(),
  humanInterventionRequired: z.boolean().optional(),
  interventionReason: z.string().max(2048).optional(),
  error: z
    .object({
      code: z.string().min(1),
      category: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
});

export type BrowserActionReceipt = z.infer<typeof BrowserActionReceiptSchema>;

export function computeBrowserEvidenceChecksum(params: {
  taskId: string;
  leaseId: string;
  operation: string;
  sessionId: string;
  targetUrl?: string;
  bytesProcessed?: number;
  status: string;
}): string {
  const parts = [
    params.taskId,
    params.leaseId,
    params.operation,
    params.sessionId,
    params.targetUrl || 'none',
    String(params.bytesProcessed ?? 0),
    params.status,
  ];
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}

// ---------------------------------------------------------------------------
// 7. Browser Operation Result
// ---------------------------------------------------------------------------

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
  receipt?: BrowserActionReceipt;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}

export const BrowserOperationResultSchema = z.object({
  success: z.boolean(),
  operation: BrowserOperationNameSchema,
  sessionId: z.string().min(1),
  activeUrl: z.string().optional(),
  bytesProcessed: z.number().optional(),
  data: z.unknown().optional(),
  humanInterventionRequired: z.boolean().optional(),
  interventionReason: z.string().optional(),
  evidenceId: z.string().uuid(),
  receipt: BrowserActionReceiptSchema.optional(),
  error: z
    .object({
      code: z.string(),
      category: z.string(),
      message: z.string(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// 8. IPC Request Schemas (Canonical)
// ---------------------------------------------------------------------------

export const BrowserCreateSessionIPCRequestSchema = z.object({
  taskId: z.string().min(1, 'taskId is required').max(256),
  workspaceId: z.string().min(1, 'workspaceId is required').max(256),
  storageDir: z.string().min(1, 'storageDir is required').max(4096),
  limits: BrowserResourceLimitsSchema.partial().optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserCreateSessionIPCRequest = z.infer<typeof BrowserCreateSessionIPCRequestSchema>;

export const BrowserNavigateIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  url: z.string().min(1, 'url is required').max(8192),
  allowedDomains: z.array(z.string().min(1).max(512)).min(1).max(100),
  limits: z
    .object({
      navigationTimeoutMs: z.number().int().positive().max(300_000).optional(),
    })
    .optional(),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserNavigateIPCRequest = z.infer<typeof BrowserNavigateIPCRequestSchema>;

export const BrowserExtractContentIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  selector: z.string().max(2048).optional(),
  maxSizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .optional(),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserExtractContentIPCRequest = z.infer<typeof BrowserExtractContentIPCRequestSchema>;

export const BrowserInteractFormIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  selector: z.string().min(1, 'selector is required').max(2048),
  actionType: z.enum(['click', 'fill', 'submit']),
  value: z.string().max(65536).optional(),
  isSensitiveForm: z.boolean().optional(),
  allowedRoots: z.array(z.string().min(1).max(4096)).optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserInteractFormIPCRequest = z.infer<typeof BrowserInteractFormIPCRequestSchema>;

export const BrowserCaptureScreenshotIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  destinationPath: z.string().min(1, 'destinationPath is required').max(4096),
  format: z.enum(['png', 'jpeg']).optional(),
  allowedRoots: z.array(z.string().min(1).max(4096)).min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserCaptureScreenshotIPCRequest = z.infer<
  typeof BrowserCaptureScreenshotIPCRequestSchema
>;

export const BrowserDownloadFileIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  downloadUrl: z.string().min(1, 'downloadUrl is required').max(8192),
  redirectUrl: z.string().max(8192).optional(),
  destinationPath: z.string().min(1, 'destinationPath is required').max(4096),
  allowedDomains: z.array(z.string().min(1).max(512)).min(1).max(100),
  allowedRoots: z.array(z.string().min(1).max(4096)).min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserDownloadFileIPCRequest = z.infer<typeof BrowserDownloadFileIPCRequestSchema>;

export const BrowserUploadFileIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  selector: z.string().min(1, 'selector is required').max(2048),
  sourceFilePath: z.string().min(1, 'sourceFilePath is required').max(4096),
  allowedRoots: z.array(z.string().min(1).max(4096)).min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserUploadFileIPCRequest = z.infer<typeof BrowserUploadFileIPCRequestSchema>;

export const BrowserClearSessionIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserClearSessionIPCRequest = z.infer<typeof BrowserClearSessionIPCRequestSchema>;

export const BrowserListSessionsIPCRequestSchema = z.object({
  leaseHeader: ExecutionLeaseHeaderSchema,
});
export type BrowserListSessionsIPCRequest = z.infer<typeof BrowserListSessionsIPCRequestSchema>;
