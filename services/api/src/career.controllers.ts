import { apiContract } from '@hanaply/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { SupabaseAuthGuard } from './auth.js';
import { CareerService } from './career.service.js';
import { successEnvelope, type AuthenticatedRequest } from './http.js';

const routePath = (path: string): string => path.replaceAll(/\{(\w+)\}/gu, ':$1');

const careerProfilePath = routePath(apiContract.careerProfile.path);
const careerProfileStatusPath = routePath(apiContract.setCareerProfileStatus.path);
const careerProfilePrimaryPath = routePath(apiContract.setPrimaryCareerProfile.path);
const careerRecordsPath = routePath(apiContract.upsertCareerRecord.path);
const jobDetailPath = routePath(apiContract.jobDetail.path);
const jobSavePath = routePath(apiContract.saveJob.path);
const jobFeedbackPath = routePath(apiContract.recordJobFeedback.path);
const careerRecordPath = routePath(apiContract.deleteCareerRecord.path);
const careerFactsPath = routePath(apiContract.careerFacts.path);
const careerDecisionPath = routePath(apiContract.decideCareerFact.path);
const careerEvidencePath = routePath(apiContract.confirmedCareerEvidence.path);
const careerDocumentPath = routePath(apiContract.careerDocument.path);
const careerDocumentAccessPath = routePath(apiContract.careerDocumentPreview.path);
const careerDocumentExtractionPath = routePath(apiContract.careerDocumentExtraction.path);
const careerDocumentApplyPath = routePath(apiContract.applyCareerDocumentExtraction.path);

const uuidOnly = (value: unknown, key: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`Missing ${key}`);
  }
  return value;
};

@Controller()
@UseGuards(SupabaseAuthGuard)
export class CareerController {
  constructor(@Inject(CareerService) private readonly service: CareerService) {}

  @Get(apiContract.careerProfiles.path)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async profiles(@Req() request: AuthenticatedRequest) {
    return apiContract.careerProfiles.response.parse(
      successEnvelope(request, await this.service.profiles(request)),
    );
  }

