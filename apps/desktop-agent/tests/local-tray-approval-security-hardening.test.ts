import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NativeApprovalHost } from '../src/ui/approval-host.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { RedactionFilter } from '../src/telemetry/redaction-filter.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';
import { UIError } from '../src/ui/types.js';
import type { ExecutionLeaseHeader } from '@nexusos/contracts';

function createDummyLeaseHeader(tenantId?: string): ExecutionLeaseHeader {
  return {
    lease_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    agent_id: 'agent-sec-v01',
    tenant_id:
      tenantId && tenantId.includes('-') && tenantId.length === 36 ? tenantId : crypto.randomUUID(),
    scopes: ['approval:present', 'approval:submit'],
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    signature: 'sig-sec-v01',
  };
}

class MockLeaseBoundary extends ExecutionLeaseBoundary {
  constructor(private isValid = true) {
    super();
  }

  public setValid(valid: boolean) {
    this.isValid = valid;
  }

  override async validateLease(_header: unknown) {
    return { valid: this.isValid, reason: this.isValid ? undefined : 'Lease invalid' };
  }
}

test('SH-01: Oversized prompt description payload', async () => {
  const host = new NativeApprovalHost();
  const hugeDescription = 'A'.repeat(70000); // Exceeds 64KB (65536)

  await assert.rejects(
    async () => {
      await host.presentPrompt({
        leaseHeader: createDummyLeaseHeader(),
        requestId: 'req-sh-01',
        title: 'Huge Prompt',
        description: hugeDescription,
        riskTier: 'CRITICAL',
        actionIdentifier: 'system.execute',
      });
    },
    (err: Error) => err.name === 'ZodError',
  );
});

test('SH-02: Secret redaction in prompt header & body', async () => {
  const filter = new RedactionFilter(new SecretRedactionRegistry());
  const host = new NativeApprovalHost(undefined, filter);

  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-02',
    title: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret',
    description: 'api_key: sk-1234567890abcdef1234567890abcdef',
    riskTier: 'HIGH',
    actionIdentifier: 'auth.verify',
  });

  assert.ok(!prompt.title.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  assert.ok(!prompt.description.includes('sk-1234567890abcdef1234567890abcdef'));
});

test('SH-03: Lease expiration / invalidation at decision time', async () => {
  const boundary = new MockLeaseBoundary(true);
  const host = new NativeApprovalHost(boundary);

  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-03',
    title: 'Format Disk',
    description: 'Dangerous disk format',
    riskTier: 'CRITICAL',
    actionIdentifier: 'fs.format',
  });

  // Invalidate lease boundary prior to decision submission
  boundary.setValid(false);

  await assert.rejects(
    async () => {
      await host.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader: createDummyLeaseHeader(),
      });
    },
    (err: UIError) => err.code === 'UNAUTHORIZED',
  );
});

test('SH-04: Malformed lease header rejection', async () => {
  const host = new NativeApprovalHost();

  await assert.rejects(
    async () => {
      await host.presentPrompt({
        leaseHeader: {} as ExecutionLeaseHeader,
        requestId: 'req-sh-04',
        title: 'Bad Lease',
        description: 'Malformed lease header',
        riskTier: 'LOW',
        actionIdentifier: 'test.action',
      });
    },
    (err: Error) => err.name === 'ZodError',
  );
});

test('SH-05: Replayed decision on already-resolved prompt', async () => {
  const host = new NativeApprovalHost();
  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-05',
    title: 'Deploy Code',
    description: 'Production deployment',
    riskTier: 'HIGH',
    actionIdentifier: 'deploy.prod',
  });

  await host.submitDecision({
    promptId: prompt.promptId,
    decision: 'ALLOW',
    nonce: prompt.nonce,
    leaseHeader: createDummyLeaseHeader(),
  });

  // Second decision attempt must be rejected
  await assert.rejects(
    async () => {
      await host.submitDecision({
        promptId: prompt.promptId,
        decision: 'DENY',
        nonce: prompt.nonce,
        leaseHeader: createDummyLeaseHeader(),
      });
    },
    (err: UIError) => err.code === 'PROMPT_ALREADY_RESOLVED',
  );
});

