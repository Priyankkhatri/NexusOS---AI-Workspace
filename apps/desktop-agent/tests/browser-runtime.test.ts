import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ExecutionLeaseHeader } from '@nexusos/contracts';
import {
  PolicyEvaluator,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEffect,
  PolicySnapshot,
} from '@nexusos/policy';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { RuntimeRegistry } from '../src/registry/runtime-registry.js';
import { BrowserExecutionPolicy } from '../src/runtimes/browser/policy.js';
import { BrowserRuntime } from '../src/runtimes/browser/runtime.js';
import { BrowserOperationName } from '../src/runtimes/browser/types.js';

class AllowPolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: PolicyDecisionRequest): Promise<PolicyDecisionResult> {
    return {
      decisionId: crypto.randomUUID(),
      effect: PolicyEffect.ALLOW,
      allowed: true,
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      reason: 'Allowed by test evaluator',
      evaluatedAt: new Date().toISOString(),
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
    };
  }

  getSnapshot(): PolicySnapshot {
    return {
      policyVersion: '1.0.0',
      policyHash: 'test-hash',
      createdAt: new Date().toISOString(),
      rules: [],
    };
  }
}

describe('Browser Runtime — Session Isolation, Navigation, & Security', () => {
  let tmpDir: string;
  let leaseBoundary: ExecutionLeaseBoundary;
  let runtime: BrowserRuntime;
  let validLease: ExecutionLeaseHeader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-brw-test-'));
    leaseBoundary = new ExecutionLeaseBoundary(new AllowPolicyEvaluator());
    runtime = new BrowserRuntime(leaseBoundary);

    validLease = {
      lease_id: '00000000-0000-4000-8000-000000000001',
      task_id: '00000000-0000-4000-8000-000000000002',
      agent_id: 'agent_test_1',
      tenant_id: '00000000-0000-4000-8000-000000000003',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [
        BrowserOperationName.NAVIGATE,
        BrowserOperationName.EXTRACT,
        BrowserOperationName.INTERACT,
        BrowserOperationName.SCREENSHOT,
        BrowserOperationName.DOWNLOAD,
        BrowserOperationName.UPLOAD,
        BrowserOperationName.CLEAR_SESSION,
      ],
      signature: 'valid_sig',
    };
  });

  it('registers in RuntimeRegistry with BrowserExecutionPolicy', () => {
    const registry = new RuntimeRegistry(new BrowserExecutionPolicy());
    const descriptor = runtime.getDescriptor();

    registry.registerRuntime(descriptor);
    assert.equal(registry.hasRuntime(descriptor.runtimeId), true);
    assert.equal(descriptor.isExecutable, true);
  });

  it('creates isolated browser sessions bound to task and workspace', () => {
    const s1 = runtime.sessionManager.createSession('task1', 'ws1', tmpDir);
    const s2 = runtime.sessionManager.createSession('task2', 'ws2', tmpDir);

    assert.notEqual(s1.sessionId, s2.sessionId);
    assert.ok(fs.existsSync(s1.profilePath));
    assert.ok(fs.existsSync(s2.profilePath));
  });

  it('navigates to policy-approved domain and emits event envelope', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);

    const { result, event } = await runtime.navigate(
      {
        sessionId: session.sessionId,
        url: 'https://app.example.com/dashboard',
        allowedDomains: ['*.example.com'],
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.activeUrl, 'https://app.example.com/dashboard');
    assert.equal(event.schema_id, 'nexusos.events.browser.navigate.v1');
  });

  it('rejects navigation to unapproved domain', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);

    const { result, event } = await runtime.navigate(
      {
        sessionId: session.sessionId,
        url: 'https://unauthorized-domain.com',
        allowedDomains: ['*.example.com'],
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'UNAUTHORIZED_DOMAIN');
    assert.equal(event.schema_id, 'nexusos.events.browser.denied.v1');
  });

  it('triggers human intervention pause when interacting with sensitive form (password/auth)', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);

    const { result, event } = await runtime.interactForm(
      {
        sessionId: session.sessionId,
        selector: '#input-password-field',
        actionType: 'fill',
        value: 'secretpass',
        isSensitiveForm: true,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.humanInterventionRequired, true);
    assert.equal(event.schema_id, 'nexusos.events.browser.intervention.v1');
  });

  it('captures screenshot writing only to authorized filesystem scope', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);
    const dest = path.join(tmpDir, 'screenshot.png');

    const { result } = await runtime.captureScreenshot(
      {
        sessionId: session.sessionId,
        destinationPath: dest,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
    assert.ok(fs.existsSync(dest));
  });

  it('rejects screenshot destination outside authorized filesystem scope', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);
    const outsideDest = path.join(path.dirname(tmpDir), 'unauthorized_screenshot.png');

    const { result } = await runtime.captureScreenshot(
      {
        sessionId: session.sessionId,
        destinationPath: outsideDest,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'PATH_OUTSIDE_SCOPE');
  });

  it('downloads file verifying both domain security and destination path security', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);
    const dest = path.join(tmpDir, 'downloaded_file.txt');

    const { result } = await runtime.downloadFile(
      {
        sessionId: session.sessionId,
        downloadUrl: 'https://app.example.com/assets/report.pdf',
        destinationPath: dest,
        allowedDomains: ['*.example.com'],
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
    assert.ok(fs.existsSync(dest));
  });

  it('uploads file enforcing source path security within allowedRoots', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);
    const sourceFile = path.join(tmpDir, 'upload_me.txt');
    fs.writeFileSync(sourceFile, 'hello upload');

    const { result } = await runtime.uploadFile(
      {
        sessionId: session.sessionId,
        selector: '#file-upload-input',
        sourceFilePath: sourceFile,
      },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
  });

  it('clears browser session and removes profile directory', async () => {
    const session = runtime.sessionManager.createSession('t1', 'w1', tmpDir);
    assert.ok(fs.existsSync(session.profilePath));

    const { result } = await runtime.clearSession(
      { sessionId: session.sessionId },
      {
        lease: validLease,
        allowedRoots: [tmpDir],
      },
    );

    assert.equal(result.success, true);
    assert.ok(!fs.existsSync(session.profilePath));
  });
});
