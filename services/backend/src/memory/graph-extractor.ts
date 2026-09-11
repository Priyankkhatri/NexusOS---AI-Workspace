import { createHash } from 'node:crypto';
import {
  MemoryRecord,
  MemoryGraphNodeType,
  MemoryGraphEdgeType,
  MemorySourceType,
  GraphExtractionCandidateNode,
  GraphExtractionCandidateEdge,
  GraphExtractionResult,
  GraphExtractorOptions,
} from '@nexusos/contracts';
import { RedactionFilter } from '../security/redaction-filter.js';
import { IGraphExtractor, MemoryExtractionPayloadExceededError } from './types.js';

const DEFAULT_MAX_INPUT_BYTES = 32 * 1024; // 32,768 bytes (32 KB)
const DEFAULT_MAX_NODES = 20;
const DEFAULT_MAX_EDGES = 30;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_STRICT_SIZE_LIMIT = false;

// Stop words for code identifiers / keywords
const CODE_KEYWORD_STOP_WORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'interface',
  'type',
  'export',
  'import',
  'return',
  'async',
  'await',
  'if',
  'else',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'for',
  'while',
  'do',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'this',
  'super',
  'extends',
  'implements',
  'public',
  'private',
  'protected',
  'static',
  'readonly',
  'abstract',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'any',
  'never',
  'unknown',
  'string',
  'number',
  'boolean',
  'symbol',
  'bigint',
  'object',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'yield',
  'from',
  'as',
  'with',
  'in',
  'of',
]);

// Proper noun stop words (sentence starters / common words)
const PROPER_NOUN_STOP_WORDS = new Set([
  'The',
  'This',
  'That',
  'These',
  'Those',
  'When',
  'Then',
  'After',
  'Before',
  'However',
  'Therefore',
  'There',
  'Here',
  'Where',
  'Which',
  'What',
  'Who',
  'Whom',
  'Whose',
  'Why',
  'How',
  'With',
  'From',
  'Into',
  'Through',
  'During',
  'Above',
  'Below',
  'Under',
  'Again',
  'Further',
  'Once',
  'About',
  'Against',
  'Between',
  'Because',
  'Since',
  'Although',
  'Though',
  'While',
  'Where',
  'Also',
  'Each',
  'Every',
  'Both',
  'Either',
  'Neither',
  'Some',
  'Many',
  'Most',
  'Other',
  'Another',
  'Such',
  'Only',
  'Own',
  'Same',
  'Than',
  'Too',
  'Very',
  'Just',
  'Should',
  'Could',
  'Would',
  'Must',
  'Will',
  'Shall',
  'Can',
  'May',
  'Might',
  'Please',
  'Note',
  'Warning',
  'Error',
  'Info',
  'Notice',
  'Caution',
  'Important',
]);

/**
 * Safely truncate a UTF-8 string at a maximum byte limit without splitting multibyte code points.
 */
function safeUtf8Truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }

  let end = maxBytes;
  // Step backward over continuation bytes (0x80..0xBF)
  while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) {
    end--;
  }

  // If buf[end - 1] is a lead byte, check if the full multibyte character fits
  if (end > 0 && (buf[end - 1] & 0x80) !== 0) {
    const lead = buf[end - 1];
    let seqLen = 1;
    if ((lead & 0xe0) === 0xc0) seqLen = 2;
    else if ((lead & 0xf0) === 0xe0) seqLen = 3;
    else if ((lead & 0xf8) === 0xf0) seqLen = 4;

    if (end - 1 + seqLen > maxBytes) {
      end--; // Exclude the incomplete multibyte lead byte
    }
  }

  return {
    text: buf.subarray(0, end).toString('utf8'),
    truncated: true,
  };
}

/**
 * Normalizes labels for canonical deduplication.
 * Strips whitespace, hyphens, and underscores so e.g. "DatabaseModule", "database-module", "database_module"
 * map to the same canonical key "databasemodule".
 */
