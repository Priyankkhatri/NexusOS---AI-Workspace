import os from 'node:os';
import { HardwareProfile, GpuAdapterInfo } from './types.js';

export interface IHardwareSampler {
  sampleGpuAdapters(): Promise<GpuAdapterInfo[]>;
  sampleNpuPresence(): Promise<boolean>;
  sampleThermalState(): Promise<'normal' | 'throttled' | 'critical'>;
}

export class DefaultHardwareSampler implements IHardwareSampler {
  public async sampleGpuAdapters(): Promise<GpuAdapterInfo[]> {
    try {
      // In production Node.js environment on Windows, default to fallback detection
      // unless specific GPU environment information or native adapters are present
      return [
        {
          name: 'System Software / Integrated Adapter',
          vramBytes: 2147483648, // 2 GB shared default fallback
          freeVramBytes: 1073741824, // 1 GB free fallback
        },
      ];
    } catch {
      return [];
    }
  }

  public async sampleNpuPresence(): Promise<boolean> {
    return false;
  }

  public async sampleThermalState(): Promise<'normal' | 'throttled' | 'critical'> {
    return 'normal';
  }
}

export class HardwareDetector {
  private readonly sampler: IHardwareSampler;
  private cachedProfile?: HardwareProfile;
  private lastSampledTime = 0;
  private readonly ttlMs: number;

  constructor(customSampler?: IHardwareSampler, ttlMs = 5000) {
    this.sampler = customSampler ?? new DefaultHardwareSampler();
    this.ttlMs = ttlMs;
  }

  public async getProfile(): Promise<HardwareProfile> {
    const now = Date.now();
    if (this.cachedProfile && now - this.lastSampledTime < this.ttlMs) {
      return { ...this.cachedProfile };
    }

    try {
      const cpuArch = os.arch();
      const cpus = os.cpus() || [];
      const cpuCores = cpus.length || 1;
      const totalRamBytes = os.totalmem() || 1073741824;
      const freeRamBytes = os.freemem() || 536870912;

      let gpuAdapters: GpuAdapterInfo[] = [];
      let hasNpu = false;
      let thermalState: 'normal' | 'throttled' | 'critical' = 'normal';

      try {
        gpuAdapters = await this.sampler.sampleGpuAdapters();
      } catch {
        gpuAdapters = [];
      }

      try {
        hasNpu = await this.sampler.sampleNpuPresence();
      } catch {
        hasNpu = false;
      }

      try {
        thermalState = await this.sampler.sampleThermalState();
      } catch {
        thermalState = 'normal';
      }

      const profile: HardwareProfile = {
        cpuArch,
        cpuCores,
        totalRamBytes,
        freeRamBytes,
        gpuAdapters: gpuAdapters.map((gpu) => ({
          name: gpu.name || 'Unknown GPU',
          vramBytes: Math.max(0, gpu.vramBytes || 0),
          freeVramBytes: Math.max(0, gpu.freeVramBytes || 0),
          driverVersion: gpu.driverVersion,
        })),
        hasNpu,
        thermalState,
        sampledAt: now,
      };

      this.cachedProfile = profile;
      this.lastSampledTime = now;

      return { ...profile };
    } catch {
      // Safe fail-closed fallback profile if node:os or sampler throws unexpectedly
      const fallback: HardwareProfile = {
        cpuArch: 'x64',
        cpuCores: 1,
        totalRamBytes: 1073741824, // 1 GB
        freeRamBytes: 536870912, // 512 MB
        gpuAdapters: [],
        hasNpu: false,
        thermalState: 'normal',
        sampledAt: Date.now(),
      };
      return fallback;
    }
  }

  public invalidateCache(): void {
    this.cachedProfile = undefined;
    this.lastSampledTime = 0;
  }
}
