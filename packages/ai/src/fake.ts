/**
 * The deterministic fake provider.
 *
 * It exists so the AI layer can be tested, and so the E2E environment can
 * exercise every path that touches a provider, without a network, a paid key,
 * or a nondeterministic model. It is not a stub: it runs the same truth gate the
 * real provider runs, records the requests it received so a test can assert on
 * prompt construction, and can be told to fail in each of the ways a real
 * deployment fails.
 *
 * Every failure mode is produced as the same typed error the real provider
 * produces, so a test that asserts on a rate limit is asserting on the contract
 * rather than on this file.
 */

import { gateGeneratedOutput, toTaskResult, type GatedTask } from './grounding.js';
import type {
  AiProvider,
  AiProviderCapabilities,
  AiProviderErrorCode,
  AiProviderHealth,
  AiProviderKind,
  AiResponseMetadata,
  AiStructuredGenerateRequest,
  AiStructuredGenerateResult,
  AiTaskRequest,
  AiTaskResult,
} from './types.js';
import { AiProviderError } from './types.js';

export type FakeFailureMode =
  | 'timeout'
  | 'malformed_json'
  | 'schema_invalid'
  | 'rate_limit'
  | 'server_error'
  | 'auth'
  | 'network';

export interface FakeFailure {
  readonly mode: FakeFailureMode;
  /** How many times this failure fires before the script advances. Defaults to 1. */
  readonly times?: number;
}

export interface FakeScriptEntry {
  /** The value to return. Ignored when `failure` is set. */
  readonly response?: unknown;
  readonly failure?: FakeFailure;
  /** Milliseconds to wait before answering. `timeout` ignores this. */
  readonly delayMs?: number;
}

export interface FakeProviderOptions {
  readonly kind?: AiProviderKind;
  readonly model?: string;
  readonly capabilities?: Partial<AiProviderCapabilities>;
  /** Scripted answers, consumed in order. An exhausted script throws. */
  readonly responses?: readonly unknown[];
  readonly failures?: readonly FakeFailure[];
  readonly health?: Partial<AiProviderHealth>;
}

interface RecordedRequest {
  readonly request: AiStructuredGenerateRequest<unknown>;
  /** The raw composed prompt, so a test can assert on its structure. */
  readonly system: readonly string[];
  readonly user: string;
}

const failureCodes: Readonly<Record<FakeFailureMode, AiProviderErrorCode>> = Object.freeze({
  timeout: 'timeout',
  malformed_json: 'malformed_response',
  schema_invalid: 'schema_invalid',
  rate_limit: 'rate_limit',
  server_error: 'provider_error',
  auth: 'auth',
  network: 'network',
});

const defaultCapabilities: AiProviderCapabilities = Object.freeze({
  structuredOutput: true,
  jsonSchema: true,
  streaming: false,
  toolCalls: false,
  vision: false,
});

export class FakeAiProvider implements AiProvider {
  readonly kind: AiProviderKind;
  readonly model: string;
  readonly capabilities: AiProviderCapabilities;

