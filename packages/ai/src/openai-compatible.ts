/**
 * The OpenAI-compatible provider.
 *
 * One implementation covers OpenAI, Azure OpenAI, OpenRouter, Together, Groq,
 * DeepSeek, and a local Ollama or vLLM server, because they all speak the same
 * chat-completions contract. What differs is configuration: the base URL, the
 * model, the credential, and whether the deployment enforces a JSON schema
 * server side.
 *
 * Five properties matter more than the request shape:
 *
 *   1. **Injection.** The system instruction is sent in the system role and the
 *      untrusted block in the user role, both produced by `prompt.ts`. This
 *      module never assembles a prompt of its own.
 *   2. **Transport injection.** `fetch` is a constructor option, so the whole
 *      provider is testable without a network and without a paid key.
 *   3. **Typed failure.** Every outcome is an `AiProviderError` with a closed
 *      code. Raw provider text is never attached to an error, so nothing that
 *      echoes the prompt can reach a log.
 *   4. **Bounded retries.** Retryable codes only, with exponential backoff and a
 *      hard attempt cap. A schema failure or a timeout does not loop forever.
 *   5. **No secret in telemetry.** The key is used to build one header and is
 *      never placed in a request body, an error, or a log record.
 */

import { gateGeneratedOutput, toTaskResult } from './grounding.js';
import type {
  AiFinishReason,
  AiGenerationBudgets,
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
  AiUsage,
  AiUsageLogger,
  JsonSchemaDocument,
  JsonValue,
  StructuredOutputMode,
} from './types.js';
import { AiProviderError, isAiProviderError } from './types.js';

/** The subset of `fetch` this module needs, so a fake is trivial to write. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleConfig {
  readonly kind: AiProviderKind;
  readonly model: string;
  readonly baseUrl: string;
  /** Absent for a keyless local endpoint. Never logged, never returned. */
  readonly apiKey?: string;
  /** Azure uses `api-key`; everything else uses a bearer token. */
  readonly authHeader?: 'bearer' | 'api-key';
  readonly structuredOutput: 'auto' | StructuredOutputMode;
  readonly defaultBudgets: AiGenerationBudgets;
  readonly retryBaseDelayMs: number;
  readonly logger?: AiUsageLogger;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  /** Injected so tests need no real timer. */
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface ChatCompletionChoice {
  readonly message?: { readonly content?: unknown };
  readonly finish_reason?: unknown;
}

interface ChatCompletionBody {
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

const retryableStatuses: ReadonlySet<number> = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function statusToCode(status: number): AiProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 404) return 'invalid_request';
  if (status === 413) return 'too_large';
  if (status >= 500) return 'provider_error';
  return 'provider_error';
}

/**
 * A message this repository wrote. Provider prose is never interpolated, so an
 * error cannot carry a fragment of the prompt or of a resume back to the caller.
 */
const codeMessages: Readonly<Record<AiProviderErrorCode, string>> = Object.freeze({
  not_configured: 'The AI provider is not configured.',
  auth: 'The AI provider rejected the credentials.',
  rate_limit: 'The AI provider is rate limiting this account.',
  timeout: 'The AI provider did not answer within the request timeout.',
  aborted: 'The AI request was aborted by the caller.',
  network: 'The AI provider could not be reached.',
  provider_error: 'The AI provider returned an error response.',
  invalid_request: 'The AI provider rejected the request as invalid.',
  malformed_response: 'The AI provider returned a response that was not valid JSON.',
  schema_invalid: 'The AI provider returned JSON that does not match the required schema.',
  too_large: 'The request or the response exceeded the provider size limit.',
  unavailable: 'No AI provider is available.',
});

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Backoff with a bounded ceiling: 250ms, 500ms, 1000ms for three attempts. */
export function backoffDelay(attempt: number, base: number): number {
  const exponential = base * 2 ** Math.max(attempt - 1, 0);
  return Math.min(exponential, 8_000);
}

/**
 * Runs one operation with bounded retries.
 *
 * `onRetry` is deliberately separate from the operation so a caller can record
 * how many attempts a success needed without the retry loop knowing anything
 * about HTTP.
 */
