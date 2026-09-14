import { z } from 'zod';

/**
 * Job radar and opportunity contracts.
 *
 * The feed returns an excerpt rather than the full posting so the payload stays
 * bounded, and every item carries the stored match result so the interface can
 * explain a ranking without recomputing it. `match` is null for a job that has
 * not been analysed yet, which the UI must present as "not analysed" rather than
 * as a low score.
 */

export const jobEmploymentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'internship',
  'temporary',
  'volunteer',
]);

export const jobSenioritySchema = z.enum([
  'internship',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
  'executive',
  'unspecified',
]);

export const jobRemoteStateSchema = z.enum(['remote', 'hybrid', 'onsite', 'unspecified']);
export const jobStatusSchema = z.enum([
  'active',
  'stale',
  'expired',
  'closed',
  'duplicate',
  'rejected',
]);
export const jobMatchVerdictSchema = z.enum([
  'strong_match',
  'good_match',
  'stretch',
  'weak_match',
  'not_recommended',
]);
export const jobMatchConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const jobFeedbackKindSchema = z.enum([
  'interested',
  'not_interested',
  'wrong_role',
  'wrong_seniority',
  'wrong_location',
  'salary_too_low',
  'already_applied',
  'irrelevant',
  'saved',
]);
export const jobRadarSortSchema = z.enum(['best_match', 'newest', 'salary', 'company']);

const isoTimestamp = z.iso.datetime({ offset: true });
const salaryPeriodSchema = z.enum(['hourly', 'daily', 'monthly', 'annual']);

export const jobMatchDimensionSchema = z.object({
  key: z.string().max(40),
  label: z.string().max(80),
  weight: z.number().int().nonnegative(),
  score: z.number().min(0).max(100).nullable(),
  contribution: z.number().int().nonnegative(),
  detail: z.string().max(500),
});

export const jobRequirementMappingSchema = z.object({
  requirement: z.string().max(500),
  status: z.enum(['met', 'partially_met', 'unmet', 'unknown']),
  matchedSkills: z.array(z.string().max(100)),
  evidence: z.string().max(500).nullable(),
});

export const jobMatchSummarySchema = z.object({
  jobId: z.uuid(),
  score: z.number().int().min(0).max(100),
  verdict: jobMatchVerdictSchema,
  confidence: jobMatchConfidenceSchema,
  modelVersion: z.string().max(60),
  recommendedAction: z.string().max(600),
  strengths: z.array(z.unknown()),
  gaps: z.array(z.unknown()),
  blockers: z.array(z.unknown()),
  computedAt: isoTimestamp,
});

export const jobMatchDetailSchema = jobMatchSummarySchema.extend({
  dimensions: z.array(jobMatchDimensionSchema),
  rejectionRisks: z.array(z.unknown()),
  requirementMapping: z.array(jobRequirementMappingSchema),
  evidenceFactIds: z.array(z.uuid()),
  dataQuality: z.record(z.string(), z.unknown()),
});

const jobCoreShape = {
  id: z.uuid(),
  title: z.string().min(1).max(300),
  companyName: z.string().min(1).max(200),
  employmentType: jobEmploymentTypeSchema,
  seniority: jobSenioritySchema,
  remoteState: jobRemoteStateSchema,
  locationRaw: z.string().max(300).nullable(),
  city: z.string().max(120).nullable(),
  region: z.string().max(120).nullable(),
  countryCode: z.string().length(2).nullable(),
  isPhilippines: z.boolean(),
  isInternational: z.boolean(),
  salaryMinMinor: z.number().int().positive().nullable(),
  salaryMaxMinor: z.number().int().positive().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  salaryPeriod: salaryPeriodSchema.nullable(),
  salaryIsEstimate: z.boolean(),
  skills: z.array(z.string().max(100)),
  postedAt: isoTimestamp.nullable(),
  firstSeenAt: isoTimestamp,
  lastSeenAt: isoTimestamp,
  lastVerifiedAt: isoTimestamp.nullable(),
  sourceCount: z.number().int().positive(),
  status: jobStatusSchema,
  excerpt: z.string().max(600),
} as const;