  private readonly script: FakeScriptEntry[];
  private readonly history: RecordedRequest[] = [];
  private readonly healthOverride: Partial<AiProviderHealth>;
  private cursor = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.kind = options.kind ?? 'fake';
    this.model = options.model ?? 'hanaply-fake-1';
    this.capabilities = { ...defaultCapabilities, ...options.capabilities };
    this.healthOverride = options.health ?? {};
    this.script = [
      ...(options.responses ?? []).map((response): FakeScriptEntry => ({ response })),
      ...(options.failures ?? []).map((failure): FakeScriptEntry => ({ failure })),
    ];
  }

  /** The requests this provider received, oldest first. */
  get requests(): readonly RecordedRequest[] {
    return this.history;
  }

  /** The most recent request, or null when none has been made. */
  get lastRequest(): RecordedRequest | null {
    return this.history[this.history.length - 1] ?? null;
  }

  /**
   * Appends answers to the script. Useful in a `beforeEach`.
   *
   * An entry that carries a `response` or a `failure` key is taken as a full
   * script entry; anything else is treated as the response value itself.
   */
  queue(...entries: readonly unknown[]): this {
    for (const entry of entries) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        ('response' in entry || 'failure' in entry)
      ) {
        this.script.push(entry as FakeScriptEntry);
        continue;
      }
      this.script.push({ response: entry });
    }
    return this;
  }

  /** Fails the next `times` calls in the given way, then continues. */
  fail(mode: FakeFailureMode, times = 1): this {
    this.script.push({ failure: { mode, times } });
    return this;
  }

  reset(): void {
    this.history.length = 0;
    this.script.length = 0;
    this.cursor = 0;
  }

  /**
   * Answers from the script.
   *
   * Deliberately synchronous-bodied: the fake performs no I/O, so there is
   * nothing to await. It rejects rather than resolving an empty value, because a
   * resolved empty value cannot be told apart from a model that said nothing.
   */
  structuredGenerate<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
  ): Promise<AiStructuredGenerateResult<TOutput>> {
    this.history.push({
      request,
      system: request.prompt.system,
      user: request.prompt.user,
    });

    try {
      const entry = this.nextEntry();
      if (entry.failure !== undefined) throw this.failureError(entry.failure, request.requestId);
      if (entry.delayMs !== undefined && entry.delayMs > request.budgets.timeoutMs) {
        return Promise.reject(
          new AiProviderError({
            code: 'timeout',
            message: 'The AI provider did not answer within the request timeout.',
            provider: this.kind,
            requestId: request.requestId,
          }),
        );
      }

      const parsed = request.output.schema.safeParse(entry.response);
      if (!parsed.success) {
        return Promise.reject(
          new AiProviderError({
            code: 'schema_invalid',
            message: 'The AI provider returned JSON that does not match the required schema.',
            provider: this.kind,
            requestId: request.requestId,
            retryable: true,
          }),
        );
      }

      const meta: AiResponseMetadata = {
        requestId: request.requestId,
        provider: this.kind,
        model: this.model,
        promptVersion: request.prompt.promptVersion,
        latencyMs: entry.delayMs ?? 1,
        attempts: 1,
        usage: {
          inputTokens: request.prompt.untrustedSources.reduce(
            (total, source) => total + Math.ceil(source.includedLength / 4),
            0,
          ),
          outputTokens: Math.ceil(JSON.stringify(parsed.data).length / 4),
          estimatedCostMinorUsd: null,
        },
        finishReason: 'stop',
        structuredOutputMode: this.capabilities.jsonSchema ? 'json_schema' : 'parse',
        repaired: false,
      };
      return Promise.resolve({ value: parsed.data, meta });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async analyzeOpportunity(request: AiTaskRequest): Promise<AiTaskResult> {
    return this.runTask('opportunity_analysis', request);
  }

  async generateApplicationArtifact(request: AiTaskRequest): Promise<AiTaskResult> {
    return this.runTask('application_artifact', request);
  }

  async coach(request: AiTaskRequest): Promise<AiTaskResult> {
    return this.runTask('coaching', request);
  }

  healthCheck(): Promise<AiProviderHealth> {
    return Promise.resolve({
      state: 'available',
      configured: true,
      reachable: true,
      model: this.model,
      provider: this.kind,
      capabilities: this.capabilities,
      reason: null,
      latencyMs: 0,
      ...this.healthOverride,
    });
  }

  private async runTask(task: GatedTask, request: AiTaskRequest): Promise<AiTaskResult> {
    try {
      const generated = await this.structuredGenerate({
        requestId: request.requestId,
        task: request.task,
        output: request.output,
        prompt: request.prompt,
        budgets: request.budgets,
        admissibleFactIds: request.grounding.deterministic.admissibleFactIds,
      });
      const decision = gateGeneratedOutput({
        value: generated.value,
        context: request.grounding,
        task,
      });
      return toTaskResult({
        decision,
        schema: request.output.schema,
        meta: generated.meta,
        provider: this.kind,
        requestId: request.requestId,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        return { ok: false, error, grounding: null };
      }
      throw error;
    }
  }

  private nextEntry(): FakeScriptEntry {
    const entry = this.script[this.cursor];
    if (entry === undefined) {
      this.cursor += 1;
      throw new AiProviderError({
        code: 'not_configured',
        message: 'The fake AI provider received no scripted response for this request.',
        provider: this.kind,
        requestId: 'unknown',
      });
    }
    const failure = entry.failure;
    if (failure !== undefined && (failure.times ?? 1) > 1) {
      this.script[this.cursor] = {
        ...entry,
        failure: { ...failure, times: (failure.times ?? 1) - 1 },
      };
      return entry;
    }
    this.cursor += 1;
    return entry;
  }

  private failureError(failure: FakeFailure, requestId: string): AiProviderError {
    const code = failureCodes[failure.mode];
    const messages: Readonly<Record<FakeFailureMode, string>> = Object.freeze({
      timeout: 'The AI provider did not answer within the request timeout.',
      malformed_json: 'The AI provider returned a response that was not valid JSON.',
      schema_invalid: 'The AI provider returned JSON that does not match the required schema.',
      rate_limit: 'The AI provider is rate limiting this account.',
      server_error: 'The AI provider returned an error response.',
      auth: 'The AI provider rejected the credentials.',
      network: 'The AI provider could not be reached.',
    });
    return new AiProviderError({
      code,
      message: messages[failure.mode],
      provider: this.kind,
      requestId,
      statusCode:
        failure.mode === 'rate_limit' ? 429 : failure.mode === 'server_error' ? 500 : null,
    });
  }
}

/**
 * A convenience constructor for the common case: a provider with a script and a
 * recorder, used in a test or in the E2E environment.
 */
export function createFakeAiProvider(options: FakeProviderOptions = {}): FakeAiProvider {
  return new FakeAiProvider(options);
}
