/**
 * Hanaply AI provider contract.
 *
 * This module is the whole vocabulary of the AI layer: the provider boundary,
 * the request and response envelopes, the typed error set, and the output
 * schemas the model is allowed to fill in. Two invariants shape it.
 *
 *   1. Trusted instructions are built in code. They are arrays of strings this
 *      repository authors; nothing derived from a job posting, a resume, or an
 *      external page can reach `PromptEnvelope.system`.
 *   2. Every response carries the provenance needed to audit it (provider,
 *      model, prompt version, usage, latency, finish reason) and nothing that
 *      could leak a credential. `AiProviderError` never carries raw provider
 *      text, only a message this repository wrote.
 *
 * The schemas below are fixed per task. A model cannot widen them: the provider
 * sends the same schema it validates against, and a response that does not
 * match is a `schema_invalid` failure rather than a partially trusted object.
 */

import { z } from 'zod';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON Schema document narrow enough to send as a structured-output format. */
export type JsonSchemaDocument = Readonly<Record<string, JsonDocumentValue>>;

/** A JSON document value, used to describe a schema without resorting to `any`. */
export type JsonDocumentValue =
  string | number | boolean | null | JsonDocumentValue[] | { [key: string]: JsonDocumentValue };

/**
 * Provider families. `azure_openai`, `openrouter`, `together`, `groq`,
 * `deepseek`, `ollama`, `vllm`, and `openai_compatible` all speak the same
 * chat-completions contract; they are named separately because their defaults,
 * authentication, and structured-output support differ.
 */
export type AiProviderKind =
  | 'disabled'
  | 'fake'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure_openai'
  | 'openrouter'
  | 'together'
  | 'groq'
  | 'deepseek'
  | 'ollama'
  | 'vllm'
  | 'openai_compatible';

export type AiTaskKind =
  | 'job_extraction'
  | 'preliminary_scoring'
  | 'deep_job_analysis'
  | 'resume_parsing'
  | 'portfolio_parsing'
  | 'cover_letter_generation'
  | 'resume_tailoring'
  | 'interview_preparation'
  | 'recruiter_message'
  | 'career_coaching'
  | 'embedding'
  | 'notification_summary';

export type UntrustedSourceType =
  'job_post' | 'resume' | 'portfolio' | 'employer_instruction' | 'external_page';

export interface UntrustedSourceContent {
  readonly sourceId: string;
  readonly sourceType: UntrustedSourceType;
  /** Digest of the exact bytes the caller read, so a prompt can be reproduced. */
  readonly sha256: string;
  readonly content: string;
  readonly trustLevel: 'untrusted';
}

/** How a provider is asked to produce structured output. */
export type StructuredOutputMode = 'json_schema' | 'parse';

export interface AiStructuredSchema<TOutput> {
  readonly schemaName: string;
  readonly schema: z.ZodType<TOutput>;
  /**
   * The document sent to the provider. Always generated from `schema` by
   * `defineAiSchema`, so the wire format and the validator cannot diverge.
   */
  readonly jsonSchema: JsonSchemaDocument;
}

/** Provider-side capability declaration. Callers branch on this, never on vendor names. */
export interface AiProviderCapabilities {
  readonly structuredOutput: boolean;
  /** True when the provider enforces a JSON schema server side. */
  readonly jsonSchema: boolean;
  readonly streaming: boolean;
  readonly toolCalls: boolean;
  /** Whether a request may carry images. Hanaply does not send any today. */
  readonly vision: boolean;
}

export interface AiGenerationBudgets {
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  /** Total attempts including the first. Bounded retries on retryable errors only. */
  readonly maxAttempts: number;
  readonly temperature: number;
}

export interface AiPromptEnvelope {
  /**
   * Trusted instruction lines, authored in code. Rendered before the untrusted
   * block and never interpolated with data.
   */
  readonly system: readonly string[];
  /** The untrusted data block, already sanitised, delimited, and truncated. */
  readonly user: string;
  readonly untrustedDelimiter: string;
  readonly untrustedSources: readonly UntrustedSourceRecord[];
  readonly promptVersion: string;
  readonly truncated: boolean;
  readonly neutralisedInstructionRemovals: number;
}

