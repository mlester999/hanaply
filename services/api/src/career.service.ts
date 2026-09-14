import {
  careerDocumentApplySchema,
  careerExtractionEmploymentSchema,
  careerFactCategorySchema,
  careerLinkKindSchema,
  careerProfileInputSchema,
  careerRecordInputSchema,
  careerSkillKindSchema,
  createApplicationPackSchema,
  jobFeedbackSchema,
  jobRadarQuerySchema,
  saveJobSchema,
  setApplicationStageSchema,
  trackApplicationSchema,
  type CareerDocument,
  type CareerDocumentExtraction,
  type CareerProfileDetail,
  type CareerProfileDirectory,
  type CareerRecordInput,
  type ConfirmedCareerEvidence,
} from '@hanaply/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AppError, toValidationDetails } from './app-error.js';
import {
  careerDocumentObjectPath,
  readSingleCareerDocument,
  validateCareerDocument,
} from './career-files.js';
import { extractCareerProfile } from './career-extraction.js';
import { CareerRepository, careerError } from './career.repository.js';
import type { AuthenticatedRequest } from './http.js';

const extractionPayloadSchema = z.object({
  extractor: z.enum(['deterministic', 'ai']),
  extractorVersion: z.string().min(1).max(80),
  model: z.string().max(120).nullable(),
  promptVersion: z.string().max(80).nullable(),
  pageCount: z.number().int().min(1).max(500).nullable(),
  wordCount: z.number().int().min(0).max(200000),
  headline: z.unknown().nullable(),
  summary: z.unknown().nullable(),
  skills: z
    .array(z.object({ name: z.string().max(100), skillKind: careerSkillKindSchema }))
    .max(200),
  employment: z.array(careerExtractionEmploymentSchema).max(40),
  education: z
    .array(
      z.object({
        institution: z.unknown(),
        degree: z.unknown().nullable(),
        fieldOfStudy: z.unknown().nullable(),
        endYear: z.number().int().min(1930).max(2100).nullable(),
      }),
    )
    .max(20),
  certifications: z.array(z.unknown()).max(60),
  links: z.array(z.object({ linkKind: careerLinkKindSchema, url: z.string().max(500) })).max(20),
  candidateFacts: z
    .array(
      z.object({
        statement: z.string().min(3).max(500),
        category: careerFactCategorySchema,
        confidence: z.number().min(0).max(1),
        metricValue: z.number().nullable(),
        metricUnit: z.string().max(40).nullable(),
      }),
    )
    .max(200),
  warnings: z.array(z.string().max(200)).max(20),
});

function fieldValue(value: unknown): string | null {
  const parsed = z.object({ value: z.string().max(500) }).safeParse(value);
  return parsed.success ? parsed.data.value : null;
}

@Injectable()
export class CareerService {
  constructor(@Inject(CareerRepository) private readonly repository: CareerRepository) {}

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

  async profiles(request: AuthenticatedRequest): Promise<CareerProfileDirectory> {
    const { userId } = this.actor(request);
    return this.repository.profiles(userId);
  }

  async profile(request: AuthenticatedRequest, profileId: string): Promise<CareerProfileDetail> {
    const { userId } = this.actor(request);
    return this.repository.profile(userId, profileId);
  }

  async createProfile(
    request: AuthenticatedRequest,
    body: unknown,
  ): Promise<{ profileId: string }> {
    const { userId, requestId } = this.actor(request);
    const parsed = careerProfileInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'The career profile is invalid',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    const profileId = await this.repository.createProfile(
      userId,
      toSqlProfileInput(parsed.data),
      requestId,
    );
    return { profileId };
  }

  async updateProfile(
    request: AuthenticatedRequest,
    profileId: string,
    body: unknown,
  ): Promise<{ version: number }> {
    const { userId, requestId } = this.actor(request);
    const parsed = careerProfileInputSchema
      .extend({ expectedVersion: z.number().int().nonnegative() })
      .safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'The career profile update is invalid',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    const { expectedVersion, ...profile } = parsed.data;
    const version = await this.repository.updateProfile(
      userId,
      profileId,
      expectedVersion,
      toSqlProfileInput(profile),
      requestId,
    );
    return { version };
  }

