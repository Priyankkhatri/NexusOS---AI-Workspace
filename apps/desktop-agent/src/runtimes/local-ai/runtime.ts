import crypto from 'node:crypto';
import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { RuntimeCategory, ToolRuntimeDescriptor } from '../../registry/runtime-registry.js';
import { AgentLogger } from '../../observability/agent-logger.js';
import { ModelRuntimeManager } from './model-runtime-manager.js';
import {
  HardwareProfile,
  InferenceRequest,
  InferenceState,
  InferenceStreamChunk,
  LocalAiExecutionRequest,
  LocalAiExecutionResult,
  ModelArtifact,
  ModelLifecycleState,
} from './types.js';
import {
  computeModelEvidenceChecksum,
  LocalAiOperation,
  resolveLocalAiOperation,
} from '@nexusos/contracts';

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

  /**
   * Canonical orchestrator tool execution boundary for RuntimeCategory.LOCAL_AI
   */
  public async execute(rawRequest: LocalAiExecutionRequest): Promise<LocalAiExecutionResult> {
    try {
      const rawAction =
        rawRequest.operation ||
        rawRequest.action ||
        (rawRequest as any).capabilityId?.split('.')[1] ||
        (rawRequest.prompt ? 'generate' : 'list_models');

      const operation = resolveLocalAiOperation(rawAction);
      if (!operation) {
        return {
          success: false,
          error: `UNSUPPORTED_LOCAL_AI_OPERATION: Unsupported local AI operation '${rawAction}'`,
          metadata: { errorCode: 'UNSUPPORTED_LOCAL_AI_OPERATION' },
        };
      }

      switch (operation) {
        case LocalAiOperation.LIST_MODELS: {
          const models = this.listModels();
          return {
            success: true,
            output: models,
            metadata: { count: models.length },
          };
        }

        case LocalAiOperation.GET_HARDWARE_PROFILE: {
          const profile = await this.getHardwareProfile();
          return {
            success: true,
            output: profile,
          };
        }

        case LocalAiOperation.UNLOAD_MODEL: {
          if (!rawRequest.modelId) {
            return {
              success: false,
              error: 'MODEL_ID_REQUIRED: unload_model operation requires modelId',
              metadata: { errorCode: 'MODEL_ID_REQUIRED' },
            };
          }
          await this.unloadModel(rawRequest.modelId);
          return {
            success: true,
            output: { unloaded: true, modelId: rawRequest.modelId },
          };
        }

        case LocalAiOperation.GENERATE:
        default: {
          if (!rawRequest.modelId) {
            return {
              success: false,
              error: 'MODEL_ID_REQUIRED: generate operation requires modelId',
              metadata: { errorCode: 'MODEL_ID_REQUIRED' },
            };
          }
          if (typeof rawRequest.prompt !== 'string') {
            return {
              success: false,
              error: 'PROMPT_REQUIRED: generate operation requires prompt string',
              metadata: { errorCode: 'PROMPT_REQUIRED' },
            };
          }

          const leaseId =
            rawRequest.leaseId ||
            (rawRequest as any).leaseHeader?.lease_id ||
            (rawRequest as any).leaseHeader?.id ||
            '';
          const tenantId =
            rawRequest.tenantId ||
            (rawRequest as any).leaseHeader?.tenant_id ||
            (rawRequest as any).leaseHeader?.tenantId ||
            '';
          const taskId = rawRequest.taskId || (rawRequest as any).task_id || '';

          const inferenceReq: InferenceRequest = {
            requestId: (rawRequest as any).requestId || crypto.randomUUID(),
            taskId,
            tenantId,
            leaseId,
            workspaceId: rawRequest.workspaceId,
            modelId: rawRequest.modelId,
            provider: (rawRequest as any).provider || 'ollama',
            deviceId:
              (rawRequest as any).deviceId ||
              (rawRequest as any).leaseHeader?.agent_id ||
              'dev-local',
            callerId:
              (rawRequest as any).callerId ||
              (rawRequest as any).leaseHeader?.agent_id ||
              'caller-agent',
            correlationId: (rawRequest as any).correlationId || crypto.randomUUID(),
            prompt: rawRequest.prompt,
            systemPrompt: rawRequest.systemPrompt,
            contextDocuments: rawRequest.contextDocuments,
            allowCpuFallback: rawRequest.allowCpuFallback,
            maxTokens: rawRequest.maxTokens,
            temperature: rawRequest.temperature,
            hardwareBudget: rawRequest.hardwareBudget,
            isolationPolicy: rawRequest.isolationPolicy,
            leaseHeader: (rawRequest as any).leaseHeader,
          };

          const signal = (rawRequest as any).signal as AbortSignal | undefined;
          const directResult = await this.modelRuntimeManager.executeInferenceDirect(
            inferenceReq,
            signal,
          );

          const outputText = directResult.content;
          const effectiveProvider = directResult.effectiveProvider;
          const cpuFallback = directResult.hardwareProfileUsed.cpuFallback;
          const fallbackReason = directResult.hardwareProfileUsed.fallbackReason;

          const checksum = computeModelEvidenceChecksum({
            taskId,
            leaseId,
            modelId: inferenceReq.modelId,
            provider: effectiveProvider,
            prompt: rawRequest.prompt,
            output: outputText,
            cpuFallback,
          });

          return {
            success: true,
            output: outputText,
            evidence: {
              checksum,
              modelId: inferenceReq.modelId,
              provider: effectiveProvider,
              cpuFallback,
              fallbackReason,
              tokensGenerated: directResult.completionTokens,
              finishReason: directResult.finishReason,
              taskId,
              leaseId,
              tenantId,
            },
            metadata: {
              cpuFallback,
              fallbackReason,
              provider: effectiveProvider,
              modelId: inferenceReq.modelId,
              finishReason: directResult.finishReason,
            },
          };
        }
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err?.code || 'LOCAL_AI_EXECUTION_FAILED';
      return {
        success: false,
        error: message,
        metadata: { errorCode: code },
      };
    }
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