export function normalizeToCanonicalKey(label: string): string {
  return label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-_\s]+/g, '')
    .trim();
}

/**
 * Deterministic candidate node ID computation via SHA-256.
 */
function computeNodeCandidateId(
  tenantId: string,
  workspaceId: string,
  recordId: string,
  canonicalKey: string,
): string {
  const hash = createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${recordId}:${canonicalKey}`)
    .digest('hex')
    .slice(0, 16);
  return `cand-node-${hash}`;
}

/**
 * Deterministic candidate edge ID computation via SHA-256.
 */
function computeEdgeCandidateId(
  tenantId: string,
  workspaceId: string,
  recordId: string,
  sourceNodeId: string,
  targetNodeId: string,
  edgeType: string,
): string {
  const hash = createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${recordId}:${sourceNodeId}:${targetNodeId}:${edgeType}`)
    .digest('hex')
    .slice(0, 16);
  return `cand-edge-${hash}`;
}

/**
 * Non-backtracking helper to find semantic cues in a string.
 */
function findSemanticCue(
  sentence: string,
  cues: string[],
): { cue: string; left: string; right: string } | null {
  const lower = sentence.toLowerCase();
  for (const cue of cues) {
    const idx = lower.indexOf(cue);
    if (idx !== -1) {
      return {
        cue: cue.trim(),
        left: sentence.slice(0, idx),
        right: sentence.slice(idx + cue.length),
      };
    }
  }
  return null;
}

/**
 * Internal raw candidate node before clamping and final sorting.
 */
interface RawCandidateNode {
  canonicalKey: string;
  nodeType: MemoryGraphNodeType;
  label: string;
  confidence: number;
  properties: Record<string, unknown>;
}

/**
 * Internal raw candidate edge before clamping and final sorting.
 */
interface RawCandidateEdge {
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: MemoryGraphEdgeType;
  weight: number;
  confidence: number;
  properties: Record<string, unknown>;
}

/**
 * GraphExtractor
 *
 * Deterministic, dependency-free heuristic extraction engine for MemoryRecords.
 * Extracts candidate graph nodes and edges under strict payload and output bounds.
 *
 * 066-P2-SEC-01: Authority Separation (Data proposal only, never execution authority)
 * 066-P2-SEC-02: Tenant/Workspace Isolation (Strict scoping to parent MemoryRecord)
 * 066-P2-SEC-03: Secret Sanitization (Two-phase RedactionFilter scan)
 * 066-P2-SEC-04: Deterministic Extraction (Byte-identical outputs across repeated runs)
 * 066-P2-SEC-05: Payload Bounds & ReDoS Guard (32 KB clamp, max 20 nodes, max 30 edges)
 * 066-P2-SEC-06: Provenance Fidelity (Traceability to source MemoryRecord)
 * 066-P2-SEC-07: Unverified Isolation (verified: false strictly enforced)
 * 066-P2-SEC-08: Adversarial Input Containment (Safe handling of prompt injection/malformed text)
 */
