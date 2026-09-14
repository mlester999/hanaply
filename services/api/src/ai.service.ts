import {
  buildArtifactRequest,
  buildCoachRequest,
  buildOpportunityAnalysisRequest,
  isDegraded,
  isDeterministicOnly,
  promptVersion,
  truthGateFromGrounding,
  type AiProvider,
  type AiProviderError,
  type AiProviderHealth,
  type AiResponseMetadata,
  type CoachingResponse,
  type GroundingFact,
  type GroundingReport,
  type OpportunityAnalysis,
} from '@hanaply/ai';
import {
  aiNotEvaluatedGrounding,
  defaultPackArtifactStyle,
  generateApplicationPackAiRequestSchema,
  openCoachConversationRequestSchema,
  opportunityAnalysisReportSchema,
  opportunityAnalysisRequestSchema,
  sendCoachMessageRequestSchema,
  type AiDeterministicMatch,
  type AiGroundingReport,
  type AiProvenance,
  type AiStatus,
  type ApplicationArtifactKind,
  type CoachConversation,
  type CoachConversationDetail,
  type CoachConversationDirectory,
  type CoachMessage,
  type JobDetail,
  type OpportunityAnalysisReport,
  type OpportunityAnalysisResponse,
  type PackArtifactStyle,
  type PackGenerationAi,
  type PackGenerationJob,
} from '@hanaply/contracts';
import type { MatchingCareerProfile, MatchingJob, MatchResult } from '@hanaply/matching';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { AppError, toValidationDetails } from './app-error.js';
import { AiMeter, type MeterDecision } from './ai-meter.js';
import {
  AiRepository,
  type CoachConversationDetailRow,
  type CoachConversationRow,
} from './ai.repository.js';
import type { PackGenerationContext } from './career.repository.js';
import type { AuthenticatedRequest } from './http.js';
import {
  generatePackArtifacts,
  packGenerationInputSchema,
  readPackMatchSnapshot,
  type PackArtifactDraft,
  type PackMatchSnapshot,
} from './pack-generation.js';
import { AI_PROVIDER_TOKEN } from './tokens.js';
/**
 * The AI service.
 *
 * It exists to hold one rule in one place: the model may never originate a
 * factual claim about the member, and no surface may present its output as
 * anything other than what it is. Three consequences shape every method here.
 *
 *   1. Deterministic work is read, never recomputed. The match score, the
 *      verdict, the confidence, and the requirement mapping all come from the
 *      stored match result and are quoted. Nothing in this file calls the
 *      matching engine, and no AI output can reach a score.
 *   2. Generated output is never separated from its grounding report. Every
 *      response that can carry model text carries the per-claim verdicts and the
 *      provider provenance beside it, so an inference cannot be rendered as a
 *      fact by a client that forgot to ask.
 *   3. The deterministic path is the default and the fallback. When no provider
 *      is configured the routes answer normally, say so, and point at the
 *      deterministic analysis rather than failing or mislabelling.
 */

/** The deterministic fallbacks named in the status response and the interface. */
const deterministicAlternatives: readonly string[] = [
  'Your match score, verdict, confidence, and requirement mapping, computed by the matching engine.',
  'The deterministic opportunity brief: strengths, gaps, blockers, rejection risks, and the recommended action.',
  'Application Pack artifacts composed from your confirmed career facts.',
  'Career insights, profile strength, and pipeline analytics.',
  'Your truth ledger, which records what you have confirmed and what a claim would need.',
];

const allArtifactKinds: readonly ApplicationArtifactKind[] = [
  'resume',
  'cover_letter',
  'strategy',
  'requirement_map',
  'recruiter_message',
  'interview_prep',
];

/** `plain_text` is capped at 60000 characters by the database. */
const maximumArtifactCharacters = 60_000;

const refusalCopy =
  'Hanaply refused the generated analysis because a statement in it was not supported by your confirmed facts. Nothing was stored, nothing was charged, and the refusal was recorded. The deterministic analysis above still applies in full.';

/**
 * A stable identifier for one logical operation.
 *
 * This is the idempotency key the meter is built on, and it mirrors the key
 * `create_application_pack` derives for a pack: it comes from the identity of
 * the operation — who asked, about what, and under which evidence — and never
 * from the request, so a retry, a timeout, or a resubmitted form resolves to the
 * same key. It contains no prompt, no completion, and no resume text: only
 * identifiers and a digest.
 */
export function operationKey(parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return `${parts[0] ?? 'op'}:${digest.slice(0, 40)}`;
}

/** Content digest of a message body, so a resubmission is the same operation. */
export function bodyDigest(body: string): string {
  return createHash('sha256').update(body.trim()).digest('hex').slice(0, 40);
}

/**
 * The evidence fingerprint the analysis cache is keyed on.
 *
 * Confirming or rejecting a fact changes the sorted identifier list, and a new
 * match changes the score or the model version, so the cache is invalidated
 * rather than serving reasoning built on evidence the member has since changed.
 */
export function evidenceFingerprint(input: {
  factIds: readonly string[];
  score: number;
  matchModelVersion: string;
  profileId: string;
  jobId: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        facts: [...input.factIds].sort(),
        score: input.score,
        matchModelVersion: input.matchModelVersion,
        profileId: input.profileId,
        jobId: input.jobId,
      }),
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Deterministic inputs, read from what the engine already stored
// ---------------------------------------------------------------------------

/**
 * The confirmed ledger, in the shape the AI layer accepts as evidence.
 *
 * Only rows the member confirmed reach this function: it is fed from
 * `confirmed_career_evidence`, which the database defines as the ledger the
 * truth gate checks against. A candidate fact the member has not confirmed is
 * therefore not merely uncited, it is not present to be cited.
 */
export function groundingFacts(
  facts: readonly {
    id: string;
    category: string;
    statement: string;
    metricValue: number | null;
    metricUnit: string | null;
    metricContext: string | null;
  }[],
): readonly GroundingFact[] {
  return facts.map((fact) => ({
    id: fact.id,
    category: fact.category,
    statement: fact.statement,
    metricValue: fact.metricValue,
    metricUnit: fact.metricUnit,
    metricContext: fact.metricContext,
  }));
}

/**
 * The member as the matching engine describes them.
 *
 * Built from the stored career profile, so the model receives the same identity
 * block the deterministic generator would give it. `yearsExperience` is null
 * when the profile does not record one, which the prompt renders as an explicit
 * instruction not to state a number of years.
 */
