import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentLifecycleManager, AgentLifecycleState } from '../src/index.js';

describe('Desktop Agent Lifecycle Manager', () => {
  it('starts in STOPPED state', () => {
    const lifecycle = new AgentLifecycleManager();
    assert.strictEqual(lifecycle.getState(), AgentLifecycleState.STOPPED);
    assert.strictEqual(lifecycle.isReady(), false);
  });

  it('allows valid lifecycle transitions STOPPED -> STARTING -> READY -> STOPPING -> STOPPED', () => {
    const lifecycle = new AgentLifecycleManager();

    lifecycle.transitionTo(AgentLifecycleState.STARTING);
    assert.strictEqual(lifecycle.getState(), AgentLifecycleState.STARTING);

    lifecycle.transitionTo(AgentLifecycleState.READY);
    assert.strictEqual(lifecycle.getState(), AgentLifecycleState.READY);
    assert.strictEqual(lifecycle.isReady(), true);

    lifecycle.transitionTo(AgentLifecycleState.STOPPING);
    assert.strictEqual(lifecycle.getState(), AgentLifecycleState.STOPPING);
    assert.strictEqual(lifecycle.isStoppingOrStopped(), true);

    lifecycle.transitionTo(AgentLifecycleState.STOPPED);
    assert.strictEqual(lifecycle.getState(), AgentLifecycleState.STOPPED);
  });

  it('rejects invalid lifecycle transitions like STOPPED -> READY', () => {
    const lifecycle = new AgentLifecycleManager();
    assert.throws(
      () => lifecycle.transitionTo(AgentLifecycleState.READY),
      /\[InvalidLifecycleTransition\]/,
    );
  });
});
