import {
  adminDedupQuerySchema,
  adminDedupResolutionSchema,
  adminJobDirectoryQuerySchema,
  adminJobSourceConfigSchema,
  adminJobSourceStateSchema,
  adminJobStatusSchema,
  type AdminDedupCandidates,
  type AdminIngestionHealth,
  type AdminJobDetail,
  type AdminJobDirectory,
  type AdminJobSourceDirectory,
} from '@hanaply/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z, type ZodError } from 'zod';

import { AdminJobsRepository } from './admin-jobs.repository.js';
import { AppError, toValidationDetails } from './app-error.js';
import type { AuthenticatedRequest } from './http.js';

const sourceParamsSchema = z.object({ sourceId: z.uuid() }).strict();
const jobParamsSchema = z.object({ jobId: z.uuid() }).strict();
const dedupParamsSchema = z.object({ candidateId: z.uuid() }).strict();
const ingestionQuerySchema = z
  .object({ runLimit: z.coerce.number().int().min(1).max(200).default(25) })
  .strict();

/**
 * Administrative job operations. Every request body, path parameter, and query
 * is parsed with the shared contract before a repository call, so an operator
 * surface cannot send a shape the database functions were not written for.
 */
@Injectable()
export class AdminJobsService {
  constructor(@Inject(AdminJobsRepository) private readonly repository: AdminJobsRepository) {}

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