export function matchingProfile(profile: {
  id: string;
  version: number;
  headline: string | null;
  summary: string | null;
  currentRoleTitle: string | null;
  careerLevel: MatchingCareerProfile['careerLevel'];
  yearsExperience: number | null;
  industries: readonly string[];
  targetRoleTitles: readonly string[];
  excludedRoleTitles: readonly string[];
  preferredEmploymentTypes: MatchingCareerProfile['preferredEmploymentTypes'];
  preferredWorkArrangement: MatchingCareerProfile['preferredWorkArrangement'];
  preferredLocations: readonly string[];
  openToInternational: boolean;
  openToRelocation: boolean;
  salaryExpectation: {
    minMinor: number | null;
    maxMinor: number | null;
    currency: string | null;
    period: MatchingCareerProfile['salaryPeriod'];
  } | null;
  skills: readonly {
    name: string;
    skillKind: string;
    isPrimary: boolean;
    proficiency: string | null;
  }[];
  employment: readonly {
    roleTitle: string;
    companyName: string;
    isCurrent: boolean;
    startDate: string;
    endDate: string | null;
    skills: readonly string[];
    highlights: readonly string[];
  }[];
}): MatchingCareerProfile {
  return {
    id: profile.id,
    version: profile.version,
    headline: profile.headline,
    summary: profile.summary,
    currentRoleTitle: profile.currentRoleTitle,
    careerLevel: profile.careerLevel,
    yearsExperience: profile.yearsExperience,
    industries: [...profile.industries],
    targetRoleTitles: [...profile.targetRoleTitles],
    excludedRoleTitles: [...profile.excludedRoleTitles],
    preferredEmploymentTypes: [...profile.preferredEmploymentTypes],
    preferredWorkArrangement: profile.preferredWorkArrangement,
    preferredLocations: [...profile.preferredLocations],
    openToInternational: profile.openToInternational,
    openToRelocation: profile.openToRelocation,
    salaryMinMinor: profile.salaryExpectation?.minMinor ?? null,
    salaryMaxMinor: profile.salaryExpectation?.maxMinor ?? null,
    salaryCurrency: profile.salaryExpectation?.currency ?? null,
    salaryPeriod: profile.salaryExpectation?.period ?? null,
    skills: profile.skills.map((skill) => ({
      name: skill.name,
      skillKind: skill.skillKind,
      isPrimary: skill.isPrimary,
      proficiency: skill.proficiency,
    })),
    employment: profile.employment.map((entry) => ({
      roleTitle: entry.roleTitle,
      companyName: entry.companyName,
      isCurrent: entry.isCurrent,
      startDate: entry.startDate,
      endDate: entry.endDate,
      skills: [...entry.skills],
      highlights: [...entry.highlights],
    })),
  };
}

/**
 * The dimension keys the matching engine defines. The shared job contract widens
 * the key to `string` because the stored snapshot is JSON; an unrecognised key
 * is dropped rather than passed off as a dimension the engine scored.
 */
const dimensionKeySchema = z.enum([
  'roleAlignment',
  'skillsCoverage',
  'seniorityAlignment',
  'experienceAlignment',
  'locationAlignment',
  'compensationAlignment',
  'employmentTypeAlignment',
  'careerDirection',
  'recency',
]);

/**
 * The frozen match snapshot, completed into the shape the AI layer's builders
 * take.
 *
 * The snapshot is the matching engine's own output, read from the stored match
 * result, so the score, the verdict, the confidence, and every dimension
 * contribution are quoted rather than recomputed. Two fields are added here and
 * nothing else: the profile identifier the snapshot does not carry, and the
 * dimension keys, which the shared job contract widens to `string` and the
 * matching engine types as a closed union.
 */
export function analysisMatch(
  snapshot: PackMatchSnapshot | null,
  careerProfileId: string,
): MatchResult | null {
  if (snapshot === null) return null;
  return {
    ...snapshot,
    careerProfileId,
    dimensions: snapshot.dimensions.flatMap((dimension) => {
      const key = dimensionKeySchema.safeParse(dimension.key);
      return key.success ? [{ ...dimension, key: key.data }] : [];
    }),
    dataQuality: {
      ...snapshot.dataQuality,
      // The unknowns are the dimension keys the engine could not judge. The
      // shared job contract widens them to `string`; a value the engine does not
      // define is dropped rather than reported as a dimension it recognised.
      unknowns: snapshot.dataQuality.unknowns.flatMap((unknown) => {
        const key = dimensionKeySchema.safeParse(unknown);
        return key.success ? [key.data] : [];
      }),
    },
  };
}

/** The posting as the engine describes it. The description is carried in full. */
export function matchingJob(detail: JobDetail): MatchingJob {
  return {
    id: detail.id,
    title: detail.title,
    companyName: detail.companyName,
    description: detail.description,
    employmentType: detail.employmentType,
    seniority: detail.seniority,
    remoteState: detail.remoteState,
    locationRaw: detail.locationRaw,
    city: detail.city,
    region: detail.region,
    countryCode: detail.countryCode,
    isPhilippines: detail.isPhilippines,
    salaryMinMinor: detail.salaryMinMinor,
    salaryMaxMinor: detail.salaryMaxMinor,
    salaryCurrency: detail.salaryCurrency,
    salaryPeriod: detail.salaryPeriod,
    skills: [...detail.skills],
    requirements: [...detail.requirements],
    preferredQualifications: [...detail.preferredQualifications],
    experienceYearsMin: detail.experienceYearsMin,
    experienceYearsMax: detail.experienceYearsMax,
    postedAt: detail.postedAt,
    lastSeenAt: detail.lastSeenAt,
    status: detail.status,
  };
}

// ---------------------------------------------------------------------------
// Contract mapping
// ---------------------------------------------------------------------------

function clamp(value: string, maximum: number): string {
  return value.length > maximum ? value.slice(0, maximum) : value;
}

function clampList(values: readonly string[], maximum: number): string[] {
  return values.map((value) => clamp(value, maximum));
}

/** The AI layer's per-claim report, expressed in the shared contract shape. */
export function contractGrounding(report: GroundingReport | null): AiGroundingReport {
  if (report === null) return { ...aiNotEvaluatedGrounding };
  return {
    status: report.status,
    unsupportedClaimIds: clampList(report.unsupportedClaimIds, 300),
    verifiedFactIds: clampList(report.verifiedFactIds, 80),
    admissibleFactIds: clampList(report.admissibleFactIds, 80),
    claims: report.claims.map((claim) => ({
      path: clamp(claim.path, 300),
      kind: claim.kind,
      text: clamp(claim.text, 600),
      status: claim.status,
      reason: claim.reason === null ? null : clamp(claim.reason, 500),
    })),
    rejections: report.rejections.map((rejection) => ({
      code: rejection.code,
      path: clamp(rejection.path, 300),
      detail: clamp(rejection.detail, 500),
    })),
    numericClaimsChecked: report.numericClaimsChecked,
    entityClaimsChecked: report.entityClaimsChecked,
    experienceClaimsChecked: report.experienceClaimsChecked,
  };
}

const notGeneratedProvenance: AiProvenance = Object.freeze({
  provider: null,
  model: null,
  promptVersion: null,
  generated: false,
  degraded: true,
  reason: null,
  inputTokens: null,
  outputTokens: null,
  latencyMs: null,
});

/** Provenance for a payload that exists, because a model produced it. */
function generatedProvenance(meta: AiResponseMetadata): AiProvenance {
  return {
    provider: meta.provider,
    model: clamp(meta.model, 120),
    promptVersion: clamp(meta.promptVersion, 60),
    generated: true,
    degraded: false,
    reason: null,
    inputTokens: meta.usage.inputTokens,
    outputTokens: meta.usage.outputTokens,
    latencyMs: meta.latencyMs,
  };
}

/**
 * Provenance for a payload that does not exist.
 *
 * `generated` is false and `degraded` is true, so no client can label the
 * response as model output, and the reason is the sentence the interface shows.
 */
function withheldProvenance(provider: AiProvider, reason: string): AiProvenance {
  return {
    ...notGeneratedProvenance,
    provider: provider.kind === 'disabled' ? null : provider.kind,
    model: null,
    reason: clamp(reason, 500),
  };
}

