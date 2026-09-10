import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import {
  ModelDownloadProgress,
  ModelDownloadProgressSchema,
  ModelManifest,
  ModelManifestSchema,
} from '@nexusos/contracts';
import { ModelArtifact, ModelArtifactSchema, ModelIdPattern, ProviderType } from './types.js';

export type ModelCacheErrorCode =
  | 'INVALID_PATH'
  | 'HASH_MISMATCH'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_IN_USE'
  | 'NOT_FOUND'
  | 'UNSAFE_DESTINATION'
  | 'INVALID_SOURCE'
  | 'INCOMPLETE_DOWNLOAD'
  | 'DOWNLOAD_FAILED'
  | 'ABORTED';

export class ModelCacheError extends Error {
  constructor(
    message: string,
    public readonly code: ModelCacheErrorCode,
  ) {
    super(message);
    this.name = 'ModelCacheError';
  }
}

/**
 * Checks if an IP address (IPv4 or IPv6 or encoded) belongs to loopback, private RFC1918,
 * link-local/cloud metadata, carrier-grade NAT, multicast, or reserved networks.
 */
export function isPrivateOrUnsafeIp(ip: string): boolean {
  let target = ip.toLowerCase().trim();

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (target.startsWith('::ffff:')) {
    target = target.substring(7);
  }

  // IPv4 dotted-quad check
  const ipv4Match = target.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const p1 = parseInt(ipv4Match[1]!, 10);
    const p2 = parseInt(ipv4Match[2]!, 10);
    const p3 = parseInt(ipv4Match[3]!, 10);
    const p4 = parseInt(ipv4Match[4]!, 10);

    if (p1 > 255 || p2 > 255 || p3 > 255 || p4 > 255) {
      return true; // Malformed / overflow
    }

    if (p1 === 0) return true; // 0.0.0.0/8 (Current network)
    if (p1 === 10) return true; // 10.0.0.0/8 (Private RFC 1918)
    if (p1 === 127) return true; // 127.0.0.0/8 (Loopback)
    if (p1 === 169 && p2 === 254) return true; // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return true; // 172.16.0.0/12 (Private RFC 1918)
    if (p1 === 192 && p2 === 168) return true; // 192.168.0.0/16 (Private RFC 1918)
    if (p1 === 100 && p2 >= 64 && p2 <= 127) return true; // 100.64.0.0/10 (Carrier-grade NAT)
    if (p1 === 192 && p2 === 0 && p3 === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
    if (p1 === 192 && p2 === 0 && p3 === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
    if (p1 === 198 && p2 === 51 && p3 === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
    if (p1 === 203 && p2 === 0 && p3 === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
    if (p1 === 198 && (p2 === 18 || p2 === 19)) return true; // 198.18.0.0/15 (Benchmarking)
    if (p1 >= 224 && p1 <= 239) return true; // 224.0.0.0/4 (Multicast)
    if (p1 >= 240) return true; // 240.0.0.0/4 (Reserved / Broadcast)
    return false;
  }

  // Hex or integer IP encodings (e.g. 0x7f000001 or 2130706433)
  if (/^0x[0-9a-f]+$/i.test(target) || /^\d+$/.test(target)) {
    const num = parseInt(target, target.startsWith('0x') || target.startsWith('0X') ? 16 : 10);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
      const p1 = (num >>> 24) & 255;
      const p2 = (num >>> 16) & 255;
      if (
        p1 === 0 ||
        p1 === 10 ||
        p1 === 127 ||
        (p1 === 169 && p2 === 254) ||
        (p1 === 172 && p2 >= 16 && p2 <= 31) ||
        (p1 === 192 && p2 === 168) ||
        p1 >= 224
      ) {
        return true;
      }
    }
  }

  // IPv6 checks
  if (
    target === '::' ||
    target === '::1' ||
    target.startsWith('fe80:') || // Link-local fe80::/10
    target.startsWith('fe9') ||
    target.startsWith('fea') ||
    target.startsWith('feb') ||
    target.startsWith('fc') || // Unique local address fc00::/7 (fc00:: and fd00::)
    target.startsWith('fd') ||
    target.startsWith('ff') || // Multicast ff00::/8
    target.startsWith('2001:db8:') // Documentation
  ) {
    return true;
  }

  return false;
}

export interface SourceValidationOptions {
  allowLocalhostForTesting?: boolean;
}

/**
 * Validates a remote artifact acquisition URL against SSRF policy:
 * - Requires HTTPS (unless allowLocalhostForTesting is true)
 * - Prohibits embedded credentials
 * - Prohibits localhost, 127.0.0.0/8, 0.0.0.0, ::1, cloud metadata (169.254.169.254), RFC1918
 * - Resolves all DNS A/AAAA records and validates every resolved IP address
 */
export async function validateRemoteArtifactSource(
  urlStr: string,
  options?: SourceValidationOptions,
): Promise<URL> {
  const allowLocalhost = options?.allowLocalhostForTesting ?? false;

  if (!urlStr || typeof urlStr !== 'string') {
    throw new ModelCacheError('Artifact source URL must be a non-empty string.', 'INVALID_SOURCE');
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new ModelCacheError(`Invalid artifact source URL format: '${urlStr}'`, 'INVALID_SOURCE');
  }

  // 1. Prohibit embedded credentials
  if (parsed.username || parsed.password) {
    throw new ModelCacheError(
      'Embedded credentials in artifact source URL are strictly prohibited.',
      'UNSAFE_DESTINATION',
    );
  }

  // 2. Scheme validation: HTTPS strictly required unless allowLocalhostForTesting is explicitly true
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(allowLocalhost && protocol === 'http:')) {
    throw new ModelCacheError(
      `Artifact source URL protocol '${protocol}' disallowed: HTTPS is strictly required.`,
      'UNSAFE_DESTINATION',
    );
  }

  const rawHost = parsed.hostname.toLowerCase().trim();
  const hostname = rawHost.replace(/^\[|\]$/g, '').replace(/\.+$/, '');

  // If local testing is explicitly enabled and target is loopback, permit
  if (
    allowLocalhost &&
    (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1')
  ) {
    return parsed;
  }

  // 3. Check prohibited hostnames & cloud metadata endpoints
  const prohibitedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '::',
    '169.254.169.254',
    '169.254.170.2',
    'metadata.google.internal',
    'instance-data',
    'metadata.azure.com',
  ]);

  if (
    prohibitedHosts.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new ModelCacheError(
      `SSRF Violation: Access to local, loopback, or metadata destination '${rawHost}' is prohibited.`,
      'UNSAFE_DESTINATION',
    );
  }

  if (isPrivateOrUnsafeIp(hostname)) {
    throw new ModelCacheError(
      `SSRF Violation: Destination '${rawHost}' is a private, loopback, or reserved IP address.`,
      'UNSAFE_DESTINATION',
    );
  }

  // 4. Safe DNS Resolution Check (resolves all A/AAAA records)
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new ModelCacheError(
        `DNS resolution returned no addresses for hostname '${hostname}'.`,
        'UNSAFE_DESTINATION',
      );
    }
    for (const addr of addresses) {
      if (isPrivateOrUnsafeIp(addr.address)) {
        throw new ModelCacheError(
          `SSRF Violation: Hostname '${hostname}' resolved to prohibited IP '${addr.address}'.`,
          'UNSAFE_DESTINATION',
        );
      }
    }
  } catch (err: any) {
    if (err instanceof ModelCacheError) {
      throw err;
    }
    throw new ModelCacheError(
      `DNS resolution failed for hostname '${hostname}': ${err.message}`,
      'UNSAFE_DESTINATION',
    );
  }

  return parsed;
}

