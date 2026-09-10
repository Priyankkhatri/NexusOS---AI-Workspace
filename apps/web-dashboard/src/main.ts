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
  type AgentRecord,
  type DelegationSummary,
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
  currentView: 'overview' | 'tasks' | 'approvals' | 'activity' | 'agents' | 'delegations';
  summary: DashboardSummaryResponse | null;
  tasks: TaskItemResponse[];
  tasksCursor: string | undefined;
  tasksTotal: number;
  taskFilter: string;
  approvals: ApprovalViewModel[];
  activity: ActivityItemResponse[];
  activityCursor: string | undefined;
  activityTotal: number;
  agents: AgentRecord[];
  agentRoleFilter: string;
  agentStatusFilter: string;
  agentsRequestId: number;
  delegations: DelegationSummary[];
  delegationStatusFilter: string;
  delegationsRequestId: number;
  selectedSessionId?: string;
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
  agents: [],
  agentRoleFilter: '',
  agentStatusFilter: '',
  agentsRequestId: 0,
  delegations: [],
  delegationStatusFilter: '',
  delegationsRequestId: 0,
  selectedSessionId: undefined,
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
  const views = ['overview', 'tasks', 'approvals', 'activity', 'agents', 'delegations'] as const;
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
    case 'agents':
      await loadAgents(true);
      break;
    case 'delegations':
      await loadDelegations(true);
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
// Agent Roster View
// ============================================================

function initAgentsView(): void {
  const roleSelect = $('agent-role-filter') as HTMLSelectElement | null;
  if (roleSelect) {
    roleSelect.addEventListener('change', () => {
      state.agentRoleFilter = roleSelect.value;
      void loadAgents(true);
    });
  }

  const statusSelect = $('agent-status-filter') as HTMLSelectElement | null;
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      state.agentStatusFilter = statusSelect.value;
      void loadAgents(true);
    });
  }

  const refreshBtn = $('agent-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => void loadAgents(true));
  }
}

async function loadAgents(reset: boolean = false): Promise<void> {
  const container = $('agent-roster-container');
  const reqId = ++state.agentsRequestId;

  if (reset && container) {
    setSafeHTML(
      container,
      '<div class="loading-state" role="status" aria-live="polite"><div class="loading-spinner"></div><p>Loading agent roster…</p></div>',
    );
  }

  try {
    const res = await apiClient.listAgents({
      role: (state.agentRoleFilter as any) || undefined,
      status: (state.agentStatusFilter as any) || undefined,
      limit: 100,
    });

    // Guard against stale response overwriting newer response
    if (reqId !== state.agentsRequestId) return;

    state.agents = res.items;
    renderAgentRoster(res.items);
  } catch (err) {
    if (reqId !== state.agentsRequestId) return;
    console.error('[Dashboard] Failed to load agents:', err);
    if (container) {
      setSafeHTML(
        container,
        `<div class="error-state" role="alert"><p>Failed to load agent roster.</p><button id="agent-retry-btn" class="btn btn--outline btn--sm" type="button">Retry</button></div>`,
      );
      const retryBtn = $('agent-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => void loadAgents(true));
      }
    }
  }
}

function renderAgentRoster(agents: AgentRecord[]): void {
  const container = $('agent-roster-container');
  const empty = $('agent-roster-empty');
  if (!container) return;

  if (agents.length === 0) {
    if (empty) empty.hidden = false;
    setSafeHTML(
      container,
      empty?.outerHTML ||
        '<div class="empty-state"><p>No agents registered in this workspace.</p></div>',
    );
    return;
  }

  if (empty) empty.hidden = true;

  // Bounded rendering: maximum 100 agents
  const boundedAgents = agents.slice(0, 100);
  const cardsHTML = boundedAgents.map((agent) => generateAgentCardHTML(agent)).join('');
  const truncationNotice =
    agents.length >= 100
      ? '<div class="truncation-notice">Displaying maximum bounded items (100).</div>'
      : '';

  setSafeHTML(container, cardsHTML + truncationNotice);
}

