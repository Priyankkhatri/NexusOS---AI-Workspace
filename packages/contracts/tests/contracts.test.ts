import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  NEXUSOS_CONTRACT_VERSION,
  ErrorCategory,
  createNexusOSError,
  NexusOSErrorSchema,
  EventEnvelopeSchema,
  createEventEnvelope,
  ACPMessageEnvelopeSchema,
  createACPMessageEnvelope,
  ExecutionLeaseHeaderSchema,
  APISuccessResponseSchema,
  serializeContract,
  deserializeContract,
  TenantIdSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  WorkflowDAGSchema,
  TaskGraphCreateRequestSchema,
  WorkflowExecutionReceiptSchema,
  FilesystemOperation,
  resolveFilesystemOperation,
  WorkspaceDirectoryJailConfigSchema,
  computeFilesystemEvidenceChecksum,
  LocalAiOperation,
  resolveLocalAiOperation,
  ModelInferenceRequestSchema,
  ModelInferenceResponseSchema,
  computeModelEvidenceChecksum,
} from '../src/index.js';
import { z } from 'zod';

describe('@nexusos/contracts Foundation & Schema Validation Audit', () => {
  it('exposes a valid contract version string', () => {
    assert.strictEqual(typeof NEXUSOS_CONTRACT_VERSION, 'string');
    assert.strictEqual(NEXUSOS_CONTRACT_VERSION, '0.1.0-sprint0');
  });

  describe('Identity & UUID Validation', () => {
    it('accepts valid UUID strings', () => {
      const validUuid = crypto.randomUUID();
      assert.strictEqual(TenantIdSchema.parse(validUuid), validUuid);
    });

    it('rejects invalid UUID strings', () => {
      assert.throws(() => TenantIdSchema.parse('not-a-uuid'), /Invalid uuid/i);
    });
  });

  describe('Error Taxonomy & Schema Validation', () => {
    it('creates structured NexusOS errors matching specification taxonomy', () => {
      const corrId = crypto.randomUUID();
      const reqId = crypto.randomUUID();
      const err = createNexusOSError(
        'POLICY_VIOLATION_01',
        ErrorCategory.POLICY_DENIED,
        'Access denied by policy engine',
        { correlationId: corrId, requestId: reqId, details: { scope: 'desktop' } },
      );

      assert.strictEqual(err.code, 'POLICY_VIOLATION_01');
      assert.strictEqual(err.category, ErrorCategory.POLICY_DENIED);
      assert.strictEqual(err.correlationId, corrId);
      assert.strictEqual(err.requestId, reqId);
      assert.deepStrictEqual(err.details, { scope: 'desktop' });
      assert.ok(err.timestamp);
    });

    it('rejects errors with invalid categories or missing fields', () => {
      assert.throws(() => {
        NexusOSErrorSchema.parse({
          code: 'ERR_01',
          category: 'INVALID_CATEGORY',
          message: 'Error message',
          timestamp: new Date().toISOString(),
        });
      });
    });
  });

  describe('Event Envelope Schema Audit & Validation', () => {
    it('validates a valid event envelope with payload_ref and trace_id', () => {
      const corrId = crypto.randomUUID();
      const env = createEventEnvelope(
        'nexusos.system.task.created',
        '1.0',
        'orchestrator-service',
        corrId,
        { taskId: 'task-123', status: 'PENDING' },
        { payload_ref: 'art-99128', trace_id: 'tr-1102' },
      );

      assert.strictEqual(env.schema_id, 'nexusos.system.task.created');
      assert.strictEqual(env.version, '1.0');
      assert.strictEqual(env.producer_id, 'orchestrator-service');
      assert.strictEqual(env.correlation_id, corrId);
      assert.strictEqual(env.payload_ref, 'art-99128');
      assert.strictEqual(env.trace_id, 'tr-1102');
      assert.ok(EventEnvelopeSchema.safeParse(env).success);
    });

    it('rejects event envelope with invalid UUIDs or missing payload', () => {
      assert.throws(() => {
        EventEnvelopeSchema.parse({
          schema_id: 'nexusos.test',
          version: '1.0',
          event_id: 'invalid-id',
          correlation_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          producer_id: 'prod-1',
          payload: {},
        });
      });
    });
  });

  describe('ACP Message Envelope Schema Audit & Validation', () => {
    it('validates a valid ACP message envelope with auth_token, body_ref, and trace_hints', () => {
      const corrId = crypto.randomUUID();
      const acpMsg = createACPMessageEnvelope(
        '1.0',
        'agent-desktop-win01',
        'device-gateway',
        'acp.heartbeat.v1',
        corrId,
        { status: 'HEALTHY', battery: 100 },
        {
          auth_token: 'bearer_token_xyz',
          body_ref: 'art-88219',
          trace_hints: { parent_span: 'span-01' },
        },
      );

      assert.strictEqual(acpMsg.from_agent, 'agent-desktop-win01');
      assert.strictEqual(acpMsg.to_agent, 'device-gateway');
      assert.strictEqual(acpMsg.schema_id, 'acp.heartbeat.v1');
      assert.strictEqual(acpMsg.auth_token, 'bearer_token_xyz');
      assert.strictEqual(acpMsg.body_ref, 'art-88219');
      assert.deepStrictEqual(acpMsg.trace_hints, { parent_span: 'span-01' });
      assert.ok(ACPMessageEnvelopeSchema.safeParse(acpMsg).success);
    });

    it('rejects ACP envelope with missing to_agent or invalid timestamp', () => {
      assert.throws(() => {
        ACPMessageEnvelopeSchema.parse({
          version: '1.0',
          message_id: crypto.randomUUID(),
          correlation_id: crypto.randomUUID(),
          from_agent: 'agent-1',
          timestamp: 'invalid-date',
          schema_id: 'acp.test',
          payload: {},
        });
      });
    });
  });

  describe('Execution Lease Header Schema Audit & Validation', () => {
    it('validates a signed execution lease header with nonce and policy_hash', () => {
      const lease = {
        lease_id: crypto.randomUUID(),
        task_id: crypto.randomUUID(),
        agent_id: 'agent-desktop-01',
        tenant_id: crypto.randomUUID(),
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        scopes: ['file:read', 'terminal:exec'],
        signature: 'sig_ecdsa_sample_123',
        nonce: 'nonce-7712',
        policy_hash: 'sha256:abc123def456',
      };

      const parsed = ExecutionLeaseHeaderSchema.parse(lease);
      assert.strictEqual(parsed.agent_id, 'agent-desktop-01');
      assert.strictEqual(parsed.nonce, 'nonce-7712');
      assert.strictEqual(parsed.policy_hash, 'sha256:abc123def456');
      assert.strictEqual(parsed.scopes.length, 2);
    });

    it('rejects execution lease without scopes or signature', () => {
      assert.throws(() => {
        ExecutionLeaseHeaderSchema.parse({
          lease_id: crypto.randomUUID(),
          task_id: crypto.randomUUID(),
          agent_id: 'agent-01',
          tenant_id: crypto.randomUUID(),
          issued_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          scopes: [], // Must have at least 1 scope
          signature: 'sig',
        });
      });
    });
  });

  describe('Serialization and Deserialization Boundaries', () => {
    it('serializes and deserializes contracts accurately', () => {
      const meta = {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        clientVersion: '0.1.0',
      };

      const PayloadSchema = z.object({ taskName: z.string() });
      const ResponseSchema = APISuccessResponseSchema(PayloadSchema);

      const resInstance = {
        success: true as const,
        data: { taskName: 'Analyze repository' },
        meta,
      };

      const serialized = serializeContract(ResponseSchema, resInstance);
      assert.strictEqual(typeof serialized, 'string');

      const deserialized = deserializeContract(ResponseSchema, serialized);
      assert.strictEqual(deserialized.success, true);
      assert.strictEqual(deserialized.data.taskName, 'Analyze repository');
      assert.strictEqual(deserialized.meta.requestId, meta.requestId);
    });
  });

  describe('Task 049 Workflow DAG and Receipt Contracts', () => {
    const validLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: crypto.randomUUID(),
      tenant_id: crypto.randomUUID(),
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      scopes: ['capability:device:query'],
      signature: 'valid-sig',
    };

    it('validates a valid WorkflowDAG and accepts it', () => {
      const dag = {
        workflowId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        leaseHeader: validLeaseHeader,
        correlationId: crypto.randomUUID(),
        nodes: [
          {
            nodeId: 'node-1',
            capabilityId: 'device.queryInfo',
            runtimeCategory: 'DEVICE',
            name: 'Step 1',
          },
          {
            nodeId: 'node-2',
            capabilityId: 'device.execute',
            runtimeCategory: 'DEVICE',
            name: 'Step 2',
          },
        ],
        edges: [{ fromNodeId: 'node-1', toNodeId: 'node-2' }],
      };

      const parsed = WorkflowDAGSchema.parse(dag);
      assert.strictEqual(parsed.workflowId, dag.workflowId);
      assert.strictEqual(parsed.nodes.length, 2);
      assert.strictEqual(parsed.edges?.length, 1);
    });

    it('rejects malformed nodes (empty ID or capability)', () => {
      assert.throws(() => {
        WorkflowNodeSchema.parse({
          nodeId: '',
          capabilityId: 'device.queryInfo',
          runtimeCategory: 'DEVICE',
        });
      });
      assert.throws(() => {
        WorkflowNodeSchema.parse({ nodeId: 'node-1', capabilityId: '', runtimeCategory: 'DEVICE' });
      });
    });

    it('validates WorkflowEdgeSchema and rejects malformed edges', () => {
      const edge = WorkflowEdgeSchema.parse({ fromNodeId: 'node-1', toNodeId: 'node-2' });
      assert.strictEqual(edge.fromNodeId, 'node-1');
      assert.strictEqual(edge.toNodeId, 'node-2');
      assert.throws(() => WorkflowEdgeSchema.parse({ fromNodeId: '', toNodeId: 'node-2' }));
    });

    it('rejects duplicate node IDs in a DAG', () => {
      assert.throws(() => {
        WorkflowDAGSchema.parse({
          workflowId: crypto.randomUUID(),
          taskId: crypto.randomUUID(),
          leaseHeader: validLeaseHeader,
          correlationId: crypto.randomUUID(),
          nodes: [
            { nodeId: 'node-1', capabilityId: 'device.queryInfo', runtimeCategory: 'DEVICE' },
            { nodeId: 'node-1', capabilityId: 'device.execute', runtimeCategory: 'DEVICE' },
          ],
        });
      }, /Duplicate nodeId/);
    });

    it('rejects edges with invalid/missing node references', () => {
      assert.throws(() => {
        WorkflowDAGSchema.parse({
          workflowId: crypto.randomUUID(),
          taskId: crypto.randomUUID(),
          leaseHeader: validLeaseHeader,
          correlationId: crypto.randomUUID(),
          nodes: [
            { nodeId: 'node-1', capabilityId: 'device.queryInfo', runtimeCategory: 'DEVICE' },
          ],
          edges: [{ fromNodeId: 'node-1', toNodeId: 'node-missing' }],
        });
      }, /Edge references non-existent nodes/);
    });

    it('rejects cyclic workflow graph structures', () => {
      assert.throws(() => {
        WorkflowDAGSchema.parse({
          workflowId: crypto.randomUUID(),
          taskId: crypto.randomUUID(),
          leaseHeader: validLeaseHeader,
          correlationId: crypto.randomUUID(),
          nodes: [
            { nodeId: 'a', capabilityId: 'device.queryInfo', runtimeCategory: 'DEVICE' },
            { nodeId: 'b', capabilityId: 'device.execute', runtimeCategory: 'DEVICE' },
          ],
          edges: [
            { fromNodeId: 'a', toNodeId: 'b' },
            { fromNodeId: 'b', toNodeId: 'a' },
          ],
        });
      }, /Circular dependency cycle detected/);
    });

    it('validates TaskGraphCreateRequestSchema', () => {
      const validReq = {
        title: 'Multi-step Pipeline',
        targetAgentId: crypto.randomUUID(),
        nodes: [
          { nodeId: 'step-1', capabilityId: 'device.queryInfo', runtimeCategory: 'DEVICE' },
          { nodeId: 'step-2', capabilityId: 'device.execute', runtimeCategory: 'DEVICE' },
        ],
        edges: [{ fromNodeId: 'step-1', toNodeId: 'step-2' }],
      };

      const parsed = TaskGraphCreateRequestSchema.parse(validReq);
      assert.strictEqual(parsed.title, 'Multi-step Pipeline');
      assert.strictEqual(parsed.nodes.length, 2);
    });

    it('validates WorkflowExecutionReceiptSchema', () => {
      const receipt = {
        receiptId: crypto.randomUUID(),
        workflowId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        leaseId: crypto.randomUUID(),
        agentId: crypto.randomUUID(),
        tenantId: crypto.randomUUID(),
        status: 'SUCCESS' as const,
        completedNodes: ['step-1'],
        evidenceChecksum: 'a'.repeat(64),
        nodeOutputs: {
          'step-1': { ok: true },
        },
        completedAt: new Date().toISOString(),
        signature: 'valid-sig',
      };

      const parsed = WorkflowExecutionReceiptSchema.parse(receipt);
      assert.strictEqual(parsed.status, 'SUCCESS');
      assert.deepStrictEqual(parsed.nodeOutputs['step-1'], { ok: true });
    });
  });

  describe('Task 050 Filesystem & Workspace Jail Contracts', () => {
    it('resolves canonical and dot-notated filesystem operations', () => {
      assert.strictEqual(resolveFilesystemOperation('fs.readFile'), FilesystemOperation.READ);
      assert.strictEqual(resolveFilesystemOperation('fs:read'), FilesystemOperation.READ);
      assert.strictEqual(
        resolveFilesystemOperation('filesystem.writeFile'),
        FilesystemOperation.WRITE,
      );
      assert.strictEqual(resolveFilesystemOperation('fs:delete'), FilesystemOperation.DELETE);
      assert.strictEqual(resolveFilesystemOperation('fs.copyFile'), FilesystemOperation.COPY);
      assert.strictEqual(resolveFilesystemOperation('fs.moveFile'), FilesystemOperation.MOVE);
      assert.strictEqual(resolveFilesystemOperation('fs.statFile'), FilesystemOperation.STAT);
      assert.strictEqual(resolveFilesystemOperation('unknown.operation'), undefined);
    });

    it('validates WorkspaceDirectoryJailConfigSchema', () => {
      const validJail = {
        workspaceId: crypto.randomUUID(),
        tenantId: crypto.randomUUID(),
        rootPath: 'C:\\NexusOS\\workspaces\\ws-1',
        isReadOnly: false,
      };
      const parsed = WorkspaceDirectoryJailConfigSchema.parse(validJail);
      assert.strictEqual(parsed.workspaceId, validJail.workspaceId);
      assert.strictEqual(parsed.isReadOnly, false);
    });

    it('computes deterministic filesystem evidence checksum', () => {
      const checksum1 = computeFilesystemEvidenceChecksum({
        taskId: 'task-1',
        leaseId: 'lease-1',
        operation: 'fs:write',
        canonicalPath: 'C:\\workspace\\test.txt',
        preHash: 'a'.repeat(64),
        postHash: 'b'.repeat(64),
        bytesProcessed: 100,
        snapshotId: 'snap-1',
      });
      const checksum2 = computeFilesystemEvidenceChecksum({
        taskId: 'task-1',
        leaseId: 'lease-1',
        operation: 'fs:write',
        canonicalPath: 'C:\\workspace\\test.txt',
        preHash: 'a'.repeat(64),
        postHash: 'b'.repeat(64),
        bytesProcessed: 100,
        snapshotId: 'snap-1',
      });
      assert.strictEqual(checksum1, checksum2);
      assert.match(checksum1, /^[a-f0-9]{64}$/);
    });
  });

  describe('Task 051 Local AI Model Inference and Evidence Contracts', () => {
    const validLeaseHeader = {
      lease_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      agent_id: crypto.randomUUID(),
      tenant_id: crypto.randomUUID(),
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      scopes: ['ai:inference', 'ai:write'],
      signature: 'valid-sig',
    };

    it('resolves Local AI capability strings to canonical LocalAiOperation', () => {
      assert.strictEqual(resolveLocalAiOperation('localAi.generate'), LocalAiOperation.GENERATE);
      assert.strictEqual(resolveLocalAiOperation('local-ai:generate'), LocalAiOperation.GENERATE);
      assert.strictEqual(resolveLocalAiOperation('localai.generate'), LocalAiOperation.GENERATE);
      assert.strictEqual(
        resolveLocalAiOperation('localAi.listModels'),
        LocalAiOperation.LIST_MODELS,
      );
      assert.strictEqual(
        resolveLocalAiOperation('localAi.getHardwareProfile'),
        LocalAiOperation.GET_HARDWARE_PROFILE,
      );
      assert.strictEqual(
        resolveLocalAiOperation('localAi.unloadModel'),
        LocalAiOperation.UNLOAD_MODEL,
      );
      assert.strictEqual(resolveLocalAiOperation('unknown.operation'), undefined);
    });

    it('validates ModelInferenceRequestSchema with valid payload and defaults', () => {
      const validReq = {
        requestId: crypto.randomUUID(),
        taskId: 'task-ai-101',
        tenantId: validLeaseHeader.tenant_id,
        leaseHeader: validLeaseHeader,
        modelId: 'onnx-llama-3-8b',
        prompt: 'Summarize the architecture report.',
      };
      const parsed = ModelInferenceRequestSchema.parse(validReq);
      assert.strictEqual(parsed.provider, 'onnx');
      assert.strictEqual(parsed.temperature, 0.7);
      assert.strictEqual(parsed.maxTokens, 2048);
      assert.strictEqual(parsed.hardwareBudget.allowCpuFallback, true);
      assert.strictEqual(parsed.isolationPolicy.strictSeparation, true);
      assert.strictEqual(parsed.isolationPolicy.neutralizeControlTokens, true);
    });

    it('rejects ModelInferenceRequestSchema with invalid modelId or missing lease', () => {
      const invalidModelId = {
        requestId: crypto.randomUUID(),
        taskId: 'task-ai-102',
        tenantId: validLeaseHeader.tenant_id,
        leaseHeader: validLeaseHeader,
        modelId: 'bad model!@#$%',
        prompt: 'Hello world',
      };
      assert.throws(() => ModelInferenceRequestSchema.parse(invalidModelId));

      const missingLease = {
        requestId: crypto.randomUUID(),
        taskId: 'task-ai-103',
        tenantId: validLeaseHeader.tenant_id,
        modelId: 'valid-model',
        prompt: 'Hello world',
      };
      assert.throws(() => ModelInferenceRequestSchema.parse(missingLease));
    });

    it('validates ModelInferenceResponseSchema', () => {
      const checksum = computeModelEvidenceChecksum({
        taskId: 'task-ai-101',
        leaseId: validLeaseHeader.lease_id,
        modelId: 'onnx-llama-3-8b',
        provider: 'onnx',
        promptHash: 'a'.repeat(64),
        outputHash: 'b'.repeat(64),
        cpuFallback: false,
        totalTokens: 150,
      });

      const validRes = {
        requestId: crypto.randomUUID(),
        taskId: 'task-ai-101',
        modelId: 'onnx-llama-3-8b',
        provider: 'onnx' as const,
        content: 'This is the model response.',
        finishReason: 'stop' as const,
        usage: {
          promptTokens: 50,
          completionTokens: 100,
          totalTokens: 150,
        },
        hardwareProfileUsed: {
          gpuAccelerated: true,
          vramAllocatedBytes: 4294967296,
          ramAllocatedBytes: 8589934592,
          cpuFallback: false,
        },
        durationMs: 450,
        evidenceChecksum: checksum,
        redacted: false,
      };

      const parsed = ModelInferenceResponseSchema.parse(validRes);
      assert.strictEqual(parsed.finishReason, 'stop');
      assert.strictEqual(parsed.evidenceChecksum, checksum);
    });

    it('computes deterministic model evidence checksum with tamper detection', () => {
      const params = {
        taskId: 'task-ai-101',
        leaseId: 'lease-99',
        modelId: 'onnx-llama-3-8b',
        provider: 'onnx',
        promptHash: 'a'.repeat(64),
        outputHash: 'b'.repeat(64),
        cpuFallback: false,
        totalTokens: 200,
      };

      const checksum1 = computeModelEvidenceChecksum(params);
      const checksum2 = computeModelEvidenceChecksum(params);
      assert.strictEqual(checksum1, checksum2);
      assert.match(checksum1, /^[a-f0-9]{64}$/);

      // Tampering test: different fallback flag or tokens produces different hash
      const tamperedChecksum = computeModelEvidenceChecksum({
        ...params,
        cpuFallback: true,
      });
      assert.notStrictEqual(checksum1, tamperedChecksum);
    });
  });
});
