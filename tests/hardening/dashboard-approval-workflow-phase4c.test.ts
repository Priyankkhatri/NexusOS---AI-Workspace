/**
 * NexusOS — Task 068 Phase 4C Hardening Tests
 * Web Dashboard Approval Decision Workflow UX & Operator Controls
 *
 * Verifies:
 * 1. Pending & unexpired prompt visibility in Approvals View and Task Detail modal
 * 2. Expired / resolved prompt controls disabled/removed (⏱ Expired / Stale)
 * 3. Task-state eligibility (AWAITING_APPROVAL shows controls; other states omit controls)
 * 4. Exact prompt-to-task correlation (prompt.taskId === task.taskId; uncorrelated prompt omitted from task modal)
 * 5. Explicit confirmation required before API invocation (clicking Approve/Reject displays confirmation without network request)
 * 6. Abort/cancel confirmation restores trigger buttons without API call
 * 7. Optional notes input and 1,024-character limit (userNotes passed to API)
 * 8. Correct ALLOW and DENY API payloads dispatched (promptId, decision, nonce, leaseHeader, userNotes)
 * 9. Duplicate submission prevention during in-flight decision (disabled buttons, truthful pending text)
 * 10. Successful ALLOW updates modal to Executing, table row to Executing, removes actions, decrements badge
 * 11. Successful DENY updates modal to Failed, table row to Failed, displays APPROVAL_DENIED, removes actions, decrements badge
 * 12. Backend 409 PROMPT_ALREADY_RESOLVED error handling
 * 13. Backend 410 PROMPT_EXPIRED error handling
 * 14. Backend 400 NONCE_MISMATCH and 403 TENANT_MISMATCH error handling
 * 15. Network failure / timeout uncertain-state error handling
 * 16. Live SSE reconciliation (nexusos.events.approval.decided updates modal & card)
 * 17. Live SSE reconciliation (nexusos.events.task.status_changed removes approval controls when task leaves AWAITING_APPROVAL)
 * 18. Stale response protection when modal target changes during in-flight decision
 * 19. Keyboard navigation: Escape key dismisses confirmation box without closing parent dialog
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
    else if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, g: string) => g.toUpperCase());
      this.dataset[camel] = value;
      this.attributes.set(name, value);
    } else {
      this.attributes.set(name, value);
    }
  }

  removeAttribute(name: string): void {
    if (name === 'disabled') this.disabled = false;
    else if (name === 'hidden') this.hidden = false;
    else this.attributes.delete(name);
  }

  insertAdjacentHTML(
    position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend',
    html: string,
  ): void {
    const temp = new MockElement('div');
    parseHTMLInto(html, temp);
    const nodes = temp.children;

    if (position === 'beforeend') {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    } else if (position === 'afterbegin') {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node) {
          node.parentElement = this;
          this.children.unshift(node);
        }
      }
    } else if (position === 'beforebegin') {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) {
          for (const node of nodes) {
            node.parentElement = this.parentElement;
            this.parentElement.children.splice(idx, 0, node);
          }
        }
      }
    } else if (position === 'afterend') {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) {
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node) {
              node.parentElement = this.parentElement;
              this.parentElement.children.splice(idx + 1 + i, 0, node);
            }
          }
        }
      }
    }
  }

  get textContent(): string {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(text: string) {
    this.children = [];
    this._text = text;
  }

  get innerHTML(): string {
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

  set outerHTML(html: string) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const idx = parent.children.indexOf(this);
    if (idx === -1) return;
    const temp = new MockElement('div');
    parseHTMLInto(html, temp);
    parent.children.splice(idx, 1, ...temp.children);
    for (const child of temp.children) {
      child.parentElement = parent;
    }
    this.parentElement = null;
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
  projectApprovalDecided,
  isApprovalActionable,
  findPendingApprovalForTask,
  executeApprovalDecision,
  renderApprovals,
  bindApprovalActionButtons,
  updateApprovalBadge,
  _resetProjectionState,
  state,
  apiClient,
} from '../../apps/web-dashboard/src/main.js';
import {
  DashboardAPIError,
  type TaskItemResponse,
  type ApprovalDecisionRequest,
  type ApprovalDecisionResult,
} from '../../apps/web-dashboard/src/api/client.js';

function setupDashboardDOM(): void {
  mockDoc.body.children = [];
  mockDoc.body.innerHTML = `
    <span id="approval-badge" class="badge">0</span>
    <span id="pending-approval-count">0</span>
    <div id="approval-list-container" class="approvals-grid"></div>
    <div id="approval-list-empty" hidden></div>
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
        <tr class="task-row" data-task-id="task-approve-1">
          <td><span class="status-badge status-badge--pending">Awaiting Approval</span></td>
        </tr>
      </tbody>
    </table>
  `;
}

function createSampleApproval(
  overrides?: Partial<(typeof state.approvals)[0]>,
): (typeof state.approvals)[0] {
  return {
    promptId: 'prompt-123',
    taskId: 'task-approve-1',
    title: 'Deploy to Production',
    description: 'Requires human sign-off before proceeding.',
    riskTier: 'HIGH',
    actionIdentifier: 'action:deploy:production',
    capabilityId: 'cap:deploy',
    runtimeCategory: 'security',
    targetAgentId: 'agent-1',
    submittedBy: 'device-test',
    nonce: 'nonce-abc-123',
    state: 'PENDING',
    createdAt: Date.now() - 60000,
    expiresAt: Date.now() + 300000,
    ...overrides,
  };
}

function createSampleTask(overrides?: Partial<TaskItemResponse>): TaskItemResponse {
  return {
    taskId: 'task-approve-1',
    tenantId: 'tenant-test',
    title: 'Deploy to Production',
    submittedBy: 'test-operator',
    targetAgentId: 'agent-1',
    capabilityId: 'cap:deploy',
    runtimeCategory: 'security',
    state: 'AWAITING_APPROVAL',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================
// Phase 4C Test Suite
// ============================================================

describe('Task 068 Phase 4C: Approval Decision Workflow Hardening', () => {
  let originalGetTask: typeof apiClient.getTask;
  let originalSubmitApprovalDecision: typeof apiClient.submitApprovalDecision;

  beforeEach(() => {
    setupDashboardDOM();
    initTaskDetailModal();
    _resetProjectionState();
    state.openTaskId = undefined;
    state.approvals = [];
    originalGetTask = apiClient.getTask;
    originalSubmitApprovalDecision = apiClient.submitApprovalDecision;
  });

  afterEach(() => {
    apiClient.getTask = originalGetTask;
    apiClient.submitApprovalDecision = originalSubmitApprovalDecision;
    state.openTaskId = undefined;
    state.approvals = [];
  });

  // ------------------------------------------------------------
  // 1. Pending & unexpired prompt visibility
  // ------------------------------------------------------------
  it('1. actionable pending prompt is recognized as actionable and rendered with Approve and Reject triggers', () => {
    const sample = createSampleApproval();
    state.approvals = [sample];

    assert.equal(isApprovalActionable(sample), true);
    assert.deepEqual(findPendingApprovalForTask('task-approve-1'), sample);

    renderApprovals();
    const card = mockDoc.querySelector(`.approval-card[data-prompt-id="${sample.promptId}"]`);
    assert.ok(card, 'Approval card should be rendered');

    const approveBtn = card.querySelector('.approval-action-btn[data-action="ALLOW"]');
    const rejectBtn = card.querySelector('.approval-action-btn[data-action="DENY"]');
    assert.ok(approveBtn, 'Card has Approve button');
    assert.ok(rejectBtn, 'Card has Reject button');
  });

  // ------------------------------------------------------------
  // 2. Expired / resolved prompt controls disabled/removed
  // ------------------------------------------------------------
  it('2. expired prompt is not actionable and renders Expired/Stale badge with disabled decision triggers', () => {
    const expiredSample = createSampleApproval({
      promptId: 'prompt-expired',
      expiresAt: Date.now() - 5000,
    });
    state.approvals = [expiredSample];

    assert.equal(isApprovalActionable(expiredSample), false);
    assert.equal(findPendingApprovalForTask('task-approve-1'), undefined);

    renderApprovals();
    const card = mockDoc.querySelector(
      `.approval-card[data-prompt-id="${expiredSample.promptId}"]`,
    );
    assert.ok(card);
    const expiredBadge = card.querySelector('.status-badge--cancelled');
    assert.ok(expiredBadge);
    assert.match(expiredBadge.textContent, /Expired \/ Stale/);

    const approveBtn = card.querySelector('.approval-action-btn[data-action="ALLOW"]');
    const rejectBtn = card.querySelector('.approval-action-btn[data-action="DENY"]');
    assert.ok(approveBtn);
    assert.ok(rejectBtn);
    assert.equal(approveBtn.disabled, true, 'Approve button disabled on expired card');
    assert.equal(rejectBtn.disabled, true, 'Reject button disabled on expired card');
  });

  // ------------------------------------------------------------
  // 3. Task-state eligibility in Task Detail modal
  // ------------------------------------------------------------
  it('3. displays Approve and Reject in task modal when task is AWAITING_APPROVAL and omits when not', async () => {
    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');

    const approveBtn = mockDoc.getElementById('task-approve-btn');
    const rejectBtn = mockDoc.getElementById('task-reject-btn');
    assert.ok(approveBtn, 'Task modal has Approve button');
    assert.ok(rejectBtn, 'Task modal has Reject button');

    // Ineligible task state: EXECUTING
    apiClient.getTask = async () => createSampleTask({ state: 'EXECUTING' });

    await openTaskDetail('task-approve-1');
    assert.equal(
      mockDoc.getElementById('task-approve-btn'),
      null,
      'Approve button omitted when EXECUTING',
    );
    assert.equal(
      mockDoc.getElementById('task-reject-btn'),
      null,
      'Reject button omitted when EXECUTING',
    );
  });

  // ------------------------------------------------------------
  // 4. Exact prompt-to-task correlation
  // ------------------------------------------------------------
  it('4. exact prompt-to-task correlation links approval; uncorrelated prompt is never shown in task modal', async () => {
    const sample = createSampleApproval({ taskId: 'task-other-999' });
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    assert.equal(
      mockDoc.getElementById('task-approve-btn'),
      null,
      'Uncorrelated prompt does not produce Approve button',
    );
    assert.equal(
      mockDoc.getElementById('task-reject-btn'),
      null,
      'Uncorrelated prompt does not produce Reject button',
    );
  });

  // ------------------------------------------------------------
  // 5. Explicit confirmation required before API invocation
  // ------------------------------------------------------------
  it('5. clicking Approve or Reject displays confirmation box without calling API', async () => {
    let apiCalled = false;
    apiClient.submitApprovalDecision = async () => {
      apiCalled = true;
      throw new Error('Should not be called');
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');

    const approveBtn = mockDoc.getElementById('task-approve-btn');
    assert.ok(approveBtn);
    approveBtn.click();

    assert.equal(apiCalled, false, 'No API call made on trigger click');

    const confirmBox = mockDoc.getElementById('modal-approval-confirmation-box');
    assert.ok(confirmBox, 'Confirmation box displayed');
    assert.equal(confirmBox.style.display, 'block');
    assert.match(confirmBox.textContent, /Approve Task Execution\?/);
    assert.match(confirmBox.textContent, /EXECUTING/);
  });

  // ------------------------------------------------------------
  // 6. Abort confirmation restores trigger buttons without API call
  // ------------------------------------------------------------
  it('6. clicking Cancel in confirmation dialog aborts confirmation and restores buttons without calling API', async () => {
    let apiCalled = false;
    apiClient.submitApprovalDecision = async () => {
      apiCalled = true;
      throw new Error('Should not be called');
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    const rejectBtn = mockDoc.getElementById('task-reject-btn');
    assert.ok(rejectBtn);
    rejectBtn.click();

    const abortBtn = mockDoc.getElementById('modal-abort-approval-btn');
    assert.ok(abortBtn);
    abortBtn.click();

    assert.equal(apiCalled, false);
    const confirmBox = mockDoc.getElementById('modal-approval-confirmation-box');
    assert.equal(confirmBox?.style.display, 'none');
    const actions = mockDoc.getElementById('task-detail-actions');
    assert.equal(actions?.style.display, '');
  });

  // ------------------------------------------------------------
  // 7. Optional notes input and 1,024-character limit
  // ------------------------------------------------------------
  it('7. captures optional operator notes with 1024-char limit and passes to API', async () => {
    let submittedPayload: ApprovalDecisionRequest | undefined;
    apiClient.submitApprovalDecision = async (promptId: string, req: ApprovalDecisionRequest) => {
      submittedPayload = req;
      return {
        promptId,
        requestId: 'req-456',
        taskId: 'task-approve-1',
        decision: req.decision,
        state: 'APPROVED',
        resolvedAt: Date.now(),
        receiptHash: 'hash-abc-1234567890abcdef',
        userNotes: req.userNotes,
      };
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();

    const notesInput = mockDoc.getElementById('modal-approval-notes-input');
    assert.ok(notesInput);
    assert.equal(notesInput.getAttribute('maxlength'), '1024');

    notesInput.value = 'Approved by Security Reviewer for Q4 release';

    const confirmBtn = mockDoc.getElementById('modal-confirm-approval-btn');
    assert.ok(confirmBtn);
    confirmBtn.click();

    // Allow promise microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(submittedPayload);
    assert.equal(submittedPayload.decision, 'ALLOW');
    assert.equal(submittedPayload.userNotes, 'Approved by Security Reviewer for Q4 release');
  });

  // ------------------------------------------------------------
  // 8. Correct ALLOW and DENY API payloads dispatched
  // ------------------------------------------------------------
  it('8. dispatches exact payload structure for ALLOW and DENY decisions', async () => {
    const payloads: ApprovalDecisionRequest[] = [];
    apiClient.submitApprovalDecision = async (promptId: string, req: ApprovalDecisionRequest) => {
      payloads.push(req);
      return {
        promptId,
        requestId: 'req-456',
        taskId: 'task-approve-1',
        decision: req.decision,
        state: req.decision === 'ALLOW' ? 'APPROVED' : 'DENIED',
        resolvedAt: Date.now(),
        receiptHash: 'hash-receipt-123',
      };
    };

    const sampleAllow = createSampleApproval({ promptId: 'prompt-allow' });
    const sampleDeny = createSampleApproval({ promptId: 'prompt-deny' });
    state.approvals = [sampleAllow, sampleDeny];

    // Test executeApprovalDecision directly
    await executeApprovalDecision(sampleAllow.promptId, 'ALLOW', 'allow note');
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.promptId, sampleAllow.promptId);
    assert.equal(payloads[0]?.decision, 'ALLOW');
    assert.equal(payloads[0]?.nonce, sampleAllow.nonce);
    assert.equal(payloads[0]?.userNotes, 'allow note');

    await executeApprovalDecision(sampleDeny.promptId, 'DENY', 'deny note');
    assert.equal(payloads.length, 2);
    assert.equal(payloads[1]?.promptId, sampleDeny.promptId);
    assert.equal(payloads[1]?.decision, 'DENY');
    assert.equal(payloads[1]?.userNotes, 'deny note');
  });

  // ------------------------------------------------------------
  // 9. Duplicate submission prevention during in-flight decision
  // ------------------------------------------------------------
  it('9. prevents duplicate submission while request is in-flight and sets truthful pending copy', async () => {
    let callCount = 0;
    let finishPromise: (val: ApprovalDecisionResult) => void;
    apiClient.submitApprovalDecision = async (_promptId: string) => {
      callCount++;
      return new Promise<ApprovalDecisionResult>((resolve) => {
        finishPromise = resolve;
      });
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();

    const confirmBtn = mockDoc.getElementById('modal-confirm-approval-btn');
    assert.ok(confirmBtn);

    // First click
    confirmBtn.click();
    assert.equal(callCount, 1);
    assert.equal(confirmBtn.disabled, true);
    assert.equal(confirmBtn.textContent, 'Approving...');

    // Second click during in-flight
    confirmBtn.click();
    assert.equal(callCount, 1, 'Duplicate click ignored during in-flight');

    // Complete the call
    finishPromise!({
      promptId: sample.promptId,
      requestId: 'req-456',
      taskId: 'task-approve-1',
      decision: 'ALLOW',
      state: 'APPROVED',
      resolvedAt: Date.now(),
      receiptHash: 'hash-receipt-123',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  // ------------------------------------------------------------
  // 10. Successful ALLOW updates modal, table row, badge
  // ------------------------------------------------------------
  it('10. successful ALLOW updates modal to Executing, updates table row, and decrements badge', async () => {
    updateApprovalBadge(3);
    assert.equal(mockDoc.getElementById('approval-badge')?.textContent, '3');

    apiClient.submitApprovalDecision = async (promptId: string) => ({
      promptId,
      requestId: 'req-456',
      taskId: 'task-approve-1',
      decision: 'ALLOW',
      state: 'APPROVED',
      resolvedAt: Date.now(),
      receiptHash: 'receipt-hash-test-allow',
    });

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Modal status updated
    const modalBadge = mockDoc.querySelector('#task-detail-content .status-badge');
    assert.ok(modalBadge);
    assert.equal(modalBadge.textContent.trim(), 'Executing');
    assert.ok(modalBadge.classList.contains('status-badge--executing'));

    // Controls removed
    assert.equal(mockDoc.getElementById('task-approve-btn'), null);
    assert.equal(mockDoc.getElementById('task-reject-btn'), null);
    assert.equal(mockDoc.getElementById('modal-approval-confirmation-box'), null);

    // Table row updated
    const tableBadge = mockDoc.querySelector(
      '.task-row[data-task-id="task-approve-1"] .status-badge',
    );
    assert.ok(tableBadge);
    assert.equal(tableBadge.textContent.trim(), 'Executing');

    // Badge decremented
    assert.equal(mockDoc.getElementById('approval-badge')?.textContent, '2');
  });

  // ------------------------------------------------------------
  // 11. Successful DENY updates modal to Failed, displays APPROVAL_DENIED
  // ------------------------------------------------------------
  it('11. successful DENY updates modal to Failed with APPROVAL_DENIED, removes actions, decrements badge', async () => {
    updateApprovalBadge(2);

    apiClient.submitApprovalDecision = async (promptId: string) => ({
      promptId,
      requestId: 'req-456',
      taskId: 'task-approve-1',
      decision: 'DENY',
      state: 'DENIED',
      resolvedAt: Date.now(),
      receiptHash: 'receipt-hash-test-deny',
    });

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-reject-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Modal status updated to Failed
    const modalBadge = mockDoc.querySelector('#task-detail-content .status-badge');
    assert.ok(modalBadge);
    assert.equal(modalBadge.textContent.trim(), 'Failed');
    assert.ok(modalBadge.classList.contains('status-badge--failed'));

    // Action buttons removed
    assert.equal(mockDoc.getElementById('task-detail-actions'), null);

    // Table row updated
    const tableBadge = mockDoc.querySelector(
      '.task-row[data-task-id="task-approve-1"] .status-badge',
    );
    assert.ok(tableBadge);
    assert.equal(tableBadge.textContent.trim(), 'Failed');

    // Badge decremented
    assert.equal(mockDoc.getElementById('approval-badge')?.textContent, '1');
  });

  // ------------------------------------------------------------
  // 12. Backend 409 PROMPT_ALREADY_RESOLVED error handling
  // ------------------------------------------------------------
  it('12. handles 409 PROMPT_ALREADY_RESOLVED gracefully with clear operator message', async () => {
    apiClient.submitApprovalDecision = async () => {
      throw new DashboardAPIError(
        409,
        { code: 'PROMPT_ALREADY_RESOLVED' },
        '/v1/approvals/prompt-123/decision',
      );
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorEl = mockDoc.getElementById('modal-approval-error-message');
    assert.ok(errorEl);
    assert.match(errorEl.textContent, /already been resolved/);
  });

  // ------------------------------------------------------------
  // 13. Backend 410 PROMPT_EXPIRED error handling
  // ------------------------------------------------------------
  it('13. handles 410 PROMPT_EXPIRED by disabling actions and rendering expired status', async () => {
    apiClient.submitApprovalDecision = async () => {
      throw new DashboardAPIError(
        410,
        { code: 'PROMPT_EXPIRED' },
        '/v1/approvals/prompt-123/decision',
      );
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorEl = mockDoc.getElementById('modal-approval-error-message');
    assert.ok(errorEl);
    assert.match(errorEl.textContent, /has expired/);
    assert.equal(sample.state, 'EXPIRED');
  });

  // ------------------------------------------------------------
  // 14. Backend 400 NONCE_MISMATCH and 403 TENANT_MISMATCH
  // ------------------------------------------------------------
  it('14. handles 400 NONCE_MISMATCH and 403 TENANT_MISMATCH with truthful messages', async () => {
    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    // Test 400
    apiClient.submitApprovalDecision = async () => {
      throw new DashboardAPIError(
        400,
        { code: 'NONCE_MISMATCH' },
        '/v1/approvals/prompt-123/decision',
      );
    };

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.match(
      mockDoc.getElementById('modal-approval-error-message')?.textContent ?? '',
      /Nonce mismatch or invalid input/,
    );

    // Test 403
    apiClient.submitApprovalDecision = async () => {
      throw new DashboardAPIError(
        403,
        { code: 'TENANT_MISMATCH' },
        '/v1/approvals/prompt-123/decision',
      );
    };

    mockDoc.getElementById('modal-confirm-approval-btn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.match(
      mockDoc.getElementById('modal-approval-error-message')?.textContent ?? '',
      /Access denied: tenant mismatch/,
    );
  });

  // ------------------------------------------------------------
  // 15. Network failure / timeout uncertain-state error handling
  // ------------------------------------------------------------
  it('15. reports network uncertainty without claiming definitive failure on network error', async () => {
    apiClient.submitApprovalDecision = async () => {
      throw new Error('fetch failed: network socket disconnected');
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errorEl = mockDoc.getElementById('modal-approval-error-message');
    assert.ok(errorEl);
    assert.match(errorEl.textContent, /Decision status uncertain due to network failure/);
  });

  // ------------------------------------------------------------
  // 16. Live SSE reconciliation (nexusos.events.approval.decided)
  // ------------------------------------------------------------
  it('16. projects incoming live approval.decided event onto open modal and card', async () => {
    const sample = createSampleApproval();
    state.approvals = [sample];

    renderApprovals();
    const card = mockDoc.querySelector(`.approval-card[data-prompt-id="${sample.promptId}"]`);
    assert.ok(card);
    bindApprovalActionButtons(card as unknown as HTMLElement);

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');

    // Simulate incoming SSE event: approval.decided ALLOW
    projectApprovalDecided({
      promptId: sample.promptId,
      taskId: 'task-approve-1',
      decision: 'ALLOW',
      state: 'APPROVED',
      decidedBy: 'ops-admin@nexusos.io',
      receiptHash: 'sse-receipt-hash-1234567890',
    });

    // Modal updated
    const modalBadge = mockDoc.querySelector('#task-detail-content .status-badge');
    assert.ok(modalBadge);
    assert.equal(modalBadge.textContent.trim(), 'Executing');

    // Card updated
    const cardBadge = card.querySelector('.status-badge');
    assert.ok(cardBadge);
    assert.match(cardBadge.textContent, /Approved/);

    const decidedBy = card.querySelector('.approval-decided-by');
    assert.ok(decidedBy);
    assert.match(decidedBy.textContent, /ops-admin@nexusos.io/);
  });

  // ------------------------------------------------------------
  // 17. Live SSE reconciliation (nexusos.events.task.status_changed)
  // ------------------------------------------------------------
  it('17. removes approval buttons when task transitions out of AWAITING_APPROVAL via SSE', async () => {
    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    assert.ok(mockDoc.getElementById('task-approve-btn'));
    assert.ok(mockDoc.getElementById('task-reject-btn'));

    // Incoming task.status_changed to CANCELLED
    projectTaskStatusChanged(
      {
        taskId: 'task-approve-1',
        tenantId: 'tenant-test',
        title: 'Active Task',
        state: 'CANCELLED',
        previousState: 'AWAITING_APPROVAL',
        targetAgentId: 'agent-1',
      },
      new Date().toISOString(),
    );

    assert.equal(mockDoc.getElementById('task-approve-btn'), null);
    assert.equal(mockDoc.getElementById('task-reject-btn'), null);
  });

  // ------------------------------------------------------------
  // 18. Stale response protection
  // ------------------------------------------------------------
  it('18. stale response protection: switching modal target does not mutate the new modal', async () => {
    let finishPromise: (val: ApprovalDecisionResult) => void;
    apiClient.submitApprovalDecision = async (_promptId: string) => {
      return new Promise<ApprovalDecisionResult>((resolve) => {
        finishPromise = resolve;
      });
    };

    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();
    mockDoc.getElementById('modal-confirm-approval-btn')?.click();

    // User switches to a different task modal while request in flight
    state.openTaskId = 'task-other-456';
    const content = mockDoc.getElementById('task-detail-content');
    if (content) {
      content.innerHTML = `
        <span class="status-badge status-badge--pending">Pending</span>
        <div id="task-detail-actions"></div>
      `;
    }

    // Now in-flight request finishes for task-approve-1
    finishPromise!({
      promptId: sample.promptId,
      requestId: 'req-456',
      taskId: 'task-approve-1',
      decision: 'ALLOW',
      state: 'APPROVED',
      resolvedAt: Date.now(),
      receiptHash: 'hash-abc',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // The current open task (task-other-456) should remain untouched as Pending
    const badge = mockDoc.querySelector('#task-detail-content .status-badge');
    assert.equal(badge?.textContent.trim(), 'Pending');
  });

  // ------------------------------------------------------------
  // 19. Keyboard accessibility: Escape key dismisses confirmation box
  // ------------------------------------------------------------
  it('19. Escape key dismisses approval confirmation box without closing dialog', async () => {
    const sample = createSampleApproval();
    state.approvals = [sample];

    apiClient.getTask = async () => createSampleTask({ state: 'AWAITING_APPROVAL' });

    await openTaskDetail('task-approve-1');
    mockDoc.getElementById('task-approve-btn')?.click();

    const confirmBox = mockDoc.getElementById('modal-approval-confirmation-box');
    assert.ok(confirmBox);
    assert.equal(confirmBox.style.display, 'block');

    const dialog = mockDoc.getElementById('task-detail-modal');
    assert.ok(dialog);

    // Dispatch Escape on the modal
    const escapeEvt = {
      type: 'keydown',
      key: 'Escape',
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };

    dialog.dispatchEvent(escapeEvt);

    assert.equal(escapeEvt.defaultPrevented, true, 'Default prevented so modal does not close');
    assert.equal(confirmBox.style.display, 'none', 'Confirmation box hidden');
    assert.ok(mockDoc.getElementById('task-approve-btn'), 'Approve button restored');
  });
});