/** The analysis exactly as the model produced it, narrowed to the contract. */
export function contractAnalysis(analysis: OpportunityAnalysis): OpportunityAnalysisReport {
  return {
    verdict: {
      restatesMatchVerdict: analysis.verdict.restatesMatchVerdict,
      summary: clamp(analysis.verdict.summary, 2_000),
    },
    whyInteresting: clampList(analysis.whyInteresting, 600),
    strongestEvidence: analysis.strongestEvidence.map((entry) => ({
      factId: clamp(entry.factId, 80),
      insight: clamp(entry.insight, 600),
    })),
    transferableStrengths: clampList(analysis.transferableStrengths, 600),
    gaps: clampList(analysis.gaps, 600),
    hardBlockers: clampList(analysis.hardBlockers, 600),
    rejectionRisks: clampList(analysis.rejectionRisks, 600),
    careerDirection: clampList(analysis.careerDirection, 600),
    salaryAndLocationConcerns: clampList(analysis.salaryAndLocationConcerns, 600),
    whatToEmphasise: clampList(analysis.whatToEmphasise, 600),
    whatNotToClaim: clampList(analysis.whatNotToClaim, 600),
    recommendedNextAction: clamp(analysis.recommendedNextAction, 2_000),
    applicationStrategy: clampList(analysis.applicationStrategy, 600),
    interviewStrategy: clampList(analysis.interviewStrategy, 600),
  };
}

/**
 * Reads a stored analysis back into the contract shape.
 *
 * A stored row that no longer matches the schema is treated as absent rather
 * than rendered partially: a report the API cannot validate is a report it must
 * not present as grounded.
 */
