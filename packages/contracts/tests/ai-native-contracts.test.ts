import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeEngineTypeSchema,
  ModelFormatSchema,
  QuantizationTypeSchema,
  ExecutionBackendSchema,
  EngineCapabilityStatusSchema,
  ModelLayerPlacementSchema,
  InferenceExecutionPlanSchema,
  NativeInferenceEvidenceSchema,
  computeNativeEvidenceChecksum,
} from '../src/ai/native.js';

describe('Task 061: Native AI Execution Contracts Audit', () => {
  it('validates supported model formats (gguf, onnx)', () => {
    assert.equal(NativeEngineTypeSchema.parse('llamacpp'), 'llamacpp');
    assert.equal(NativeEngineTypeSchema.parse('onnx'), 'onnx');
    assert.equal(ModelFormatSchema.parse('gguf'), 'gguf');
    assert.equal(ModelFormatSchema.parse('onnx'), 'onnx');

    assert.throws(() => ModelFormatSchema.parse('bin'), /Invalid enum value/);
    assert.throws(() => ModelFormatSchema.parse('safetensors'), /Invalid enum value/);
    assert.throws(() => ModelFormatSchema.parse(''), /Invalid enum value/);
  });

  it('validates quantization types (Q4_0, Q4_K_M, FP16, etc.)', () => {
    assert.equal(QuantizationTypeSchema.parse('Q4_K_M'), 'Q4_K_M');
    assert.equal(QuantizationTypeSchema.parse('Q8_0'), 'Q8_0');
    assert.equal(QuantizationTypeSchema.parse('FP16'), 'FP16');
    assert.equal(QuantizationTypeSchema.parse('INT8'), 'INT8');

    assert.throws(() => QuantizationTypeSchema.parse('UNKNOWN_Q'), /Invalid enum value/);
  });

  it('validates execution backends (cpu, cuda, rocm, directml, etc.)', () => {
    assert.equal(ExecutionBackendSchema.parse('cpu'), 'cpu');
    assert.equal(ExecutionBackendSchema.parse('cuda'), 'cuda');
    assert.equal(ExecutionBackendSchema.parse('directml'), 'directml');
    assert.equal(ExecutionBackendSchema.parse('vulkan'), 'vulkan');

    assert.throws(() => ExecutionBackendSchema.parse('opencl'), /Invalid enum value/);
  });

  it('validates engine capability status (SUPPORTED, UNAVAILABLE, FALLBACK, FAILED)', () => {
    assert.equal(EngineCapabilityStatusSchema.parse('SUPPORTED'), 'SUPPORTED');
    assert.equal(EngineCapabilityStatusSchema.parse('UNAVAILABLE'), 'UNAVAILABLE');
    assert.equal(EngineCapabilityStatusSchema.parse('FALLBACK'), 'FALLBACK');
    assert.equal(EngineCapabilityStatusSchema.parse('FAILED'), 'FAILED');

    assert.throws(() => EngineCapabilityStatusSchema.parse('PARTIAL'), /Invalid enum value/);
  });

  it('validates well-formed model layer placement', () => {
    const validPlacement = {
      totalLayers: 32,
      gpuLayers: 24,
      cpuLayers: 8,
      vramAllocatedBytes: 4294967296,
      ramAllocatedBytes: 1073741824,
      offloadRatio: 0.75,
      backend: 'cuda',
      quantization: 'Q4_K_M',
    };

    const parsed = ModelLayerPlacementSchema.parse(validPlacement);
    assert.equal(parsed.totalLayers, 32);
    assert.equal(parsed.gpuLayers, 24);
    assert.equal(parsed.cpuLayers, 8);
    assert.equal(parsed.offloadRatio, 0.75);
  });

  it('rejects malformed model layer placement where layer sums do not match totalLayers', () => {
    const malformedPlacement = {
      totalLayers: 32,
      gpuLayers: 20,
      cpuLayers: 8, // 20 + 8 = 28 != 32
      vramAllocatedBytes: 4294967296,
      ramAllocatedBytes: 1073741824,
      offloadRatio: 0.625,
      backend: 'cuda',
      quantization: 'Q4_K_M',
    };

    assert.throws(
      () => ModelLayerPlacementSchema.parse(malformedPlacement),
      /Sum of gpuLayers and cpuLayers must equal totalLayers/,
    );
  });

  it('validates complete inference execution plan with CPU fallback', () => {
    const plan = {
      planId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      modelId: 'phi-3-mini-4k-instruct-q4',
      modelFormat: 'gguf',
      placement: {
        totalLayers: 32,
        gpuLayers: 0,
        cpuLayers: 32,
        vramAllocatedBytes: 0,
        ramAllocatedBytes: 2400000000,
        offloadRatio: 0,
        backend: 'cpu',
        quantization: 'Q4_K_M',
      },
      status: 'FALLBACK',
      isCpuFallback: true,
      fallbackReason: 'No physical GPU detected; executing in CPU quantized mode',
      estimatedVramUsageBytes: 0,
      estimatedRamUsageBytes: 2400000000,
      createdAt: Date.now(),
    };

    const parsed = InferenceExecutionPlanSchema.parse(plan);
    assert.equal(parsed.version, '1.0.0');
    assert.equal(parsed.isCpuFallback, true);
    assert.equal(parsed.status, 'FALLBACK');
    assert.equal(parsed.placement.gpuLayers, 0);
  });

  it('validates native inference evidence schema and deterministic checksum generation', () => {
    const evidenceParams = {
      taskId: 'task-061-test',
      leaseId: 'lease-061-abc',
      tenantId: 'c0a80101-0000-4000-8000-000000000001',
      modelId: 'llama-3-8b-instruct-q4_k_m',
      modelFormat: 'gguf',
      engine: 'llamacpp',
      backend: 'cuda',
      quantization: 'Q4_K_M',
      promptDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      outputDigest: '7505d64a54e061b7acd54ccd58b49dc43500b6350407351582d5986882b42c6e',
      isCpuFallback: false,
      tokensGenerated: 128,
      executionPlanId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      timestamp: 1726000000000,
    };

    const checksum = computeNativeEvidenceChecksum(evidenceParams);
    assert.equal(typeof checksum, 'string');
    assert.equal(checksum.length, 64);

    // Tampering test: changing prompt digest alters evidence checksum
    const tamperedChecksum = computeNativeEvidenceChecksum({
      ...evidenceParams,
      promptDigest: '0000000000000000000000000000000000000000000000000000000000000000',
    });
    assert.notEqual(checksum, tamperedChecksum);

    // Verify schema validation
    const evidenceRecord = {
      requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      taskId: evidenceParams.taskId,
      leaseId: evidenceParams.leaseId,
      tenantId: evidenceParams.tenantId,
      modelId: evidenceParams.modelId,
      modelFormat: 'gguf',
      engine: 'llamacpp',
      backend: 'cuda',
      quantization: 'Q4_K_M',
      promptDigest: evidenceParams.promptDigest,
      outputDigest: evidenceParams.outputDigest,
      tokensGenerated: 128,
      executionPlanId: evidenceParams.executionPlanId,
      isCpuFallback: false,
      status: 'SUPPORTED',
      evidenceChecksum: checksum,
      durationMs: 420,
      timestamp: evidenceParams.timestamp,
    };

    const parsed = NativeInferenceEvidenceSchema.parse(evidenceRecord);
    assert.equal(parsed.evidenceChecksum, checksum);
    assert.equal(parsed.version, '1.0.0');
  });

  it('rejects invalid memory budgets in execution plan (negative bytes)', () => {
    const invalidPlan = {
      planId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      modelId: 'phi-3-mini',
      modelFormat: 'gguf',
      placement: {
        totalLayers: 32,
        gpuLayers: 16,
        cpuLayers: 16,
        vramAllocatedBytes: -100, // Invalid negative
        ramAllocatedBytes: 1000,
        offloadRatio: 0.5,
        backend: 'cuda',
        quantization: 'Q4_K_M',
      },
      status: 'SUPPORTED',
      isCpuFallback: false,
      estimatedVramUsageBytes: -1, // Invalid negative
      estimatedRamUsageBytes: 1000,
      createdAt: Date.now(),
    };

    assert.throws(() => InferenceExecutionPlanSchema.parse(invalidPlan));
  });
});
