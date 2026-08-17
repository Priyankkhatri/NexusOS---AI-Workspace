import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { HardwareDetector } from './hardware-detector.js';
import { ModelCacheManager } from './model-cache-manager.js';
import { ProviderAdapterFactory } from './provider-adapters.js';
import { ResourceGovernor } from './resource-governor.js';
import {
  HardwareProfile,
  InferenceRequest,
  InferenceRequestSchema,
  InferenceState,
  InferenceStreamChunk,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_TOKENS,
  ModelLifecycleState,
} from './types.js';

export class ModelRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_TRANSITION'
      | 'LEASE_DENIED'
      | 'ADMISSION_DENIED'
      | 'MODEL_NOT_FOUND'
      | 'INFERENCE_FAILED'
      | 'ALREADY_SHUTDOWN',
  ) {
    super(message);
    this.name = 'ModelRuntimeError';
  }
}

export class ModelRuntimeManager {
  private readonly hardwareDetector: HardwareDetector;
  private readonly resourceGovernor: ResourceGovernor;
  private readonly modelCacheManager: ModelCacheManager;
  private readonly adapterFactory: ProviderAdapterFactory;
  private isShutdown = false;

  private readonly loadedModelStates = new Map<string, ModelLifecycleState>();
  private readonly activeInferenceStates = new Map<string, InferenceState>();

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    baseDir: string,
    customHardwareDetector?: HardwareDetector,
    customResourceGovernor?: ResourceGovernor,
    customCacheManager?: ModelCacheManager,
    customAdapterFactory?: ProviderAdapterFactory,
  ) {
    this.hardwareDetector = customHardwareDetector ?? new HardwareDetector();
    this.resourceGovernor = customResourceGovernor ?? new ResourceGovernor();
    this.modelCacheManager = customCacheManager ?? new ModelCacheManager(baseDir);
    this.adapterFactory = customAdapterFactory ?? new ProviderAdapterFactory();
  }

  public async initialize(): Promise<void> {
    if (this.isShutdown) {
      throw new ModelRuntimeError('Cannot initialize a shutdown ModelRuntimeManager.', 'ALREADY_SHUTDOWN');
    }
    await this.modelCacheManager.initialize();
  }

  /**
   * Validates state transitions for model lifecycle.
   */
  public transitionModelState(modelId: string, targetState: ModelLifecycleState): void {
    const currentState = this.loadedModelStates.get(modelId) || 'Inactive';

    // Terminal/Quarantined protection
    if (currentState === 'Quarantined' && targetState !== 'Deleted') {
      throw new ModelRuntimeError(
        `Invalid model lifecycle transition: model '${modelId}' is Quarantined and cannot transition to '${targetState}'.`,
        'INVALID_TRANSITION',
      );
    }

    this.loadedModelStates.set(modelId, targetState);
  }

  /**
   * Executes a local model inference request with streaming tokens.
   */
  public async *executeInference(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    if (this.isShutdown) {
      throw new ModelRuntimeError(
        'Cannot execute inference: ModelRuntimeManager is shutdown.',
        'ALREADY_SHUTDOWN',
      );
    }

    // 1. Validate request schema
    const validatedRequest = InferenceRequestSchema.parse(request) as InferenceRequest;

    this.activeInferenceStates.set(validatedRequest.requestId, 'Admitting');

    // 2. Re-validate execution lease authority immediately before model dispatch
    if (validatedRequest.leaseHeader) {
      try {
        const isLeaseValid = this.leaseBoundary.validateLease(validatedRequest.leaseHeader as never);
        if (!isLeaseValid) {
          this.activeInferenceStates.set(validatedRequest.requestId, 'Denied');
          throw new ModelRuntimeError(
            `Lease re-validation failed for request '${validatedRequest.requestId}'. Model dispatch rejected.`,
            'LEASE_DENIED',
          );
        }
      } catch (err) {
        this.activeInferenceStates.set(validatedRequest.requestId, 'Denied');
        throw new ModelRuntimeError(
          `Lease re-validation error: ${err instanceof Error ? err.message : String(err)}`,
          'LEASE_DENIED',
        );
      }
    }

    // 3. Obtain Hardware Profile & reserve capacity in ResourceGovernor
    let hardware: HardwareProfile;
    try {
      hardware = await this.hardwareDetector.getProfile();
    } catch {
      this.activeInferenceStates.set(validatedRequest.requestId, 'Denied');
      throw new ModelRuntimeError(
        `Hardware detection failed for request '${validatedRequest.requestId}'.`,
        'ADMISSION_DENIED',
      );
    }

    const cachedModel = this.modelCacheManager.getModel(validatedRequest.modelId);
    let reservation;
    try {
      reservation = await this.resourceGovernor.reserve(validatedRequest, hardware, cachedModel);
    } catch (err) {
      this.activeInferenceStates.set(validatedRequest.requestId, 'Denied');
      throw new ModelRuntimeError(
        `Resource reservation failed: ${err instanceof Error ? err.message : String(err)}`,
        'ADMISSION_DENIED',
      );
    }

    // 4. Dispatch to provider adapter
    this.activeInferenceStates.set(validatedRequest.requestId, 'LoadingModel');
    const adapter = this.adapterFactory.getAdapter(validatedRequest.provider);

    if (cachedModel) {
      this.modelCacheManager.markModelActive(cachedModel.modelId);
      this.transitionModelState(cachedModel.modelId, 'Ready');
      await adapter.loadModel(cachedModel);
    }

    this.activeInferenceStates.set(validatedRequest.requestId, 'Generating');

    let totalTokens = 0;
    let totalBytes = 0;

    try {
      for await (const chunk of adapter.generateStream(validatedRequest, signal)) {
        if (signal?.aborted) {
          this.activeInferenceStates.set(validatedRequest.requestId, 'Canceled');
          yield {
            ...chunk,
            isFinal: true,
            finishReason: 'cancel',
          };
          return;
        }

        totalTokens += chunk.tokenCount;
        totalBytes += Buffer.byteLength(chunk.text, 'utf8');

        // Enforce hard maximum token and byte limits
        if (totalTokens >= MAX_OUTPUT_TOKENS || totalBytes >= MAX_OUTPUT_BYTES) {
          yield {
            requestId: validatedRequest.requestId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            tokenCount: chunk.tokenCount,
            isFinal: true,
            finishReason: 'length',
            redacted: chunk.redacted,
          };
          this.activeInferenceStates.set(validatedRequest.requestId, 'Completed');
          return;
        }

        yield chunk;

        if (chunk.isFinal) {
          this.activeInferenceStates.set(validatedRequest.requestId, 'Completed');
          return;
        }
      }
    } catch (err) {
      this.activeInferenceStates.set(validatedRequest.requestId, 'Failed');
      throw new ModelRuntimeError(
        `Model generation error: ${err instanceof Error ? err.message : String(err)}`,
        'INFERENCE_FAILED',
      );
    } finally {
      // Transactional cleanup: release reservation & mark model inactive
      this.resourceGovernor.release(reservation);
      if (cachedModel) {
        this.modelCacheManager.markModelInactive(cachedModel.modelId);
      }
    }
  }

  public async unloadModel(modelId: string): Promise<void> {
    const cached = this.modelCacheManager.getModel(modelId);
    if (cached) {
      const adapter = this.adapterFactory.getAdapter(cached.provider);
      await adapter.unloadModel(modelId);
      this.transitionModelState(modelId, 'Inactive');
    }
  }

  public async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return; // Idempotent shutdown
    }
    this.isShutdown = true;

    // Unload all active models & reset resource governor
    for (const [modelId] of this.loadedModelStates.entries()) {
      try {
        await this.unloadModel(modelId);
      } catch {}
    }

    this.resourceGovernor.reset();
    this.loadedModelStates.clear();
    this.activeInferenceStates.clear();
  }

  public getModelState(modelId: string): ModelLifecycleState {
    return this.loadedModelStates.get(modelId) || 'Inactive';
  }

  public getInferenceState(requestId: string): InferenceState | undefined {
    return this.activeInferenceStates.get(requestId);
  }
}
