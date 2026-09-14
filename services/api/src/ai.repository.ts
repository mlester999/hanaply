import type { AiProvider } from '@hanaply/ai';
import type { ApiEnvironment } from '@hanaply/config';
import {
  applicationPackDetailSchema,
  careerProfileDetailSchema,
  careerProfileDirectorySchema,
  confirmedCareerEvidenceSchema,
  jobDetailSchema,
  usageSummarySchema,
  type ApplicationArtifactKind,
  type ApplicationPackDetail,
  type CareerProfileDetail,
  type CareerProfileDirectory,
  type ConfirmedCareerEvidence,
  type JobDetail,
  type UsageSummary,
} from '@hanaply/contracts';
import { createServiceDatabaseClient } from '@hanaply/database';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AppError } from './app-error.js';
import { AI_PROVIDER_TOKEN, API_ENVIRONMENT } from './tokens.js';

/**
 * Columns of `public.opportunity_analyses` this module reads back.
 *
 * The cache is keyed on the evidence fingerprint, so a member who confirms or
 * rejects a fact gets a different row rather than stale reasoning. Nothing here
 * writes to that table directly: `record_opportunity_analysis` does, through the
 * same `confirmed_fact_ids` check the artifact writers use.
 */
const storedAnalysisRowSchema = z.object({
  id: z.uuid(),
  analysis: z.record(z.string(), z.unknown()),
  cited_fact_ids: z.array(z.uuid()),
  created_at: z.iso.datetime({ offset: true }),
});

export const storedAnalysisSchema = z.object({
  id: z.uuid(),
  analysis: z.record(z.string(), z.unknown()),
  citedFactIds: z.array(z.uuid()),
  createdAt: z.iso.datetime({ offset: true }),
});

export type StoredAnalysis = z.infer<typeof storedAnalysisSchema>;

export const coachTopicWireSchema = z.enum([
  'general',
  'career_strategy',
  'resume',
  'profile',
  'skills',
  'job_search',
  'interview',
  'application',
]);

export const coachConversationRowSchema = z.object({
  id: z.uuid(),
  careerProfileId: z.uuid().nullable(),
  title: z.string().max(160),
  topic: coachTopicWireSchema,
  status: z.enum(['open', 'archived']),
  provider: z.string().max(120).nullable(),
  model: z.string().max(120).nullable(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const coachMessageRowSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  role: z.enum(['user', 'assistant']),
  body: z.string().max(8_000),
  facts: z.array(
    z.object({ statement: z.string().max(2_000), evidenceFactIds: z.array(z.uuid()).max(12) }),
  ),
  suggestions: z.array(
    z.object({
      kind: z.literal('inference'),
      statement: z.string().max(2_000),
      rationale: z.string().max(600),
    }),
  ),
  citedFactIds: z.array(z.uuid()),
  createdAt: z.iso.datetime({ offset: true }),
});

export const coachConversationDetailRowSchema = z.object({
  conversation: coachConversationRowSchema,
  messages: z.array(coachMessageRowSchema),
});

export type CoachConversationRow = z.infer<typeof coachConversationRowSchema>;
export type CoachMessageRow = z.infer<typeof coachMessageRowSchema>;
export type CoachConversationDetailRow = z.infer<typeof coachConversationDetailRowSchema>;

/**
 * The pack generation context as `generate_application_pack_artifacts` returns
 * it. The nested profile, evidence, and match are validated by `AiService`
 * against the same schemas the deterministic generator uses, so both paths read
 * one shape.
 */
export const packGenerationContextRowSchema = z.object({
  pack: z.record(z.string(), z.unknown()),
  job: z.record(z.string(), z.unknown()),
  applyUrl: z.string().max(1_000),
  artifacts: z.array(z.record(z.string(), z.unknown())),
  match: z.unknown(),
  evidence: z.array(z.record(z.string(), z.unknown())),
  profile: z.record(z.string(), z.unknown()),
  requestedKinds: z.array(z.string()),
  style: z.string().nullable(),
  finalized: z.boolean(),
});

export type PackGenerationContextRow = z.infer<typeof packGenerationContextRowSchema>;

interface RpcOutcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

interface TableOutcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/**
 * Maps the SQLSTATEs the AI-layer functions raise onto the public error
 * envelope, using the same codes as the rest of the schema: 42501 for a missing
 * actor or a profile the caller does not own, 22023 for inadmissible input
 * (including a citation outside the confirmed ledger), and P0002 for a missing
 * conversation, job, or profile.
 */
export function aiError(error: { code?: string; message: string }, fallback: string): AppError {
  switch (error.code) {
    case '42501':
      return new AppError({
        code: 'FORBIDDEN',
        status: 403,
        message: error.message.replace(/^.*?:\s*/u, '') || fallback,
      });
    case '22023':
    case '23514':
      return new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: error.message.replace(/^.*?:\s*/u, '') || fallback,
      });
    case 'P0002':
      return new AppError({
        code: 'NOT_FOUND',
        status: 404,
        message: error.message.replace(/^.*?:\s*/u, '') || 'Record not found',
      });
    case '23505':
      return new AppError({
        code: 'CONFLICT',
        status: 409,
        message: 'That coach conversation changed in another session. Reload and try again.',
      });
    default:
      return new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message: fallback });
  }
}

