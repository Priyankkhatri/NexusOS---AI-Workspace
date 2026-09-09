import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PlannerService,
  defaultCapabilityRegistry,
  AmbiguousGoalException,
} from '@nexusos/backend';
import { MemoryService, InMemoryMemoryStore } from '@nexusos/backend';
import {
  MemoryClass,
  MemorySensitivity,
  MemorySourceType,
  PLANNER_SAFETY_LIMITS,
} from '@nexusos/contracts';
import { LeaseIssuer, ReceiptVerifier, computeReceiptSignature } from '@nexusos/backend';
import { ReferencePolicyEvaluator, loadPolicyConfig, PolicyEffect } from '@nexusos/policy';
import { AuthenticatedContext, PrincipalType } from '@nexusos/identity';

describe('Task 057 — Autonomous Workflow Vertical Slice', () => {
  const tenantId = 'e0000000-0000-4000-8000-000000000001';
  const workspaceId = 'e0000000-0000-4000-8000-000000000002';
  const userId = 'e0000000-0000-4000-8000-000000000003';
  const agentId = 'e0000000-0000-4000-8000-000000000004';
  const unauthorizedTenantId = 'e0000000-0000-4000-8000-000000000099';

  let memoryStore: InMemoryMemoryStore;
  let memoryService: MemoryService;
  let plannerService: PlannerService;
  let policyEvaluator: ReferencePolicyEvaluator;
  let leaseIssuer: LeaseIssuer;
  let receiptVerifier: ReceiptVerifier;

  const authContext: AuthenticatedContext = {
    principal: {
      type: PrincipalType.USER,
      userId,
      tenantId,
      roles: ['operator', 'developer'],
    },
    tenantId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    rawTokenHash: 'test-token-hash-vertical-slice',
  };

  beforeEach(() => {
    memoryStore = new InMemoryMemoryStore();
    memoryService = new MemoryService({ store: memoryStore });
    plannerService = new PlannerService({
      memoryService,
      capabilityRegistry: defaultCapabilityRegistry,
    });
    const secret = 'test-secret-key-vertical-slice-min-32-chars-long!';
    const rules = [
      {
        ruleId: 'rule-filesystem-operator',
        actionName: 'filesystem.writeFile',
        resourceType: 'filesystem',
        requiredRole: 'operator',
        effect: PolicyEffect.ALLOW,
      },
    ];
    policyEvaluator = new ReferencePolicyEvaluator(loadPolicyConfig(), rules);
    leaseIssuer = new LeaseIssuer(secret);
    receiptVerifier = new ReceiptVerifier(secret);
  });

  // =========================================================================
  // SAFE PATH: GOAL -> MEMORY -> PROPOSAL -> POLICY -> LEASE -> REPLAN
  // =========================================================================
  describe('Safe Authority Path', () => {
    it('executes full governed flow: goal -> memory retrieval -> DAG proposal -> policy -> lease -> failure evidence -> v2 replan', async () => {
      const secret = 'test-secret-key-vertical-slice-min-32-chars-long!';

      // 1. Seed Governed Persistent Memory (Task 056 context)
      await memoryService.createMemory(
        {
          tenantId,
          workspaceId,
          ownerId: userId,
          class: MemoryClass.SEMANTIC,
          title: 'Project Setup Guidelines',
          content:
            'Guidelines: Read configuration from ./config.json and output transformed result to ./dist/build.json',
          confidence: 1.0,
          sensitivity: MemorySensitivity.INTERNAL,
          provenance: {
            sourceType: MemorySourceType.USER_EXPLICIT,
            creatorPrincipalId: userId,
            timestamp: new Date().toISOString(),
          },
        },
        { tenantId, workspaceId, principalId: userId },
      );

      // 2. Intake high-level user goal
      const planRequest = {
        tenantId,
        workspaceId,
        targetAgentId: agentId,
        submittedBy: userId,
        goal: 'Read config file config.json, transform it, and write build report to dist/build.json',
      };

      // 3. PlannerService coordinates normalization + memory retrieval + decomposition + synthesis
      const proposal = await plannerService.planGoal(planRequest, authContext);

      // 4. Assert plan remains strictly a PROPOSAL (057-SEC-01)
      assert.equal(proposal.status, 'PROPOSED');
      assert.ok(proposal.planId);
      assert.ok(proposal.dag.nodes.length >= 2);
      assert.ok(proposal.requiredCapabilities.includes('filesystem.readFile'));
      assert.ok(proposal.requiredCapabilities.includes('filesystem.writeFile'));
      assert.equal(proposal.requiresHumanApproval, true); // writing to filesystem requires approval
      assert.equal(proposal.estimatedRiskTier, 'MEDIUM');

      // The proposal CANNOT execute directly without lease and policy evaluation
      const anyProposal = proposal as Record<string, unknown>;
      assert.equal(anyProposal['signedLease'], undefined);
      assert.equal(anyProposal['executionReceipt'], undefined);

      // 5. Policy Evaluation Boundary (Authority Check)
      const policyDecision = await policyEvaluator.evaluate({
        subject: authContext,
        action: { actionName: 'filesystem.writeFile', requiredRole: 'operator' },
        resource: { resourceType: 'filesystem', resourceId: './dist/build.json', tenantId },
        context: {
          requestId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
          requestTimestamp: new Date().toISOString(),
        },
      });
      assert.equal(policyDecision.effect, PolicyEffect.ALLOW);

      // 6. Signed Lease Issuance Boundary (Execution Authority)
      const taskId = crypto.randomUUID();
      const nodeToExecute = proposal.dag.nodes.find(
        (n) => n.capabilityId === 'filesystem.writeFile',
      )!;
      const lease = leaseIssuer.issueLease({
        taskId,
        agentId,
        tenantId,
        scopes: ['filesystem:write'],
        policyHash: crypto.createHash('sha256').update('allow').digest('hex'),
      });

      assert.ok(lease.lease_id);
      assert.ok(lease.signature);

      // 7. Simulating execution plane execution & node completion receipt
      const output = { bytesWritten: 256, path: './dist/build.json' };
      const evidenceChecksum = crypto
        .createHash('sha256')
        .update(JSON.stringify(output))
        .digest('hex');

      const executionReceipt = {
        receiptId: crypto.randomUUID(),
        taskId,
        leaseId: lease.lease_id,
        agentId,
        tenantId,
        status: 'SUCCESS' as const,
        exitCode: 0,
        output,
        evidenceChecksum,
        completedAt: new Date().toISOString(),
      };

      const receiptSig = computeReceiptSignature(executionReceipt, secret);
      const verifiedReceipt = receiptVerifier.verifyReceipt({
        receipt: { ...executionReceipt, signature: receiptSig },
        expectedTaskId: taskId,
        expectedLeaseId: lease.lease_id,
        expectedAgentId: agentId,
        expectedTenantId: tenantId,
      });
      assert.equal(verifiedReceipt.valid, true);

      // 8. Adaptive Replanning upon downstream failure in node 2
      const failedNodeId = 'node-subsequent-fail';
      const replanRequest = {
        tenantId,
        workspaceId,
        taskId,
        originalWorkflowId: proposal.planId,
        priorVersion: 1,
        replanIteration: 1,
        failedNodeId,
        failureReason: 'Remote artifact mirror connection timeout while uploading build artifact',
        failureEvidenceChecksum: crypto
          .createHash('sha256')
          .update('connection-timeout')
          .digest('hex'),
        completedNodes: [nodeToExecute.nodeId],
        completedNodeOutputs: {
          [nodeToExecute.nodeId]: output,
        },
        originalDAG: proposal.dag,
      };

      const replanResponse = await plannerService.replanGoal(replanRequest, authContext);

      // 9. Verify Successor DAG Proposal (057-SEC-05)
      assert.equal(replanResponse.version, 2);
      assert.equal(replanResponse.replanIteration, 1);
      assert.equal(replanResponse.status, 'PROPOSED');
      assert.equal(replanResponse.priorWorkflowId, proposal.planId);
      assert.notEqual(replanResponse.successorWorkflowId, proposal.planId);
      // Completed node was sealed and omitted from re-execution
      assert.ok(replanResponse.preservedCompletedNodes.includes(nodeToExecute.nodeId));
      const successorNodeIds = replanResponse.successorDAG.nodes.map((n) => n.nodeId);
      assert.ok(!successorNodeIds.includes(nodeToExecute.nodeId));
    });
  });

  // =========================================================================
  // DENIED PATH: AUTHORITY BYPASS, UNREGISTERED TOOLS, CROSS-TENANT DEFENSES
  // =========================================================================
  describe('Denied Authority Path', () => {
    it('blocks planner direct execution attempt without signed lease or policy evaluation (057-SEC-01)', () => {
      // PlannerService does not expose execute or issueLease methods
      const untrustedCaller = plannerService as unknown as Record<string, unknown>;
      assert.equal(typeof untrustedCaller['executeDAG'], 'undefined');
      assert.equal(typeof untrustedCaller['dispatchLease'], 'undefined');
      assert.equal(typeof untrustedCaller['issueSignedLease'], 'undefined');
    });

    it('blocks cross-tenant plan requests fail-closed (057-SEC-02)', async () => {
      await assert.rejects(async () => {
        await plannerService.planGoal(
          {
            tenantId: unauthorizedTenantId,
            workspaceId,
            targetAgentId: agentId,
            submittedBy: userId,
            goal: 'Inspect unauthorized tenant data',
          },
          authContext, // Authenticated for tenantId, not unauthorizedTenantId
        );
      }, /CROSS_TENANT_FORBIDDEN/);
    });

    it('rejects ambiguous goals without clear deliverable or action target fail-closed (057-SEC-01)', async () => {
      await assert.rejects(
        async () => {
          await plannerService.planGoal(
            {
              tenantId,
              workspaceId,
              targetAgentId: agentId,
              submittedBy: userId,
              goal: 'fix it',
            },
            authContext,
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof AmbiguousGoalException);
          assert.equal(err.details?.code, 'AMBIGUOUS_GOAL');
          return true;
        },
      );
    });

    it('blocks excessive complexity beyond safety limits fail-closed (057-SEC-03)', () => {
      const oversizedNodeList = Array.from(
        { length: PLANNER_SAFETY_LIMITS.MAX_NODES + 5 },
        (_, i) => ({
          nodeId: `node-${i}`,
          name: `Node ${i}`,
          capabilityId: 'filesystem.readFile',
          runtimeCategory: 'FILESYSTEM' as const,
          parameters: {},
        }),
      );

      const dependencyAnalyzer = (
        plannerService as unknown as {
          analyzer: { analyze: (...args: unknown[]) => { valid: boolean; errorCode?: string } };
        }
      ).analyzer;

      const analyzed = dependencyAnalyzer.analyze(oversizedNodeList, []);
      assert.equal(analyzed.valid, false);
      assert.equal(analyzed.errorCode, 'EXCEEDS_MAX_NODES');
    });

    it('blocks replanning after 3 failed iterations fail-closed (057-SEC-05)', async () => {
      const replanCoordinator = (
        plannerService as unknown as {
          replanCoordinator: { coordinateReplan: (args: unknown) => unknown };
        }
      ).replanCoordinator;

      assert.throws(() => {
        replanCoordinator.coordinateReplan({
          taskId: crypto.randomUUID(),
          originalWorkflowId: crypto.randomUUID(),
          priorVersion: 3,
          replanIteration: 4, // 4 > MAX_REPLAN_ITERATIONS (3)
          failedNodeId: 'node-fail',
          failureReason: 'Repeated fatal error on 4th attempt',
          failureEvidenceChecksum: crypto.createHash('sha256').update('fatal').digest('hex'),
          completedNodes: [],
          completedNodeOutputs: {},
          originalDAG: {
            tenantId,
            workspaceId,
            title: 'DAG',
            targetAgentId: agentId,
            nodes: [
              {
                nodeId: 'node-fail',
                name: 'Fail',
                capabilityId: 'filesystem.readFile',
                runtimeCategory: 'FILESYSTEM',
                parameters: {},
              },
            ],
          },
        });
      }, /EXCEEDS_MAX_REPLAN_ITERATIONS/);
    });
  });
});
