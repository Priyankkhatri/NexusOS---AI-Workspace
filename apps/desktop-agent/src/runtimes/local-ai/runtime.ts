import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { RuntimeCategory, ToolRuntimeDescriptor } from '../../registry/runtime-registry.js';
import { AgentLogger } from '../../observability/agent-logger.js';
import { ModelRuntimeManager } from './model-runtime-manager.js';
import {
  HardwareProfile,
  InferenceRequest,
  InferenceState,
  InferenceStreamChunk,
  ModelArtifact,
  ModelLifecycleState,
} from './types.js';

export enum LocalAiOperationName {
  GENERATE = 'generate',
  LIST_MODELS = 'list_models',
  GET_HARDWARE_PROFILE = 'get_hardware_profile',
  UNLOAD_MODEL = 'unload_model',
}

export class LocalAiRuntime {
  public static readonly RUNTIME_ID = 'rt:local-ai-v1';

  public readonly modelRuntimeManager: ModelRuntimeManager;

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    modelRuntimeManager?: ModelRuntimeManager,
    baseDir = '.nexus-local-ai',
    private readonly logger?: AgentLogger,
  ) {
    this.modelRuntimeManager =
      modelRuntimeManager ?? new ModelRuntimeManager(this.leaseBoundary, baseDir);
  }

  public getDescriptor(): ToolRuntimeDescriptor {
    return Object.freeze({
      runtimeId: LocalAiRuntime.RUNTIME_ID,
      category: RuntimeCategory.LOCAL_AI,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: [
        LocalAiOperationName.GENERATE,
        LocalAiOperationName.LIST_MODELS,
        LocalAiOperationName.GET_HARDWARE_PROFILE,
        LocalAiOperationName.UNLOAD_MODEL,
      ],
    });
  }

  public async initialize(): Promise<void> {
    await this.modelRuntimeManager.initialize();
  }

  public async shutdown(): Promise<void> {
    this.logger?.info('Shutting down Local AI Runtime and releasing all allocations');
    await this.modelRuntimeManager.shutdown();
  }

  public executeInference(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    return this.modelRuntimeManager.executeInference(request, signal);
  }

  public listModels(): ModelArtifact[] {
    return this.modelRuntimeManager.modelCacheManager.listCatalog();
  }

  public async getHardwareProfile(): Promise<HardwareProfile> {
    return this.modelRuntimeManager.hardwareDetector.getProfile();
  }

  public async unloadModel(modelId: string): Promise<void> {
    await this.modelRuntimeManager.unloadModel(modelId);
  }

  public getModelState(modelId: string): ModelLifecycleState {
    return this.modelRuntimeManager.getModelState(modelId);
  }

  public getInferenceState(requestId: string): InferenceState | undefined {
    return this.modelRuntimeManager.getInferenceState(requestId);
  }
}
