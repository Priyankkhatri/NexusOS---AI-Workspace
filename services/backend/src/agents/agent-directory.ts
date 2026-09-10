import {
  AgentRegistration,
  AgentRegistrationInput,
  AgentRegistrationSchema,
  AgentHeartbeat,
  AgentHeartbeatSchema,
  AgentRole,
  AgentStatus,
} from '@nexusos/contracts';

export interface AgentRecord {
  agentId: string;
  tenantId: string;
  workspaceScope: string[];
  role: AgentRole;
  capabilities: string[];
  version: string;
  metadata: Record<string, string>;
  registeredAt: string;
  lastHeartbeat: string;
  status: AgentStatus;
  currentLoad: number;
  activeTaskIds: string[];
}

export interface AgentDiscoveryQuery {
  tenantId: string;
  workspaceId: string;
  requiredCapabilities?: string[];
  preferredRole?: AgentRole;
}

export interface AgentDirectoryOptions {
  heartbeatTtlMs?: number; // Time after which an agent without heartbeat is marked UNHEALTHY (default 45s)
  maxAgentsPerTenant?: number; // Boundary cap to prevent memory exhaustion (default 50)
}

/**
 * In-Memory Agent Directory Service (Task 060)
 * Manages logical agent registration, heartbeat monitoring, and capability matching under strict tenant isolation (060-SEC-03).
 */
export class AgentDirectoryService {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly heartbeatTtlMs: number;
  private readonly maxAgentsPerTenant: number;

  constructor(options: AgentDirectoryOptions = {}) {
    this.heartbeatTtlMs = options.heartbeatTtlMs ?? 45000;
    this.maxAgentsPerTenant = options.maxAgentsPerTenant ?? 50;
  }

  /**
   * Registers a logical agent in the directory (060-SEC-03)
   */
  public registerAgent(registration: AgentRegistration | AgentRegistrationInput): AgentRecord {
    const validated = AgentRegistrationSchema.parse(registration);

    // Enforce per-tenant capacity limit to avoid resource exhaustion
    const tenantAgents = this.listAgents(validated.tenantId);
    if (
      tenantAgents.length >= this.maxAgentsPerTenant &&
      !this.agents.has(this.getCompositeKey(validated.tenantId, validated.agentId))
    ) {
      throw new Error(
        `Agent registration limit of ${this.maxAgentsPerTenant} exceeded for tenant ${validated.tenantId}.`,
      );
    }

    const key = this.getCompositeKey(validated.tenantId, validated.agentId);
    const existing = this.agents.get(key);

    const record: AgentRecord = {
      agentId: validated.agentId,
      tenantId: validated.tenantId,
      workspaceScope: validated.workspaceScope,
      role: validated.role,
      capabilities: Array.from(new Set(validated.capabilities)),
      version: validated.version,
      metadata: validated.metadata ?? {},
      registeredAt: validated.registeredAt,
      lastHeartbeat: existing?.lastHeartbeat ?? validated.registeredAt,
      status: existing?.status ?? 'AVAILABLE',
      currentLoad: existing?.currentLoad ?? 0,
      activeTaskIds: existing?.activeTaskIds ?? [],
    };

    this.agents.set(key, record);
    return { ...record };
  }

  /**
   * Records a heartbeat ping from an active agent
   */
  public recordHeartbeat(heartbeat: AgentHeartbeat): boolean {
    const validated = AgentHeartbeatSchema.parse(heartbeat);
    const key = this.getCompositeKey(validated.tenantId, validated.agentId);
    const record = this.agents.get(key);

    if (!record) {
      return false; // Agent not registered
    }

    record.lastHeartbeat = validated.timestamp;
    record.status = validated.status;
    record.currentLoad = validated.currentLoad;
    record.activeTaskIds = validated.activeTaskIds;

    return true;
  }

  /**
   * Finds eligible agents matching tenant, workspace, and required capability requirements
   */
  public findEligibleAgents(query: AgentDiscoveryQuery): AgentRecord[] {
    const now = Date.now();
    const results: AgentRecord[] = [];

    for (const record of this.agents.values()) {
      // 1. Strict Tenant Isolation (060-SEC-03)
      if (record.tenantId !== query.tenantId) {
        continue;
      }

      // 2. Workspace Scope Check
      const hasWorkspaceAccess =
        record.workspaceScope.includes('*') || record.workspaceScope.includes(query.workspaceId);
      if (!hasWorkspaceAccess) {
        continue;
      }

      // 3. Heartbeat Freshness Check
      const heartbeatTime = new Date(record.lastHeartbeat).getTime();
      const isStale = now - heartbeatTime > this.heartbeatTtlMs;
      if (isStale) {
        record.status = 'UNHEALTHY';
        continue;
      }

      // 4. Availability Check
      if (record.status !== 'AVAILABLE' && record.status !== 'REGISTERED') {
        continue;
      }

      // 5. Capability Matching
      if (query.requiredCapabilities && query.requiredCapabilities.length > 0) {
        const agentCapSet = new Set(record.capabilities);
        const hasAllCaps = query.requiredCapabilities.every((cap) => agentCapSet.has(cap));
        if (!hasAllCaps) {
          continue;
        }
      }

      // 6. Role Matching (if specified)
      if (query.preferredRole && record.role !== query.preferredRole) {
        continue;
      }

      results.push({ ...record });
    }

    // Sort by lowest load for fair scheduling
    return results.sort((a, b) => a.currentLoad - b.currentLoad);
  }

  /**
   * Gets an agent by ID within a tenant
   */
  public getAgent(tenantId: string, agentId: string): AgentRecord | undefined {
    const key = this.getCompositeKey(tenantId, agentId);
    const record = this.agents.get(key);
    return record ? { ...record } : undefined;
  }

  /**
   * Lists all agents belonging to a tenant (strictly isolated)
   */
  public listAgents(tenantId: string): AgentRecord[] {
    const list: AgentRecord[] = [];
    for (const record of this.agents.values()) {
      if (record.tenantId === tenantId) {
        list.push({ ...record });
      }
    }
    return list;
  }

  /**
   * Marks an agent as retired
   */
  public retireAgent(tenantId: string, agentId: string): boolean {
    const key = this.getCompositeKey(tenantId, agentId);
    const record = this.agents.get(key);
    if (!record) return false;

    record.status = 'RETIRED';
    return true;
  }

  /**
   * Removes stale or retired agents
   */
  public pruneStaleAgents(maxAgeMs = 300000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, record] of this.agents.entries()) {
      const age = now - new Date(record.lastHeartbeat).getTime();
      if (record.status === 'RETIRED' || age > maxAgeMs) {
        this.agents.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  public clear(): void {
    this.agents.clear();
  }

  private getCompositeKey(tenantId: string, agentId: string): string {
    return `${tenantId}::${agentId}`;
  }
}
