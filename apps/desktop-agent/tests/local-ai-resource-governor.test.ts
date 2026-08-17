import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceGovernor } from '../src/runtimes/local-ai/resource-governor.js';
import { HardwareProfile, InferenceRequest } from '../src/runtimes/local-ai/types.js';

describe('Task 03T — ResourceGovernor Unit Tests', () => {
  const sampleHardware: HardwareProfile = {
    cpuArch: 'x64',
    cpuCores: 8,
    totalRamBytes: 16106127360, // 15 GB
    freeRamBytes: 8589934592, // 8 GB
    gpuAdapters: [
      { name: 'NVIDIA RTX 3080', vramBytes: 10737418240, freeVramBytes: 8589934592 }, // 10 GB VRAM
    ],
    hasNpu: false,
    thermalState: 'normal',
    sampledAt: Date.now(),
  };

  const makeReq = (id: string): InferenceRequest => ({
    requestId: id,
    modelId: 'test-model-7b',
    provider: 'ollama',
    prompt: 'Hello world',
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    callerId: 'caller-1',
    correlationId: 'corr-1',
  });

  it('RG-01: successful reservation updates active counters', async () => {
    const governor = new ResourceGovernor();
    const req = makeReq('req-1');

    const res = await governor.reserve(req, sampleHardware);
    assert.ok(res.reservationId);
    assert.equal(res.isReleased, false);

    const stats = governor.getStats();
    assert.equal(stats.activeConcurrentCount, 1);
    assert.ok(stats.reservedRamBytes > 0);
  });

  it('RG-02: rejects request when max concurrent inference limit is reached', async () => {
    const governor = new ResourceGovernor(2); // Max 2 concurrent
    await governor.reserve(makeReq('req-1'), sampleHardware);
    await governor.reserve(makeReq('req-2'), sampleHardware);

    await assert.rejects(
      () => governor.reserve(makeReq('req-3'), sampleHardware),
      /maximum concurrent inference limit of 2 reached/i,
    );
  });

  it('RG-03: rejects request exceeding 70% System RAM ceiling', async () => {
    const governor = new ResourceGovernor(5, 0.7, 0.8);
    const lowRamHardware: HardwareProfile = {
      ...sampleHardware,
      totalRamBytes: 1073741824, // 1 GB RAM
    };

    await assert.rejects(
      () => governor.reserve(makeReq('req-1'), lowRamHardware),
      /exceeds safety ceiling of 751619276 bytes \(70% system RAM\)/i,
    );
  });

  it('RG-04: rejects request exceeding 80% GPU VRAM ceiling', async () => {
    const governor = new ResourceGovernor(5, 0.7, 0.8);
    const lowVramHardware: HardwareProfile = {
      ...sampleHardware,
      gpuAdapters: [{ name: 'Low VRAM GPU', vramBytes: 1073741824, freeVramBytes: 1073741824 }], // 1 GB VRAM
    };

    const bigModel = {
      modelId: 'huge-model',
      name: 'Huge',
      provider: 'ollama' as const,
      sha256: 'a'.repeat(64),
      fileSizeBytes: 2147483648, // 2 GB requires ~1.8 GB VRAM
      format: 'gguf' as const,
      quantization: 'q4_0',
      contextWindowTokens: 4096,
      storagePath: '/models/huge',
      state: 'Installed' as const,
    };

    await assert.rejects(
      () => governor.reserve(makeReq('req-1'), lowVramHardware, bigModel),
      /exceeds safety ceiling of 858993459 bytes \(80% GPU VRAM\)/i,
    );
  });

  it('RG-05: release restores capacity and is idempotent', async () => {
    const governor = new ResourceGovernor(1);
    const res = await governor.reserve(makeReq('req-1'), sampleHardware);
    assert.equal(governor.getStats().activeConcurrentCount, 1);

    const released1 = governor.release(res);
    assert.equal(released1, true);
    assert.equal(governor.getStats().activeConcurrentCount, 0);

    const released2 = governor.release(res); // Double release
    assert.equal(released2, false, 'Second release must return false');
    assert.equal(
      governor.getStats().activeConcurrentCount,
      0,
      'Counter must not underflow below 0',
    );
  });
});
