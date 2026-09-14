import type { ApiEnvironment } from '@hanaply/config';
import {
  applicationPackDetailSchema,
  applicationPackDirectorySchema,
  applicationPackSchema,
  applicationSnapshotSchema,
  applicationTimelineSchema,
  applicationTrackerSchema,
  careerDocumentDetailSchema,
  careerDocumentDirectorySchema,
  careerDocumentSchema,
  careerFactCreationResultSchema,
  careerFactDecisionResultSchema,
  careerFactDirectorySchema,
  careerProfileDetailSchema,
  careerProfileDirectorySchema,
  confirmedCareerEvidenceSchema,
  jobDetailSchema,
  jobRadarSchema,
  usageSummarySchema,
  type CareerDocument,
  type CareerDocumentDetail,
  type CareerFact,
  type CareerProfileDetail,
  type CareerProfileDirectory,
  type CareerRecordInput,
  type ConfirmedCareerEvidence,
  type JobDetail,
  type JobRadar,
  type ApplicationPack,
  type ApplicationPackDetail,
  type ApplicationPackDirectory,
  type ApplicationSnapshot,
  type ApplicationTimeline,
  type ApplicationTracker,
  type UsageSummary,
} from '@hanaply/contracts';
import { createServiceDatabaseClient, type Database } from '@hanaply/database';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AppError } from './app-error.js';
import { API_ENVIRONMENT } from './tokens.js';

export const careerDocumentColumns =
  'id, career_profile_id, document_kind, status, original_filename, mime_type, size_bytes, checksum_sha256, page_count, word_count, parsed_at, is_active, version, created_at, updated_at' as const;

type CareerDocumentRow = Database['public']['Tables']['career_documents']['Row'];
type CareerDocumentProjection = Pick<
  CareerDocumentRow,
  | 'id'
  | 'career_profile_id'
  | 'document_kind'
  | 'status'
  | 'original_filename'
  | 'mime_type'
  | 'size_bytes'
  | 'checksum_sha256'
  | 'page_count'
  | 'word_count'
  | 'parsed_at'
  | 'is_active'
  | 'version'
  | 'created_at'
  | 'updated_at'
>;

/**
 * Maps PostgreSQL SQLSTATEs raised by the career functions onto the public error
 * envelope. The career functions use deliberate codes: 42501 for authorization
 * and plan-limit refusals, 22023/23514 for invalid input, P0002 for missing
 * rows, 40001 for optimistic-concurrency conflicts, and 23505 for uniqueness
 * collisions.
 */
export function careerError(error: { code?: string; message: string }, fallback: string): AppError {
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
      return new AppError({ code: 'NOT_FOUND', status: 404, message: 'Career record not found' });
    case '40001':
      return new AppError({
        code: 'CONFLICT',
        status: 409,
        message: 'This career profile changed in another session. Reload and try again.',
      });
    case '23505':
      return new AppError({
        code: 'CONFLICT',
        status: 409,
        message: 'That value already exists on this career profile.',
      });
    default:
      return new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message: fallback });
  }
}