export function storedAnalysisReport(value: unknown): OpportunityAnalysisReport | null {
  const parsed = opportunityAnalysisReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function deterministicMatchFrom(match: MatchResult | null): AiDeterministicMatch | null {
  if (match === null) return null;
  return {
    score: match.score,
    verdict: clamp(match.verdict, 60),
    confidence: clamp(match.confidence, 60),
    modelVersion: clamp(match.modelVersion, 60),
    recommendedAction: clamp(match.recommendedAction, 600),
  };
}

function contractConversation(row: CoachConversationRow): CoachConversation {
  return {
    id: row.id,
    careerProfileId: row.careerProfileId,
    title: clamp(row.title, 160),
    topic: row.topic,
    status: row.status,
    provider: row.provider === null ? null : clamp(row.provider, 120),
    model: row.model === null ? null : clamp(row.model, 120),
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function contractMessage(row: CoachConversationDetailRow['messages'][number]): CoachMessage {
  return {
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    body: clamp(row.body, 8_000),
    facts: row.facts.map((fact) => ({
      statement: clamp(fact.statement, 2_000),
      evidenceFactIds: [...fact.evidenceFactIds],
    })),
    suggestions: row.suggestions.map((suggestion) => ({
      kind: 'inference' as const,
      statement: clamp(suggestion.statement, 2_000),
      rationale: clamp(suggestion.rationale, 600),
    })),
    citedFactIds: [...row.citedFactIds],
    createdAt: row.createdAt,
  };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');

  constructor(
    @Inject(AiRepository) private readonly repository: AiRepository,
    @Inject(AI_PROVIDER_TOKEN) private readonly provider: AiProvider,
    @Inject(AiMeter) private readonly meter: AiMeter,
  ) {}

  private actor(request: AuthenticatedRequest): { userId: string; requestId: string } {
    if (!request.auth) {
      throw new AppError({
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
        message: 'Authentication is required',
      });
    }
    return { userId: request.auth.userId, requestId: request.id };
  }

  private validationError(
    message: string,
    issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[],
  ): AppError {
    return new AppError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message,
      details: toValidationDetails(issues),
    });
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * What the AI layer can do right now.
   *
   * The health check never throws, and the response carries no key, no base URL,
   * and no deployment name: a member-facing surface needs to know whether the
   * coach will answer and what still works if it will not, not how the
   * deployment is wired.
   */
  async status(): Promise<AiStatus> {
    const health: AiProviderHealth = await this.provider.healthCheck();
    const usable = this.available();
    return {
      configured: usable,
      provider: this.provider.kind,
      model: health.model === null ? null : clamp(health.model, 120),
      degraded: !usable,
      reason: usable ? null : clamp(this.unavailableReason(health), 500),
      state: usable ? 'available' : health.state === 'disabled' ? 'disabled' : 'degraded',
      // The capability set is always the three features. What changes is who
      // writes them: a model when `configured` is true, the deterministic engine
      // when it is not. Stated once here rather than inferred by each client.
      capabilities: {
        opportunityAnalysis: usable ? 'ai' : 'deterministic',
        coach: usable ? 'ai' : 'deterministic',
        artifactGeneration: 'deterministic',
      },
      deterministicAlternatives: [...deterministicAlternatives],
    };
  }

  /** True when a model may be asked to generate anything. */
  private available(): boolean {
    return !isDeterministicOnly(this.provider) && this.provider.model !== null;
  }

  private unavailableReason(health?: AiProviderHealth): string {
    if (!isDegraded(this.provider)) {
      return 'No AI provider is configured. Hanaply is running on its deterministic engine, and everything it produces is labelled deterministic rather than model-written.';
    }
    if (health?.reason != null && health.reason.trim() !== '') return health.reason;
    return 'AI generation is unavailable in this deployment, so Hanaply is running on its deterministic engine. Deterministic output is labelled deterministic and is never presented as model-written.';
  }

  // -------------------------------------------------------------------------
  // Opportunity analysis
  // -------------------------------------------------------------------------

  async analyzeOpportunity(
    request: AuthenticatedRequest,
    jobId: string,
    body: unknown,
  ): Promise<OpportunityAnalysisResponse> {
    const { userId, requestId } = this.actor(request);
    const parsed = opportunityAnalysisRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw this.validationError('The analysis request is invalid', parsed.error.issues);
    }
    return this.runAnalysis({
      userId,
      requestId,
      jobId,
      requestedProfileId: parsed.data.careerProfileId ?? null,
      refresh: parsed.data.refresh === true,
    });
  }

  /** The stored analysis, with no generation. Served by the read route. */
  async storedOpportunityAnalysis(
    request: AuthenticatedRequest,
    jobId: string,
    query: unknown,
  ): Promise<OpportunityAnalysisResponse> {
    const { userId } = this.actor(request);
    const parsed = opportunityAnalysisRequestSchema.safeParse(query ?? {});
    if (!parsed.success) {
      throw this.validationError('The analysis request is invalid', parsed.error.issues);
    }
    const profileId = await this.resolveProfileId(userId, parsed.data.careerProfileId ?? null);
    const context = await this.analysisContext(userId, jobId, profileId);
    if (context.match === null) {
      return this.deterministicOnlyAnalysis(jobId, profileId, null, [
        'This opportunity has no stored match result yet, so there is nothing deterministic for an analysis to be grounded in. Hanaply does not ask a model to invent a score. Open the opportunity page to have the matching engine analyse it first.',
      ]);
    }
    if (!this.available()) {
      return this.deterministicOnlyAnalysis(jobId, profileId, context.match, [
        this.unavailableReason(),
      ]);
    }
    const stored = await this.repository.storedAnalysis(userId, profileId, jobId, {
      provider: this.providerName(),
      model: this.modelName(),
      promptVersion,
      evidenceFingerprint: evidenceFingerprint({
        factIds: context.facts.map((fact) => fact.id),
        score: context.match.score,
        matchModelVersion: context.match.modelVersion,
        profileId,
        jobId,
      }),
    });
    const report = stored === null ? null : storedAnalysisReport(stored.analysis);
    if (stored === null || report === null) {
      return this.deterministicOnlyAnalysis(jobId, profileId, context.match, [
        'No stored analysis could be read for this opportunity and your current confirmed facts. Running the analysis replaces it.',
      ]);
    }
    return {
      jobId,
      careerProfileId: profileId,
      analysis: report,
      grounding: { ...aiNotEvaluatedGrounding },
      provenance: {
        ...notGeneratedProvenance,
        provider: this.provider.kind,
        model: this.modelName(),
        promptVersion,
        generated: true,
        degraded: false,
        reason: null,
      },
      cached: true,
      deterministicMatch: deterministicMatchFrom(context.match),
      refusal: null,
      generatedAt: stored.createdAt,
    };
  }

  private async runAnalysis(input: {
    userId: string;
    requestId: string;
    jobId: string;
    requestedProfileId: string | null;
    refresh: boolean;
  }): Promise<OpportunityAnalysisResponse> {
    const { userId, requestId, jobId, refresh } = input;
    const profileId = await this.resolveProfileId(userId, input.requestedProfileId);
    const context = await this.analysisContext(userId, jobId, profileId);

    if (context.match === null) {
      await this.recordInvocation({
        userId,
        profileId,
        requestKind: requestId,
        outcome: 'disabled',
        rejectionReason: 'No stored match result exists for this opportunity',
        meta: null,
      });
      return this.deterministicOnlyAnalysis(jobId, profileId, null, [
        'This opportunity has not been scored yet, so there is no deterministic analysis for a model to work from, and Hanaply does not ask a model to invent a score. Open the opportunity page to have the matching engine analyse it first.',
      ]);
    }

    const fingerprint = evidenceFingerprint({
      factIds: context.facts.map((fact) => fact.id),
      score: context.match.score,
      matchModelVersion: context.match.modelVersion,
      profileId,
      jobId,
    });
    const key = {
      provider: this.providerName(),
      model: this.modelName(),
      promptVersion,
      evidenceFingerprint: fingerprint,
    };

    // The cache is consulted first and unconditionally, so a repeat read of the
    // same evidence never reaches a provider and never consumes quota. A forced
    // refresh skips this step deliberately.
    if (!refresh) {
      const stored = await this.repository.storedAnalysis(userId, profileId, jobId, key);
      const report = stored === null ? null : storedAnalysisReport(stored.analysis);
      if (stored !== null && report !== null) {
        await this.recordInvocation({
          userId,
          profileId,
          requestKind: requestId,
          outcome: 'succeeded',
          rejectionReason: null,
          meta: null,
          cached: true,
        });
        return {
          jobId,
          careerProfileId: profileId,
          analysis: report,
          grounding: { ...aiNotEvaluatedGrounding },
          provenance: {
            ...notGeneratedProvenance,
            provider: this.provider.kind,
            model: key.model,
            promptVersion,
            generated: true,
            degraded: false,
            reason: null,
          },
          cached: true,
          deterministicMatch: deterministicMatchFrom(context.match),
          refusal: null,
          generatedAt: stored.createdAt,
        };
      }
    }

    // The deterministic path is the answer when no provider can be used. It is a
    // 200 with the degradation stated, never an error, and never generated text
    // relabelled as deterministic.
    if (!this.available()) {
      await this.recordInvocation({
        userId,
        profileId,
        requestKind: requestId,
        outcome: 'disabled',
        rejectionReason: this.unavailableReason(),
        meta: null,
      });
      return this.deterministicOnlyAnalysis(jobId, profileId, context.match, [
        this.unavailableReason(),
      ]);
    }

    // Entitlement is checked before generation, so a plan that does not include
    // the feature is refused with the allowance it actually grants, and nothing
    // is spent. The key is the operation identity, so a retry of this same
    // operation cannot consume a second unit.
    const meterKey = operationKey([
      'opportunity_analysis',
      userId,
      profileId,
      jobId,
      fingerprint,
      refresh ? requestId : 'first',
    ]);
    const decision: MeterDecision = await this.meter.consume({
      userId,
      feature: 'ai_analysis',
      idempotencyKey: meterKey,
      units: 1,
    });

    const analysisRequest = buildOpportunityAnalysisRequest({
      requestId,
      profile: context.profile,
      job: context.job,
      match: context.match,
      facts: context.facts,
    });
    const started = Date.now();
    const result = await this.provider.analyzeOpportunity(analysisRequest);
    const latencyMs = Date.now() - started;

    if (!result.ok) {
      await this.recordInvocation({
        userId,
        profileId,
        requestKind: requestId,
        // A truth-gate refusal arrives as a failed task carrying the report that
        // refused it. It is recorded as a grounding rejection rather than as the
        // provider error code the layer uses internally, because a rising
        // refusal rate is the signal an operator needs to see.
        outcome: result.grounding === null ? this.outcomeFor(result.error) : 'grounding_rejected',
        rejectionReason: clamp(result.error.message, 300),
        meta: null,
        latencyMs,
      });
      // Nothing was produced, so nothing is charged: the pending unit is
      // released rather than left standing against this operation.
      this.meter.release(meterKey);
      const refused = result.grounding !== null;
      return {
        jobId,
        careerProfileId: profileId,
        analysis: null,
        grounding: contractGrounding(result.grounding),
        provenance: withheldProvenance(
          this.provider,
          refused ? 'The generated analysis was refused by the truth gate.' : result.error.message,
        ),
        cached: false,
        deterministicMatch: deterministicMatchFrom(context.match),
        refusal: refused
          ? refusalCopy
          : `The analysis could not be generated. ${result.error.message} Nothing was stored and nothing was charged. The deterministic analysis above still applies in full.`,
        generatedAt: null,
      };
    }

    const grounding = result.result.grounding;
    if (truthGateFromGrounding(grounding).status !== 'passed') {
      await this.recordInvocation({
        userId,
        profileId,
        requestKind: requestId,
        outcome: 'grounding_rejected',
        rejectionReason: 'The generated analysis did not pass the truth gate',
        meta: result.result.meta,
        latencyMs,
      });
      this.meter.release(meterKey);
      return {
        jobId,
        careerProfileId: profileId,
        analysis: null,
        grounding: contractGrounding(grounding),
        provenance: withheldProvenance(
          this.provider,
          'The generated analysis did not pass the truth gate.',
        ),
        cached: false,
        deterministicMatch: deterministicMatchFrom(context.match),
        refusal: refusalCopy,
        generatedAt: null,
      };
    }

    const report = contractAnalysis(result.result.value as OpportunityAnalysis);
    await this.repository.recordAnalysis({
      userId,
      careerProfileId: profileId,
      jobId,
      provider: this.providerName(),
      model: this.modelName(),
      promptVersion,
      matchModelVersion: context.match.modelVersion,
      evidenceFingerprint: fingerprint,
      analysis: { ...report },
      citedFactIds: [...new Set(grounding.verifiedFactIds)],
    });
    await this.recordInvocation({
      userId,
      profileId,
      requestKind: requestId,
      outcome: 'succeeded',
      rejectionReason: null,
      meta: result.result.meta,
      latencyMs,
      charged: decision.charged,
    });
    this.logger.log(
      `ai.opportunity_analysis outcome=succeeded provider=${this.providerName()} model=${this.modelName()} input_tokens=${result.result.meta.usage.inputTokens} output_tokens=${result.result.meta.usage.outputTokens} latency_ms=${latencyMs} request_id=${requestId} charged=${decision.charged}`,
    );

    return {
      jobId,
      careerProfileId: profileId,
      analysis: report,
      grounding: contractGrounding(grounding),
      provenance: generatedProvenance(result.result.meta),
      cached: false,
      deterministicMatch: deterministicMatchFrom(context.match),
      refusal: null,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * The degraded answer: a normal 200 that names the deterministic alternative.
   *
   * `analysis` is null, so no client can render model text, and `grounding` is
   * `not_evaluated` rather than `passed`, so no client can present the absence
   * of output as a verified result.
   */
  private deterministicOnlyAnalysis(
    jobId: string,
    careerProfileId: string,
    match: MatchResult | null,
    reasons: readonly string[],
  ): OpportunityAnalysisResponse {
    return {
      jobId,
      careerProfileId,
      analysis: null,
      grounding: { ...aiNotEvaluatedGrounding },
      provenance: withheldProvenance(this.provider, reasons[0] ?? this.unavailableReason()),
      cached: false,
      deterministicMatch: deterministicMatchFrom(match),
      refusal: null,
      generatedAt: null,
    };
  }

  // -------------------------------------------------------------------------
  // Coach
  // -------------------------------------------------------------------------

  async conversations(request: AuthenticatedRequest): Promise<CoachConversationDirectory> {
    const { userId } = this.actor(request);
    const items = await this.repository.coachConversations(userId);
    return {
      items: items.map(contractConversation),
      ai: this.available()
        ? {
            ...notGeneratedProvenance,
            provider: this.provider.kind,
            model: this.modelName(),
            promptVersion,
            degraded: false,
          }
        : withheldProvenance(this.provider, this.unavailableReason()),
    };
  }

  async openConversation(
    request: AuthenticatedRequest,
    body: unknown,
  ): Promise<CoachConversationDetail> {
    const { userId } = this.actor(request);
    const parsed = openCoachConversationRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw this.validationError('The coach conversation request is invalid', parsed.error.issues);
    }
    const careerProfileId =
      parsed.data.careerProfileId ?? (await this.defaultProfileIdOrNull(userId));
    if (careerProfileId !== null) {
      // Ownership is verified by the database function as well; this read makes
      // the failure a 403 before any thread exists.
      await this.repository.careerProfile(userId, careerProfileId);
    }
    const topic = parsed.data.topic ?? 'general';
    const row = await this.repository.openCoachConversation({
      userId,
      careerProfileId,
      title: parsed.data.title ?? defaultConversationTitle(topic),
      topic,
      provider: this.available() ? this.providerName() : null,
      model: this.available() ? this.modelName() : null,
    });
    return this.conversationDetail(userId, row.id);
  }

  async conversation(
    request: AuthenticatedRequest,
    conversationId: string,
  ): Promise<CoachConversationDetail> {
    const { userId } = this.actor(request);
    return this.conversationDetail(userId, conversationId);
  }

  private async conversationDetail(
    userId: string,
    conversationId: string,
  ): Promise<CoachConversationDetail> {
    const detail = await this.repository.coachConversationDetail(userId, conversationId);
    const lastAssistant = [...detail.messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    return {
      conversation: contractConversation(detail.conversation),
      messages: detail.messages.map(contractMessage),
      // A stored thread carries no fresh grounding report: the per-claim
      // verdicts were computed when the reply was generated, and that the reply
      // exists at all is the evidence the gate passed. Reporting
      // `not_evaluated` is honest; reporting `passed` would claim a verdict this
      // read never made.
      grounding: { ...aiNotEvaluatedGrounding },
      provenance: this.available()
        ? {
            ...notGeneratedProvenance,
            provider: this.provider.kind,
            model: lastAssistant === undefined ? this.modelName() : detail.conversation.model,
            promptVersion,
            generated: lastAssistant !== undefined,
            degraded: false,
          }
        : withheldProvenance(this.provider, this.unavailableReason()),
    };
  }

  /**
   * Appends the member's message, generates a grounded reply, appends that, and
   * returns the thread.
   *
   * The order matters. The member's own message is stored whether or not
   * generation succeeds, because it is their text and losing it would be worse
   * than a failed reply. The assistant message is stored only after the truth
   * gate has passed, and the database refuses an assistant row that asserts
   * facts without citing confirmed fact ids — so an uncited claim cannot reach
   * the thread even if both earlier checks were bypassed.
   */
  async sendMessage(
    request: AuthenticatedRequest,
    conversationId: string,
    body: unknown,
  ): Promise<CoachConversationDetail> {
    const { userId, requestId } = this.actor(request);
    const parsed = sendCoachMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw this.validationError('Your message is invalid', parsed.error.issues);
    }
    const detail = await this.repository.coachConversationDetail(userId, conversationId);
    const careerProfileId = parsed.data.careerProfileId ?? detail.conversation.careerProfileId;

    await this.repository.appendCoachMessage({
      userId,
      conversationId,
      role: 'user',
      body: parsed.data.body,
      facts: [],
      suggestions: [],
      citedFactIds: [],
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
    });

    if (!this.available()) {
      await this.appendAssistantNotice(
        userId,
        conversationId,
        `${this.unavailableReason()} Your message is saved. Every other part of Hanaply — your match results, the deterministic opportunity brief, your Application Packs, and your insights — is unaffected and does not need the coach.`,
      );
      return this.conversationDetail(userId, conversationId);
    }

    if (careerProfileId === null) {
      // Without a career profile there is no confirmed ledger, so the coach has
      // no admissible evidence and must not assert anything. It says so.
      await this.appendAssistantNotice(
        userId,
        conversationId,
        'Your message is saved. Hanaply cannot answer it yet because this thread is not linked to a career profile, and the coach may only state what your confirmed facts support. Choose a career profile and ask again.',
      );
      return this.conversationDetail(userId, conversationId);
    }

    const context = await this.coachContext(userId, careerProfileId, parsed.data.jobId ?? null);
    const meterKey = operationKey([
      'coach_message',
      userId,
      conversationId,
      bodyDigest(parsed.data.body),
    ]);
    const decision = await this.meter.consume({
      userId,
      feature: 'coach_message',
      idempotencyKey: meterKey,
      units: 1,
    });

    const coachRequest = buildCoachRequest({
      requestId,
      profile: context.profile,
      job: context.job,
      match: context.match,
      facts: context.facts,
      question: parsed.data.body,
    });
    const started = Date.now();
    const result = await this.provider.coach(coachRequest);
    const latencyMs = Date.now() - started;

    if (!result.ok) {
      const refused = result.grounding !== null;
      await this.recordInvocation({
        userId,
        profileId: careerProfileId,
        requestKind: requestId,
        operation: 'coach_message',
        outcome: refused ? 'grounding_rejected' : this.outcomeFor(result.error),
        rejectionReason: clamp(result.error.message, 300),
        meta: null,
        latencyMs,
      });
      this.meter.release(meterKey);
      await this.appendAssistantNotice(
        userId,
        conversationId,
        refused
          ? 'Your message is saved. Hanaply generated a reply and refused to store it, because a statement in it was not supported by your confirmed facts. Nothing was charged, and the refusal was recorded. Ask again, or rephrase the question around evidence you have confirmed.'
          : `Your message is saved. Hanaply could not generate a reply: ${result.error.message} Nothing was stored and your message was not charged against your plan.`,
      );
      return this.conversationDetail(userId, conversationId);
    }

    const grounding = result.result.grounding;
    const output = result.result.value as CoachingResponse;

    if (truthGateFromGrounding(grounding).status !== 'passed') {
      await this.recordInvocation({
        userId,
        profileId: careerProfileId,
        requestKind: requestId,
        operation: 'coach_message',
        outcome: 'grounding_rejected',
        rejectionReason: 'The generated reply did not pass the truth gate',
        meta: result.result.meta,
        latencyMs,
      });
      this.meter.release(meterKey);
      await this.appendAssistantNotice(
        userId,
        conversationId,
        'Your message is saved. Hanaply generated a reply and refused to store it, because a statement in it was not supported by your confirmed facts. Nothing was charged, and the refusal was recorded.',
      );
      return this.conversationDetail(userId, conversationId);
    }

    // Facts and suggestions are written to separate columns with separate
    // shapes. A fact carries the confirmed identifiers behind it; a suggestion
    // is labelled `inference` and cites nothing, because it is the model's own
    // reasoning rather than a claim about the member. A "fact" whose citations
    // do not survive the admissible set is demoted out of the facts channel
    // rather than stored as an uncited assertion.
    const groundedFacts = output.facts
      .map((fact) => ({
        statement: clamp(fact.statement, 2_000),
        evidenceFactIds: fact.evidenceFactIds.filter((id) => context.admissibleIds.has(id)),
      }))
      .filter((fact) => fact.evidenceFactIds.length > 0);
    const suggestions = output.suggestions.map((suggestion) => ({
      kind: 'inference' as const,
      statement: clamp(suggestion.statement, 2_000),
      rationale: clamp(suggestion.rationale, 600),
    }));
    const citedFactIds = [...new Set(groundedFacts.flatMap((fact) => fact.evidenceFactIds))];

    await this.repository.appendCoachMessage({
      userId,
      conversationId,
      role: 'assistant',
      body: renderCoachBody(output),
      facts: groundedFacts,
      suggestions,
      citedFactIds,
      provider: this.providerName(),
      model: this.modelName(),
      inputTokens: result.result.meta.usage.inputTokens,
      outputTokens: result.result.meta.usage.outputTokens,
    });
    await this.recordInvocation({
      userId,
      profileId: careerProfileId,
      requestKind: requestId,
      operation: 'coach_message',
      outcome: 'succeeded',
      rejectionReason: null,
      meta: result.result.meta,
      latencyMs,
      charged: decision.charged,
    });
    this.logger.log(
      `ai.coach_message outcome=succeeded provider=${this.providerName()} model=${this.modelName()} facts=${groundedFacts.length} suggestions=${suggestions.length} input_tokens=${result.result.meta.usage.inputTokens} output_tokens=${result.result.meta.usage.outputTokens} latency_ms=${latencyMs} request_id=${requestId} charged=${decision.charged}`,
    );

    const stored = await this.conversationDetail(userId, conversationId);
    return { ...stored, grounding: contractGrounding(grounding) };
  }

  /** A stored assistant notice that asserts nothing about the member. */
  private async appendAssistantNotice(
    userId: string,
    conversationId: string,
    body: string,
  ): Promise<void> {
    await this.repository.appendCoachMessage({
      userId,
      conversationId,
      role: 'assistant',
      body: clamp(body, 8_000),
      facts: [],
      suggestions: [],
      citedFactIds: [],
      provider: this.available() ? this.providerName() : null,
      model: this.available() ? this.modelName() : null,
      inputTokens: null,
      outputTokens: null,
    });
  }

  /**
   * Persists one draft per kind and returns the drafts in order.
   *
   * Both generators reach the database through this one function, so the
   * deterministic path and the AI path cannot differ in what the truth gate is
   * allowed to accept, and the size limit is checked once rather than in each
   * branch. A draft that cannot be stored is reported rather than truncated: a
   * truncated resume would be a document the member never reviewed.
   */
  private async record(
    drafts: readonly PackArtifactDraft[],
    recordArtifact: (draft: PackArtifactDraft) => Promise<void>,
  ): Promise<readonly PackArtifactDraft[]> {
    for (const draft of drafts) {
      if (draft.plainText.length > maximumArtifactCharacters) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          status: 400,
          message: `The generated ${draft.kind.replaceAll('_', ' ')} is longer than the ${maximumArtifactCharacters} characters an artifact can store. Shorten the career profile and generate again.`,
        });
      }
    }
    for (const draft of drafts) await recordArtifact(draft);
    return drafts;
  }

  // -------------------------------------------------------------------------
  // Application Pack artifacts
  // -------------------------------------------------------------------------

  /**
   * Generates the pack artifacts through the AI path when one is available.
   *
   * Both paths write through the same `record_application_artifact`, so
   * `validate_artifact_evidence` applies to model output exactly as it applies
   * to template output. A kind the model produced but the database refused is
   * reported as skipped and replaced by the deterministic draft, so a provider
   * failure can never leave the pack half-written, and the response always says
   * which path produced what.
   */
  async generateArtifacts(input: {
    userId: string;
    requestId: string;
    packId: string;
    body: unknown;
    /** The pack context, already read and validated through the pack repository. */
    prepared: PackGenerationContext;
    /** Persists one artifact through the existing database truth gate. */
    recordArtifact: (draft: PackArtifactDraft) => Promise<void>;
  }): Promise<{ drafts: readonly PackArtifactDraft[]; ai: PackGenerationAi }> {
    const parsed = generateApplicationPackAiRequestSchema.safeParse(input.body ?? {});
    if (!parsed.success) {
      throw this.validationError(
        'Choose at least one artifact kind, and a supported style',
        parsed.error.issues,
      );
    }
    const kinds: readonly ApplicationArtifactKind[] = parsed.data.kinds ?? allArtifactKinds;
    const style: PackArtifactStyle = parsed.data.style ?? defaultPackArtifactStyle;
    // The context arrives already read and already validated.
    // `CareerRepository.generatePackArtifacts` parses the profile, the ledger,
    // the posting, and the requested kinds with the shared schemas before it
    // resolves, and `CareerService` reads it through the same repository the
    // deterministic path has always used — so a model-generated artifact and a
    // template artifact are built from one read of one context rather than two
    // that could disagree.
    const prepared = input.prepared;
    const generation = packGenerationInputSchema.parse({
      profile: prepared.profile,
      facts: prepared.evidence,
      job: prepared.job,
      match: prepared.match,
      kinds,
      style,
    });

    const deterministic = generatePackArtifacts({
      profile: generation.profile,
      facts: generation.facts,
      job: generation.job,
      match: readPackMatchSnapshot(generation.match),
      kinds,
      style,
    });

    // The deterministic path is the default, and it is also the fallback. It is
    // chosen when the caller asks for it, and when no provider can be used.
    if (parsed.data.generator === 'deterministic' || !this.available()) {
      return {
        drafts: await this.record(deterministic, input.recordArtifact),
        ai: {
          path: 'deterministic',
          provenance: this.available()
            ? {
                ...notGeneratedProvenance,
                provider: this.provider.kind,
                model: this.modelName(),
                promptVersion,
                degraded: false,
                reason: 'The deterministic generator was requested for this pack.',
              }
            : withheldProvenance(this.provider, this.unavailableReason()),
          grounding: { ...aiNotEvaluatedGrounding },
          aiKinds: [],
          aiSkippedKinds: [],
        },
      };
    }

    // The artifact prompt quotes the frozen match analysis, so a pack with no
    // frozen result — one created before the posting was ever scored — has
    // nothing for the model to be grounded in. Rather than hand it a zero score
    // the engine never produced, this pack is written deterministically and the
    // response says why.
    const match = analysisMatch(readPackMatchSnapshot(generation.match), generation.profile.id);
    if (match === null) {
      return {
        drafts: await this.record(deterministic, input.recordArtifact),
        ai: {
          path: 'deterministic',
          provenance: withheldProvenance(
            this.provider,
            'This pack has no frozen match result, so there is no deterministic analysis for the AI path to quote. The deterministic generator, which does not need one, wrote it instead.',
          ),
          grounding: { ...aiNotEvaluatedGrounding },
          aiKinds: [],
          aiSkippedKinds: [],
        },
      };
    }

    const meterKey = operationKey([
      'artifact_generation',
      input.userId,
      input.packId,
      [...kinds].join(','),
      style,
      input.requestId,
    ]);
    const decision = await this.meter.consume({
      userId: input.userId,
      feature: 'ai_analysis',
      idempotencyKey: meterKey,
      units: 1,
    });

    const facts: readonly GroundingFact[] = groundingFacts(generation.facts);
    const profile = matchingProfile(generation.profile);
    const jobForPrompt: MatchingJob = matchingJobFromPackJob(generation.job);
    const admissible = new Set(facts.map((fact) => fact.id));
    const deterministicByKind = new Map(deterministic.map((draft) => [draft.kind, draft]));
    const drafts: PackArtifactDraft[] = [];
    const aiKinds: string[] = [];
    const aiSkippedKinds: { kind: string; reason: string }[] = [];
    let grounding: GroundingReport | null = null;
    let meta: AiResponseMetadata | null = null;
    let charged = decision.charged;

    for (const kind of kinds) {
      const fallback = deterministicByKind.get(kind);
      if (fallback === undefined) continue;
      const artifactRequest = buildArtifactRequest({
        requestId: `${input.requestId}:${kind}`,
        profile,
        job: jobForPrompt,
        match,
        facts,
        kind: kind,
        style,
      });
      const result = await this.provider.generateApplicationArtifact(artifactRequest);
      if (!result.ok) {
        await this.recordInvocation({
          userId: input.userId,
          profileId: generation.profile.id,
          requestKind: `${input.requestId}:${kind}`,
          operation: 'artifact_generation',
          outcome: result.grounding === null ? this.outcomeFor(result.error) : 'grounding_rejected',
          rejectionReason: clamp(result.error.message, 300),
          meta: null,
        });
        aiSkippedKinds.push({ kind, reason: clamp(result.error.message, 300) });
        drafts.push(fallback);
        continue;
      }
      grounding = result.result.grounding;
      meta = result.result.meta;
      if (truthGateFromGrounding(result.result.grounding).status !== 'passed') {
        await this.recordInvocation({
          userId: input.userId,
          profileId: generation.profile.id,
          requestKind: `${input.requestId}:${kind}`,
          operation: 'artifact_generation',
          outcome: 'grounding_rejected',
          rejectionReason: 'The generated artifact did not pass the truth gate',
          meta: result.result.meta,
        });
        this.meter.release(meterKey);
        charged = false;
        aiSkippedKinds.push({
          kind,
          reason: 'The generated artifact was refused by the truth gate and not stored.',
        });
        drafts.push(fallback);
        continue;
      }

      const artifact = result.result.value as {
        kind: ApplicationArtifactKind;
        title: string;
        sections: readonly { heading: string; paragraphs: readonly string[] }[];
        evidenceFactIds: readonly string[];
      };
      const cited = artifact.evidenceFactIds.filter((id) => admissible.has(id));
      const aiDraft = aiDraftFrom(artifact, style, cited, generation.job);
      try {
        // The database truth gate runs here. The writer is
        // `record_application_artifact`, which applies
        // `validate_artifact_evidence`, so an artifact citing a fact the member
        // has not confirmed is refused after `packages/ai` has already refused
        // it. The AI path and the deterministic path write through the same
        // function, so neither can be more permissive than the other.
        await input.recordArtifact(aiDraft);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        await this.recordInvocation({
          userId: input.userId,
          profileId: generation.profile.id,
          requestKind: `${input.requestId}:${kind}`,
          operation: 'artifact_generation',
          outcome: 'grounding_rejected',
          rejectionReason: clamp(error.message, 300),
          meta: result.result.meta,
        });
        this.meter.release(meterKey);
        charged = false;
        aiSkippedKinds.push({ kind, reason: clamp(error.message, 300) });
        drafts.push(fallback);
        continue;
      }
      aiKinds.push(kind);
      drafts.push(aiDraft);
    }

    if (meta !== null) {
      await this.recordInvocation({
        userId: input.userId,
        profileId: generation.profile.id,
        requestKind: input.requestId,
        operation: 'artifact_generation',
        outcome: aiKinds.length > 0 ? 'succeeded' : 'grounding_rejected',
        rejectionReason:
          aiKinds.length > 0 ? null : 'No artifact from the AI path passed the truth gate',
        meta,
        charged,
      });
      this.logger.log(
        `ai.artifact_generation outcome=${aiKinds.length > 0 ? 'succeeded' : 'grounding_rejected'} provider=${this.providerName()} model=${this.modelName()} ai_kinds=${aiKinds.length} skipped=${aiSkippedKinds.length} input_tokens=${meta.usage.inputTokens} output_tokens=${meta.usage.outputTokens} request_id=${input.requestId} charged=${charged}`,
      );
    }

    return {
      drafts,
      ai: {
        path: aiKinds.length > 0 ? 'ai' : 'deterministic',
        provenance:
          meta === null
            ? withheldProvenance(
                this.provider,
                'The AI path produced no artifact that passed the truth gate, so the deterministic generator wrote this pack.',
              )
            : generatedProvenance(meta),
        grounding: contractGrounding(grounding),
        aiKinds,
        aiSkippedKinds,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Shared context
  // -------------------------------------------------------------------------

  /** The career profile an operation works against, defaulting to the primary. */
  private async resolveProfileId(userId: string, requested: string | null): Promise<string> {
    if (requested !== null) return requested;
    const resolved = await this.defaultProfileIdOrNull(userId);
    if (resolved === null) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message:
          'Create a career profile first. Hanaply grounds everything it says about you in the facts you confirm on a profile.',
      });
    }
    return resolved;
  }

  private async defaultProfileIdOrNull(userId: string): Promise<string | null> {
    const directory = await this.repository.careerProfileDirectory(userId);
    const primary = directory.items.find((item) => item.isPrimary) ?? directory.items[0];
    return primary?.id ?? null;
  }

  private async analysisContext(userId: string, jobId: string, profileId: string) {
    const [detail, evidence, profile] = await Promise.all([
      this.repository.jobDetail(userId, jobId, profileId),
      this.repository.confirmedEvidence(userId, profileId),
      this.repository.careerProfile(userId, profileId),
    ]);
    return {
      job: matchingJob(detail),
      profile: matchingProfile(profile),
      match: analysisMatch(readPackMatchSnapshot(detail.match), profileId),
      facts: groundingFacts(evidence.facts),
    };
  }

  private async coachContext(userId: string, profileId: string, jobId: string | null) {
    const [evidence, profile] = await Promise.all([
      this.repository.confirmedEvidence(userId, profileId),
      this.repository.careerProfile(userId, profileId),
    ]);
    const detail =
      jobId === null ? null : await this.repository.jobDetail(userId, jobId, profileId);
    const facts = groundingFacts(evidence.facts);
    return {
      profile: matchingProfile(profile),
      job: detail === null ? null : matchingJob(detail),
      match: detail === null ? null : analysisMatch(readPackMatchSnapshot(detail.match), profileId),
      facts,
      admissibleIds: new Set(facts.map((fact) => fact.id)),
    };
  }

  // -------------------------------------------------------------------------
  // Invocation records
  // -------------------------------------------------------------------------

  private providerName(): string {
    return this.provider.kind;
  }

  private modelName(): string {
    return this.provider.model ?? 'deterministic';
  }

  private outcomeFor(error: AiProviderError): AiInvocationRecordOutcome {
    switch (error.code) {
      case 'timeout':
      case 'aborted':
        return 'timeout';
      case 'rate_limit':
        return 'rate_limited';
      case 'not_configured':
      case 'unavailable':
      case 'auth':
      case 'invalid_request':
        return 'disabled';
      case 'schema_invalid':
      case 'malformed_response':
        return 'schema_rejected';
      default:
        return 'provider_error';
    }
  }

  /**
   * Records one attempt against `ai_invocations`.
   *
   * Every attempt is recorded, including a refusal and including a call made
   * while no provider exists: an AI feature that cannot be costed cannot be
   * operated, and a refusal rate that is never written down cannot be watched.
   * The row holds identifiers, counts, and latency, and has nowhere to put a
   * prompt, a completion, or any of the member's own text.
   */
  private async recordInvocation(input: {
    userId: string;
    profileId: string | null;
    requestKind: string;
    operation?: AiInvocationOperation;
    outcome: AiInvocationRecordOutcome;
    rejectionReason: string | null;
    meta: AiResponseMetadata | null;
    latencyMs?: number;
    cached?: boolean;
    charged?: boolean;
  }): Promise<void> {
    try {
      await this.repository.recordInvocation({
        userId: input.userId,
        careerProfileId: input.profileId,
        operation: input.operation ?? 'opportunity_analysis',
        provider: this.providerName(),
        model: this.modelName(),
        promptVersion,
        requestId: stableRequestId(input.requestKind),
        outcome: input.outcome,
        rejectionReason: input.rejectionReason,
        inputTokens: input.meta?.usage.inputTokens ?? null,
        outputTokens: input.meta?.usage.outputTokens ?? null,
        latencyMs: input.meta?.latencyMs ?? input.latencyMs ?? null,
        attempt: 1,
        cached: input.cached ?? false,
      });
    } catch (error) {
      // A bookkeeping failure must never replace the answer the member asked
      // for, and it must never be swallowed silently either.
      const detail = error instanceof AppError ? error.message : 'unknown error';
      this.logger.warn(
        `ai.invocation_record_failed outcome=${input.outcome} request_id=${input.requestKind} detail=${detail}`,
      );
    }
  }
}

