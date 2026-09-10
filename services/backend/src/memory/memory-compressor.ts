import crypto from 'node:crypto';
import {
  MemoryRecord,
  MemoryCompressionRequest,
  MemoryCompressionRequestSchema,
  MemoryCompressionResponse,
  MemoryCitation,
  LossinessClass,
  CompressionStrategy,
  inheritHighestSensitivity,
  estimateTokenCount,
  MemorySourceType,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  IMemoryCompressor,
  MemoryServiceContext,
  MemoryNotFoundError,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from './types.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { Logger } from '../observability/logger.js';

export interface AbstractiveCompressionAdapter {
  summarize(text: string, maxTokens: number): Promise<string>;
}

export interface MemoryCompressorOptions {
  store: IMemoryStore;
  adapter?: AbstractiveCompressionAdapter;
  logger?: Logger;
  nowProvider?: () => string;
}

/**
 * Memory Compressor Engine
 * Enforces 058-SEC-02 (provenance & lossiness), 058-SEC-04 (sensitivity inheritance),
 * and 058-SEC-07 (secret redaction before persistence).
 */
export class MemoryCompressor implements IMemoryCompressor {
  private readonly store: IMemoryStore;
  private readonly adapter?: AbstractiveCompressionAdapter;
  private readonly logger: Logger;
  private readonly now: () => string;

  constructor(options: MemoryCompressorOptions) {
    this.store = options.store;
    this.adapter = options.adapter;
    this.logger = options.logger ?? new Logger('info');
    this.now = options.nowProvider ?? (() => new Date().toISOString());
  }

  public async compress(
    request: MemoryCompressionRequest,
    ctx: MemoryServiceContext,
  ): Promise<MemoryCompressionResponse> {
    const validated = MemoryCompressionRequestSchema.parse(request);

    // 058-SEC-03: Strict tenant & workspace isolation
    if (ctx.tenantId !== validated.tenantId || ctx.workspaceId !== validated.workspaceId) {
      throw new MemorySecurityViolationError(
        `058-SEC-03: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot compress memories in (${validated.tenantId}/${validated.workspaceId}).`,
      );
    }

    // Fetch all source memories from store
    const sourceMemories: MemoryRecord[] = [];
    for (const memId of validated.sourceMemoryIds) {
      const rec = await this.store.getById(memId, validated.tenantId, validated.workspaceId);
      if (!rec) {
        throw new MemoryNotFoundError(
          `Source memory '${memId}' not found or access denied in workspace '${validated.workspaceId}'.`,
        );
      }
      sourceMemories.push(rec);
    }

    // 058-SEC-07: Scan all source memories for secrets
    for (const mem of sourceMemories) {
      this.assertNoSecrets(mem.content, `Source memory '${mem.id}' content`);
      if (mem.title) {
        this.assertNoSecrets(mem.title, `Source memory '${mem.id}' title`);
      }
    }

    // 058-SEC-02: Build immutable citation references
    const citations: MemoryCitation[] = sourceMemories.map((m) => {
      const sourceHash = crypto.createHash('sha256').update(m.content).digest('hex');
      const snippet = m.content.length > 120 ? `${m.content.slice(0, 117)}...` : m.content;
      return {
        memoryId: m.id,
        citationToken: `CIT-${m.id.slice(0, 8)}`,
        sourceType: m.provenance.sourceType,
        sourceId: m.provenance.sourceId,
        sensitivity: m.sensitivity,
        snippet,
        sourceHash,
      };
    });

    // 058-SEC-04: Highest sensitivity inheritance
    const inheritedSensitivity = inheritHighestSensitivity(
      sourceMemories.map((m) => m.sensitivity),
    );

    const originalTokenEstimate = sourceMemories.reduce(
      (acc, m) => acc + estimateTokenCount(m.content) + estimateTokenCount(m.title ?? ''),
      0,
    );

    // Perform compression (Extractive or Abstractive with fallback)
    let summaryContent = '';
    let strategyUsed = validated.strategy;

    if (validated.strategy === CompressionStrategy.ABSTRACTIVE && this.adapter) {
      try {
        const combined = sourceMemories
          .map((m) => `${m.title ? `${m.title}: ` : ''}${m.content}`)
          .join('\n\n');
        summaryContent = await this.adapter.summarize(combined, validated.maxTokens);
        strategyUsed = CompressionStrategy.ABSTRACTIVE;
      } catch (err) {
        this.logger.warn('Abstractive summarization failed, falling back to extractive', {
          details: { error: (err as Error).message },
        });
        summaryContent = this.extractiveCompress(
          sourceMemories,
          validated.maxTokens,
          validated.preservationDirectives,
        );
        strategyUsed = CompressionStrategy.EXTRACTIVE;
      }
    } else {
      summaryContent = this.extractiveCompress(
        sourceMemories,
        validated.maxTokens,
        validated.preservationDirectives,
      );
      strategyUsed = validated.strategy;
    }

    // 058-SEC-07: Scan generated summary content for secrets before returning/persisting
    this.assertNoSecrets(summaryContent, 'Compressed summary output');

    const compressedTokenEstimate = estimateTokenCount(summaryContent);
    const compressionRatio =
      originalTokenEstimate > 0
        ? Number((compressedTokenEstimate / originalTokenEstimate).toFixed(3))
        : 1.0;

    // Determine lossiness classification (Never claim zero-loss when lossy)
    let lossinessClass: LossinessClass;
    const combinedOriginal = sourceMemories.map((m) => m.content.trim()).join('\n\n');
    if (summaryContent.trim() === combinedOriginal) {
      lossinessClass = LossinessClass.LOSSLESS;
    } else if (compressionRatio >= 0.45) {
      lossinessClass = LossinessClass.BOUNDED_LOSSY;
    } else {
      lossinessClass = LossinessClass.HIGH_LOSSY;
    }

    const preservedClaims = this.extractPreservedClaims(
      summaryContent,
      validated.preservationDirectives,
    );

    const response: MemoryCompressionResponse = {
      id: `comp-${crypto.randomUUID()}`,
      tenantId: validated.tenantId,
      workspaceId: validated.workspaceId,
      summaryContent,
      strategy: strategyUsed,
      lossinessClass,
      sourceMemoryIds: validated.sourceMemoryIds,
      citations,
      inheritedSensitivity,
      originalTokenEstimate,
      compressedTokenEstimate,
      compressionRatio,
      preservedClaims,
      provenance: {
        sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
        creatorPrincipalId: ctx.principalId,
        timestamp: this.now(),
        verified: false,
      },
      createdAt: this.now(),
    };

    return response;
  }

  /**
   * Deterministic extractive compression.
   * Prioritizes preservation directives (error codes, file paths, keywords) and extracts key sentences
   * within the strict maxTokens budget.
   */
  private extractiveCompress(
    sources: MemoryRecord[],
    maxTokens: number,
    directives: string[] = [],
  ): string {
    const rawSentences: string[] = [];

    for (const source of sources) {
      const text = `${source.title ? `${source.title}. ` : ''}${source.content}`;
      const split = text.split(/(?<=[.?!])\s+/);
      for (const s of split) {
        const trimmed = s.trim();
        if (trimmed.length > 0) {
          rawSentences.push(trimmed);
        }
      }
    }

    if (rawSentences.length === 0) {
      return '';
    }

    // Score sentences based on preservation directives and position
    const scored = rawSentences.map((sentence, index) => {
      let score = 1.0 / (index + 1); // Position bias
      const lower = sentence.toLowerCase();

      for (const directive of directives) {
        if (lower.includes(directive.toLowerCase())) {
          score += 2.0; // High preservation weight
        }
      }

      // Check for code/path/error cues
      if (/[/\\].+\.[a-zA-Z0-9]+/.test(sentence)) score += 1.0; // File path
      if (/error|failed|exception|rejected/i.test(sentence)) score += 1.5; // Error cue
      if (/status|completed|success|passed/i.test(sentence)) score += 1.0; // Outcome cue

      return { sentence, score, tokens: estimateTokenCount(sentence) };
    });

    // Sort by score descending to pick top sentences
    scored.sort((a, b) => b.score - a.score);

    const selected: string[] = [];
    let currentTokens = 0;

    for (const item of scored) {
      if (currentTokens + item.tokens > maxTokens && selected.length > 0) {
        break;
      }
      selected.push(item.sentence);
      currentTokens += item.tokens;
    }

    return selected.join(' ');
  }

  private extractPreservedClaims(content: string, directives: string[]): string[] {
    const claims: string[] = [];
    const lower = content.toLowerCase();

    for (const d of directives) {
      if (lower.includes(d.toLowerCase())) {
        claims.push(`Preserved directive: ${d}`);
      }
    }

    // Detect error codes or file paths
    const pathMatches = content.match(/([A-Za-z0-9_-]+[/\\][A-Za-z0-9_.-]+)/g);
    if (pathMatches) {
      for (const p of pathMatches.slice(0, 3)) {
        claims.push(`Preserved path: ${p}`);
      }
    }

    return claims;
  }

  private assertNoSecrets(text: string, contextDescription: string): void {
    const scan = RedactionFilter.scanForSecrets(text);
    if (scan.found) {
      throw new MemorySecretDetectedError(
        `058-SEC-07: ${contextDescription} contains prohibited secret/credential data (${scan.secretTypes.join(', ')}). Persistent storage rejected fail-closed.`,
      );
    }
  }
}
