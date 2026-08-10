import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  createEventEnvelope,
  EventEnvelope,
  createNexusOSError,
  ErrorCategory,
} from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { RuntimeCategory, ToolRuntimeDescriptor } from '../../registry/runtime-registry.js';
import { AgentLogger } from '../../observability/agent-logger.js';
import { PathSecurityService } from './path-security.js';
import { SnapshotManager } from './snapshot.js';
import {
  FilesystemOperationName,
  FilesystemOperationRequestContext,
  ReadFileRequest,
  WriteFileRequest,
  ListDirectoryRequest,
  ListDirectoryResponse,
  StatFileRequest,
  CopyFileRequest,
  MoveFileRequest,
  DeleteFileRequest,
  FileMetadataResult,
  FilesystemOperationResult,
  DEFAULT_FILESYSTEM_RESOURCE_LIMITS,
  Preconditions,
} from './types.js';

export class FilesystemRuntime {
  public static readonly RUNTIME_ID = 'rt:filesystem-v1';

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    private readonly pathSecurity: PathSecurityService = new PathSecurityService(),
    private readonly snapshotManager: SnapshotManager = new SnapshotManager(),
    private readonly logger?: AgentLogger,
  ) {}

  public getDescriptor(): ToolRuntimeDescriptor {
    return Object.freeze({
      runtimeId: FilesystemRuntime.RUNTIME_ID,
      category: RuntimeCategory.FILESYSTEM,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: [
        FilesystemOperationName.READ,
        FilesystemOperationName.WRITE,
        FilesystemOperationName.LIST,
        FilesystemOperationName.STAT,
        FilesystemOperationName.COPY,
        FilesystemOperationName.MOVE,
        FilesystemOperationName.DELETE,
      ],
    });
  }

  /**
   * Reads a file within authorized filesystem scopes after lease and policy verification.
   */
  public async readFile(
    request: ReadFileRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<string | Buffer>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      FilesystemOperationName.READ,
      request.path,
      context,
      async (canonicalPath) => {
        const limits = { ...DEFAULT_FILESYSTEM_RESOURCE_LIMITS, ...context.limits };
        const stat = fs.statSync(canonicalPath);

        if (!stat.isFile()) {
          throw createNexusOSError(
            'NOT_A_FILE',
            ErrorCategory.VALIDATION,
            `Target path '${canonicalPath}' is not a regular file.`,
          );
        }

        if (stat.size > limits.maxFileSizeByte) {
          throw createNexusOSError(
            'FILE_TOO_LARGE',
            ErrorCategory.VALIDATION,
            `File size (${stat.size} bytes) exceeds maximum permitted limit (${limits.maxFileSizeByte} bytes).`,
          );
        }

        const encoding = request.encoding || 'utf-8';
        let data: string | Buffer;
        if (encoding === 'binary') {
          data = fs.readFileSync(canonicalPath);
        } else {
          data = fs.readFileSync(canonicalPath, encoding);
        }

        const fileHash = crypto
          .createHash('sha256')
          .update(fs.readFileSync(canonicalPath))
          .digest('hex');

        return {
          bytesProcessed: stat.size,
          data,
          meta: {
            sha256Hash: fileHash,
            size: stat.size,
          },
        };
      },
    );
  }

  /**
   * Writes content safely to a file using atomic temporary replacement.
   */
  public async writeFile(
    request: WriteFileRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<FileMetadataResult>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      FilesystemOperationName.WRITE,
      request.path,
      context,
      async (canonicalPath) => {
        const limits = { ...DEFAULT_FILESYSTEM_RESOURCE_LIMITS, ...context.limits };
        const contentBuffer = Buffer.isBuffer(request.content)
          ? request.content
          : Buffer.from(request.content, request.encoding || 'utf-8');

        if (contentBuffer.length > limits.maxFileSizeByte) {
          throw createNexusOSError(
            'FILE_TOO_LARGE',
            ErrorCategory.VALIDATION,
            `Write payload size (${contentBuffer.length} bytes) exceeds maximum permitted limit (${limits.maxFileSizeByte} bytes).`,
          );
        }

        // Check Preconditions
        if (request.preconditions) {
          this.verifyPreconditions(canonicalPath, request.preconditions);
        }

        // Check overwrite safety
        const targetExists = fs.existsSync(canonicalPath);
        if (targetExists && request.overwrite === false) {
          throw createNexusOSError(
            'PRECONDITION_FAILED',
            ErrorCategory.VALIDATION,
            `Target file '${canonicalPath}' already exists and overwrite is set to false.`,
          );
        }

        // Create snapshot before overwrite
        let snapshotId: string | undefined;
        if (targetExists && context.allowedRoots[0]) {
          const snapshot = await this.snapshotManager.createSnapshot(
            canonicalPath,
            context.allowedRoots[0],
            context.lease.task_id,
          );
          snapshotId = snapshot?.snapshotId;
        }

        // Safe Atomic Write Pattern: Write to .tmp file -> sync -> rename
        const targetDir = path.dirname(canonicalPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const tmpPath = path.join(targetDir, `.tmp.nexusos_${crypto.randomUUID()}`);

        try {
          fs.writeFileSync(tmpPath, contentBuffer);
          // Rename atomically
          fs.renameSync(tmpPath, canonicalPath);
        } catch (err) {
          // Clean up temp file on failure
          if (fs.existsSync(tmpPath)) {
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              // Ignore cleanup error
            }
          }
          throw err;
        }

        const newStat = fs.statSync(canonicalPath);
        const fileHash = crypto.createHash('sha256').update(contentBuffer).digest('hex');

        const metadata: FileMetadataResult = {
          path: request.path,
          canonicalPath,
          size: newStat.size,
          isFile: newStat.isFile(),
          isDirectory: newStat.isDirectory(),
          isSymbolicLink: false,
          createdAt: newStat.birthtime.toISOString(),
          modifiedAt: newStat.mtime.toISOString(),
          sha256Hash: fileHash,
        };

        return {
          bytesProcessed: contentBuffer.length,
          data: metadata,
          snapshotId,
          meta: {
            sha256Hash: fileHash,
            size: newStat.size,
          },
        };
      },
    );
  }

  /**
   * Lists directory contents safely within authorized scopes.
   */
  public async listDirectory(
    request: ListDirectoryRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<ListDirectoryResponse>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      FilesystemOperationName.LIST,
      request.path,
      context,
      async (canonicalPath) => {
        const limits = { ...DEFAULT_FILESYSTEM_RESOURCE_LIMITS, ...context.limits };
        const stat = fs.statSync(canonicalPath);

        if (!stat.isDirectory()) {
          throw createNexusOSError(
            'NOT_A_DIRECTORY',
            ErrorCategory.VALIDATION,
            `Target path '${canonicalPath}' is not a directory.`,
          );
        }

        const maxEntries = request.maxEntries ?? limits.maxDirectoryEntries;
        const entries: ListDirectoryResponse['entries'] = [];
        let truncated = false;

        const scanDir = (dir: string, depth: number) => {
          if (depth > limits.maxRecursionDepth) return;
          const files = fs.readdirSync(dir);

          for (const file of files) {
            if (entries.length >= maxEntries) {
              truncated = true;
              break;
            }

            const itemPath = path.join(dir, file);
            // Verify each item is in scope
            const sec = this.pathSecurity.validatePath(itemPath, context.allowedRoots);
            if (!sec.valid) continue;

            try {
              const itemStat = fs.statSync(sec.canonicalPath);
              entries.push({
                name: file,
                path: itemPath,
                canonicalPath: sec.canonicalPath,
                isDirectory: itemStat.isDirectory(),
                isFile: itemStat.isFile(),
                size: itemStat.size,
              });

              if (request.recursive && itemStat.isDirectory()) {
                scanDir(sec.canonicalPath, depth + 1);
              }
            } catch {
              // Skip unreadable item
            }
          }
        };

        scanDir(canonicalPath, 1);

        const response: ListDirectoryResponse = {
          entries,
          totalEntries: entries.length,
          truncated,
        };

        return {
          bytesProcessed: entries.length,
          data: response,
        };
      },
    );
  }

  /**
   * Inspects file or directory metadata.
   */
  public async statFile(
    request: StatFileRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<FileMetadataResult>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      FilesystemOperationName.STAT,
      request.path,
      context,
      async (canonicalPath) => {
        if (!fs.existsSync(canonicalPath)) {
          throw createNexusOSError(
            'NOT_FOUND',
            ErrorCategory.NOT_FOUND,
            `File or directory '${canonicalPath}' was not found.`,
          );
        }

        const stat = fs.statSync(canonicalPath);
        const lstat = fs.lstatSync(canonicalPath);

        let hash: string | undefined;
        if (stat.isFile() && stat.size <= 10 * 1024 * 1024) {
          hash = crypto.createHash('sha256').update(fs.readFileSync(canonicalPath)).digest('hex');
        }

        const meta: FileMetadataResult = {
          path: request.path,
          canonicalPath,
          size: stat.size,
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
          isSymbolicLink: lstat.isSymbolicLink(),
          createdAt: stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
          sha256Hash: hash,
        };

        return {
          bytesProcessed: stat.size,
          data: meta,
          meta: {
            sha256Hash: hash,
            size: stat.size,
          },
        };
      },
    );
  }

  /**
   * Copies a file from source to destination path, enforcing path security on both paths.
   */
  public async copyFile(
    request: CopyFileRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<FileMetadataResult>; event: EventEnvelope }> {
    // Validate source path first
    const sourceSecurity = this.pathSecurity.validatePath(request.sourcePath, context.allowedRoots);
    if (!sourceSecurity.valid) {
      return this.buildDeniedResult(
        FilesystemOperationName.COPY,
        request.sourcePath,
        context,
        sourceSecurity.error?.code || 'PATH_OUTSIDE_SCOPE',
        sourceSecurity.error?.message || 'Source path outside scope',
      );
    }

    return this.executeProtectedOperation(
      FilesystemOperationName.COPY,
      request.destinationPath,
      context,
      async (destCanonicalPath) => {
        const sourceCanonical = sourceSecurity.canonicalPath;

        if (!fs.existsSync(sourceCanonical)) {
          throw createNexusOSError(
            'NOT_FOUND',
            ErrorCategory.NOT_FOUND,
            `Source file '${sourceCanonical}' does not exist.`,
          );
        }

        if (request.preconditions) {
          this.verifyPreconditions(destCanonicalPath, request.preconditions);
        }

        if (fs.existsSync(destCanonicalPath) && request.overwrite === false) {
          throw createNexusOSError(
            'PRECONDITION_FAILED',
            ErrorCategory.VALIDATION,
            `Destination file '${destCanonicalPath}' exists and overwrite is false.`,
          );
        }

        const destDir = path.dirname(destCanonicalPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        fs.copyFileSync(sourceCanonical, destCanonicalPath);

        const newStat = fs.statSync(destCanonicalPath);
        const hash = crypto
          .createHash('sha256')
          .update(fs.readFileSync(destCanonicalPath))
          .digest('hex');

        const meta: FileMetadataResult = {
          path: request.destinationPath,
          canonicalPath: destCanonicalPath,
          size: newStat.size,
          isFile: newStat.isFile(),
          isDirectory: newStat.isDirectory(),
          isSymbolicLink: false,
          createdAt: newStat.birthtime.toISOString(),
          modifiedAt: newStat.mtime.toISOString(),
          sha256Hash: hash,
        };

        return {
          bytesProcessed: newStat.size,
          data: meta,
        };
      },
    );
  }

  /**
   * Moves/renames a file from source to destination path.
   */
  public async moveFile(
    request: MoveFileRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<FileMetadataResult>; event: EventEnvelope }> {
    const sourceSecurity = this.pathSecurity.validatePath(request.sourcePath, context.allowedRoots);
    if (!sourceSecurity.valid) {
      return this.buildDeniedResult(
        FilesystemOperationName.MOVE,
        request.sourcePath,
        context,
        sourceSecurity.error?.code || 'PATH_OUTSIDE_SCOPE',
        sourceSecurity.error?.message || 'Source path outside scope',
      );
    }

    return this.executeProtectedOperation(
      FilesystemOperationName.MOVE,
      request.destinationPath,
      context,
      async (destCanonicalPath) => {
        const sourceCanonical = sourceSecurity.canonicalPath;

        if (!fs.existsSync(sourceCanonical)) {
          throw createNexusOSError(
            'NOT_FOUND',
            ErrorCategory.NOT_FOUND,
            `Source file '${sourceCanonical}' does not exist.`,
          );
        }

        if (request.preconditions) {
          this.verifyPreconditions(destCanonicalPath, request.preconditions);
        }

        // Create snapshot before move/overwrite
        let snapshotId: string | undefined;
        if (context.allowedRoots[0]) {
          const snapshot = await this.snapshotManager.createSnapshot(
            sourceCanonical,
            context.allowedRoots[0],
            context.lease.task_id,
          );
          snapshotId = snapshot?.snapshotId;
        }

        const destDir = path.dirname(destCanonicalPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        fs.renameSync(sourceCanonical, destCanonicalPath);

        const newStat = fs.statSync(destCanonicalPath);
        const hash = crypto
          .createHash('sha256')
          .update(fs.readFileSync(destCanonicalPath))
          .digest('hex');

        const meta: FileMetadataResult = {
          path: request.destinationPath,
          canonicalPath: destCanonicalPath,
          size: newStat.size,
          isFile: newStat.isFile(),
          isDirectory: newStat.isDirectory(),
          isSymbolicLink: false,
          createdAt: newStat.birthtime.toISOString(),
          modifiedAt: newStat.mtime.toISOString(),
          sha256Hash: hash,
        };

        return {
          bytesProcessed: newStat.size,
          data: meta,
          snapshotId,
        };
      },
    );
  }

  /**
   * Deletes a file with optional snapshot backup.
   */
  public async deleteFile(
    request: DeleteFileRequest,
    context: FilesystemOperationRequestContext,
  ): Promise<{ result: FilesystemOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      FilesystemOperationName.DELETE,
      request.path,
      context,
      async (canonicalPath) => {
        if (!fs.existsSync(canonicalPath)) {
          throw createNexusOSError(
            'NOT_FOUND',
            ErrorCategory.NOT_FOUND,
            `Target file '${canonicalPath}' does not exist.`,
          );
        }

        if (request.preconditions) {
          this.verifyPreconditions(canonicalPath, request.preconditions);
        }

        // Create snapshot before delete
        let snapshotId: string | undefined;
        if (context.allowedRoots[0]) {
          const snapshot = await this.snapshotManager.createSnapshot(
            canonicalPath,
            context.allowedRoots[0],
            context.lease.task_id,
          );
          snapshotId = snapshot?.snapshotId;
        }

        const stat = fs.statSync(canonicalPath);
        if (stat.isDirectory()) {
          fs.rmSync(canonicalPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(canonicalPath);
        }

        return {
          bytesProcessed: stat.size,
          data: true,
          snapshotId,
        };
      },
    );
  }

  /**
   * Centralized executor enforcing: Lease Validation -> Scope Capability -> Path Security -> Execution -> Evidence Envelope
   */
  private async executeProtectedOperation<T>(
    operation: FilesystemOperationName,
    rawPath: string,
    context: FilesystemOperationRequestContext,
    action: (canonicalPath: string) => Promise<{
      bytesProcessed?: number;
      data: T;
      snapshotId?: string;
      meta?: Record<string, unknown>;
    }>,
  ): Promise<{ result: FilesystemOperationResult<T>; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    // 1. Lease & Policy Evaluation
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      return this.buildDeniedResult(
        operation,
        rawPath,
        context,
        'LEASE_OR_POLICY_INVALID',
        leaseResult.reason || 'Lease or policy validation failed',
      );
    }

    // 2. Capability check: Required capability scope must be present in lease scopes
    if (!context.lease.scopes.includes(operation)) {
      return this.buildDeniedResult(
        operation,
        rawPath,
        context,
        'MISSING_CAPABILITY_SCOPE',
        `Lease does not grant capability '${operation}'. Granted scopes: [${context.lease.scopes.join(', ')}].`,
      );
    }

    // 3. Path Security Validation
    const pathSec = this.pathSecurity.validatePath(rawPath, context.allowedRoots);
    if (!pathSec.valid) {
      return this.buildDeniedResult(
        operation,
        rawPath,
        context,
        pathSec.error?.code || 'PATH_OUTSIDE_SCOPE',
        pathSec.error?.message || 'Path security validation failed',
      );
    }

    // 4. Operation Execution
    try {
      const outcome = await action(pathSec.canonicalPath);

      const result: FilesystemOperationResult<T> = {
        success: true,
        operation,
        resourcePath: rawPath,
        canonicalPath: pathSec.canonicalPath,
        bytesProcessed: outcome.bytesProcessed,
        data: outcome.data,
        snapshotId: outcome.snapshotId,
        evidenceId,
      };

      // 5. Produce Evidence Event Envelope (NO raw content in payload!)
      const eventPayload: Record<string, unknown> = {
        operation,
        resourcePath: rawPath,
        canonicalPath: pathSec.canonicalPath,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        bytesProcessed: outcome.bytesProcessed,
        snapshotId: outcome.snapshotId,
        status: 'SUCCESS',
        ...outcome.meta,
      };

      const event = createEventEnvelope(
        `nexusos.events.filesystem.${operation.replace('fs:', '')}.v1`,
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      this.logger?.info(`Filesystem operation succeeded: ${operation}`, {
        operation,
        canonicalPath: pathSec.canonicalPath,
        taskId: context.lease.task_id,
      });

      return { result, event };
    } catch (err) {
      const errCategory = (err as { category?: ErrorCategory }).category || ErrorCategory.SYSTEM;
      const errCode = (err as { code?: string }).code || 'FILESYSTEM_OPERATION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);

      const result: FilesystemOperationResult<T> = {
        success: false,
        operation,
        resourcePath: rawPath,
        canonicalPath: pathSec.canonicalPath,
        evidenceId,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const eventPayload: Record<string, unknown> = {
        operation,
        resourcePath: rawPath,
        canonicalPath: pathSec.canonicalPath,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        status: 'FAILED',
        errorCode: errCode,
        errorCategory: errCategory,
        errorMessage: errMessage,
      };

      const event = createEventEnvelope(
        'nexusos.events.filesystem.error.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      this.logger?.error(`Filesystem operation failed: ${operation}`, {
        operation,
        canonicalPath: pathSec.canonicalPath,
        errorCode: errCode,
        errorCategory: errCategory,
      });

      return { result, event };
    }
  }

  private verifyPreconditions(canonicalPath: string, preconditions: Preconditions): void {
    const exists = fs.existsSync(canonicalPath);

    if (preconditions.expectedExists === true && !exists) {
      throw createNexusOSError(
        'PRECONDITION_FAILED',
        ErrorCategory.VALIDATION,
        `Precondition failed: Expected file to exist at '${canonicalPath}', but it does not.`,
      );
    }

    if (preconditions.expectedNotExists === true && exists) {
      throw createNexusOSError(
        'PRECONDITION_FAILED',
        ErrorCategory.VALIDATION,
        `Precondition failed: Expected file NOT to exist at '${canonicalPath}', but it exists.`,
      );
    }

    if (exists && fs.statSync(canonicalPath).isFile()) {
      const fileBuffer = fs.readFileSync(canonicalPath);

      if (
        preconditions.expectedSize !== undefined &&
        fileBuffer.length !== preconditions.expectedSize
      ) {
        throw createNexusOSError(
          'PRECONDITION_FAILED',
          ErrorCategory.VALIDATION,
          `Precondition failed: Expected file size ${preconditions.expectedSize} bytes, actual was ${fileBuffer.length} bytes.`,
        );
      }

      if (preconditions.expectedHash !== undefined) {
        const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        if (actualHash !== preconditions.expectedHash) {
          throw createNexusOSError(
            'PRECONDITION_FAILED',
            ErrorCategory.VALIDATION,
            `Precondition failed: Expected SHA-256 hash '${preconditions.expectedHash}', actual was '${actualHash}'.`,
          );
        }
      }
    }
  }

  private buildDeniedResult<T>(
    operation: FilesystemOperationName,
    rawPath: string,
    context: FilesystemOperationRequestContext,
    code: string,
    message: string,
  ): { result: FilesystemOperationResult<T>; event: EventEnvelope } {
    const evidenceId = crypto.randomUUID();

    const result: FilesystemOperationResult<T> = {
      success: false,
      operation,
      resourcePath: rawPath,
      canonicalPath: rawPath,
      evidenceId,
      error: {
        code,
        category: ErrorCategory.AUTHORIZATION,
        message,
      },
    };

    const eventPayload: Record<string, unknown> = {
      operation,
      resourcePath: rawPath,
      taskId: context.lease.task_id,
      leaseId: context.lease.lease_id,
      agentId: context.lease.agent_id,
      tenantId: context.lease.tenant_id,
      status: 'DENIED',
      errorCode: code,
      errorMessage: message,
    };

    const event = createEventEnvelope(
      'nexusos.events.filesystem.denied.v1',
      '1.0.0',
      context.lease.agent_id,
      context.lease.nonce || context.lease.task_id,
      eventPayload,
    );

    this.logger?.warn(`Filesystem operation denied: ${operation}`, {
      operation,
      rawPath,
      code,
      message,
    });

    return { result, event };
  }
}
