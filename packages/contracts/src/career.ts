import { z } from 'zod';

/**
 * Career Intelligence Profile contracts.
 *
 * These schemas are the single source of truth for the career API surface: the
 * API validates requests and responses against them, the checked-in OpenAPI
 * artifact is generated from them, and the web and future mobile clients share
 * the inferred types.
 *
 * Two product rules are encoded here rather than in UI copy:
 *
 *   1. Facts carry an explicit source and status. Extraction can only produce
 *      `candidate` facts, so a client can never present extracted content as
 *      verified.
 *   2. Structured metrics travel as a value plus a unit. There is no free-text
 *      number field for generated application material to quote.
 */

export const careerLevelSchema = z.enum([
  'student',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive',
]);

export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'internship',
  'temporary',
  'volunteer',
]);

export const workArrangementSchema = z.enum(['remote', 'hybrid', 'onsite', 'flexible']);

export const availabilitySchema = z.enum([
  'immediately',
  'two_weeks',
  'one_month',
  'three_months',
  'not_looking',
]);

export const salaryPeriodSchema = z.enum(['hourly', 'daily', 'monthly', 'annual']);

export const proficiencyLevelSchema = z.enum(['beginner', 'intermediate', 'advanced', 'expert']);

export const careerSkillKindSchema = z.enum([
  'skill',
  'tool',
  'technology',
  'language',
  'soft_skill',
  'domain',
]);

export const careerLinkKindSchema = z.enum([
  'github',
  'gitlab',
  'linkedin',
  'portfolio',
  'personal_website',
  'behance',
  'dribbble',
  'stackoverflow',
  'other',
]);

export const careerFactCategorySchema = z.enum([
  'experience',
  'responsibility',
  'achievement',
  'metric',
  'skill',
  'education',
  'certification',
  'preference',
  'goal',
]);

export const careerFactSourceSchema = z.enum([
  'user_entered',
  'resume_extraction',
  'ai_inference',
  'imported',
]);

export const careerFactStatusSchema = z.enum(['candidate', 'confirmed', 'rejected', 'superseded']);

export const careerProfileStatusSchema = z.enum(['draft', 'active', 'archived']);

export const careerRecordKindSchema = z.enum([
  'sub_career',
  'employment',
  'project',
  'education',
  'certification',
  'link',
  'skill',
]);

export const careerDocumentKindSchema = z.enum(['resume', 'cover_letter', 'portfolio', 'other']);

export const careerDocumentStatusSchema = z.enum([
  'uploaded',
  'processing',
  'parsed',
  'needs_review',
  'failed',
  'rejected',
  'archived',
]);

export const careerDocumentMimeTypeSchema = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'text/markdown',
]);

const isoTimestamp = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalBoundedText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const httpsOrOptionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => /^https?:\/\/[^\s]+$/u.test(value),
    'Enter a full web address starting with http:// or https://.',
  );

export const moneyMinorSchema = z
  .number()
  .int()
  .positive()
  .max(2_000_000_000)
  .describe('Amount in minor units of the currency, for example centavos for PHP.');

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export const careerCompletenessSchema = z.object({
  percent: z.number().int().min(0).max(100),
  missing: z.array(z.string().max(60)),
  counts: z.object({
    employment: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
    education: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
    confirmedFacts: z.number().int().nonnegative(),
  }),
});

export const careerSalaryExpectationSchema = z.object({
  minMinor: moneyMinorSchema,
  maxMinor: moneyMinorSchema.nullable(),
  currency: z.string().length(3),
  period: salaryPeriodSchema.nullable(),
});

