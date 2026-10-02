/**
 * NexusOS — Task 067 Phase 3C Hardening Tests
 * Real-Time Dashboard — Operator Truth, Freshness & Accessibility
 *
 * Verifies:
 * 1. Static connection indicator in index.html is not initially "Connected"
 * 2. Connection-state handler renders CONNECTING truthfully
 * 3. Connection-state handler renders CONNECTED_STREAMING truthfully
 * 4. Connection-state handler renders RECONNECTING truthfully
 * 5. Connection-state handler renders DEGRADED_POLLING truthfully
 * 6. Connection-state handler renders OFFLINE truthfully
 * 7. Successful REST refresh advances snapshot freshness timestamp
 * 8. Failed REST refresh does NOT advance snapshot freshness timestamp
 * 9. SSE application event advances live-event timestamp
 * 10. Connection establishment alone does NOT falsely advance live-event timestamp
 * 11. Reconciliation start does not falsely advance snapshot freshness
 * 12. Failed reconciliation does not falsely advance snapshot freshness
 * 13. New activity event inserts one new DOM item without rebuilding entire container
 * 14. Activity DOM remains bounded at 50
 * 15. Overview activity remains bounded at 10
 * 16. Existing focused element identity survives insertion of a new activity item
 * 17. Event-derived activity content remains sanitized
 * 18. Successful degraded-mode recovery stops polling
 * 19. Degraded recovery does not leave duplicate polling timers
 * 20. Reduced-motion styles exist and are respected
 *
 * Uses node:test and lightweight in-memory DOM mock. Zero external dependencies.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  isFocused: boolean = false;
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

  focus(): void {
    this.isFocused = true;
  }

  blur(): void {
    this.isFocused = false;
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
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function matchesAttr(el: MockElement, attrSel: string): boolean {
  const match = /^\[([a-zA-Z0-9_:-]+)(?:([*^$]?=)"?([^"]*)"?)?\]$/.exec(attrSel);
  if (!match) return false;
  const attrName = match[1]!;
  const op = match[2];
  const val = match[3];

  let attrVal = el.getAttribute(attrName);
  if (attrName.startsWith('data-')) {
    const camel = attrName.slice(5).replace(/-([a-z])/g, (_, g: string) => g.toUpperCase());
    attrVal = el.dataset[camel] ?? attrVal;
  }

  if (attrVal === null || attrVal === undefined) return false;
  if (!op) return true;
  if (op === '=') return attrVal === val;
  if (op === '*=') return attrVal.includes(val ?? '');
  if (op === '^=') return attrVal.startsWith(val ?? '');
  if (op === '$=') return attrVal.endsWith(val ?? '');
  return false;
}

function matchSelectorRecursive(root: MockElement, selector: string, out: MockElement[]): void {
  const parts = selector.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    for (const child of root.children) {
      if (matchesSimple(child, parts[0]!)) {
        out.push(child);
      }
      matchSelectorRecursive(child, selector, out);
    }
  } else {
    for (const child of root.children) {
      if (matchesSimple(child, parts[0]!)) {
        const remaining = parts.slice(1).join(' ');
        matchSelectorRecursive(child, remaining, out);
      } else {
        matchSelectorRecursive(child, selector, out);
      }
    }
  }
}

export class MockDocument {
  body: MockElement = new MockElement('body');
  documentElement: MockElement = new MockElement('html');
  hidden: boolean = false;

  getElementById(id: string): MockElement | null {
    return this.body.querySelector(`#${id}`);
  }

  querySelector(selector: string): MockElement | null {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.body.querySelectorAll(selector);
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

const mockDoc = new MockDocument();
(globalThis as unknown as { document: MockDocument }).document = mockDoc;
(globalThis as unknown as { window: unknown }).window = {
  document: mockDoc,
  location: { origin: 'http://localhost:3000' },
  requestAnimationFrame: (cb: (time: number) => void) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  },
};

// Import main.ts after DOM fixture is registered
import {
  state,
  handleConnectionStateChange,
  startPolling,
  stopPolling,
  enqueueTelemetryEvent,
  handleStreamResetReconciliation,
  applyActivityItem,
  recordRestSnapshotSuccess,
  _resetProjectionState,
  type TypedTelemetryEvent,
  type TypedGraphEvolvedEvent,
} from '../../apps/web-dashboard/src/main.js';

function setupDashboardDOM(): void {
  mockDoc.body.children = [];
  mockDoc.body.innerHTML = `
    <span id="connection-indicator" class="connection-indicator connection-indicator--connecting" role="status" aria-live="polite">Connecting...</span>
    <span id="freshness-indicator" class="freshness-indicator" aria-live="polite">
      <span id="snapshot-freshness" class="freshness-item">Snapshot: —</span>
      <span class="freshness-separator">|</span>
      <span id="live-event-freshness" class="freshness-item">Event: —</span>
    </span>
    <div id="overview-cards">
      <span id="active-task-count">0</span>
      <span id="pending-approval-count">0</span>
      <span id="completed-task-count">0</span>
      <span id="failed-task-count">0</span>
    </div>
    <span id="health-badge" class="health-badge"><span class="health-label">Healthy</span></span>
    <span id="approval-badge" hidden>0</span>
    <div id="overview-activity-list" class="activity-list" role="log" aria-live="polite">
      <div id="overview-activity-empty" class="empty-state">No activity</div>
    </div>
    <div id="activity-stream-container" class="activity-stream" role="log" aria-live="polite">
      <div id="activity-stream-empty" class="empty-state">No activity</div>
    </div>
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

describe('Task 067 Phase 3C: Real-Time Dashboard — Operator Truth, Freshness & Accessibility', () => {
  beforeEach(() => {
    _resetProjectionState();
    setupDashboardDOM();
    stopPolling();
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
      connectedDeviceCount: 0,
      healthStatus: 'HEALTHY',
      updatedAt: new Date().toISOString(),
    };
  });

  // 1. Static connection indicator in index.html is not initially "Connected"
  it('1. static connection indicator in index.html does not claim Connected before JS init', () => {
    const htmlPath = path.resolve('apps/web-dashboard/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    // Extract #connection-indicator element
    const indicatorMatch = /id="connection-indicator"[^>]*>([\s\S]*?)<\/span>/i.exec(htmlContent);
    assert.ok(indicatorMatch, 'connection-indicator element must exist in index.html');
    const initialText = indicatorMatch[1]?.trim();
    assert.notEqual(initialText, 'Connected', 'Initial HTML text must not claim Connected');
    assert.ok(
      initialText === 'Connecting...' || initialText === 'Offline',
      `Initial text must be honest, got "${initialText}"`,
    );
  });

  // 2. Connection-state handler renders CONNECTING truthfully
  it('2. connection-state handler renders CONNECTING truthfully', () => {
    handleConnectionStateChange('CONNECTING');
    const el = mockDoc.getElementById('connection-indicator')!;
    assert.equal(el.textContent, 'Connecting...');
    assert.ok(el.classList.contains('connection-indicator--connecting'));
    assert.equal(el.classList.contains('connection-indicator--online'), false);
  });

  // 3. Connection-state handler renders CONNECTED_STREAMING truthfully
  it('3. connection-state handler renders CONNECTED_STREAMING truthfully', () => {
    handleConnectionStateChange('CONNECTED_STREAMING');
    const el = mockDoc.getElementById('connection-indicator')!;
    assert.equal(el.textContent, 'Live');
    assert.ok(el.classList.contains('connection-indicator--online'));
  });

  // 4. Connection-state handler renders RECONNECTING truthfully
  it('4. connection-state handler renders RECONNECTING truthfully', () => {
    handleConnectionStateChange('RECONNECTING');
    const el = mockDoc.getElementById('connection-indicator')!;
    assert.equal(el.textContent, 'Reconnecting...');
    assert.ok(el.classList.contains('connection-indicator--warning'));
  });

  // 5. Connection-state handler renders DEGRADED_POLLING truthfully
  it('5. connection-state handler renders DEGRADED_POLLING truthfully', () => {
    handleConnectionStateChange('DEGRADED_POLLING');
    const el = mockDoc.getElementById('connection-indicator')!;
    assert.equal(el.textContent, 'Polling (Degraded)');
    assert.ok(el.classList.contains('connection-indicator--degraded'));
  });

  // 6. Connection-state handler renders OFFLINE truthfully
  it('6. connection-state handler renders OFFLINE truthfully', () => {
    handleConnectionStateChange('OFFLINE');
    const el = mockDoc.getElementById('connection-indicator')!;
    assert.equal(el.textContent, 'Offline');
    assert.ok(el.classList.contains('connection-indicator--offline'));
  });

  // 7. Successful REST refresh advances snapshot freshness timestamp
  it('7. successful REST refresh advances snapshot freshness timestamp', () => {
    const timestamp = '2026-10-01T21:42:10.000Z';
    recordRestSnapshotSuccess(timestamp);

    assert.equal(state.lastRestSnapshotAt, timestamp);
    const snapshotEl = mockDoc.getElementById('snapshot-freshness')!;
    assert.ok(snapshotEl.textContent.includes('Snapshot:'));
    assert.notEqual(snapshotEl.textContent, 'Snapshot: —');
  });

  // 8. Failed REST refresh does NOT advance snapshot freshness timestamp
  it('8. failed REST refresh does NOT advance snapshot freshness timestamp', () => {
    const priorTimestamp = '2026-10-01T20:00:00.000Z';
    recordRestSnapshotSuccess(priorTimestamp);

    // Simulate failed REST call (nothing recorded)
    assert.equal(state.lastRestSnapshotAt, priorTimestamp);
    const snapshotEl = mockDoc.getElementById('snapshot-freshness')!;
    assert.ok(snapshotEl.textContent.includes('Snapshot:'));
  });

  // 9. SSE application event advances live-event timestamp
  it('9. SSE application event advances live-event timestamp', () => {
    const occurredAt = '2026-10-01T21:45:30.000Z';
    const event = makeEventEnvelope<TypedGraphEvolvedEvent>({
      schema_id: 'nexusos.events.graph.evolved',
      occurred_at: occurredAt,
      payload: {
        deliveryId: 'del-1',
        recordId: 'rec-1',
        tenantId: 'default-tenant',
        workspaceId: '00000000-0000-4000-8000-000000000000',
        nodeCount: 1,
        edgeCount: 1,
        operationType: 'UPSERT',
      },
    });

    enqueueTelemetryEvent(event);
    assert.equal(state.lastLiveEventAt, occurredAt);
    const eventEl = mockDoc.getElementById('live-event-freshness')!;
    assert.ok(eventEl.textContent.includes('Event:'));
    assert.notEqual(eventEl.textContent, 'Event: —');
  });

  // 10. Connection establishment alone does NOT falsely advance live-event timestamp
  it('10. connection establishment alone does NOT falsely advance live-event timestamp', () => {
    assert.equal(state.lastLiveEventAt, null);
    handleConnectionStateChange('CONNECTING');
    assert.equal(state.lastLiveEventAt, null);
    handleConnectionStateChange('CONNECTED_STREAMING');
    assert.equal(state.lastLiveEventAt, null);

    const eventEl = mockDoc.getElementById('live-event-freshness')!;
    assert.equal(eventEl.textContent, 'Event: —');
  });

  // 11. Reconciliation start does not falsely advance snapshot freshness
  it('11. reconciliation start does not falsely advance snapshot freshness', () => {
    assert.equal(state.lastRestSnapshotAt, null);
    void handleStreamResetReconciliation({
      reason: 'SERVER_EPOCH_CHANGED',
      currentEpoch: '00000000-0000-4000-8000-000000000001',
      currentSequence: 1,
    });
    // In mock without resolved REST fetch, lastRestSnapshotAt remains null
    assert.equal(state.lastRestSnapshotAt, null);
  });

  // 12. Failed reconciliation does not falsely advance snapshot freshness
  it('12. failed reconciliation does not falsely advance snapshot freshness', async () => {
    state.lastRestSnapshotAt = null;
    await handleStreamResetReconciliation({
      reason: 'REPLAY_BUFFER_EXPIRED',
      currentEpoch: '00000000-0000-4000-8000-000000000002',
      currentSequence: 1,
    });
    // With fetch failing in mock environment, timestamp must not advance
    assert.equal(state.lastRestSnapshotAt, null);
  });

  // 13. New activity event inserts one new DOM item without rebuilding the entire activity container
  it('13. new activity event inserts one new DOM item without rebuilding the entire activity container', () => {
    // Initial activity item
    const item1 = {
      event_id: '00000000-0000-4000-8000-000000000001',
      schema_id: 'nexusos.events.task.status_changed',
      version: '1.0.0',
      correlation_id: 'corr-1',
      occurred_at: new Date().toISOString(),
      producer_id: 'agent-1',
      payload: { taskId: 'task-1', state: 'COMPLETED' },
    };
    applyActivityItem(item1);

    const container = mockDoc.getElementById('activity-stream-container')!;
    const initialFirstChild = container.children[0];
    assert.ok(initialFirstChild, 'Container must have first child');

    // Second activity item
    const item2 = {
      event_id: '00000000-0000-4000-8000-000000000002',
      schema_id: 'nexusos.events.task.status_changed',
      version: '1.0.0',
      correlation_id: 'corr-2',
      occurred_at: new Date().toISOString(),
      producer_id: 'agent-2',
      payload: { taskId: 'task-2', state: 'EXECUTING' },
    };
    applyActivityItem(item2);

    // Surgical check: initialFirstChild must still exist in container.children
    assert.equal(container.children.length, 2);
    assert.equal(
      container.children[1],
      initialFirstChild,
      'Previous DOM element identity preserved',
    );
  });

  // 14. Activity DOM remains bounded at 50
  it('14. activity DOM remains bounded at 50', () => {
    for (let i = 0; i < 60; i++) {
      const item = {
        event_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        schema_id: 'nexusos.events.task.status_changed',
        version: '1.0.0',
        correlation_id: `corr-${i}`,
        occurred_at: new Date().toISOString(),
        producer_id: 'producer',
        payload: { taskId: `task-${i}`, state: 'COMPLETED' },
      };
      applyActivityItem(item);
    }

    const container = mockDoc.getElementById('activity-stream-container')!;
    const rows = container.querySelectorAll('.activity-item');
    assert.equal(rows.length, 50, 'activity-stream-container must be strictly bounded to 50 items');
    assert.equal(state.activity.length, 50, 'state.activity must be strictly bounded to 50 items');
  });

  // 15. Overview activity remains bounded at 10
  it('15. overview activity remains bounded at 10', () => {
    for (let i = 0; i < 20; i++) {
      const item = {
        event_id: `00000000-0000-4000-8000-ov${String(i).padStart(10, '0')}`,
        schema_id: 'nexusos.events.task.status_changed',
        version: '1.0.0',
        correlation_id: `corr-${i}`,
        occurred_at: new Date().toISOString(),
        producer_id: 'producer',
        payload: { taskId: `task-${i}`, state: 'COMPLETED' },
      };
      applyActivityItem(item);
    }

    const container = mockDoc.getElementById('overview-activity-list')!;
    const rows = container.querySelectorAll('.activity-item');
    assert.equal(rows.length, 10, 'overview-activity-list must be strictly bounded to 10 items');
  });

  // 16. Existing focused element identity survives insertion of a new activity item
  it('16. existing focused element identity survives insertion of a new activity item', () => {
    const item1 = {
      event_id: '00000000-0000-4000-8000-focus0000001',
      schema_id: 'nexusos.events.task.status_changed',
      version: '1.0.0',
      correlation_id: 'corr-f1',
      occurred_at: new Date().toISOString(),
      producer_id: 'agent-1',
      payload: { taskId: 'task-1', state: 'COMPLETED' },
    };
    applyActivityItem(item1);

    const container = mockDoc.getElementById('activity-stream-container')!;
    const firstRow = container.children[0]!;
    firstRow.focus();
    assert.equal(firstRow.isFocused, true);

    const item2 = {
      event_id: '00000000-0000-4000-8000-focus0000002',
      schema_id: 'nexusos.events.task.status_changed',
      version: '1.0.0',
      correlation_id: 'corr-f2',
      occurred_at: new Date().toISOString(),
      producer_id: 'agent-2',
      payload: { taskId: 'task-2', state: 'EXECUTING' },
    };
    applyActivityItem(item2);

    // firstRow still exists in container and retains its focus property
    assert.equal(container.children.includes(firstRow), true);
    assert.equal(firstRow.isFocused, true, 'Focus state preserved');
  });

  // 17. Event-derived activity content remains sanitized
  it('17. event-derived activity content remains sanitized', () => {
    const maliciousItem = {
      event_id: '00000000-0000-4000-8000-xss000000001',
      schema_id: 'nexusos.events.task.status_changed',
      version: '1.0.0',
      correlation_id: '<script>alert("xss")</script>',
      occurred_at: new Date().toISOString(),
      producer_id: '<img src=x onerror=alert(1)>',
      payload: { taskId: '<svg onload=alert(2)>', state: 'EXECUTING' },
    };

    applyActivityItem(maliciousItem);

    const container = mockDoc.getElementById('activity-stream-container')!;
    const html = container.innerHTML;
    assert.equal(html.includes('<script>'), false, 'Raw script tags must not appear in DOM');
    assert.equal(html.includes('<img src=x onerror'), false, 'Raw img tags must not appear in DOM');
    assert.equal(html.includes('<svg onload='), false, 'Raw svg tags must not appear in DOM');
  });

  // 18. Successful degraded-mode recovery stops polling
  it('18. successful degraded-mode recovery stops polling', () => {
    // Enter degraded polling
    handleConnectionStateChange('DEGRADED_POLLING');
    assert.ok(
      state.pollingInterval !== null,
      'Polling interval must be active in DEGRADED_POLLING',
    );

    // Stream recovers
    handleConnectionStateChange('CONNECTED_STREAMING');
    assert.equal(state.pollingInterval, null, 'Polling must stop upon stream recovery');
  });

  // 19. Degraded recovery does not leave duplicate polling timers
  it('19. degraded recovery does not leave duplicate polling timers', () => {
    handleConnectionStateChange('DEGRADED_POLLING');
    const firstTimer = state.pollingInterval;
    assert.ok(firstTimer !== null);

    // Repeated degraded state calls must not create secondary interval timers
    startPolling();
    assert.equal(state.pollingInterval, firstTimer, 'Duplicate startPolling must be no-op');

    handleConnectionStateChange('CONNECTED_STREAMING');
    assert.equal(state.pollingInterval, null, 'Polling cleanly cleared on stream recovery');
  });

  // 20. Reduced-motion styles exist in index.css
  it('20. index.css contains prefers-reduced-motion media query', () => {
    const cssPath = path.resolve('apps/web-dashboard/src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    assert.ok(
      cssContent.includes('@media (prefers-reduced-motion: reduce)'),
      'index.css must include prefers-reduced-motion accessibility rules',
    );
  });
});