/**
 * Maps one `coach_conversations` row onto the shape the contract publishes.
 *
 * The table and the two RPCs that return it are snake_case (`career_profile_id`,
 * `message_count`, `last_message_at`, `created_at`, `updated_at`); the published
 * schema is camelCase. Nothing did that translation, so every conversation row
 * failed validation: the directory silently dropped all of them (it filters with
 * `flatMap`, so the coach index always said "No coach threads yet"), and opening
 * a thread answered 503 "the coach service is not answering right now" even
 * though the row had been written.
 */
function mapCoachConversationRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const value = row as Record<string, unknown>;
  return {
    id: value.id,
    careerProfileId: value.careerProfileId ?? value.career_profile_id ?? null,
    title: value.title,
    topic: value.topic,
    status: value.status,
    provider: value.provider ?? null,
    model: value.model ?? null,
    messageCount: value.messageCount ?? value.message_count ?? 0,
    lastMessageAt: value.lastMessageAt ?? value.last_message_at ?? null,
    createdAt: value.createdAt ?? value.created_at,
    updatedAt: value.updatedAt ?? value.updated_at,
  };
}

/**
 * Maps one `coach_messages` row onto the shape the contract publishes.
 *
 * `append_coach_message` returns the table row itself, so it is snake_case
 * (`cited_fact_ids`, `created_at`) while `coachMessageRowSchema` is camelCase.
 * Without this translation every appended message failed validation and the
 * caller answered 503 "the coach message could not be stored" — after the row
 * had in fact been written, which made a send look like a total failure while
 * the member's text was already in the thread.
 */
function mapCoachMessageRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const value = row as Record<string, unknown>;
  return {
    id: value.id,
    sequence: value.sequence,
    role: value.role,
    body: value.body,
    facts: value.facts ?? [],
    suggestions: value.suggestions ?? [],
    citedFactIds: value.citedFactIds ?? value.cited_fact_ids ?? [],
    createdAt: value.createdAt ?? value.created_at,
  };
}

/**
 * Maps the `coach_conversation_detail` payload onto the shape the contract publishes.
 *
 * The function returns a *flat* object — `jsonb_build_object('id', …, 'messages',
 * …)` in `20260924090000_ai_layer.sql`, already camelCase — while
 * `coachConversationDetailRowSchema` is `{ conversation, messages }`. Spreading
 * the payload and reassigning only `conversation` therefore produced an object
 * with no `conversation` key at all: the schema rejected it, `openCoachConversation`
 * answered 503, and the browser stayed on the coach index. Nesting the
 * conversation fields under `conversation` and keeping `messages` beside them is
 * the whole translation; `updatedAt` is not part of the detail contract and is
 * dropped by the schema.
 */
function mapCoachConversationDetail(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const value = row as Record<string, unknown>;
  return {
    conversation: mapCoachConversationRow(value.conversation ?? value),
    messages: Array.isArray(value.messages) ? value.messages.map(mapCoachMessageRow) : [],
  };
}

const uuidRowSchema = z.uuid();

/** One row of `public.ai_invocations`, as recorded and never as read back. */
export interface AiInvocationRecord {
  readonly userId: string;
  readonly careerProfileId: string | null;
  readonly operation:
    | 'opportunity_analysis'
    | 'artifact_generation'
    | 'coach_message'
    | 'profile_review'
    | 'resume_feedback'
    | 'interview_preparation';
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly requestId: string;
  readonly outcome:
    | 'succeeded'
    | 'schema_rejected'
    | 'grounding_rejected'
    | 'provider_error'
    | 'timeout'
    | 'rate_limited'
    | 'disabled';
  readonly rejectionReason: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly attempt: number;
  readonly cached: boolean;
}