export const careerProfileSummarySchema = z.object({
  id: z.uuid(),
  name: boundedText(120),
  isPrimary: z.boolean(),
  status: careerProfileStatusSchema,
  headline: boundedText(160).nullable(),
  currentRoleTitle: boundedText(160).nullable(),
  careerLevel: careerLevelSchema.nullable(),
  yearsExperience: z.number().min(0).max(80).nullable(),
  targetRoleTitles: z.array(z.string().max(120)),
  preferredWorkArrangement: workArrangementSchema.nullable(),
  completenessPercent: z.number().int().min(0).max(100),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const careerSubCareerSchema = z.object({
  id: z.uuid(),
  name: boundedText(120),
  focus: boundedText(1_000).nullable(),
  keywords: z.array(z.string().max(60)),
  priority: z.number().int().min(0).max(100),
});

export const careerEmploymentSchema = z.object({
  id: z.uuid(),
  companyName: boundedText(160),
  companyUrl: z.string().max(500).nullable(),
  roleTitle: boundedText(160),
  employmentType: employmentTypeSchema,
  workArrangement: workArrangementSchema.nullable(),
  location: z.string().max(160).nullable(),
  countryCode: z.string().length(2).nullable(),
  industry: z.string().max(120).nullable(),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  isCurrent: z.boolean(),
  summary: z.string().max(2_000).nullable(),
  highlights: z.array(z.string().max(400)),
  skills: z.array(z.string().max(60)),
  displayOrder: z.number().int().min(0).max(1_000),
});

export const careerProjectSchema = z.object({
  id: z.uuid(),
  name: boundedText(160),
  roleTitle: z.string().max(160).nullable(),
  description: z.string().max(2_000).nullable(),
  projectUrl: z.string().max(500).nullable(),
  repositoryUrl: z.string().max(500).nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  isFeatured: z.boolean(),
  highlights: z.array(z.string().max(400)),
  skills: z.array(z.string().max(60)),
  displayOrder: z.number().int().min(0).max(1_000),
});

export const careerEducationSchema = z.object({
  id: z.uuid(),
  institution: boundedText(160),
  degree: z.string().max(160).nullable(),
  fieldOfStudy: z.string().max(160).nullable(),
  startYear: z.number().int().min(1_930).max(2_100).nullable(),
  endYear: z.number().int().min(1_930).max(2_100).nullable(),
  isCurrent: z.boolean(),
  grade: z.string().max(60).nullable(),
  description: z.string().max(1_000).nullable(),
});

export const careerCertificationSchema = z.object({
  id: z.uuid(),
  name: boundedText(160),
  issuer: z.string().max(160).nullable(),
  credentialId: z.string().max(120).nullable(),
  credentialUrl: z.string().max(500).nullable(),
  issuedOn: isoDate.nullable(),
  expiresOn: isoDate.nullable(),
});

export const careerLinkSchema = z.object({
  id: z.uuid(),
  linkKind: careerLinkKindSchema,
  label: z.string().max(80).nullable(),
  url: z.string().max(500),
  displayOrder: z.number().int().min(0).max(1_000),
});

export const careerSkillSchema = z.object({
  id: z.uuid(),
  name: boundedText(100),
  skillKind: careerSkillKindSchema,
  proficiency: proficiencyLevelSchema.nullable(),
  yearsExperience: z.number().min(0).max(80).nullable(),
  lastUsedYear: z.number().int().min(1_930).max(2_100).nullable(),
  isPrimary: z.boolean(),
  displayOrder: z.number().int().min(0).max(1_000),
});

export const careerFactCountsSchema = z.object({
  candidate: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});

export const careerProfileDetailSchema = careerProfileSummarySchema.extend({
  summary: z.string().max(4_000).nullable(),
  industries: z.array(z.string().max(80)),
  excludedRoleTitles: z.array(z.string().max(120)),
  preferredEmploymentTypes: z.array(employmentTypeSchema),
  preferredLocations: z.array(z.string().max(120)),
  openToInternational: z.boolean(),
  openToRelocation: z.boolean(),
  workAuthorizations: z.array(z.string().max(120)),
  availability: availabilitySchema.nullable(),
  salaryExpectation: careerSalaryExpectationSchema.nullable(),
  careerGoals: z.string().max(2_000).nullable(),
  lastReviewedAt: isoTimestamp.nullable(),
  completeness: careerCompletenessSchema,
  subCareers: z.array(careerSubCareerSchema),
  employment: z.array(careerEmploymentSchema),
  projects: z.array(careerProjectSchema),
  education: z.array(careerEducationSchema),
  certifications: z.array(careerCertificationSchema),
  links: z.array(careerLinkSchema),
  skills: z.array(careerSkillSchema),
  factCounts: careerFactCountsSchema,
});

export const careerProfileDirectorySchema = z.object({
  items: z.array(careerProfileSummarySchema),
  limits: z.object({
    careerProfileLimit: z.number().int().nonnegative(),
    subCareerLimitPerProfile: z.number().int().nonnegative(),
  }),
});

export const careerFactEvidenceSchema = z
  .object({
    kind: z.string().max(40).optional(),
    id: z.uuid().optional(),
  })
  .catchall(z.unknown());

export const careerFactSchema = z.object({
  id: z.uuid(),
  careerProfileId: z.uuid(),
  category: careerFactCategorySchema,
  statement: boundedText(500),
  source: careerFactSourceSchema,
  status: careerFactStatusSchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: careerFactEvidenceSchema,
  metricValue: z.number().nullable(),
  metricUnit: z.string().max(40).nullable(),
  metricContext: z.string().max(240).nullable(),
  documentId: z.uuid().nullable(),
  confirmedAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
});

export const careerFactDirectorySchema = z.object({ items: z.array(careerFactSchema) });

export const careerFactCreationResultSchema = z.object({
  createdIds: z.array(z.uuid()),
});

export const careerFactDecisionResultSchema = z.object({
  originalId: z.uuid(),
  replacementId: z.uuid().nullable(),
  facts: careerFactDirectorySchema,
});

export const careerDocumentSchema = z.object({
  id: z.uuid(),
  careerProfileId: z.uuid().nullable(),
  documentKind: careerDocumentKindSchema,
  status: careerDocumentStatusSchema,
  originalFilename: boundedText(160),
  mimeType: careerDocumentMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().length(64),
  pageCount: z.number().int().positive().nullable(),
  wordCount: z.number().int().nonnegative().nullable(),
  parsedAt: isoTimestamp.nullable(),
  isActive: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const careerDocumentDirectorySchema = z.object({
  items: z.array(careerDocumentSchema),
});

/**
 * Extraction draft produced by the deterministic and (when enabled) AI
 * extractors. Everything here is a proposal. `confirmable` is false whenever the
 * extractor could not ground a value in the document text, which is how the
 * pipeline refuses to invent employment history or metrics.
 */
export const careerExtractionFieldSchema = z.object({
  value: z.string().max(500),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(400).nullable(),
});

export const careerExtractionSkillSchema = z.object({
  name: z.string().max(100),
  skillKind: careerSkillKindSchema,
});

export const careerExtractionEmploymentSchema = z.object({
  companyName: careerExtractionFieldSchema,
  roleTitle: careerExtractionFieldSchema,
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  isCurrent: z.boolean(),
  location: careerExtractionFieldSchema.nullable(),
  highlights: z.array(careerExtractionFieldSchema),
  skills: z.array(z.string().max(60)),
});

export const careerExtractionEducationSchema = z.object({
  institution: careerExtractionFieldSchema,
  degree: careerExtractionFieldSchema.nullable(),
  fieldOfStudy: careerExtractionFieldSchema.nullable(),
  endYear: z.number().int().min(1_930).max(2_100).nullable(),
});

export const careerDocumentExtractionSchema = z.object({
  documentId: z.uuid(),
  status: careerDocumentStatusSchema,
  extractor: z.enum(['deterministic', 'ai']).nullable(),
  extractorVersion: z.string().max(80).nullable(),
  wordCount: z.number().int().nonnegative().nullable(),
  headline: careerExtractionFieldSchema.nullable(),
  summary: careerExtractionFieldSchema.nullable(),
  skills: z.array(careerExtractionSkillSchema),
  employment: z.array(careerExtractionEmploymentSchema),
  education: z.array(careerExtractionEducationSchema),
  certifications: z.array(careerExtractionFieldSchema),
  links: z.array(z.object({ linkKind: careerLinkKindSchema, url: z.string().max(500) })),
  candidateFacts: z.array(
    z.object({
      statement: z.string().max(500),
      category: careerFactCategorySchema,
      confidence: z.number().min(0).max(1),
      metricValue: z.number().nullable(),
      metricUnit: z.string().max(40).nullable(),
    }),
  ),
  warnings: z.array(z.string().max(200)),
});

export const careerDocumentApplySchema = z
  .object({
    careerProfileId: z.uuid(),
    applyContact: z.boolean().optional(),
    employmentIndexes: z.array(z.number().int().nonnegative()).max(30).optional(),
    educationIndexes: z.array(z.number().int().nonnegative()).max(20).optional(),
    certificationIndexes: z.array(z.number().int().nonnegative()).max(40).optional(),
    skillNames: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
    linkKinds: z.array(careerLinkKindSchema).max(10).optional(),
    factIndexes: z.array(z.number().int().nonnegative()).max(200).optional(),
    confirmSelected: z.boolean().optional(),
  })
  .strict();

export const careerDocumentParamsSchema = z.object({ documentId: z.uuid() });

export const careerDocumentUploadSchema = z.object({
  file: z
    .string()
    .meta({
      format: 'binary',
      description: 'PDF, DOCX, RTF, plain-text, or Markdown resume bytes',
    }),
});

export const careerDocumentUploadQuerySchema = z
  .object({
    documentKind: careerDocumentKindSchema.default('resume'),
    careerProfileId: z.uuid().optional(),
  })
  .strict();

export const confirmedCareerEvidenceSchema = z.object({
  careerProfileId: z.uuid(),
  facts: z.array(
    z.object({
      id: z.uuid(),
      category: careerFactCategorySchema,
      statement: z.string().max(500),
      source: careerFactSourceSchema,
      metricValue: z.number().nullable(),
      metricUnit: z.string().max(40).nullable(),
      metricContext: z.string().max(240).nullable(),
      evidence: careerFactEvidenceSchema,
      confirmedAt: isoTimestamp,
    }),
  ),
});

export type CareerDocumentExtraction = z.infer<typeof careerDocumentExtractionSchema>;
export type ConfirmedCareerEvidence = z.infer<typeof confirmedCareerEvidenceSchema>;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const textArray = (maximumItems: number, maximumLength: number) =>
  z.array(z.string().trim().min(1).max(maximumLength)).max(maximumItems);

export const careerProfileInputSchema = z
  .object({
    name: boundedText(120),
    headline: optionalBoundedText(160),
    summary: optionalBoundedText(4_000),
    currentRoleTitle: optionalBoundedText(160),
    careerLevel: careerLevelSchema.nullable().optional(),
    yearsExperience: z.number().min(0).max(80).nullable().optional(),
    industries: textArray(20, 80).optional(),
    targetRoleTitles: textArray(15, 120).optional(),
    excludedRoleTitles: textArray(15, 120).optional(),
    preferredEmploymentTypes: z.array(employmentTypeSchema).max(7).optional(),
    preferredWorkArrangement: workArrangementSchema.nullable().optional(),
    preferredLocations: textArray(20, 120).optional(),
    openToInternational: z.boolean().optional(),
    openToRelocation: z.boolean().optional(),
    workAuthorizations: textArray(15, 120).optional(),
    availability: availabilitySchema.nullable().optional(),
    salaryMinMinor: moneyMinorSchema.nullable().optional(),
    salaryMaxMinor: moneyMinorSchema.nullable().optional(),
    salaryCurrency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
    salaryPeriod: salaryPeriodSchema.nullable().optional(),
    careerGoals: optionalBoundedText(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.salaryMinMinor != null &&
      value.salaryMaxMinor != null &&
      value.salaryMaxMinor < value.salaryMinMinor
    ) {
      context.addIssue({
        code: 'custom',
        path: ['salaryMaxMinor'],
        message: 'The maximum expectation cannot be lower than the minimum.',
      });
    }
    if (value.salaryPeriod != null && value.salaryMinMinor == null) {
      context.addIssue({
        code: 'custom',
        path: ['salaryMinMinor'],
        message: 'Enter a minimum expectation before choosing a pay period.',
      });
    }
  });

export const careerProfileUpdateSchema = careerProfileInputSchema.safeExtend({
  expectedVersion: z.number().int().nonnegative(),
});

export const subCareerInputSchema = z
  .object({
    name: boundedText(120),
    focus: optionalBoundedText(1_000),
    keywords: textArray(25, 60).optional(),
    priority: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const employmentInputSchema = z
  .object({
    companyName: boundedText(160),
    companyUrl: httpsOrOptionalUrl.nullable().optional(),
    roleTitle: boundedText(160),
    employmentType: employmentTypeSchema.optional(),
    workArrangement: workArrangementSchema.nullable().optional(),
    location: optionalBoundedText(160),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .nullable()
      .optional(),
    industry: optionalBoundedText(120),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    isCurrent: z.boolean().optional(),
    summary: optionalBoundedText(2_000),
    highlights: textArray(12, 400).optional(),
    skills: textArray(30, 60).optional(),
    displayOrder: z.number().int().min(0).max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isCurrent === true && value.endDate != null) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'A current role cannot have an end date.',
      });
    }
    if (value.endDate != null && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'The end date cannot be earlier than the start date.',
      });
    }
  });

