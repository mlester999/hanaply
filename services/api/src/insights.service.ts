import { careerInsightsQuerySchema } from '@hanaply/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AppError, toValidationDetails } from './app-error.js';
import type { AuthenticatedRequest } from './http.js';
import { InsightsRepository } from './insights.repository.js';

@Injectable()
export class InsightsService {
  constructor(@Inject(InsightsRepository) private readonly repository: InsightsRepository) {}

  /**
   * Resolves the actor from the verified access token. The caller never supplies
   * a user id, so a client cannot ask for another subscriber's insights.
   */
  private actor(request: AuthenticatedRequest): { userId: string } {
    const userId = request.auth?.userId;
    if (!userId) {
      throw new AppError({
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
        message: 'Sign in to view your insights',
      });
    }
    return { userId };
  }

  async careerInsights(request: AuthenticatedRequest, query: unknown) {
    const { userId } = this.actor(request);
    const parsed = careerInsightsQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Choose a window between 1 and 52 weeks',
        details: toValidationDetails(parsed.error.issues),
      });
    }
    return this.repository.careerInsights(
      userId,
      parsed.data.careerProfileId ?? null,
      parsed.data.windowWeeks,
    );
  }
}
