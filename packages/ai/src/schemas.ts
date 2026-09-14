/**
 * The fixed output schemas.
 *
 * One schema per task, authored here and nowhere else. A provider is sent this
 * document and validated against the same Zod object, so a model cannot widen
 * its own output: an extra field, a missing field, or a score the model chose
 * for itself fails validation rather than reaching a caller.
 *
 * The shape of the opportunity report is itself a truth-gate rule. There is no
 * score field and no confidence field to fill in, because those values are
 * computed by `@hanaply/matching` and quoted. `whatNotToClaim` is required, so a
 * report cannot be produced without stating what must not be asserted.
 */

import { z } from 'zod';

import { defineAiSchema, type AiStructuredSchema } from './types.js';

const boundedLine = z.string().trim().min(1).max(600);
const boundedParagraph = z.string().trim().min(1).max(2_000);
const boundedList = (maximum: number) => z.array(boundedLine).min(1).max(maximum);

export const opportunityAnalysisSchema = z
  .object({
    verdict: z.object({
      /** The model restates the deterministic verdict; it never picks one. */
      restatesMatchVerdict: z.boolean(),
      summary: boundedParagraph,
    }),
    whyInteresting: boundedList(6),
    strongestEvidence: z
      .array(
        z.object({
          factId: z.string().trim().min(1).max(80),
          insight: boundedLine,
        }),
      )
      .max(8),
    transferableStrengths: boundedList(6),
    gaps: boundedList(8),
    hardBlockers: z.array(boundedLine).max(6),
    rejectionRisks: z.array(boundedLine).max(8),
    careerDirection: boundedList(5),
    salaryAndLocationConcerns: boundedList(6),
    whatToEmphasise: boundedList(6),
    /** Rendered wherever the report is shown. Required, never empty. */
    whatNotToClaim: boundedList(8),
    recommendedNextAction: boundedParagraph,
    applicationStrategy: boundedList(6),
    interviewStrategy: boundedList(6),
  })
  .strict();

export type OpportunityAnalysisOutput = z.infer<typeof opportunityAnalysisSchema>;

export const applicationArtifactKindSchema = z.enum([
  'resume',
  'cover_letter',
  'strategy',
  'requirement_map',
  'recruiter_message',
  'interview_prep',
]);

export const applicationArtifactSchema = z
  .object({
    kind: applicationArtifactKindSchema,
    title: z.string().trim().min(1).max(200),
    sections: z
      .array(
        z.object({
          heading: z.string().trim().min(1).max(120),
          paragraphs: z.array(boundedParagraph).max(20),
        }),
      )
      .min(1)
      .max(12),
    evidenceFactIds: z.array(z.string().trim().min(1).max(80)).max(40),
  })
  .strict();

export type ApplicationArtifactOutput = z.infer<typeof applicationArtifactSchema>;

export const coachingSchema = z
  .object({
    /**
     * Verified statements. Every entry carries the confirmed facts behind it, so
     * an uncited assertion cannot be presented in the facts channel.
     */
    facts: z
      .array(
        z.object({
          statement: boundedParagraph,
          evidenceFactIds: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
        }),
      )
      .max(10),
    /** Inference, labelled as such at the type level. */
    suggestions: z
      .array(
        z.object({
          kind: z.literal('inference'),
          statement: boundedParagraph,
          rationale: boundedLine,
        }),
      )
      .max(10),
    questionsToConfirm: z.array(boundedLine).max(8),
    nextSteps: z.array(boundedLine).max(8),
  })
  .strict();

export type CoachingOutput = z.infer<typeof coachingSchema>;

export const opportunityAnalysisAiSchema: AiStructuredSchema<OpportunityAnalysisOutput> =
  defineAiSchema('hanaply_opportunity_analysis_v1', opportunityAnalysisSchema);

export const applicationArtifactAiSchema: AiStructuredSchema<ApplicationArtifactOutput> =
  defineAiSchema('hanaply_application_artifact_v1', applicationArtifactSchema);

export const coachingAiSchema: AiStructuredSchema<CoachingOutput> = defineAiSchema(
  'hanaply_career_coaching_v1',
  coachingSchema,
);