export const projectInputSchema = z
  .object({
    name: boundedText(160),
    roleTitle: optionalBoundedText(160),
    description: optionalBoundedText(2_000),
    projectUrl: httpsOrOptionalUrl.nullable().optional(),
    repositoryUrl: httpsOrOptionalUrl.nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    isFeatured: z.boolean().optional(),
    highlights: textArray(12, 400).optional(),
    skills: textArray(30, 60).optional(),
    displayOrder: z.number().int().min(0).max(1_000).optional(),
  })
  .strict();

export const educationInputSchema = z
  .object({
    institution: boundedText(160),
    degree: optionalBoundedText(160),
    fieldOfStudy: optionalBoundedText(160),
    startYear: z.number().int().min(1_930).max(2_100).nullable().optional(),
    endYear: z.number().int().min(1_930).max(2_100).nullable().optional(),
    isCurrent: z.boolean().optional(),
    grade: optionalBoundedText(60),
    description: optionalBoundedText(1_000),
  })
  .strict();

export const certificationInputSchema = z
  .object({
    name: boundedText(160),
    issuer: optionalBoundedText(160),
    credentialId: optionalBoundedText(120),
    credentialUrl: httpsOrOptionalUrl.nullable().optional(),
    issuedOn: isoDate.nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
  })
  .strict();