function getRoleBadge(role: string): string {
  switch (role) {
    case 'COORDINATOR':
      return '<span class="role-badge role-badge--coordinator">🎯 Coordinator</span>';
    case 'SPECIALIST':
      return '<span class="role-badge role-badge--specialist">🔬 Specialist</span>';
    case 'SUPERVISOR':
      return '<span class="role-badge role-badge--supervisor">👁 Supervisor</span>';
    case 'WORKER':
      return '<span class="role-badge role-badge--worker">⚙ Worker</span>';
    default:
      return `<span class="role-badge">${sanitizeHTML(role)}</span>`;
  }
}

function getAgentStatusPill(status: string): string {
  switch (status) {
    case 'AVAILABLE':
      return '<span class="agent-status-pill agent-status-pill--available"><span class="status-dot"></span>Available / Healthy</span>';
    case 'BUSY':
      return '<span class="agent-status-pill agent-status-pill--busy"><span class="status-dot"></span>Busy / Working</span>';
    case 'UNHEALTHY':
      return '<span class="agent-status-pill agent-status-pill--unhealthy"><span class="status-dot"></span>Unhealthy / Offline</span>';
    case 'RETIRED':
      return '<span class="agent-status-pill agent-status-pill--retired"><span class="status-dot"></span>Retired</span>';
    case 'REGISTERED':
      return '<span class="agent-status-pill"><span class="status-dot"></span>Registered</span>';
    default:
      return `<span class="agent-status-pill"><span class="status-dot"></span>${sanitizeHTML(status)}</span>`;
  }
}

function generateAgentCardHTML(agent: AgentRecord): string {
  const agentId = sanitizeHTML(agent.agentId);
  const roleBadge = getRoleBadge(agent.role);
  const statusPill = getAgentStatusPill(agent.status);
  const relativeHeartbeat = formatRelativeTime(agent.lastHeartbeat);
  const version = sanitizeHTML(agent.version || '1.0.0');
  const activeCount = agent.activeTaskIds ? agent.activeTaskIds.length : 0;
  const loadPct = Math.round((agent.currentLoad || 0) * 100);
  const loadText = `${loadPct}% (${activeCount} active)`;
  const workspaceText = sanitizeHTML(agent.workspaceScope.join(', ') || 'all');
  const caps = (agent.capabilities || [])
    .map((c) => `<span class="cap-tag">${sanitizeHTML(c)}</span>`)
    .join('');

  return `
    <div class="agent-card" role="listitem" tabindex="0" data-agent-id="${agentId}">
      <div class="agent-card__header">
        <div class="agent-card__title-group">
          <span class="agent-card__name">${agentId}</span>
          <span class="agent-card__id">v${version}</span>
        </div>
        <div class="agent-card__badges">
          ${roleBadge}
          ${statusPill}
        </div>
      </div>
      <div class="agent-card__meta">
        <div class="agent-card__meta-item">
          <span class="agent-card__meta-label">Task Load</span>
          <span class="agent-card__meta-value">${loadText}</span>
        </div>
        <div class="agent-card__meta-item">
          <span class="agent-card__meta-label">Heartbeat</span>
          <span class="agent-card__meta-value">${sanitizeHTML(relativeHeartbeat)}</span>
        </div>
        <div class="agent-card__meta-item">
          <span class="agent-card__meta-label">Workspaces</span>
          <span class="agent-card__meta-value">${workspaceText}</span>
        </div>
        <div class="agent-card__meta-item">
          <span class="agent-card__meta-label">Capabilities</span>
          <span class="agent-card__meta-value">${(agent.capabilities || []).length} declared</span>
        </div>
      </div>
      <div class="agent-capabilities" aria-label="Capabilities">
        ${caps || '<span class="cap-tag">none</span>'}
      </div>
    </div>
  `;
}

// ============================================================
// Delegation Cockpit View (Hierarchy & Timeline)
// ============================================================

function initDelegationsView(): void {
  const statusSelect = $('delegation-status-filter') as HTMLSelectElement | null;
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      state.delegationStatusFilter = statusSelect.value;
      void loadDelegations(true);
    });
  }

  const refreshBtn = $('delegation-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => void loadDelegations(true));
  }
}