export async function withBoundedRetries<TResult>(options: {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly signal: AbortSignal;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly shouldRetry: (error: AiProviderError) => boolean;
  readonly run: (attempt: number) => Promise<TResult>;
}): Promise<{ readonly value: TResult; readonly attempts: number }> {
  const sleep = options.sleep ?? defaultSleep;
  const attempts = Math.max(options.maxAttempts, 1);
  let lastError: AiProviderError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal.aborted) {
      // The deadline passed between attempts. The last failure is the reason
      // the caller needs - reporting a bare "aborted" here would turn every
      // timeout into an unexplained cancellation.
      if (lastError !== null && options.shouldRetry(lastError)) throw lastError;
      throw new AiProviderError({
        code: 'aborted',
        message: codeMessages.aborted,
        provider: 'openai_compatible',
        requestId: 'unknown',
      });
    }
    try {
      const value = await options.run(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      if (!isAiProviderError(error)) throw error;
      lastError = error;
      const isLast = attempt >= attempts;
      if (isLast || !options.shouldRetry(error)) break;
      try {
        await sleep(backoffDelay(attempt, options.baseDelayMs), options.signal);
      } catch {
        break;
      }
    }
  }

  throw (
    lastError ??
    new AiProviderError({
      code: 'unavailable',
      message: codeMessages.unavailable,
      provider: 'openai_compatible',
      requestId: 'unknown',
    })
  );
}

/** Closes every object node so a schema-conformant provider cannot add a field. */
export function strictifyJsonSchema(document: JsonSchemaDocument): JsonSchemaDocument {
  const closed = closeObject(document);
  return closed ?? { type: 'object', additionalProperties: false };
}

function closeObject(value: JsonValue | undefined): JsonSchemaDocument | null {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  const node: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    node[key] = closeValue(entry);
  }
  if (node.type === 'object' || node.properties !== undefined) {
    node.additionalProperties = false;
  }
  return node;
}

function closeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => closeValue(entry));
  if (value === null || typeof value !== 'object') return value;
  if ('properties' in value || value.type === 'object' || value.type === 'array') {
    const closed = closeObject(value);
    if (closed !== null) return closed;
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = closeValue(entry);
  return result;
}

/**
 * Strips a code fence and trailing prose from a completion.
 *
 * A model that answers with ```json ... ``` has produced correct JSON wrapped in
 * decoration. Unwrapping it is a repair of the transport, not of the truth: the
 * value still has to satisfy the schema and still has to pass the truth gate.
 */
