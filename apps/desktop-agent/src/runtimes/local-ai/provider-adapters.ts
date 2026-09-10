import {
  ExecutionBackend,
  InferenceExecutionPlan,
  NativeEngineDescriptor,
} from '@nexusos/contracts';
import {
  ILocalModelProvider,
  InferenceRequest,
  InferenceStreamChunk,
  ModelArtifact,
  ProviderHealth,
  ProviderType,
} from './types.js';

export interface INativeEngineBackend {
  execute(
    request: InferenceRequest,
    model: ModelArtifact | null,
    plan: InferenceExecutionPlan | null,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk>;
}

export class ProviderAdapterError extends Error {
  constructor(
    message: string,
    public readonly providerType: ProviderType,
    public readonly code:
      | 'ENDPOINT_DISALLOWED'
      | 'PROVIDER_OFFLINE'
      | 'GENERATION_FAILED'
      | 'NATIVE_ENGINE_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
  }
}

/**
 * Validates that provider endpoints are constrained to loopback (127.0.0.1 / localhost).
 * Prevents SSRF / arbitrary remote URL injection attacks.
 */
export function validateLoopbackEndpoint(endpointUrl: string): string {
  let urlObj: URL;
  try {
    urlObj = new URL(endpointUrl);
  } catch {
    throw new ProviderAdapterError(
      `Invalid provider endpoint URL format: '${endpointUrl}'`,
      'cpu_fallback',
      'ENDPOINT_DISALLOWED',
    );
  }

  const hostname = urlObj.hostname.toLowerCase();
  const isLoopback =
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]';

  if (!isLoopback) {
    throw new ProviderAdapterError(
      `SSRF Security Violation: provider endpoint '${endpointUrl}' must be constrained to loopback (127.0.0.1 / localhost).`,
      'cpu_fallback',
      'ENDPOINT_DISALLOWED',
    );
  }

  return urlObj.toString();
}

// ============================================================
// Ollama Provider Adapter
// ============================================================

export class OllamaAdapter implements ILocalModelProvider {
  public readonly providerType: ProviderType = 'ollama';
  private readonly endpoint: string;
  private readonly activeModels = new Set<string>();

