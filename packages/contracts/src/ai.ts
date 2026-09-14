import { z } from 'zod';

/**
 * AI layer contracts.
 *
 * Three shapes here are load-bearing and must not be "simplified" later,
 * because each one is the contract-level half of a rule the AI layer enforces:
 *
 *   - `aiProvenanceSchema` is required on every response that can carry model
 *     output. `degraded` and `reason` are part of the response rather than an
 *     error code, so a deployment with no provider answers normally and says so
 *     instead of failing or quietly returning deterministic text.
 *   - `aiGroundingReportSchema` is required alongside any AI output. A consumer
 *     cannot render the output without also holding the per-claim verdicts, so
 *     "which of these statements are supported" is always answerable.
 *   - There is no numeric score field and no confidence field anywhere in an
 *     analysis. Score and confidence belong to `@hanaply/matching`; an AI
 *     response may quote them inside `deterministicMatch` and nowhere else.
 */

const isoTimestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Provenance and grounding
// ---------------------------------------------------------------------------

export const aiProviderKindSchema = z.enum([
  'disabled',
  'fake',
  'openai',
  'anthropic',
  'google',
  'azure_openai',
  'openrouter',
  'together',
  'groq',
  'deepseek',
  'ollama',
  'vllm',
  'openai_compatible',
]);

export const aiCapabilitySchema = z.enum(['ai', 'deterministic']);

/**
 * Who produced a response, and whether generation was available at all.
 *
 * `provider` and `model` are null when nothing generated the payload. They are
 * never a vendor default, a placeholder, or an internal identifier that was not
 * configured.
 */
export const aiProvenanceSchema = z.object({
  provider: aiProviderKindSchema.nullable(),
  model: z.string().max(120).nullable(),
  promptVersion: z.string().max(60).nullable(),
  /** True when the payload was written by a model rather than by Hanaply's engine. */
  generated: z.boolean(),
  /** True when a provider was selected but could not be used, or none is configured. */
  degraded: z.boolean(),
  /** Why generation is unavailable, or null when it is available. */
  reason: z.string().max(500).nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
});

export const aiGroundingStatusSchema = z.enum(['passed', 'partial', 'rejected', 'not_evaluated']);

export const aiGroundingClaimStatusSchema = z.enum(['supported', 'dropped', 'rejected']);

export const aiGroundingClaimKindSchema = z.enum([
  'fact_citation',
  'numeric',
  'experience',
  'entity',
  'label',
]);

export const aiGroundingClaimSchema = z.object({
  /** Field path the claim was found at, so the interface can show it in place. */
  path: z.string().max(300),
  kind: aiGroundingClaimKindSchema,
  /** The offending excerpt, bounded. Empty for structural claims. */
  text: z.string().max(600),
  status: aiGroundingClaimStatusSchema,
  reason: z.string().max(500).nullable(),
});

export const aiGroundingRejectionSchema = z.object({
  code: aiGroundingClaimKindSchema,
  path: z.string().max(300),
  detail: z.string().max(500),
});

/**
 * The per-claim truth-gate verdict for one response.
 *
 * This travels with the output rather than beside it. Which claims are
 * supported, which were dropped, and which confirmed facts were admissible is
 * not optional detail: without it the interface cannot tell a member which part
 * of a report is evidence and which part is the model talking.
 */
export const aiGroundingReportSchema = z.object({
  status: aiGroundingStatusSchema,
  unsupportedClaimIds: z.array(z.string().max(300)).max(200),
  verifiedFactIds: z.array(z.string().max(80)).max(200),
  admissibleFactIds: z.array(z.string().max(80)).max(200),
  claims: z.array(aiGroundingClaimSchema).max(400),
  rejections: z.array(aiGroundingRejectionSchema).max(200),
  numericClaimsChecked: z.number().int().nonnegative(),
  entityClaimsChecked: z.number().int().nonnegative(),
  experienceClaimsChecked: z.number().int().nonnegative(),
});