export interface UntrustedSourceRecord {
  readonly sourceId: string;
  readonly sourceType: UntrustedSourceType;
  readonly sha256: string;
  readonly originalLength: number;
  readonly includedLength: number;
  readonly truncated: boolean;
}

export interface AiStructuredGenerateRequest<TOutput> {
  readonly requestId: string;
  readonly task: AiTaskKind;
  readonly output: AiStructuredSchema<TOutput>;
  readonly prompt: AiPromptEnvelope;
  readonly budgets: AiGenerationBudgets;
  /**
   * Confirmed career fact identifiers the model was given. Nothing else is
   * admissible evidence, and the grounding gate rejects a citation outside it.
   */
  readonly admissibleFactIds: readonly string[];
}

export type AiFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_call' | 'other';

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Null when the deployment has not published per-token pricing. */
  readonly estimatedCostMinorUsd: number | null;
}

/**
 * Everything a caller needs to meter, audit, and reconcile one generation.
 * It deliberately contains no prompt text and no credential material.
 */
export interface AiResponseMetadata {
  readonly requestId: string;
  readonly provider: AiProviderKind;
  readonly model: string;
  readonly promptVersion: string;
  readonly latencyMs: number;
  readonly attempts: number;
  readonly usage: AiUsage;
  readonly finishReason: AiFinishReason;
  readonly structuredOutputMode: StructuredOutputMode;
  /** True when the first response was repaired or the retry loop re-asked. */
  readonly repaired: boolean;
}

export interface AiStructuredGenerateResult<TOutput> {
  readonly value: TOutput;
  readonly meta: AiResponseMetadata;
}

// ---------------------------------------------------------------------------
// Typed error set
// ---------------------------------------------------------------------------

export type AiProviderErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'provider_error'
  | 'invalid_request'
  | 'malformed_response'
  | 'schema_invalid'
  | 'too_large'
  | 'unavailable';

/**
 * The only error type the AI layer throws.
 *
 * `message` is written by this repository; raw provider text is never attached,
 * so a caller cannot accidentally log a response body that echoes the prompt.
 * `retryable` drives the bounded retry loop and nothing else does.
 */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly provider: AiProviderKind;
  readonly requestId: string;

  constructor(options: {
    code: AiProviderErrorCode;
    message: string;
    provider: AiProviderKind;
    requestId: string;
    retryable?: boolean;
    statusCode?: number | null;
    cause?: unknown;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiProviderError';
    this.code = options.code;
    this.provider = options.provider;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? defaultRetryable(options.code);
    this.statusCode = options.statusCode ?? null;
  }
}

const retryableCodes: ReadonlySet<AiProviderErrorCode> = new Set<AiProviderErrorCode>([
  'rate_limit',
  'timeout',
  'network',
  'provider_error',
  'unavailable',
]);

/** A structured-output failure is retryable: re-asking usually fixes it. */
function defaultRetryable(code: AiProviderErrorCode): boolean {
  return retryableCodes.has(code);
}

export function isAiProviderError(value: unknown): value is AiProviderError {
  return value instanceof AiProviderError;
}

