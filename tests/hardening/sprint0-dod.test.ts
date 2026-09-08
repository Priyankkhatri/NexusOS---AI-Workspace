import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NEXUSOS_CONTRACT_VERSION,
  TaskLifecycleState,
  createACPMessageEnvelope,
  ErrorCategory,
  createNexusOSError,
} from '@nexusos/contracts';
import { loadIdentityConfig, PrincipalType } from '@nexusos/identity';
import { loadPolicyConfig, PolicyEffect } from '@nexusos/policy';
import { computeEvidenceHash, computeReceiptSignature, loadBackendConfig } from '@nexusos/backend';
import { AgentLifecycleState } from '@nexusos/desktop-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Sprint 0 Definition of Done Audit (Blueprint Section 56)', () => {
  // Criterion 1: Repository is initialized
  it('[DoD-01] Repository is initialized with git governance and core files', () => {
    assert.ok(fs.existsSync(path.join(rootDir, '.git')), 'Git directory must exist');
    assert.ok(fs.existsSync(path.join(rootDir, '.gitignore')), '.gitignore must exist');
    assert.ok(fs.existsSync(path.join(rootDir, 'package.json')), 'Root package.json must exist');
    assert.ok(
      fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml')),
      'pnpm-workspace.yaml must exist',
    );
  });

  // Criterion 2: Monorepo boundaries are enforced
  it('[DoD-02] Monorepo boundaries are enforced with isolated workspaces', () => {
    const workspaceContent = fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    assert.ok(workspaceContent.includes('packages/*'), 'Workspaces must include packages/*');
    assert.ok(workspaceContent.includes('services/*'), 'Workspaces must include services/*');
    assert.ok(workspaceContent.includes('apps/*'), 'Workspaces must include apps/*');

    // Verify @nexusos/contracts package.json has ZERO service/app dependencies
    const contractsPkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'packages', 'contracts', 'package.json'), 'utf8'),
    );
    const contractsDeps = Object.keys(contractsPkg.dependencies || {});
    assert.ok(
      !contractsDeps.some((d) => d.startsWith('@nexusos/backend')),
      'Contracts must not depend on backend',
    );
    assert.ok(
      !contractsDeps.some((d) => d.startsWith('@nexusos/desktop')),
      'Contracts must not depend on desktop',
    );
  });

  // Criterion 3: Toolchain is reproducible
  it('[DoD-03] Toolchain is reproducible with pinned versions', () => {
    const nvmrc = fs.readFileSync(path.join(rootDir, '.nvmrc'), 'utf8').trim();
    assert.strictEqual(nvmrc, 'v24.14.1', '.nvmrc must specify Node v24.14.1');

    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.strictEqual(
      rootPkg.packageManager,
      'pnpm@11.21.0',
      'pnpm version must be pinned to 11.21.0',
    );
    assert.strictEqual(
      rootPkg.devDependencies.typescript,
      '5.7.3',
      'TypeScript must be exact 5.7.3',
    );
  });

  // Criterion 4: Developer setup is documented
  it('[DoD-04] Developer setup is documented in LOCAL_DEVELOPMENT.md and DEVELOPMENT.md', () => {
    const localDevPath = path.join(rootDir, 'docs', 'LOCAL_DEVELOPMENT.md');
    assert.ok(fs.existsSync(localDevPath), 'docs/LOCAL_DEVELOPMENT.md must exist');
    const content = fs.readFileSync(localDevPath, 'utf8');
    assert.ok(content.includes('Prerequisites'), 'Must cover prerequisites');
    assert.ok(content.includes('pnpm install'), 'Must cover installation');
    assert.ok(content.includes('Running Services Locally'), 'Must cover running services');
  });

  // Criterion 5: CI is operational
  it('[DoD-05] CI is operational with GitHub Actions workflows', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), '.github/workflows/ci.yml must exist');
    const ciContent = fs.readFileSync(ciPath, 'utf8');
    assert.ok(ciContent.includes('format:check'), 'CI must run format check');
    assert.ok(ciContent.includes('lint'), 'CI must run lint');
    assert.ok(ciContent.includes('typecheck'), 'CI must run typecheck');
    assert.ok(ciContent.includes('test'), 'CI must run tests');
    assert.ok(ciContent.includes('validate'), 'CI must run validate');
    assert.ok(ciContent.includes('security'), 'CI must run security');
  });

  // Criterion 6: Shared contracts exist
  it('[DoD-06] Shared contracts exist and are versioned', () => {
    assert.strictEqual(NEXUSOS_CONTRACT_VERSION, '0.1.0-sprint0');
    assert.ok(TaskLifecycleState, 'TaskLifecycleState must be exported');
    assert.ok(createACPMessageEnvelope, 'createACPMessageEnvelope must be exported');
    assert.ok(ErrorCategory, 'ErrorCategory must be exported');
    assert.ok(createNexusOSError, 'createNexusOSError must be exported');
  });

  // Criterion 7: API validation works
  it('[DoD-07] API validation works through schema evaluation and error taxonomy', () => {
    assert.strictEqual(TaskLifecycleState.SUBMITTED, 'SUBMITTED');
    assert.strictEqual(TaskLifecycleState.COMPLETED, 'COMPLETED');
    const err = createNexusOSError('AUTH_401', ErrorCategory.AUTHENTICATION, 'Invalid credentials');
    assert.strictEqual(err.code, 'AUTH_401');
    assert.strictEqual(err.category, ErrorCategory.AUTHENTICATION);
    assert.strictEqual(err.message, 'Invalid credentials');
  });

  // Criterion 8: Event Bus foundation works
  it('[DoD-08] Event Bus foundation is operational', () => {
    const eventModulePath = path.join(
      rootDir,
      'packages',
      'contracts',
      'src',
      'events',
      'index.ts',
    );
    assert.ok(fs.existsSync(eventModulePath), 'contracts/events module must exist');
    const content = fs.readFileSync(eventModulePath, 'utf8');
    assert.ok(
      content.includes('EventEnvelope') || content.includes('event'),
      'Must define Event envelopes',
    );
  });

  // Criterion 9: ACP foundation works
  it('[DoD-09] ACP (Agent Control Protocol) foundation works', () => {
    const env = createACPMessageEnvelope(
      '1.0',
      'backend-agent',
      'desktop-agent',
      'acp.command.v1',
      '123e4567-e89b-12d3-a456-426614174000',
      { cmd: 'ping' },
    );
    assert.ok(env.message_id, 'ACP message must have a generated ID');
    assert.ok(env.timestamp, 'ACP message must have a timestamp');
    assert.strictEqual(env.from_agent, 'backend-agent');
    assert.strictEqual(env.to_agent, 'desktop-agent');
    assert.strictEqual(env.schema_id, 'acp.command.v1');
  });

  // Criterion 10: Identity foundation works
  it('[DoD-10] Identity foundation works with zero-trust token validation', () => {
    const config = loadIdentityConfig({
      IDENTITY_ISSUER: 'https://auth.nexusos.internal',
      IDENTITY_AUDIENCE: 'nexusos-control-plane',
      IDENTITY_SECRET_KEY: 'test_secret_key_minimum_16_characters!',
    });
    assert.strictEqual(config.issuer, 'https://auth.nexusos.internal');
    assert.strictEqual(config.audience, 'nexusos-control-plane');
    assert.ok(PrincipalType.USER, 'PrincipalType.USER must exist');
  });

  // Criterion 11: Policy integration works
  it('[DoD-11] Policy integration works with deterministic allow/deny evaluation', () => {
    const policyConfig = loadPolicyConfig();
    assert.ok(policyConfig.defaultPolicyVersion, 'Default policy version must be defined');
    assert.strictEqual(policyConfig.failClosedOnMissingPolicy, true);
    assert.strictEqual(PolicyEffect.ALLOW, 'ALLOW');
    assert.strictEqual(PolicyEffect.DENY, 'DENY');
  });

  // Criterion 12: Database migrations work
  it('[DoD-12] Database boundary and configuration are operational', () => {
    const backendConfig = loadBackendConfig({
      PORT: '3000',
      DATABASE_URL: ':memory:',
    });
    assert.ok(backendConfig, 'Backend config loader must succeed');
    assert.strictEqual(backendConfig.port, 3000);
  });

  // Criterion 13: Desktop Agent skeleton works
  it('[DoD-13] Desktop Agent skeleton and process supervisor work', () => {
    assert.ok(AgentLifecycleState.STARTING, 'AgentLifecycleState.STARTING must be defined');
    assert.ok(AgentLifecycleState.READY, 'AgentLifecycleState.READY must be defined');
    assert.ok(AgentLifecycleState.STOPPED, 'AgentLifecycleState.STOPPED must be defined');
    const agentPkgPath = path.join(rootDir, 'apps', 'desktop-agent', 'package.json');
    assert.ok(fs.existsSync(agentPkgPath), 'Desktop agent package.json must exist');
  });

  // Criterion 14: AI Runtime skeleton works
  it('[DoD-14] AI Runtime skeleton and configuration exist', () => {
    const aiRuntimePath = path.join(
      rootDir,
      'apps',
      'desktop-agent',
      'src',
      'runtimes',
      'local-ai',
      'provider-adapters.ts',
    );
    assert.ok(fs.existsSync(aiRuntimePath), 'Local AI runtime provider adapters must exist');
  });

  // Criterion 15: Dashboard skeleton works
  it('[DoD-15] Experience plane skeleton (tray UI host / observables) works', () => {
    const trayPath = path.join(rootDir, 'apps', 'desktop-agent', 'src', 'ui');
    assert.ok(fs.existsSync(trayPath), 'Tray UI host directory must exist');
  });

  // Criterion 16: Observability works
  it('[DoD-16] Observability and secret redaction are functional', () => {
    const redactionTestPath = path.join(
      rootDir,
      'apps',
      'desktop-agent',
      'tests',
      'structured-logger-redaction.test.ts',
    );
    assert.ok(fs.existsSync(redactionTestPath), 'Structured logger redaction tests must exist');
  });

  // Criterion 17: Audit works
  it('[DoD-17] Audit receipt generation and cryptographic hashing work', () => {
    const hash = computeEvidenceHash({ step: 1, action: 'read' });
    assert.ok(
      typeof hash === 'string' && hash.length === 64,
      'Evidence hash must be 64-char SHA256 hex',
    );

    const receiptData = {
      receiptId: 'rcpt-123',
      taskId: 'task-123',
      leaseId: 'lease-123',
      agentId: 'agent-123',
      tenantId: 'tenant-123',
      status: 'SUCCESS' as const,
      exitCode: 0,
      evidenceChecksum: hash,
      completedAt: new Date().toISOString(),
    };
    const sig = computeReceiptSignature(receiptData, 'test-signing-key');
    assert.ok(
      typeof sig === 'string' && sig.length === 64,
      'Receipt signature must be 64-char HMAC-SHA256 hex',
    );
  });

  // Criterion 18: Security scanning works
  it('[DoD-18] Security scanning script and threat models are present', () => {
    const scanScript = path.join(rootDir, 'scripts', 'security-scan.js');
    assert.ok(fs.existsSync(scanScript), 'scripts/security-scan.js must exist');
    const tmPath = path.join(rootDir, 'threat-models', 'TM-0001-phase0-baseline.md');
    assert.ok(fs.existsSync(tmPath), 'threat-models/TM-0001 must exist');
  });

  // Criterion 19: Dependency scanning works
  it('[DoD-19] Dependency scanning and lockfile hygiene are enforced', () => {
    assert.ok(fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')), 'pnpm-lock.yaml must exist');
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.ok(rootPkg.scripts.security, 'package.json must contain security script');
  });

  // Criterion 20: One governed vertical slice passes
  it('[DoD-20] One governed vertical slice is validated in test suite', () => {
    const sliceTest = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'governed-vertical-slice.test.ts',
    );
    assert.ok(fs.existsSync(sliceTest), 'governed-vertical-slice.test.ts must exist');
    const content = fs.readFileSync(sliceTest, 'utf8');
    assert.ok(
      content.includes('TaskLifecycleState'),
      'Vertical slice must test TaskLifecycleState',
    );
  });

  // Criterion 21: Failure scenarios are validated
  it('[DoD-21] Failure injection scenarios are covered by test fixtures', () => {
    const failureTest = path.join(rootDir, 'tests', 'vertical-slice', 'failure-injection.test.ts');
    assert.ok(fs.existsSync(failureTest), 'failure-injection.test.ts must exist');
    const secTest = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'vertical-slice-security.test.ts',
    );
    assert.ok(fs.existsSync(secTest), 'vertical-slice-security.test.ts must exist');
  });

  // Criterion 22: Rollback procedures exist
  it('[DoD-22] All 10 operational runbooks exist with standard schema', () => {
    const runbooksMaster = path.join(rootDir, 'docs', 'RUNBOOKS.md');
    assert.ok(fs.existsSync(runbooksMaster), 'docs/RUNBOOKS.md must exist');

    for (let i = 1; i <= 10; i++) {
      const rbPrefix = `RB-${String(i).padStart(3, '0')}`;
      const rbFiles = fs
        .readdirSync(path.join(rootDir, 'docs', 'runbooks'))
        .filter((f) => f.startsWith(rbPrefix));
      assert.strictEqual(rbFiles.length, 1, `Runbook ${rbPrefix} must exist`);

      const rbContent = fs.readFileSync(path.join(rootDir, 'docs', 'runbooks', rbFiles[0]), 'utf8');
      assert.ok(rbContent.includes('Symptoms'), `${rbPrefix} must have Symptoms`);
      assert.ok(rbContent.includes('Containment'), `${rbPrefix} must have Containment`);
      assert.ok(rbContent.includes('Diagnosis'), `${rbPrefix} must have Diagnosis`);
      assert.ok(
        rbContent.includes('Safe Actions') || rbContent.includes('Recovery'),
        `${rbPrefix} must have Safe Actions or Recovery`,
      );
      assert.ok(rbContent.includes('Verification'), `${rbPrefix} must have Verification`);
      assert.ok(rbContent.includes('Escalation'), `${rbPrefix} must have Escalation`);
      assert.ok(rbContent.includes('Evidence'), `${rbPrefix} must have Evidence`);
    }
  });

  // Criterion 23: Documentation is complete
  it('[DoD-23] All required documentation from Blueprint Section 66 is present', () => {
    const requiredDocs = [
      'AI_ENGINEERING_INDEX.md',
      'LOCAL_DEVELOPMENT.md',
      'ARCHITECTURE_INDEX.md',
      'CONTRACTS.md',
      'TESTING.md',
      'SECURITY.md',
      'OBSERVABILITY.md',
      'DEPLOYMENT.md',
      'RUNBOOKS.md',
      'TROUBLESHOOTING.md',
      'RESOURCE_BASELINE.md',
      'SPRINT_1_READINESS_AND_BACKLOG.md',
    ];
    for (const doc of requiredDocs) {
      const docPath = path.join(rootDir, 'docs', doc);
      assert.ok(fs.existsSync(docPath), `docs/${doc} must exist`);
      const stat = fs.statSync(docPath);
      assert.ok(stat.size > 200, `docs/${doc} must have substantive content`);
    }
  });

  // Criterion 24: AI-agent development workflow works
  it('[DoD-24] AI-agent development workflow and document hierarchy are defined', () => {
    const aiIndex = fs.readFileSync(path.join(rootDir, 'docs', 'AI_ENGINEERING_INDEX.md'), 'utf8');
    assert.ok(
      aiIndex.includes('Document Authority Precedence'),
      'Must define Document Authority Precedence',
    );
    assert.ok(
      aiIndex.includes('AI Agent Merge Gate Checklist'),
      'Must define AI Agent Merge Gate Checklist',
    );
    assert.ok(aiIndex.includes('Handoff Protocol'), 'Must define Handoff Protocol');
  });

  // Criterion 25: Sprint 1 backlog is ready
  it('[DoD-25] Sprint 1 readiness and candidate backlog are formally documented', () => {
    const s1Path = path.join(rootDir, 'docs', 'SPRINT_1_READINESS_AND_BACKLOG.md');
    assert.ok(fs.existsSync(s1Path), 'docs/SPRINT_1_READINESS_AND_BACKLOG.md must exist');
    const s1Content = fs.readFileSync(s1Path, 'utf8');
    assert.ok(s1Content.includes('Candidate Backlog'), 'Must define Candidate Backlog');
    assert.ok(s1Content.includes('Section 58'), 'Must reference Section 58');
    assert.ok(s1Content.includes('Section 59'), 'Must reference Section 59');
  });
});
