import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { Logger } from '@nexusos/backend';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import {
  DesktopAgent,
  loadDesktopAgentConfig,
  AgentLifecycleState,
  DefaultAgentIdentityProvider,
  MockControlPlaneClient,
  ExecutionLeaseBoundary,
  InMemoryLocalStateStore,
} from '../src/index.js';

class StubPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      reason: 'Stub allow',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'stub-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Desktop Agent Orchestrator', () => {
  function createAgent(): DesktopAgent {
    const config = loadDesktopAgentConfig({});
    const identityProvider = new DefaultAgentIdentityProvider();
    const controlPlane = new MockControlPlaneClient();
    const policyEvaluator = new StubPolicyEvaluator();
    const leaseBoundary = new ExecutionLeaseBoundary(policyEvaluator);
    const stateStore = new InMemoryLocalStateStore();
    const logger = new Logger('error');

    return new DesktopAgent(
      config,
      identityProvider,
      controlPlane,
      leaseBoundary,
      stateStore,
      logger,
    );
  }

  it('starts, transitions to READY, and exposes correct lifecycle state', async () => {
    const agent = createAgent();
    assert.strictEqual(agent.lifecycle.getState(), AgentLifecycleState.STOPPED);

    await agent.start();
    assert.strictEqual(agent.lifecycle.getState(), AgentLifecycleState.READY);
    assert.strictEqual(agent.lifecycle.isReady(), true);

    await agent.stop();
    assert.strictEqual(agent.lifecycle.getState(), AgentLifecycleState.STOPPED);
  });

  it('prevents double start', async () => {
    const agent = createAgent();
    await agent.start();

    await assert.rejects(() => agent.start(), /Cannot start DesktopAgent from state/);

    await agent.stop();
  });

  it('graceful stop is idempotent', async () => {
    const agent = createAgent();
    await agent.start();
    await agent.stop();
    // Second stop should not throw
    await agent.stop();
    assert.strictEqual(agent.lifecycle.getState(), AgentLifecycleState.STOPPED);
  });

  it('registers zero capabilities and runtimes at foundation level', async () => {
    const agent = createAgent();
    await agent.start();

    assert.deepStrictEqual(agent.capabilityRegistry.listCapabilities(), []);
    assert.deepStrictEqual(agent.runtimeRegistry.listRuntimes(), []);

    await agent.stop();
  });

  it('sandbox isolation boundary defaults to logical-only in foundation', async () => {
    const agent = createAgent();
    assert.strictEqual(agent.isolationBoundary.isOSIsolationEnforced(), false);
    assert.strictEqual(agent.isolationBoundary.getPolicy().enableLogicalIsolation, true);
  });
});