export const aiNotEvaluatedGrounding: z.infer<typeof aiGroundingReportSchema> = Object.freeze({
  status: 'not_evaluated',
  unsupportedClaimIds: [],
  verifiedFactIds: [],
  admissibleFactIds: [],
  claims: [],
  rejections: [],
  numericClaimsChecked: 0,
  entityClaimsChecked: 0,
  experienceClaimsChecked: 0,
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * What the AI layer can do right now, and nothing more.
 *
 * Deliberately excludes the API key, the base URL, the deployment name, and any
 * other internal detail: a member-facing status surface needs to say which
 * features are available and why they are not, not how the deployment is wired.
 */
/**
 * Who writes each capability in this deployment.
 *
 * `ai` means a model may generate it; `deterministic` means Hanaply's own engine
 * produces it. The pack generator is listed separately because it always has a
 * deterministic path, so a client can say what still works without inferring it.
 */
export const aiCapabilitiesSchema = z.object({
  opportunityAnalysis: aiCapabilitySchema,
  coach: aiCapabilitySchema,
  artifactGeneration: aiCapabilitySchema,
});

export const aiStatusSchema = z.object({
  configured: z.boolean(),
  provider: aiProviderKindSchema,
  model: z.string().max(120).nullable(),
  degraded: z.boolean(),
  reason: z.string().max(500).nullable(),
  state: z.enum(['available', 'degraded', 'unavailable', 'disabled']),
  capabilities: aiCapabilitiesSchema,
  /** What still works when generation does not, stated for the interface. */
  deterministicAlternatives: z.array(z.string().max(300)).max(10),
});

export const aiStatusDataSchema = z.object({ status: aiStatusSchema });

// ---------------------------------------------------------------------------
// Opportunity analysis
// ---------------------------------------------------------------------------

/**
 * The analysis exactly as the model produced it.
 *
 * The field set is fixed by the AI layer's own schema. It is restated here so
 * the API cannot widen it, and so a client can render a report field by field
 * without trusting an untyped object.
 */
export const opportunityAnalysisReportSchema = z.object({
  verdict: z.object({
    restatesMatchVerdict: z.boolean(),
    summary: z.string().max(2_000),
  }),
  whyInteresting: z.array(z.string().max(600)),
  /** Each entry names the confirmed fact it rests on. */
  strongestEvidence: z.array(
    z.object({ factId: z.string().max(80), insight: z.string().max(600) }),
  ),
  transferableStrengths: z.array(z.string().max(600)),
  gaps: z.array(z.string().max(600)),
  hardBlockers: z.array(z.string().max(600)),
  rejectionRisks: z.array(z.string().max(600)),
  careerDirection: z.array(z.string().max(600)),
  salaryAndLocationConcerns: z.array(z.string().max(600)),
  whatToEmphasise: z.array(z.string().max(600)),
  /** Claims the member must not make. Rendered wherever the report is shown. */
  whatNotToClaim: z.array(z.string().max(600)),
  recommendedNextAction: z.string().max(2_000),
  applicationStrategy: z.array(z.string().max(600)),
  interviewStrategy: z.array(z.string().max(600)),
});

/**
 * The matching engine's own conclusion, quoted rather than recomputed.
 *
 * `score` and `confidence` are copied from the stored match result so the
 * interface can show them next to the model's commentary while it remains
 * unambiguous that they came from `@hanaply/matching`.
 */
export const aiDeterministicMatchSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.string().max(60),
  confidence: z.string().max(60),
  modelVersion: z.string().max(60),
  recommendedAction: z.string().max(600),
});

export const opportunityAnalysisRequestSchema = z
  .object({
    careerProfileId: z.uuid().optional(),
    /** Re-run generation even when a cached analysis exists for this evidence. */
    refresh: z.boolean().optional(),
  })
  .strict();

export const opportunityAnalysisQuerySchema = opportunityAnalysisRequestSchema;

export const opportunityAnalysisResponseSchema = z.object({
  jobId: z.uuid(),
  careerProfileId: z.uuid(),
  /** Null when generation was unavailable: the deterministic analysis stands in. */
  analysis: opportunityAnalysisReportSchema.nullable(),
  grounding: aiGroundingReportSchema,
  provenance: aiProvenanceSchema,
  /** True when the stored analysis was returned instead of generating again. */
  cached: z.boolean(),
  /**
   * Always present. When `analysis` is null this is what the member should use
   * instead, and the interface points at the deterministic panel with it.
   */
  deterministicMatch: aiDeterministicMatchSchema.nullable(),
  /** Populated only when the truth gate refused the generated report. */
  refusal: z.string().max(600).nullable(),
  /** ISO timestamp of the stored analysis, or null when nothing is stored. */
  generatedAt: isoTimestamp.nullable(),
});

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

export const coachTopicSchema = z.enum([
  'general',
  'career_strategy',
  'resume',
  'profile',
  'skills',
  'job_search',
  'interview',
  'application',
]);

export const coachConversationStatusSchema = z.enum(['open', 'archived']);

/** A statement about the member, always carrying the confirmed facts behind it. */
export const coachReplyFactSchema = z.object({
  statement: z.string().max(2_000),
  evidenceFactIds: z.array(z.uuid()).min(1).max(12),
});

/**
 * The coach's own inference, labelled as an inference at the type level.
 *
 * `kind` is the literal `inference` so an entry in this array cannot be
 * rendered as a fact about the member, and `evidenceFactIds` is deliberately
 * absent: a suggestion cites nothing, because there is nothing to cite.
 */
export const coachReplySuggestionSchema = z.object({
  kind: z.literal('inference'),
  statement: z.string().max(2_000),
  rationale: z.string().max(600),
});