export class GraphExtractor implements IGraphExtractor {
  // Linear-time, non-backtracking regular expressions
  private static readonly FILE_PATH_REGEX =
    /(?:[a-zA-Z]:[\\/]|(?:\/|[a-zA-Z0-9_.-]+[\\/]))[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,10}/g;
  private static readonly URL_REGEX = /\b(?:https?|grpc|ipc|wss?):\/\/[^\s"'<>]+/gi;
  private static readonly ERROR_CODE_REGEX =
    /\b(?:ERR_[A-Z0-9_]{3,30}|STATUS_\d{3}|E[A-Z0-9_]{3,30}|HTTP_\d{3})\b/g;
  private static readonly KEBAB_CASE_REGEX = /\b[a-z0-9]{1,30}(?:-[a-z0-9]{1,30}){1,4}\b/g;
  private static readonly SNAKE_CASE_REGEX = /\b[a-z0-9]{1,30}(?:_[a-z0-9]{1,30}){1,4}\b/g;
  private static readonly CAMEL_CASE_REGEX = /\b[a-z][a-zA-Z0-9]{0,30}[A-Z][a-zA-Z0-9]{0,30}\b/g;
  private static readonly PASCAL_CASE_REGEX = /\b[A-Z][a-zA-Z0-9]{1,30}[A-Z][a-zA-Z0-9]{0,30}\b/g;
  private static readonly BRACKETED_CONCEPT_REGEX = /(?:^|[^!])\[([A-Za-z0-9_\s-]{2,40})\](?!\()/g;
  private static readonly PROPER_NOUN_REGEX =
    /\b[A-Z][a-zA-Z0-9]{1,25}(?:\s+[A-Z][a-zA-Z0-9]{1,25}){1,3}\b/g;

  /**
   * Asynchronous extraction wrapper.
   */
  public async extract(
    record: MemoryRecord,
    options?: GraphExtractorOptions,
  ): Promise<GraphExtractionResult> {
    return this.extractSync(record, options);
  }

  /**
   * Synchronous deterministic extraction engine.
   */
  public extractSync(record: MemoryRecord, options?: GraphExtractorOptions): GraphExtractionResult {
    const startTime = Date.now();

    const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;
    const maxEdges = options?.maxEdges ?? DEFAULT_MAX_EDGES;
    const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const strictSizeLimit = options?.strictSizeLimit ?? DEFAULT_STRICT_SIZE_LIMIT;
    const extractedAt = options?.extractedAt ?? new Date().toISOString();

    // 1. Input Bound & UTF-8 Validation (066-SEC-05)
    const rawContent = record.content ?? '';
    const byteLength = Buffer.byteLength(rawContent, 'utf8');

    let processedContent = rawContent;
    let isTruncated = false;

    if (byteLength > maxInputBytes) {
      if (strictSizeLimit) {
        throw new MemoryExtractionPayloadExceededError(
          `066-SEC-05: Memory record content size (${byteLength} bytes) exceeds maximum extraction limit (${maxInputBytes} bytes).`,
        );
      }
      const truncation = safeUtf8Truncate(rawContent, maxInputBytes);
      processedContent = truncation.text;
      isTruncated = true;
    }

    // 2. Pre-Extraction Secret Sanitization (066-SEC-03)
    if (RedactionFilter.containsSecrets(processedContent)) {
      processedContent = RedactionFilter.redactSecrets(processedContent);
    }
    let sanitizedTitle = record.title ?? '';
    if (RedactionFilter.containsSecrets(sanitizedTitle)) {
      sanitizedTitle = RedactionFilter.redactSecrets(sanitizedTitle);
    }
    const sanitizedTags = (record.tags ?? []).map((t) =>
      RedactionFilter.containsSecrets(t) ? RedactionFilter.redactSecrets(t) : t,
    );

    // 3. Text Normalization & Containment (066-SEC-08)
    // Strip ASCII control characters except \t, \n, \r
    const normalizedText = processedContent
      .normalize('NFKC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 4. Candidate Node Generation Map (canonicalKey -> RawCandidateNode)
    const candidateNodesMap = new Map<string, RawCandidateNode>();

    const addNodeCandidate = (
      canonicalKey: string,
      nodeType: MemoryGraphNodeType,
      label: string,
      confidence: number,
      properties: Record<string, unknown>,
    ): void => {
      if (confidence < minConfidence) return;
      // Exclude empty, whitespace, or redacted labels
      const trimmedLabel = label.trim();
      if (!trimmedLabel || trimmedLabel.length > 256) return;
      if (trimmedLabel.startsWith('[REDACTED_')) return;

      const existing = candidateNodesMap.get(canonicalKey);
      if (!existing || confidence > existing.confidence) {
        candidateNodesMap.set(canonicalKey, {
          canonicalKey,
          nodeType,
          label: trimmedLabel,
          confidence,
          properties,
        });
      }
    };

    // Stage 1: Explicit Metadata (Tags & Title)
    for (const tag of sanitizedTags) {
      const trimmedTag = tag.trim();
      if (trimmedTag.length >= 2 && trimmedTag.length <= 64) {
        const canonicalKey = normalizeToCanonicalKey(trimmedTag);
        addNodeCandidate(
          canonicalKey,
          MemoryGraphNodeType.CONCEPT,
          trimmedTag,
          1.0, // High confidence for explicit author tags
          { category: 'TAG', originalTag: trimmedTag },
        );
      }
    }

    if (sanitizedTitle.trim().length >= 3) {
      const trimmedTitle = sanitizedTitle.trim();
      const canonicalKey = normalizeToCanonicalKey(trimmedTitle);
      addNodeCandidate(canonicalKey, MemoryGraphNodeType.CONCEPT, trimmedTitle, 0.85, {
        category: 'TITLE_CONCEPT',
      });
    }

    // Stage 2: Technical Identifiers (Paths, URLs, Error Codes)
    // File Paths
    const pathMatches = normalizedText.match(GraphExtractor.FILE_PATH_REGEX) || [];
    for (const p of pathMatches) {
      const cleanPath = p.replace(/[.,;:!?)\]'"]+$/, '');
      if (cleanPath.length >= 3) {
        const canonicalKey = normalizeToCanonicalKey(cleanPath);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, cleanPath, 0.95, {
          category: 'FILE_PATH',
        });
      }
    }

    // URLs
    const urlMatches = normalizedText.match(GraphExtractor.URL_REGEX) || [];
    for (const u of urlMatches) {
      const cleanUrl = u.replace(/[.,;:!?)\]'"]+$/, '');
      if (cleanUrl.length >= 5) {
        const canonicalKey = cleanUrl.toLowerCase();
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, cleanUrl, 0.9, {
          category: 'URL',
        });
      }
    }

    // Error Codes
    const errMatches = normalizedText.match(GraphExtractor.ERROR_CODE_REGEX) || [];
    for (const err of errMatches) {
      const cleanErr = err.replace(/[.,;:!?)\]'"]+$/, '');
      const canonicalKey = normalizeToCanonicalKey(cleanErr);
      addNodeCandidate(canonicalKey, MemoryGraphNodeType.ERROR_PATTERN, cleanErr, 0.9, {
        category: 'ERROR_CODE',
      });
    }

    // Stage 3: Code Tokens (kebab-case, snake_case, camelCase, PascalCase)
    const kebabMatches = normalizedText.match(GraphExtractor.KEBAB_CASE_REGEX) || [];
    for (const k of kebabMatches) {
      const cleanK = k.replace(/[.,;:!?)\]'"]+$/, '');
      if (
        cleanK.length >= 4 &&
        cleanK.length <= 64 &&
        !CODE_KEYWORD_STOP_WORDS.has(cleanK.toLowerCase())
      ) {
        const canonicalKey = normalizeToCanonicalKey(cleanK);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, cleanK, 0.8, {
          category: 'CODE_IDENTIFIER',
          style: 'kebab-case',
        });
      }
    }

    const snakeMatches = normalizedText.match(GraphExtractor.SNAKE_CASE_REGEX) || [];
    for (const s of snakeMatches) {
      const cleanS = s.replace(/[.,;:!?)\]'"]+$/, '');
      if (
        cleanS.length >= 4 &&
        cleanS.length <= 64 &&
        !CODE_KEYWORD_STOP_WORDS.has(cleanS.toLowerCase())
      ) {
        // Skip if already captured as error code
        if (cleanS.startsWith('ERR_') || cleanS.startsWith('STATUS_') || cleanS.startsWith('HTTP_'))
          continue;
        const canonicalKey = normalizeToCanonicalKey(cleanS);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, cleanS, 0.8, {
          category: 'CODE_IDENTIFIER',
          style: 'snake_case',
        });
      }
    }