export const linkInputSchema = z
  .object({
    linkKind: careerLinkKindSchema,
    label: optionalBoundedText(80),
    url: httpsOrOptionalUrl,
    displayOrder: z.number().int().min(0).max(1_000).optional(),
  })
  .strict();

export const skillInputSchema = z
  .object({
    name: boundedText(100),
    skillKind: careerSkillKindSchema.optional(),
    proficiency: proficiencyLevelSchema.nullable().optional(),
    yearsExperience: z.number().min(0).max(80).nullable().optional(),
    lastUsedYear: z.number().int().min(1_930).max(2_100).nullable().optional(),
    isPrimary: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(1_000).optional(),
  })
  .strict();

export const careerRecordInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sub_career'),
    recordId: z.uuid().optional(),
    record: subCareerInputSchema,
  }),
  z.object({
    kind: z.literal('employment'),
    recordId: z.uuid().optional(),
    record: employmentInputSchema,
  }),
  z.object({
    kind: z.literal('project'),
    recordId: z.uuid().optional(),
    record: projectInputSchema,
  }),
  z.object({
    kind: z.literal('education'),
    recordId: z.uuid().optional(),
    record: educationInputSchema,
  }),
  z.object({
    kind: z.literal('certification'),
    recordId: z.uuid().optional(),
    record: certificationInputSchema,
  }),
  z.object({ kind: z.literal('link'), recordId: z.uuid().optional(), record: linkInputSchema }),
  z.object({ kind: z.literal('skill'), recordId: z.uuid().optional(), record: skillInputSchema }),
]);

