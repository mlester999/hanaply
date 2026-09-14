import type { ApiEnvironment } from '@hanaply/config';
import { careerInsightsSchema, type CareerInsights } from '@hanaply/contracts';
import { createServiceDatabaseClient } from '@hanaply/database';
import { Inject, Injectable } from '@nestjs/common';

import { AppError } from './app-error.js';
import { API_ENVIRONMENT } from './tokens.js';

interface RpcOutcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/**
 * Maps the SQLSTATEs `public.career_insights` raises onto the public error
 * envelope, using the same codes as the rest of the schema: 42501 for a
 * missing actor or a profile the caller does not own, and 22023 for an
 * out-of-range window.
 */
export function insightsError(
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
      return new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: error.message.replace(/^.*?:\s*/u, '') || fallback,
      });
    default:
      return new AppError({ code: 'INTERNAL_ERROR', status: 500, message: fallback });
  }
}

@Injectable()
export class InsightsRepository {
  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {}

  private async callRpc(
    name: 'career_insights',
    args: {
      actor_user_id: string;
      requested_career_profile_id: string | null;
      window_weeks: number;
    },
  ): Promise<RpcOutcome> {
    const client = createServiceDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_SERVICE_ROLE_KEY,
    );
    // The single documented cast in this file. The generated client types the
    // RPC name as a literal union and the argument object as the generated
    // signature, which cannot express a nullable `uuid` parameter, so the
    // argument shape is narrowed here and validated by the response schema.
    const result = await client.rpc(name, args as never);
    return { data: result.data, error: result.error };
  }

  private async rpc<T>(
    call: () => Promise<RpcOutcome>,
    parse: (value: unknown) => T | null,
    fallback: string,
  ): Promise<T> {
    const { data, error } = await call();
    if (error) throw insightsError(error, fallback);
    const parsed = parse(data);
    if (parsed === null)
      throw new AppError({ code: 'INTERNAL_ERROR', status: 500, message: fallback });
    return parsed;
  }

  async careerInsights(
    actorUserId: string,
    careerProfileId: string | null,
    windowWeeks: number,
  ): Promise<CareerInsights> {
    return this.rpc(
      () =>
        this.callRpc('career_insights', {
          actor_user_id: actorUserId,
          requested_career_profile_id: careerProfileId,
          window_weeks: windowWeeks,
        }),
      (value) => careerInsightsSchema.safeParse(value).data ?? null,
      'Your career insights could not be read',
    );
  }
}