  async setPrimary(
    request: AuthenticatedRequest,
    profileId: string,
  ): Promise<{ changed: boolean }> {
    const { userId, requestId } = this.actor(request);
    return { changed: await this.repository.setPrimaryProfile(userId, profileId, requestId) };
  }

  async setStatus(
    request: AuthenticatedRequest,
    profileId: string,
    body: unknown,
  ): Promise<{ version: number }> {
    const { userId, requestId } = this.actor(request);
    const parsed = z
      .object({ status: z.enum(['draft', 'active', 'archived']) })
      .strict()
      .safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose a valid career profile status',
      });
    }
    const version = await this.repository.setProfileStatus(
      userId,
      profileId,
      parsed.data.status,
      requestId,
    );
    return { version };
  }

  async deleteProfile(
    request: AuthenticatedRequest,
    profileId: string,
  ): Promise<{ deleted: true }> {
    const { userId, requestId } = this.actor(request);
    await this.repository.deleteProfile(userId, profileId, requestId);
    return { deleted: true };
  }

  async upsertRecord(
    request: AuthenticatedRequest,
    profileId: string,
    body: unknown,
  ): Promise<{ recordId: string }> {
    const { userId, requestId } = this.actor(request);
    const parsed = careerRecordInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'The career record is invalid',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    const recordId = await this.repository.upsertRecord(
      userId,
      profileId,
      parsed.data satisfies CareerRecordInput,
      requestId,
    );
    return { recordId };
  }

  async deleteRecord(
    request: AuthenticatedRequest,
    profileId: string,
    recordKind: string,
    recordId: string,
  ): Promise<{ deleted: boolean }> {
    const { userId, requestId } = this.actor(request);
    const kind = careerRecordInputSchema.options
      .map((option) => option.shape.kind.value)
      .find((value) => value === recordKind);
    if (!kind) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Unsupported career record kind',
      });
    }
    return {
      deleted: await this.repository.deleteRecord(userId, profileId, kind, recordId, requestId),
    };
  }

  async facts(request: AuthenticatedRequest, profileId: string, status: string | undefined) {
    const { userId } = this.actor(request);
    const parsed = z.enum(['candidate', 'confirmed', 'rejected']).optional().safeParse(status);
    const items = await this.repository.facts(
      userId,
      profileId,
      parsed.success ? (parsed.data ?? null) : null,
    );
    return { items: [...items] };
  }

  async recordFacts(request: AuthenticatedRequest, profileId: string, body: unknown) {
    const { userId, requestId } = this.actor(request);
    const parsed = z
      .object({
        facts: z
          .array(
            z
              .object({
                statement: z.string().trim().min(3).max(500),
                category: careerFactCategorySchema.optional(),
                metricValue: z.number().nullable().optional(),
                metricUnit: z.string().trim().min(1).max(40).nullable().optional(),
                metricContext: z.string().trim().max(240).nullable().optional(),
                evidence: z.record(z.string(), z.unknown()).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Add at least one claim with a statement between 3 and 500 characters',
        details: toValidationDetails(parsed.error.issues),
      });
    }

    await this.repository.recordFacts(
      userId,
      profileId,
      parsed.data.facts.map((fact) => ({
        statement: fact.statement,
        category: fact.category ?? 'experience',
        metricValue: fact.metricValue ?? null,
        metricUnit: fact.metricUnit ?? null,
        metricContext: fact.metricContext ?? null,
        evidence: fact.evidence ?? {},
      })),
      'user_entered',
      null,
      requestId,
    );

    return this.facts(request, profileId, undefined);
  }

  async decideFact(request: AuthenticatedRequest, factId: string, body: unknown) {
    const { userId, requestId } = this.actor(request);
    const parsed = z
      .object({
        decision: z.enum(['confirm', 'reject', 'correct']),
        statement: z.string().trim().min(3).max(500).nullable().optional(),
        metricUnit: z.string().trim().min(1).max(40).nullable().optional(),
        metricValue: z.number().min(-1_000_000_000).max(1_000_000_000).nullable().optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose confirm, correct, or reject, and give the corrected wording when needed',
      });
    }
    const items = await this.repository.decideFact(
      userId,
      factId,
      parsed.data.decision,
      parsed.data.statement ?? null,
      parsed.data.metricUnit ?? null,
      parsed.data.metricValue ?? null,
      requestId,
    );
    return { items: [...items] };
  }

  async confirmedEvidence(
    request: AuthenticatedRequest,
    profileId: string,
  ): Promise<ConfirmedCareerEvidence> {
    const { userId } = this.actor(request);
    return this.repository.confirmedEvidence(userId, profileId);
  }

  async setOnboardingStatus(
    request: AuthenticatedRequest,
    body: unknown,
  ): Promise<{ changed: boolean }> {
    const { userId, requestId } = this.actor(request);
    const parsed = z
      .object({ status: z.enum(['not_started', 'in_progress', 'complete']) })
      .strict()
      .safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose a valid onboarding status',
      });
    }
    return {
      changed: await this.repository.setOnboardingStatus(userId, parsed.data.status, requestId),
    };
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  async documents(request: AuthenticatedRequest): Promise<{ items: CareerDocument[] }> {
    const { userId } = this.actor(request);
    return { items: [...(await this.repository.documents(userId))] };
  }

  async document(request: AuthenticatedRequest, documentId: string): Promise<CareerDocument> {
    const { userId } = this.actor(request);
    return this.repository.document(userId, documentId);
  }

  async uploadDocument(
    request: AuthenticatedRequest,
    query: { documentKind: CareerDocument['documentKind']; careerProfileId?: string | undefined },
  ): Promise<CareerDocument> {
    const { userId } = this.actor(request);
    const upload = await readSingleCareerDocument(request);
    const validated = await validateCareerDocument(upload);

    // Create the storage object first so a failure never leaves a database row
    // pointing at bytes that do not exist.
    const probeId = crypto.randomUUID();
    const objectPath = careerDocumentObjectPath(userId, probeId, validated.extension);
    const storage = this.storageClient();
    const uploadResult = await storage
      .from('career-documents')
      .upload(objectPath, validated.buffer, {
        contentType: validated.mimeType,
        upsert: false,
      });
    if (uploadResult.error) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'The document could not be stored. Try again in a moment.',
      });
    }

    let documentId: string;
    try {
      documentId = await this.repository.registerDocument(
        userId,
        {
          careerProfileId: query.careerProfileId ?? null,
          documentKind: query.documentKind,
          originalFilename: validated.originalFilename,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          checksumSha256: validated.checksumSha256,
          objectPath,
        },
        request.id,
      );
    } catch (error) {
      await storage.from('career-documents').remove([objectPath]);
      if (error instanceof AppError) throw error;
      throw careerError(
        error as { code?: string; message: string },
        'The document could not be registered',
      );
    }

    // Parsing is deterministic and bounded, so it runs inline and always
    // produces a reviewable draft rather than silently trusting the document.
    try {
      const extraction = extractCareerProfile({
        text: validated.text,
        pageCount: validated.pageCount,
        wordCount: validated.wordCount,
        warnings: validated.warnings,
      });
      await this.repository.recordExtraction(
        userId,
        documentId,
        {
          ...extraction,
          documentId,
          model: null,
          promptVersion: null,
        },
        request.id,
      );
    } catch {
      await this.repository.completeDocumentProcessing(
        userId,
        documentId,
        'failed',
        'extraction_failed',
      );
    }

    return this.repository.document(userId, documentId);
  }

  async documentExtraction(
    request: AuthenticatedRequest,
    documentId: string,
  ): Promise<CareerDocumentExtraction> {
    const { userId } = this.actor(request);
    const detail = await this.repository.documentDetail(userId, documentId);
    const extraction = detail.extraction;
    if (!extraction) {
      throw new AppError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'No extraction is available for this document yet',
      });
    }
    return extraction;
  }

  async documentAccess(
    request: AuthenticatedRequest,
    documentId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const { userId } = this.actor(request);
    const target = await this.repository.documentObject(userId, documentId);
    const ttl = 300;
    const signed = await this.storageClient()
      .from(target.bucketId)
      .createSignedUrl(target.objectPath, ttl, { download: target.originalFilename });
    if (signed.error || !signed.data?.signedUrl) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'A document link could not be created',
      });
    }
    return {
      url: signed.data.signedUrl,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async deleteDocument(
    request: AuthenticatedRequest,
    documentId: string,
  ): Promise<{ deleted: true }> {
    const { userId, requestId } = this.actor(request);
    await this.repository.archiveDocument(userId, documentId, requestId);
    return { deleted: true };
  }

  async applyExtraction(
    request: AuthenticatedRequest,
    documentId: string,
    body: unknown,
  ): Promise<{ createdRecordIds: string[]; createdFactIds: string[] }> {
    const { userId, requestId } = this.actor(request);
    const parsed = careerDocumentApplySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose what to apply to the career profile',
        details: toValidationDetails(parsed.error.issues),
      });
    }

    const extraction = await this.repository.documentDetail(userId, documentId);
    const payload = extractionPayloadSchema.safeParse(extraction.extraction);
    if (!payload.success) {
      throw new AppError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'No extraction is available for this document yet',
      });
    }

    const profileId = parsed.data.careerProfileId;
    const createdRecordIds: string[] = [];
    const employmentIndexes = new Set(parsed.data.employmentIndexes ?? []);

    for (const [index, entry] of payload.data.employment.entries()) {
      if (!employmentIndexes.has(index)) continue;
      const companyName = fieldValue(entry.companyName);
      const roleTitle = fieldValue(entry.roleTitle);
      if (!companyName || !roleTitle || !entry.startDate) continue;
      createdRecordIds.push(
        await this.repository.upsertRecord(
          userId,
          profileId,
          {
            kind: 'employment',
            record: {
              companyName,
              roleTitle,
              startDate: entry.startDate,
              ...(entry.endDate ? { endDate: entry.endDate } : {}),
              isCurrent: entry.isCurrent,
              ...(entry.location ? { location: fieldValue(entry.location) ?? undefined } : {}),
              highlights: entry.highlights
                .map((highlight) => fieldValue(highlight))
                .filter((value): value is string => value !== null),
            },
          },
          requestId,
        ),
      );
    }

    for (const index of new Set(parsed.data.educationIndexes ?? [])) {
      const entry = payload.data.education[index];
      if (!entry) continue;
      const institution = fieldValue(entry.institution);
      if (!institution) continue;
      createdRecordIds.push(
        await this.repository.upsertRecord(
          userId,
          profileId,
          {
            kind: 'education',
            record: {
              institution,
              ...(entry.endYear ? { endYear: entry.endYear } : {}),
              ...(fieldValue(entry.degree)
                ? { degree: fieldValue(entry.degree) ?? undefined }
                : {}),
            },
          },
          requestId,
        ),
      );
    }

    for (const index of new Set(parsed.data.certificationIndexes ?? [])) {
      const entry = payload.data.certifications[index];
      const name = fieldValue(entry);
      if (!name) continue;
      createdRecordIds.push(
        await this.repository.upsertRecord(
          userId,
          profileId,
          { kind: 'certification', record: { name } },
          requestId,
        ),
      );
    }

    const selectedSkillNames = new Set(
      (parsed.data.skillNames ?? []).map((name) => name.trim().toLowerCase()),
    );
    for (const skill of payload.data.skills) {
      if (!selectedSkillNames.has(skill.name.trim().toLowerCase())) continue;
      createdRecordIds.push(
        await this.repository.upsertRecord(
          userId,
          profileId,
          {
            kind: 'skill',
            record: { name: skill.name, skillKind: skill.skillKind },
          },
          requestId,
        ),
      );
    }

    const selectedLinkKinds = new Set(parsed.data.linkKinds ?? []);
    for (const link of payload.data.links) {
      if (!selectedLinkKinds.has(link.linkKind)) continue;
      createdRecordIds.push(
        await this.repository.upsertRecord(
          userId,
          profileId,
          {
            kind: 'link',
            record: { linkKind: link.linkKind, url: link.url },
          },
          requestId,
        ),
      );
    }

    const factIndexes = new Set(parsed.data.factIndexes ?? []);
    const selectedFacts = payload.data.candidateFacts.filter((_fact, index) =>
      factIndexes.has(index),
    );
    let createdFactIds: readonly string[] = [];
    if (selectedFacts.length > 0) {
      createdFactIds = await this.repository.recordFacts(
        userId,
        profileId,
        selectedFacts.map((fact) => ({
          statement: fact.statement,
          category: fact.category,
          metricValue: fact.metricValue,
          metricUnit: fact.metricUnit,
          evidence: { kind: 'document', id: documentId },
        })),
        'resume_extraction',
        documentId,
        requestId,
      );

      // An explicit owner confirmation at apply time promotes the claims the
      // user actually checked; everything else stays a candidate.
      if (parsed.data.confirmSelected === true) {
        for (const factId of createdFactIds) {
          await this.repository.decideFact(userId, factId, 'confirm', null, null, null, requestId);
        }
      }
    }

    return { createdRecordIds, createdFactIds: [...createdFactIds] };
  }

  private storageClient() {
    return this.repository.storageClient();
  }

  // -------------------------------------------------------------------------
  // Career Radar
  // -------------------------------------------------------------------------

  async jobRadar(request: AuthenticatedRequest, query: Record<string, unknown>) {
    const { userId } = this.actor(request);
    const parsed = jobRadarQuerySchema.safeParse(normalizeRadarQuery(query));
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'The feed filters are invalid',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    const { careerProfileId, ...filters } = parsed.data;
    return this.repository.jobRadar(userId, {
      ...filters,
      ...(careerProfileId ? { careerProfileId } : {}),
    });
  }

  async jobDetail(
    request: AuthenticatedRequest,
    jobId: string,
    careerProfileId: string | undefined,
  ) {
    const { userId } = this.actor(request);
    return this.repository.jobDetail(userId, jobId, careerProfileId ?? null);
  }

  async saveJob(
    request: AuthenticatedRequest,
    jobId: string,
    body: unknown,
  ): Promise<{ saved: true }> {
    const { userId, requestId } = this.actor(request);
    const parsed = saveJobSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'The save request is invalid',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    await this.repository.saveJob(
      userId,
      jobId,
      parsed.data.careerProfileId ?? null,
      parsed.data.note ?? null,
      requestId,
    );
    return { saved: true };
  }

  async unsaveJob(request: AuthenticatedRequest, jobId: string): Promise<{ removed: boolean }> {
    const { userId, requestId } = this.actor(request);
    return { removed: await this.repository.unsaveJob(userId, jobId, requestId) };
  }

  async recordJobFeedback(
    request: AuthenticatedRequest,
    jobId: string,
    body: unknown,
  ): Promise<{ recorded: true }> {
    const { userId, requestId } = this.actor(request);
    const parsed = jobFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose the feedback that describes this opportunity',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    await this.repository.recordJobFeedback(
      userId,
      jobId,
      parsed.data.feedback,
      parsed.data.reason ?? null,
      parsed.data.careerProfileId ?? null,
      requestId,
    );
    return { recorded: true };
  }

  // -------------------------------------------------------------------------
  // Application Packs, usage, and tracker
  // -------------------------------------------------------------------------

  async applicationPacks(request: AuthenticatedRequest) {
    const { userId } = this.actor(request);
    return this.repository.applicationPacks(userId);
  }

  async applicationPack(request: AuthenticatedRequest, packId: string) {
    const { userId } = this.actor(request);
    return this.repository.applicationPack(userId, packId);
  }

  async createApplicationPack(request: AuthenticatedRequest, body: unknown) {
    const { userId, requestId } = this.actor(request);
    const parsed = createApplicationPackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose the opportunity and career profile for this pack',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    // The idempotency key is derived from the pack identity, so a double click or
    // a retry resolves to the same pack and never consumes quota twice.
    const idempotencyKey = `pack:${userId}:${parsed.data.careerProfileId}:${parsed.data.jobId}`;
    return this.repository.createApplicationPack(
      userId,
      parsed.data.jobId,
      parsed.data.careerProfileId,
      idempotencyKey,
      requestId,
    );
  }

  async usageSummary(request: AuthenticatedRequest) {
    const { userId } = this.actor(request);
    return this.repository.usageSummary(userId);
  }

  async applicationTracker(request: AuthenticatedRequest) {
    const { userId } = this.actor(request);
    return this.repository.applicationTracker(userId);
  }

  async trackApplication(request: AuthenticatedRequest, body: unknown) {
    const { userId, requestId } = this.actor(request);
    const parsed = trackApplicationSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'The tracking request is invalid',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    return this.repository.trackApplication(
      userId,
      {
        jobId: parsed.data.jobId,
        careerProfileId: parsed.data.careerProfileId ?? null,
        packId: parsed.data.packId ?? null,
        stage: parsed.data.stage ?? null,
        source: parsed.data.source ?? null,
        nextActionAt: parsed.data.nextActionAt ?? null,
        nextActionNote: parsed.data.nextActionNote ?? null,
        notes: parsed.data.notes ?? null,
      },
      requestId,
    );
  }

  async applicationTimeline(request: AuthenticatedRequest, applicationId: string) {
    const { userId } = this.actor(request);
    return this.repository.applicationTimeline(userId, applicationId);
  }

  async setApplicationStage(request: AuthenticatedRequest, applicationId: string, body: unknown) {
    const { userId, requestId } = this.actor(request);
    const parsed = setApplicationStageSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose a valid application stage',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    return this.repository.setApplicationStage(
      userId,
      applicationId,
      parsed.data.stage,
      parsed.data.expectedVersion,
      parsed.data.note ?? null,
      requestId,
    );
  }
}