export const coachMessageSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  role: z.enum(['user', 'assistant']),
  body: z.string().max(8_000),
  /** Supported statements. Empty on a user message. */
  facts: z.array(coachReplyFactSchema),
  /** Inference, explicitly labelled. Empty on a user message. */
  suggestions: z.array(coachReplySuggestionSchema),
  citedFactIds: z.array(z.uuid()),
  createdAt: isoTimestamp,
});

export const coachConversationSchema = z.object({
  id: z.uuid(),
  careerProfileId: z.uuid().nullable(),
  title: z.string().max(160),
  topic: coachTopicSchema,
  status: coachConversationStatusSchema,
  provider: z.string().max(120).nullable(),
  model: z.string().max(120).nullable(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const coachConversationDirectorySchema = z.object({
  items: z.array(coachConversationSchema),
  /** Present so an empty list can say whether the coach is available at all. */
  ai: aiProvenanceSchema,
});

export const coachConversationDetailSchema = z.object({
  conversation: coachConversationSchema,
  messages: z.array(coachMessageSchema),
  grounding: aiGroundingReportSchema,
  provenance: aiProvenanceSchema,
});

export const openCoachConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    topic: coachTopicSchema.optional(),
    careerProfileId: z.uuid().nullable().optional(),
    /** A posting the thread is about. The coach grounds its reply in it. */
    jobId: z.uuid().nullable().optional(),
  })
  .strict();

export const sendCoachMessageRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(8_000),
    careerProfileId: z.uuid().nullable().optional(),
    jobId: z.uuid().nullable().optional(),
  })
  .strict();

export const coachConversationParamsSchema = z.object({ conversationId: z.uuid() });

// ---------------------------------------------------------------------------
// AI-backed Application Pack artifacts
// ---------------------------------------------------------------------------

/**
 * Which generator produced the artifacts.
 *
 * The response states this explicitly rather than implying it, because the two
 * paths are not interchangeable: one quotes confirmed facts through a fixed
 * template, the other is a model writing prose under the truth gate. Labelling
 * one as the other is the failure this field exists to prevent.
 */
export const packGenerationPathSchema = z.enum(['deterministic', 'ai']);

export const packGenerationAiSchema = z.object({
  path: packGenerationPathSchema,
  provenance: aiProvenanceSchema,
  grounding: aiGroundingReportSchema,
  /** Kinds the AI path produced. Empty when the deterministic path ran. */
  aiKinds: z.array(z.string().max(60)),
  /**
   * Kinds the AI path was asked for and did not produce, with the reason, so
   * the interface never reports an artifact that is not stored.
   */
  aiSkippedKinds: z.array(z.object({ kind: z.string().max(60), reason: z.string().max(300) })),
});

export const generateApplicationPackAiRequestSchema = z
  .object({
    kinds: z
      .array(
        z.enum([
          'resume',
          'cover_letter',
          'strategy',
          'requirement_map',
          'recruiter_message',
          'interview_prep',
        ]),
      )
      .min(1)
      .max(6)
      .optional(),
    style: z.enum(['concise', 'standard', 'achievement_led']).optional(),
    /**
     * `auto` prefers the AI path when a provider is configured and the plan
     * allows it, and falls back to the deterministic generator otherwise.
     * `deterministic` always uses the generator. The AI path is never used
     * without one of these two being satisfied, and the response always says
     * which one ran.
     */
    generator: z.enum(['auto', 'deterministic']).optional(),
  })
  .strict();

export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;
export type AiProvenance = z.infer<typeof aiProvenanceSchema>;
export type AiGroundingReport = z.infer<typeof aiGroundingReportSchema>;
export type AiGroundingClaim = z.infer<typeof aiGroundingClaimSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>;
export type OpportunityAnalysisReport = z.infer<typeof opportunityAnalysisReportSchema>;
export type OpportunityAnalysisResponse = z.infer<typeof opportunityAnalysisResponseSchema>;
export type AiDeterministicMatch = z.infer<typeof aiDeterministicMatchSchema>;
export type CoachTopic = z.infer<typeof coachTopicSchema>;
export type CoachReplyFact = z.infer<typeof coachReplyFactSchema>;
export type CoachReplySuggestion = z.infer<typeof coachReplySuggestionSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type CoachConversation = z.infer<typeof coachConversationSchema>;
export type CoachConversationDirectory = z.infer<typeof coachConversationDirectorySchema>;
export type CoachConversationDetail = z.infer<typeof coachConversationDetailSchema>;
export type OpenCoachConversationRequest = z.infer<typeof openCoachConversationRequestSchema>;
export type SendCoachMessageRequest = z.infer<typeof sendCoachMessageRequestSchema>;
export type PackGenerationPath = z.infer<typeof packGenerationPathSchema>;
export type PackGenerationAi = z.infer<typeof packGenerationAiSchema>;
export type GenerateApplicationPackAiRequest = z.infer<
  typeof generateApplicationPackAiRequestSchema
>;