export type CareerRecordInput = z.infer<typeof careerRecordInputSchema>;

export const careerRecordParamsSchema = z.object({
  profileId: z.uuid(),
  recordKind: careerRecordKindSchema,
  recordId: z.uuid(),
});

export const careerProfileParamsSchema = z.object({ profileId: z.uuid() });

export const careerProfileVersionedParamsSchema = z.object({
  profileId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
});

export const careerFactDecisionSchema = z
  .object({
    decision: z.enum(['confirm', 'reject', 'correct']),
    statement: optionalBoundedText(500),
    metricUnit: optionalBoundedText(40),
    metricValue: z.number().min(-1_000_000_000).max(1_000_000_000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === 'confirm' || value.decision === 'correct') && !value.statement) {
      context.addIssue({
        code: 'custom',
        path: ['statement'],
        message: 'A confirmed claim needs a statement.',
      });
    }
    if ((value.metricValue ?? null) !== null && !value.metricUnit) {
      context.addIssue({
        code: 'custom',
        path: ['metricUnit'],
        message: 'A number needs a unit so it stays truthful.',
      });
    }
    if ((value.metricUnit ?? null) !== null && (value.metricValue ?? null) === null) {
      context.addIssue({
        code: 'custom',
        path: ['metricValue'],
        message: 'Enter the number that belongs with this unit.',
      });
    }
  });

export const careerFactStatusFilterSchema = z.enum(['candidate', 'confirmed', 'rejected']);

export const onboardingStatusRequestSchema = z.enum(['not_started', 'in_progress', 'complete']);

export type CareerProfileSummary = z.infer<typeof careerProfileSummarySchema>;
export type CareerProfileDetail = z.infer<typeof careerProfileDetailSchema>;
export type CareerProfileDirectory = z.infer<typeof careerProfileDirectorySchema>;
export type CareerFact = z.infer<typeof careerFactSchema>;
export type CareerDocument = z.infer<typeof careerDocumentSchema>;
export type CareerCompleteness = z.infer<typeof careerCompletenessSchema>;
export type CareerRecordKind = z.infer<typeof careerRecordKindSchema>;
export type CareerProfileInput = z.infer<typeof careerProfileInputSchema>;