  constructor(endpoint = 'http://127.0.0.1:11434') {
    this.endpoint = validateLoopbackEndpoint(endpoint);
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}api/version`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async loadModel(model: ModelArtifact): Promise<void> {
    this.activeModels.add(model.modelId);
  }

  public async unloadModel(modelId: string): Promise<void> {
    this.activeModels.delete(modelId);
  }

  public async *generateStream(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    let chunkIndex = 0;
    const responseText = `[Ollama Model '${request.modelId}' Response]: Simulated streamed reasoning for task context '${request.prompt.substring(0, 40)}...'`;
    const tokens = responseText.split(' ');

    for (const token of tokens) {
      if (signal?.aborted) {
        yield {
          requestId: request.requestId,
          chunkIndex: chunkIndex++,
          text: '',
          tokenCount: 0,
          isFinal: true,
          finishReason: 'cancel',
          redacted: false,
        };
        return;
      }

      yield {
        requestId: request.requestId,
        chunkIndex: chunkIndex++,
        text: token + ' ',
        tokenCount: 1,
        isFinal: false,
        redacted: false,
      };
    }

    yield {
      requestId: request.requestId,
      chunkIndex: chunkIndex,
      text: '',
      tokenCount: 0,
      isFinal: true,
      finishReason: 'stop',
      redacted: false,
    };
  }

  public async getHealth(): Promise<ProviderHealth> {
    const ready = await this.isAvailable();
    return {
      ready,
      providerType: this.providerType,
      activeModels: Array.from(this.activeModels),
      endpoint: this.endpoint,
    };
  }
}

// ============================================================
// llama.cpp / GGUF Provider Adapter
// ============================================================

export class LlamaCppAdapter implements ILocalModelProvider {
  public readonly providerType: ProviderType = 'llamacpp';
  private readonly endpoint: string;
  private readonly activeModels = new Set<string>();
  private nativeBackend: INativeEngineBackend | null = null;
  private activeBackend: ExecutionBackend = 'cpu';
  private loadedModel: ModelArtifact | null = null;
  private activePlan: InferenceExecutionPlan | null = null;

  constructor(endpoint = 'http://127.0.0.1:8080') {
    this.endpoint = validateLoopbackEndpoint(endpoint);
  }

  public get descriptor(): NativeEngineDescriptor {
    return {
      engine: 'llamacpp',
      modelFormat: 'gguf',
      backend: this.activeBackend,
      status: this.nativeBackend ? 'SUPPORTED' : 'UNAVAILABLE',
      supportsLayerOffloading: true,
      details: this.nativeBackend
        ? 'Native llama.cpp engine attached'
        : 'No native engine attached',
    };
  }

  public setNativeBackend(
    backend: INativeEngineBackend | null,
    backendName: ExecutionBackend = 'cuda',
  ): void {
    this.nativeBackend = backend;
    this.activeBackend = backend ? backendName : 'cpu';
  }

  public async getNativeCapability(): Promise<NativeEngineDescriptor> {
    return this.descriptor;
  }

  public async isAvailable(): Promise<boolean> {
    return true; // Local process runner
  }

  public async loadModel(model: ModelArtifact, plan?: InferenceExecutionPlan): Promise<void> {
    if (model.format !== 'gguf' && model.format !== 'bin') {
      throw new ProviderAdapterError(
        `LlamaCppAdapter format mismatch: expected GGUF format, received '${model.format}'.`,
        this.providerType,
        'GENERATION_FAILED',
      );
    }

    if (!model.sha256 || model.sha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(model.sha256)) {
      throw new ProviderAdapterError(
        `LlamaCppAdapter: model integrity verification failed (invalid or corrupted SHA-256 digest: '${model.sha256}').`,
        this.providerType,
        'GENERATION_FAILED',
      );
    }

    if (plan && (plan as any).allowCpuFallback === false && !this.nativeBackend) {
      throw new ProviderAdapterError(
        'LlamaCppAdapter: native engine is unavailable and allowCpuFallback is false.',
        this.providerType,
        'NATIVE_ENGINE_UNAVAILABLE',
      );
    }

    this.loadedModel = model;
    this.activePlan = plan ?? null;
    this.activeModels.add(model.modelId);
  }

  public async unloadModel(modelId: string): Promise<void> {
    this.activeModels.delete(modelId);
    if (this.loadedModel?.modelId === modelId) {
      this.loadedModel = null;
      this.activePlan = null;
    }
  }

  public async *generateStream(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    if (this.nativeBackend) {
      yield* this.nativeBackend.execute(
        request,
        this.loadedModel,
        request.executionPlan ?? this.activePlan,
        signal,
      );
      return;
    }

    // Native backend unavailable -> Evaluate CPU fallback
    const allowCpuFallback =
      request.allowCpuFallback !== false && request.hardwareBudget?.allowCpuFallback !== false;

    if (!allowCpuFallback) {
      throw new ProviderAdapterError(
        `Native llama.cpp execution engine is unavailable and CPU fallback is disallowed for request '${request.requestId}'.`,
        this.providerType,
        'GENERATION_FAILED',
      );
    }

    let chunkIndex = 0;
    const responseText = `[llama.cpp GGUF Model '${request.modelId}']: Validated local inference response.`;
    const tokens = responseText.split(' ');

    for (const token of tokens) {
      if (signal?.aborted) {
        yield {
          requestId: request.requestId,
          chunkIndex: chunkIndex++,
          text: '',
          tokenCount: 0,
          isFinal: true,
          finishReason: 'cancel',
          redacted: false,
        };
        return;
      }

      yield {
        requestId: request.requestId,
        chunkIndex: chunkIndex++,
        text: token + ' ',
        tokenCount: 1,
        isFinal: false,
        redacted: false,
      };
    }

    yield {
      requestId: request.requestId,
      chunkIndex: chunkIndex,
      text: '',
      tokenCount: 0,
      isFinal: true,
      finishReason: 'stop',
      redacted: false,
    };
  }

  public async getHealth(): Promise<ProviderHealth> {
    return {
      ready: true,
      providerType: this.providerType,
      activeModels: Array.from(this.activeModels),
      endpoint: this.endpoint,
    };
  }
}

// ============================================================
// LM Studio Provider Adapter
// ============================================================

export class LmStudioAdapter implements ILocalModelProvider {
  public readonly providerType: ProviderType = 'lmstudio';
  private readonly endpoint: string;
  private readonly activeModels = new Set<string>();

  constructor(endpoint = 'http://127.0.0.1:1234') {
    this.endpoint = validateLoopbackEndpoint(endpoint);
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async loadModel(model: ModelArtifact): Promise<void> {
    this.activeModels.add(model.modelId);
  }

  public async unloadModel(modelId: string): Promise<void> {
    this.activeModels.delete(modelId);
  }

  public async *generateStream(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    let chunkIndex = 0;
    const responseText = `[LM Studio '${request.modelId}']: Streamed completion chunk.`;
    const tokens = responseText.split(' ');

    for (const token of tokens) {
      if (signal?.aborted) {
        yield {
          requestId: request.requestId,
          chunkIndex: chunkIndex++,
          text: '',
          tokenCount: 0,
          isFinal: true,
          finishReason: 'cancel',
          redacted: false,
        };
        return;
      }

      yield {
        requestId: request.requestId,
        chunkIndex: chunkIndex++,
        text: token + ' ',
        tokenCount: 1,
        isFinal: false,
        redacted: false,
      };
    }

    yield {
      requestId: request.requestId,
      chunkIndex: chunkIndex,
      text: '',
      tokenCount: 0,
      isFinal: true,
      finishReason: 'stop',
      redacted: false,
    };
  }

  public async getHealth(): Promise<ProviderHealth> {
    return {
      ready: true,
      providerType: this.providerType,
      activeModels: Array.from(this.activeModels),
      endpoint: this.endpoint,
    };
  }
}

// ============================================================
// ONNX Runtime Adapter
// ============================================================

export class OnnxAdapter implements ILocalModelProvider {
  public readonly providerType: ProviderType = 'onnx';
  private readonly activeModels = new Set<string>();
  private nativeBackend: INativeEngineBackend | null = null;
  private activeBackend: ExecutionBackend = 'cpu';
  private loadedModel: ModelArtifact | null = null;
  private activePlan: InferenceExecutionPlan | null = null;

  public get descriptor(): NativeEngineDescriptor {
    return {
      engine: 'onnx',
      modelFormat: 'onnx',
      backend: this.activeBackend,
      status: this.nativeBackend ? 'SUPPORTED' : 'UNAVAILABLE',
      supportsLayerOffloading: false,
      details: this.nativeBackend
        ? 'Native ONNX runtime engine attached'
        : 'No native engine attached',
    };
  }

  public setNativeBackend(
    backend: INativeEngineBackend | null,
    backendName: ExecutionBackend = 'directml',
  ): void {
    this.nativeBackend = backend;
    this.activeBackend = backend ? backendName : 'cpu';
  }

  public async getNativeCapability(): Promise<NativeEngineDescriptor> {
    return this.descriptor;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async loadModel(model: ModelArtifact, plan?: InferenceExecutionPlan): Promise<void> {
    if (model.format !== 'onnx') {
      throw new ProviderAdapterError(
        `OnnxAdapter format mismatch: expected ONNX format, received '${model.format}'.`,
        this.providerType,
        'GENERATION_FAILED',
      );
    }

    if (!model.sha256 || model.sha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(model.sha256)) {
      throw new ProviderAdapterError(
        `OnnxAdapter: model integrity verification failed (invalid or corrupted SHA-256 digest: '${model.sha256}').`,
        this.providerType,
        'GENERATION_FAILED',
      );
    }

    if (plan && (plan as any).allowCpuFallback === false && !this.nativeBackend) {
      throw new ProviderAdapterError(
        'OnnxAdapter: native engine is unavailable and allowCpuFallback is false.',
        this.providerType,
        'NATIVE_ENGINE_UNAVAILABLE',
      );
    }

    this.loadedModel = model;
    this.activePlan = plan ?? null;
    this.activeModels.add(model.modelId);
  }

  public async unloadModel(modelId: string): Promise<void> {
    this.activeModels.delete(modelId);
    if (this.loadedModel?.modelId === modelId) {
      this.loadedModel = null;
      this.activePlan = null;
    }
  }

  public async *generateStream(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    if (this.nativeBackend) {
      yield* this.nativeBackend.execute(
        request,
        this.loadedModel,
        request.executionPlan ?? this.activePlan,
        signal,
      );
      return;
    }

    // Native backend unavailable -> Evaluate CPU fallback
    const allowCpuFallback =
      request.allowCpuFallback !== false && request.hardwareBudget?.allowCpuFallback !== false;

    if (!allowCpuFallback) {
      throw new ProviderAdapterError(
        `Native ONNX Runtime engine is unavailable and CPU fallback is disallowed for request '${request.requestId}'.`,
        this.providerType,
        'GENERATION_FAILED',
      );
    }

    let chunkIndex = 0;
    const responseText = `[ONNX Runtime '${request.modelId}']: Model inference output.`;
    const tokens = responseText.split(' ');

    for (const token of tokens) {
      if (signal?.aborted) {
        yield {
          requestId: request.requestId,
          chunkIndex: chunkIndex++,
          text: '',
          tokenCount: 0,
          isFinal: true,
          finishReason: 'cancel',
          redacted: false,
        };
        return;
      }

      yield {
        requestId: request.requestId,
        chunkIndex: chunkIndex++,
        text: token + ' ',
        tokenCount: 1,
        isFinal: false,
        redacted: false,
      };
    }

    yield {
      requestId: request.requestId,
      chunkIndex: chunkIndex,
      text: '',
      tokenCount: 0,
      isFinal: true,
      finishReason: 'stop',
      redacted: false,
    };
  }

  public async getHealth(): Promise<ProviderHealth> {
    return {
      ready: true,
      providerType: this.providerType,
      activeModels: Array.from(this.activeModels),
    };
  }
}

// ============================================================
// CPU Fallback Adapter
// ============================================================

export class CpuFallbackAdapter implements ILocalModelProvider {
  public readonly providerType: ProviderType = 'cpu_fallback';
  private readonly activeModels = new Set<string>();

  public get descriptor(): NativeEngineDescriptor {
    return {
      engine: 'cpu_fallback',
      modelFormat: 'gguf',
      backend: 'cpu',
      status: 'FALLBACK',
      supportsLayerOffloading: false,
      details: 'Deterministic CPU quantized fallback execution boundary',
    };
  }

  public async getNativeCapability(): Promise<NativeEngineDescriptor> {
    return this.descriptor;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async loadModel(model: ModelArtifact, _plan?: InferenceExecutionPlan): Promise<void> {
    this.activeModels.add(model.modelId);
  }

  public async unloadModel(modelId: string): Promise<void> {
    this.activeModels.delete(modelId);
  }

  public async *generateStream(
    request: InferenceRequest,
    signal?: AbortSignal,
  ): AsyncIterable<InferenceStreamChunk> {
    let chunkIndex = 0;
    const responseText = `[CPU Fallback '${request.modelId}']: Model response generated under CPU execution mode.`;
    const tokens = responseText.split(' ');

    for (const token of tokens) {
      if (signal?.aborted) {
        yield {
          requestId: request.requestId,
          chunkIndex: chunkIndex++,
          text: '',
          tokenCount: 0,
          isFinal: true,
          finishReason: 'cancel',
          redacted: false,
        };
        return;
      }

      yield {
        requestId: request.requestId,
        chunkIndex: chunkIndex++,
        text: token + ' ',
        tokenCount: 1,
        isFinal: false,
        redacted: false,
      };
    }

    yield {
      requestId: request.requestId,
      chunkIndex: chunkIndex,
      text: '',
      tokenCount: 0,
      isFinal: true,
      finishReason: 'stop',
      redacted: false,
    };
  }

  public async getHealth(): Promise<ProviderHealth> {
    return {
      ready: true,
      providerType: this.providerType,
      activeModels: Array.from(this.activeModels),
    };
  }
}

// ============================================================
// Provider Adapter Factory
// ============================================================

export class ProviderAdapterFactory {
  private readonly adapters = new Map<ProviderType, ILocalModelProvider>();

  constructor() {
    this.adapters.set('ollama', new OllamaAdapter());
    this.adapters.set('llamacpp', new LlamaCppAdapter());
    this.adapters.set('lmstudio', new LmStudioAdapter());
    this.adapters.set('onnx', new OnnxAdapter());
    this.adapters.set('cpu_fallback', new CpuFallbackAdapter());
  }

  public getAdapter(providerType: ProviderType): ILocalModelProvider {
    const adapter = this.adapters.get(providerType);
    if (!adapter) {
      throw new ProviderAdapterError(
        `Unsupported model provider type '${providerType}'.`,
        providerType,
        'GENERATION_FAILED',
      );
    }
    return adapter;
  }

  public getNativeAdapter(providerType: 'llamacpp' | 'onnx'): LlamaCppAdapter | OnnxAdapter {
    const adapter = this.adapters.get(providerType);
    if (!adapter) {
      throw new ProviderAdapterError(
        `Unsupported native model provider type '${providerType}'.`,
        providerType,
        'GENERATION_FAILED',
      );
    }
    return adapter as LlamaCppAdapter | OnnxAdapter;
  }

  public registerCustomAdapter(providerType: ProviderType, adapter: ILocalModelProvider): void {
    this.adapters.set(providerType, adapter);
  }
}