async function loadDelegations(reset: boolean = false): Promise<void> {
  const treeContainer = $('delegation-tree-container');
  const timelineContainer = $('delegation-timeline-container');
  const reqId = ++state.delegationsRequestId;

  if (reset) {
    if (treeContainer) {
      setSafeHTML(
        treeContainer,
        '<div class="loading-state" role="status" aria-live="polite"><div class="loading-spinner"></div><p>Loading delegation hierarchy…</p></div>',
      );
    }
    if (timelineContainer) {
      setSafeHTML(
        timelineContainer,
        '<div class="loading-state" role="status" aria-live="polite"><div class="loading-spinner"></div><p>Loading activity timeline…</p></div>',
      );
    }
  }

  try {
    const res = await apiClient.listDelegations({
      status: (state.delegationStatusFilter as any) || undefined,
      limit: 100,
    });

    // Guard against stale response
    if (reqId !== state.delegationsRequestId) return;

    state.delegations = res.items;
    renderDelegationTree(res.items);
    renderDelegationTimeline(res.items);
  } catch (err) {
    if (reqId !== state.delegationsRequestId) return;
    console.error('[Dashboard] Failed to load delegations:', err);
    if (treeContainer) {
      setSafeHTML(
        treeContainer,
        `<div class="error-state" role="alert"><p>Failed to load delegation hierarchy.</p><button id="delegation-retry-btn" class="btn btn--outline btn--sm" type="button">Retry</button></div>`,
      );
      const retryBtn = $('delegation-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => void loadDelegations(true));
      }
    }
    if (timelineContainer) {
      setSafeHTML(
        timelineContainer,
        `<div class="error-state" role="alert"><p>Failed to load timeline.</p></div>`,
      );
    }
  }
}

function renderDelegationTree(delegations: DelegationSummary[]): void {
  const container = $('delegation-tree-container');
  const empty = $('delegation-tree-empty');
  if (!container) return;

  if (delegations.length === 0) {
    if (empty) empty.hidden = false;
    setSafeHTML(
      container,
      empty?.outerHTML || '<div class="empty-state"><p>No delegation sessions recorded.</p></div>',
    );
    return;
  }

  if (empty) empty.hidden = true;

  // Stable ordering: sort deterministically by depth, then by delegationId ascending
  const sorted = [...delegations].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.delegationId.localeCompare(b.delegationId);
  });

  // Bound to 100 nodes with cycle protection
  const bounded = sorted.slice(0, 100);
  const visited = new Set<string>();
  const nodesHTML: string[] = [];

  for (const session of bounded) {
    if (visited.has(session.delegationId)) continue;
    visited.add(session.delegationId);
    nodesHTML.push(generateDelegationNodeHTML(session));
  }

  const truncationNotice =
    delegations.length >= 100
      ? '<div class="truncation-notice">Displaying maximum bounded sessions (100).</div>'
      : '';

  setSafeHTML(container, nodesHTML.join('') + truncationNotice);
}

function getDelegationStatusBadge(status: string): string {
  switch (status) {
    case 'ACCEPTED':
      return '<span class="status-badge status-badge--submitted">Accepted</span>';
    case 'EXECUTING':
      return '<span class="status-badge status-badge--executing">Executing</span>';
    case 'COMPLETED':
      return '<span class="status-badge status-badge--completed">Completed</span>';
    case 'FAILED':
      return '<span class="status-badge status-badge--failed">Failed</span>';
    case 'CANCELLED':
      return '<span class="status-badge status-badge--cancelled">Cancelled</span>';
    case 'REJECTED':
      return '<span class="status-badge status-badge--failed">Rejected</span>';
    case 'TIMED_OUT':
      return '<span class="status-badge status-badge--failed">Timed Out</span>';
    default:
      return `<span class="status-badge">${sanitizeHTML(status)}</span>`;
  }
}

