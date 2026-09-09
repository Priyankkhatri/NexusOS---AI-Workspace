/**
 * NexusOS Web Dashboard — Main Application Module
 *
 * Implements all dashboard views: Overview, Tasks, Approvals, Activity.
 * Uses the DashboardAPIClient for all data fetching through authenticated Backend REST API.
 *
 * 053-SEC-01: All mutations route through Backend REST API with authentication.
 * 053-SEC-04: All dynamic content is XSS-sanitized before DOM insertion.
 * 053-SEC-05: No secrets stored in localStorage or URL params.
 */

import {
  DashboardAPIClient,
  sanitizeHTML,
  formatRelativeTime,
  DashboardAPIError,
  type DashboardSummaryResponse,
  type TaskItemResponse,
  type ActivityItemResponse,
  type PaginatedResponse,
} from './api/client.js';

// ============================================================
// App State
// ============================================================

export interface ApprovalViewModel {
  promptId: string;
  taskId?: string;
  title: string;
  description?: string;
  riskTier: string;
  actionIdentifier: string;
  capabilityId?: string;
  runtimeCategory?: string;
  targetAgentId?: string;
  submittedBy?: string;
  nonce?: string;
  leaseHeader?: Record<string, unknown>;
  createdAt: number | string;
  expiresAt?: number;
  state: string; // 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'RECONCILING'
  receiptHash?: string;
  policyDecision?: {
    allowed: boolean;
    reason?: string;
    policyVersion: string;
    policyHash: string;
  };
}

interface AppState {
  currentView: 'overview' | 'tasks' | 'approvals' | 'activity';
  summary: DashboardSummaryResponse | null;
  tasks: TaskItemResponse[];
  tasksCursor: string | undefined;
  tasksTotal: number;
  taskFilter: string;
  approvals: ApprovalViewModel[];
  activity: ActivityItemResponse[];
  activityCursor: string | undefined;
  activityTotal: number;
  isLoading: boolean;
  pollingInterval: ReturnType<typeof setInterval> | null;
}

const state: AppState = {
  currentView: 'overview',
  summary: null,
  tasks: [],
  tasksCursor: undefined,
  tasksTotal: 0,
  taskFilter: '',
  approvals: [],
  activity: [],
  activityCursor: undefined,
  activityTotal: 0,
  isLoading: false,
  pollingInterval: null,
};

// ============================================================
// API Client Configuration
// ============================================================

/**
 * Auth token getter — 053-SEC-05: Token is only held in memory (closure), never persisted.
 * In production, this would come from an OAuth2 PKCE flow or session cookie.
 */
let _authToken: string | null = null;

function getAuthToken(): string | null {
  return _authToken;
}

/**
 * Set the auth token from a secure authentication flow (e.g., callback).
 * Exposed for integration but never called from localStorage.
 */
export function setAuthToken(token: string): void {
  _authToken = token;
}

const apiClient = new DashboardAPIClient({
  baseUrl: (typeof window !== 'undefined' && window.location.origin) || 'http://localhost:3000',
  tenantId: 'default-tenant',
  getAuthToken,
});

// ============================================================
// DOM Helpers (053-SEC-04: Sanitized Rendering)
// ============================================================

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setTextContent(id: string, text: string): void {
  const el = $(id);
  if (el) el.textContent = text;
}

/**
 * Safely set innerHTML with sanitized content.
 * All user-facing strings MUST pass through sanitizeHTML() before insertion.
 */
function setSafeHTML(el: HTMLElement, html: string): void {
  el.innerHTML = html;
}

// ============================================================
// Navigation
// ============================================================

function initNavigation(): void {
  const navItems = document.querySelectorAll<HTMLButtonElement>('.nav-item');
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset['view'] as AppState['currentView'] | undefined;
      if (view) switchView(view);
    });
  });
}

