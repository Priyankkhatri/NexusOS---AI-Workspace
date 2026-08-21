import { z } from 'zod';
import { ExecutionLeaseHeaderSchema } from '@nexusos/contracts';

// ---------------------------------------------------------------------------
// browser.createSession
// ---------------------------------------------------------------------------

export const BrowserCreateSessionIPCRequestSchema = z.object({
  taskId: z.string().min(1, 'taskId is required').max(256),
  workspaceId: z.string().min(1, 'workspaceId is required').max(256),
  storageDir: z.string().min(1, 'storageDir is required').max(4096),
  limits: z
    .object({
      maxConcurrentSessions: z.number().int().positive().max(20).optional(),
      navigationTimeoutMs: z.number().int().positive().max(300_000).optional(),
      maxExtractionSizeBytes: z
        .number()
        .int()
        .positive()
        .max(10 * 1024 * 1024)
        .optional(),
      maxScreenshotSizeBytes: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024)
        .optional(),
      maxDownloadSizeBytes: z
        .number()
        .int()
        .positive()
        .max(500 * 1024 * 1024)
        .optional(),
    })
    .optional(),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type BrowserCreateSessionIPCRequest = z.infer<typeof BrowserCreateSessionIPCRequestSchema>;

// ---------------------------------------------------------------------------
// browser.navigate
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// browser.extractContent
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// browser.interactForm
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// browser.captureScreenshot
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// browser.downloadFile
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// browser.uploadFile
// ---------------------------------------------------------------------------

export const BrowserUploadFileIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  selector: z.string().min(1, 'selector is required').max(2048),
  sourceFilePath: z.string().min(1, 'sourceFilePath is required').max(4096),
  allowedRoots: z.array(z.string().min(1).max(4096)).min(1),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type BrowserUploadFileIPCRequest = z.infer<typeof BrowserUploadFileIPCRequestSchema>;

// ---------------------------------------------------------------------------
// browser.clearSession
// ---------------------------------------------------------------------------

export const BrowserClearSessionIPCRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(256),
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type BrowserClearSessionIPCRequest = z.infer<typeof BrowserClearSessionIPCRequestSchema>;

// ---------------------------------------------------------------------------
// browser.listSessions
// ---------------------------------------------------------------------------

export const BrowserListSessionsIPCRequestSchema = z.object({
  leaseHeader: ExecutionLeaseHeaderSchema,
});

export type BrowserListSessionsIPCRequest = z.infer<typeof BrowserListSessionsIPCRequestSchema>;
