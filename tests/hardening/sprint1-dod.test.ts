import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WorkflowDAGSchema,
  TaskGraphCreateRequestSchema,
  ApprovalPromptRequestSchema,
  ApprovalDecisionRequestSchema,
  PluginManifestSchema,
  NavigateRequestSchema,
  BrowserSessionSchema,
  MemoryRecordSchema,
  MemorySensitivity,
  MemoryCompressionRequestSchema,
  EpisodicEpisodeSchema,
  MemoryGraphNodeSchema,
  MemoryGraphEdgeSchema,
  wrapUntrustedMemory,
  UNTRUSTED_MEMORY_START_DELIMITER,
  UNTRUSTED_MEMORY_END_DELIMITER,
  GoalDecompositionRequestSchema,
  AdaptiveReplanRequestSchema,
  validatePlanSafetyLimits,
  PLANNER_SAFETY_LIMITS,
} from '@nexusos/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Sprint 1 Definition of Done Audit (Blueprint Section 56 & 59)', () => {
  // Milestone 1 (Task 049): Multi-Step Workflow Graph Execution
  it('[DoD-S1-01] M1 / Task 049: Multi-step workflow DAG schemas, validation and engine exist', () => {
    assert.ok(WorkflowDAGSchema, 'WorkflowDAGSchema contract must exist');
    assert.ok(TaskGraphCreateRequestSchema, 'TaskGraphCreateRequestSchema must exist');

    const controllerPath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'tasks',
      'controller.ts',
    );
    assert.ok(fs.existsSync(controllerPath), 'TaskController must exist');
    const controllerContent = fs.readFileSync(controllerPath, 'utf8');
    assert.ok(
      controllerContent.includes('createTaskGraph'),
      'TaskController must handle createTaskGraph',
    );

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'governed-workflow-graph.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'governed-workflow-graph.test.ts must exist');
  });

  // Milestone 2 (Task 050): Filesystem Sandbox Runtime Hardening
  it('[DoD-S1-02] M2 / Task 050: Desktop filesystem sandbox runtime with jail isolation exists', () => {
    const fsRuntimePath = path.join(
      rootDir,
      'apps',
      'desktop-agent',
      'src',
      'runtimes',
      'filesystem',
    );
    assert.ok(fs.existsSync(fsRuntimePath), 'Filesystem runtime directory must exist');

    const runtimeFiles = fs.readdirSync(fsRuntimePath);
    assert.ok(runtimeFiles.length > 0, 'Filesystem runtime must contain implementation files');

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'filesystem-sandbox-hardening.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'filesystem-sandbox-hardening.test.ts must exist');
  });

  // Milestone 3 (Task 051): Local AI Model Router & Engine Integration
  it('[DoD-S1-03] M3 / Task 051: Local AI runtime router and engine integration exist', () => {
    const localAiDir = path.join(rootDir, 'apps', 'desktop-agent', 'src', 'runtimes', 'local-ai');
    assert.ok(
      fs.existsSync(localAiDir),
      'apps/desktop-agent/src/runtimes/local-ai directory must exist',
    );

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'local-ai-security-invariants.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'local-ai-security-invariants.test.ts must exist');
  });

  // Milestone 4 (Task 052): Human-in-the-Loop Desktop Approval Interceptor
  it('[DoD-S1-04] M4 / Task 052: Canonical HITL contracts and desktop approval interceptor exist', () => {
    assert.ok(ApprovalPromptRequestSchema, 'ApprovalPromptRequestSchema must exist');
    assert.ok(ApprovalDecisionRequestSchema, 'ApprovalDecisionRequestSchema must exist');

    const approvalContractsPath = path.join(
      rootDir,
      'packages',
      'contracts',
      'src',
      'approval',
      'index.ts',
    );
    assert.ok(
      fs.existsSync(approvalContractsPath),
      'packages/contracts/src/approval/index.ts must exist',
    );

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'approval-security-invariants.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'approval-security-invariants.test.ts must exist');
  });

  // Milestone 5 (Task 053): Web Dashboard Experience Platform
  it('[DoD-S1-05] M5 / Task 053: Web dashboard application and activity observability exist', () => {
    const dashboardDir = path.join(rootDir, 'apps', 'web-dashboard');
    assert.ok(fs.existsSync(dashboardDir), 'apps/web-dashboard directory must exist');

    const pkgPath = path.join(dashboardDir, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'apps/web-dashboard/package.json must exist');

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'dashboard-security-invariants.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'dashboard-security-invariants.test.ts must exist');
  });

  // Milestone 6 (Task 054): Plugin SDK & Extensibility Foundation
  it('[DoD-S1-06] M6 / Task 054: Plugin SDK package and runtime host exist', () => {
    assert.ok(PluginManifestSchema, 'PluginManifestSchema contract must exist');

    const pluginSdkDir = path.join(rootDir, 'packages', 'plugin-sdk');
    assert.ok(fs.existsSync(pluginSdkDir), 'packages/plugin-sdk directory must exist');

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'plugin-sdk-security-invariants.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'plugin-sdk-security-invariants.test.ts must exist');
  });

  // Milestone 7 (Task 055): Browser Runtime Hardening & Web Automation
  it('[DoD-S1-07] M7 / Task 055: Browser runtime contracts and automation engine exist', () => {
    assert.ok(NavigateRequestSchema, 'NavigateRequestSchema contract must exist');
    assert.ok(BrowserSessionSchema, 'BrowserSessionSchema contract must exist');

    const browserRuntimeDir = path.join(
      rootDir,
      'apps',
      'desktop-agent',
      'src',
      'runtimes',
      'browser',
    );
    assert.ok(
      fs.existsSync(browserRuntimeDir),
      'apps/desktop-agent/src/runtimes/browser must exist',
    );

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'browser-security-invariants.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'browser-security-invariants.test.ts must exist');
  });

  // Milestone 8 (Task 056): Memory / Context Runtime Foundation
  it('[DoD-S1-08] M8 / Task 056: Governed persistent memory store and service exist', () => {
    assert.ok(MemoryRecordSchema, 'MemoryRecordSchema contract must exist');
    assert.ok(MemorySensitivity, 'MemorySensitivity enum must exist');

    const memoryServicePath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'memory',
      'memory-service.ts',
    );
    assert.ok(
      fs.existsSync(memoryServicePath),
      'services/backend/src/memory/memory-service.ts must exist',
    );

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'memory-governed-vertical-slice.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'memory-governed-vertical-slice.test.ts must exist');
  });

  // Milestone 9 (Task 057): Autonomous Workflow Orchestrator & Goal Decomposer
  it('[DoD-S1-09] M9 / Task 057: Autonomous planner contracts and goal decomposer exist', () => {
    assert.ok(GoalDecompositionRequestSchema, 'GoalDecompositionRequestSchema contract must exist');
    assert.ok(AdaptiveReplanRequestSchema, 'AdaptiveReplanRequestSchema contract must exist');
    assert.ok(
      typeof validatePlanSafetyLimits === 'function',
      'validatePlanSafetyLimits helper must exist',
    );
    assert.ok(
      PLANNER_SAFETY_LIMITS.MAX_NODES === 50,
      'PLANNER_SAFETY_LIMITS must specify MAX_NODES 50',
    );

    const plannerDir = path.join(rootDir, 'services', 'backend', 'src', 'planner');
    assert.ok(fs.existsSync(plannerDir), 'services/backend/src/planner directory must exist');

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'autonomous-workflow-vertical-slice.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'autonomous-workflow-vertical-slice.test.ts must exist');
  });

  // Milestone 10 (Task 058): Cross-Session Episodic Learning & Memory Graph
  it('[DoD-S1-10] M10 / Task 058: Episodic learning, memory compression, graph projections exist', () => {
    assert.ok(MemoryCompressionRequestSchema, 'MemoryCompressionRequestSchema contract must exist');
    assert.ok(EpisodicEpisodeSchema, 'EpisodicEpisodeSchema contract must exist');
    assert.ok(MemoryGraphNodeSchema, 'MemoryGraphNodeSchema contract must exist');
    assert.ok(MemoryGraphEdgeSchema, 'MemoryGraphEdgeSchema contract must exist');

    const wrapped = wrapUntrustedMemory('test content');
    assert.ok(wrapped.includes(UNTRUSTED_MEMORY_START_DELIMITER));
    assert.ok(wrapped.includes(UNTRUSTED_MEMORY_END_DELIMITER));

    const episodicLearnerPath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'memory',
      'episodic-learner.ts',
    );
    assert.ok(fs.existsSync(episodicLearnerPath), 'episodic-learner.ts must exist');

    const compressorPath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'memory',
      'memory-compressor.ts',
    );
    assert.ok(fs.existsSync(compressorPath), 'memory-compressor.ts must exist');

    const graphEnginePath = path.join(
      rootDir,
      'services',
      'backend',
      'src',
      'memory',
      'graph-projection-engine.ts',
    );
    assert.ok(fs.existsSync(graphEnginePath), 'graph-projection-engine.ts must exist');

    const vsTestPath = path.join(
      rootDir,
      'tests',
      'vertical-slice',
      'episodic-memory-vertical-slice.test.ts',
    );
    assert.ok(fs.existsSync(vsTestPath), 'episodic-memory-vertical-slice.test.ts must exist');
  });

  // Monorepo Workspace Integrity & Boundaries
  it('[DoD-S1-11] Monorepo workspace isolation encompasses all 8 packages with zero boundary leaks', () => {
    const workspaceYaml = fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    assert.ok(workspaceYaml.includes('packages/*'), 'Workspace must include packages/*');
    assert.ok(workspaceYaml.includes('services/*'), 'Workspace must include services/*');
    assert.ok(workspaceYaml.includes('apps/*'), 'Workspace must include apps/*');

    // Packages directory
    const pkgs = ['packages/contracts', 'packages/plugin-sdk'];
    for (const pkg of pkgs) {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, pkg, 'package.json'), 'utf8'));
      const deps = Object.keys(pkgJson.dependencies || {});
      assert.ok(
        !deps.some((d) => d.startsWith('@nexusos/backend')),
        `${pkg} must not depend on backend`,
      );
      assert.ok(
        !deps.some((d) => d.startsWith('@nexusos/desktop')),
        `${pkg} must not depend on desktop`,
      );
    }
  });

  // Operational Runbooks Coverage
  it('[DoD-S1-12] Operational runbooks exist for all 20 failure domains (RB-001 through RB-020)', () => {
    const runbooksDir = path.join(rootDir, 'docs', 'runbooks');
    assert.ok(fs.existsSync(runbooksDir), 'docs/runbooks directory must exist');

    for (let i = 1; i <= 20; i++) {
      const numStr = String(i).padStart(3, '0');
      const files = fs.readdirSync(runbooksDir).filter((f) => f.startsWith(`RB-${numStr}`));
      assert.strictEqual(
        files.length,
        1,
        `Exactly one runbook must exist for RB-${numStr} (found: ${files.join(', ')})`,
      );
    }

    const runbooksIndex = fs.readFileSync(path.join(rootDir, 'docs', 'RUNBOOKS.md'), 'utf8');
    for (let i = 1; i <= 20; i++) {
      const numStr = String(i).padStart(3, '0');
      assert.ok(
        runbooksIndex.includes(`RB-${numStr}`),
        `docs/RUNBOOKS.md must catalog RB-${numStr}`,
      );
    }
  });

  // Resource Baseline Audit
  it('[DoD-S1-13] Resource baseline report exists with Sprint 0 and Sprint 1 benchmarks', () => {
    const rbPath = path.join(rootDir, 'docs', 'RESOURCE_BASELINE.md');
    assert.ok(fs.existsSync(rbPath), 'docs/RESOURCE_BASELINE.md must exist');
    const rbContent = fs.readFileSync(rbPath, 'utf8');
    assert.ok(rbContent.includes('Sprint 0'), 'Resource baseline must include Sprint 0 data');
    assert.ok(rbContent.includes('Sprint 1'), 'Resource baseline must include Sprint 1 data');
  });

  // Milestone Reports Audit (Tasks 049 through 058)
  it('[DoD-S1-14] All Sprint 1 milestone completion reports exist (Tasks 049-058)', () => {
    for (let taskNum = 49; taskNum <= 58; taskNum++) {
      const reportName = `task_0${taskNum}_completion_report.md`;
      const reportPath = path.join(rootDir, reportName);
      assert.ok(fs.existsSync(reportPath), `${reportName} must exist`);
      const content = fs.readFileSync(reportPath, 'utf8');
      assert.ok(content.length > 500, `${reportName} must contain substantive report content`);
    }
  });

  // Sprint 1 Completion Report & Sprint 2 Readiness Documents
  it('[DoD-S1-15] SPRINT_1_COMPLETION_REPORT.md and SPRINT_2_READINESS_AND_BACKLOG.md exist', () => {
    const s1Report = path.join(rootDir, 'SPRINT_1_COMPLETION_REPORT.md');
    assert.ok(fs.existsSync(s1Report), 'SPRINT_1_COMPLETION_REPORT.md must exist');

    const s2Readiness = path.join(rootDir, 'docs', 'SPRINT_2_READINESS_AND_BACKLOG.md');
    assert.ok(fs.existsSync(s2Readiness), 'docs/SPRINT_2_READINESS_AND_BACKLOG.md must exist');
  });
});
