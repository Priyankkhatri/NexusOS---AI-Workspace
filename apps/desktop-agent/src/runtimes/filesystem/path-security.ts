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
  private static readonly SENSITIVE_SYS_PREFIXES = [
    // Windows
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\programdata',
    // Unix / Linux
    '/etc',
    '/boot',
    '/dev',
    '/proc',
    '/sys',
    '/usr',
    '/var/run',
    '/root',
  ];

  private static readonly SENSITIVE_CREDENTIAL_SEGMENTS = new Set([
    '.ssh',
    '.aws',
    '.azure',
    '.kube',
    '.gnupg',
    '.git-credentials',
    '.npmrc',
    '.dockercfg',
    'id_rsa',
    'id_ed25519',
  ]);

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
   * Enforces NTFS Alternate Data Stream (ADS) rejection and sensitive OS path protection.
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

    // 2. Reject raw UNC device paths or dangerous device prefixes (\\.\, \\?\, \\server\share, \Device\)
    if (
      normalizedInput.startsWith('\\\\.\\') ||
      normalizedInput.startsWith('\\\\?\\') ||
      normalizedInput.startsWith('//./') ||
      normalizedInput.startsWith('//?/') ||
      normalizedInput.startsWith('\\Device\\')
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

    // 3. Reject NTFS Alternate Data Streams (ADS) (e.g. file.txt:stream, dir:stream, file.txt::$DATA)
    const isWin = process.platform === 'win32';
    const hasAds = isWin
      ? (/^[a-zA-Z]:/.test(targetPath) && targetPath.slice(2).includes(':')) ||
        (!/^[a-zA-Z]:/.test(targetPath) && targetPath.includes(':'))
      : targetPath.includes(':');

    if (hasAds) {
      return {
        valid: false,
        canonicalPath: '',
        isSymlink: false,
        error: {
          code: 'ADS_PROHIBITED',
          message: 'NTFS Alternate Data Streams (ADS) are strictly prohibited.',
        },
      };
    }

    // 4. Sensitive Path Check on Raw / Normalized Input
    const rawSensitiveError = this.checkSensitivePath(normalizedInput);
    if (rawSensitiveError) {
      return {
        valid: false,
        canonicalPath: normalizedInput,
        isSymlink: false,
        error: rawSensitiveError,
      };
    }

    // 5. Normalize and canonicalize allowed roots
    const canonicalRoots = allowedRoots.map((root) => {
      return this.resolveCanonicalPath(root).canonicalPath;
    });

    // 6. Resolve canonical realpath with ancestor symlink traversal
    const absolutePath = path.resolve(normalizedInput);
    let canonicalPath: string;
    let isDirectSymlink = false;

    try {
      const resolved = this.resolveCanonicalPath(normalizedInput);
      canonicalPath = resolved.canonicalPath;
      isDirectSymlink = resolved.isDirectSymlink;
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

    // 7. Sensitive Path Check on Canonical Resolved Path
    const canonicalSensitiveError = this.checkSensitivePath(canonicalPath);
    if (canonicalSensitiveError) {
      return {
        valid: false,
        canonicalPath,
        isSymlink: isDirectSymlink,
        error: canonicalSensitiveError,
      };
    }

    // 8. Verify Scope against Canonical Roots
    let matchedRoot: string | undefined;

    for (const root of canonicalRoots) {
      const normRoot = this.normalizePath(root);
      if (this.isSubpath(canonicalPath, normRoot)) {
        matchedRoot = normRoot;
        break;
      }
    }

    if (!matchedRoot) {
      // Determine if the escape was caused by a symlink/reparse point redirection:
      // A symlink escape occurs when the path was lexically inside an allowed root but canonically outside,
      // or when a symlink was directly encountered during resolution.
      const lexicallyInsideRoot = allowedRoots.some((root) => {
        const normRoot = this.normalizePath(path.resolve(root));
        return this.isSubpath(this.normalizePath(absolutePath), normRoot);
      });

      const isSymlinkEscape = isDirectSymlink || lexicallyInsideRoot;

      return {
        valid: false,
        canonicalPath,
        isSymlink: isSymlinkEscape,
        error: {
          code: isSymlinkEscape ? 'SYMLINK_SCOPE_ESCAPE' : 'PATH_OUTSIDE_SCOPE',
          message: isSymlinkEscape
            ? `Path resolves through a symlink to '${canonicalPath}' outside allowed roots.`
            : `Canonical path '${canonicalPath}' is outside the authorized filesystem scopes.`,
        },
      };
    }

    return {
      valid: true,
      canonicalPath,
      matchedRoot,
      isSymlink: isDirectSymlink,
    };
  }

  /**
   * Helper to resolve a path to its canonical realpath, resolving existing ancestors
   * for uncreated paths and detecting symbolic links / junctions.
   */
  private resolveCanonicalPath(target: string): {
    canonicalPath: string;
    isDirectSymlink: boolean;
  } {
    const absolutePath = path.resolve(target);
    let isDirectSymlink = false;
    let canonicalPath = absolutePath;

    try {
      let curr = absolutePath;
      const uncreatedSegments: string[] = [];

      while (curr && !fs.existsSync(curr)) {
        const parent = path.dirname(curr);
        if (parent === curr) {
          break;
        }
        uncreatedSegments.unshift(path.basename(curr));
        curr = parent;
      }

      if (curr && fs.existsSync(curr)) {
        try {
          const lst = fs.lstatSync(curr);
          if (lst.isSymbolicLink()) {
            isDirectSymlink = true;
          }
        } catch {
          // Ignore stat errors
        }

        const realExisting = fs.realpathSync(curr);
        canonicalPath =
          uncreatedSegments.length > 0
            ? path.join(realExisting, ...uncreatedSegments)
            : realExisting;
      } else {
        canonicalPath = absolutePath;
      }
    } catch {
      canonicalPath = absolutePath;
    }

    return {
      canonicalPath: this.normalizePath(canonicalPath),
      isDirectSymlink,
    };
  }

  /**
   * Helper to detect access to protected host system directories or credential stores.
   */
  private checkSensitivePath(inputPath: string): { code: string; message: string } | undefined {
    const isWindows = process.platform === 'win32';
    const lower = isWindows ? inputPath.toLowerCase() : inputPath;
    const noDriveLower = lower.replace(/^[a-z]:/i, '');

    // Check system directory prefixes
    for (const prefix of PathSecurityService.SENSITIVE_SYS_PREFIXES) {
      const p = prefix.toLowerCase();
      const pNormSlash = p.replace(/\\/g, '/');
      const pNormBackslash = p.replace(/\//g, '\\');
      if (
        lower === p ||
        lower.startsWith(p + '\\') ||
        lower.startsWith(p + '/') ||
        noDriveLower === pNormSlash ||
        noDriveLower === pNormBackslash ||
        noDriveLower.startsWith(pNormSlash + '/') ||
        noDriveLower.startsWith(pNormSlash + '\\') ||
        noDriveLower.startsWith(pNormBackslash + '\\') ||
        noDriveLower.startsWith(pNormBackslash + '/')
      ) {
        return {
          code: 'PROTECTED_PATH_DENIED',
          message: `Access to protected system path '${prefix}' is denied.`,
        };
      }
    }

    // Check credential store segments
    const segments = inputPath.split(/[/\\]/).map((s) => s.toLowerCase());
    for (const cred of PathSecurityService.SENSITIVE_CREDENTIAL_SEGMENTS) {
      if (segments.includes(cred)) {
        return {
          code: 'PROTECTED_PATH_DENIED',
          message: `Access to protected credential location '${cred}' is denied.`,
        };
      }
    }

    // Check browser credential store paths
    if (
      (lower.includes('user data') &&
        (lower.includes('cookies') || lower.includes('login data'))) ||
      lower.includes('logins.json') ||
      lower.includes('key4.db')
    ) {
      return {
        code: 'PROTECTED_PATH_DENIED',
        message: 'Access to protected browser credential store is denied.',
      };
    }

    return undefined;
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