type AiInvocationOperation =
  | 'opportunity_analysis'
  | 'artifact_generation'
  | 'coach_message'
  | 'profile_review'
  | 'resume_feedback'
  | 'interview_preparation';

type AiInvocationRecordOutcome =
  | 'succeeded'
  | 'schema_rejected'
  | 'grounding_rejected'
  | 'provider_error'
  | 'timeout'
  | 'rate_limited'
  | 'disabled';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A UUID derived from a logical operation, so one attempt records one row. */
export function stableRequestId(kind: string): string {
  const digest = createHash('sha256').update(kind).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest[16] ?? '0', 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}

function defaultConversationTitle(topic: string): string {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    general: 'Coaching conversation',
    career_strategy: 'Career strategy',
    resume: 'Resume help',
    profile: 'Profile review',
    skills: 'Skills planning',
    job_search: 'Job search',
    interview: 'Interview preparation',
    application: 'Application help',
  });
  return labels[topic] ?? 'Coaching conversation';
}

/**
 * The posting as `buildArtifactRequest` receives it, built from the pack
 * context's canonical job card rather than from a raw row.
 */
export function matchingJobFromPackJob(job: PackGenerationJob): MatchingJob {
  return {
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    description: job.description,
    employmentType: job.employmentType,
    seniority: job.seniority,
    remoteState: job.remoteState,
    locationRaw: job.locationRaw,
    city: job.city,
    region: job.region,
    countryCode: job.countryCode,
    isPhilippines: job.isPhilippines,
    salaryMinMinor: job.salaryMinMinor,
    salaryMaxMinor: job.salaryMaxMinor,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    skills: [...job.skills],
    requirements: [...job.requirements],
    preferredQualifications: [...job.preferredQualifications],
    experienceYearsMin: job.experienceYearsMin,
    experienceYearsMax: job.experienceYearsMax,
    postedAt: job.postedAt,
    lastSeenAt: job.lastSeenAt,
    status: job.status,
  };
}