    const camelMatches = normalizedText.match(GraphExtractor.CAMEL_CASE_REGEX) || [];
    for (const c of camelMatches) {
      const cleanC = c.replace(/[.,;:!?)\]'"]+$/, '');
      if (
        cleanC.length >= 3 &&
        cleanC.length <= 64 &&
        !CODE_KEYWORD_STOP_WORDS.has(cleanC.toLowerCase())
      ) {
        const canonicalKey = normalizeToCanonicalKey(cleanC);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, cleanC, 0.8, {
          category: 'CODE_IDENTIFIER',
          style: 'camelCase',
        });
      }
    }

    const pascalMatches = normalizedText.match(GraphExtractor.PASCAL_CASE_REGEX) || [];
    for (const p of pascalMatches) {
      const cleanP = p.replace(/[.,;:!?)\]'"]+$/, '');
      if (
        cleanP.length >= 3 &&
        cleanP.length <= 64 &&
        !CODE_KEYWORD_STOP_WORDS.has(cleanP.toLowerCase())
      ) {
        const canonicalKey = normalizeToCanonicalKey(cleanP);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, cleanP, 0.8, {
          category: 'CODE_IDENTIFIER',
          style: 'PascalCase',
        });
      }
    }

    // Stage 4: Bracketed Markdown Concepts [Concept]
    let bracketMatch: RegExpExecArray | null;
    const bracketRegex = new RegExp(GraphExtractor.BRACKETED_CONCEPT_REGEX);
    while ((bracketMatch = bracketRegex.exec(normalizedText)) !== null) {
      const term = bracketMatch[1]?.trim();
      if (term && term.length >= 2 && term.length <= 40) {
        const canonicalKey = normalizeToCanonicalKey(term);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.CONCEPT, term, 0.8, {
          category: 'BRACKETED_CONCEPT',
        });
      }
    }

    // Stage 5: Capitalized Proper Noun Sequences
    const properMatches = normalizedText.match(GraphExtractor.PROPER_NOUN_REGEX) || [];
    for (const pn of properMatches) {
      const trimmed = pn.trim().replace(/[.,;:!?)\]'"]+$/, '');
      const firstWord = trimmed.split(/\s+/)[0];
      if (firstWord && !PROPER_NOUN_STOP_WORDS.has(firstWord) && trimmed.length >= 4) {
        const canonicalKey = normalizeToCanonicalKey(trimmed);
        addNodeCandidate(canonicalKey, MemoryGraphNodeType.ENTITY, trimmed, 0.75, {
          category: 'PROPER_NOUN',
        });
      }
    }

    // 5. Convert Extracted Raw Nodes to Candidate Nodes
    const candidateNodesList: GraphExtractionCandidateNode[] = [];
    for (const raw of candidateNodesMap.values()) {
      const candidateId = computeNodeCandidateId(
        record.tenantId,
        record.workspaceId,
        record.id,
        raw.canonicalKey,
      );

      // Post-extraction secret sanitization check (066-SEC-03)
      if (RedactionFilter.containsSecrets(raw.label)) {
        continue;
      }

      candidateNodesList.push({
        candidateId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        nodeType: raw.nodeType,
        label: raw.label,
        memoryRecordId: record.id,
        properties: {
          ...raw.properties,
          sensitivity: record.sensitivity,
        },
        confidence: raw.confidence,
        provenance: {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: record.provenance?.creatorPrincipalId ?? 'system',
          sourceId: record.id,
          timestamp: extractedAt,
          verified: false,
        },
      });
    }

    // Sort extracted nodes before clamping:
    // 1. confidence DESC
    // 2. label length DESC
    // 3. candidateId ASC
    candidateNodesList.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.label.length !== a.label.length) return b.label.length - a.label.length;
      return a.candidateId.localeCompare(b.candidateId);
    });

    // Clamp nodes: strictly up to maxNodes (default 20). No synthetic root node.
    const allFinalNodes = candidateNodesList.slice(0, maxNodes);
    // Map for fast membership and edge referential integrity check
    const activeNodeIdSet = new Set(allFinalNodes.map((n) => n.candidateId));

    // 7. Relationship Extraction
    const candidateEdgesMap = new Map<string, RawCandidateEdge>();

    const addEdgeCandidate = (
      sourceNodeId: string,
      targetNodeId: string,
      edgeType: MemoryGraphEdgeType,
      weight: number,
      confidence: number,
      properties: Record<string, unknown>,
    ): void => {
      if (sourceNodeId === targetNodeId) return;
      if (!activeNodeIdSet.has(sourceNodeId) || !activeNodeIdSet.has(targetNodeId)) return;
      if (confidence < minConfidence) return;

      const edgeId = computeEdgeCandidateId(
        record.tenantId,
        record.workspaceId,
        record.id,
        sourceNodeId,
        targetNodeId,
        edgeType,
      );

      const existing = candidateEdgesMap.get(edgeId);
      if (!existing || confidence > existing.confidence) {
        candidateEdgesMap.set(edgeId, {
          sourceNodeId,
          targetNodeId,
          edgeType,
          weight,
          confidence,
          properties,
        });
      }
    };

    // Relationship Extraction: Sentence-Bounded Semantic & Co-Occurrence Derivation
    // Max 50 sentences, max 500 chars per sentence to guarantee strict bounded time (066-SEC-05)
    const sentences = normalizedText
      .split(/(?<=[.?!;\n])\s+/)
      .slice(0, 50)
      .map((s) => s.slice(0, 500));

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      // Find all clamped nodes appearing in this sentence
      const nodesInSentence: GraphExtractionCandidateNode[] = [];
      for (const node of allFinalNodes) {
        if (trimmedSentence.includes(node.label)) {
          nodesInSentence.push(node);
        }
      }

      // Explicit non-backtracking semantic connective cues
      // 1. DERIVED_FROM: "derived from", "based on", "generated from"
      const derivedCue = findSemanticCue(trimmedSentence, [
        ' derived from ',
        ' based on ',
        ' generated from ',
      ]);
      if (derivedCue) {
        for (const n1 of nodesInSentence) {
          for (const n2 of nodesInSentence) {
            if (
              n1.candidateId !== n2.candidateId &&
              derivedCue.left.includes(n1.label) &&
              derivedCue.right.includes(n2.label)
            ) {
              addEdgeCandidate(
                n1.candidateId,
                n2.candidateId,
                MemoryGraphEdgeType.DERIVED_FROM,
                1.0,
                0.85,
                { cue: 'derived_from' },
              );
            }
          }
        }
      }

      // 2. RESOLVED_BY: "fixes", "resolved", "resolves"
      const resolvedCue = findSemanticCue(trimmedSentence, [' fixes ', ' resolved ', ' resolves ']);
      if (resolvedCue) {
        for (const n1 of nodesInSentence) {
          for (const n2 of nodesInSentence) {
            if (
              n1.candidateId !== n2.candidateId &&
              resolvedCue.left.includes(n1.label) &&
              resolvedCue.right.includes(n2.label)
            ) {
              addEdgeCandidate(
                n1.candidateId,
                n2.candidateId,
                MemoryGraphEdgeType.RESOLVED_BY,
                1.0,
                0.85,
                { cue: 'fixes_resolved' },
              );
            }
          }
        }
      }

      // 2. EXECUTED_BY: "executed by", "ran on", "executed on"
      const executedCue = findSemanticCue(trimmedSentence, [
        ' executed by ',
        ' ran on ',
        ' executed on ',
      ]);
      if (executedCue) {
        for (const n1 of nodesInSentence) {
          for (const n2 of nodesInSentence) {
            if (
              n1.candidateId !== n2.candidateId &&
              executedCue.left.includes(n1.label) &&
              executedCue.right.includes(n2.label)
            ) {
              addEdgeCandidate(
                n1.candidateId,
                n2.candidateId,
                MemoryGraphEdgeType.EXECUTED_BY,
                1.0,
                0.85,
                { cue: 'executed_by' },
              );
            }
          }
        }
      }

      // 3. RELATES_TO (depends_on / requires)
      const dependsCue = findSemanticCue(trimmedSentence, [' depends on ', ' requires ']);
      if (dependsCue) {
        for (const n1 of nodesInSentence) {
          for (const n2 of nodesInSentence) {
            if (
              n1.candidateId !== n2.candidateId &&
              dependsCue.left.includes(n1.label) &&
              dependsCue.right.includes(n2.label)
            ) {
              addEdgeCandidate(
                n1.candidateId,
                n2.candidateId,
                MemoryGraphEdgeType.RELATES_TO,
                1.0,
                0.85,
                { relation: 'depends_on' },
              );
            }
          }
        }
      }

      // Co-occurrence RELATES_TO
      if (nodesInSentence.length >= 2 && nodesInSentence.length <= 10) {
        for (let i = 0; i < nodesInSentence.length; i++) {
          for (let j = i + 1; j < nodesInSentence.length; j++) {
            const n1 = nodesInSentence[i]!;
            const n2 = nodesInSentence[j]!;
            // Canonical endpoint ordering for undirected co-occurrence
            const [src, tgt] =
              n1.candidateId < n2.candidateId
                ? [n1.candidateId, n2.candidateId]
                : [n2.candidateId, n1.candidateId];

            addEdgeCandidate(src, tgt, MemoryGraphEdgeType.RELATES_TO, 1.0, 0.7, {
              relation: 'co_occurrence_sentence',
            });
          }
        }
      }
    }

    // 8. Convert Raw Edges to Candidate Edges & Clamp
    const candidateEdgesList: GraphExtractionCandidateEdge[] = [];
    for (const raw of candidateEdgesMap.values()) {
      const candidateId = computeEdgeCandidateId(
        record.tenantId,
        record.workspaceId,
        record.id,
        raw.sourceNodeId,
        raw.targetNodeId,
        raw.edgeType,
      );

      candidateEdgesList.push({
        candidateId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        sourceNodeId: raw.sourceNodeId,
        targetNodeId: raw.targetNodeId,
        edgeType: raw.edgeType,
        weight: raw.weight,
        confidence: raw.confidence,
        properties: {
          ...raw.properties,
          sensitivity: record.sensitivity,
        },
        provenance: {
          sourceType: MemorySourceType.SYSTEM_SYNTHESIS,
          creatorPrincipalId: record.provenance?.creatorPrincipalId ?? 'system',
          sourceId: record.id,
          timestamp: extractedAt,
          verified: false,
        },
      });
    }

    // Sort edges before clamping:
    // 1. confidence DESC
    // 2. weight DESC
    // 3. candidateId ASC
    candidateEdgesList.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.candidateId.localeCompare(b.candidateId);
    });

    const clampedEdges = candidateEdgesList.slice(0, maxEdges);

    // 9. Final Deterministic Output Ordering by candidateId ASC (066-SEC-04)
    allFinalNodes.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
    clampedEdges.sort((a, b) => a.candidateId.localeCompare(b.candidateId));

    // Post-Extraction Fail-Closed Secret Assertion (066-SEC-03)
    for (const node of allFinalNodes) {
      RedactionFilter.assertNoSecrets(node.label, 'Candidate node label');
    }

    const executionDurationMs = Math.max(0, Date.now() - startTime);

    return {
      memoryRecordId: record.id,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      nodes: allFinalNodes,
      edges: clampedEdges,
      truncated: isTruncated,
      extractedAt,
      executionDurationMs,
    };
  }
}
