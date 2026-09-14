import { z } from 'zod';

import { jobStatusSchema } from './jobs.js';

/**
 * Administrative job-operations contracts.
 *
 * These shapes are operator-only. They deliberately expose provider health,
 * raw ingestion counters, content fingerprints, and deduplication signals that
 * are never surfaced on a customer-facing route.
 */

const isoTimestamp = z.iso.datetime({ offset: true });

export const jobSourceKindSchema = z.enum([
  'remotive',
  'arbeitnow',
  'greenhouse',
  'lever',
  'ashby',
  'hn_algolia',
  'adzuna',
  'jooble',
  'partner_feed',
  'manual',
]);

export const jobSourceStatusSchema = z.enum(['active', 'paused', 'disabled']);
export const jobIngestionRunStatusSchema = z.enum(['running', 'succeeded', 'partial', 'failed']);
export const jobIngestionTriggerSchema = z.enum(['schedule', 'manual', 'backfill', 'retry']);

export const adminJobSourceSchema = z.object({
  id: z.uuid(),
  code: z.string().max(64),
  displayName: z.string().max(120),
  sourceKind: jobSourceKindSchema,
  status: jobSourceStatusSchema,
  baseUrl: z.string().max(500),
  attribution: z.string().max(300),
  termsUrl: z.string().max(500).nullable(),
  requiresCredentials: z.boolean(),
  credentialEnvVar: z.string().max(80).nullable(),
  minScanIntervalMinutes: z.number().int(),
  requestsPerMinute: z.number().int(),
  batchSize: z.number().int(),
  config: z.record(z.string(), z.unknown()),
  lastSuccessAt: isoTimestamp.nullable(),
  lastFailureAt: isoTimestamp.nullable(),
  lastErrorCode: z.string().max(80).nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  circuitOpenUntil: isoTimestamp.nullable(),
  totalJobsIngested: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  jobCount: z.number().int().nonnegative(),
  /**
   * Whether the credential is present can only be answered by the worker
   * process, never by the database, so this is null when the variable name is
   * known but the secret cannot be observed from here.
   */
  credentialConfigured: z.boolean().nullable(),
  due: z.boolean(),
});

export const adminJobSourceDirectorySchema = z.object({
  items: z.array(adminJobSourceSchema),
  evaluatedAt: isoTimestamp,
});

export const adminIngestionRunSchema = z.object({
  id: z.uuid(),
  trigger: jobIngestionTriggerSchema,
  status: jobIngestionRunStatusSchema,
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  fetchedCount: z.number().int().nonnegative(),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  errorCode: z.string().max(80).nullable(),
});

export const adminIngestionHealthSchema = z.object({
  sources: z.array(
    z.object({
      sourceId: z.uuid(),
      sourceCode: z.string().max(64),
      displayName: z.string().max(120),
      status: jobSourceStatusSchema,
      lastSuccessAt: isoTimestamp.nullable(),
      lastFailureAt: isoTimestamp.nullable(),
      lastErrorCode: z.string().max(80).nullable(),
      consecutiveFailures: z.number().int().nonnegative(),
      circuitOpenUntil: isoTimestamp.nullable(),
      totalJobsIngested: z.number().int().nonnegative(),
      recentRuns: z.array(adminIngestionRunSchema),
    }),
  ),
  recentRuns: z.array(
    z.object({
      id: z.uuid(),
      sourceCode: z.string().max(64),
      status: jobIngestionRunStatusSchema,
      startedAt: isoTimestamp,
      durationMs: z.number().int().nonnegative().nullable(),
      createdCount: z.number().int().nonnegative(),
      errorCode: z.string().max(80).nullable(),
    }),
  ),
  totals: z.object({
    activeJobs: z.number().int().nonnegative(),
    staleJobs: z.number().int().nonnegative(),
    expiredJobs: z.number().int().nonnegative(),
    companies: z.number().int().nonnegative(),
    sourceRecords: z.number().int().nonnegative(),
    openDeduplicationCandidates: z.number().int().nonnegative(),
  }),
  evaluatedAt: isoTimestamp,
});

export const adminJobListItemSchema = z.object({
  id: z.uuid(),
  title: z.string().max(300),
  companyName: z.string().max(200),
  status: jobStatusSchema,
  remoteState: z.enum(['remote', 'hybrid', 'onsite', 'unspecified']),
  countryCode: z.string().length(2).nullable(),
  sourceCount: z.number().int().positive(),
  postedAt: isoTimestamp.nullable(),
  firstSeenAt: isoTimestamp,
  lastSeenAt: isoTimestamp,
  dedupKey: z.string().max(400),
});

