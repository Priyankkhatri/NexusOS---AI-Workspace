/**
 * NexusOS — Task 068 Phase 4B Hardening Tests
 * Web Dashboard Safe Task Cancellation UX & Operator Controls
 *
 * Verifies:
 * 1. Eligible-state cancellation control visibility (SUBMITTED, POLICY_EVALUATED, LEASED, DISPATCHED, EXECUTING, AWAITING_APPROVAL)
 * 2. Ineligible-state cancellation control absence (RECEIPT_VERIFIED, COMPLETED, FAILED, CANCELLED)
 * 3. Confirmation required before API invocation (clicking cancel displays confirmation without network request)
 * 4. Confirmation dismissal restores UI without network request
 * 5. Confirmation copy accurately describes logical cancellation semantics and in-flight limitations
 * 6. Correct task ID and cancellation reason passed to apiClient.cancelTask()
 * 7. Default / undefined reason passed when input is empty
 * 8. Duplicate submission prevention during in-flight cancellation request
 * 9. Truthful pending-state rendering (disabled buttons, Cancelling... text)
 * 10. Successful response updates task detail modal badge, table row badge, removes actions, announces to a11y
 * 11. Ineligible-state / backend rejection handling (500 state machine error)
 * 12. Non-disclosing 404 and 403 authorization error handling
 * 13. Network failure / timeout uncertain-state error handling
 * 14. Live SSE task.status_changed reconciliation removes controls if task becomes terminal while modal open
 * 15. Stale response protection when modal target changes during in-flight cancellation
 * 16. Keyboard navigation: Escape key dismisses confirmation box without closing parent dialog
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
  _value: string = '';
  style: Record<string, string> = {};
  eventListeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  get value(): string {
    return this._value || (this.getAttribute('value') ?? '');
  }

  set value(v: string) {
    this._value = v;
    this.setAttribute('value', v);
  }

  addEventListener(eventName: string, handler: (e: unknown) => void): void {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(handler);
  }

  removeEventListener(): void {}

  click(): void {
    if (this.disabled) return;
    if (this.eventListeners['click']) {
      for (const fn of this.eventListeners['click']) {
        fn({ type: 'click', target: this, preventDefault: () => {} });
      }
    }
  }

  dispatchEvent(event: {
    type: string;
    key?: string;
    defaultPrevented?: boolean;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }): boolean {
    if (!event.preventDefault) {
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    if (!event.stopPropagation) {
      event.stopPropagation = () => {};
    }
    if (this.eventListeners[event.type]) {
      for (const fn of this.eventListeners[event.type]) {
        fn(event);
      }
    }
    return !event.defaultPrevented;
  }

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
    if (name === 'style') {
      const declarations = value.split(';');
      for (const decl of declarations) {
        const [prop, val] = decl.split(':');
        if (prop && val) {
          const camel = prop.trim().replace(/-([a-z])/g, (_, g: string) => g.toUpperCase());
          this.style[camel] = val.trim();
        }
      }
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
    if (this.className === '__text_node__') return this._text;
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this.children = [];
    this._text = val;
  }

  get innerHTML(): string {
    if (this.className === '__text_node__') return this._text;
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.outerHTML).join('');
  }

  set innerHTML(html: string) {
    this.children = [];
    this._text = '';
    parseHTMLInto(html, this);
  }

  get outerHTML(): string {
    if (this.className === '__text_node__') return this._text;
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
        const textNode = new MockElement('span');
        textNode.className = '__text_node__';
        textNode._text = textChunk;
        textNode.parentElement = current;
        current.children.push(textNode);
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
  const compoundParts = selector.split(/\s+/).filter(Boolean);

  function search(el: MockElement, partIndex: number): void {
    const currentSel = compoundParts[partIndex]!;
    const isMatch = matchesSimple(el, currentSel);

    if (isMatch) {
      if (partIndex === compoundParts.length - 1) {
        if (!out.includes(el)) out.push(el);
      } else {
        for (const child of el.children) {
          searchDescendant(child, partIndex + 1);
        }
      }
    }

    for (const child of el.children) {
      search(child, partIndex);
    }
  }

  function searchDescendant(el: MockElement, partIndex: number): void {
    const currentSel = compoundParts[partIndex]!;
    if (matchesSimple(el, currentSel)) {
      if (partIndex === compoundParts.length - 1) {
        if (!out.includes(el)) out.push(el);
      } else {
        for (const child of el.children) {
          searchDescendant(child, partIndex + 1);
        }
      }
    }
    for (const child of el.children) {
      searchDescendant(child, partIndex);
    }
  }

  if (compoundParts.length === 1) {
    for (const child of root.children) {
      searchDirect(child, compoundParts[0]!);
    }
  } else {
    for (const child of root.children) {
      search(child, 0);
    }
  }

  function searchDirect(el: MockElement, sel: string): void {
    if (matchesSimple(el, sel)) {
      if (!out.includes(el)) out.push(el);
    }
    for (const child of el.children) {
      searchDirect(child, sel);
    }
  }
}

export class MockDocument {
  body: MockElement;

  constructor() {
    this.body = new MockElement('body');
  }

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
}

// Initialize mock DOM globally before importing main.ts
export const mockDoc = new MockDocument();
(globalThis as unknown as { document: MockDocument }).document = mockDoc;
(globalThis as unknown as { window: unknown }).window = {
  document: mockDoc,
  location: { origin: 'http://localhost:3000' },
  requestAnimationFrame: (cb: (time: number) => void) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
};

// ============================================================
// Imports from Dashboard main & client
// ============================================================

import {
  openTaskDetail,
  initTaskDetailModal,
  projectTaskStatusChanged,
  isTaskCancellable,
  _resetProjectionState,
  state,
  apiClient,
} from '../../apps/web-dashboard/src/main.js';
import { DashboardAPIError } from '../../apps/web-dashboard/src/api/client.js';

function setupDashboardDOM(): void {
  mockDoc.body.children = [];
  mockDoc.body.innerHTML = `
    <dialog id="task-detail-modal" class="modal task-detail-modal">
      <div class="modal-content">
        <header class="modal-header">
          <h2 id="task-detail-title" class="modal-title">Task Detail</h2>
          <button id="task-detail-close" class="icon-btn modal-close" aria-label="Close" type="button">×</button>
        </header>
        <div class="modal-body">
          <div id="task-detail-content" class="task-detail-layout"></div>
        </div>
      </div>
    </dialog>
    <table>
      <tbody>
        <tr class="task-row" data-task-id="task-test-1">
          <td><span class="status-badge status-badge--executing">Executing</span></td>
        </tr>
      </tbody>
    </table>
  `;
}

// ============================================================
// Phase 4B Test Suite
// ============================================================

describe('Task 068 Phase 4B: Task Cancellation Controls Hardening', () => {
  let originalGetTask: typeof apiClient.getTask;
  let originalCancelTask: typeof apiClient.cancelTask;

  beforeEach(() => {
    setupDashboardDOM();
    initTaskDetailModal();
    _resetProjectionState();
    state.openTaskId = undefined;
    originalGetTask = apiClient.getTask;
    originalCancelTask = apiClient.cancelTask;
  });

  afterEach(() => {
    apiClient.getTask = originalGetTask;
    apiClient.cancelTask = originalCancelTask;
    state.openTaskId = undefined;
    _resetProjectionState();
  });

  // ------------------------------------------------------------
  // 1. State Eligibility Matrix
  // ------------------------------------------------------------

  it('correctly classifies eligible states via isTaskCancellable', () => {
    const eligibleStates = [
      'SUBMITTED',
      'POLICY_EVALUATED',
      'LEASED',
      'DISPATCHED',
      'EXECUTING',
      'AWAITING_APPROVAL',
    ];
    for (const st of eligibleStates) {
      assert.strictEqual(isTaskCancellable(st), true, `Expected ${st} to be cancellable`);
    }
  });

  it('correctly classifies ineligible states via isTaskCancellable', () => {
    const ineligibleStates = ['RECEIPT_VERIFIED', 'COMPLETED', 'FAILED', 'CANCELLED'];
    for (const st of ineligibleStates) {
      assert.strictEqual(isTaskCancellable(st), false, `Expected ${st} NOT to be cancellable`);
    }
  });

  it('renders "Cancel Task" button for all eligible states', async () => {
    const eligibleStates = [
      'SUBMITTED',
      'POLICY_EVALUATED',
      'LEASED',
      'DISPATCHED',
      'EXECUTING',
      'AWAITING_APPROVAL',
    ];

    for (const st of eligibleStates) {
      apiClient.getTask = async () => ({
        taskId: `task-${st}`,
        title: `Task in ${st}`,
        state: st,
        tenantId: 'tenant-1',
        submittedBy: 'user-1',
        targetAgentId: 'agent-1',
        capabilityId: 'cap-1',
        runtimeCategory: 'security',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await openTaskDetail(`task-${st}`);
      const cancelBtn = mockDoc.getElementById('task-cancel-btn');
      assert.ok(cancelBtn, `Expected cancel button for state ${st}`);
      assert.strictEqual(cancelBtn?.textContent, 'Cancel Task');
    }
  });

  it('does NOT render "Cancel Task" button for ineligible states', async () => {
    const ineligibleStates = ['RECEIPT_VERIFIED', 'COMPLETED', 'FAILED', 'CANCELLED'];

    for (const st of ineligibleStates) {
      apiClient.getTask = async () => ({
        taskId: `task-${st}`,
        title: `Task in ${st}`,
        state: st,
        tenantId: 'tenant-1',
        submittedBy: 'user-1',
        targetAgentId: 'agent-1',
        capabilityId: 'cap-1',
        runtimeCategory: 'security',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await openTaskDetail(`task-${st}`);
      const cancelBtn = mockDoc.getElementById('task-cancel-btn');
      assert.strictEqual(cancelBtn, null, `Expected no cancel button for state ${st}`);
    }
  });

  // ------------------------------------------------------------
  // 2. Confirmation Flow & Semantic Copy
  // ------------------------------------------------------------

  it('clicking Cancel Task displays confirmation dialog without triggering API call', async () => {
    let apiCalled = false;
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    apiClient.cancelTask = async () => {
      apiCalled = true;
      throw new Error('Should not be called yet');
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn');
    const confirmBox = mockDoc.getElementById('cancel-confirmation-box');

    assert.ok(cancelBtn);
    assert.ok(confirmBox);
    assert.strictEqual(confirmBox?.style.display, 'none');

    // Trigger click on Cancel Task
    cancelBtn.click();

    assert.strictEqual(cancelBtn.style.display, 'none');
    assert.strictEqual(confirmBox.style.display, 'block');
    assert.strictEqual(apiCalled, false, 'No cancellation API call on initial click');
  });

  it('confirmation copy accurately describes logical cancellation and worker limits', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await openTaskDetail('task-test-1');
    const confirmBox = mockDoc.getElementById('cancel-confirmation-box');
    const desc = mockDoc.getElementById('cancel-confirm-desc');

    assert.ok(confirmBox);
    assert.ok(desc);
    const boxHtml = confirmBox.outerHTML;
    assert.ok(boxHtml.includes('as cancelled in the control plane'));
    assert.ok(boxHtml.includes('reject subsequent execution receipts'));
    assert.ok(boxHtml.includes('in-flight worker steps may continue'));
    assert.ok(boxHtml.includes('external side effects may not be reversible'));
    assert.ok(!boxHtml.includes('immediately terminates the process'));
  });

  it('clicking Keep Task Running aborts confirmation without calling API', async () => {
    let apiCalled = false;
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    apiClient.cancelTask = async () => {
      apiCalled = true;
      throw new Error('Should not be called');
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    const confirmBox = mockDoc.getElementById('cancel-confirmation-box')!;
    const abortBtn = mockDoc.getElementById('abort-cancel-btn')!;

    // Open confirmation
    cancelBtn.click();
    assert.strictEqual(confirmBox.style.display, 'block');

    // Abort confirmation
    abortBtn.click();
    assert.strictEqual(confirmBox.style.display, 'none');
    assert.strictEqual(cancelBtn.style.display, '');
    assert.strictEqual(apiCalled, false);
  });

  // ------------------------------------------------------------
  // 3. API Invocation, Reason Passing & Duplicate Guard
  // ------------------------------------------------------------

  it('passes correct taskId and optional reason to apiClient.cancelTask', async () => {
    let receivedTaskId = '';
    let receivedReason: string | undefined = '';

    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async (taskId: string, reason?: string) => {
      receivedTaskId = taskId;
      receivedReason = reason;
      return {
        taskId,
        tenantId: 'tenant-1',
        submittedBy: 'user-1',
        title: 'Active Task',
        targetAgentId: 'agent-1',
        capabilityId: 'cap-1',
        runtimeCategory: 'security',
        state: 'CANCELLED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const reasonInput = mockDoc.getElementById('cancel-reason-input')!;
    reasonInput.value = 'Operator requested test cancellation';

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    confirmBtn.click();

    // Allow async tick
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(receivedTaskId, 'task-test-1');
    assert.strictEqual(receivedReason, 'Operator requested test cancellation');
  });

  it('passes undefined reason when reason input is empty', async () => {
    let receivedReason: string | undefined = 'initial';

    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async (taskId: string, reason?: string) => {
      receivedReason = reason;
      return {
        taskId,
        tenantId: 'tenant-1',
        submittedBy: 'user-1',
        title: 'Active Task',
        targetAgentId: 'agent-1',
        capabilityId: 'cap-1',
        runtimeCategory: 'security',
        state: 'CANCELLED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    confirmBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(receivedReason, undefined);
  });

  it('prevents duplicate submissions and displays truthful pending state', async () => {
    let callCount = 0;
    let resolveApiCall: (val: unknown) => void;

    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async (taskId: string) => {
      callCount++;
      return new Promise((resolve) => {
        resolveApiCall = () =>
          resolve({
            taskId,
            tenantId: 'tenant-1',
            submittedBy: 'user-1',
            title: 'Active Task',
            targetAgentId: 'agent-1',
            capabilityId: 'cap-1',
            runtimeCategory: 'security',
            state: 'CANCELLED',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
      });
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    const abortBtn = mockDoc.getElementById('abort-cancel-btn')!;

    // First click
    confirmBtn.click();
    assert.strictEqual(callCount, 1);
    assert.strictEqual(confirmBtn.disabled, true);
    assert.strictEqual(confirmBtn.getAttribute('aria-disabled'), 'true');
    assert.strictEqual(abortBtn.disabled, true);
    assert.strictEqual(confirmBtn.textContent, 'Cancelling...');

    // Second click while in flight should be a no-op
    confirmBtn.click();
    assert.strictEqual(callCount, 1, 'Duplicate click must not trigger second API request');

    // Resolve API call
    resolveApiCall!(null);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // After success, actions are removed
    assert.strictEqual(mockDoc.getElementById('confirm-cancel-btn'), null);
  });

  // ------------------------------------------------------------
  // 4. Successful Response State Updates
  // ------------------------------------------------------------

  it('successful cancellation updates modal status badge, table row, and removes controls', async () => {
    state.tasks = [
      {
        taskId: 'task-test-1',
        title: 'Active Task',
        state: 'EXECUTING',
        tenantId: 'tenant-1',
        submittedBy: 'user-1',
        targetAgentId: 'agent-1',
        capabilityId: 'cap-1',
        runtimeCategory: 'security',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async (taskId: string) => ({
      taskId,
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      title: 'Active Task',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      state: 'CANCELLED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    confirmBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Modal status badge
    const modalBadge = mockDoc.querySelector('#task-detail-content .status-badge');
    assert.ok(modalBadge?.className.includes('status-badge--cancelled'));
    assert.strictEqual(modalBadge?.textContent, 'Cancelled');

    // Task table row
    const rowBadge = mockDoc.querySelector('.task-row[data-task-id="task-test-1"] .status-badge');
    assert.ok(rowBadge?.className.includes('status-badge--cancelled'));
    assert.strictEqual(rowBadge?.textContent, 'Cancelled');

    // Controls removed
    assert.strictEqual(mockDoc.getElementById('task-detail-actions'), null);
    assert.strictEqual(mockDoc.getElementById('cancel-confirmation-box'), null);

    // State updated
    assert.strictEqual(state.tasks[0]?.state, 'CANCELLED');

    // Accessible announcement
    const announcement = mockDoc.getElementById('task-detail-announcement');
    assert.ok(announcement?.textContent.includes('cancelled successfully'));
  });

  // ------------------------------------------------------------
  // 5. Error & Ineligible State Handling
  // ------------------------------------------------------------

  it('handles backend 500 rejection for ineligible transition safely', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async () => {
      throw new DashboardAPIError(
        500,
        {
          code: 'INTERNAL_SERVER_ERROR',
          message: "Cannot cancel task 'task-test-1': task is already COMPLETED.",
        },
        '/v1/tasks/task-test-1/cancel',
      );
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    confirmBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Buttons re-enabled
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.getAttribute('aria-disabled'), null);
    assert.strictEqual(confirmBtn.textContent, 'Confirm Cancellation');

    // Error displayed
    const errorEl = mockDoc.getElementById('cancel-error-message')!;
    assert.strictEqual(errorEl.style.display, 'block');
    assert.ok(errorEl.textContent.includes('ineligible state or already completed'));
  });

  it('handles 404 / cross-tenant non-disclosing error safely', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async () => {
      throw new DashboardAPIError(
        404,
        { code: 'TASK_NOT_FOUND', message: 'Task task-test-1 not found.' },
        '/v1/tasks/task-test-1/cancel',
      );
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    confirmBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const errorEl = mockDoc.getElementById('cancel-error-message')!;
    assert.strictEqual(errorEl.style.display, 'block');
    assert.ok(errorEl.textContent.includes('Task not found or access denied'));
  });

  it('handles network failure with uncertain outcome notice', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async () => {
      throw new Error('TypeError: fetch failed');
    };

    await openTaskDetail('task-test-1');
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    cancelBtn.click();

    const confirmBtn = mockDoc.getElementById('confirm-cancel-btn')!;
    confirmBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const errorEl = mockDoc.getElementById('cancel-error-message')!;
    assert.strictEqual(errorEl.style.display, 'block');
    assert.ok(errorEl.textContent.includes('Cancellation status uncertain due to network failure'));
  });

  // ------------------------------------------------------------
  // 6. Live SSE & Concurrency Reconciliation
  // ------------------------------------------------------------

  it('removes cancellation controls when live SSE event reports task is COMPLETED', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await openTaskDetail('task-test-1');
    assert.ok(mockDoc.getElementById('task-cancel-btn'));

    // Open confirmation
    mockDoc.getElementById('task-cancel-btn')!.click();
    assert.ok(mockDoc.getElementById('cancel-confirmation-box'));

    // Incoming SSE event: task completes on server
    projectTaskStatusChanged(
      {
        taskId: 'task-test-1',
        tenantId: 'tenant-1',
        title: 'Active Task',
        state: 'COMPLETED',
        previousState: 'EXECUTING',
        targetAgentId: 'agent-1',
      },
      new Date().toISOString(),
    );

    // Controls must be surgically removed
    assert.strictEqual(mockDoc.getElementById('task-detail-actions'), null);
    assert.strictEqual(mockDoc.getElementById('cancel-confirmation-box'), null);

    // Badge updated
    const modalBadge = mockDoc.querySelector('#task-detail-content .status-badge');
    assert.strictEqual(modalBadge?.textContent, 'Completed');
  });

  it('stale response protection: does not modify DOM if modal switched during request', async () => {
    let resolveApiCall: (val: unknown) => void;

    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    apiClient.cancelTask = async (taskId: string) => {
      return new Promise((resolve) => {
        resolveApiCall = () =>
          resolve({
            taskId,
            tenantId: 'tenant-1',
            submittedBy: 'user-1',
            title: 'Active Task',
            targetAgentId: 'agent-1',
            capabilityId: 'cap-1',
            runtimeCategory: 'security',
            state: 'CANCELLED',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
      });
    };

    await openTaskDetail('task-test-1');
    mockDoc.getElementById('task-cancel-btn')!.click();
    mockDoc.getElementById('confirm-cancel-btn')!.click();

    // User switches to a different task detail modal before response returns
    state.openTaskId = 'task-other-2';

    // Set up other task modal content
    const modalBadge = mockDoc.querySelector('#task-detail-content .status-badge')!;
    modalBadge.className = 'status-badge status-badge--executing';
    modalBadge.textContent = 'Executing';

    // Resolve the delayed cancel response for task-test-1
    resolveApiCall!(null);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Modal must NOT have been updated to Cancelled
    assert.strictEqual(modalBadge.textContent, 'Executing');
  });

  // ------------------------------------------------------------
  // 7. Keyboard Navigation & Accessibility
  // ------------------------------------------------------------

  it('Escape key dismisses confirmation box without closing parent modal', async () => {
    apiClient.getTask = async () => ({
      taskId: 'task-test-1',
      title: 'Active Task',
      state: 'EXECUTING',
      tenantId: 'tenant-1',
      submittedBy: 'user-1',
      targetAgentId: 'agent-1',
      capabilityId: 'cap-1',
      runtimeCategory: 'security',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await openTaskDetail('task-test-1');
    const modal = mockDoc.getElementById('task-detail-modal')!;
    const cancelBtn = mockDoc.getElementById('task-cancel-btn')!;
    const confirmBox = mockDoc.getElementById('cancel-confirmation-box')!;

    // Open confirmation
    cancelBtn.click();
    assert.strictEqual(confirmBox.style.display, 'block');
    assert.strictEqual(modal.open, true);

    // Press Escape
    modal.dispatchEvent({ type: 'keydown', key: 'Escape' });

    // Confirmation box dismissed, cancel button restored, modal remains open
    assert.strictEqual(confirmBox.style.display, 'none');
    assert.strictEqual(cancelBtn.style.display, '');
    assert.strictEqual(modal.open, true);
  });
});
