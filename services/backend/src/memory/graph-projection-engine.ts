import {
  MemoryGraphNode,
  MemoryGraphNodeSchema,
  MemoryGraphEdge,
  MemoryGraphEdgeSchema,
  MemoryGraphQueryRequest,
  MemoryGraphQueryRequestSchema,
  MemoryGraphQueryResponse,
} from '@nexusos/contracts';
import {
  IMemoryStore,
  IGraphProjectionEngine,
  MemoryServiceContext,
  MemorySecurityViolationError,
  MemorySecretDetectedError,
} from './types.js';
import { RedactionFilter } from '../security/redaction-filter.js';
import { Logger } from '../observability/logger.js';

export interface GraphProjectionEngineOptions {
  store: IMemoryStore;
  logger?: Logger;
}

/**
 * Knowledge Graph Projection Engine
 * Projects memory records and episodic relationships into a queryable property graph.
 *
 * GRAPH IS DATA/PROJECTION, NOT AUTHORITY (058-SEC-01).
 * Graph queries enforce strict workspace and tenant isolation (058-SEC-03).
 * Source tombstoning revokes dependent graph projections atomically (058-SEC-05).
 */
export class GraphProjectionEngine implements IGraphProjectionEngine {
  private readonly store: IMemoryStore;
  private readonly logger: Logger;

  constructor(options: GraphProjectionEngineOptions) {
    this.store = options.store;
    this.logger = options.logger ?? new Logger('info');
  }

  public async upsertNode(
    node: MemoryGraphNode,
    ctx: MemoryServiceContext,
  ): Promise<MemoryGraphNode> {
    const validated = MemoryGraphNodeSchema.parse(node);

    // 058-SEC-03: Tenant & Workspace validation
    if (ctx.tenantId !== validated.tenantId || ctx.workspaceId !== validated.workspaceId) {
      throw new MemorySecurityViolationError(
        `058-SEC-03: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot create node in (${validated.tenantId}/${validated.workspaceId}).`,
      );
    }

    // 058-SEC-07: Scan node label and textual properties for secrets
    this.assertNoSecrets(validated.label, 'Graph node label');
    if (validated.properties) {
      for (const [key, val] of Object.entries(validated.properties)) {
        if (typeof val === 'string') {
          this.assertNoSecrets(val, `Graph node property '${key}'`);
        }
      }
    }

    const saved = await this.store.saveGraphNode(validated);
    return saved;
  }

  public async upsertEdge(
    edge: MemoryGraphEdge,
    ctx: MemoryServiceContext,
  ): Promise<MemoryGraphEdge> {
    const validated = MemoryGraphEdgeSchema.parse(edge);

    // 058-SEC-03: Tenant & Workspace validation
    if (ctx.tenantId !== validated.tenantId || ctx.workspaceId !== validated.workspaceId) {
      throw new MemorySecurityViolationError(
        `058-SEC-03: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot create edge in (${validated.tenantId}/${validated.workspaceId}).`,
      );
    }

    if (validated.properties) {
      for (const [key, val] of Object.entries(validated.properties)) {
        if (typeof val === 'string') {
          this.assertNoSecrets(val, `Graph edge property '${key}'`);
        }
      }
    }

    const saved = await this.store.saveGraphEdge(validated);
    return saved;
  }

  /**
   * Access-aware bounded graph traversal.
   * 058-SEC-03: Strict multi-tenant and workspace boundary enforcement.
   * Cross-workspace queries are strictly blocked.
   */
  public async query(
    request: MemoryGraphQueryRequest,
    ctx: MemoryServiceContext,
  ): Promise<MemoryGraphQueryResponse> {
    const validated = MemoryGraphQueryRequestSchema.parse(request);

    // 058-SEC-03: Ensure caller context matches requested tenant & workspace
    if (ctx.tenantId !== validated.tenantId || ctx.workspaceId !== validated.workspaceId) {
      throw new MemorySecurityViolationError(
        `058-SEC-03: Security violation. Caller context (${ctx.tenantId}/${ctx.workspaceId}) cannot query graph in (${validated.tenantId}/${validated.workspaceId}).`,
      );
    }

    // Delegate to store's bounded traversal implementation
    return this.store.queryGraph(validated);
  }

  /**
   * 058-SEC-05: Atomic revocation of graph projections for a tombstoned memory record.
   */
  public async revokeProjectionsForMemory(
    memoryRecordId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<{ revokedNodes: number; revokedEdges: number }> {
    const result = await this.store.revokeGraphForMemory(memoryRecordId, tenantId, workspaceId);
    this.logger.info(`Revoked graph projections for memory record: ${memoryRecordId}`, {
      details: {
        memoryRecordId,
        revokedNodes: result.revokedNodes,
        revokedEdges: result.revokedEdges,
      },
    });
    return result;
  }

  private assertNoSecrets(text: string, contextDescription: string): void {
    const scan = RedactionFilter.scanForSecrets(text);
    if (scan.found) {
      throw new MemorySecretDetectedError(
        `058-SEC-07: Secret or credential detected in ${contextDescription} (${scan.secretTypes.join(', ')}). Persistence rejected.`,
      );
    }
  }
}