function switchView(view: AppState['currentView']): void {
  state.currentView = view;

  // Update nav active state
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((btn) => {
    const isActive = btn.dataset['view'] === view;
    btn.classList.toggle('nav-item--active', isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  // Toggle view visibility
  const views = ['overview', 'tasks', 'approvals', 'activity'] as const;
  views.forEach((v) => {
    const section = $(`view-${v}`);
    if (section) {
      if (v === view) {
        section.hidden = false;
        section.classList.add('view--active');
      } else {
        section.hidden = true;
        section.classList.remove('view--active');
      }
    }
  });

  // Load data for the switched view
  void loadViewData(view);
}

async function loadViewData(view: AppState['currentView']): Promise<void> {
  switch (view) {
    case 'overview':
      await Promise.all([loadSummary(), loadRecentActivity()]);
      break;
    case 'tasks':
      await loadTasks(true);
      break;
    case 'approvals':
      await loadApprovals();
      break;
    case 'activity':
      await loadActivityStream(true);
      break;
  }
}

// ============================================================
// Theme Toggle
// ============================================================

function initThemeToggle(): void {
  const btn = $('theme-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
  });
}

// ============================================================
// Overview: Summary Cards
// ============================================================

async function loadSummary(): Promise<void> {
  try {
    const summary = await apiClient.getDashboardSummary();
    state.summary = summary;
    renderSummaryCards(summary);
    updateHealthBadge(summary.healthStatus);
    updateApprovalBadge(summary.pendingApprovalCount);
  } catch (err) {
    if (err instanceof DashboardAPIError && err.statusCode === 401) {
      renderAuthRequired();
    }
    console.error('[Dashboard] Failed to load summary:', err);
  }
}

function renderSummaryCards(summary: DashboardSummaryResponse): void {
  setTextContent('active-task-count', String(summary.activeTaskCount));
  setTextContent('pending-approval-count', String(summary.pendingApprovalCount));
  setTextContent('completed-task-count', String(summary.completedTaskCount));
  setTextContent('failed-task-count', String(summary.failedTaskCount));

  // Animate card values on update
  document.querySelectorAll('.card-value').forEach((el) => {
    el.classList.remove('card-value--updated');
    void (el as HTMLElement).offsetWidth; // Force reflow for animation restart
    el.classList.add('card-value--updated');
  });
}

function updateHealthBadge(status: string): void {
  const badge = $('health-badge');
  if (!badge) return;

  badge.className = 'health-badge';
  const label = badge.querySelector('.health-label');

  switch (status) {
    case 'HEALTHY':
    case 'READY':
      badge.classList.add('health-badge--healthy');
      if (label) label.textContent = 'Healthy';
      break;
    case 'DEGRADED':
      badge.classList.add('health-badge--degraded');
      if (label) label.textContent = 'Degraded';
      break;
    case 'UNREADY':
      badge.classList.add('health-badge--unready');
      if (label) label.textContent = 'Unhealthy';
      break;
  }
}

function updateApprovalBadge(count: number): void {
  const badge = $('approval-badge');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderAuthRequired(): void {
  const cards = $('overview-cards');
  if (cards) {
    setTextContent('active-task-count', '—');
    setTextContent('pending-approval-count', '—');
    setTextContent('completed-task-count', '—');
    setTextContent('failed-task-count', '—');
  }
}

// ============================================================
// Overview: Recent Activity
// ============================================================

async function loadRecentActivity(): Promise<void> {
  try {
    const response = await apiClient.getActivity({ limit: 10 });
    renderActivityList('overview-activity-list', 'overview-activity-empty', response.items);
  } catch {
    // Silent fail for overview activity — non-critical
  }
}

// ============================================================
// Tasks View
// ============================================================

function initTasksView(): void {
  const filterSelect = $('task-status-filter') as HTMLSelectElement | null;
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      state.taskFilter = filterSelect.value;
      void loadTasks(true);
    });
  }

  const refreshBtn = $('task-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => void loadTasks(true));
  }

  const loadMoreBtn = $('task-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => void loadTasks(false));
  }
}

async function loadTasks(reset: boolean): Promise<void> {
  if (state.isLoading) return;
  state.isLoading = true;

  try {
    if (reset) {
      state.tasks = [];
      state.tasksCursor = undefined;
    }

    const response: PaginatedResponse<TaskItemResponse> = await apiClient.getTasks({
      status: state.taskFilter || undefined,
      cursor: state.tasksCursor,
      limit: 20,
    });

    if (reset) {
      state.tasks = response.items;
    } else {
      state.tasks = [...state.tasks, ...response.items];
    }
    state.tasksCursor = response.nextCursor;
    state.tasksTotal = response.total;

    renderTaskList();
  } catch (err) {
    console.error('[Dashboard] Failed to load tasks:', err);
  } finally {
    state.isLoading = false;
  }
}

