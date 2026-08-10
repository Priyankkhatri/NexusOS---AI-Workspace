import path from 'node:path';
import fs from 'node:fs';

export interface PathSecurityResult {
  valid: boolean;
  canonicalPath: string;
  matchedRoot?: string;
  isSymlink: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export class PathSecurityService {
  /**
   * Normalizes a path string, stripping trailing slashes except for root drives.
   */
  public normalizePath(rawPath: string): string {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new Error('[PathSecurityError] Path must be a non-empty string.');
    }

    if (rawPath.includes('\0')) {
      throw new Error('[PathSecurityError] Null bytes in path are strictly prohibited.');
    }

    // Convert backslashes to forward slashes for unified processing, then path.normalize
    let normalized = path.normalize(rawPath);

    // Drive letter upper-casing on Windows for consistency (e.g. c:\ -> C:\)
    if (process.platform === 'win32' && /^[a-z]:/i.test(normalized)) {
      normalized = normalized[0]!.toUpperCase() + normalized.substring(1);
    }

    return normalized;
  }

  /**
   * Evaluates if a given path is within one of the allowed roots.
   * Handles canonical realpath resolution for symlinks, junctions, and relative traversal.
   */
  public validatePath(targetPath: string, allowedRoots: string[]): PathSecurityResult {
    if (!allowedRoots || allowedRoots.length === 0) {
      return {
        valid: false,
        canonicalPath: '',
        isSymlink: false,
        error: {
          code: 'PATH_OUTSIDE_SCOPE',
          message: 'No allowed filesystem roots specified. Access is fail-closed.',
        },
      };
    }

    // 1. Basic sanitization
    let normalizedInput: string;
    try {
      normalizedInput = this.normalizePath(targetPath);
    } catch (err) {
      return {
        valid: false,
        canonicalPath: '',
        isSymlink: false,
        error: {
          code: 'INVALID_PATH',
          message: err instanceof Error ? err.message : 'Invalid path input.',
        },
      };
    }

    // 2. Reject raw UNC device paths or dangerous device prefixes (\\.\, \\?\, \\server\share)
    if (
      normalizedInput.startsWith('\\\\.\\') ||
      normalizedInput.startsWith('\\\\?\\') ||
      normalizedInput.startsWith('//./') ||
      normalizedInput.startsWith('//?/')
    ) {
      return {
        valid: false,
        canonicalPath: normalizedInput,
        isSymlink: false,
        error: {
          code: 'DEVICE_PATH_PROHIBITED',
          message: 'Device or raw NT namespace paths are prohibited.',
        },
      };
    }

    // 3. Normalize allowed roots
    const canonicalRoots = allowedRoots.map((root) => {
      const norm = this.normalizePath(root);
      try {
        return fs.existsSync(norm) ? fs.realpathSync(norm) : norm;
      } catch {
        return norm;
      }
    });

    // 4. Resolve canonical realpath
    let absolutePath = path.resolve(normalizedInput);
    let isSymlink = false;
    let canonicalPath = absolutePath;

    try {
      // Check lstat to detect symlink / junction
      if (fs.existsSync(absolutePath)) {
        const lstat = fs.lstatSync(absolutePath);
        if (lstat.isSymbolicLink()) {
          isSymlink = true;
        }
        canonicalPath = fs.realpathSync(absolutePath);
      } else {
        // Path does not exist yet (e.g. creating a new file).
        // Canonicalize the existing parent directory.
        const parentDir = path.dirname(absolutePath);
        if (fs.existsSync(parentDir)) {
          const parentLstat = fs.lstatSync(parentDir);
          if (parentLstat.isSymbolicLink()) {
            isSymlink = true;
          }
          const canonicalParent = fs.realpathSync(parentDir);
          canonicalPath = path.join(canonicalParent, path.basename(absolutePath));
        } else {
          // Parent doesn't exist either; resolve relative segments
          canonicalPath = absolutePath;
        }
      }
    } catch (err) {
      return {
        valid: false,
        canonicalPath: absolutePath,
        isSymlink: false,
        error: {
          code: 'CANONICALIZATION_FAILED',
          message: `Failed to canonicalize path: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    // Re-normalize canonicalPath
    canonicalPath = this.normalizePath(canonicalPath);

    // 5. Verify Scope against Canonical Roots
    let matchedRoot: string | undefined;

    for (const root of canonicalRoots) {
      const normRoot = this.normalizePath(root);
      if (this.isSubpath(canonicalPath, normRoot)) {
        matchedRoot = normRoot;
        break;
      }
    }

    if (!matchedRoot) {
      return {
        valid: false,
        canonicalPath,
        isSymlink,
        error: {
          code: isSymlink ? 'SYMLINK_SCOPE_ESCAPE' : 'PATH_OUTSIDE_SCOPE',
          message: isSymlink
            ? `Path resolves through a symlink to '${canonicalPath}' outside allowed roots.`
            : `Canonical path '${canonicalPath}' is outside the authorized filesystem scopes.`,
        },
      };
    }

    return {
      valid: true,
      canonicalPath,
      matchedRoot,
      isSymlink,
    };
  }

  /**
   * Helper to verify if target candidate path is equal to or inside parent directory.
   */
  private isSubpath(target: string, parent: string): boolean {
    const isWindows = process.platform === 'win32';
    const targetCmp = isWindows ? target.toLowerCase() : target;
    const parentCmp = isWindows ? parent.toLowerCase() : parent;

    if (targetCmp === parentCmp) {
      return true;
    }

    const relative = path.relative(parentCmp, targetCmp);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }
}
