/**
 * Task 055 — Browser Runtime Hardening, Canonical Contracts & Governed Web Automation
 *
 * Validates the 6 required security invariants + vertical slice execution flow:
 * - 055-SEC-01: Browser session tenant/workspace/task isolation
 *   Cross-tenant, cross-workspace, and cross-task session access fail closed; cleared sessions are inaccessible.
 * - 055-SEC-02: Lease + capability + policy enforcement cannot be bypassed
 *   Missing scope, expired lease, invalid signature, or policy denial fail closed.
 * - 055-SEC-03: SSRF/private/local/metadata endpoint defense
 *   Localhost, 127.0.0.0/8, [::1], IPv4-mapped IPv6, RFC1918, metadata (169.254.169.254),
 *   file://, javascript://, data://, and credential-bearing URLs fail closed.
 * - 055-SEC-04: Redirect & domain allowlist cannot be bypassed
 *   Allowlist subdomain boundaries enforced; redirects to unauthorized or private targets fail closed.
 * - 055-SEC-05: Immutable action receipt + evidence integrity
 *   Frozen receipts generated with SHA-256 evidence checksums and non-replayed IDs.
 * - 055-SEC-06: Secrets/protected browser data containment & form safety
 *   Zero secret leakage in outputs/telemetry; sensitive form/auth/MFA requires human intervention pause.
 * - Vertical Slice: End-to-end governed execution from task and signed lease to receipt and event.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  BrowserOperationName,
  BrowserActionReceiptSchema,
  computeBrowserEvidenceChecksum,
  ExecutionLeaseHeader,
} from '@nexusos/contracts';
import {
  BrowserRuntime,
  DomainSecurityService,
  ExecutionLeaseBoundary,
} from '@nexusos/desktop-agent';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import { computeLeaseSignature } from '@nexusos/backend';

// ============================================================
// Test Evaluators & Helpers
// ============================================================

class AllowAllPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      reason: 'Allowed by test policy evaluator',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context?.requestId,
      correlationId: request.context?.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'allow-all-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

class DenyAllPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.DENY,
      allowed: false,
      policyVersion: '1.0.0',
      policyHash: 'deny-all-hash',
      reason: 'Explicitly denied by test policy evaluator',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context?.requestId,
      correlationId: request.context?.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'deny-all-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

const TEST_SECRET = 'nexusos-task-055-super-secret-key-32b';
const TENANT_A = '11111111-1111-4000-8000-000000000001';
const TENANT_B = '22222222-2222-4000-8000-000000000002';
const TASK_A = '33333333-3333-4000-8000-000000000003';
const TASK_B = '44444444-4444-4000-8000-000000000004';
const WORKSPACE_A = '55555555-5555-4000-8000-000000000005';
const WORKSPACE_B = '66666666-6666-4000-8000-000000000006';

function createSignedLease(
  taskId: string,
  tenantId: string,
  scopes: string[],
  overrides?: Partial<ExecutionLeaseHeader>,
): ExecutionLeaseHeader {
  const base = {
    lease_id: crypto.randomUUID(),
    task_id: taskId,
    agent_id: 'agent_desktop_055',
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scopes,
    nonce: crypto.randomUUID(),
    ...overrides,
  };
  const signature = computeLeaseSignature(base, TEST_SECRET);
  return {
    ...base,
    signature,
  };
}

describe('Task 055 — Browser Runtime Hardening & Governed Security Invariants', () => {
  let tmpDir: string;
  let leaseBoundary: ExecutionLeaseBoundary;
  let runtime: BrowserRuntime;
  let allScopesLease: ExecutionLeaseHeader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-task-055-'));
    leaseBoundary = new ExecutionLeaseBoundary(new AllowAllPolicyEvaluator(), TEST_SECRET);
    runtime = new BrowserRuntime(leaseBoundary);

    allScopesLease = createSignedLease(TASK_A, TENANT_A, [
      'browser:read',
      'browser:write',
      BrowserOperationName.NAVIGATE,
      BrowserOperationName.EXTRACT,
      BrowserOperationName.INTERACT,
      BrowserOperationName.SCREENSHOT,
      BrowserOperationName.DOWNLOAD,
      BrowserOperationName.UPLOAD,
      BrowserOperationName.CLEAR_SESSION,
    ]);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  });

  // ============================================================
  // 055-SEC-01: Session Isolation
  // ============================================================
  describe('055-SEC-01: Browser Session Tenant/Workspace/Task Isolation', () => {
    it('denies cross-tenant session access even with a valid lease for another tenant', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const tenantBLease = createSignedLease(TASK_A, TENANT_B, [BrowserOperationName.NAVIGATE]);

      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com/page',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: tenantBLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'CROSS_TENANT_SESSION_DENIED');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.denied.v1');
    });

    it('denies cross-workspace session access', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const accessCheck = runtime.sessionManager.validateSessionAccess(session.sessionId, {
        taskId: TASK_A,
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_B,
      });

      assert.strictEqual(accessCheck.valid, false);
      assert.strictEqual(accessCheck.errorCode, 'CROSS_WORKSPACE_SESSION_DENIED');
    });

    it('denies cross-task session access', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const taskBLease = createSignedLease(TASK_B, TENANT_A, [BrowserOperationName.NAVIGATE]);

      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com/page',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: taskBLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'CROSS_TASK_SESSION_DENIED');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.denied.v1');
    });

    it('denies operations against cleared / closed sessions', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const cleared = runtime.sessionManager.clearSession(session.sessionId);
      assert.strictEqual(cleared, true);

      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com/page',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INVALID_SESSION');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.denied.v1');
    });
  });

  // ============================================================
  // 055-SEC-02: Lease & Policy Authorization
  // ============================================================
  describe('055-SEC-02: Lease + Capability + Policy Enforcement', () => {
    it('denies operation when capability scope is missing from lease', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      // Lease only has extract scope, not navigate
      const extractOnlyLease = createSignedLease(TASK_A, TENANT_A, [BrowserOperationName.EXTRACT]);

      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: extractOnlyLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'MISSING_CAPABILITY_SCOPE');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.denied.v1');
    });

    it('denies operation when lease is expired', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const expiredLease = createSignedLease(TASK_A, TENANT_A, [BrowserOperationName.NAVIGATE], {
        expires_at: new Date(Date.now() - 10_000).toISOString(),
      });

      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: expiredLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'LEASE_OR_POLICY_INVALID');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.denied.v1');
    });

    it('denies operation when lease signature is invalid or tampered', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const tamperedLease = {
        ...allScopesLease,
        scopes: [...allScopesLease.scopes, 'admin:*'], // tampering without resigning
      };

      const { result } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: tamperedLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'LEASE_OR_POLICY_INVALID');
    });

    it('denies operation when policy evaluator evaluates to DENY', async () => {
      const denyRuntime = new BrowserRuntime(
        new ExecutionLeaseBoundary(new DenyAllPolicyEvaluator(), TEST_SECRET),
      );
      const session = denyRuntime.sessionManager.createSession(
        TASK_A,
        WORKSPACE_A,
        tmpDir,
        TENANT_A,
      );

      const { result } = await denyRuntime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://allowed.example.com',
          allowedDomains: ['allowed.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'LEASE_OR_POLICY_INVALID');
    });
  });

  // ============================================================
  // 055-SEC-03: SSRF / Private / Metadata Endpoint Defense
  // ============================================================
  describe('055-SEC-03: SSRF/Private/Local/Metadata Endpoint Defense', () => {
    const domainService = new DomainSecurityService();

    const ssrfTargets = [
      { url: 'http://localhost:8080/admin', name: 'localhost' },
      { url: 'http://127.0.0.1:3000', name: '127.0.0.1 loopback' },
      { url: 'http://127.1.2.3:80', name: '127.0.0.0/8 loopback block' },
      { url: 'http://169.254.169.254/latest/meta-data/', name: 'AWS/GCP metadata endpoint' },
      { url: 'http://10.0.0.1/internal', name: 'RFC1918 10.0.0.0/8' },
      { url: 'http://192.168.1.1/router', name: 'RFC1918 192.168.0.0/16' },
      { url: 'http://172.16.0.1:8080', name: 'RFC1918 172.16.0.0/12' },
      { url: 'http://[::1]:8080', name: 'IPv6 loopback [::1]' },
      { url: 'http://[::ffff:127.0.0.1]:8080', name: 'IPv4-mapped IPv6 loopback' },
      { url: 'http://[::ffff:169.254.169.254]/meta', name: 'IPv4-mapped IPv6 metadata' },
      { url: 'file:///etc/passwd', name: 'file:// protocol' },
      { url: 'javascript:alert(1)', name: 'javascript:// protocol' },
      { url: 'data:text/html,evil', name: 'data:// protocol' },
      { url: 'https://admin:secret123@example.com', name: 'credential-bearing URL' },
    ];

    for (const target of ssrfTargets) {
      it(`blocks SSRF destination: ${target.name} (${target.url})`, async () => {
        const val = domainService.validateUrl(target.url, ['*']);
        assert.strictEqual(val.valid, false);
        assert.ok(val.error?.code);
      });
    }

    it('rejects navigation to SSRF destinations end-to-end via runtime', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'http://169.254.169.254/latest/meta-data/',
          allowedDomains: ['169.254.169.254'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'PROHIBITED_DESTINATION');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.denied.v1');
    });
  });

  // ============================================================
  // 055-SEC-04: Redirect & Domain Allowlist Protection
  // ============================================================
  describe('055-SEC-04: Redirect & Domain Allowlist Enforcement', () => {
    it('permits authorized subdomains but denies lookalike domains', () => {
      const service = new DomainSecurityService();
      const allowlist = ['*.example.com'];

      assert.strictEqual(
        service.validateUrl('https://api.example.com/data', allowlist).valid,
        true,
      );
      assert.strictEqual(
        service.validateUrl('https://evil-example.com/data', allowlist).valid,
        false,
      );
      assert.strictEqual(
        service.validateUrl('https://notexample.com/data', allowlist).valid,
        false,
      );
    });

    it('blocks redirect from authorized domain to unauthorized external domain', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);
      const dest = path.join(tmpDir, 'download.txt');

      const { result, event } = await runtime.downloadFile(
        {
          sessionId: session.sessionId,
          downloadUrl: 'https://trusted.example.com/file',
          redirectUrl: 'https://malicious.evil.com/payload.bin',
          destinationPath: dest,
          allowedDomains: ['*.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'UNAUTHORIZED_REDIRECT');
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.error.v1');
    });

    it('blocks redirect to private/internal SSRF IP', () => {
      const service = new DomainSecurityService();
      const redirectCheck = service.validateRedirect(
        'https://trusted.example.com/redirect',
        'http://127.0.0.1:8080/secret',
        ['*.example.com', '127.0.0.1'],
      );

      assert.strictEqual(redirectCheck.valid, false);
      assert.strictEqual(redirectCheck.error?.code, 'UNAUTHORIZED_REDIRECT');
    });
  });

  // ============================================================
  // 055-SEC-05: Immutable Action Receipts & Evidence Integrity
  // ============================================================
  describe('055-SEC-05: Immutable Action Receipt + Evidence Integrity', () => {
    it('produces frozen, schema-valid BrowserActionReceipt with verified checksum', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);

      const { result, event } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://trusted.example.com/page',
          allowedDomains: ['trusted.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.receipt);

      // Validate schema
      const parsedReceipt = BrowserActionReceiptSchema.parse(result.receipt);
      assert.strictEqual(parsedReceipt.status, 'SUCCESS');
      assert.strictEqual(parsedReceipt.operation, BrowserOperationName.NAVIGATE);

      // Immutability: Object is frozen
      assert.strictEqual(Object.isFrozen(result.receipt), true);
      assert.throws(() => {
        (result.receipt as unknown as Record<string, unknown>).status = 'TAMPERED';
      }, TypeError);

      // Checksum integrity verification
      const expectedChecksum = computeBrowserEvidenceChecksum({
        taskId: TASK_A,
        leaseId: allScopesLease.lease_id,
        operation: BrowserOperationName.NAVIGATE,
        sessionId: session.sessionId,
        targetUrl: 'https://trusted.example.com/page',
        status: 'SUCCESS',
      });
      assert.strictEqual(result.receipt.sha256EvidenceChecksum, expectedChecksum);

      // Event envelope references the receipt and evidence
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.navigate.v1');
      assert.strictEqual(
        (event.payload as Record<string, unknown>).receiptId,
        result.receipt.receiptId,
      );
      assert.strictEqual(
        (event.payload as Record<string, unknown>).sha256EvidenceChecksum,
        expectedChecksum,
      );
    });

    it('generates immutable receipt even for denied operations', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);

      const { result } = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://unauthorized.evil.com',
          allowedDomains: ['trusted.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.receipt);
      assert.strictEqual(result.receipt.status, 'DENIED');
      assert.strictEqual(Object.isFrozen(result.receipt), true);

      const expectedChecksum = computeBrowserEvidenceChecksum({
        taskId: TASK_A,
        leaseId: allScopesLease.lease_id,
        operation: BrowserOperationName.NAVIGATE,
        sessionId: session.sessionId,
        status: 'DENIED',
      });
      assert.strictEqual(result.receipt.sha256EvidenceChecksum, expectedChecksum);
    });
  });

  // ============================================================
  // 055-SEC-06: Secrets Containment & Form Automation Safety
  // ============================================================
  describe('055-SEC-06: Secrets Containment & Form Automation Safety', () => {
    it('halts on sensitive form (password/MFA/checkout/auth) requiring human intervention', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);

      const { result, event } = await runtime.interactForm(
        {
          sessionId: session.sessionId,
          selector: 'input#user-password',
          actionType: 'fill',
          value: 'SuperSecretPassword!',
          isSensitiveForm: true,
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.humanInterventionRequired, true);
      assert.ok(result.interventionReason);
      assert.strictEqual(event.schema_id, 'nexusos.events.browser.intervention.v1');
      assert.strictEqual(
        (event.payload as Record<string, unknown>).status,
        'INTERVENTION_REQUIRED',
      );
    });

    it('halts on sensitive submit action requiring human intervention', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);

      const { result } = await runtime.interactForm(
        {
          sessionId: session.sessionId,
          selector: 'button#btn-submit-mfa',
          actionType: 'submit',
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.humanInterventionRequired, true);
    });

    it('redacts sensitive form values from error and receipt outputs', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);

      const { result } = await runtime.interactForm(
        {
          sessionId: session.sessionId,
          selector: 'input[name="credit_card_number"]',
          actionType: 'fill',
          value: '4111222233334444',
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );

      const serialized = JSON.stringify(result);
      assert.strictEqual(serialized.includes('4111222233334444'), false);
    });
  });

  // ============================================================
  // Vertical Slice: End-to-End Governed Execution
  // ============================================================
  describe('Governed Browser Vertical Slice: Task -> Policy -> Lease -> Agent -> Runtime -> Receipt', () => {
    it('executes full authorized workflow and produces audit-compatible trail', async () => {
      const session = runtime.sessionManager.createSession(TASK_A, WORKSPACE_A, tmpDir, TENANT_A);

      // 1. Navigate to authorized domain
      const nav = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://app.example.com/dashboard',
          allowedDomains: ['*.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );
      assert.strictEqual(nav.result.success, true);
      assert.ok(nav.result.receipt);
      assert.strictEqual(nav.result.receipt!.status, 'SUCCESS');
      assert.strictEqual(nav.event.schema_id, 'nexusos.events.browser.navigate.v1');

      // 2. Extract content
      const extract = await runtime.extractContent(
        {
          sessionId: session.sessionId,
          selector: '#main-content',
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );
      assert.strictEqual(extract.result.success, true);
      assert.ok(extract.result.receipt);
      assert.strictEqual(extract.result.receipt!.status, 'SUCCESS');
      assert.strictEqual(extract.event.schema_id, 'nexusos.events.browser.extract.v1');

      // 3. Clear session
      const clear = await runtime.clearSession(
        { sessionId: session.sessionId },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );
      assert.strictEqual(clear.result.success, true);
      assert.ok(clear.result.receipt);
      assert.strictEqual(clear.result.receipt!.status, 'SUCCESS');

      // 4. Verify session is cleared and inaccessible
      const afterClear = await runtime.navigate(
        {
          sessionId: session.sessionId,
          url: 'https://app.example.com/dashboard',
          allowedDomains: ['*.example.com'],
        },
        {
          lease: allScopesLease,
          allowedRoots: [tmpDir],
        },
      );
      assert.strictEqual(afterClear.result.success, false);
      assert.ok(afterClear.result.receipt);
      assert.strictEqual(afterClear.result.receipt!.status, 'DENIED');
    });
  });
});