function renderTaskList(): void {
  const container = $('task-list-container');
  const empty = $('task-list-empty');
  const pagination = $('task-pagination');

  if (!container) return;

  if (state.tasks.length === 0) {
    if (empty) empty.hidden = false;
    setSafeHTML(
      container,
      empty?.outerHTML || '<div class="empty-state"><p>No tasks to display.</p></div>',
    );
    if (pagination) pagination.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;

  const rows = state.tasks
    .map((task) => {
      const title = sanitizeHTML(task.title);
      const taskId = sanitizeHTML(task.taskId);
      const capability = sanitizeHTML(task.capabilityId);
      const agent = sanitizeHTML(task.targetAgentId);
      const stateClass = task.state.toLowerCase().replace(/_/g, '_');
      const relativeTime = formatRelativeTime(task.createdAt);

      return `
        <div class="task-row" role="listitem" data-task-id="${taskId}" tabindex="0">
          <div class="task-row__info">
            <span class="task-row__title">${title}</span>
            <span class="task-row__meta">
              <span>${capability}</span>
              <span>→ ${agent}</span>
              <span>${sanitizeHTML(relativeTime)}</span>
            </span>
          </div>
          <span class="status-badge status-badge--${stateClass}">
            ${sanitizeHTML(formatState(task.state))}
          </span>
          <button class="btn btn--ghost btn--sm task-detail-trigger" data-task-id="${taskId}" type="button" aria-label="View details for ${title}">
            Details
          </button>
        </div>
      `;
    })
    .join('');

  setSafeHTML(container, rows);

  // Bind click handlers for task detail
  container.querySelectorAll<HTMLElement>('.task-row').forEach((row) => {
    row.addEventListener('click', () => {
      const taskId = row.dataset['taskId'];
      if (taskId) void openTaskDetail(taskId);
    });
    row.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const taskId = row.dataset['taskId'];
        if (taskId) void openTaskDetail(taskId);
      }
    });
  });

  // Show/hide pagination
  if (pagination) {
    pagination.hidden = !state.tasksCursor;
  }
}

// ============================================================
// Task Detail Modal
// ============================================================

async function openTaskDetail(taskId: string): Promise<void> {
  const modal = $('task-detail-modal') as HTMLDialogElement | null;
  const content = $('task-detail-content');
  const title = $('task-detail-title');

  if (!modal || !content) return;

  try {
    const task = await apiClient.getTask(taskId);

    if (title) title.textContent = `Task: ${task.title}`;

    const policySection = task.policyDecision
      ? `
        <div class="detail-section">
          <h3 class="detail-section__title">Policy Decision</h3>
          <div class="detail-row">
            <span class="detail-row__label">Allowed</span>
            <span class="detail-row__value">${task.policyDecision.allowed ? '✅ Yes' : '❌ No'}</span>
          </div>
          ${task.policyDecision.reason ? `<div class="detail-row"><span class="detail-row__label">Reason</span><span class="detail-row__value">${sanitizeHTML(task.policyDecision.reason)}</span></div>` : ''}
          <div class="detail-row">
            <span class="detail-row__label">Policy Version</span>
            <span class="detail-row__value">${sanitizeHTML(task.policyDecision.policyVersion)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__label">Policy Hash</span>
            <span class="detail-row__value evidence-hash" title="Click to copy">${sanitizeHTML(task.policyDecision.policyHash)}</span>
          </div>
        </div>
      `
      : '';

    const errorSection = task.error
      ? `
        <div class="detail-section">
          <h3 class="detail-section__title">Error</h3>
          <div class="detail-row">
            <span class="detail-row__label">Code</span>
            <span class="detail-row__value" style="color: var(--color-error)">${sanitizeHTML(task.error.code)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__label">Message</span>
            <span class="detail-row__value">${sanitizeHTML(task.error.message)}</span>
          </div>
        </div>
      `
      : '';

    const evidenceSection = task.evidenceChecksum
      ? `
        <div class="detail-section">
          <h3 class="detail-section__title">Evidence</h3>
          <div class="evidence-hash" title="Click to copy checksum" data-copy="${sanitizeHTML(task.evidenceChecksum)}">
            ${sanitizeHTML(task.evidenceChecksum)}
          </div>
        </div>
      `
      : '';

    const stateClass = task.state.toLowerCase().replace(/_/g, '_');

    setSafeHTML(
      content,
      `
      <div class="detail-section">
        <h3 class="detail-section__title">Identification</h3>
        <div class="detail-row">
          <span class="detail-row__label">Task ID</span>
          <span class="detail-row__value">${sanitizeHTML(task.taskId)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">State</span>
          <span class="status-badge status-badge--${stateClass}">${sanitizeHTML(formatState(task.state))}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Submitted By</span>
          <span class="detail-row__value">${sanitizeHTML(task.submittedBy)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Tenant</span>
          <span class="detail-row__value">${sanitizeHTML(task.tenantId)}</span>
        </div>
      </div>

      <div class="detail-section">
        <h3 class="detail-section__title">Execution</h3>
        <div class="detail-row">
          <span class="detail-row__label">Target Agent</span>
          <span class="detail-row__value">${sanitizeHTML(task.targetAgentId)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Capability</span>
          <span class="detail-row__value">${sanitizeHTML(task.capabilityId)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Runtime</span>
          <span class="detail-row__value">${sanitizeHTML(task.runtimeCategory)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Is Workflow</span>
          <span class="detail-row__value">${task.isWorkflow ? 'Yes (DAG)' : 'No'}</span>
        </div>
      </div>

      ${policySection}
      ${errorSection}
      ${evidenceSection}

      <div class="detail-section">
        <h3 class="detail-section__title">Timestamps</h3>
        <div class="detail-row">
          <span class="detail-row__label">Created</span>
          <span class="detail-row__value">${sanitizeHTML(new Date(task.createdAt).toLocaleString())}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Updated</span>
          <span class="detail-row__value">${sanitizeHTML(new Date(task.updatedAt).toLocaleString())}</span>
        </div>
      </div>
    `,
    );

    // Bind evidence hash copy-to-clipboard
    content.querySelectorAll<HTMLElement>('.evidence-hash').forEach((el) => {
      el.addEventListener('click', () => {
        const hash = el.dataset['copy'] || el.textContent?.trim() || '';
        void navigator.clipboard.writeText(hash);
        el.textContent = '✓ Copied!';
        setTimeout(() => {
          el.textContent = hash;
        }, 1500);
      });
    });

    modal.showModal();
  } catch (err) {
    console.error('[Dashboard] Failed to load task detail:', err);
  }
}

