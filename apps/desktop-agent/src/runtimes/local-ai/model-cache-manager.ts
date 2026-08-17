import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ModelArtifact, ModelArtifactSchema, ModelIdPattern } from './types.js';

export class ModelCacheError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_PATH'
      | 'HASH_MISMATCH'
      | 'QUOTA_EXCEEDED'
      | 'MODEL_IN_USE'
      | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'ModelCacheError';
  }
}

export class ModelCacheManager {
  private readonly baseDir: string;
  private readonly stagingDir: string;
  private readonly modelsDir: string;
  private readonly activeModelIds = new Set<string>();
  private readonly catalog = new Map<string, ModelArtifact>();
  private readonly maxCacheBytes: number;

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

    const resolved = path.resolve(relativeOrAbsolute);
    const normalizedBase = path.resolve(this.baseDir);

    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
      throw new ModelCacheError(
        `Path traversal attack blocked: path '${relativeOrAbsolute}' escapes base directory '${this.baseDir}'.`,
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
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
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

    // 2. Validate model ID pattern
    if (!ModelIdPattern.test(artifactMeta.modelId)) {
      throw new ModelCacheError(
        `Invalid model ID format '${artifactMeta.modelId}'.`,
        'INVALID_PATH',
      );
    }

    // 3. Verify SHA-256 integrity
    const hashValid = await this.verifyArtifactHash(safeStagedPath, artifactMeta.sha256);
    if (!hashValid) {
      // Remove corrupted staged file
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
    const targetFileName = `${artifactMeta.modelId}-${artifactMeta.sha256.substring(0, 12)}.${artifactMeta.format}`;
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
