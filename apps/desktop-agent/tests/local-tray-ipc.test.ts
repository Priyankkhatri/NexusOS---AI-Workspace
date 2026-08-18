import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DesktopAgent } from '../src/agent.js';
import { loadDesktopAgentConfig } from '../src/config/index.js';
import { DefaultAgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { IPCManager } from '../src/ipc/ipc-manager.js';
import type { ExecutionLeaseHeader } from '@nexusos/contracts';

function createDummyLeaseHeader(): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-ipc-v01',
    tenant_id: crypto.randomUUID(),
    scopes: ['approval:present', 'approval:submit'],
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    signature: 'sig-dummy-ipc-v01',
  };
}

class MockControlPlaneClient implements ControlPlaneClient {
  async start() {}
  async registerAgent() {
    return { accepted: true, controlPlaneVersion: '1.0.0' };
  }
  async sendHeartbeat() {
    return true;
  }
  async relayEvent() {
    return { success: true };
  }
  getConnectionState() {
    return 'CONNECTED_ACTIVE' as any;
  }
  async disconnect() {}
}

class MockLeaseBoundary extends ExecutionLeaseBoundary {
  override async validateLease(_header: unknown) {
    return { valid: true };
  }
}

test('IPC Integration - tray.* and approval.* method invocation and agent lifecycle', async () => {
  const config = loadDesktopAgentConfig({});

  const identityProvider = new DefaultAgentIdentityProvider(
    config.deviceId,
    crypto.randomUUID(),
    config.agentVersion,
  );
  const controlPlaneClient = new MockControlPlaneClient();
  const leaseBoundary = new MockLeaseBoundary();
  const stateStore = new InMemoryLocalStateStore();
  const ipcManager = new IPCManager();

  const dummyLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const agent = new DesktopAgent(
    config,
    identityProvider,
    controlPlaneClient,
    leaseBoundary,
    stateStore,
    dummyLogger as any,
    undefined,
    ipcManager,
  );

  const handlers = (ipcManager as any).methodHandlers as Map<
    string,
    (params?: any) => Promise<any>
  >;

  // 1. tray.getStatus
  const getStatusHandler = handlers.get('tray.getStatus')!;
  assert.ok(getStatusHandler);
  const status = await getStatusHandler({});
  assert.equal(status.state, 'CONNECTED');

  // 2. tray.pause & tray.resume
  const pauseHandler = handlers.get('tray.pause')!;
  const resumeHandler = handlers.get('tray.resume')!;

  const paused = await pauseHandler({ reason: 'Testing pause' });
  assert.equal(paused.isPaused, true);
  assert.equal(paused.state, 'PAUSED');

  const resumed = await resumeHandler({});
  assert.equal(resumed.isPaused, false);

  // 3. approval.presentPrompt
  const presentHandler = handlers.get('approval.presentPrompt')!;
  const promptReq = {
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-ipc-01',
    title: 'High Risk File Mutation',
    description: 'Modifying critical system file',
    riskTier: 'HIGH' as const,
    actionIdentifier: 'fs.write',
  };

  const prompt = await presentHandler(promptReq);
  assert.ok(prompt.promptId);
  assert.equal(prompt.state, 'PENDING');

  const updatedStatus = await getStatusHandler({});
  assert.equal(updatedStatus.pendingApprovalCount, 1);
  assert.equal(updatedStatus.state, 'AWAITING_APPROVAL');

  // 4. approval.listPending
  const listPendingHandler = handlers.get('approval.listPending')!;
  const pending = await listPendingHandler({});
  assert.equal(pending.length, 1);
  assert.equal(pending[0].promptId, prompt.promptId);

  // 5. approval.submitDecision
  const submitDecisionHandler = handlers.get('approval.submitDecision')!;
  const decisionRes = await submitDecisionHandler({
    promptId: prompt.promptId,
    decision: 'ALLOW',
    nonce: prompt.nonce,
    leaseHeader: createDummyLeaseHeader(),
  });

  assert.equal(decisionRes.decision, 'ALLOW');
  assert.equal(decisionRes.state, 'APPROVED');

  const finalStatus = await getStatusHandler({});
  assert.equal(finalStatus.pendingApprovalCount, 0);
  assert.equal(finalStatus.state, 'CONNECTED');

  // Graceful shutdown
  await agent.stop();
});