  @Post(apiContract.createCareerProfile.path)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async createProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return apiContract.createCareerProfile.response.parse(
      successEnvelope(request, await this.service.createProfile(request, body)),
    );
  }

  @Get(careerProfilePath)
  async profile(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.careerProfile.response.parse(
      successEnvelope(
        request,
        await this.service.profile(request, uuidOnly(params.profileId, 'profileId')),
      ),
    );
  }

  @Patch(careerProfilePath)
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.updateCareerProfile.response.parse(
      successEnvelope(
        request,
        await this.service.updateProfile(request, uuidOnly(params.profileId, 'profileId'), body),
      ),
    );
  }

  @Delete(careerProfilePath)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async deleteProfile(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.deleteCareerProfile.response.parse(
      successEnvelope(
        request,
        await this.service.deleteProfile(request, uuidOnly(params.profileId, 'profileId')),
      ),
    );
  }

  @Post(careerProfilePrimaryPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async setPrimary(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.setPrimaryCareerProfile.response.parse(
      successEnvelope(
        request,
        await this.service.setPrimary(request, uuidOnly(params.profileId, 'profileId')),
      ),
    );
  }

  @Post(careerProfileStatusPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async setStatus(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.setCareerProfileStatus.response.parse(
      successEnvelope(
        request,
        await this.service.setStatus(request, uuidOnly(params.profileId, 'profileId'), body),
      ),
    );
  }

  @Post(careerRecordsPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  async upsertRecord(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.upsertCareerRecord.response.parse(
      successEnvelope(
        request,
        await this.service.upsertRecord(request, uuidOnly(params.profileId, 'profileId'), body),
      ),
    );
  }

  @Delete(careerRecordPath)
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  async deleteRecord(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.deleteCareerRecord.response.parse(
      successEnvelope(
        request,
        await this.service.deleteRecord(
          request,
          uuidOnly(params.profileId, 'profileId'),
          uuidOnly(params.recordKind, 'recordKind'),
          uuidOnly(params.recordId, 'recordId'),
        ),
      ),
    );
  }

  @Get(careerFactsPath)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async facts(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ) {
    return apiContract.careerFacts.response.parse(
      successEnvelope(
        request,
        await this.service.facts(
          request,
          uuidOnly(params.profileId, 'profileId'),
          typeof query.status === 'string' ? query.status : undefined,
        ),
      ),
    );
  }

  @Post(careerFactsPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  async recordFacts(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.recordCareerFacts.response.parse(
      successEnvelope(
        request,
        await this.service.recordFacts(request, uuidOnly(params.profileId, 'profileId'), body),
      ),
    );
  }

  @Post(careerDecisionPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  async decideFact(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.decideCareerFact.response.parse(
      successEnvelope(
        request,
        await this.service.decideFact(request, uuidOnly(params.factId, 'factId'), body),
      ),
    );
  }

  @Get(careerEvidencePath)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async evidence(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.confirmedCareerEvidence.response.parse(
      successEnvelope(
        request,
        await this.service.confirmedEvidence(request, uuidOnly(params.profileId, 'profileId')),
      ),
    );
  }

  @Get(apiContract.careerDocuments.path)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async documents(@Req() request: AuthenticatedRequest) {
    return apiContract.careerDocuments.response.parse(
      successEnvelope(request, await this.service.documents(request)),
    );
  }

  @Post(apiContract.uploadCareerDocument.path)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async uploadDocument(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = apiContract.uploadCareerDocument.query.parse(query);
    return apiContract.uploadCareerDocument.response.parse(
      successEnvelope(request, await this.service.uploadDocument(request, parsed)),
    );
  }

  @Get(careerDocumentPath)
  async document(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.careerDocument.response.parse(
      successEnvelope(
        request,
        await this.service.document(request, uuidOnly(params.documentId, 'documentId')),
      ),
    );
  }

  @Delete(careerDocumentPath)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async deleteDocument(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.deleteCareerDocument.response.parse(
      successEnvelope(
        request,
        await this.service.deleteDocument(request, uuidOnly(params.documentId, 'documentId')),
      ),
    );
  }

  @Get(careerDocumentAccessPath)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async documentAccess(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.careerDocumentPreview.response.parse(
      successEnvelope(
        request,
        await this.service.documentAccess(request, uuidOnly(params.documentId, 'documentId')),
      ),
    );
  }

  @Get(careerDocumentExtractionPath)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async documentExtraction(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.careerDocumentExtraction.response.parse(
      successEnvelope(
        request,
        await this.service.documentExtraction(request, uuidOnly(params.documentId, 'documentId')),
      ),
    );
  }

  @Post(careerDocumentApplyPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 3_600_000 } })
  async applyExtraction(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.applyCareerDocumentExtraction.response.parse(
      successEnvelope(
        request,
        await this.service.applyExtraction(
          request,
          uuidOnly(params.documentId, 'documentId'),
          body,
        ),
      ),
    );
  }

  @Post(apiContract.setOnboardingStatus.path)
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async setOnboarding(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return apiContract.setOnboardingStatus.response.parse(
      successEnvelope(request, await this.service.setOnboardingStatus(request, body)),
    );
  }

  // -------------------------------------------------------------------------
  // Career Radar
  // -------------------------------------------------------------------------

  @Get(apiContract.jobRadar.path)
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async jobRadar(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return apiContract.jobRadar.response.parse(
      successEnvelope(request, await this.service.jobRadar(request, query)),
    );
  }

  @Get(jobDetailPath)
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async jobDetail(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = apiContract.jobDetail.query.parse(query);
    return apiContract.jobDetail.response.parse(
      successEnvelope(
        request,
        await this.service.jobDetail(
          request,
          uuidOnly(params.jobId, 'jobId'),
          parsed.careerProfileId,
        ),
      ),
    );
  }

  @Post(jobSavePath)
  @HttpCode(200)
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  async saveJob(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.saveJob.response.parse(
      successEnvelope(
        request,
        await this.service.saveJob(request, uuidOnly(params.jobId, 'jobId'), body),
      ),
    );
  }

  @Delete(jobSavePath)
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  async unsaveJob(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.unsaveJob.response.parse(
      successEnvelope(
        request,
        await this.service.unsaveJob(request, uuidOnly(params.jobId, 'jobId')),
      ),
    );
  }

  @Post(jobFeedbackPath)
  @HttpCode(200)
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  async recordJobFeedback(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.recordJobFeedback.response.parse(
      successEnvelope(
        request,
        await this.service.recordJobFeedback(request, uuidOnly(params.jobId, 'jobId'), body),
      ),
    );
  }
}
