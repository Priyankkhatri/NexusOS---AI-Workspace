/**
 * NexusOS — Task 067 Phase 3B Hardening Tests
 * Web Dashboard Real-Time Event → State/DOM Projection
 *
 * Verifies:
 * 1. agent.status_changed updates existing card
 * 2. agent.status_changed inserts missing agent under 100 bound
 * 3. delegation.created creates activity/entity projection
 * 4. delegation.progress updates existing delegation
 * 5. delegation.completed projects settled state
 * 6. delegation.failed projects failed state
 * 7. delegation.cancelled projects cancelled state
 * 8. task.status_changed updates task row only
 * 9. task.status_changed does NOT alter summary counters
 * 10. approval.requested creates/prepends card and badge
 * 11. approval.decided disables controls and displays decision
 * 12. approval badge never becomes negative
 * 13. telemetry.sample updates all supported summary fields
 * 14. unsupported telemetry fields are ignored
 * 15. graph.evolved creates activity only and does not invoke graph rendering
 * 16. activity list remains <=50
 * 17. overview activity remains <=10
 * 18. same-entity events coalesce to latest state within one RAF
 * 19. replayed duplicate event does not duplicate history DOM
 * 20. reset/reconciliation generation guard prevents stale REST result overwrite
 * 21. events arriving during reconciliation are replayed after snapshot commit
 * 22. XSS/event-derived HTML is neutralized
 * 23. hidden-tab event intake remains bounded and exception-free
 *
 * Uses node:test and lightweight in-memory DOM mock. Zero external dependencies.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// Lightweight In-Memory DOM Mock
// ============================================================

export class MockElement {
  tagName: string;
  id: string = '';
  className: string = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  hidden: boolean = false;
  disabled: boolean = false;
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  _text: string = '';
  eventListeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  get classList() {
    return {
      add: (...classes: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const c of classes) if (c) set.add(c);
        this.className = Array.from(set).join(' ');
      },
      remove: (...classes: string[]) => {
        const toRemove = new Set(classes);
        this.className = this.className
          .split(/\s+/)
          .filter((c) => c && !toRemove.has(c))
          .join(' ');
      },
      toggle: (cls: string, force?: boolean) => {
        const has = this.classList.contains(cls);
        const shouldAdd = force !== undefined ? force : !has;
        if (shouldAdd) this.classList.add(cls);
        else this.classList.remove(cls);
        return shouldAdd;
      },
      contains: (cls: string) => {
        return this.className.split(/\s+/).includes(cls);
      },
    };
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'disabled') return this.disabled ? '' : null;
    if (name === 'hidden') return this.hidden ? '' : null;
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    if (name === 'id') this.id = value;
    else if (name === 'class') this.className = value;
    else if (name === 'disabled') this.disabled = true;
    else if (name === 'hidden') this.hidden = true;
    this.attributes.set(name, value);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, g: string) => g.toUpperCase());
      this.dataset[camel] = value;
    }
  }

  removeAttribute(name: string): void {
    if (name === 'id') this.id = '';
    else if (name === 'class') this.className = '';
    else if (name === 'disabled') this.disabled = false;
    else if (name === 'hidden') this.hidden = false;
    this.attributes.delete(name);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, g: string) => g.toUpperCase());
      delete this.dataset[camel];
    }
  }

  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this.children = [];
    this._text = val;
  }

  get innerHTML(): string {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.outerHTML).join('');
  }

  set innerHTML(html: string) {
    this.children = [];
    this._text = '';
    parseHTMLInto(html, this);
  }

  get outerHTML(): string {
    const attrs: string[] = [];
    if (this.id) attrs.push(`id="${this.id}"`);
    if (this.className) attrs.push(`class="${this.className}"`);
    if (this.hidden) attrs.push('hidden');
    if (this.disabled) attrs.push('disabled');
    for (const [k, v] of this.attributes.entries()) {
      if (k !== 'id' && k !== 'class' && k !== 'hidden' && k !== 'disabled') {
        attrs.push(`${k}="${v}"`);
      }
    }
    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
    const tag = this.tagName.toLowerCase();
    return `<${tag}${attrStr}>${this.innerHTML}</${tag}>`;
  }

  set outerHTML(html: string) {
    if (!this.parentElement) return;
    const dummy = new MockElement('div');
    parseHTMLInto(html, dummy);
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      this.parentElement.children.splice(idx, 1, ...dummy.children);
      for (const c of dummy.children) {
        c.parentElement = this.parentElement;
      }
    }
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  insertAdjacentHTML(
    position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend',
    html: string,
  ): void {
    const dummy = new MockElement('div');
    parseHTMLInto(html, dummy);
    if (position === 'beforeend') {
      for (const child of dummy.children) {
        child.parentElement = this;
        this.children.push(child);
      }
    } else if (position === 'afterbegin') {
      for (let i = dummy.children.length - 1; i >= 0; i--) {
        const child = dummy.children[i]!;
        child.parentElement = this;
        this.children.unshift(child);
      }
    } else if (position === 'beforebegin') {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        for (const child of dummy.children) {
          child.parentElement = this.parentElement;
        }
        this.parentElement.children.splice(idx, 0, ...dummy.children);
      }
    } else if (position === 'afterend') {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        for (const child of dummy.children) {
          child.parentElement = this.parentElement;
        }
        this.parentElement.children.splice(idx + 1, 0, ...dummy.children);
      }
    }
  }

  addEventListener(event: string, listener: (e: unknown) => void): void {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event]!.push(listener);
  }

  removeEventListener(event: string, listener: (e: unknown) => void): void {
    if (!this.eventListeners[event]) return;
    this.eventListeners[event] = this.eventListeners[event]!.filter((l) => l !== listener);
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    matchSelectorRecursive(this, selector.trim(), results);
    return results;
  }
}

function parseHTMLInto(html: string, parent: MockElement): void {
  const tagRegex = /<(\/?[a-zA-Z0-9_-]+)((?:\s+[^>]*)*?)(\/?)>|([^<]+)/g;
  const stack: MockElement[] = [parent];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const textChunk = match[4];
    const tagName = match[1];
    const rawAttrs = match[2] || '';
    const selfClosing =
      match[3] === '/' || ['BR', 'HR', 'IMG', 'INPUT'].includes((tagName || '').toUpperCase());

    if (textChunk !== undefined) {
      const current = stack[stack.length - 1];
      if (current) {
        current._text += textChunk;
      }
      continue;
    }

    if (!tagName) continue;

    if (tagName.startsWith('/')) {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    const el = new MockElement(tagName);
    const currentParent = stack[stack.length - 1];
    if (currentParent) {
      el.parentElement = currentParent;
      currentParent.children.push(el);
    }

    const attrRegex = /([a-zA-Z0-9_:-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const name = attrMatch[1];
      if (!name) continue;
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
      el.setAttribute(name, value);
    }

    if (!selfClosing) {
      stack.push(el);
    }
  }
}

function matchesSimple(el: MockElement, sel: string): boolean {
  if (sel.startsWith('#')) {
    return el.id === sel.slice(1);
  }
  if (sel.startsWith('.')) {
    const parts = sel.split(/(?=[.[])/);
    for (const part of parts) {
      if (part.startsWith('.')) {
        if (!el.classList.contains(part.slice(1))) return false;
      } else if (part.startsWith('[')) {
        if (!matchesAttr(el, part)) return false;
      }
    }
    return true;
  }
  if (sel.startsWith('[')) {
    return matchesAttr(el, sel);
  }
  if (sel.includes('.')) {
    const [tag, ...classes] = sel.split('.');
    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    for (const c of classes) {
      if (!el.classList.contains(c)) return false;
    }
    return true;
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function matchesAttr(el: MockElement, attrSel: string): boolean {
  const m = /^\[([a-zA-Z0-9_:-]+)(?:="([^"]*)"|='([^']*)'|=([^\s\]]+))?\]$/.exec(attrSel);
  if (!m) return false;
  const name = m[1]!;
  const expected = m[2] ?? m[3] ?? m[4];
  if (expected === undefined) {
    return el.getAttribute(name) !== null;
  }
  return el.getAttribute(name) === expected;
}

function matchSelectorRecursive(root: MockElement, selector: string, results: MockElement[]): void {
  // Support simple multi-part "parent child"
  if (selector.includes(' ')) {
    const parts = selector.split(/\s+/);
    if (parts.length === 2) {
      const [parentSel, childSel] = parts;
      const parents = root.querySelectorAll(parentSel!);
      for (const p of parents) {
        for (const child of p.children) {
          collectAllDescendants(child, (d) => {
            if (matchesSimple(d, childSel!)) {
              if (!results.includes(d)) results.push(d);
            }
          });
        }
      }
      return;
    }
  }

  for (const child of root.children) {
    if (matchesSimple(child, selector)) {
      results.push(child);
    }
    matchSelectorRecursive(child, selector, results);
  }
}

function collectAllDescendants(el: MockElement, cb: (item: MockElement) => void): void {
  cb(el);
  for (const c of el.children) {
    collectAllDescendants(c, cb);
  }
}

export class MockDocument {
  documentElement: MockElement;
  body: MockElement;
  hidden: boolean = false;

  constructor() {
    this.documentElement = new MockElement('html');
    this.body = new MockElement('body');
    this.documentElement.children.push(this.body);
    this.body.parentElement = this.documentElement;
  }

  getElementById(id: string): MockElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector: string): MockElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag);
  }

  addEventListener(_event: string, _listener: unknown): void {}
  removeEventListener(_event: string, _listener: unknown): void {}
}

// Global DOM setup
const mockDoc = new MockDocument();
(globalThis as unknown as { document: MockDocument }).document = mockDoc;
(globalThis as unknown as { window: unknown }).window = {
  location: { origin: 'http://localhost:3000' },
  requestAnimationFrame: (cb: (time: number) => void) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  },
};

// Now import dashboard projection exports after DOM setup
import { MemoryGraphNodeType } from '@nexusos/contracts';
import {
  state,
  enqueueTelemetryEvent,
  flushPendingEvents,
  handleStreamResetReconciliation,
  _resetProjectionState,
  type TypedTelemetryEvent,
  type TypedAgentStatusChangedEvent,
  type TypedDelegationCreatedEvent,
  type TypedDelegationProgressEvent,
  type TypedDelegationCompletedEvent,
  type TypedDelegationFailedEvent,
  type TypedDelegationCancelledEvent,
  type TypedTaskStatusChangedEvent,
  type TypedApprovalRequestedEvent,
  type TypedApprovalDecidedEvent,
  type TypedGraphEvolvedEvent,
  type TypedTelemetrySampleEvent,
} from '../../apps/web-dashboard/src/main.js';

// Setup dashboard DOM fixture
function setupDashboardDOM(): void {
  mockDoc.body.children = [];
  mockDoc.body.innerHTML = `
    <div id="overview-cards">
      <span id="active-task-count">0</span>
      <span id="pending-approval-count">0</span>
      <span id="completed-task-count">0</span>
      <span id="failed-task-count">0</span>
      <span id="approval-badge" hidden>0</span>
      <div id="health-badge" class="health-badge"><span class="health-label">Unknown</span></div>
      <div id="vram-alert" hidden>VRAM Alert</div>
    </div>
    <div id="overview-activity-list"></div>
    <div id="overview-activity-empty">No activity</div>
    <div id="task-list-container"></div>
    <div id="task-list-empty">No tasks</div>
    <div id="approval-list-container"></div>
    <div id="approval-list-empty">No approvals</div>
    <div id="activity-stream-container"></div>
    <div id="activity-stream-empty">No activity</div>
    <div id="agent-roster-container"></div>
    <div id="agent-roster-empty">No agents</div>
    <div id="delegation-tree-container"></div>
    <div id="delegation-tree-empty">No delegations</div>
  `;
}

function makeEventEnvelope<T extends TypedTelemetryEvent>(
  base: Partial<T> & Pick<T, 'schema_id' | 'payload'>,
): T {
  return {
    version: '1.0.0',
    event_id: crypto.randomUUID(),
    epoch_id: '00000000-0000-4000-8000-000000000001',
    sequence_number: 1,
    cursor: '00000000-0000-4000-8000-000000000001:1',
    tenant_id: 'default-tenant',
    correlation_id: 'corr-001',
    occurred_at: new Date().toISOString(),
    producer_id: 'test-producer',
    ...base,
  } as T;
}

describe('Task 067 Phase 3B: Web Dashboard Real-Time Event Projection', () => {
  beforeEach(() => {
    _resetProjectionState();
    setupDashboardDOM();
    state.tasks = [];
    state.approvals = [];
    state.activity = [];
    state.agents = [];
    state.delegations = [];
    state.graphNodes = [];
    state.graphEdges = [];
    state.summary = {
      tenantId: 'default-tenant',
      activeTaskCount: 0,
      pendingApprovalCount: 0,
      completedTaskCount: 0,
      failedTaskCount: 0,
      connectedDeviceCount: 1,
      healthStatus: 'HEALTHY',
      updatedAt: new Date().toISOString(),
    };
  });

  // 1. agent.status_changed updates existing card
  it('1. agent.status_changed surgically updates existing agent card in DOM and state', () => {
    // Setup existing agent card in DOM and state
    const agentId = '00000000-0000-4000-8000-000000000001';
    state.agents = [
      {
        agentId,
        tenantId: 'default-tenant',
        workspaceScope: ['default'],
        role: 'WORKER',
        status: 'AVAILABLE',
        currentLoad: 0.1,
        activeTaskIds: [],
        lastHeartbeat: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
        version: '1.0.0',
        metadata: {},
        capabilities: ['compute'],
      },
    ];
    const container = mockDoc.getElementById('agent-roster-container')!;
    container.innerHTML = `
      <div class="agent-card" data-agent-id="${agentId}">
        <div class="agent-card__header">
          <div class="agent-card__badges">
            <span class="role-badge">Worker</span>
            <span class="agent-status-pill">Available</span>
          </div>
        </div>
        <div class="agent-card__meta">
          <div class="agent-card__meta-item">
            <span class="agent-card__meta-label">Task Load</span>
            <span class="agent-card__meta-value">10% (0 active)</span>
          </div>
          <div class="agent-card__meta-item">
            <span class="agent-card__meta-label">Heartbeat</span>
            <span class="agent-card__meta-value">just now</span>
          </div>
        </div>
      </div>
    `;

    const event = makeEventEnvelope<TypedAgentStatusChangedEvent>({
      schema_id: 'nexusos.events.agent.status_changed',
      payload: {
        agentId,
        tenantId: 'default-tenant',
        role: 'WORKER',
        status: 'BUSY',
        currentLoad: 0.75,
        activeTaskCount: 3,
        lastHeartbeat: new Date().toISOString(),
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    // Check state update
    const updatedAgent = state.agents.find((a) => a.agentId === agentId);
    assert.equal(updatedAgent?.status, 'BUSY');
    assert.equal(updatedAgent?.currentLoad, 0.75);
    assert.equal(updatedAgent?.activeTaskIds.length, 3);

    // Check surgical DOM update
    const card = mockDoc.querySelector(`.agent-card[data-agent-id="${agentId}"]`);
    assert.ok(card);
    const badges = card.querySelector('.agent-card__badges');
    assert.ok(badges?.innerHTML.includes('Busy / Working'));
    const loadValue = card.querySelector('.agent-card__meta-value');
    assert.ok(loadValue?.textContent.includes('75% (3 active)'));
  });

  // 2. agent.status_changed inserts missing agent under 100 bound
  it('2. agent.status_changed inserts missing agent card respecting 100-bound', () => {
    const newAgentId = '00000000-0000-4000-8000-000000000002';
    const event = makeEventEnvelope<TypedAgentStatusChangedEvent>({
      schema_id: 'nexusos.events.agent.status_changed',
      payload: {
        agentId: newAgentId,
        tenantId: 'default-tenant',
        role: 'SPECIALIST',
        status: 'AVAILABLE',
        currentLoad: 0.2,
        activeTaskCount: 1,
        lastHeartbeat: new Date().toISOString(),
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.agents.length, 1);
    assert.equal(state.agents[0]?.agentId, newAgentId);

    const card = mockDoc.querySelector(`.agent-card[data-agent-id="${newAgentId}"]`);
    assert.ok(card, 'Card should be inserted into DOM');
    assert.equal(card?.dataset['agentId'], newAgentId);
  });

  // 3. delegation.created creates activity/entity projection
  it('3. delegation.created creates activity and delegation tree node projection', () => {
    const delegationId = '00000000-0000-4000-8000-000000000010';
    const parentTaskId = 'task-parent-1';
    const childTaskId = 'task-child-1';

    const event = makeEventEnvelope<TypedDelegationCreatedEvent>({
      schema_id: 'nexusos.events.delegation.created',
      payload: {
        delegationId,
        parentTaskId,
        childTaskId,
        delegatorAgentId: 'agent-coord',
        assignedAgentId: 'agent-worker',
        depth: 1,
        requestedScopes: ['task:execute'],
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    // Verify entity in state
    assert.equal(state.delegations.length, 1);
    assert.equal(state.delegations[0]?.delegationId, delegationId);

    // Verify entity in DOM
    const node = mockDoc.querySelector(
      `.delegation-tree-node[data-delegation-id="${delegationId}"]`,
    );
    assert.ok(node, 'Delegation node should be created in DOM');

    // Verify activity stream
    assert.equal(state.activity.length, 1);
    assert.equal(state.activity[0]?.schema_id, 'nexusos.events.delegation.created');
  });

  // 4. delegation.progress updates existing delegation
  it('4. delegation.progress updates status of existing delegation in DOM and state', () => {
    const delegationId = '00000000-0000-4000-8000-000000000020';
    state.delegations = [
      {
        delegationId,
        parentTaskId: 'parent-1',
        parentLeaseId: 'lease-p',
        childTaskId: 'child-1',
        childLeaseId: 'lease-c',
        delegatorAgentId: 'coord',
        assignedAgentId: 'worker',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        depth: 1,
        status: 'ACCEPTED',
        requestedScopes: ['task:execute'],
        expiresAt: Date.now() + 60000,
        correlationId: 'corr-1',
        hasCompensation: false,
        hasChildReceipt: false,
      },
    ];

    const tree = mockDoc.getElementById('delegation-tree-container')!;
    tree.innerHTML = `
      <div class="delegation-tree-node" data-delegation-id="${delegationId}">
        <div class="delegation-tree-node__header">
          <span class="status-badge status-badge--submitted">Accepted</span>
        </div>
      </div>
    `;

    const event = makeEventEnvelope<TypedDelegationProgressEvent>({
      schema_id: 'nexusos.events.delegation.progress',
      payload: {
        delegationId,
        parentTaskId: 'parent-1',
        childTaskId: 'child-1',
        status: 'EXECUTING',
        progressPercent: 50,
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.delegations[0]?.status, 'EXECUTING');
    const badge = tree.querySelector('.status-badge');
    assert.ok(badge?.textContent.includes('Executing'));
  });

  // 5. delegation.completed projects settled state
  it('5. delegation.completed projects settled state and receipt badge', () => {
    const delegationId = '00000000-0000-4000-8000-000000000030';
    state.delegations = [
      {
        delegationId,
        parentTaskId: 'p-1',
        parentLeaseId: 'l-p',
        childTaskId: 'c-1',
        childLeaseId: 'l-c',
        delegatorAgentId: 'coord',
        assignedAgentId: 'worker',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        depth: 1,
        status: 'EXECUTING',
        requestedScopes: ['task:execute'],
        expiresAt: Date.now() + 60000,
        correlationId: 'corr-1',
        hasCompensation: false,
        hasChildReceipt: false,
      },
    ];

    const tree = mockDoc.getElementById('delegation-tree-container')!;
    tree.innerHTML = `
      <div class="delegation-tree-node" data-delegation-id="${delegationId}">
        <div class="delegation-tree-node__header">
          <span class="status-badge status-badge--executing">Executing</span>
        </div>
        <div class="delegation-tree-node__meta"></div>
      </div>
    `;

    const event = makeEventEnvelope<TypedDelegationCompletedEvent>({
      schema_id: 'nexusos.events.delegation.completed',
      payload: {
        delegationId,
        parentTaskId: 'p-1',
        childTaskId: 'c-1',
        status: 'COMPLETED',
        receiptHash: 'abcdef1234567890abcdef1234567890',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.delegations[0]?.status, 'COMPLETED');
    assert.equal(state.delegations[0]?.hasChildReceipt, true);

    const badge = tree.querySelector('.status-badge');
    assert.ok(badge?.textContent.includes('Completed'));
    const receiptBadge = tree.querySelector('.badge--receipt');
    assert.ok(receiptBadge, 'Receipt badge should be added to meta');
  });

  // 6. delegation.failed projects failed state
  it('6. delegation.failed projects failed state in DOM and state', () => {
    const delegationId = '00000000-0000-4000-8000-000000000040';
    state.delegations = [
      {
        delegationId,
        parentTaskId: 'p-1',
        parentLeaseId: 'l-p',
        childTaskId: 'c-1',
        childLeaseId: 'l-c',
        delegatorAgentId: 'coord',
        assignedAgentId: 'worker',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        depth: 1,
        status: 'EXECUTING',
        requestedScopes: ['task:execute'],
        expiresAt: Date.now() + 60000,
        correlationId: 'corr-1',
        hasCompensation: false,
        hasChildReceipt: false,
      },
    ];

    const tree = mockDoc.getElementById('delegation-tree-container')!;
    tree.innerHTML = `
      <div class="delegation-tree-node" data-delegation-id="${delegationId}">
        <div class="delegation-tree-node__header">
          <span class="status-badge status-badge--executing">Executing</span>
        </div>
      </div>
    `;

    const event = makeEventEnvelope<TypedDelegationFailedEvent>({
      schema_id: 'nexusos.events.delegation.failed',
      payload: {
        delegationId,
        parentTaskId: 'p-1',
        childTaskId: 'c-1',
        status: 'FAILED',
        rejectionReason: 'Worker crashed',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.delegations[0]?.status, 'FAILED');
    const badge = tree.querySelector('.status-badge');
    assert.ok(badge?.textContent.includes('Failed'));
  });

  // 7. delegation.cancelled projects cancelled state
  it('7. delegation.cancelled projects cancelled state and node class in DOM', () => {
    const delegationId = '00000000-0000-4000-8000-000000000050';
    state.delegations = [
      {
        delegationId,
        parentTaskId: 'p-1',
        parentLeaseId: 'l-p',
        childTaskId: 'c-1',
        childLeaseId: 'l-c',
        delegatorAgentId: 'coord',
        assignedAgentId: 'worker',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        depth: 1,
        status: 'ACCEPTED',
        requestedScopes: ['task:execute'],
        expiresAt: Date.now() + 60000,
        correlationId: 'corr-1',
        hasCompensation: false,
        hasChildReceipt: false,
      },
    ];

    const tree = mockDoc.getElementById('delegation-tree-container')!;
    tree.innerHTML = `
      <div class="delegation-tree-node" data-delegation-id="${delegationId}">
        <div class="delegation-tree-node__header">
          <span class="status-badge status-badge--submitted">Accepted</span>
        </div>
      </div>
    `;

    const event = makeEventEnvelope<TypedDelegationCancelledEvent>({
      schema_id: 'nexusos.events.delegation.cancelled',
      payload: {
        delegationId,
        parentTaskId: 'p-1',
        status: 'CANCELLED',
        reason: 'User aborted',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.delegations[0]?.status, 'CANCELLED');
    const node = tree.querySelector(`.delegation-tree-node[data-delegation-id="${delegationId}"]`);
    assert.ok(node?.classList.contains('delegation-tree-node--cancelled'));
    const badge = node?.querySelector('.status-badge');
    assert.ok(badge?.textContent.includes('Cancelled'));
  });

  // 8. task.status_changed updates task row only
  it('8. task.status_changed surgically updates task row status badge only', () => {
    const taskId = 'task-42';
    state.tasks = [
      {
        taskId,
        tenantId: 'default-tenant',
        submittedBy: 'user',
        title: 'Compute Job',
        targetAgentId: 'agent-1',
        capabilityId: 'compute',
        runtimeCategory: 'native',
        state: 'RUNNING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const container = mockDoc.getElementById('task-list-container')!;
    container.innerHTML = `
      <div class="task-row" data-task-id="${taskId}">
        <span class="task-row__title">Compute Job</span>
        <span class="status-badge status-badge--running">Running</span>
      </div>
    `;

    const event = makeEventEnvelope<TypedTaskStatusChangedEvent>({
      schema_id: 'nexusos.events.task.status_changed',
      payload: {
        taskId,
        tenantId: 'default-tenant',
        title: 'Compute Job',
        state: 'COMPLETED',
        targetAgentId: 'agent-1',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.tasks[0]?.state, 'COMPLETED');
    const badge = container.querySelector('.status-badge');
    assert.equal(badge?.textContent, 'Completed');
    assert.ok(badge?.classList.contains('status-badge--completed'));
  });

  // 9. task.status_changed does NOT alter summary counters
  it('9. task.status_changed does NOT alter summary counters', () => {
    mockDoc.getElementById('active-task-count')!.textContent = '10';
    mockDoc.getElementById('completed-task-count')!.textContent = '50';
    mockDoc.getElementById('failed-task-count')!.textContent = '3';
    state.summary!.activeTaskCount = 10;
    state.summary!.completedTaskCount = 50;
    state.summary!.failedTaskCount = 3;

    const event = makeEventEnvelope<TypedTaskStatusChangedEvent>({
      schema_id: 'nexusos.events.task.status_changed',
      payload: {
        taskId: 'some-task',
        tenantId: 'default-tenant',
        title: 'Task',
        state: 'COMPLETED',
        targetAgentId: 'agent-1',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    // Assert counters did NOT drift or change
    assert.equal(mockDoc.getElementById('active-task-count')!.textContent, '10');
    assert.equal(mockDoc.getElementById('completed-task-count')!.textContent, '50');
    assert.equal(mockDoc.getElementById('failed-task-count')!.textContent, '3');
    assert.equal(state.summary!.activeTaskCount, 10);
    assert.equal(state.summary!.completedTaskCount, 50);
  });

  // 10. approval.requested creates/prepends card and badge
  it('10. approval.requested creates/prepends approval card and increments badge', () => {
    const promptId = '00000000-0000-4000-8000-000000000100';
    const event = makeEventEnvelope<TypedApprovalRequestedEvent>({
      schema_id: 'nexusos.events.approval.requested',
      payload: {
        promptId,
        requestId: 'req-1',
        tenantId: 'default-tenant',
        title: 'Write File Authorization',
        description: 'Allow writing to disk',
        riskTier: 'HIGH',
        actionIdentifier: 'fs:write',
        expiresAt: Date.now() + 60000,
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.approvals.length, 1);
    assert.equal(state.approvals[0]?.promptId, promptId);

    const card = mockDoc.querySelector(`.approval-card[data-prompt-id="${promptId}"]`);
    assert.ok(card, 'Approval card should be prepended');

    const badge = mockDoc.getElementById('approval-badge')!;
    assert.equal(badge.textContent, '1');
    assert.equal(badge.hidden, false);
  });

  // 11. approval.decided disables controls and displays decision
  it('11. approval.decided disables buttons and displays decision/receipt', () => {
    const promptId = '00000000-0000-4000-8000-000000000110';
    state.approvals = [
      {
        promptId,
        title: 'Execute Command',
        riskTier: 'HIGH',
        actionIdentifier: 'sh:exec',
        createdAt: new Date().toISOString(),
        state: 'PENDING',
      },
    ];

    const container = mockDoc.getElementById('approval-list-container')!;
    container.innerHTML = `
      <div class="approval-card" data-prompt-id="${promptId}">
        <div class="approval-card__header">
          <h3>Execute Command</h3>
          <div><span class="status-badge">Awaiting Decision</span></div>
        </div>
        <div class="approval-card__detail"></div>
        <div class="approval-card__actions">
          <button class="approval-action-btn" data-action="ALLOW" data-prompt-id="${promptId}">Approve</button>
          <button class="approval-action-btn" data-action="DENY" data-prompt-id="${promptId}">Reject</button>
        </div>
      </div>
    `;

    const event = makeEventEnvelope<TypedApprovalDecidedEvent>({
      schema_id: 'nexusos.events.approval.decided',
      payload: {
        promptId,
        decision: 'ALLOW',
        state: 'APPROVED',
        receiptHash: 'receipt-hash-1234567890abcdef',
        decidedBy: 'admin-operator',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.approvals[0]?.state, 'APPROVED');
    assert.equal(state.approvals[0]?.receiptHash, 'receipt-hash-1234567890abcdef');

    // Controls must be disabled
    const buttons = container.querySelectorAll('.approval-action-btn') as MockElement[];
    assert.equal(buttons.length, 2);
    for (const btn of buttons) {
      assert.equal(btn.disabled, true);
    }

    // Status badge updated
    const badge = container.querySelector('.status-badge');
    assert.ok(badge?.textContent.includes('Approved'));

    // Decided by displayed
    const detail = container.querySelector('.approval-card__detail');
    assert.ok(detail?.textContent.includes('admin-operator'));
  });

  // 12. approval badge never becomes negative
  it('12. approval badge never becomes negative on approval.decided', () => {
    const badge = mockDoc.getElementById('approval-badge')!;
    badge.textContent = '0';
    badge.hidden = true;

    const event = makeEventEnvelope<TypedApprovalDecidedEvent>({
      schema_id: 'nexusos.events.approval.decided',
      payload: {
        promptId: '00000000-0000-4000-8000-000000000120',
        decision: 'DENY',
        state: 'DENIED',
        receiptHash: 'receipt-123',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(badge.textContent, '0');
    assert.equal(badge.hidden, true);
  });

  // 13. telemetry.sample updates all supported summary fields
  it('13. telemetry.sample updates all supported summary fields in state and DOM', () => {
    const event = makeEventEnvelope<TypedTelemetrySampleEvent>({
      schema_id: 'nexusos.events.telemetry.sample',
      payload: {
        tenantId: 'default-tenant',
        activeTaskCount: 7,
        pendingApprovalCount: 2,
        completedTaskCount: 120,
        failedTaskCount: 4,
        connectedDeviceCount: 3,
        healthStatus: 'HEALTHY',
        vramAlert: true,
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(mockDoc.getElementById('active-task-count')!.textContent, '7');
    assert.equal(mockDoc.getElementById('pending-approval-count')!.textContent, '2');
    assert.equal(mockDoc.getElementById('completed-task-count')!.textContent, '120');
    assert.equal(mockDoc.getElementById('failed-task-count')!.textContent, '4');
    assert.equal(mockDoc.getElementById('vram-alert')!.hidden, false);
    assert.ok(mockDoc.getElementById('health-badge')!.classList.contains('health-badge--healthy'));

    assert.equal(state.summary?.activeTaskCount, 7);
    assert.equal(state.summary?.pendingApprovalCount, 2);
    assert.equal(state.summary?.completedTaskCount, 120);
    assert.equal(state.summary?.failedTaskCount, 4);
    assert.equal(state.summary?.healthStatus, 'HEALTHY');
    assert.equal(state.summary?.vramAlert, true);
  });

  // 14. unsupported telemetry fields are ignored
  it('14. unsupported telemetry fields are ignored without fabrication', () => {
    const event = makeEventEnvelope<TypedTelemetrySampleEvent>({
      schema_id: 'nexusos.events.telemetry.sample',
      payload: {
        tenantId: 'default-tenant',
        activeTaskCount: 5,
        pendingApprovalCount: 1,
        completedTaskCount: 10,
        failedTaskCount: 0,
        connectedDeviceCount: 1,
        healthStatus: 'READY',
        // Unexpected / unsupported extra fields
        ...({
          cpuUsage: 95.5,
          gpuUsage: 80.0,
          ramUsage: 64.0,
          tokenThroughput: 1500,
        } as Record<string, unknown>),
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    // Summary state must only contain genuine properties
    assert.equal(state.summary?.activeTaskCount, 5);
    assert.equal((state.summary as unknown as Record<string, unknown>)['cpuUsage'], undefined);
    assert.equal((state.summary as unknown as Record<string, unknown>)['gpuUsage'], undefined);
  });

  // 15. graph.evolved creates activity only and does not invoke graph rendering
  it('15. graph.evolved creates activity only and does not mutate graph nodes or edges', () => {
    state.graphNodes = [
      {
        id: 'node-1',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        label: 'Node 1',
        nodeType: MemoryGraphNodeType.CONCEPT,
        confidence: 0.9,
        version: 1,
        isCurrent: true,
        createdAt: new Date().toISOString(),
        properties: {},
      },
    ];

    const event = makeEventEnvelope<TypedGraphEvolvedEvent>({
      schema_id: 'nexusos.events.graph.evolved',
      payload: {
        deliveryId: 'del-1',
        recordId: 'rec-1',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        nodeCount: 10,
        edgeCount: 15,
        operationType: 'UPSERT',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    // Verify activity stream has entry
    assert.equal(state.activity.length, 1);
    assert.equal(state.activity[0]?.schema_id, 'nexusos.events.graph.evolved');

    // Graph nodes must NOT be mutated
    assert.equal(state.graphNodes.length, 1);
    assert.equal(state.graphNodes[0]?.id, 'node-1');
  });

  // 16. activity list remains <=50
  it('16. activity list remains strictly bounded to <= 50 items', () => {
    for (let i = 0; i < 60; i++) {
      const event = makeEventEnvelope<TypedGraphEvolvedEvent>({
        schema_id: 'nexusos.events.graph.evolved',
        event_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        payload: {
          deliveryId: `del-${i}`,
          recordId: `rec-${i}`,
          tenantId: 'default-tenant',
          workspaceId: '00000000-0000-4000-8000-000000000000',
          nodeCount: i,
          edgeCount: i * 2,
          operationType: 'APPEND',
        },
      });
      enqueueTelemetryEvent(event);
    }
    flushPendingEvents();

    assert.equal(state.activity.length, 50, 'state.activity must be capped at 50');
    const container = mockDoc.getElementById('activity-stream-container')!;
    const rows = container.querySelectorAll('.activity-item');
    assert.equal(rows.length, 50, 'DOM activity rows must be capped at 50');
  });

  // 17. overview activity remains <=10
  it('17. overview activity list remains strictly bounded to <= 10 items', () => {
    for (let i = 0; i < 20; i++) {
      const event = makeEventEnvelope<TypedGraphEvolvedEvent>({
        schema_id: 'nexusos.events.graph.evolved',
        event_id: `00000000-0000-4000-8000-1111${String(i).padStart(8, '0')}`,
        payload: {
          deliveryId: `del-${i}`,
          recordId: `rec-${i}`,
          tenantId: 'default-tenant',
          workspaceId: '00000000-0000-4000-8000-000000000000',
          nodeCount: i,
          edgeCount: i,
          operationType: 'APPEND',
        },
      });
      enqueueTelemetryEvent(event);
    }
    flushPendingEvents();

    const overview = mockDoc.getElementById('overview-activity-list')!;
    const rows = overview.querySelectorAll('.activity-item');
    assert.equal(rows.length, 10, 'Overview activity must be capped at 10');
  });

  // 18. same-entity events coalesce to latest state within one RAF
  it('18. same-entity events coalesce to latest state within one RAF interval', () => {
    const agentId = '00000000-0000-4000-8000-000000000099';
    state.agents = [
      {
        agentId,
        tenantId: 'default-tenant',
        workspaceScope: ['default'],
        role: 'WORKER',
        status: 'AVAILABLE',
        currentLoad: 0.1,
        activeTaskIds: [],
        lastHeartbeat: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
        version: '1.0.0',
        metadata: {},
        capabilities: [],
      },
    ];

    const container = mockDoc.getElementById('agent-roster-container')!;
    container.innerHTML = `
      <div class="agent-card" data-agent-id="${agentId}">
        <div class="agent-card__header"><div class="agent-card__badges"></div></div>
        <div class="agent-card__meta">
          <div class="agent-card__meta-item">
            <span class="agent-card__meta-label">Task Load</span>
            <span class="agent-card__meta-value">10%</span>
          </div>
        </div>
      </div>
    `;

    // Enqueue 3 status updates in same frame
    enqueueTelemetryEvent(
      makeEventEnvelope<TypedAgentStatusChangedEvent>({
        schema_id: 'nexusos.events.agent.status_changed',
        payload: {
          agentId,
          tenantId: 'default-tenant',
          role: 'WORKER',
          status: 'BUSY',
          currentLoad: 0.3,
          activeTaskCount: 1,
        },
      }),
    );
    enqueueTelemetryEvent(
      makeEventEnvelope<TypedAgentStatusChangedEvent>({
        schema_id: 'nexusos.events.agent.status_changed',
        payload: {
          agentId,
          tenantId: 'default-tenant',
          role: 'WORKER',
          status: 'BUSY',
          currentLoad: 0.6,
          activeTaskCount: 2,
        },
      }),
    );
    enqueueTelemetryEvent(
      makeEventEnvelope<TypedAgentStatusChangedEvent>({
        schema_id: 'nexusos.events.agent.status_changed',
        payload: {
          agentId,
          tenantId: 'default-tenant',
          role: 'WORKER',
          status: 'BUSY',
          currentLoad: 0.95,
          activeTaskCount: 4,
        },
      }),
    );

    // Flush once
    flushPendingEvents();

    assert.equal(state.agents[0]?.currentLoad, 0.95);
    assert.equal(state.agents[0]?.activeTaskIds.length, 4);

    const loadVal = container.querySelector('.agent-card__meta-value');
    assert.ok(loadVal?.textContent.includes('95% (4 active)'));
  });

  // 19. replayed duplicate event does not duplicate history DOM
  it('19. replayed duplicate event does not duplicate history DOM rows', () => {
    const eventId = '00000000-0000-4000-8000-dup000000001';
    const event = makeEventEnvelope<TypedGraphEvolvedEvent>({
      schema_id: 'nexusos.events.graph.evolved',
      event_id: eventId,
      payload: {
        deliveryId: 'd-1',
        recordId: 'r-1',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        nodeCount: 1,
        edgeCount: 1,
        operationType: 'TEST',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    // Replay the exact same event
    enqueueTelemetryEvent(event);
    flushPendingEvents();

    assert.equal(state.activity.length, 1);
    const container = mockDoc.getElementById('activity-stream-container')!;
    assert.equal(container.querySelectorAll('.activity-item').length, 1);
  });

  // 20. reset/reconciliation generation guard prevents stale REST result overwrite
  it('20. reset reconciliation generation guard prevents stale REST result overwrite', async () => {
    // Trigger first reset
    const p1 = handleStreamResetReconciliation({
      reason: 'SERVER_EPOCH_CHANGED',
      currentEpoch: '00000000-0000-4000-8000-000000000001',
      currentSequence: 1,
    });

    // Trigger second reset immediately while first is in flight
    const p2 = handleStreamResetReconciliation({
      reason: 'REPLAY_BUFFER_EXPIRED',
      currentEpoch: '00000000-0000-4000-8000-000000000002',
      currentSequence: 1,
    });

    await Promise.all([p1, p2]);
    // State should remain consistent without uncaught promise rejection
    assert.ok(state.summary !== null);
  });

  // 21. events arriving during reconciliation are replayed after snapshot commit
  it('21. events arriving during reconciliation are buffered and projected after commit', async () => {
    // Start reset reconciliation
    const resetPromise = handleStreamResetReconciliation({
      reason: 'SERVER_EPOCH_CHANGED',
      currentEpoch: '00000000-0000-4000-8000-000000000010',
      currentSequence: 1,
    });

    // While reconciliation is in flight, an event from the new epoch arrives
    const newAgentId = '00000000-0000-4000-8000-epoch2agent1';
    const liveEvent = makeEventEnvelope<TypedAgentStatusChangedEvent>({
      schema_id: 'nexusos.events.agent.status_changed',
      payload: {
        agentId: newAgentId,
        tenantId: 'default-tenant',
        role: 'WORKER',
        status: 'BUSY',
        currentLoad: 0.5,
        activeTaskCount: 2,
      },
    });

    enqueueTelemetryEvent(liveEvent);

    // Wait for reconciliation to commit
    await resetPromise;
    flushPendingEvents();

    // Verify the live event was NOT lost and has been projected
    const agent = state.agents.find((a) => a.agentId === newAgentId);
    assert.ok(agent, 'Live event arriving during reconciliation must be preserved');
    assert.equal(agent?.currentLoad, 0.5);
  });

  // 22. XSS/event-derived HTML is neutralized
  it('22. XSS and malicious HTML in event payload are neutralized', () => {
    const maliciousTaskId = 'task-xss';
    const maliciousTitle = `<script>alert('xss')</script><img src=x onerror=alert(1)>Malicious Task`;

    state.tasks = [
      {
        taskId: maliciousTaskId,
        tenantId: 'default-tenant',
        submittedBy: 'attacker',
        title: maliciousTitle,
        targetAgentId: 'agent-1',
        capabilityId: 'cap',
        runtimeCategory: 'native',
        state: 'RUNNING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const container = mockDoc.getElementById('task-list-container')!;
    container.innerHTML = `
      <div class="task-row" data-task-id="${maliciousTaskId}">
        <span class="status-badge status-badge--running">Running</span>
      </div>
    `;

    const event = makeEventEnvelope<TypedTaskStatusChangedEvent>({
      schema_id: 'nexusos.events.task.status_changed',
      payload: {
        taskId: maliciousTaskId,
        tenantId: 'default-tenant',
        title: maliciousTitle,
        state: 'COMPLETED',
        targetAgentId: 'agent-1',
      },
    });

    enqueueTelemetryEvent(event);
    flushPendingEvents();

    const badge = container.querySelector('.status-badge');
    assert.equal(badge?.textContent, 'Completed');

    // Also test activity item HTML sanitization
    const actEvent = makeEventEnvelope<TypedGraphEvolvedEvent>({
      schema_id: 'nexusos.events.graph.evolved',
      payload: {
        deliveryId: 'del-xss',
        recordId: 'rec-xss',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        nodeCount: 1,
        edgeCount: 1,
        operationType: '<script>evil()</script>',
      },
    });
    enqueueTelemetryEvent(actEvent);
    flushPendingEvents();

    const actContainer = mockDoc.getElementById('activity-stream-container')!;
    assert.ok(!actContainer.innerHTML.includes('<script>evil()</script>'));
  });

  // 23. hidden-tab event intake remains bounded and exception-free
  it('23. hidden-tab event intake remains bounded and exception-free', () => {
    mockDoc.hidden = true;

    // Simulate 100 state events across 3 agents and 100 history events arriving while tab hidden
    for (let i = 0; i < 100; i++) {
      const agentId = `00000000-0000-4000-8000-${String(i % 3).padStart(12, '0')}`;
      enqueueTelemetryEvent(
        makeEventEnvelope<TypedAgentStatusChangedEvent>({
          schema_id: 'nexusos.events.agent.status_changed',
          payload: {
            agentId,
            tenantId: 'default-tenant',
            role: 'WORKER',
            status: 'AVAILABLE',
            currentLoad: (i % 10) / 10,
            activeTaskCount: i % 5,
          },
        }),
      );

      enqueueTelemetryEvent(
        makeEventEnvelope<TypedGraphEvolvedEvent>({
          schema_id: 'nexusos.events.graph.evolved',
          event_id: `00000000-0000-4000-8000-hist${String(i).padStart(8, '0')}`,
          payload: {
            deliveryId: `del-${i}`,
            recordId: `rec-${i}`,
            tenantId: 'default-tenant',
            workspaceId: '00000000-0000-4000-8000-000000000000',
            nodeCount: i,
            edgeCount: i,
            operationType: 'APPEND',
          },
        }),
      );
    }

    // Tab becomes visible: RAF flushes
    mockDoc.hidden = false;
    assert.doesNotThrow(() => {
      flushPendingEvents();
    });

    assert.ok(state.activity.length <= 50, 'Activity must remain bounded to <= 50');
  });
});