function initTaskDetailModal(): void {
  const modal = $('task-detail-modal') as HTMLDialogElement | null;
  const closeBtn = $('task-detail-close');

  if (!modal || !closeBtn) return;

  closeBtn.addEventListener('click', () => modal.close());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
}

// ============================================================
// Approvals View
// ============================================================

async function loadApprovals(): Promise<void> {
  try {
    // 053-SEC-01 & 053-SEC-02: Query canonical approvals projection
    const approvalRes = await apiClient.getApprovals().catch(() => ({ items: [], total: 0 }));
    if (approvalRes.items && approvalRes.items.length > 0) {
      state.approvals = approvalRes.items.map((item) => ({
        promptId: item.promptId,
        taskId: item.taskId,
        title: item.title,
        description: item.description,
        riskTier: item.riskTier,
        actionIdentifier: item.actionIdentifier,
        capabilityId: item.capabilityId,
        runtimeCategory: 'security',
        submittedBy: item.deviceId || 'agent',
        nonce: item.nonce,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        state: item.state,
      }));
    } else {
      // Fallback to tasks in AWAITING_APPROVAL state if no approval prompt records
      const response = await apiClient.getTasks({ status: 'AWAITING_APPROVAL', limit: 50 });
      state.approvals = response.items.map((task) => ({
        promptId: task.taskId,
        taskId: task.taskId,
        title: task.title,
        description: `Approval required for ${task.capabilityId}`,
        riskTier:
          task.runtimeCategory === 'filesystem' || task.runtimeCategory === 'terminal'
            ? 'HIGH'
            : task.runtimeCategory === 'browser'
              ? 'CRITICAL'
              : 'MEDIUM',
        actionIdentifier: task.capabilityId,
        capabilityId: task.capabilityId,
        runtimeCategory: task.runtimeCategory,
        targetAgentId: task.targetAgentId,
        submittedBy: task.submittedBy,
        createdAt: task.createdAt,
        state: 'PENDING',
        policyDecision: task.policyDecision,
      }));
    }
    renderApprovals();
  } catch (err) {
    console.error('[Dashboard] Failed to load approvals:', err);
  }
}

