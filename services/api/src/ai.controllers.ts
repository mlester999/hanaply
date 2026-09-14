import { apiContract } from '@hanaply/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { SupabaseAuthGuard } from './auth.js';
import { AiService } from './ai.service.js';
import { successEnvelope, type AuthenticatedRequest } from './http.js';

const routePath = (path: string): string => path.replaceAll(/\{(\w+)\}/gu, ':$1');

const opportunityAnalysisPath = routePath(apiContract.opportunityAnalysis.path);
const coachConversationPath = routePath(apiContract.coachConversation.path);
const sendCoachMessagePath = routePath(apiContract.sendCoachMessage.path);

const uuidOnly = (value: unknown, key: string): string => {
  if (typeof value !== 'string') throw new TypeError(`Missing ${key}`);
  return value;
};

/**
 * The subscriber's AI surfaces: opportunity analysis and the coach.
 *
 * Three properties hold on every route here.
 *
 *   - The actor comes from the verified access token. No route accepts a user
 *     id, so a caller cannot reach another subscriber's analysis or thread.
 *   - No route 500s because AI is unconfigured. Each one answers 200 with the
 *     degradation stated, because the deterministic engine is the product and
 *     these surfaces are additions to it rather than replacements for it.
 *   - Every response that can carry model output carries its grounding report
 *     and its provenance beside it, so the interface can always say which claims
 *     are supported and whether a model wrote anything at all.
 *
 * Generation routes are throttled far more tightly than reads: a model call is
 * the most expensive synchronous operation on this surface, and the throttle is
 * a backstop for a runaway client rather than the metering mechanism. Metering
 * is `AiMeter`, which counts logical operations.
 */
@Controller()
@UseGuards(SupabaseAuthGuard)
export class AiController {
  constructor(@Inject(AiService) private readonly service: AiService) {}

  @Get(apiContract.aiStatus.path)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async status(@Req() request: AuthenticatedRequest) {
    return apiContract.aiStatus.response.parse(
      successEnvelope(request, { status: await this.service.status() }),
    );
  }

  @Post(opportunityAnalysisPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async analyzeOpportunity(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.opportunityAnalysis.response.parse(
      successEnvelope(
        request,
        await this.service.analyzeOpportunity(request, uuidOnly(params.jobId, 'jobId'), body),
      ),
    );
  }

  @Get(opportunityAnalysisPath)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async storedOpportunityAnalysis(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ) {
    return apiContract.opportunityAnalysisRead.response.parse(
      successEnvelope(
        request,
        await this.service.storedOpportunityAnalysis(
          request,
          uuidOnly(params.jobId, 'jobId'),
          query,
        ),
      ),
    );
  }

  @Get(apiContract.coachConversations.path)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async conversations(@Req() request: AuthenticatedRequest) {
    return apiContract.coachConversations.response.parse(
      successEnvelope(request, await this.service.conversations(request)),
    );
  }

  @Post(apiContract.openCoachConversation.path)
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async openConversation(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return apiContract.openCoachConversation.response.parse(
      successEnvelope(request, await this.service.openConversation(request, body)),
    );
  }

  @Get(coachConversationPath)
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async conversation(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.coachConversation.response.parse(
      successEnvelope(
        request,
        await this.service.conversation(request, uuidOnly(params.conversationId, 'conversationId')),
      ),
    );
  }

  // Sending a message is the coach's expensive path: it reads the confirmed
  // ledger, builds a grounded prompt, calls a provider, and writes two rows.
  @Post(sendCoachMessagePath)
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async sendMessage(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.sendCoachMessage.response.parse(
      successEnvelope(
        request,
        await this.service.sendMessage(
          request,
          uuidOnly(params.conversationId, 'conversationId'),
          body,
        ),
      ),
    );
  }
}