/**
 * The AI layer's database boundary.
 *
 * Every function it calls is service-role only, and every response is validated
 * with the shared contract schemas before it leaves this class, so a database
 * change can never widen the API surface silently. Two reads are plain table
 * reads rather than functions — the cached analysis row and the coach directory
 * — because the migration that introduced the AI tables exposes no reader for
 * either, and the subscriber-facing rule is already expressed by the columns
 * themselves: the analysis is looked up by its full unique key, and the
 * conversation list is filtered on the caller's own `user_id`.
 */
@Injectable()
export class AiRepository {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AI_PROVIDER_TOKEN) private readonly provider: AiProvider,
  ) {}

  /** Exposed so `AiService` can describe the provider without a second source. */
  get aiProvider(): AiProvider {
    return this.provider;
  }

  private get client() {
    const url = this.environment.SUPABASE_URL;
    const serviceRoleKey = this.environment.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'The AI service is not configured',
      });
    }
    return createServiceDatabaseClient(url, serviceRoleKey);
  }

  /**
   * The AI functions declare nullable and defaulted arguments that PostgreSQL
   * does not record as nullable, so the generated argument types cannot express
   * "not supplied". This is the single narrowing at the database boundary; the
   * response is still validated with the shared Zod schemas.
   */
  private callRpc(name: string, args: Record<string, unknown>): PromiseLike<RpcOutcome> {
    const rpc = this.client.rpc.bind(this.client) as unknown as (
      functionName: string,
      parameters: Record<string, unknown>,
    ) => PromiseLike<RpcOutcome>;
    return rpc(name, args);
  }

  private async rpc<T>(
    call: () => PromiseLike<RpcOutcome>,
    parse: (value: unknown) => T | null,
    failureMessage: string,
  ): Promise<T> {
    const { data, error } = await call();
    if (error) throw aiError(error, failureMessage);
    const parsed = parse(data);
    if (parsed === null) {
      throw new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message: failureMessage });
    }
    return parsed;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** The opportunity as the subscriber's own read model returns it, match included. */
  /**
   * The opportunity as the subscriber's own read model returns it, match included.
   *
   * The argument names have to match the SQL function exactly: `job_detail`
   * declares `target_career_profile_id`, and PostgREST resolves a function by
   * its argument names, so `requested_career_profile_id` — which belongs to
   * `career_insights`, a different function — made every call fail with
   * PGRST202. That took the coach's job context, the AI opportunity analysis,
   * and AI-assisted pack generation down with it, each answering 503
   * "the AI service is unavailable".
   */
  async jobDetail(
    actorUserId: string,
    jobId: string,
    careerProfileId: string | null,
  ): Promise<JobDetail> {
    return this.rpc(
      () =>
        this.callRpc('job_detail', {
          actor_user_id: actorUserId,
          target_job_id: jobId,
          target_career_profile_id: careerProfileId,
        }),
      (value) => jobDetailSchema.safeParse(value).data ?? null,
      'The opportunity could not be read for analysis',
    );
  }

  async careerProfile(actorUserId: string, profileId: string): Promise<CareerProfileDetail> {
    return this.rpc(
      () =>
        this.callRpc('career_profile_detail', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
        }),
      (value) => careerProfileDetailSchema.safeParse(value).data ?? null,
      'Your career profile could not be read',
    );
  }

  /**
   * The caller's profiles, so an operation that was not given a profile can
   * resolve the primary one exactly as the rest of the dashboard does.
   */
  async careerProfileDirectory(actorUserId: string): Promise<CareerProfileDirectory> {
    return this.rpc(
      () => this.callRpc('career_profile_directory', { actor_user_id: actorUserId }),
      (value) => careerProfileDirectorySchema.safeParse(value).data ?? null,
      'Your career profiles could not be read',
    );
  }

  async confirmedEvidence(
    actorUserId: string,
    profileId: string,
  ): Promise<ConfirmedCareerEvidence> {
    return this.rpc(
      () =>
        this.callRpc('confirmed_career_evidence', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
        }),
      (value) => confirmedCareerEvidenceSchema.safeParse(value).data ?? null,
      'Your confirmed career facts could not be read',
    );
  }

  /**
   * The cached analysis for exactly this evidence, or null.
   *
   * The lookup repeats the unique key of `opportunity_analyses`, so a hit can
   * only ever be a row written for the same profile, job, provider, model,
   * prompt version, and evidence fingerprint.
   */
  async storedAnalysis(
    actorUserId: string,
    profileId: string,
    jobId: string,
    key: {
      provider: string;
      model: string;
      promptVersion: string;
      evidenceFingerprint: string;
    },
  ): Promise<StoredAnalysis | null> {
    const result: TableOutcome = await this.client
      .from('opportunity_analyses')
      .select('id, analysis, cited_fact_ids, created_at')
      .eq('user_id', actorUserId)
      .eq('career_profile_id', profileId)
      .eq('job_id', jobId)
      .eq('provider', key.provider)
      .eq('model', key.model)
      .eq('prompt_version', key.promptVersion)
      .eq('evidence_fingerprint', key.evidenceFingerprint)
      .maybeSingle();
    if (result.error) throw aiError(result.error, 'The stored analysis could not be read');
    const parsed = storedAnalysisRowSchema.safeParse(result.data);
    if (!parsed.success) return null;
    return {
      id: parsed.data.id,
      analysis: parsed.data.analysis,
      citedFactIds: parsed.data.cited_fact_ids,
      createdAt: parsed.data.created_at,
    };
  }

  /** The subscriber's coach threads, newest activity first. */
  async coachConversations(actorUserId: string): Promise<readonly CoachConversationRow[]> {
    const result: TableOutcome = await this.client
      .from('coach_conversations')
      .select(
        'id, career_profile_id, title, topic, status, provider, model, message_count, last_message_at, created_at, updated_at',
      )
      .eq('user_id', actorUserId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (result.error) throw aiError(result.error, 'Your coach conversations could not be read');
    const rows = Array.isArray(result.data) ? result.data : [];
    return rows.flatMap((row) => {
      if (row === null || typeof row !== 'object') return [];
      const parsed = coachConversationRowSchema.safeParse(mapCoachConversationRow(row));
      return parsed.success ? [parsed.data] : [];
    });
  }

  async coachConversationDetail(
    actorUserId: string,
    conversationId: string,
  ): Promise<CoachConversationDetailRow> {
    return this.rpc(
      () =>
        this.callRpc('coach_conversation_detail', {
          actor_user_id: actorUserId,
          target_conversation_id: conversationId,
        }),
      (value) =>
        coachConversationDetailRowSchema.safeParse(mapCoachConversationDetail(value)).data ?? null,
      'That coach conversation could not be read',
    );
  }

  /**
   * The metered quota the plan grants for one feature, and what is left of it.
   *
   * Read from `usage_summary`, the same source the usage surface shows, so the
   * API cannot refuse a generation on a limit the member cannot see.
   */
  async usageFor(
    actorUserId: string,
    feature: 'ai_analysis' | 'coach_message',
  ): Promise<{ used: number; limit: number; remaining: number } | null> {
    const summary: UsageSummary = await this.rpc(
      () => this.callRpc('usage_summary', { actor_user_id: actorUserId }),
      (value) => usageSummarySchema.safeParse(value).data ?? null,
      'Your usage could not be read',
    );
    return summary.items.find((item) => item.feature === feature) ?? null;
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Records one model call, successfully or not.
   *
   * There is no prompt or completion text in this row by construction: the
   * function's own signature has nowhere to put one. A rejection is recorded as
   * a rejection rather than dropped, because a rising refusal rate is the signal
   * that a prompt or a model has regressed.
   */
  async recordInvocation(record: AiInvocationRecord): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('record_ai_invocation', {
          actor_user_id: record.userId,
          target_career_profile_id: record.careerProfileId,
          requested_operation: record.operation,
          requested_provider: record.provider,
          requested_model: record.model,
          requested_prompt_version: record.promptVersion,
          requested_request_id: record.requestId,
          requested_outcome: record.outcome,
          requested_rejection_reason: record.rejectionReason,
          requested_input_tokens: record.inputTokens,
          requested_output_tokens: record.outputTokens,
          requested_latency_ms: record.latencyMs,
          requested_attempt: record.attempt,
          requested_cached: record.cached,
        }),
      (value) => uuidRowSchema.safeParse(value).data ?? null,
      'The AI invocation could not be recorded',
    );
  }

  async recordAnalysis(input: {
    userId: string;
    careerProfileId: string;
    jobId: string;
    provider: string;
    model: string;
    promptVersion: string;
    matchModelVersion: string;
    evidenceFingerprint: string;
    analysis: Record<string, unknown>;
    citedFactIds: readonly string[];
  }): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('record_opportunity_analysis', {
          actor_user_id: input.userId,
          target_career_profile_id: input.careerProfileId,
          target_job_id: input.jobId,
          requested_provider: input.provider,
          requested_model: input.model,
          requested_prompt_version: input.promptVersion,
          requested_match_model_version: input.matchModelVersion,
          requested_evidence_fingerprint: input.evidenceFingerprint,
          requested_analysis: input.analysis,
          requested_cited_fact_ids: [...input.citedFactIds],
        }),
      (value) => uuidRowSchema.safeParse(value).data ?? null,
      'The analysis could not be stored',
    );
  }

  async openCoachConversation(input: {
    userId: string;
    careerProfileId: string | null;
    title: string;
    topic: string;
    provider: string | null;
    model: string | null;
  }): Promise<CoachConversationRow> {
    return this.rpc(
      () =>
        this.callRpc('open_coach_conversation', {
          actor_user_id: input.userId,
          target_career_profile_id: input.careerProfileId,
          requested_title: input.title,
          requested_topic: input.topic,
          requested_provider: input.provider,
          requested_model: input.model,
        }),
      (value) => coachConversationRowSchema.safeParse(mapCoachConversationRow(value)).data ?? null,
      'The coach conversation could not be opened',
    );
  }

  /**
   * Appends one message.
   *
   * `facts` and `suggestions` are stored in separate columns, and the table's
   * check constraint refuses an assistant message that asserts facts without
   * citing confirmed fact ids, so an uncited claim cannot be persisted even by
   * this call: the database refuses it after `packages/ai` has already refused
   * it.
   */
  async appendCoachMessage(input: {
    userId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    body: string;
    facts: readonly { statement: string; evidenceFactIds: readonly string[] }[];
    suggestions: readonly { kind: 'inference'; statement: string; rationale: string }[];
    citedFactIds: readonly string[];
    provider: string | null;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  }): Promise<CoachMessageRow> {
    return this.rpc(
      () =>
        this.callRpc('append_coach_message', {
          actor_user_id: input.userId,
          target_conversation_id: input.conversationId,
          requested_role: input.role,
          requested_body: input.body,
          requested_facts: input.facts.map((fact) => ({
            statement: fact.statement,
            evidenceFactIds: [...fact.evidenceFactIds],
          })),
          requested_suggestions: input.suggestions.map((suggestion) => ({
            kind: suggestion.kind,
            statement: suggestion.statement,
            rationale: suggestion.rationale,
          })),
          requested_cited_fact_ids: [...input.citedFactIds],
          requested_provider: input.provider,
          requested_model: input.model,
          requested_input_tokens: input.inputTokens,
          requested_output_tokens: input.outputTokens,
        }),
      (value) => coachMessageRowSchema.safeParse(mapCoachMessageRow(value)).data ?? null,
      'The coach message could not be stored',
    );
  }

  /** The pack generation context, exactly as the deterministic path reads it. */
  async packGenerationContext(
    actorUserId: string,
    packId: string,
    kinds: readonly ApplicationArtifactKind[],
    style: string | null,
    requestId: string,
  ): Promise<PackGenerationContextRow> {
    return this.rpc(
      () =>
        this.callRpc('generate_application_pack_artifacts', {
          actor_user_id: actorUserId,
          target_pack_id: packId,
          requested_kinds: [...kinds],
          requested_style: style,
          action_request_id: requestId,
        }),
      (value) => packGenerationContextRowSchema.safeParse(value).data ?? null,
      'The Application Pack generation context could not be read',
    );
  }

  /**
   * Persists one artifact through the existing writer.
   *
   * This is the same `record_application_artifact` the deterministic generator
   * uses, so `app_private.validate_artifact_evidence` applies to model output
   * exactly as it applies to template output: an artifact citing a fact the
   * subscriber has not confirmed is refused by the database.
   */
  async recordApplicationArtifact(
    actorUserId: string,
    packId: string,
    draft: {
      kind: ApplicationArtifactKind;
      style: string;
      title: string;
      plainText: string;
      content: unknown;
      evidenceFactIds: readonly string[];
    },
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('record_application_artifact', {
          actor_user_id: actorUserId,
          target_pack_id: packId,
          artifact_input: {
            kind: draft.kind,
            style: draft.style,
            title: draft.title,
            content: draft.content,
            plainText: draft.plainText,
            evidenceFactIds: [...draft.evidenceFactIds],
          },
          action_request_id: requestId,
        }),
      (value) => uuidRowSchema.safeParse(value).data ?? null,
      'The generated artifact could not be recorded',
    );
  }

  async applicationPackDetail(actorUserId: string, packId: string): Promise<ApplicationPackDetail> {
    return this.rpc(
      () =>
        this.callRpc('application_pack_detail', {
          actor_user_id: actorUserId,
          target_pack_id: packId,
        }),
      (value) => applicationPackDetailSchema.safeParse(value).data ?? null,
      'The Application Pack could not be read',
    );
  }
}
