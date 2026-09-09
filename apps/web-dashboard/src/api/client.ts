/**
 * NexusOS Web Dashboard — Authenticated HTTP API Client
 *
 * 053-SEC-01: All mutations route through Backend REST API with authentication.
 * 053-SEC-04: Response payloads are NOT trusted; XSS sanitization happens at render.
 * 053-SEC-05: Secrets and tokens NEVER stored in localStorage or URL parameters.
 */

export interface DashboardAPIConfig {
  baseUrl: string;
  tenantId: string;
  getAuthToken: () => string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  total: number;
}

export interface DashboardSummaryResponse {
  tenantId: string;
  activeTaskCount: number;
  pendingApprovalCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  connectedDeviceCount: number;
  totalTokenUsage?: number;
  vramAlert?: boolean;
  healthStatus: 'HEALTHY' | 'READY' | 'DEGRADED' | 'UNREADY';
  updatedAt: string;
}

export interface TaskItemResponse {
  taskId: string;
  tenantId: string;
  submittedBy: string;
  title: string;
  targetAgentId: string;
  capabilityId: string;
  runtimeCategory: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  isWorkflow?: boolean;
  error?: { code: string; message: string };
  evidenceChecksum?: string;
  receipt?: Record<string, unknown>;
  dag?: Record<string, unknown>;
  policyDecision?: {
    allowed: boolean;
    reason?: string;
    policyVersion: string;
    policyHash: string;
  };
}

export interface ActivityItemResponse {
  event_id: string;
  schema_id: string;
  version: string;
  correlation_id: string;
  occurred_at: string;
  producer_id: string;
  payload: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  version?: string;
  uptimeSeconds?: number;
  state?: string;
}

export interface ApprovalItemResponse {
  promptId: string;
  requestId: string;
  taskId?: string;
  stepId?: string;
  leaseId: string;
  tenantId: string;
  deviceId?: string;
  title: string;
  description: string;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actionIdentifier: string;
  capabilityId?: string;
  targetResource?: string;
  reversibility?: 'REVERSIBLE' | 'IRREVERSIBLE';
  nonce: string;
  state: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';
  createdAt: number;
  expiresAt: number;
  isLockScreenPrivate: boolean;
  metadata?: Record<string, unknown>;
}

export interface ApprovalDecisionRequest {
  promptId: string;
  decision: 'ALLOW' | 'DENY';
  nonce: string;
  leaseHeader: Record<string, unknown>;
  tenantId?: string;
  userNotes?: string;
  decidedBy?: string;
}

export interface ApprovalDecisionResult {
  promptId: string;
  requestId: string;
  taskId?: string;
  decision: 'ALLOW' | 'DENY';
  state: string;
  resolvedAt: number;
  receiptHash: string;
  userNotes?: string;
  decidedBy?: string;
}

export class DashboardAPIClient {
  private readonly baseUrl: string;
  private readonly _tenantId: string;
  private readonly getAuthToken: () => string | null;

  constructor(config: DashboardAPIConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this._tenantId = config.tenantId;
    this.getAuthToken = config.getAuthToken;
  }

  /** Expose configured tenantId for UI display (filtering is server-side per 053-SEC-02) */
  public get tenantId(): string {
    return this._tenantId;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = this.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      'X-Correlation-ID': crypto.randomUUID(),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new DashboardAPIError(
        response.status,
        (errorBody as Record<string, unknown>)?.['error'] as Record<string, unknown> | undefined,
        path,
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Check backend health / readiness
   */
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health/readiness');
  }

  /**
   * Get aggregated dashboard summary (053-SEC-02: tenant-filtered server-side)
   */
  async getDashboardSummary(): Promise<DashboardSummaryResponse> {
    return this.request<DashboardSummaryResponse>('/v1/dashboard/summary');
  }

  /**
   * Get paginated task list (053-SEC-02: tenant-filtered server-side)
   */
  async getTasks(options?: {
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<TaskItemResponse>> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));

    const query = params.toString();
    return this.request<PaginatedResponse<TaskItemResponse>>(
      `/v1/tasks${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get single task detail (053-SEC-02: tenant-filtered server-side)
   */
  async getTask(taskId: string): Promise<TaskItemResponse> {
    return this.request<TaskItemResponse>(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * Cancel a task (053-SEC-01: mutation requires authentication)
   */
  async cancelTask(taskId: string, reason?: string): Promise<TaskItemResponse> {
    return this.request<TaskItemResponse>(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  /**
   * Get paginated activity stream (053-SEC-02: tenant-filtered server-side)
   */
  async getActivity(options?: {
    taskId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<ActivityItemResponse>> {
    const params = new URLSearchParams();
    if (options?.taskId) params.set('taskId', options.taskId);
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));

    const query = params.toString();
    return this.request<PaginatedResponse<ActivityItemResponse>>(
      `/v1/activity${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get pending approval prompts (053-SEC-01 & 053-SEC-02)
   */
  async getApprovals(): Promise<{ items: ApprovalItemResponse[]; total: number }> {
    return this.request<{ items: ApprovalItemResponse[]; total: number }>('/v1/approvals');
  }

  /**
   * Submit authoritative approval decision (053-SEC-01 & 053-SEC-03)
   * Dispatches real backend command to /v1/approvals/:id/decision.
   */
  async submitApprovalDecision(
    promptId: string,
    decision: ApprovalDecisionRequest,
  ): Promise<ApprovalDecisionResult> {
    return this.request<ApprovalDecisionResult>(
      `/v1/approvals/${encodeURIComponent(promptId)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(decision),
      },
    );
  }
}

/**
 * Structured API error with correlation data
 */
export class DashboardAPIError extends Error {
  public readonly statusCode: number;
  public readonly errorDetail?: Record<string, unknown>;
  public readonly path: string;

  constructor(statusCode: number, errorDetail: Record<string, unknown> | undefined, path: string) {
    const code = errorDetail?.['code'] ?? 'UNKNOWN_ERROR';
    const message = (errorDetail?.['message'] as string) ?? `Request failed: ${statusCode}`;
    super(`[${code}] ${message}`);
    this.name = 'DashboardAPIError';
    this.statusCode = statusCode;
    this.errorDetail = errorDetail;
    this.path = path;
  }
}

/**
 * XSS sanitization helper — 053-SEC-04
 * Escapes HTML special characters to prevent injection.
 */
export function sanitizeHTML(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = typeof input === 'string' ? input : String(input);
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#96;',
  };
  return str.replace(/[&<>"'/`]/g, (char) => map[char] ?? char);
}

/**
 * Format relative time (e.g. "2 minutes ago")
 */
export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}