export interface DownloadArtifactOptions {
  manifest: ModelManifest;
  provider?: ProviderType;
  signal?: AbortSignal;
  onProgress?: (progress: ModelDownloadProgress) => void;
  allowLocalhostForTesting?: boolean;
}

export class ModelCacheManager {
  private readonly baseDir: string;
  private readonly stagingDir: string;
  private readonly modelsDir: string;
  private readonly activeModelIds = new Set<string>();
  private readonly catalog = new Map<string, ModelArtifact>();
  private readonly maxCacheBytes: number;
  private readonly inFlightDownloads = new Map<string, Promise<ModelArtifact>>();

  constructor(baseDir: string, maxCacheBytes = 53687091200) {
    // 50 GB default quota
    this.baseDir = path.resolve(baseDir);
    this.stagingDir = path.join(this.baseDir, 'staging');
    this.modelsDir = path.join(this.baseDir, 'models');
    this.maxCacheBytes = maxCacheBytes;
  }

  public async initialize(): Promise<void> {
    await fs.promises.mkdir(this.stagingDir, { recursive: true });
    await fs.promises.mkdir(this.modelsDir, { recursive: true });
  }

  /**
   * Resolves and verifies that a target path stays safely within baseDir (anti path traversal/symlink escape).
   */
  public resolveSafePath(relativeOrAbsolute: string): string {
    if (!relativeOrAbsolute || relativeOrAbsolute.includes('\0')) {
      throw new ModelCacheError(
        'Invalid model path: null byte or empty string detected.',
        'INVALID_PATH',
      );
    }

    // Windows reserved device names check (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const rawBase = path.basename(relativeOrAbsolute);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(rawBase)) {
      throw new ModelCacheError(
        `Windows reserved device name prohibited: '${rawBase}'.`,
        'INVALID_PATH',
      );
    }

