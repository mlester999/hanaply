/**
 * Hanaply AI provider layer.
 *
 * One boundary, three implementations, and a truth gate that runs on every
 * response:
 *
 *   - `createAiProvider(environment)` returns the configured provider, or
 *     `DisabledAiProvider` when none is configured.
 *   - `OpenAiCompatibleProvider` speaks the chat-completions contract, so OpenAI,
 *     Azure OpenAI, OpenRouter, Together, Groq, DeepSeek, and a local Ollama or
 *     vLLM server are configuration rather than code.
 *   - `FakeAiProvider` is deterministic, network-free, and usable in tests and in
 *     the E2E environment.
 *
 * The product rule the layer exists to protect: the model may never originate a
 * factual claim about the member. Instructions are built in code, untrusted
 * content is delimited and sanitised, the output schema is fixed per task, and
 * `gateGeneratedOutput` rejects or strips any claim the confirmed evidence does
 * not support. Score and confidence stay with `@hanaply/matching`.
 *
 * `createAiProvider` never throws. A malformed environment, a selected provider
 * with no credential, or a missing base URL each produce a `DisabledAiProvider`
 * that reports `state: 'disabled'` and carries the reason, so a caller falls back
 * to the deterministic path with the degradation visible rather than presenting
 * deterministic output as something a model wrote.
 */

import { parseAiEnvironment, type AiEnvironment } from '@hanaply/config';

import { DisabledAiProvider } from './disabled.js';
import { FakeAiProvider } from './fake.js';
import { OpenAiCompatibleProvider, defaultBaseUrl } from './openai-compatible.js';
import type {
  AiGenerationBudgets,
  AiGenerationResult,
  AiProvider,
  AiUsage,
  AiUsageLogger,
  GroundingReport,
  TruthGateResult,
} from './types.js';

export { DisabledAiProvider, noCapabilities } from './disabled.js';
export { AiProviderError, defineAiSchema, isAiProviderError, isAiUnavailable } from './types.js';

export type {
  AiFinishReason,
  AiGenerationBudgets,
  AiGenerationRequest,
  AiGenerationResult,
  AiHealthState,
  AiPromptEnvelope,
  AiProvider,
  AiProviderCapabilities,
  AiProviderErrorCode,
  AiProviderHealth,
  AiProviderKind,
  AiResponseMetadata,
  AiStructuredGenerateRequest,
  AiStructuredGenerateResult,
  AiStructuredSchema,
  AiTaskKind,
  AiTaskRequest,
  AiTaskResult,
  AiUsage,
  AiUsageEvent,
  AiUsageLogger,
  ApplicationArtifactDraft,
  CoachingResponse,
  GroundedTaskOutput,
  GroundingClaimKind,
  GroundingClaimResult,
  GroundingClaimStatus,
  GroundingContext,
  GroundingDeterministicInput,
  GroundingFact,
  GroundingRejection,
  GroundingReport,
  GroundingStatus,
  JsonSchemaDocument,
  JsonValue,
  OpportunityAnalysis,
  StructuredOutputMode,
  TruthGateResult,
  UntrustedSourceContent,
  UntrustedSourceRecord,
  UntrustedSourceType,
} from './types.js';

export {
  DEFAULT_MAX_UNTRUSTED_CHARACTERS,
  MAX_CHARACTERS_PER_SOURCE,
  assertTrustedInstructions,
  buildPromptEnvelope,
  createUntrustedDelimiter,
  hashUntrustedSource,
  sanitizeUntrustedContent,
  untrustedSource,
} from './prompt.js';

export {
  buildEvidenceIndex,
  cleanGeneratedValue,
  extractClaims,
  extractNamedEntityPhrases,
  findScoreLikeFields,
  gateGeneratedOutput,
  normalizeText,
  splitSentences,
  toTaskResult,
} from './grounding.js';
export type {
  CleanedValue,
  EvidenceIndex,
  ExtractClaimsOptions,
  GatedTask,
  GateDecision,
  GateInput,
} from './grounding.js';

export {
  applicationArtifactAiSchema,
  applicationArtifactKindSchema,
  applicationArtifactSchema,
  coachingAiSchema,
  coachingSchema,
  opportunityAnalysisAiSchema,
  opportunityAnalysisSchema,
} from './schemas.js';

export {
  artifactTaskKind,
  buildArtifactRequest,
  buildCoachRequest,
  buildMatchAnalysis,
  buildOpportunityAnalysisRequest,
  buildProfileIdentity,
  defaultBudgets,
  promptVersion,
  renderDeterministicInput,
} from './tasks.js';

export { FakeAiProvider, createFakeAiProvider } from './fake.js';
export type { FakeFailure, FakeFailureMode, FakeProviderOptions, FakeScriptEntry } from './fake.js';

export {
  OpenAiCompatibleProvider,
  backoffDelay,
  defaultBaseUrl,
  extractJsonObject,
  providerErrorMessages,
  readUsage,
  strictifyJsonSchema,
  withBoundedRetries,
} from './openai-compatible.js';
export type { FetchLike, OpenAiCompatibleConfig } from './openai-compatible.js';

export { parseAiEnvironment };
export type { AiEnvironment };

