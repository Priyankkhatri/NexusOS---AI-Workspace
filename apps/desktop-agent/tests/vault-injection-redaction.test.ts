import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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
import { SecretsVaultClient } from '../src/vault/vault-client.js';

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

describe('Secrets Vault Client — Injection Channels & Redaction Registry', () => {
  let leaseBoundary: ExecutionLeaseBoundary;
  let vaultClient: SecretsVaultClient;
  let validLease: ExecutionLeaseHeader;

  beforeEach(() => {
    leaseBoundary = new ExecutionLeaseBoundary(new AllowPolicyEvaluator());
    vaultClient = new SecretsVaultClient(leaseBoundary);

    validLease = {
      lease_id: '00000000-0000-4000-8000-000000000001',
      task_id: '00000000-0000-4000-8000-000000000002',
      agent_id: 'agent_test_1',
      tenant_id: '00000000-0000-4000-8000-000000000003',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['secret:read', 'plugin:invoke', 'vault:sec_ref_db_password'],
      signature: 'valid_sig',
    };
  });

  it('injects secret into authorized Terminal, Browser, and Plugin runner channels', async () => {
    const resolveRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(resolveRes.result.success, true);
    const payload = resolveRes.result.data!;

    const termInj = await vaultClient.injectSecret(payload, 'TERMINAL', 'proc_123', {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(termInj.result.success, true);
    assert.equal(termInj.result.data?.channel, 'TERMINAL');

    const brwInj = await vaultClient.injectSecret(payload, 'BROWSER', 'sess_456', {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(brwInj.result.success, true);
    assert.equal(brwInj.result.data?.channel, 'BROWSER');

    const plugInj = await vaultClient.injectSecret(payload, 'PLUGIN', 'plug_github_v1', {
      lease: validLease,
      allowedRoots: [],
    });
    assert.equal(plugInj.result.success, true);
    assert.equal(plugInj.result.data?.channel, 'PLUGIN');
  });

  it('redacts registered secret values and bearer tokens from logs and output strings', async () => {
    const resolveRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });
    const payload = resolveRes.result.data!;
    const secretValueStr = payload.payloadBuffer.toString('utf-8');

    const rawLog = `Process output: ${secretValueStr} with auth Bearer secret_jwt_token_12345`;
    const redactedLog = vaultClient.redactionRegistry.redactText(rawLog);

    assert.equal(redactedLog.includes(secretValueStr), false);
    assert.equal(redactedLog.includes('[REDACTED_SECRET_'), true);
    assert.equal(redactedLog.includes('[REDACTED_BEARER_TOKEN]'), true);
  });

  it('ensures vault evidence event envelopes contain zero plaintext secret material', async () => {
    const resolveRes = await vaultClient.resolveSecret('vault:sec_ref_db_password', {
      lease: validLease,
      allowedRoots: [],
    });

    const envelopeJson = JSON.stringify(resolveRes.event);
    assert.equal(envelopeJson.includes('P@ssw0rd123'), false);
    assert.equal(resolveRes.event.payload.fingerprintId !== undefined, true);
  });
});
