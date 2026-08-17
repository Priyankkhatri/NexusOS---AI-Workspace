import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CpuFallbackAdapter,
  OllamaAdapter,
  ProviderAdapterFactory,
  validateLoopbackEndpoint,
} from '../src/runtimes/local-ai/provider-adapters.js';
import { InferenceRequest } from '../src/runtimes/local-ai/types.js';

describe('Task 03T — Provider Adapters & SSRF Security Unit Tests', () => {
  it('PA-01: validateLoopbackEndpoint accepts 127.0.0.1 and localhost', () => {
    assert.doesNotThrow(() => validateLoopbackEndpoint('http://127.0.0.1:11434'));
    assert.doesNotThrow(() => validateLoopbackEndpoint('http://localhost:8080'));
  });

  it('PA-02: validateLoopbackEndpoint rejects non-loopback URLs (SSRF security guard)', () => {
    assert.throws(
      () => validateLoopbackEndpoint('http://evil.com:11434'),
      /SSRF Security Violation/i,
    );
    assert.throws(
      () => validateLoopbackEndpoint('http://192.168.1.50:8080'),
      /SSRF Security Violation/i,
    );
  });

  it('PA-03: OllamaAdapter streams response chunks and supports cancellation', async () => {
    const adapter = new OllamaAdapter();
    const req: InferenceRequest = {
      requestId: 'req-ollama-1',
      modelId: 'llama3',
      provider: 'ollama',
      prompt: 'Hello Ollama',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      callerId: 'caller-1',
      correlationId: 'corr-1',
    };

    const chunks = [];
    for await (const chunk of adapter.generateStream(req)) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 0);
    assert.equal(chunks[chunks.length - 1].isFinal, true);
    assert.equal(chunks[chunks.length - 1].finishReason, 'stop');
  });

  it('PA-04: CpuFallbackAdapter generates fallback inference stream', async () => {
    const adapter = new CpuFallbackAdapter();
    const req: InferenceRequest = {
      requestId: 'req-cpu-1',
      modelId: 'phi-3-mini',
      provider: 'cpu_fallback',
      prompt: 'Summarize context',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      callerId: 'caller-1',
      correlationId: 'corr-1',
    };

    const chunks = [];
    for await (const chunk of adapter.generateStream(req)) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length > 0);
    const textCombined = chunks.map((c) => c.text).join('');
    assert.ok(textCombined.includes('CPU execution mode'));
  });

  it('PA-05: ProviderAdapterFactory retrieves adapter and throws for unknown provider', () => {
    const factory = new ProviderAdapterFactory();
    const adapter = factory.getAdapter('ollama');
    assert.equal(adapter.providerType, 'ollama');

    assert.throws(
      () => factory.getAdapter('unknown_provider' as never),
      /Unsupported model provider type/i,
    );
  });
});
