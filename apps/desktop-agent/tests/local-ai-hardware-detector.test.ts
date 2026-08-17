import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HardwareDetector, IHardwareSampler } from '../src/runtimes/local-ai/hardware-detector.js';

describe('Task 03T — HardwareDetector Unit Tests', () => {
  it('HD-01: getProfile returns normalized hardware profile', async () => {
    const detector = new HardwareDetector();
    const profile = await detector.getProfile();

    assert.ok(profile.cpuArch, 'CPU arch should be non-empty');
    assert.ok(profile.cpuCores >= 1, 'CPU cores must be >= 1');
    assert.ok(profile.totalRamBytes > 0, 'Total RAM must be > 0');
    assert.ok(profile.freeRamBytes > 0, 'Free RAM must be > 0');
    assert.equal(typeof profile.hasNpu, 'boolean');
    assert.ok(['normal', 'throttled', 'critical'].includes(profile.thermalState));
  });

  it('HD-02: custom sampler injection overrides GPU and NPU information', async () => {
    const mockSampler: IHardwareSampler = {
      sampleGpuAdapters: async () => [
        { name: 'NVIDIA RTX 4090', vramBytes: 25769803776, freeVramBytes: 21474836480 },
      ],
      sampleNpuPresence: async () => true,
      sampleThermalState: async () => 'normal',
    };

    const detector = new HardwareDetector(mockSampler);
    const profile = await detector.getProfile();

    assert.equal(profile.gpuAdapters.length, 1);
    assert.equal(profile.gpuAdapters[0].name, 'NVIDIA RTX 4090');
    assert.equal(profile.gpuAdapters[0].vramBytes, 25769803776);
    assert.equal(profile.hasNpu, true);
  });

  it('HD-03: sampler exceptions do not crash detector and trigger fallback', async () => {
    const throwingSampler: IHardwareSampler = {
      sampleGpuAdapters: async () => {
        throw new Error('GPU driver crashed');
      },
      sampleNpuPresence: async () => {
        throw new Error('NPU query failed');
      },
      sampleThermalState: async () => {
        throw new Error('WMI query denied');
      },
    };

    const detector = new HardwareDetector(throwingSampler);
    const profile = await detector.getProfile();

    assert.equal(profile.gpuAdapters.length, 0, 'GPU list should fallback to empty array');
    assert.equal(profile.hasNpu, false, 'NPU should fallback to false');
    assert.equal(profile.thermalState, 'normal', 'Thermal state should fallback to normal');
  });

  it('HD-04: cache invalidation forces fresh sampling', async () => {
    let callCount = 0;
    const countingSampler: IHardwareSampler = {
      sampleGpuAdapters: async () => {
        callCount++;
        return [];
      },
      sampleNpuPresence: async () => false,
      sampleThermalState: async () => 'normal',
    };

    const detector = new HardwareDetector(countingSampler, 10000);
    await detector.getProfile();
    assert.equal(callCount, 1);

    await detector.getProfile(); // Should hit TTL cache
    assert.equal(callCount, 1);

    detector.invalidateCache();
    await detector.getProfile(); // Should re-sample
    assert.equal(callCount, 2);
  });
});