export interface CreateAiProviderOptions {
  readonly logger?: AiUsageLogger;
  /** Injected for tests: the real provider performs no I/O without this. */
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function budgetsFrom(environment: AiEnvironment): AiGenerationBudgets {
  return {
    maxOutputTokens: environment.AI_MAX_OUTPUT_TOKENS,
    timeoutMs: environment.AI_TIMEOUT_MS,
    maxAttempts: environment.AI_MAX_ATTEMPTS,
    temperature: environment.AI_TEMPERATURE,
  };
}

/**
 * Resolves the configured provider.
 *
 * Every failure path returns a disabled provider rather than throwing, because
 * the caller still has to answer the request - deterministically, and with the
 * degradation stated rather than implied.
 */
export function createAiProvider(
  environment: Record<string, unknown>,
  options: CreateAiProviderOptions = {},
): AiProvider {
  let parsed: AiEnvironment;
  try {
    parsed = parseAiEnvironment(environment);
  } catch (error) {
    const detail =
      error instanceof Error ? firstIssue(error.message) : 'the environment is invalid';
    return new DisabledAiProvider({
      reason: `The AI environment could not be parsed: ${detail}`,
      degraded: true,
    });
  }

  if (parsed.AI_PROVIDER === 'disabled') {
    return new DisabledAiProvider({
      reason:
        'No AI provider is configured. Hanaply is running on its deterministic engine, and everything it produces is deterministic rather than model-generated.',
    });
  }

  const model = parsed.AI_MODEL;
  if (model === undefined) {
    // The schema requires a model for every real provider, so this is unreachable
    // through `parseAiEnvironment`. It is handled anyway, because a silent
    // fallback here is precisely the failure this function exists to prevent.
    return new DisabledAiProvider({
      kind: parsed.AI_PROVIDER,
      reason: `AI_PROVIDER=${parsed.AI_PROVIDER} requires AI_MODEL`,
      degraded: true,
    });
  }

  if (parsed.AI_PROVIDER === 'fake') {
    return new FakeAiProvider({ kind: 'fake', model });
  }

  const baseUrl = parsed.AI_BASE_URL ?? defaultBaseUrl(parsed.AI_PROVIDER);
  if (baseUrl === null) {
    return new DisabledAiProvider({
      kind: parsed.AI_PROVIDER,
      reason: `AI_PROVIDER=${parsed.AI_PROVIDER} requires AI_BASE_URL`,
      degraded: true,
    });
  }

  const apiKey = parsed.AI_API_KEY;
  if (
    apiKey === undefined &&
    parsed.HANAPLY_ENV === 'production' &&
    parsed.AI_PROVIDER !== 'ollama' &&
    parsed.AI_PROVIDER !== 'vllm'
  ) {
    return new DisabledAiProvider({
      kind: parsed.AI_PROVIDER,
      reason: `AI_PROVIDER=${parsed.AI_PROVIDER} is selected but AI_API_KEY is not set. The deterministic engine is still the product, and its output must be labelled deterministic.`,
      degraded: true,
    });
  }

  return new OpenAiCompatibleProvider({
    kind: parsed.AI_PROVIDER,
    model,
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(parsed.AI_PROVIDER === 'azure_openai' ? { authHeader: 'api-key' as const } : {}),
    structuredOutput: parsed.AI_STRUCTURED_OUTPUT,
    defaultBudgets: budgetsFrom(parsed),
    retryBaseDelayMs: parsed.AI_RETRY_BASE_DELAY_MS,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
}

/**
 * The first validation issue, reduced to one bounded line.
 *
 * A `ZodError` message is a pretty-printed JSON array, and a naive
 * first-non-empty-line read of it yields "[". The issue is read properly, and
 * the message keeps the field name, because "AI_API_KEY is required" is the
 * whole point of reporting the failure.
 */
function firstIssue(message: string): string {
  try {
    const issues: unknown = JSON.parse(message);
    if (Array.isArray(issues)) {
      const first: unknown = issues[0];
      if (typeof first === 'object' && first !== null) {
        const path = (first as { path?: unknown }).path;
        const detail = (first as { message?: unknown }).message;
        const field = Array.isArray(path) ? path.join('.') : '';
        const text = typeof detail === 'string' ? detail : 'invalid value';
        return boundLine(field === '' ? text : `${field}: ${text}`);
      }
    }
  } catch {
    // Not a JSON issue list; fall through to the plain-text path.
  }
  return boundLine(message.split('\n').find((entry) => entry.trim().length > 0) ?? message);
}

function boundLine(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}...` : value;
}

/**
 * True when the provider cannot generate at all. A caller checks this before
 * making a request rather than discovering the degradation from a failure.
 */
export function isDeterministicOnly(provider: AiProvider): boolean {
  return provider instanceof DisabledAiProvider;
}

/** True when a provider was selected but could not be constructed. */
export function isDegraded(provider: AiProvider): boolean {
  return provider instanceof DisabledAiProvider && provider.degraded;
}

/**
 * Projects a per-claim grounding report onto the database-shaped summary.
 *
 * Both shapes come from one evaluation, so a consumer of the older contract
 * cannot reach a different conclusion from a consumer of the newer one.
 */
export function truthGateFromGrounding(report: GroundingReport): TruthGateResult {
  return {
    status:
      report.status === 'passed'
        ? 'passed'
        : report.status === 'rejected'
          ? 'rejected'
          : 'needs_review',
    unsupportedClaimIds: report.unsupportedClaimIds,
    verifiedFactIds: report.verifiedFactIds,
  };
}

/**
 * Builds the legacy result envelope from a gated response, so a caller written
 * against the original placeholder interface can adopt the new layer without a
 * second code path.
 */
export function legacyGenerationResult<TOutput>(options: {
  output: TOutput;
  provider: AiProvider['kind'];
  model: string;
  promptVersion: string;
  usage: AiUsage;
  truthGate: TruthGateResult;
}): AiGenerationResult<TOutput> {
  return {
    output: options.output,
    provider: options.provider,
    model: options.model,
    promptVersion: options.promptVersion,
    usage: options.usage,
    truthGate: options.truthGate,
  };
}
