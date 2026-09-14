import { z } from 'zod';

/**
 * Career insight and coaching contracts.
 *
 * Two shapes here are load-bearing and must not be "simplified" later:
 *
 *   - Every rate is nullable. A rate with a zero denominator is unknown, not
 *     zero, and the contract refuses to let the interface present "0%" to
 *     someone who has not applied anywhere yet.
 *   - Every coaching suggestion carries structured evidence. If the subscriber
 *     cannot see the count that produced a suggestion, they cannot judge
 *     whether it is true.
 */

const isoTimestamp = z.iso.datetime({ offset: true });

export const insightFieldStrengthSchema = z.object({
  field: z.string().max(60),
  label: z.string().max(120),
  present: z.boolean(),
  impact: z.string().max(500),
});

export const profileStrengthSchema = z.object({
  completenessPercent: z.number().int().min(0).max(100),
  fields: z.array(insightFieldStrengthSchema),
});

export const insightMatchingSchema = z.object({
  opportunitiesMatched: z.number().int().nonnegative(),
  strongMatches: z.number().int().nonnegative(),
  strongMatchRate: z.number().min(0).max(100).nullable(),
});

export const insightPipelineSchema = z.object({
  saved: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  interviewing: z.number().int().nonnegative(),
  offers: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  interviewRate: z.number().min(0).max(100).nullable(),
  offerRate: z.number().min(0).max(100).nullable(),
  rejectionRate: z.number().min(0).max(100).nullable(),
});

export const insightGapSchema = z.object({
  skill: z.string().max(120),
  opportunityCount: z.number().int().positive(),
});

export const insightSalarySchema = z.object({
  observedMinMinor: z.number().int().positive().nullable(),
  observedMaxMinor: z.number().int().positive().nullable(),
  observedCurrency: z.string().length(3).nullable(),
  observedSampleSize: z.number().int().nonnegative(),
  expectationMinMinor: z.number().int().positive().nullable(),
  expectationMaxMinor: z.number().int().positive().nullable(),
  expectationCurrency: z.string().length(3).nullable(),
  /** Null when no expectation is stated, because there is nothing to compare. */
  belowExpectationCount: z.number().int().nonnegative().nullable(),
});

export const insightDirectionSchema = z.object({
  title: z.string().max(300),
  opportunityCount: z.number().int().positive(),
  averageScore: z.number().min(0).max(100).nullable(),
});

export const insightActivitySchema = z.object({
  weekStart: z.iso.date(),
  opportunitiesMatched: z.number().int().nonnegative(),
  applicationsStarted: z.number().int().nonnegative(),
});

export const coachSuggestionSchema = z.object({
  key: z.string().max(60),
  title: z.string().max(200),
  detail: z.string().max(1000),
  action: z.string().max(300),
  priority: z.number().int().min(1).max(10),
  evidence: z.record(z.string(), z.unknown()),
});

export const careerInsightsSchema = z.object({
  hasProfile: z.boolean(),
  careerProfileId: z.uuid().optional(),
  profileName: z.string().max(120).optional(),
  windowWeeks: z.number().int().min(1).max(52).optional(),
  confirmedFactCount: z.number().int().nonnegative().optional(),
  profileStrength: profileStrengthSchema.nullable(),
  matching: insightMatchingSchema.nullable(),
  pipeline: insightPipelineSchema.nullable(),
  gaps: z.array(insightGapSchema),
  salary: insightSalarySchema.nullable(),
  directions: z.array(insightDirectionSchema),
  activity: z.array(insightActivitySchema),
  coaching: z.array(coachSuggestionSchema),
  evaluatedAt: isoTimestamp.optional(),
});

export const careerInsightsQuerySchema = z
  .object({
    careerProfileId: z.uuid().optional(),
    windowWeeks: z.coerce.number().int().min(1).max(52).default(8),
  })
  .strict();

export type CareerInsights = z.infer<typeof careerInsightsSchema>;
export type CoachSuggestion = z.infer<typeof coachSuggestionSchema>;
export type ProfileStrength = z.infer<typeof profileStrengthSchema>;
export type InsightGap = z.infer<typeof insightGapSchema>;
