import type { ApiEnvironment } from '@hanaply/config';
import {
  adminDedupCandidatesSchema,
  adminIngestionHealthSchema,
  adminJobDetailSchema,
  adminJobDirectorySchema,
  adminJobSourceDirectorySchema,
  type AdminDedupCandidates,
  type AdminIngestionHealth,
  type AdminJobDetail,
  type AdminJobDirectory,
  type AdminJobSourceDirectory,
} from '@hanaply/contracts';
import { createServiceDatabaseClient } from '@hanaply/database';
import { Inject, Injectable } from '@nestjs/common';

import { AppError } from './app-error.js';
import { API_ENVIRONMENT } from './tokens.js';

interface RpcOutcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/**
 * `admin_set_job_source_state` returns the affected row count from
 * `get diagnostics row_count`. The generated client types describe that as a
 * number, but the value is normalised here so a driver that serialises an
 * integer as a string cannot fail response validation.
 */
function rowCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Maps the SQLSTATEs the administrative job functions raise onto the public
 * error envelope, using the same codes as the rest of the schema: 42501 for a
 * missing catalogue permission, 22023/23514 for invalid input, and P0002 for a
 * missing provider, job, or candidate.
 */
export function adminJobsError(
  error: { code?: string; message: string },
  fallback: string,
): AppError {
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
      return new AppError({ code: 'NOT_FOUND', status: 404, message: 'Record not found' });
    case '40001':
      return new AppError({
        code: 'CONFLICT',
        status: 409,
        message: 'This record changed in another session. Reload and try again.',
      });
    default:
      return new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message: fallback });
  }
}

/**
 * Job operations reads provider health, raw ingestion counters, content
 * fingerprints, and deduplication signals. Every function is service-role only
 * and every response is validated with the shared administrative schemas before
 * it leaves this boundary, so a database change can never widen the API surface
 * silently.
 */
@Injectable()
export class AdminJobsRepository {
  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {}

  private get client() {
    const url = this.environment.SUPABASE_URL;
    const serviceRoleKey = this.environment.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'Job operations are not configured',
      });
    }
    return createServiceDatabaseClient(url, serviceRoleKey);
  }

  /**
   * The administrative functions declare nullable and defaulted arguments that
   * PostgreSQL does not record as nullable, so the generated argument types
   * cannot express "not supplied". This is the single narrowing at the database
   * boundary; the response is still validated with the shared Zod schemas.
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
      throw adminJobsError(error, failureMessage);
    }
    const parsed = parse(data);
    if (parsed === null) {
      throw new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message: failureMessage });
    }
    return parsed;
  }

  // ---------------------------------------------------------------------------
  // Provider governance
  // ---------------------------------------------------------------------------

  async jobSources(actorUserId: string): Promise<AdminJobSourceDirectory> {
    return this.rpc(
      () => this.callRpc('admin_job_source_directory', { actor_user_id: actorUserId }),
      (value) => adminJobSourceDirectorySchema.safeParse(value).data ?? null,
      'The provider catalogue could not be read',
    );
  }

  async setJobSourceState(
    actorUserId: string,
    sourceId: string,
    action: 'enable' | 'pause' | 'disable',
    reason: string,
    requestId: string,
  ): Promise<number> {
    return this.rpc(
      () =>
        this.callRpc('admin_set_job_source_state', {
          actor_user_id: actorUserId,
          target_source_id: sourceId,
          requested_action: action,
          action_reason: reason,
          action_request_id: requestId,
        }),
      (value) => rowCount(value),
      'The provider state could not be changed',
    );
  }

  async updateJobSourceConfig(
    actorUserId: string,
    sourceId: string,
    config: Record<string, unknown>,
    reason: string,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('admin_update_job_source_config', {
          actor_user_id: actorUserId,
          target_source_id: sourceId,
          requested_config: config,
          action_reason: reason,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The provider configuration could not be updated',
    );
  }

  async requestSourceScan(
    actorUserId: string,
    sourceId: string,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('admin_request_source_scan', {
          actor_user_id: actorUserId,
          target_source_id: sourceId,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The provider scan could not be requested',
    );
  }

  // ---------------------------------------------------------------------------
  // Ingestion health
  // ---------------------------------------------------------------------------

  async ingestionHealth(actorUserId: string, runLimit: number): Promise<AdminIngestionHealth> {
    return this.rpc(
      () =>
        this.callRpc('admin_ingestion_health', { actor_user_id: actorUserId, run_limit: runLimit }),
      (value) => adminIngestionHealthSchema.safeParse(value).data ?? null,
      'Ingestion health could not be read',
    );
  }

  // ---------------------------------------------------------------------------
  // Job records
  // ---------------------------------------------------------------------------

  async jobs(
    actorUserId: string,
    filters: {
      search: string | null;
      status: AdminJobDirectory['items'][number]['status'] | null;
      pageSize: number;
      pageOffset: number;
    },
  ): Promise<AdminJobDirectory> {
    return this.rpc(
      () =>
        this.callRpc('admin_job_directory', {
          actor_user_id: actorUserId,
          search_query: filters.search,
          status_filter: filters.status,
          page_size: filters.pageSize,
          page_offset: filters.pageOffset,
        }),
      (value) => adminJobDirectorySchema.safeParse(value).data ?? null,
      'The job directory could not be read',
    );
  }

  async job(actorUserId: string, jobId: string): Promise<AdminJobDetail> {
    return this.rpc(
      () => this.callRpc('admin_job_detail', { actor_user_id: actorUserId, target_job_id: jobId }),
      (value) => adminJobDetailSchema.safeParse(value).data ?? null,
      'The job record could not be read',
    );
  }

  async setJobStatus(
    actorUserId: string,
    jobId: string,
    status: 'active' | 'rejected' | 'closed' | 'expired',
    reason: string,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('admin_set_job_status', {
          actor_user_id: actorUserId,
          target_job_id: jobId,
          requested_status: status,
          action_reason: reason,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The job status could not be changed',
    );
  }

  // ---------------------------------------------------------------------------
  // Deduplication diagnostics
  // ---------------------------------------------------------------------------

  async dedupCandidates(
    actorUserId: string,
    filters: { includeResolved: boolean; pageSize: number; pageOffset: number },
  ): Promise<AdminDedupCandidates> {
    return this.rpc(
      () =>
        this.callRpc('admin_dedup_candidates', {
          actor_user_id: actorUserId,
          include_resolved: filters.includeResolved,
          page_size: filters.pageSize,
          page_offset: filters.pageOffset,
        }),
      (value) => adminDedupCandidatesSchema.safeParse(value).data ?? null,
      'The deduplication queue could not be read',
    );
  }

  async resolveDedupCandidate(
    actorUserId: string,
    candidateId: string,
    resolution: 'merged' | 'kept_separate',
    reason: string,
    requestId: string,
  ): Promise<boolean> {
    return this.rpc(
      () =>
        this.callRpc('admin_resolve_dedup_candidate', {
          actor_user_id: actorUserId,
          target_candidate_id: candidateId,
          requested_resolution: resolution,
          action_reason: reason,
          action_request_id: requestId,
        }),
      (value) => (typeof value === 'boolean' ? value : null),
      'The deduplication decision could not be recorded',
    );
  }
}