export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed === '') return null;
  const fenced = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n?```$/u.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const direct = tryParse(candidate);
  if (direct !== undefined) return direct;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const sliced = tryParse(candidate.slice(start, end + 1));
  return sliced === undefined ? null : sliced;
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function toFinishReason(value: unknown): AiFinishReason {
  switch (value) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
      return 'tool_call';
    default:
      return 'other';
  }
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function readUsage(body: ChatCompletionBody): AiUsage {
  const usage =
    typeof body.usage === 'object' && body.usage !== null
      ? (body.usage as Record<string, unknown>)
      : {};
  return {
    inputTokens: readNumber(usage, 'prompt_tokens'),
    outputTokens: readNumber(usage, 'completion_tokens'),
    // Per-token pricing is a deployment fact. Hanaply does not guess it, so the
    // field stays null rather than carrying an invented cost.
    estimatedCostMinorUsd: null,
  };
}

function readContent(body: ChatCompletionBody): string | null {
  const choices: unknown[] = Array.isArray(body.choices) ? body.choices : [];
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const choice = first as ChatCompletionChoice;
  const content = choice.message?.content;
  return typeof content === 'string' ? content : null;
}

function readFinishReason(body: ChatCompletionBody): AiFinishReason {
  const choices: unknown[] = Array.isArray(body.choices) ? body.choices : [];
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return 'other';
  return toFinishReason((first as ChatCompletionChoice).finish_reason);
}

const baseUrlDefaultsFor: Partial<Record<AiProviderKind, string>> = Object.freeze({
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  vllm: 'http://127.0.0.1:8000/v1',
});

export function defaultBaseUrl(kind: AiProviderKind): string | null {
  return baseUrlDefaultsFor[kind] ?? null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenAiCompatibleProvider implements AiProvider {
  readonly kind: AiProviderKind;
  readonly model: string;
  readonly capabilities: AiProviderCapabilities;

  private readonly config: OpenAiCompatibleConfig;
  private readonly fetchImplementation: FetchLike;
  private readonly now: () => number;
  private lastUsage: AiUsage = { inputTokens: 0, outputTokens: 0, estimatedCostMinorUsd: null };
  private lastFinishReason: AiFinishReason = 'other';

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config;
    this.kind = config.kind;
    this.model = config.model;
    this.fetchImplementation = config.fetch ?? ((input, init) => fetch(input, init));
    this.now = config.now ?? (() => Date.now());
    this.capabilities = {
      structuredOutput: true,
      jsonSchema: config.structuredOutput !== 'parse',
      streaming: false,
      // Structured output and tool calling are supported by the contract, but
      // Hanaply never uses them, so the capability is reported honestly as off.
      toolCalls: false,
      vision: false,
    };
  }

  async structuredGenerate<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
  ): Promise<AiStructuredGenerateResult<TOutput>> {
    const budgets = request.budgets;
    const startedAt = this.now();
    let attempts = 0;
    let repaired = false;
    let mode: StructuredOutputMode =
      this.config.structuredOutput === 'parse' ? 'parse' : 'json_schema';

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, budgets.timeoutMs);

    try {
      const outcome = await withBoundedRetries({
        maxAttempts: budgets.maxAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
        signal: controller.signal,
        ...(this.config.sleep === undefined ? {} : { sleep: this.config.sleep }),
        shouldRetry: (error) => error.retryable && error.code !== 'schema_invalid',
        run: async (attempt) => {
          attempts = attempt;
          if (mode === 'json_schema') {
            try {
              const value = await this.requestCompletion(request, 'json_schema', controller.signal);
              return { value, repaired: attempt > 1 };
            } catch (error) {
              if (isAiProviderError(error) && error.code === 'invalid_request' && attempt === 1) {
                // The deployment does not accept a JSON-schema format. Fall back
                // to a strict parse-and-repair path rather than failing: the
                // schema is still enforced by the validator on this side.
                mode = 'parse';
                repaired = true;
                const value = await this.requestCompletion(request, 'parse', controller.signal);
                return { value, repaired: true };
              }
              throw error;
            }
          }
          const value = await this.requestCompletion(request, 'parse', controller.signal);
          return { value, repaired: attempt > 1 || repaired };
        },
      });

      repaired = repaired || outcome.value.repaired;
      const parsed = request.output.schema.safeParse(outcome.value.value);
      if (!parsed.success) {
        throw new AiProviderError({
          code: 'schema_invalid',
          message: codeMessages.schema_invalid,
          provider: this.kind,
          requestId: request.requestId,
          retryable: true,
        });
      }

      const meta: AiResponseMetadata = {
        requestId: request.requestId,
        provider: this.kind,
        model: this.model,
        promptVersion: request.prompt.promptVersion,
        latencyMs: Math.max(this.now() - startedAt, 0),
        attempts: outcome.attempts,
        usage: this.lastUsage,
        finishReason: this.lastFinishReason,
        structuredOutputMode: mode,
        repaired,
      };
      this.log({
        requestId: request.requestId,
        provider: this.kind,
        model: this.model,
        task: request.task,
        promptVersion: request.prompt.promptVersion,
        inputTokens: meta.usage.inputTokens,
        outputTokens: meta.usage.outputTokens,
        latencyMs: meta.latencyMs,
        attempts: meta.attempts,
        outcome: 'succeeded',
        errorCode: null,
        truncatedInputCharacters: request.prompt.untrustedSources.reduce(
          (total, source) => total + Math.max(source.originalLength - source.includedLength, 0),
          0,
        ),
      });
      return { value: parsed.data, meta };
    } catch (error) {
      const normalised = this.normalise(error, request.requestId);
      this.log({
        requestId: request.requestId,
        provider: this.kind,
        model: this.model,
        task: request.task,
        promptVersion: request.prompt.promptVersion,
        inputTokens: this.lastUsage.inputTokens,
        outputTokens: this.lastUsage.outputTokens,
        latencyMs: Math.max(this.now() - startedAt, 0),
        attempts,
        outcome: 'failed',
        errorCode: normalised.code,
        truncatedInputCharacters: request.prompt.untrustedSources.reduce(
          (total, source) => total + Math.max(source.originalLength - source.includedLength, 0),
          0,
        ),
      });
      throw normalised;
    } finally {
      clearTimeout(timeout);
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

  /**
   * Reports configuration and reachability without spending a generation.
   *
   * The probe is a GET of the models route, which costs no tokens. A key that is
   * present is never echoed: `configured` is a boolean and `model` is the
   * identifier, never the credential.
   */
  async healthCheck(): Promise<AiProviderHealth> {
    const startedAt = this.now();
    try {
      const response = await this.fetchImplementation(`${this.trimmedBaseUrl()}/models`, {
        method: 'GET',
        headers: this.headers(),
      });
      const latencyMs = Math.max(this.now() - startedAt, 0);
      if (!response.ok) {
        return {
          state: response.status === 401 || response.status === 403 ? 'unavailable' : 'degraded',
          configured: true,
          reachable: true,
          model: this.model,
          provider: this.kind,
          capabilities: this.capabilities,
          reason:
            response.status === 401 || response.status === 403
              ? codeMessages.auth
              : `The provider answered the health probe with status ${response.status}.`,
          latencyMs,
        };
      }
      return {
        state: 'available',
        configured: true,
        reachable: true,
        model: this.model,
        provider: this.kind,
        capabilities: this.capabilities,
        reason: null,
        latencyMs,
      };
    } catch {
      // A network failure is reported as unreachable, never as a thrown error,
      // so a caller can degrade to the deterministic path without a try/catch.
      return {
        state: 'unavailable',
        configured: true,
        reachable: false,
        model: this.model,
        provider: this.kind,
        capabilities: this.capabilities,
        reason: codeMessages.network,
        latencyMs: Math.max(this.now() - startedAt, 0),
      };
    }
  }

  private async runTask(
    task: 'opportunity_analysis' | 'application_artifact' | 'coaching',
    request: AiTaskRequest,
  ): Promise<AiTaskResult> {
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
      const normalised = isAiProviderError(error)
        ? error
        : this.normalise(error, request.requestId);
      return { ok: false, error: normalised, grounding: null };
    }
  }

  private async requestCompletion<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
    mode: StructuredOutputMode,
    signal: AbortSignal,
  ): Promise<unknown> {
    const body = this.buildBody(request, mode);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.trimmedBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      // The deadline may have fired while the request was in flight, in which
      // case the abort is the reason the request failed. An `AbortError` counts
      // even when the signal is not yet flagged, because a fetch implementation
      // may reject on an abort that arrived as the request was handed over.
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new AiProviderError({
          code: 'timeout',
          message: codeMessages.timeout,
          provider: this.kind,
          requestId: request.requestId,
          cause: error,
        });
      }
      throw new AiProviderError({
        code: 'network',
        message: codeMessages.network,
        provider: this.kind,
        requestId: request.requestId,
        cause: error,
      });
    }

    if (!response.ok) {
      const code = statusToCode(response.status);
      throw new AiProviderError({
        code,
        message: codeMessages[code],
        provider: this.kind,
        requestId: request.requestId,
        statusCode: response.status,
        retryable: retryableStatuses.has(response.status),
      });
    }

    let body_: ChatCompletionBody;
    try {
      body_ = (await response.json()) as ChatCompletionBody;
    } catch (error) {
      throw new AiProviderError({
        code: 'malformed_response',
        message: codeMessages.malformed_response,
        provider: this.kind,
        requestId: request.requestId,
        retryable: true,
        cause: error,
      });
    }

    this.lastUsage = readUsage(body_);
    this.lastFinishReason = readFinishReason(body_);

    const content = readContent(body_);
    if (content === null) {
      throw new AiProviderError({
        code: 'malformed_response',
        message: codeMessages.malformed_response,
        provider: this.kind,
        requestId: request.requestId,
        retryable: true,
      });
    }

    const parsed = extractJsonObject(content);
    if (parsed === null) {
      throw new AiProviderError({
        code: 'malformed_response',
        message: codeMessages.malformed_response,
        provider: this.kind,
        requestId: request.requestId,
        retryable: true,
      });
    }
    return parsed;
  }

  private buildBody<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
    mode: StructuredOutputMode,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: request.prompt.system.join('\n') },
        { role: 'user', content: request.prompt.user },
      ],
      temperature: request.budgets.temperature,
      max_tokens: request.budgets.maxOutputTokens,
      stream: false,
    };
    if (mode === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.output.schemaName,
          strict: true,
          schema: strictifyJsonSchema(request.output.jsonSchema),
        },
      };
      return body;
    }
    body.response_format = { type: 'json_object' };
    // The schema travels in the system message on the parse path, because no
    // server-side enforcement is available and the model still needs the shape.
    body.messages = [
      {
        role: 'system',
        content: [
          request.prompt.system.join('\n'),
          '',
          'The JSON object must conform to this JSON Schema:',
          JSON.stringify(request.output.jsonSchema),
        ].join('\n'),
      },
      { role: 'user', content: request.prompt.user },
    ];
    return body;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const key = this.config.apiKey;
    if (key !== undefined && key !== '') {
      if (this.config.authHeader === 'api-key') headers['api-key'] = key;
      else headers.authorization = `Bearer ${key}`;
    }
    return headers;
  }

  private trimmedBaseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/u, '');
  }

  private normalise(error: unknown, requestId: string): AiProviderError {
    if (isAiProviderError(error)) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new AiProviderError({
        code: 'timeout',
        message: codeMessages.timeout,
        provider: this.kind,
        requestId,
        cause: error,
      });
    }
    return new AiProviderError({
      code: 'provider_error',
      message: codeMessages.provider_error,
      provider: this.kind,
      requestId,
      cause: error,
    });
  }

  private log(event: Parameters<AiUsageLogger>[0]): void {
    const logger = this.config.logger;
    if (logger === undefined) return;
    logger(event);
  }
}

/** Exported so the registry can name a schema-invalid failure consistently. */
export const providerErrorMessages = codeMessages;