    // Block alternate data streams (ADS) e.g., file:stream
    if (rawBase.includes(':')) {
      throw new ModelCacheError(
        `Alternate data stream path prohibited: '${rawBase}'.`,
        'INVALID_PATH',
      );
    }

    const resolved = path.resolve(relativeOrAbsolute);
    const normalizedBase = path.resolve(this.baseDir);

    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
      throw new ModelCacheError(
        `Path traversal attack blocked: path '${relativeOrAbsolute}' escapes base directory '${this.baseDir}'.`,
        'INVALID_PATH',
      );
    }

    const baseName = path.basename(resolved);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(baseName)) {
      throw new ModelCacheError(
        `Windows reserved device name prohibited: '${baseName}'.`,
        'INVALID_PATH',
      );
    }

    if (baseName.includes(':')) {
      throw new ModelCacheError(
        `Alternate data stream path prohibited: '${baseName}'.`,
        'INVALID_PATH',
      );
    }

    // Check for symlink escape if file exists
    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      if (!realPath.startsWith(normalizedBase + path.sep) && realPath !== normalizedBase) {
        throw new ModelCacheError(
          `Symlink escape blocked: target realpath '${realPath}' points outside base directory '${this.baseDir}'.`,
          'INVALID_PATH',
        );
      }
    }

    return resolved;
  }

  /**
   * Calculates the SHA-256 hex digest of a file stream.
   */
  public async computeSha256(filePath: string): Promise<string> {
    const safePath = this.resolveSafePath(filePath);
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(safePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) =>
        reject(
          new ModelCacheError(
            `Failed to read model artifact for hash computation: ${err.message}`,
            'INVALID_PATH',
          ),
        ),
      );
    });
  }

  /**
   * Verifies SHA-256 integrity of a model artifact file against an expected hash.
   */
  public async verifyArtifactHash(filePath: string, expectedHash: string): Promise<boolean> {
    const actualHash = await this.computeSha256(filePath);
    return (
      actualHash.length === expectedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(actualHash.toLowerCase(), 'utf-8'),
        Buffer.from(expectedHash.toLowerCase(), 'utf-8'),
      )
    );
  }

  /**
   * Promotes a staged model file to installed status atomically after SHA-256 verification.
   */
  public async stageAndPromoteModel(
    stagedFilePath: string,
    artifactMeta: Omit<ModelArtifact, 'storagePath' | 'state'>,
  ): Promise<ModelArtifact> {
    const safeStagedPath = this.resolveSafePath(stagedFilePath);

    // 1. Verify file exists
    if (!fs.existsSync(safeStagedPath)) {
      throw new ModelCacheError(`Staged model file not found at '${stagedFilePath}'.`, 'NOT_FOUND');
    }

    // 2. Validate model ID pattern and forbid traversal sequences
    if (!ModelIdPattern.test(artifactMeta.modelId) || artifactMeta.modelId.includes('..')) {
      throw new ModelCacheError(
        `Invalid model ID format '${artifactMeta.modelId}'.`,
        'INVALID_PATH',
      );
    }

    // 3. Verify SHA-256 integrity
    const hashValid = await this.verifyArtifactHash(safeStagedPath, artifactMeta.sha256);
    if (!hashValid) {
      // Remove corrupted staged file immediately
      try {
        await fs.promises.unlink(safeStagedPath);
      } catch {
        // ignore
      }
      throw new ModelCacheError(
        `Model artifact SHA-256 verification failed for '${artifactMeta.modelId}'. Expected ${artifactMeta.sha256}. Staged file deleted.`,
        'HASH_MISMATCH',
      );
    }

    // 4. Ensure cache capacity before promotion (run LRU eviction if needed)
    const stats = await fs.promises.stat(safeStagedPath);
    await this.ensureCapacity(stats.size);

    // 5. Atomic promotion (rename from staging to models directory)
    const safeModelName = artifactMeta.modelId.replace(/[/\\:]/g, '_');
    const targetFileName = `${safeModelName}-${artifactMeta.sha256.substring(0, 12)}.${artifactMeta.format}`;
    const targetPath = path.join(this.modelsDir, targetFileName);
    const safeTargetPath = this.resolveSafePath(targetPath);

    await fs.promises.rename(safeStagedPath, safeTargetPath);

    const artifact: ModelArtifact = {
      ...artifactMeta,
      fileSizeBytes: stats.size,
      storagePath: safeTargetPath,
      state: 'Installed',
      lastUsedTimestamp: Date.now(),
    };

    // Validate schema
    ModelArtifactSchema.parse(artifact);

    this.catalog.set(artifact.modelId, artifact);
    return artifact;
  }

  /**
   * Secure remote model artifact acquisition lifecycle:
   * manifest
   *   ↓
   * validate acquisition source (SSRF, safe IP, redirects)
   *   ↓
   * stream into staging
   *   ↓
   * enforce byte limits & cache quota
   *   ↓
   * compute SHA-256 while streaming
   *   ↓
   * verify exact digest
   *   ↓
   * atomically promote into active models/
   *   ↓
   * make artifact available in cache catalog
   */
  public async downloadArtifact(
    optionsOrManifest: DownloadArtifactOptions | ModelManifest,
    extraOptions?: Omit<DownloadArtifactOptions, 'manifest'>,
  ): Promise<ModelArtifact> {
    const options: DownloadArtifactOptions =
      'manifest' in optionsOrManifest
        ? (optionsOrManifest as DownloadArtifactOptions)
        : { manifest: optionsOrManifest as ModelManifest, ...extraOptions };

    const { manifest, signal, onProgress, allowLocalhostForTesting } = options;

    // Validate manifest schema
    ModelManifestSchema.parse(manifest);

    // Check if model already exists in catalog
    const existing = this.catalog.get(manifest.modelId);
    if (existing && existing.state === 'Installed' && fs.existsSync(existing.storagePath)) {
      return existing;
    }

    // Concurrency guard: deduplicate simultaneous downloads for same modelId
    const inFlight = this.inFlightDownloads.get(manifest.modelId);
    if (inFlight) {
      return inFlight;
    }

    const downloadPromise = (async (): Promise<ModelArtifact> => {
      // 1. Validate initial acquisition source
      let currentUrl = manifest.source.url;
      await validateRemoteArtifactSource(currentUrl, { allowLocalhostForTesting });

      // 2. Pre-check cache capacity
      await this.ensureCapacity(manifest.byteSize);

      // 3. Connect with manual redirect following and per-hop SSRF validation
      let response: Response | undefined;
      let redirectCount = 0;
      const MAX_REDIRECTS = 5;

      while (true) {
        if (signal?.aborted) {
          throw new ModelCacheError('Download was aborted before connection.', 'ABORTED');
        }

        await validateRemoteArtifactSource(currentUrl, { allowLocalhostForTesting });

        try {
          response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal,
          });
        } catch (fetchErr: any) {
          if (signal?.aborted || fetchErr?.name === 'AbortError') {
            throw new ModelCacheError('Download was aborted by caller.', 'ABORTED');
          }
          throw new ModelCacheError(
            `Connection failed while downloading artifact: ${fetchErr?.message || String(fetchErr)}`,
            'DOWNLOAD_FAILED',
          );
        }

        if (response.status >= 300 && response.status < 400) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            throw new ModelCacheError(
              `Too many redirects (${redirectCount}) while downloading model artifact.`,
              'DOWNLOAD_FAILED',
            );
          }
          const location = response.headers.get('location');
          if (!location) {
            throw new ModelCacheError(
              'Redirect response missing Location header.',
              'DOWNLOAD_FAILED',
            );
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        break;
      }

      if (!response || !response.ok) {
        const status = response ? response.status : 0;
        const statusText = response ? response.statusText : 'No response';
        throw new ModelCacheError(
          `Artifact download failed with HTTP status ${status}: ${statusText}`,
          'DOWNLOAD_FAILED',
        );
      }

      // 4. Check Content-Length if provided
      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const declaredLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(declaredLength) && declaredLength !== manifest.byteSize) {
          throw new ModelCacheError(
            `Content-Length header (${declaredLength}) contradicts manifest byteSize (${manifest.byteSize}).`,
            'INCOMPLETE_DOWNLOAD',
          );
        }
      }

      if (!response.body) {
        throw new ModelCacheError('Response body is empty or null.', 'INCOMPLETE_DOWNLOAD');
      }

      // 5. Stream into staging directory with unique temporary filename
      const sanitizedModelId = manifest.modelId.replace(/[/\\:]/g, '_');
      const stagingFileName = `download-${sanitizedModelId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.tmp`;
      const stagedFilePath = path.join(this.stagingDir, stagingFileName);
      const safeStagedPath = this.resolveSafePath(stagedFilePath);

      const writeStream = fs.createWriteStream(safeStagedPath);
      const hash = crypto.createHash('sha256');
      let bytesTransferred = 0;
      const totalBytes = manifest.byteSize;
      const startTime = Date.now();

      const emitProgress = (
        status: 'PENDING' | 'DOWNLOADING' | 'VERIFYING' | 'COMPLETED' | 'FAILED',
      ) => {
        if (!onProgress) return;
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = elapsedSec > 0 ? Math.round(bytesTransferred / elapsedSec) : 0;
        const remaining = totalBytes - bytesTransferred;
        const estimatedRemainingMs =
          rate > 0 && remaining > 0 ? Math.round((remaining / rate) * 1000) : undefined;

        const progressEvent: ModelDownloadProgress = {
          modelId: manifest.modelId,
          bytesTransferred: Math.min(bytesTransferred, totalBytes),
          totalBytes,
          transferRateBytesPerSec: rate,
          estimatedRemainingMs,
          status,
        };
        ModelDownloadProgressSchema.parse(progressEvent);
        onProgress(progressEvent);
      };

      emitProgress('DOWNLOADING');

      try {
        for await (const rawChunk of response.body as any) {
          if (signal?.aborted) {
            throw new ModelCacheError('Download was aborted by caller.', 'ABORTED');
          }

          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          bytesTransferred += chunk.length;

          // Enforce strictly bounded size: cannot exceed manifest byteSize
          if (bytesTransferred > totalBytes) {
            throw new ModelCacheError(
              `Downloaded stream exceeded declared manifest byteSize of ${totalBytes} bytes.`,
              'QUOTA_EXCEEDED',
            );
          }

          hash.update(chunk);

          // Backpressure-safe write
          if (!writeStream.write(chunk)) {
            await new Promise<void>((resolve, reject) => {
              writeStream.once('drain', resolve);
              writeStream.once('error', reject);
            });
          }

          emitProgress('DOWNLOADING');
        }

        await new Promise<void>((resolve, reject) => {
          writeStream.end(() => resolve());
          writeStream.on('error', reject);
        });
      } catch (streamErr) {
        writeStream.destroy();
        try {
          if (fs.existsSync(safeStagedPath)) {
            await fs.promises.unlink(safeStagedPath);
          }
        } catch {
          // ignore
        }
        emitProgress('FAILED');
        if (streamErr instanceof ModelCacheError) {
          throw streamErr;
        }
        const msg = (streamErr as Error)?.message || '';
        if (bytesTransferred < totalBytes && !signal?.aborted) {
          throw new ModelCacheError(
            `Incomplete download: stream was prematurely terminated after ${bytesTransferred}/${totalBytes} bytes. Error: ${msg}`,
            'INCOMPLETE_DOWNLOAD',
          );
        }
        throw new ModelCacheError(`Download stream error: ${msg}`, 'DOWNLOAD_FAILED');
      }

      // 6. Detect premature EOF: final received byte count must equal manifest.byteSize
      if (bytesTransferred !== totalBytes) {
        try {
          if (fs.existsSync(safeStagedPath)) {
            await fs.promises.unlink(safeStagedPath);
          }
        } catch {
          // ignore
        }
        emitProgress('FAILED');
        throw new ModelCacheError(
          `Incomplete download: received ${bytesTransferred} bytes, expected ${totalBytes} bytes.`,
          'INCOMPLETE_DOWNLOAD',
        );
      }

      // 7. SHA-256 verification
      emitProgress('VERIFYING');
      const computedSha256 = hash.digest('hex').toLowerCase();
      const expectedSha256 = manifest.sha256.toLowerCase();

      const hashesMatch =
        computedSha256.length === expectedSha256.length &&
        crypto.timingSafeEqual(
          Buffer.from(computedSha256, 'utf-8'),
          Buffer.from(expectedSha256, 'utf-8'),
        );

      if (!hashesMatch) {
        try {
          if (fs.existsSync(safeStagedPath)) {
            await fs.promises.unlink(safeStagedPath);
          }
        } catch {
          // ignore
        }
        emitProgress('FAILED');
        throw new ModelCacheError(
          `Model artifact SHA-256 verification failed for '${manifest.modelId}'. Expected ${expectedSha256}, computed ${computedSha256}. Staged file quarantined and deleted.`,
          'HASH_MISMATCH',
        );
      }

      // 8. Atomic promotion to active models/ directory
      const provider: ProviderType =
        options.provider ?? (manifest.format === 'onnx' ? 'onnx' : 'llamacpp');

      const artifactMeta = {
        modelId: manifest.modelId,
        name: manifest.name,
        provider,
        sha256: computedSha256,
        fileSizeBytes: totalBytes,
        format: manifest.format,
        quantization: manifest.quantization,
        contextWindowTokens: manifest.contextLength,
        signature: manifest.signature,
        license:
          typeof manifest.metadata?.license === 'string'
            ? (manifest.metadata.license as string)
            : undefined,
      };

      const promotedArtifact = await this.stageAndPromoteModel(safeStagedPath, artifactMeta);
      emitProgress('COMPLETED');
      return promotedArtifact;
    })();

    this.inFlightDownloads.set(manifest.modelId, downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.inFlightDownloads.delete(manifest.modelId);
    }
  }

  /**
   * Evicts least recently used models if total size exceeds quota. Protects active models.
   */
  public async ensureCapacity(requiredBytes: number): Promise<void> {
    let currentTotalBytes = 0;
    const candidates: ModelArtifact[] = [];

    for (const artifact of this.catalog.values()) {
      currentTotalBytes += artifact.fileSizeBytes;
      if (!this.activeModelIds.has(artifact.modelId)) {
        candidates.push(artifact);
      }
    }

    if (currentTotalBytes + requiredBytes <= this.maxCacheBytes) {
      return; // Capacity available
    }

    // Sort candidates by lastUsedTimestamp ascending (oldest first)
    candidates.sort((a, b) => (a.lastUsedTimestamp || 0) - (b.lastUsedTimestamp || 0));

    for (const victim of candidates) {
      if (currentTotalBytes + requiredBytes <= this.maxCacheBytes) {
        break;
      }

      try {
        if (fs.existsSync(victim.storagePath)) {
          await fs.promises.unlink(victim.storagePath);
        }
        this.catalog.delete(victim.modelId);
        currentTotalBytes -= victim.fileSizeBytes;
      } catch {
        // ignore
      }
    }

    if (currentTotalBytes + requiredBytes > this.maxCacheBytes) {
      throw new ModelCacheError(
        `Model cache quota exceeded (${this.maxCacheBytes} bytes). Cannot free enough space for ${requiredBytes} bytes without evicting active in-use models.`,
        'QUOTA_EXCEEDED',
      );
    }
  }

  public markModelActive(modelId: string): void {
    this.activeModelIds.add(modelId);
    const artifact = this.catalog.get(modelId);
    if (artifact) {
      artifact.lastUsedTimestamp = Date.now();
    }
  }

  public markModelInactive(modelId: string): void {
    this.activeModelIds.delete(modelId);
  }

  public getModel(modelId: string): ModelArtifact | undefined {
    return this.catalog.get(modelId);
  }

  public listCatalog(): ModelArtifact[] {
    return Array.from(this.catalog.values());
  }
}