/** True when the caller should fall back to the deterministic path instead. */
export function isAiUnavailable(value: unknown): boolean {
  if (!isAiProviderError(value)) return false;
  return (
    value.code === 'not_configured' ||
    value.code === 'unavailable' ||
    value.code === 'auth' ||
    value.code === 'invalid_request'
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type AiHealthState = 'available' | 'degraded' | 'unavailable' | 'disabled';

export interface AiProviderHealth {
  readonly state: AiHealthState;
  /** True when a provider, a model, and a usable endpoint are all present. */
  readonly configured: boolean;
  readonly reachable: boolean;
  /** The model identifier. Never derived from, or containing, a credential. */
  readonly model: string | null;
  readonly provider: AiProviderKind;
  readonly capabilities: AiProviderCapabilities;
  /**
   * Why generation is not available. Present whenever `state` is not
   * `available`, so a caller can report a degraded state instead of presenting
   * deterministic output as model output.
   */
  readonly reason: string | null;
  /** Latency of the reachability probe, or null when no probe was made. */
  readonly latencyMs: number | null;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export interface AiUsageEvent {
  readonly requestId: string;
  readonly provider: AiProviderKind;
  readonly model: string;
  readonly task: AiTaskKind;
  readonly promptVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly attempts: number;
  readonly outcome: 'succeeded' | 'failed';
  readonly errorCode: AiProviderErrorCode | null;
  /** How many untrusted characters were dropped by the input bound. */
  readonly truncatedInputCharacters: number;
}

/**
 * The logging seam. The provider never receives a logger that could render a
 * prompt, a key, or resume text: it only ever emits this record, whose fields
 * are all numbers, identifiers, and closed enums.
 */
export type AiUsageLogger = (event: AiUsageEvent) => void;

// ---------------------------------------------------------------------------
// Provider boundary
// ---------------------------------------------------------------------------

export interface AiProvider {
  readonly kind: AiProviderKind;
  readonly capabilities: AiProviderCapabilities;
  /** The configured model identifier, or null when the provider is disabled. */
  readonly model: string | null;

  structuredGenerate<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
  ): Promise<AiStructuredGenerateResult<TOutput>>;

  analyzeOpportunity(request: AiTaskRequest): Promise<AiTaskResult>;

  generateApplicationArtifact(request: AiTaskRequest): Promise<AiTaskResult>;

  coach(request: AiTaskRequest): Promise<AiTaskResult>;

  healthCheck(): Promise<AiProviderHealth>;
}

/**
 * The task-level request the three named entry points share.
 *
 * `output` fixes the schema, `prompt` carries the trusted instruction and the
 * delimited untrusted data, and `grounding` carries the admissible evidence the
 * validator checks every claim against.
 */
export interface AiTaskRequest {
  readonly requestId: string;
  readonly task: AiTaskKind;
  readonly output: AiStructuredSchema<unknown>;
  readonly prompt: AiPromptEnvelope;
  readonly budgets: AiGenerationBudgets;
  readonly grounding: GroundingContext;
}

/** Per-claim outcome from the truth gate. */
export type GroundingClaimKind = 'fact_citation' | 'numeric' | 'experience' | 'entity' | 'label';

export type GroundingClaimStatus = 'supported' | 'dropped' | 'rejected';

export interface GroundingClaimResult {
  /** JSON-pointer-ish path of the field the claim was found in. */
  readonly path: string;
  readonly kind: GroundingClaimKind;
  /** The offending excerpt, bounded. Empty for structural claims. */
  readonly text: string;
  readonly status: GroundingClaimStatus;
  readonly reason: string | null;
}

export interface GroundingRejection {
  readonly code: GroundingClaimKind;
  readonly path: string;
  readonly detail: string;
}

export type GroundingStatus = 'passed' | 'partial' | 'rejected';

/** The subset of `TruthGateResult` the AI layer reports, extended per claim. */
export interface GroundingReport {
  readonly status: GroundingStatus;
  /** Retained for the database-shaped truth gate contract. */
  readonly unsupportedClaimIds: readonly string[];
  readonly verifiedFactIds: readonly string[];
  readonly admissibleFactIds: readonly string[];
  readonly claims: readonly GroundingClaimResult[];
  readonly rejections: readonly GroundingRejection[];
  readonly numericClaimsChecked: number;
  readonly entityClaimsChecked: number;
  readonly experienceClaimsChecked: number;
}

export interface GroundedTaskOutput<TOutput> {
  readonly value: TOutput;
  readonly meta: AiResponseMetadata;
  readonly grounding: GroundingReport;
}

export type AiTaskResult =
  | { readonly ok: true; readonly result: GroundedTaskOutput<unknown> }
  | {
      readonly ok: false;
      readonly error: AiProviderError;
      readonly grounding: GroundingReport | null;
    };

/**
 * The admissible evidence set for one generation.
 *
 * `facts` are the confirmed career facts supplied to the model. `deterministic`
 * carries the matching engine's own strings and the structured job record, which
 * the model may quote verbatim but may never recompute.
 */
export interface GroundingContext {
  readonly facts: readonly GroundingFact[];
  readonly deterministic: GroundingDeterministicInput;
}

export interface GroundingFact {
  readonly id: string;
  readonly category: string;
  readonly statement: string;
  readonly metricValue?: number | null;
  readonly metricUnit?: string | null;
  readonly metricContext?: string | null;
}

export interface GroundingDeterministicInput {
  readonly job: {
    readonly id: string;
    readonly title: string;
    readonly companyName: string;
    readonly description: string;
    readonly location: string | null;
    readonly employmentType: string | null;
    readonly seniority: string | null;
    /**
     * The posting's own published compensation, verbatim. It is text rather
     * than a number so a model can quote what the employer published and cannot
     * convert, annualise, or otherwise compute a figure of its own.
     */
    readonly salaryText: string | null;
    readonly skills: readonly string[];
    readonly requirements: readonly string[];
    readonly preferredQualifications: readonly string[];
  };
  readonly match: {
    readonly score: number;
    readonly verdict: string;
    readonly confidence: string;
    readonly modelVersion: string;
    readonly strengths: readonly string[];
    readonly gaps: readonly string[];
    readonly blockers: readonly string[];
    readonly rejectionRisks: readonly string[];
    readonly recommendedAction: string;
    readonly dimensionDetails: readonly string[];
    readonly requirementStatements: readonly string[];
  };
  /** Profile records the subscriber entered. Evidence for identity, never for a claim. */
  readonly profileIdentity: {
    readonly name: string;
    readonly headline: string | null;
    readonly currentRoleTitle: string | null;
    readonly totalYearsExperience: number | null;
    readonly employers: readonly string[];
    readonly employmentTitles: readonly string[];
    readonly institutions: readonly string[];
    readonly certifications: readonly string[];
    readonly skills: readonly string[];
    readonly industries: readonly string[];
    readonly locations: readonly string[];
  };
  /** Identifiers the model may cite. Anything outside this set is rejected. */
  readonly admissibleFactIds: readonly string[];
}

// ---------------------------------------------------------------------------
// The original placeholder contract
// ---------------------------------------------------------------------------

/**
 * The database-shaped truth gate summary.
 *
 * Kept because it is the shape `public.job_matches` and the Application Pack
 * tables already record. `truthGateFromGrounding` derives it from the per-claim
 * report, so the two can never disagree.
 */
export interface TruthGateResult {
  readonly status: 'not_evaluated' | 'passed' | 'rejected' | 'needs_review';
  readonly unsupportedClaimIds: readonly string[];
  readonly verifiedFactIds: readonly string[];
}

/**
 * The pre-registry request shape.
 *
 * A caller that only needs "give me a validated object for this schema" can keep
 * using it; `AiStructuredGenerateRequest` is what a provider implements. Both
 * carry the same four guarantees: trusted instructions built in code, untrusted
 * inputs delimited, an explicit admissible-fact list, and a validator applied to
 * whatever comes back.
 */
export interface AiGenerationRequest<TOutput> {
  readonly task: AiTaskKind;
  readonly model: string;
  readonly promptVersion: string;
  readonly trustedInstructions: readonly string[];
  readonly untrustedInputs: readonly UntrustedSourceContent[];
  readonly verifiedFactIds: readonly string[];
  readonly outputSchemaName: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly validateOutput: (value: unknown) => TOutput;
}

/**
 * The pre-registry result shape: the validated output plus the provenance a
 * metering or audit path needs, in the envelope the existing tables expect.
 */
export interface AiGenerationResult<TOutput> {
  readonly output: TOutput;
  readonly provider: AiProviderKind;
  readonly model: string;
  readonly promptVersion: string;
  readonly usage: AiUsage;
  readonly truthGate: TruthGateResult;
}

// ---------------------------------------------------------------------------
// Task output schemas
// ---------------------------------------------------------------------------

/**
 * The opportunity report.
 *
 * There is no numeric score field and no confidence field on purpose: score and
 * confidence are computed by `@hanaply/matching` and quoted, never estimated.
 * `verdict` restates the deterministic verdict rather than choosing one, which
 * the grounding gate and the prompt both enforce.
 */
export interface OpportunityAnalysis {
  readonly verdict: {
    readonly restatesMatchVerdict: boolean;
    readonly summary: string;
  };
  readonly whyInteresting: readonly string[];
  readonly strongestEvidence: readonly {
    readonly factId: string;
    readonly insight: string;
  }[];
  readonly transferableStrengths: readonly string[];
  readonly gaps: readonly string[];
  readonly hardBlockers: readonly string[];
  readonly rejectionRisks: readonly string[];
  readonly careerDirection: readonly string[];
  readonly salaryAndLocationConcerns: readonly string[];
  readonly whatToEmphasise: readonly string[];
  /** Claims the member must not make. Rendered wherever this report is shown. */
  readonly whatNotToClaim: readonly string[];
  readonly recommendedNextAction: string;
  readonly applicationStrategy: readonly string[];
  readonly interviewStrategy: readonly string[];
}

export interface ApplicationArtifactDraft {
  readonly kind:
    | 'resume'
    | 'cover_letter'
    | 'strategy'
    | 'requirement_map'
    | 'recruiter_message'
    | 'interview_prep';
  readonly title: string;
  readonly sections: readonly {
    readonly heading: string;
    /** Statements the model asserts about the member. Every one needs a cited fact. */
    readonly paragraphs: readonly string[];
  }[];
  /** Exactly the confirmed facts whose statements this draft quotes. */
  readonly evidenceFactIds: readonly string[];
}

/**
 * Coaching output.
 *
 * `facts` and `suggestions` are separate arrays with separate shapes so an
 * inference cannot be presented as a statement about the member: an entry in
 * `facts` is only valid with the confirmed fact identifiers that support it,
 * and an entry in `suggestions` must declare that it is an inference.
 */
export interface CoachingResponse {
  readonly facts: readonly {
    readonly statement: string;
    readonly evidenceFactIds: readonly string[];
  }[];
  readonly suggestions: readonly {
    readonly kind: 'inference';
    readonly statement: string;
    readonly rationale: string;
  }[];
  readonly questionsToConfirm: readonly string[];
  readonly nextSteps: readonly string[];
}

// ---------------------------------------------------------------------------
// Schema construction
// ---------------------------------------------------------------------------

/**
 * Wraps a Zod schema with its wire representation.
 *
 * `io: 'output'` is deliberate: the JSON Schema describes what a valid parsed
 * value looks like, so a provider cannot be told a field is optional when the
 * validator requires it. `$schema` is stripped because strict structured-output
 * endpoints reject unknown top-level keys.
 */
export function defineAiSchema<TSchema extends z.ZodType>(
  schemaName: string,
  schema: TSchema,
): AiStructuredSchema<z.output<TSchema>> {
  const generated = toJsonSchemaDocument(schema);
  return {
    schemaName,
    schema: schema as unknown as z.ZodType<z.output<TSchema>>,
    jsonSchema: generated,
  };
}

function toJsonSchemaDocument(schema: z.ZodType): JsonSchemaDocument {
  // `z.toJSONSchema` is the only supported direction: a hand-written document
  // drifts from the Zod validator, and a drifting wire schema is a truth-gate
  // hole rather than a formatting bug. `io: 'output'` describes what a valid
  // parsed value looks like, so a provider is never told a required field is
  // optional. `$schema` is dropped because strict structured-output endpoints
  // reject unknown top-level keys.
  const document: unknown = z.toJSONSchema(schema, {
    io: 'output',
    unrepresentable: 'any',
    override: (context) => {
      if (context.zodSchema._zod.def.type === 'date') {
        context.jsonSchema.type = 'string';
        context.jsonSchema.format = 'date-time';
      }
    },
  });
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error('An AI output schema must describe a JSON object');
  }
  const { $schema: ignored, ...rest } = document as Record<string, JsonValue>;
  void ignored;
  return rest;
}