export const adminJobDirectorySchema = z.object({
  items: z.array(adminJobListItemSchema),
  total: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  pageOffset: z.number().int().nonnegative(),
});

export const adminJobDetailSchema = z.object({
  id: z.uuid(),
  title: z.string().max(300),
  companyName: z.string().max(200),
  employmentType: z.enum([
    'full_time',
    'part_time',
    'contract',
    'freelance',
    'internship',
    'temporary',
    'volunteer',
  ]),
  seniority: z.string().max(40),
  remoteState: z.enum(['remote', 'hybrid', 'onsite', 'unspecified']),
  locationRaw: z.string().max(300).nullable(),
  city: z.string().max(120).nullable(),
  region: z.string().max(120).nullable(),
  countryCode: z.string().length(2).nullable(),
  isPhilippines: z.boolean(),
  isInternational: z.boolean(),
  salaryMinMinor: z.number().int().positive().nullable(),
  salaryMaxMinor: z.number().int().positive().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  salaryPeriod: z.enum(['hourly', 'daily', 'monthly', 'annual']).nullable(),
  salaryIsEstimate: z.boolean(),
  skills: z.array(z.string().max(100)),
  sourceCount: z.number().int().positive(),
  status: jobStatusSchema,
  excerpt: z.string().max(600),
  description: z.string().max(40_000),
  dedupKey: z.string().max(400),
  contentFingerprint: z.string().length(64),
  normalizedTitle: z.string().max(300),
  requirements: z.array(z.string().max(500)),
  preferredQualifications: z.array(z.string().max(500)),
  postedAt: isoTimestamp.nullable(),
  expiresAt: isoTimestamp.nullable(),
  firstSeenAt: isoTimestamp,
  lastSeenAt: isoTimestamp,
  lastVerifiedAt: isoTimestamp.nullable(),
  sources: z.array(
    z.object({
      sourceRecordId: z.uuid(),
      sourceCode: z.string().max(64),
      displayName: z.string().max(120),
      sourceJobId: z.string().max(200),
      sourceUrl: z.string().max(1000),
      status: z.enum(['active', 'removed', 'stale']),
      isPrimary: z.boolean(),
      firstSeenAt: isoTimestamp,
      lastSeenAt: isoTimestamp,
      payloadChecksum: z.string().length(64),
    }),
  ),
  duplicateCandidates: z.array(
    z.object({
      id: z.uuid(),
      otherJobId: z.uuid(),
      score: z.number(),
      signals: z.record(z.string(), z.unknown()),
      resolution: z.enum(['merged', 'kept_separate']).nullable(),
      createdAt: isoTimestamp,
    }),
  ),
});

export const adminDedupCandidatesSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      jobId: z.uuid(),
      jobTitle: z.string().max(300),
      jobCompany: z.string().max(200),
      duplicateJobId: z.uuid(),
      duplicateTitle: z.string().max(300),
      duplicateCompany: z.string().max(200),
      duplicateSourceCount: z.number().int().positive(),
      score: z.number(),
      signals: z.record(z.string(), z.unknown()),
      resolution: z.enum(['merged', 'kept_separate']).nullable(),
      resolvedAt: isoTimestamp.nullable(),
      createdAt: isoTimestamp,
    }),
  ),
  openCount: z.number().int().nonnegative(),
  evaluatedAt: isoTimestamp,
});

export const adminJobSourceParamsSchema = z.object({ sourceId: z.uuid() });
export const adminJobParamsSchema = z.object({ jobId: z.uuid() });
export const adminDedupParamsSchema = z.object({ candidateId: z.uuid() });

export const adminJobSourceStateSchema = z
  .object({
    action: z.enum(['enable', 'pause', 'disable']),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export const adminJobSourceConfigSchema = z
  .object({
    config: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export const adminJobStatusSchema = z
  .object({
    status: z.enum(['active', 'rejected', 'closed', 'expired']),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export const adminDedupResolutionSchema = z
  .object({
    resolution: z.enum(['merged', 'kept_separate']),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export const adminJobDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    status: jobStatusSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const adminDedupQuerySchema = z
  .object({
    includeResolved: z.coerce.boolean().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type AdminJobSource = z.infer<typeof adminJobSourceSchema>;
export type AdminJobSourceDirectory = z.infer<typeof adminJobSourceDirectorySchema>;
export type AdminIngestionHealth = z.infer<typeof adminIngestionHealthSchema>;
export type AdminJobDirectory = z.infer<typeof adminJobDirectorySchema>;
export type AdminJobDetail = z.infer<typeof adminJobDetailSchema>;
export type AdminDedupCandidates = z.infer<typeof adminDedupCandidatesSchema>;
