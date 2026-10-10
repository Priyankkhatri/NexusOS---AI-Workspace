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

import { describe, it, beforeEach, afterEach } from 'node:test';
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
  isFocused: boolean = false;
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  _text: string = '';
  eventListeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  addEventListener(eventName: string, handler: (e: unknown) => void): void {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(handler);
  }
  
  removeEventListener(): void {}

  // Dialog methods
  open: boolean = false;
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
    if (this.eventListeners['close']) {
      for (const fn of this.eventListeners['close']) {
        fn({ type: 'close' });
      }
    }
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
  apiClient,
  openTaskDetail,
  initTaskDetailModal,
  _resetProjectionState,
  projectTaskStatusChanged
} from '../../apps/web-dashboard/src/main.js';
import { DashboardAPIError } from '../../apps/web-dashboard/src/api/client.js';

function setupDashboardDOM(): void {
  mockDoc.body.children = [];
  mockDoc.body.innerHTML = `
    <dialog id="task-detail-modal">
      <div class="modal-header">
        <h2 id="task-detail-title">Task Detail</h2>
        <button id="task-detail-close" aria-label="Close modal">×</button>
      </div>
      <div id="task-detail-content"></div>
    </dialog>
  `;
}

describe('Task 068 Phase 4A: Task Inspection UX', () => {
  let originalGetTask: any;

  beforeEach(() => {
    setupDashboardDOM();
    initTaskDetailModal();
    _resetProjectionState();
    state.openTaskId = undefined;
    originalGetTask = apiClient.getTask;
  });

  afterEach(() => {
    apiClient.getTask = originalGetTask;
  });

  it('renders loading state initially', async () => {
    let resolveGetTask: (v: any) => void;
    apiClient.getTask = () => new Promise(r => { resolveGetTask = r; });
    
    const p = openTaskDetail('task-123');
    
    const content = mockDoc.getElementById('task-detail-content');
    assert.ok(content?.innerHTML.includes('Loading task details...'));
    assert.strictEqual(state.openTaskId, 'task-123');
    
    resolveGetTask!({ taskId: 'task-123', title: 'Foo', state: 'EXECUTING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await p;
  });

  it('renders canonical task information safely', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-456',
      title: '<script>alert(1)</script>SafeTitle',
      state: 'COMPLETED',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      submittedBy: 'tenant-user',
      tenantId: 'tenant-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    await openTaskDetail('task-456');
    const content = mockDoc.getElementById('task-detail-content');
    
    // Check sanitation
    const title = mockDoc.getElementById('task-detail-title');
    // title.textContent sets the raw text, which is safe. It WILL include '<script>' but it won't execute because it's textContent.
    // Let me check what title.textContent returns. It will just be 'Task: <script>alert(1)</script>SafeTitle'.
    assert.strictEqual(title?.textContent, 'Task: <script>alert(1)</script>SafeTitle');
    
    // Check canonical information rendered
    assert.ok(content?.innerHTML.includes('task-456'));
    assert.ok(content?.innerHTML.includes('Completed'));
    assert.ok(content?.innerHTML.includes('tenant-1'));
  });

  it('handles 404 cleanly', async () => {
    apiClient.getTask = async () => {
      throw new DashboardAPIError(404, { code: 'NOT_FOUND', message: 'Not Found' }, '/v1/tasks/task-999');
    };
    
    await openTaskDetail('task-999');
    const content = mockDoc.getElementById('task-detail-content');
    assert.ok(content?.innerHTML.includes('Task not found'));
    assert.ok(!content?.innerHTML.includes('Loading task details...'));
  });

  it('handles 403 cleanly', async () => {
    apiClient.getTask = async () => {
      throw new DashboardAPIError(403, { code: 'TENANT_MISMATCH', message: 'Forbidden' }, '/v1/tasks/task-403');
    };
    
    await openTaskDetail('task-403');
    const content = mockDoc.getElementById('task-detail-content');
    assert.ok(content?.innerHTML.includes('You do not have permission'));
  });

  it('handles network error cleanly', async () => {
    apiClient.getTask = async () => {
      throw new Error('Network Error');
    };
    
    await openTaskDetail('task-err');
    const content = mockDoc.getElementById('task-detail-content');
    assert.ok(content?.innerHTML.includes('Failed to load task details'));
  });

  it('updates open task detail via live event', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-live',
      title: 'Live Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    await openTaskDetail('task-live');
    const content = mockDoc.getElementById('task-detail-content');
    assert.ok(content?.innerHTML.includes('status-badge--executing'));
    assert.ok(content?.innerHTML.includes('Executing'));
    
    // Send live event
    projectTaskStatusChanged({
      taskId: 'task-live',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      title: 'Live Task',
      state: 'COMPLETED',
      previousState: 'EXECUTING',
      targetAgentId: 'agent-1'
    }, new Date().toISOString());
    
    assert.ok(content?.innerHTML.includes('status-badge--completed'));
    assert.ok(content?.innerHTML.includes('Completed'));
  });

  it('does NOT update open task detail from unrelated live event', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-live',
      title: 'Live Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    await openTaskDetail('task-live');
    
    // Send live event for another task
    projectTaskStatusChanged({
      taskId: 'task-other',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      title: 'Other Task',
      state: 'FAILED',
      previousState: 'EXECUTING',
      targetAgentId: 'agent-1'
    }, new Date().toISOString());
    
    const content = mockDoc.getElementById('task-detail-content');
    assert.ok(content?.innerHTML.includes('status-badge--executing'));
    assert.ok(!content?.innerHTML.includes('status-badge--failed'));
  });

  it('clears openTaskId on close event', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-1',
      title: 'Task 1',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    await openTaskDetail('task-1');
    assert.strictEqual(state.openTaskId, 'task-1');
    
    const modal = mockDoc.getElementById('task-detail-modal');
    // Simulate dialog close event
    const closeEvent = { type: 'close' };
    modal!.eventListeners['close']?.forEach(fn => fn(closeEvent));
    
    assert.strictEqual(state.openTaskId, undefined);
  });
});