/**
 * The assistant message body.
 *
 * The structured reply is rendered into readable text, and the parts are
 * labelled in the text itself as well as in the stored columns, so a member
 * reading the raw body still sees which sentence is evidence and which is the
 * coach's own inference.
 */
export function renderCoachBody(output: CoachingResponse): string {
  const lines: string[] = [];
  if (output.facts.length > 0) {
    lines.push('What your confirmed facts support');
    for (const fact of output.facts) lines.push(`- ${fact.statement}`);
    lines.push('');
  }
  if (output.suggestions.length > 0) {
    lines.push('Suggestions from Hanaply (inference, not a fact about you)');
    for (const suggestion of output.suggestions) {
      lines.push(`- ${suggestion.statement} (${suggestion.rationale})`);
    }
    lines.push('');
  }
  if (output.questionsToConfirm.length > 0) {
    lines.push('Worth confirming, so it can be treated as a fact');
    for (const question of output.questionsToConfirm) lines.push(`- ${question}`);
    lines.push('');
  }
  if (output.nextSteps.length > 0) {
    lines.push('Next steps');
    for (const step of output.nextSteps) lines.push(`- ${step}`);
  }
  const body = lines.join('\n').trim();
  return body.length === 0
    ? 'The coach returned no content for this message.'
    : body.slice(0, 8_000);
}