  private invalid(message: string, error: ZodError): AppError {
    return new AppError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message,
      details: toValidationDetails(error.issues),
    });
  }

  // ---------------------------------------------------------------------------
  // Provider governance
  // ---------------------------------------------------------------------------

  async jobSources(request: AuthenticatedRequest): Promise<AdminJobSourceDirectory> {
    const { userId } = this.actor(request);
    return this.repository.jobSources(userId);
  }

  async setJobSourceState(
    request: AuthenticatedRequest,
    params: unknown,
    body: unknown,
  ): Promise<{ changed: boolean }> {
    const { userId, requestId } = this.actor(request);
    const parsedParams = sourceParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Job source not found' });
    }
    const parsedBody = adminJobSourceStateSchema.safeParse(body);
    if (!parsedBody.success) {
      throw this.invalid(
        'Choose enable, pause, or disable and give a reason of at least 10 characters.',
        parsedBody.error,
      );
    }
    const changed = await this.repository.setJobSourceState(
      userId,
      parsedParams.data.sourceId,
      parsedBody.data.action,
      parsedBody.data.reason,
      requestId,
    );
    return { changed: changed > 0 };
  }

  async updateJobSourceConfig(
    request: AuthenticatedRequest,
    params: unknown,
    body: unknown,
  ): Promise<{ updated: true }> {
    const { userId, requestId } = this.actor(request);
    const parsedParams = sourceParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Job source not found' });
    }
    const parsedBody = adminJobSourceConfigSchema.safeParse(body);
    if (!parsedBody.success) {
      throw this.invalid(
        'The provider configuration must be a JSON object with a reason of at least 10 characters.',
        parsedBody.error,
      );
    }
    await this.repository.updateJobSourceConfig(
      userId,
      parsedParams.data.sourceId,
      parsedBody.data.config,
      parsedBody.data.reason,
      requestId,
    );
    return { updated: true };
  }

  async requestJobSourceScan(
    request: AuthenticatedRequest,
    params: unknown,
  ): Promise<{ requested: true }> {
    const { userId, requestId } = this.actor(request);
    const parsedParams = sourceParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Job source not found' });
    }
    await this.repository.requestSourceScan(userId, parsedParams.data.sourceId, requestId);
    return { requested: true };
  }

  // ---------------------------------------------------------------------------
  // Ingestion health
  // ---------------------------------------------------------------------------

  async ingestionHealth(
    request: AuthenticatedRequest,
    query: unknown,
  ): Promise<AdminIngestionHealth> {
    const { userId } = this.actor(request);
    const parsed = ingestionQuerySchema.safeParse(compact(query));
    if (!parsed.success) {
      throw this.invalid('The run limit must be between 1 and 200.', parsed.error);
    }
    return this.repository.ingestionHealth(userId, parsed.data.runLimit);
  }

  // ---------------------------------------------------------------------------
  // Job records
  // ---------------------------------------------------------------------------

  async jobs(request: AuthenticatedRequest, query: unknown): Promise<AdminJobDirectory> {
    const { userId } = this.actor(request);
    const parsed = adminJobDirectoryQuerySchema.safeParse(compact(query));
    if (!parsed.success) {
      throw this.invalid('The job directory filters are invalid.', parsed.error);
    }
    // The stored procedure treats null as "no filter" and an empty string as a
    // literal match, so a blank search must never reach it.
    const search = parsed.data.search?.trim() ?? '';
    return this.repository.jobs(userId, {
      search: search.length > 0 ? search : null,
      status: parsed.data.status ?? null,
      pageSize: parsed.data.pageSize,
      pageOffset: (parsed.data.page - 1) * parsed.data.pageSize,
    });
  }

  async job(request: AuthenticatedRequest, params: unknown): Promise<AdminJobDetail> {
    const { userId } = this.actor(request);
    const parsed = jobParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Job not found' });
    }
    return this.repository.job(userId, parsed.data.jobId);
  }

  async setJobStatus(
    request: AuthenticatedRequest,
    params: unknown,
    body: unknown,
  ): Promise<{ changed: true }> {
    const { userId, requestId } = this.actor(request);
    const parsedParams = jobParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Job not found' });
    }
    const parsedBody = adminJobStatusSchema.safeParse(body);
    if (!parsedBody.success) {
      throw this.invalid(
        'Choose a supported status and give a reason of at least 10 characters.',
        parsedBody.error,
      );
    }
    await this.repository.setJobStatus(
      userId,
      parsedParams.data.jobId,
      parsedBody.data.status,
      parsedBody.data.reason,
      requestId,
    );
    return { changed: true };
  }

  // ---------------------------------------------------------------------------
  // Deduplication diagnostics
  // ---------------------------------------------------------------------------

  async dedupCandidates(
    request: AuthenticatedRequest,
    query: unknown,
  ): Promise<AdminDedupCandidates> {
    const { userId } = this.actor(request);
    const parsed = adminDedupQuerySchema.safeParse(compact(query));
    if (!parsed.success) {
      throw this.invalid('The deduplication queue filters are invalid.', parsed.error);
    }
    return this.repository.dedupCandidates(userId, {
      includeResolved: parsed.data.includeResolved ?? false,
      pageSize: parsed.data.pageSize,
      pageOffset: (parsed.data.page - 1) * parsed.data.pageSize,
    });
  }

  async resolveDedupCandidate(
    request: AuthenticatedRequest,
    params: unknown,
    body: unknown,
  ): Promise<{ resolved: boolean }> {
    const { userId, requestId } = this.actor(request);
    const parsedParams = dedupParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new AppError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Deduplication candidate not found',
      });
    }
    const parsedBody = adminDedupResolutionSchema.safeParse(body);
    if (!parsedBody.success) {
      throw this.invalid(
        'Choose merge or keep separate and give a reason of at least 10 characters.',
        parsedBody.error,
      );
    }
    return {
      resolved: await this.repository.resolveDedupCandidate(
        userId,
        parsedParams.data.candidateId,
        parsedBody.data.resolution,
        parsedBody.data.reason,
        requestId,
      ),
    };
  }
}

/**
 * Query strings arrive flat, and an empty value only ever means "absent". The
 * shared schemas are strict, so an empty optional filter must not be sent as an
 * empty string that no enum, UUID, or positive integer can accept.
 */
function compact(query: unknown): Record<string, unknown> {
  if (typeof query !== 'object' || query === null) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') result[key] = value;
  }
  return result;
}