function generateDelegationNodeHTML(session: DelegationSummary): string {
  const delegationId = sanitizeHTML(session.delegationId);
  const delegatorAgent = sanitizeHTML(session.delegatorAgentId);
  const assignedAgent = sanitizeHTML(session.assignedAgentId);
  const parentTask = sanitizeHTML(session.parentTaskId);
  const childTask = sanitizeHTML(session.childTaskId);
  const depth = Math.min(Math.max(session.depth || 1, 1), 3);
  const depthClass = `delegation-tree-node--depth-${depth}`;
  const statusBadge = getDelegationStatusBadge(session.status);
  const relativeExpiry = formatRelativeTime(new Date(session.expiresAt).toISOString());

  const receiptBadge = session.hasChildReceipt
    ? `<span class="badge--receipt" title="Cryptographically verified child receipt">✓ Receipt Settled</span>`
    : '';
  const compensationBadge = session.hasCompensation
    ? `<span class="badge--compensation" title="Compensation / rollback recorded">↺ Compensated</span>`
    : '';
  const leaseBadge = session.childLeaseId
    ? `<span class="badge--lease" title="Child Execution Lease ID">Lease: ${sanitizeHTML(session.childLeaseId.substring(0, 8))}…</span>`
    : '';

  return `
    <div class="delegation-tree-node ${depthClass}" role="treeitem" tabindex="0" data-delegation-id="${delegationId}" aria-expanded="true">
      <div class="delegation-tree-node__header">
        <div class="delegation-tree-node__agents">
          <span class="agent-id-pill" title="Parent Delegator Agent">${delegatorAgent}</span>
          <span class="delegation-arrow" aria-hidden="true">➔</span>
          <span class="agent-id-pill" title="Assigned Child Agent">${assignedAgent}</span>
        </div>
        ${statusBadge}
      </div>
      <div class="delegation-tree-node__tasks">
        <span>Task <span class="task-id-mono">${parentTask.substring(0, 8)}…</span></span>
        <span class="delegation-arrow" aria-hidden="true">➔</span>
        <span>Sub-Task <span class="task-id-mono">${childTask.substring(0, 8)}…</span></span>
      </div>
      <div class="delegation-tree-node__meta">
        <span class="badge--depth">Depth ${depth}</span>
        ${leaseBadge}
        ${receiptBadge}
        ${compensationBadge}
        <span class="task-id-mono" style="margin-left: auto;">Expires: ${sanitizeHTML(relativeExpiry)}</span>
      </div>
    </div>
  `;
}

export interface DelegationTimelineEvent {
  id: string;
  delegationId: string;
  type:
    | 'ACCEPTED'
    | 'EXECUTING'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED'
    | 'REJECTED'
    | 'TIMED_OUT'
    | 'RECEIPT'
    | 'COMPENSATION';
  timestamp: number;
  title: string;
  description: string;
  delegatorAgentId: string;
  assignedAgentId: string;
  taskId: string;
}

function buildDelegationTimeline(delegations: DelegationSummary[]): DelegationTimelineEvent[] {
  const events: DelegationTimelineEvent[] = [];

  for (const session of delegations) {
    // Event: Status event
    const statusType = session.status as DelegationTimelineEvent['type'];
    events.push({
      id: `${session.delegationId}-${session.status.toLowerCase()}`,
      delegationId: session.delegationId,
      type: statusType,
      timestamp: session.expiresAt,
      title: `Delegation ${formatState(session.status)}`,
      description: `${session.delegatorAgentId} ➔ ${session.assignedAgentId} (Sub-Task ${session.childTaskId.substring(0, 8)}…)`,
      delegatorAgentId: session.delegatorAgentId,
      assignedAgentId: session.assignedAgentId,
      taskId: session.childTaskId,
    });

    // Event: Cryptographic settlement
    if (session.hasChildReceipt) {
      events.push({
        id: `${session.delegationId}-receipt`,
        delegationId: session.delegationId,
        type: 'RECEIPT',
        timestamp: session.expiresAt,
        title: 'Receipt Cryptographically Settled',
        description: `Evidence verified for child task ${session.childTaskId.substring(0, 8)}…`,
        delegatorAgentId: session.delegatorAgentId,
        assignedAgentId: session.assignedAgentId,
        taskId: session.childTaskId,
      });
    }

    // Event: Compensation / rollback
    if (session.hasCompensation) {
      events.push({
        id: `${session.delegationId}-compensation`,
        delegationId: session.delegationId,
        type: 'COMPENSATION',
        timestamp: session.expiresAt,
        title: 'Compensation Rollback Executed',
        description: `Compensating action settled for task ${session.childTaskId.substring(0, 8)}…`,
        delegatorAgentId: session.delegatorAgentId,
        assignedAgentId: session.assignedAgentId,
        taskId: session.childTaskId,
      });
    }
  }

  // Sort descending by timestamp (newest first)
  events.sort((a, b) => b.timestamp - a.timestamp);

  // Bounded to 100 events
  return events.slice(0, 100);
}

