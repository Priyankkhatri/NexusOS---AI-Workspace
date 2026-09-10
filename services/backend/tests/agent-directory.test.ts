import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { AgentDirectoryService } from '../src/agents/agent-directory.js';

describe('AgentDirectoryService Unit Tests (Task 060)', () => {
  let directory: AgentDirectoryService;
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const workspace1 = crypto.randomUUID();
  const workspace2 = crypto.randomUUID();

  beforeEach(() => {
    directory = new AgentDirectoryService({
      heartbeatTtlMs: 2000,
      maxAgentsPerTenant: 5,
    });
  });

  it('registers an agent and retrieves its profile', () => {
    const reg = {
      agentId: 'specialist-code-01',
      tenantId: tenantA,
      workspaceScope: [workspace1],
      role: 'SPECIALIST' as const,
      capabilities: ['filesystem.readFile', 'filesystem.writeFile'],
      version: '1.0.0',
      metadata: { env: 'local' },
      registeredAt: new Date().toISOString(),
    };

    const record = directory.registerAgent(reg);
    assert.strictEqual(record.agentId, 'specialist-code-01');
    assert.strictEqual(record.status, 'AVAILABLE');

    const fetched = directory.getAgent(tenantA, 'specialist-code-01');
    assert.ok(fetched);
    assert.strictEqual(fetched?.agentId, 'specialist-code-01');
  });

  it('060-SEC-03: enforces strict tenant isolation during discovery and lookup', () => {
    directory.registerAgent({
      agentId: 'agent-tenant-a',
      tenantId: tenantA,
      workspaceScope: ['*'],
      role: 'SPECIALIST',
      capabilities: ['filesystem.readFile'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });

    // Lookup in Tenant A succeeds
    assert.ok(directory.getAgent(tenantA, 'agent-tenant-a'));
    // Lookup in Tenant B returns undefined
    assert.strictEqual(directory.getAgent(tenantB, 'agent-tenant-a'), undefined);

    // Discovery from Tenant B cannot find Tenant A agent
    const discovery = directory.findEligibleAgents({
      tenantId: tenantB,
      workspaceId: workspace1,
      requiredCapabilities: ['filesystem.readFile'],
    });
    assert.strictEqual(discovery.length, 0);
  });

  it('enforces workspace boundary constraints during discovery', () => {
    directory.registerAgent({
      agentId: 'agent-ws1-only',
      tenantId: tenantA,
      workspaceScope: [workspace1],
      role: 'WORKER',
      capabilities: ['filesystem.readFile'],
      version: '1.0.0',
      registeredAt: new Date().toISOString(),
    });

    // Discovery in workspace1 succeeds
    const inWs1 = directory.findEligibleAgents({
      tenantId: tenantA,
      workspaceId: workspace1,
      requiredCapabilities: ['filesystem.readFile'],
    });
    assert.strictEqual(inWs1.length, 1);

    // Discovery in workspace2 fails
    const inWs2 = directory.findEligibleAgents({
      tenantId: tenantA,
      workspaceId: workspace2,
      requiredCapabilities: ['filesystem.readFile'],
    });
    assert.strictEqual(inWs2.length, 0);
  });

  it('records heartbeats and detects stale / unhealthy agents', async () => {
    directory.registerAgent({
      agentId: 'agent-hb-test',
      tenantId: tenantA,
      workspaceScope: ['*'],
      role: 'WORKER',
      capabilities: ['filesystem.readFile'],
      version: '1.0.0',
      registeredAt: new Date(Date.now() - 5000).toISOString(), // 5s ago (stale)
    });

    // Agent has stale initial registration timestamp (> 2000ms TTL)
    const staleList = directory.findEligibleAgents({
      tenantId: tenantA,
      workspaceId: workspace1,
    });
    assert.strictEqual(staleList.length, 0);

    // Record fresh heartbeat
    const recorded = directory.recordHeartbeat({
      agentId: 'agent-hb-test',
      tenantId: tenantA,
      status: 'AVAILABLE',
      currentLoad: 0.1,
      timestamp: new Date().toISOString(),
      activeTaskIds: [],
    });
    assert.strictEqual(recorded, true);

    // Now agent is discovered
    const freshList = directory.findEligibleAgents({
      tenantId: tenantA,
      workspaceId: workspace1,
    });
    assert.strictEqual(freshList.length, 1);
  });

  it('enforces per-tenant capacity limit to prevent memory exhaustion', () => {
    for (let i = 0; i < 5; i++) {
      directory.registerAgent({
        agentId: `agent-cap-${i}`,
        tenantId: tenantA,
        workspaceScope: ['*'],
        role: 'WORKER',
        capabilities: ['filesystem.readFile'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
      });
    }

    assert.throws(() => {
      directory.registerAgent({
        agentId: 'agent-cap-overflow',
        tenantId: tenantA,
        workspaceScope: ['*'],
        role: 'WORKER',
        capabilities: ['filesystem.readFile'],
        version: '1.0.0',
        registeredAt: new Date().toISOString(),
      });
    }, /Agent registration limit of 5 exceeded/);
  });
});