/**
 * The canonical job card emitted by `app_private.job_card_snapshot`. Shared by
 * the radar feed, the opportunity detail read model, and Application Packs so
 * every surface describes an opportunity the same way.
 */
export const jobCardSchema = z.object({
  ...jobCoreShape,
  expiresAt: isoTimestamp.nullable(),
});

export const jobRadarItemSchema = z.object({
  ...jobCoreShape,
  companyId: z.uuid(),
  savedAt: isoTimestamp.nullable(),
  feedback: jobFeedbackKindSchema.nullable(),
  match: jobMatchSummarySchema.nullable(),
});

export const jobRadarSchema = z.object({
  items: z.array(jobRadarItemSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
  careerProfileId: z.uuid().nullable(),
  evaluatedAt: isoTimestamp,
});

export const jobSourceProvenanceSchema = z.object({
  sourceCode: z.string().max(64),
  displayName: z.string().max(120),
  attribution: z.string().max(300),
  sourceUrl: z.string().max(1000),
  isPrimary: z.boolean(),
  firstSeenAt: isoTimestamp,
  lastSeenAt: isoTimestamp,
  status: z.enum(['active', 'removed', 'stale']),
});

export const jobDetailSchema = z.object({
  ...jobCoreShape,
  description: z.string().min(20).max(40_000),
  requirements: z.array(z.string().max(500)),
  preferredQualifications: z.array(z.string().max(500)),
  experienceYearsMin: z.number().min(0).max(60).nullable(),
  experienceYearsMax: z.number().min(0).max(60).nullable(),
  applyUrl: z.string().max(1000),
  canonicalUrl: z.string().max(1000),
  careerProfileId: z.uuid().nullable(),
  savedAt: isoTimestamp.nullable(),
  feedback: jobFeedbackKindSchema.nullable(),
  match: jobMatchDetailSchema.nullable(),
  sources: z.array(jobSourceProvenanceSchema),
});

export const jobRadarQuerySchema = z
  .object({
    careerProfileId: z.uuid().optional(),
    search: z.string().trim().max(120).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    verdicts: z.array(jobMatchVerdictSchema).max(5).optional(),
    remoteStates: z.array(jobRemoteStateSchema).max(4).optional(),
    employmentTypes: z.array(jobEmploymentTypeSchema).max(7).optional(),
    seniorities: z.array(jobSenioritySchema).max(11).optional(),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .optional(),
    philippinesOnly: z.coerce.boolean().optional(),
    internationalOnly: z.coerce.boolean().optional(),
    postedWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
    salaryMinMinor: z.coerce.number().int().positive().optional(),
    companyId: z.uuid().optional(),
    savedOnly: z.coerce.boolean().optional(),
    dismissedOnly: z.coerce.boolean().optional(),
    includeDismissed: z.coerce.boolean().optional(),
    sort: jobRadarSortSchema.default('best_match'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const jobParamsSchema = z.object({ jobId: z.uuid() });

export const saveJobSchema = z
  .object({
    careerProfileId: z.uuid().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const jobFeedbackSchema = z
  .object({
    feedback: jobFeedbackKindSchema,
    reason: z.string().trim().max(500).nullable().optional(),
    careerProfileId: z.uuid().nullable().optional(),
  })
  .strict();

export type JobRadarItem = z.infer<typeof jobRadarItemSchema>;
export type JobCard = z.infer<typeof jobCardSchema>;
export type JobRadar = z.infer<typeof jobRadarSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
export type JobMatchSummary = z.infer<typeof jobMatchSummarySchema>;
export type JobFeedbackKind = z.infer<typeof jobFeedbackKindSchema>;
export type JobRadarSort = z.infer<typeof jobRadarSortSchema>;
export type JobRadarQuery = z.infer<typeof jobRadarQuerySchema>;
