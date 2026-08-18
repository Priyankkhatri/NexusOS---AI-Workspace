import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopAgent } from '../src/agent.js';
import { DesktopAgentConfig } from '../src/config/index.js';
import { AgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { LocalStateStore } from '../src/state/local-state-store.js';
import { IPCManager } from '../src/ipc/ipc-manager.js';
import type { LeaseHeader } from '../src/permissions/lease-boundary.js';

function createDummyLeaseHeader(): LeaseHeader {
  return {
    lease_id: 'lease-ipc-v01',
    tenant_id: 'tenant-ipc-v01',
    granted_capabilities: ['approval:present', 'approval:submit'],
    expires_at: Date.now() + 3600000,
    signature: 'sig-dummy-ipc-v01',
  };
}

class MockControlPlaneClient implements ControlPlaneClient {
  async connect() {}
  async disconnect() {}
  async sendHeartbeat() {
    return true;
  }
}

class MockLeaseBoundary extends ExecutionLeaseBoundary {
  override async validateLease(_header: LeaseHeader) {
    return { valid: true };
  }
}

test('IPC Integration - tray.* and approval.* method invocation and agent lifecycle', async () => {
  const config = new DesktopAgentConfig({
    agentId: 'agent-tray-ipc-01',
    agentVersion: '1.0.0',
    environment: 'development',
    heartbeatIntervalMs: 60000,
    maxConcurrentTasks: 5,
    storagePath: './tmp-ipc-test',
  });

  const identityProvider = new AgentIdentityProvider(config);
  const controlPlaneClient = new MockControlPlaneClient();
  const leaseBoundary = new MockLeaseBoundary();
  const stateStore = new LocalStateStore('./tmp-ipc-test');
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

  // 1. tray.getStatus
  const status = (await ipcManager.handleRPCRequest('tray.getStatus', {})) as any;
  assert.equal(status.state, 'CONNECTED');

  // 2. tray.pause & tray.resume
  const paused = (await ipcManager.handleRPCRequest('tray.pause', { reason: 'Testing pause' })) as any;
  assert.equal(paused.isPaused, true);
  assert.equal(paused.state, 'PAUSED');

  const resumed = (await ipcManager.handleRPCRequest('tray.resume', {})) as any;
  assert.equal(resumed.isPaused, false);

  // 3. approval.presentPrompt
  const promptReq = {
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-ipc-01',
    title: 'High Risk File Mutation',
    description: 'Modifying critical system file',
    riskTier: 'HIGH' as const,
    actionIdentifier: 'fs.write',
  };

  const prompt = (await ipcManager.handleRPCRequest('approval.presentPrompt', promptReq)) as any;
  assert.ok(prompt.promptId);
  assert.equal(prompt.state, 'PENDING');

  const updatedStatus = (await ipcManager.handleRPCRequest('tray.getStatus', {})) as any;
  assert.equal(updatedStatus.pendingApprovalCount, 1);
  assert.equal(updatedStatus.state, 'AWAITING_APPROVAL');

  // 4. approval.listPending
  const pending = (await ipcManager.handleRPCRequest('approval.listPending', {})) as any[];
  assert.equal(pending.length, 1);
  assert.equal(pending[0].promptId, prompt.promptId);

  // 5. approval.submitDecision
  const decisionRes = (await ipcManager.handleRPCRequest('approval.submitDecision', {
    promptId: prompt.promptId,
    decision: 'ALLOW',
    nonce: prompt.nonce,
    leaseHeader: createDummyLeaseHeader(),
  })) as any;

  assert.equal(decisionRes.decision, 'ALLOW');
  assert.equal(decisionRes.state, 'APPROVED');

  const finalStatus = (await ipcManager.handleRPCRequest('tray.getStatus', {})) as any;
  assert.equal(finalStatus.pendingApprovalCount, 0);
  assert.equal(finalStatus.state, 'CONNECTED');

  // Graceful shutdown
  await agent.stop();
});
