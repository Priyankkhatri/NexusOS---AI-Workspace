import { InferenceBenchmarkResult } from '@nexusos/contracts';
import {
  ModelArtifact,
  HardwareProfile,
  ProviderAdapterFactory,
  HardwareDetector,
  ExecutionLeaseBoundary,
  ModelCacheManager,
  ModelRuntimeManager,
} from '@nexusos/desktop-agent';

export interface BenchmarkOptions {
  modelId?: string;
  quantization?: string | null;
  prompt?: string;
  maxTokens?: number;
  warmup?: number;
  iterations?: number;
  baseDir?: string;
  allowCpuFallback?: boolean;
  runtimeManager?: ModelRuntimeManager | null;
  modelCacheManager?: ModelCacheManager | null;
  leaseBoundary?: ExecutionLeaseBoundary | null;
  adapterFactory?: ProviderAdapterFactory | null;
  hardwareDetector?: HardwareDetector | null;
  customModelArtifact?: Partial<ModelArtifact> | null;
  tenantId?: string;
  deviceId?: string;
}

export interface BenchmarkRunResult {
  success: boolean;
  status: string;
  message?: string;
  result?: InferenceBenchmarkResult;
  samples?: any[];
  aggregates?: {
    ttft: { mean: number; median: number; min: number; max: number };
    tokensPerSecond: { mean: number; median: number; min: number; max: number };
    durationMs: { mean: number; median: number; min: number; max: number };
    completionTokens: { mean: number; median: number; min: number; max: number };
  };
  executionMode?: 'NATIVE_GPU' | 'CPU_FALLBACK';
  hardwareProfile?: Partial<HardwareProfile> & {
    deviceModel: string;
    gpuName: string;
    totalVramBytes: number;
    totalRamBytes: number;
    cpuCores: number;
    cpuArch: string;
  };
}

export function runBenchmark(options?: BenchmarkOptions): Promise<BenchmarkRunResult>;