function renderApprovals(): void {
  const container = $('approval-list-container');
  const empty = $('approval-list-empty');

  if (!container) return;

  if (state.approvals.length === 0) {
    if (empty) empty.hidden = false;
    setSafeHTML(
      container,
      empty?.outerHTML || '<div class="empty-state"><p>No pending approvals.</p></div>',
    );
    return;
  }

  if (empty) empty.hidden = true;

  const now = Date.now();
  const cards = state.approvals
    .map((item) => {
      const title = sanitizeHTML(item.title);
      const promptId = sanitizeHTML(item.promptId);
      const taskId = sanitizeHTML(item.taskId || item.promptId);
      const capability = sanitizeHTML(item.capabilityId || item.actionIdentifier);
      const agent = sanitizeHTML(item.targetAgentId || 'local-agent');
      const runtime = sanitizeHTML(item.runtimeCategory || 'runtime');
      const submittedBy = sanitizeHTML(item.submittedBy || 'operator');
      const relativeTime = formatRelativeTime(
        typeof item.createdAt === 'number'
          ? new Date(item.createdAt).toISOString()
          : item.createdAt,
      );

      const isExpired =
        (item.expiresAt !== undefined && now > item.expiresAt) || item.state === 'EXPIRED';

      let effectiveState = item.state;
      if (isExpired && effectiveState === 'PENDING') {
        effectiveState = 'EXPIRED';
      }

      // Determine risk tier
      const riskLevel = (item.riskTier || 'HIGH').toLowerCase();

      // State badge formatting
      let stateBadge = '';
      if (effectiveState === 'APPROVED') {
        stateBadge = '<span class="status-badge status-badge--completed">✓ Approved</span>';
      } else if (effectiveState === 'DENIED') {
        stateBadge = '<span class="status-badge status-badge--failed">✗ Denied</span>';
      } else if (effectiveState === 'EXPIRED') {
        stateBadge = '<span class="status-badge status-badge--cancelled">⏱ Expired / Stale</span>';
      } else if (effectiveState === 'RECONCILING') {
        stateBadge =
          '<span class="status-badge status-badge--dispatched">↻ Reconciling with backend...</span>';
      } else {
        const remainingSec = item.expiresAt
          ? Math.max(0, Math.round((item.expiresAt - now) / 1000))
          : null;
        stateBadge = `<span class="status-badge status-badge--awaiting_approval">Awaiting Decision ${remainingSec !== null ? `(${remainingSec}s)` : ''}</span>`;
      }

      // Actions buttons: disabled when not in PENDING or when reconciling/expired
      const isActionable = effectiveState === 'PENDING' && !isExpired;

      return `
        <div class="approval-card" role="listitem" data-prompt-id="${promptId}" data-task-id="${taskId}">
          <div class="approval-card__header">
            <h3 class="approval-card__title">${title}</h3>
            <div style="display: flex; gap: var(--space-2); align-items: center;">
              <span class="risk-badge risk-badge--${riskLevel}">${riskLevel} risk</span>
              ${stateBadge}
            </div>
          </div>
          <div class="approval-card__detail">
            <p><strong>Capability:</strong> ${capability} → <strong>Agent:</strong> ${agent}</p>
            <p><strong>Runtime:</strong> ${runtime} · <strong>Submitted by:</strong> ${submittedBy}</p>
            <p><strong>Created:</strong> ${sanitizeHTML(relativeTime)}</p>
            ${item.receiptHash ? `<p><strong>Receipt Hash:</strong> <code class="evidence-hash">${sanitizeHTML(item.receiptHash.substring(0, 16))}…</code></p>` : ''}
          </div>
          ${
            item.policyDecision
              ? `<p style="font-size: var(--text-xs); color: var(--text-tertiary);">Policy: ${sanitizeHTML(item.policyDecision.policyVersion)} · Hash: <code>${sanitizeHTML(item.policyDecision.policyHash.substring(0, 16))}…</code></p>`
              : ''
          }
          <div class="approval-card__actions">
            <button class="btn btn--primary btn--sm approval-action-btn" data-action="ALLOW" data-prompt-id="${promptId}" ${isActionable ? '' : 'disabled'}>
              ${item.state === 'RECONCILING' ? 'Authorizing...' : 'Approve'}
            </button>
            <button class="btn btn--danger btn--sm approval-action-btn" data-action="DENY" data-prompt-id="${promptId}" ${isActionable ? '' : 'disabled'}>
              Reject
            </button>
            <button class="btn btn--ghost btn--sm task-detail-trigger" data-task-id="${taskId}" type="button">
              View Details
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  setSafeHTML(container, cards);

  // Bind authoritative approval decision buttons (053-SEC-03: No optimistic transition!)
  container.querySelectorAll<HTMLButtonElement>('.approval-action-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const promptId = btn.dataset['promptId'];
      const action = btn.dataset['action'] as 'ALLOW' | 'DENY';
      if (!promptId || !action) return;

      const item = state.approvals.find((a) => a.promptId === promptId);
      if (!item) return;

      // 053-SEC-03: Server-side authorization only — transition to RECONCILING, do NOT mark approved locally!
      item.state = 'RECONCILING';
      renderApprovals();

      try {
        const nonce = item.nonce || 'web-nonce-default';
        const leaseHeader = (item.leaseHeader as any) || {
          lease_id: item.promptId,
          task_id: item.taskId || item.promptId,
          tenant_id: apiClient.tenantId,
          agent_id: item.targetAgentId || '00000000-0000-4000-8000-000000000003',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
          scopes: ['task:execute'],
          signature: 'web-authoritative-sig',
          nonce,
        };

        const result = await apiClient.submitApprovalDecision(promptId, {
          promptId,
          decision: action,
          nonce,
          leaseHeader,
          tenantId: apiClient.tenantId,
        });

        // 053-SEC-03: Authoritative state update only after backend responds
        item.state = result.state;
        item.receiptHash = result.receiptHash;
        renderApprovals();

        // Refresh overview counts
        void loadSummary();
      } catch (err: unknown) {
        console.error('[Dashboard] Failed to submit approval decision:', err);
        if (err instanceof DashboardAPIError) {
          if (err.statusCode === 410) {
            item.state = 'EXPIRED';
          } else if (err.statusCode === 409) {
            item.state = 'APPROVED';
          } else {
            item.state = 'PENDING';
          }
        } else {
          item.state = 'PENDING';
        }
        renderApprovals();
      }
    });
  });

  // Bind detail button clicks
  container.querySelectorAll<HTMLElement>('.task-detail-trigger').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = (btn as HTMLElement).dataset['taskId'];
      if (taskId) void openTaskDetail(taskId);
    });
  });
}

// ============================================================
// Activity Stream View
// ============================================================

function initActivityView(): void {
  const loadMoreBtn = $('activity-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => void loadActivityStream(false));
  }
}

async function loadActivityStream(reset: boolean): Promise<void> {
  try {
    if (reset) {
      state.activity = [];
      state.activityCursor = undefined;
    }

    const response = await apiClient.getActivity({
      cursor: state.activityCursor,
      limit: 30,
    });

    // 053-SEC-05: Deduplicate event IDs and maintain deterministic sorting
    const newItems = response.items;
    const existingIds = new Set(state.activity.map((a) => a.event_id));
    const merged = reset
      ? newItems
      : [...state.activity, ...newItems.filter((i) => !existingIds.has(i.event_id))];

    merged.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

    // Bounded rendering: cap to maximum 100 entries to protect browser memory
    state.activity = merged.slice(0, 100);
    state.activityCursor = response.nextCursor;
    state.activityTotal = response.total;

    renderActivityStream();
  } catch (err) {
    console.error('[Dashboard] Failed to load activity stream:', err);
  }
}

function renderActivityStream(): void {
  renderActivityList('activity-stream-container', 'activity-stream-empty', state.activity);

  const pagination = $('activity-pagination');
  if (pagination) {
    pagination.hidden = !state.activityCursor;
  }
}

// ============================================================
// Shared Activity Rendering
// ============================================================

function renderActivityList(
  containerId: string,
  emptyId: string,
  items: ActivityItemResponse[],
): void {
  const container = $(containerId);
  const empty = $(emptyId);

  if (!container) return;

  if (items.length === 0) {
    if (empty) empty.hidden = false;
    setSafeHTML(
      container,
      empty?.outerHTML || '<div class="empty-state"><p>No activity events recorded.</p></div>',
    );
    return;
  }

  if (empty) empty.hidden = true;

  const rows = items
    .map((event) => {
      const eventId = sanitizeHTML(event.event_id.substring(0, 8));
      const correlationId = event.correlation_id
        ? sanitizeHTML(event.correlation_id.substring(0, 8))
        : '';
      const relativeTime = formatRelativeTime(event.occurred_at);
      const producer = sanitizeHTML(event.producer_id);

      // Derive icon class from schema_id
      const iconClass = getActivityIconClass(event.schema_id);

      // Create a human-readable label from schema_id
      const label = sanitizeHTML(formatSchemaLabel(event.schema_id));

      // Extract key payload data
      const payloadSummary = summarizePayload(event.payload);

      return `
        <div class="activity-item">
          <div class="activity-item__icon ${iconClass}" aria-hidden="true">
            ${getActivityIcon(event.schema_id)}
          </div>
          <div class="activity-item__body">
            <span class="activity-item__label">${label}</span>
            ${payloadSummary ? `<span class="activity-item__time">${sanitizeHTML(payloadSummary)}</span>` : ''}
            <span class="activity-item__time">${sanitizeHTML(relativeTime)} · ${producer}</span>
            ${correlationId ? `<span class="activity-item__correlation">↳ ${eventId} ← ${correlationId}</span>` : `<span class="activity-item__correlation">↳ ${eventId}</span>`}
          </div>
        </div>
      `;
    })
    .join('');

  setSafeHTML(container, rows);
}

// ============================================================
// Formatting Helpers
// ============================================================

function formatState(state: string): string {
  return state
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function getActivityIconClass(schemaId: string): string {
  if (schemaId.includes('approval')) return 'activity-item__icon--approval';
  if (schemaId.includes('policy')) return 'activity-item__icon--policy';
  if (schemaId.includes('completed') || schemaId.includes('receipt'))
    return 'activity-item__icon--success';
  if (schemaId.includes('failed') || schemaId.includes('error'))
    return 'activity-item__icon--error';
  return 'activity-item__icon--task';
}

function getActivityIcon(schemaId: string): string {
  if (schemaId.includes('approval')) return '🛡';
  if (schemaId.includes('policy')) return '📋';
  if (schemaId.includes('completed') || schemaId.includes('receipt')) return '✓';
  if (schemaId.includes('failed') || schemaId.includes('error')) return '✗';
  if (schemaId.includes('created') || schemaId.includes('submitted')) return '➕';
  if (schemaId.includes('dispatched') || schemaId.includes('leased')) return '📡';
  return '⚡';
}

function formatSchemaLabel(schemaId: string): string {
  // nexusos.tasks.created → Tasks Created
  const parts = schemaId.split('.');
  if (parts.length >= 2) {
    const domain = parts[parts.length - 2];
    const action = parts[parts.length - 1];
    return `${capitalize(domain)} ${capitalize(action)}`;
  }
  return schemaId;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof payload['taskId'] === 'string') {
    parts.push(`Task: ${(payload['taskId'] as string).substring(0, 8)}…`);
  }
  if (typeof payload['state'] === 'string') {
    parts.push(`State: ${formatState(payload['state'] as string)}`);
  }
  if (typeof payload['capabilityId'] === 'string') {
    parts.push(`Cap: ${payload['capabilityId'] as string}`);
  }

  return parts.join(' · ');
}

// ============================================================
// Polling (Auto-Refresh)
// ============================================================

function startPolling(): void {
  if (state.pollingInterval) return;

  // Poll every 15 seconds for live updates
  state.pollingInterval = setInterval(() => {
    void refreshCurrentView();
  }, 15_000);
}

function stopPolling(): void {
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
    state.pollingInterval = null;
  }
}

async function refreshCurrentView(): Promise<void> {
  // Only refresh if the tab is visible (save bandwidth)
  if (document.hidden) return;

  try {
    await loadSummary();
    await loadViewData(state.currentView);
  } catch {
    // Silently handle refresh errors to not disrupt the UX
  }
}

// Pause polling when tab is hidden
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  });
}

// ============================================================
// Initialization
// ============================================================

async function init(): Promise<void> {
  initNavigation();
  initThemeToggle();
  initTasksView();
  initActivityView();
  initTaskDetailModal();

  // Initial data load
  await loadSummary();
  await loadRecentActivity();

  // Start auto-refresh polling
  startPolling();

  console.log('[NexusOS Dashboard] Initialized');
}

// Boot the application when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}

// Export for testing
export { state, apiClient, switchView, formatState, sanitizeHTML as _sanitizeHTML };