test('SH-06: Double-click decision race protection', async () => {
  const host = new NativeApprovalHost();
  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-06',
    title: 'Concurrent Action',
    description: 'Concurrent double-click test',
    riskTier: 'MEDIUM',
    actionIdentifier: 'action.concurrent',
  });

  const p1 = host.submitDecision({
    promptId: prompt.promptId,
    decision: 'ALLOW',
    nonce: prompt.nonce,
    leaseHeader: createDummyLeaseHeader(),
  });

  const p2 = host.submitDecision({
    promptId: prompt.promptId,
    decision: 'DENY',
    nonce: prompt.nonce,
    leaseHeader: createDummyLeaseHeader(),
  });

  const results = await Promise.allSettled([p1, p2]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
});

test('SH-07: Nonexistent prompt decision submission', async () => {
  const host = new NativeApprovalHost();

  await assert.rejects(
    async () => {
      await host.submitDecision({
        promptId: crypto.randomUUID(),
        decision: 'ALLOW',
        nonce: 'fake-nonce',
        leaseHeader: createDummyLeaseHeader(),
      });
    },
    (err: UIError) => err.code === 'PROMPT_NOT_FOUND',
  );
});

test('SH-08: Lock-screen privacy sanitization', async () => {
  const host = new NativeApprovalHost();
  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-08',
    title: 'Confidential Task',
    description: 'Super secret payload detail',
    riskTier: 'HIGH',
    actionIdentifier: 'secret.access',
    isLockScreenPrivate: true,
  });

  const sanitized = host.getSanitizedPromptForUI(prompt.promptId, true);
  assert.equal(sanitized?.description, '[REDACTED FOR PRIVACY - SENSITIVE CONTENT]');
  assert.equal(sanitized?.metadata, undefined);
});

test('SH-09: Cross-tenant approval decision blocking', async () => {
  const host = new NativeApprovalHost();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(tenantA),
    requestId: 'req-sh-09',
    title: 'Tenant A Action',
    description: 'Tenant A action description',
    riskTier: 'MEDIUM',
    actionIdentifier: 'tenant.action',
  });

  await assert.rejects(
    async () => {
      await host.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: prompt.nonce,
        leaseHeader: createDummyLeaseHeader(tenantB),
        tenantId: tenantB,
      });
    },
    (err: UIError) => err.code === 'TENANT_MISMATCH',
  );
});

test('SH-10: Nonce mismatch protection', async () => {
  const host = new NativeApprovalHost();
  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-10',
    title: 'Nonce Test',
    description: 'Testing nonce mismatch',
    riskTier: 'LOW',
    actionIdentifier: 'test.nonce',
  });

  await assert.rejects(
    async () => {
      await host.submitDecision({
        promptId: prompt.promptId,
        decision: 'ALLOW',
        nonce: 'invalid-nonce-value',
        leaseHeader: createDummyLeaseHeader(),
      });
    },
    (err: UIError) => err.code === 'NONCE_MISMATCH',
  );
});

test('SH-11: Shutdown purge cancels pending prompts and timers', async () => {
  const host = new NativeApprovalHost();
  const p1 = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-11-a',
    title: 'P1',
    description: 'D1',
    riskTier: 'LOW',
    actionIdentifier: 'a1',
  });

  host.shutdown();

  const item = host.getPrompt(p1.promptId);
  assert.equal(item?.state, 'CANCELLED');
});

test('SH-12: Receipt integrity verification', async () => {
  const host = new NativeApprovalHost();
  const prompt = await host.presentPrompt({
    leaseHeader: createDummyLeaseHeader(),
    requestId: 'req-sh-12',
    title: 'Receipt Integrity',
    description: 'Checking receipt hash output',
    riskTier: 'LOW',
    actionIdentifier: 'action.receipt',
  });

  const res = await host.submitDecision({
    promptId: prompt.promptId,
    decision: 'ALLOW',
    nonce: prompt.nonce,
    leaseHeader: createDummyLeaseHeader(),
  });

  assert.ok(res.receiptHash);
  assert.equal(res.receiptHash.length, 64);
});
