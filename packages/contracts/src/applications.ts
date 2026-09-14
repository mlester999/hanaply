import { z } from 'zod';

import { jobCardSchema } from './jobs.js';

/**
 * Application Pack and tracker contracts.
 *
 * The pack and every artifact cite the confirmed career facts they were allowed
 * to use. That evidence list is part of the public shape on purpose: the
 * interface can show the user exactly which of their own confirmed facts support
 * a generated claim, which is what makes the output trustworthy.
 */

export const usageFeatureSchema = z.enum([
  'application_pack',
  'resume_variant',
  'cover_letter',
  'ai_analysis',
  'interview_prep',
  'recruiter_message',
  'coach_message',
]);

export const applicationPackStatusSchema = z.enum([
  'queued',
  'generating',
  'ready',
  'failed',
  'archived',
]);

export const applicationArtifactKindSchema = z.enum([
  'resume',
  'cover_letter',
  'strategy',
  'requirement_map',
  'recruiter_message',
  'interview_prep',
]);

export const applicationStageSchema = z.enum([
  'saved',
  'preparing',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
  'archived',
]);

export const applicationSourceKindSchema = z.enum(['hanaply', 'external', 'referral']);

const isoTimestamp = z.iso.datetime({ offset: true });

export const usageItemSchema = z.object({
  feature: usageFeatureSchema,
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});

export const usageSummarySchema = z.object({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  items: z.array(usageItemSchema),
});

export const applicationPackSchema = z.object({
  id: z.uuid(),
  careerProfileId: z.uuid(),
  jobId: z.uuid(),
  status: applicationPackStatusSchema,
  matchSnapshot: z.record(z.string(), z.unknown()),
  modelVersion: z.string().max(60).nullable(),
  promptVersion: z.string().max(60).nullable(),
  evidenceFactIds: z.array(z.uuid()),
  errorCode: z.string().max(80).nullable(),
  generatedAt: isoTimestamp.nullable(),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const applicationPackListItemSchema = applicationPackSchema.extend({
  jobTitle: z.string().max(300),
  companyName: z.string().max(200),
  artifactCount: z.number().int().nonnegative(),
});

export const applicationArtifactSchema = z.object({
  id: z.uuid(),
  packId: z.uuid(),
  kind: applicationArtifactKindSchema,
  style: z.string().max(60).nullable(),
  title: z.string().max(200),
  content: z.record(z.string(), z.unknown()),
  plainText: z.string().max(60_000),
  truthGateStatus: z.enum(['passed', 'needs_review', 'rejected']),
  evidenceFactIds: z.array(z.uuid()),
  version: z.number().int().positive(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const applicationPackDirectorySchema = z.object({
  items: z.array(applicationPackListItemSchema),
  usage: usageSummarySchema,
});

export const applicationPackDetailSchema = applicationPackSchema.extend({
  job: jobCardSchema,
  applyUrl: z.string().max(1000),
  artifacts: z.array(applicationArtifactSchema),
});

export const applicationSnapshotSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  careerProfileId: z.uuid().nullable(),
  packId: z.uuid().nullable(),
  stage: applicationStageSchema,
  source: applicationSourceKindSchema,
  appliedAt: isoTimestamp.nullable(),
  stageChangedAt: isoTimestamp,
  nextActionAt: isoTimestamp.nullable(),
  nextActionNote: z.string().max(300).nullable(),
  notes: z.string().max(4000).nullable(),
  outcomeNote: z.string().max(1000).nullable(),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const applicationTrackerItemSchema = applicationSnapshotSchema.extend({
  jobTitle: z.string().max(300),
  companyName: z.string().max(200),
  remoteState: z.enum(['remote', 'hybrid', 'onsite', 'unspecified']),
  locationRaw: z.string().max(300).nullable(),
  applyUrl: z.string().max(1000),
});

export const applicationTrackerSchema = z.object({
  items: z.array(applicationTrackerItemSchema),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  evaluatedAt: isoTimestamp,
});

export const applicationTimelineSchema = z.object({
  application: applicationSnapshotSchema,
  events: z.array(
    z.object({
      id: z.uuid(),
      eventType: z.string().max(120),
      previousStage: applicationStageSchema.nullable(),
      newStage: applicationStageSchema.nullable(),
      note: z.string().max(1000).nullable(),
      occurredAt: isoTimestamp,
    }),
  ),
});

export const createApplicationPackSchema = z
  .object({
    jobId: z.uuid(),
    careerProfileId: z.uuid(),
  })
  .strict();

export const applicationPackParamsSchema = z.object({ packId: z.uuid() });
export const applicationParamsSchema = z.object({ applicationId: z.uuid() });

export const trackApplicationSchema = z
  .object({
    jobId: z.uuid(),
    careerProfileId: z.uuid().nullable().optional(),
    packId: z.uuid().nullable().optional(),
    stage: applicationStageSchema.optional(),
    source: applicationSourceKindSchema.optional(),
    nextActionAt: isoTimestamp.nullable().optional(),
    nextActionNote: z.string().trim().max(300).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

export const setApplicationStageSchema = z
  .object({
    stage: applicationStageSchema,
    expectedVersion: z.number().int().nonnegative(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export type UsageSummary = z.infer<typeof usageSummarySchema>;
export type ApplicationPack = z.infer<typeof applicationPackSchema>;
export type ApplicationPackListItem = z.infer<typeof applicationPackListItemSchema>;
export type ApplicationPackDetail = z.infer<typeof applicationPackDetailSchema>;
export type ApplicationPackDirectory = z.infer<typeof applicationPackDirectorySchema>;
export type ApplicationArtifact = z.infer<typeof applicationArtifactSchema>;
export type ApplicationStage = z.infer<typeof applicationStageSchema>;
export type ApplicationSnapshot = z.infer<typeof applicationSnapshotSchema>;
export type ApplicationTrackerItem = z.infer<typeof applicationTrackerItemSchema>;
export type ApplicationTracker = z.infer<typeof applicationTrackerSchema>;
export type ApplicationTimeline = z.infer<typeof applicationTimelineSchema>;