/**
 * Query strings arrive flat. Array filters are accepted either as repeated keys
 * or as a single comma-separated value, and numeric filters are coerced by the
 * shared schema.
 */
function normalizeRadarQuery(query: Record<string, unknown>): Record<string, unknown> {
  const arrayKeys = ['verdicts', 'remoteStates', 'employmentTypes', 'seniorities'];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (arrayKeys.includes(key)) {
      if (Array.isArray(value)) {
        result[key] = value.flatMap((entry) => String(entry).split(',')).filter(Boolean);
      } else if (typeof value === 'string' && value.length > 0) {
        result[key] = value.split(',').filter(Boolean);
      }
      continue;
    }
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}

function toSqlProfileInput(input: Record<string, unknown>): Record<string, unknown> {
  const mapping: Record<string, string> = {
    name: 'name',
    headline: 'headline',
    summary: 'summary',
    currentRoleTitle: 'currentRoleTitle',
    careerLevel: 'careerLevel',
    yearsExperience: 'yearsExperience',
    industries: 'industries',
    targetRoleTitles: 'targetRoleTitles',
    excludedRoleTitles: 'excludedRoleTitles',
    preferredEmploymentTypes: 'preferredEmploymentTypes',
    preferredWorkArrangement: 'preferredWorkArrangement',
    preferredLocations: 'preferredLocations',
    openToInternational: 'openToInternational',
    openToRelocation: 'openToRelocation',
    workAuthorizations: 'workAuthorizations',
    availability: 'availability',
    salaryMinMinor: 'salaryMinMinor',
    salaryMaxMinor: 'salaryMaxMinor',
    salaryCurrency: 'salaryCurrency',
    salaryPeriod: 'salaryPeriod',
    careerGoals: 'careerGoals',
  };
  const result: Record<string, unknown> = {};
  for (const [source, target] of Object.entries(mapping)) {
    if (source in input) result[target] = input[source];
  }
  return result;
}