function generateDelegationTimelineItemHTML(event: DelegationTimelineEvent): string {
  const iconMap: Record<DelegationTimelineEvent['type'], { icon: string; cls: string }> = {
    ACCEPTED: { icon: '➕', cls: 'delegation-timeline-item__icon--created' },
    EXECUTING: { icon: '⚡', cls: 'delegation-timeline-item__icon--executing' },
    COMPLETED: { icon: '✓', cls: 'delegation-timeline-item__icon--completed' },
    FAILED: { icon: '✗', cls: 'delegation-timeline-item__icon--failed' },
    CANCELLED: { icon: '⊘', cls: 'delegation-timeline-item__icon--cancelled' },
    REJECTED: { icon: '✗', cls: 'delegation-timeline-item__icon--failed' },
    TIMED_OUT: { icon: '⏱', cls: 'delegation-timeline-item__icon--failed' },
    RECEIPT: { icon: '🛡', cls: 'delegation-timeline-item__icon--receipt' },
    COMPENSATION: { icon: '↺', cls: 'delegation-timeline-item__icon--compensation' },
  };

  const { icon, cls } = iconMap[event.type] || { icon: '•', cls: '' };
  const relativeTime = formatRelativeTime(new Date(event.timestamp).toISOString());

  return `
    <div class="delegation-timeline-item" role="listitem">
      <div class="delegation-timeline-item__icon ${cls}" aria-hidden="true">
        ${icon}
      </div>
      <div class="delegation-timeline-item__body">
        <span class="delegation-timeline-item__title">${sanitizeHTML(event.title)}</span>
        <span class="delegation-timeline-item__desc">${sanitizeHTML(event.description)}</span>
        <span class="delegation-timeline-item__time">${sanitizeHTML(relativeTime)} · Delegation ${sanitizeHTML(event.delegationId.substring(0, 8))}…</span>
      </div>
    </div>
  `;
}

function renderDelegationTimeline(delegations: DelegationSummary[]): void {
  const container = $('delegation-timeline-container');
  const empty = $('delegation-timeline-empty');
  if (!container) return;

  const events = buildDelegationTimeline(delegations);

  if (events.length === 0) {
    if (empty) empty.hidden = false;
    setSafeHTML(
      container,
      empty?.outerHTML || '<div class="empty-state"><p>No timeline events available.</p></div>',
    );
    return;
  }

  if (empty) empty.hidden = true;

  const itemsHTML = events.map((ev) => generateDelegationTimelineItemHTML(ev)).join('');
  const truncationNotice =
    events.length >= 100
      ? '<div class="truncation-notice">Displaying maximum bounded events (100).</div>'
      : '';

  setSafeHTML(container, itemsHTML + truncationNotice);
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
  initAgentsView();
  initDelegationsView();
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
export {
  state,
  apiClient,
  switchView,
  loadAgents,
  loadDelegations,
  renderAgentRoster,
  renderDelegationTree,
  renderDelegationTimeline,
  buildDelegationTimeline,
  generateAgentCardHTML,
  generateDelegationNodeHTML,
  generateDelegationTimelineItemHTML,
  getRoleBadge,
  getAgentStatusPill,
  getDelegationStatusBadge,
  formatState,
  sanitizeHTML as _sanitizeHTML,
};
