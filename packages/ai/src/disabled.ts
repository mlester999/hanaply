/**
 * The disabled provider.
 *
 * `createAiProvider` returns this when no model is configured, and it is also
 * the shape every caller checks for before choosing the deterministic path. It
 * fails loudly and by name: nothing it returns can be mistaken for generated
 * output, and it carries the reason, so a degraded deployment is visible in a
 * status endpoint rather than silently producing text nobody attributed.
 */

import type {
  AiProvider,
  AiProviderCapabilities,
  AiProviderErrorCode,
  AiProviderHealth,
  AiProviderKind,
  AiStructuredGenerateRequest,
  AiStructuredGenerateResult,
  AiTaskRequest,
  AiTaskResult,
} from './types.js';
import { AiProviderError } from './types.js';

export const noCapabilities: AiProviderCapabilities = Object.freeze({
  structuredOutput: false,
  jsonSchema: false,
  streaming: false,
  toolCalls: false,
  vision: false,
});

interface DisabledOptions {
  readonly kind?: AiProviderKind;
  readonly reason: string;
  /** True when a provider was selected but could not be constructed. */
  readonly degraded?: boolean;
}

export class DisabledAiProvider implements AiProvider {
  readonly kind: AiProviderKind;
  readonly capabilities: AiProviderCapabilities = noCapabilities;
  readonly model: string | null = null;
  readonly reason: string;
  readonly degraded: boolean;

  constructor(options: DisabledOptions | string) {
    const resolved: DisabledOptions = typeof options === 'string' ? { reason: options } : options;
    this.kind = resolved.kind ?? 'disabled';
    this.reason = resolved.reason;
    this.degraded = resolved.degraded ?? false;
  }

  /**
   * Rejects rather than resolving, because a resolved empty value cannot be told
   * apart from a model that chose to say nothing.
   */
  structuredGenerate<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
  ): Promise<AiStructuredGenerateResult<TOutput>> {
    return Promise.reject(this.error('not_configured', request.requestId));
  }

  analyzeOpportunity(request: AiTaskRequest): Promise<AiTaskResult> {
    return Promise.resolve({
      ok: false,
      error: this.error('not_configured', request.requestId),
      grounding: null,
    });
  }

  generateApplicationArtifact(request: AiTaskRequest): Promise<AiTaskResult> {
    return Promise.resolve({
      ok: false,
      error: this.error('not_configured', request.requestId),
      grounding: null,
    });
  }

  coach(request: AiTaskRequest): Promise<AiTaskResult> {
    return Promise.resolve({
      ok: false,
      error: this.error('not_configured', request.requestId),
      grounding: null,
    });
  }

  /** Never throws: a status endpoint has to answer even with no provider. */
  healthCheck(): Promise<AiProviderHealth> {
    return Promise.resolve({
      state: 'disabled',
      configured: false,
      reachable: false,
      model: null,
      provider: this.kind,
      capabilities: this.capabilities,
      reason: this.reason,
      latencyMs: null,
    });
  }

  /**
   * The pre-registry entry point, kept so an existing caller keeps working. It
   * rejects, exactly as it always has.
   */
  generate<TOutput>(request: unknown): Promise<AiStructuredGenerateResult<TOutput>> {
    void request;
    return Promise.reject(this.error('not_configured', 'unknown'));
  }

  health(): Promise<'unavailable'> {
    return Promise.resolve('unavailable');
  }

  private error(code: AiProviderErrorCode, requestId: string): AiProviderError {
    return new AiProviderError({
      code,
      message: this.degraded
        ? `AI generation is unavailable: ${this.reason}`
        : 'Live AI generation is disabled in Phase 0',
      provider: this.kind,
      requestId,
      retryable: false,
    });
  }
}
