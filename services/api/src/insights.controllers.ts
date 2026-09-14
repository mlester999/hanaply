import { apiContract } from '@hanaply/contracts';
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { SupabaseAuthGuard } from './auth.js';
import { successEnvelope, type AuthenticatedRequest } from './http.js';
import { InsightsService } from './insights.service.js';

/**
 * The subscriber's own coaching and analytics. There is no operator surface and
 * no mutating route: the read model resolves the actor from the verified access
 * token, so a caller cannot ask for anyone else's insights.
 */
@Controller()
@UseGuards(SupabaseAuthGuard)
export class InsightsController {
  constructor(@Inject(InsightsService) private readonly service: InsightsService) {}

  @Get(apiContract.careerInsights.path)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async careerInsights(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return apiContract.careerInsights.response.parse(
      successEnvelope(request, await this.service.careerInsights(request, query)),
    );
  }
}