export function mapCareerDocument(row: CareerDocumentProjection): CareerDocument {
  return careerDocumentSchema.parse({
    id: row.id,
    careerProfileId: row.career_profile_id,
    documentKind: row.document_kind,
    status: row.status,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256,
    pageCount: row.page_count,
    wordCount: row.word_count,
    parsedAt: row.parsed_at,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

interface RpcOutcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

@Injectable()
export class CareerRepository {
  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {}

  private get client() {
    const url = this.environment.SUPABASE_URL;
    const serviceRoleKey = this.environment.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'Career services are not configured',
      });
    }
    return createServiceDatabaseClient(url, serviceRoleKey);
  }

  /**
   * Career functions take nullable parameters, meaning "not supplied", which the
   * generated argument types cannot express because PostgreSQL does not record
   * argument nullability. This is the single narrowing at the database boundary;
   * every response is still validated with the shared Zod schemas.
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
    if (error) {
      throw careerError(error, failureMessage);
    }
    const parsed = parse(data);
    if (parsed === null) {
      throw new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message: failureMessage });
    }
    return parsed;
  }

  async profiles(actorUserId: string): Promise<CareerProfileDirectory> {
    return this.rpc(
      () => this.callRpc('career_profile_directory', { actor_user_id: actorUserId }),
      (value) => careerProfileDirectorySchema.safeParse(value).data ?? null,
      'Career profile limits could not be evaluated',
    );
  }

  async profile(actorUserId: string, profileId: string): Promise<CareerProfileDetail> {
    return this.rpc(
      () =>
        this.callRpc('career_profile_detail', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
        }),
      (value) => careerProfileDetailSchema.safeParse(value).data ?? null,
      'The career profile could not be read',
    );
  }

  async createProfile(
    actorUserId: string,
    input: Record<string, unknown>,
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('create_career_profile', {
          actor_user_id: actorUserId,
          profile_input: input,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'string' ? value : null),
      'The career profile could not be created',
    );
  }

  async updateProfile(
    actorUserId: string,
    profileId: string,
    expectedVersion: number,
    input: Record<string, unknown>,
    requestId: string,
  ): Promise<number> {
    return this.rpc(
      () =>
        this.callRpc('update_career_profile', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          expected_version: expectedVersion,
          profile_input: input,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'number' ? value : null),
      'The career profile could not be updated',
    );
  }

  async setPrimaryProfile(
    actorUserId: string,
    profileId: string,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('set_primary_career_profile', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The primary career profile could not be changed',
    );
  }

  async setProfileStatus(
    actorUserId: string,
    profileId: string,
    status: CareerProfileDetail['status'],
    requestId: string,
  ): Promise<number> {
    return this.rpc(
      () =>
        this.callRpc('set_career_profile_status', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          requested_status: status,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'number' ? value : null),
      'The career profile status could not be changed',
    );
  }

  async deleteProfile(actorUserId: string, profileId: string, requestId: string): Promise<void> {
    await this.rpc(
      () =>
        this.callRpc('delete_career_profile', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The career profile could not be deleted',
    );
  }

  async upsertRecord(
    actorUserId: string,
    profileId: string,
    input: CareerRecordInput,
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('upsert_career_record', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          record_kind: input.kind,
          record_id: input.recordId ?? null,
          record_input: input.record,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'string' ? value : null),
      'The career record could not be saved',
    );
  }

  async deleteRecord(
    actorUserId: string,
    profileId: string,
    recordKind: string,
    recordId: string,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('delete_career_record', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          record_kind: recordKind,
          record_id: recordId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The career record could not be deleted',
    );
  }

  async facts(
    actorUserId: string,
    profileId: string,
    status: CareerFact['status'] | null,
  ): Promise<readonly CareerFact[]> {
    const result = await this.rpc(
      () =>
        this.callRpc('career_fact_directory', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          status_filter: status,
        }),
      (value) => careerFactDirectorySchema.safeParse(value).data ?? null,
      'The career fact ledger could not be read',
    );
    return result.items;
  }

  async recordFacts(
    actorUserId: string,
    profileId: string,
    facts: readonly Record<string, unknown>[],
    source: 'user_entered' | 'resume_extraction' | 'ai_inference' | 'imported',
    documentId: string | null,
    requestId: string,
  ): Promise<readonly string[]> {
    const result = await this.rpc(
      () =>
        this.callRpc('record_career_facts', {
          actor_user_id: actorUserId,
          target_profile_id: profileId,
          facts,
          requested_source: source,
          source_document_id: documentId,
          action_request_id: requestId,
        }),
      (value) => careerFactCreationResultSchema.safeParse(value).data ?? null,
      'The career facts could not be recorded',
    );
    return result.createdIds;
  }

  async decideFact(
    actorUserId: string,
    factId: string,
    decision: 'confirm' | 'reject' | 'correct',
    statement: string | null,
    metricUnit: string | null,
    metricValue: number | null,
    requestId: string,
  ): Promise<readonly CareerFact[]> {
    const result = await this.rpc(
      () =>
        this.callRpc('decide_career_fact', {
          actor_user_id: actorUserId,
          target_fact_id: factId,
          decision,
          override_statement: statement,
          override_metric_unit: metricUnit,
          override_metric_value: metricValue,
          action_request_id: requestId,
        }),
      (value) => careerFactDecisionResultSchema.safeParse(value).data ?? null,
      'The career fact decision could not be recorded',
    );
    return result.facts.items;
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
      'Confirmed career evidence could not be read',
    );
  }

  async setOnboardingStatus(
    actorUserId: string,
    status: 'not_started' | 'in_progress' | 'complete',
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('set_onboarding_status', {
          actor_user_id: actorUserId,
          requested_status: status,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The onboarding state could not be updated',
    );
  }

  async documents(actorUserId: string): Promise<readonly CareerDocument[]> {
    const { data, error } = await this.client
      .from('career_documents')
      .select(careerDocumentColumns)
      .eq('user_id', actorUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) {
      throw careerError(error, 'Career documents could not be read');
    }
    return careerDocumentDirectorySchema.parse({
      items: (data ?? []).map((row) => mapCareerDocument(row)),
    }).items;
  }

  async document(actorUserId: string, documentId: string): Promise<CareerDocument> {
    const { data, error } = await this.client
      .from('career_documents')
      .select(careerDocumentColumns)
      .eq('id', documentId)
      .eq('user_id', actorUserId)
      .maybeSingle();
    if (error) {
      throw careerError(error, 'The career document could not be read');
    }
    if (!data) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Career document not found' });
    }
    return mapCareerDocument(data);
  }

  async registerDocument(
    actorUserId: string,
    input: {
      careerProfileId: string | null;
      documentKind: CareerDocument['documentKind'];
      originalFilename: string;
      mimeType: CareerDocument['mimeType'];
      sizeBytes: number;
      checksumSha256: string;
      objectPath: string;
    },
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('register_career_document', {
          actor_user_id: actorUserId,
          document_input: input,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'string' ? value : null),
      'The career document could not be registered',
    );
  }

  async recordExtraction(
    actorUserId: string,
    documentId: string,
    extraction: Record<string, unknown>,
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('record_career_document_extraction', {
          actor_user_id: actorUserId,
          target_document_id: documentId,
          extraction_input: extraction,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'string' ? value : null),
      'The extraction could not be recorded',
    );
  }

  async completeDocumentProcessing(
    actorUserId: string,
    documentId: string,
    outcome: 'failed' | 'rejected' | 'processing',
    errorCode: string | null,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('complete_career_document_processing', {
          actor_user_id: actorUserId,
          target_document_id: documentId,
          outcome,
          error_code: errorCode,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The document processing outcome could not be recorded',
    );
  }

  async documentDetail(actorUserId: string, documentId: string): Promise<CareerDocumentDetail> {
    return this.rpc(
      () =>
        this.callRpc('career_document_detail', {
          actor_user_id: actorUserId,
          target_document_id: documentId,
        }),
      (value) => careerDocumentDetailSchema.safeParse(value).data ?? null,
      'The career document could not be read',
    );
  }

  async documentObject(
    actorUserId: string,
    documentId: string,
  ): Promise<{ bucketId: string; objectPath: string; mimeType: string; originalFilename: string }> {
    return this.rpc(
      () =>
        this.callRpc('resolve_career_document_object', {
          actor_user_id: actorUserId,
          target_document_id: documentId,
        }),
      (value) => {
        const parsed = z
          .array(
            z.object({
              bucket_id: z.string(),
              object_path: z.string(),
              mime_type: z.string(),
              original_filename: z.string(),
            }),
          )
          .safeParse(value);
        const row = parsed.success ? parsed.data[0] : undefined;
        if (!row) return null;
        return {
          bucketId: row.bucket_id,
          objectPath: row.object_path,
          mimeType: row.mime_type,
          originalFilename: row.original_filename,
        };
      },
      'The document object could not be resolved',
    );
  }

  async archiveDocument(
    actorUserId: string,
    documentId: string,
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('archive_career_document', {
          actor_user_id: actorUserId,
          target_document_id: documentId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'string' ? value : null),
      'The career document could not be removed',
    );
  }

  storageClient(): StorageBucketClient {
    return this.client.storage;
  }

  // -------------------------------------------------------------------------
  // Career Radar
  // -------------------------------------------------------------------------

  async jobRadar(actorUserId: string, filters: Record<string, unknown>): Promise<JobRadar> {
    return this.rpc(
      () => this.callRpc('job_radar', { actor_user_id: actorUserId, filters }),
      (value) => jobRadarSchema.safeParse(value).data ?? null,
      'The opportunity feed could not be read',
    );
  }

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
      'The opportunity could not be read',
    );
  }

  async saveJob(
    actorUserId: string,
    jobId: string,
    careerProfileId: string | null,
    note: string | null,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('save_job', {
          actor_user_id: actorUserId,
          target_job_id: jobId,
          target_career_profile_id: careerProfileId,
          requested_note: note,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The opportunity could not be saved',
    );
  }

  async unsaveJob(actorUserId: string, jobId: string, requestId: string): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('unsave_job', {
          actor_user_id: actorUserId,
          target_job_id: jobId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The saved opportunity could not be removed',
    );
  }

  async recordJobFeedback(
    actorUserId: string,
    jobId: string,
    feedback: string,
    reason: string | null,
    careerProfileId: string | null,
    requestId: string,
  ): Promise<string> {
    return this.rpc(
      () =>
        this.callRpc('record_job_feedback', {
          actor_user_id: actorUserId,
          target_job_id: jobId,
          requested_feedback: feedback,
          requested_reason: reason,
          target_career_profile_id: careerProfileId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'string' ? value : null),
      'Your feedback could not be recorded',
    );
  }

  // -------------------------------------------------------------------------
  // Application Packs, usage, and tracker
  // -------------------------------------------------------------------------

  async applicationPacks(actorUserId: string): Promise<ApplicationPackDirectory> {
    return this.rpc(
      () => this.callRpc('application_pack_directory', { actor_user_id: actorUserId }),
      (value) => applicationPackDirectorySchema.safeParse(value).data ?? null,
      'Your Application Packs could not be read',
    );
  }

  async applicationPack(actorUserId: string, packId: string): Promise<ApplicationPackDetail> {
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

  async createApplicationPack(
    actorUserId: string,
    jobId: string,
    careerProfileId: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<{ pack: ApplicationPack; created: boolean; usage: Record<string, unknown> | null }> {
    return this.rpc(
      () =>
        this.callRpc('create_application_pack', {
          actor_user_id: actorUserId,
          target_job_id: jobId,
          target_career_profile_id: careerProfileId,
          idempotency_key: idempotencyKey,
          action_request_id: requestId,
        }),
      (value) => {
        const parsed = z
          .object({
            pack: applicationPackSchema,
            created: z.boolean(),
            usage: z.record(z.string(), z.unknown()).nullable(),
          })
          .safeParse(value);
        return parsed.success ? parsed.data : null;
      },
      'The Application Pack could not be created',
    );
  }

  async usageSummary(actorUserId: string): Promise<UsageSummary> {
    return this.rpc(
      () => this.callRpc('usage_summary', { actor_user_id: actorUserId }),
      (value) => usageSummarySchema.safeParse(value).data ?? null,
      'Your usage could not be read',
    );
  }

  async applicationTracker(actorUserId: string): Promise<ApplicationTracker> {
    return this.rpc(
      () => this.callRpc('application_tracker', { actor_user_id: actorUserId }),
      (value) => applicationTrackerSchema.safeParse(value).data ?? null,
      'Your application tracker could not be read',
    );
  }

  async trackApplication(
    actorUserId: string,
    input: Record<string, unknown>,
    requestId: string,
  ): Promise<ApplicationSnapshot> {
    return this.rpc(
      () =>
        this.callRpc('upsert_job_application', {
          actor_user_id: actorUserId,
          application_input: input,
          action_request_id: requestId,
        }),
      (value) => applicationSnapshotSchema.safeParse(value).data ?? null,
      'The application could not be tracked',
    );
  }

  async applicationTimeline(
    actorUserId: string,
    applicationId: string,
  ): Promise<ApplicationTimeline> {
    return this.rpc(
      () =>
        this.callRpc('application_timeline', {
          actor_user_id: actorUserId,
          target_application_id: applicationId,
        }),
      (value) => applicationTimelineSchema.safeParse(value).data ?? null,
      'The application history could not be read',
    );
  }

  async setApplicationStage(
    actorUserId: string,
    applicationId: string,
    stage: string,
    expectedVersion: number,
    note: string | null,
    requestId: string,
  ): Promise<ApplicationSnapshot> {
    return this.rpc(
      () =>
        this.callRpc('set_application_stage', {
          actor_user_id: actorUserId,
          target_application_id: applicationId,
          requested_stage: stage,
          expected_version: expectedVersion,
          requested_note: note,
          action_request_id: requestId,
        }),
      (value) => applicationSnapshotSchema.safeParse(value).data ?? null,
      'The application stage could not be changed',
    );
  }
}

/**
 * Only the storage surface the career document pipeline uses. Keeping the
 * annotation local avoids leaking the Supabase SDK's nested type names through
 * this module's public boundary.
 */
export interface StorageBucketClient {
  from(bucket: string): {
    upload(
      path: string,
      body: Buffer,
      options: { contentType: string; upsert: boolean },
    ): PromiseLike<{ error: { message: string } | null }>;
    remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    createSignedUrl(
      path: string,
      expiresIn: number,
      options?: { download?: string },
    ): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
  };
}