/**
 * Converts one AI artifact into the draft shape the pack writer stores.
 *
 * The `content` mirrors the deterministic generator's section shape — including
 * the `sources` array — so the pack viewer renders an AI artifact and a
 * deterministic one without a second code path. A paragraph the model wrote is
 * attributed to the artifact itself rather than to a confirmed fact: only the
 * draft's `evidenceFactIds`, which the truth gate checked, may claim evidence.
 */
export function aiDraftFrom(
  artifact: {
    kind: ApplicationArtifactKind;
    title: string;
    sections: readonly { heading: string; paragraphs: readonly string[] }[];
    evidenceFactIds: readonly string[];
  },
  style: PackArtifactStyle,
  cited: readonly string[],
  job: { title: string },
): PackArtifactDraft {
  const sections = artifact.sections.map((section, sectionIndex) => ({
    heading: section.heading,
    paragraphs: [...section.paragraphs],
    body: section.paragraphs.join('\n\n'),
    sources: section.paragraphs.map((_, paragraphIndex) => ({
      id: `ai:${artifact.kind}:${sectionIndex}:${paragraphIndex}`,
      type: 'career_fact' as const,
      label: `Written by the configured AI provider, about ${job.title}`,
      paragraphIndex,
    })),
  }));
  const plainText = [
    artifact.title,
    '',
    ...sections.flatMap((section) => [section.heading, '', ...section.paragraphs, '']),
  ]
    .join('\n')
    .trim()
    .slice(0, 60_000);
  return {
    kind: artifact.kind,
    style,
    title: artifact.title.slice(0, 200),
    plainText,
    content: { sections },
    evidenceFactIds: [...new Set(cited)].sort(),
  };
}

export type { MeterDecision, JobDetail };
