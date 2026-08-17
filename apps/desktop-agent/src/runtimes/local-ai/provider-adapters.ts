import {
  ILocalModelProvider,
  InferenceRequest,
  InferenceStreamChunk,
  ModelArtifact,
  ProviderHealth,
  ProviderType,
} from './types.js';

export class ProviderAdapterError extends Error {
  constructor(
    message: string,
    public readonly providerType: ProviderType,
    public readonly code: 'ENDPOINT_DISALLOWED' | 'PROVIDER_OFFLINE' | 'GENERATION_FAILED',
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

  constructor(endpoint = 'http://127.0.0.1:8080') {
    this.endpoint = validateLoopbackEndpoint(endpoint);
  }

  public async isAvailable(): Promise<boolean> {
    return true; // Local process runner
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

  public registerCustomAdapter(providerType: ProviderType, adapter: ILocalModelProvider): void {
    this.adapters.set(providerType, adapter);
  }
}
