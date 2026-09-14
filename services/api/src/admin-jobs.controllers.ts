import { apiContract } from '@hanaply/contracts';
import {
  Body,
  Controller,
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

import { AdminJobsService } from './admin-jobs.service.js';
import { AdminAuthorizationGuard, RequirePermission, SupabaseAuthGuard } from './auth.js';
import { successEnvelope, type AuthenticatedRequest } from './http.js';

const routePath = (path: string): string => path.replaceAll(/\{(\w+)\}/gu, ':$1');

const jobSourceStatePath = routePath(apiContract.adminSetJobSourceState.path);
const jobSourceConfigPath = routePath(apiContract.adminUpdateJobSourceConfig.path);
const jobSourceScanPath = routePath(apiContract.adminRequestJobSourceScan.path);
const jobPath = routePath(apiContract.adminJob.path);
const jobStatusPath = routePath(apiContract.adminSetJobStatus.path);
const dedupResolvePath = routePath(apiContract.adminResolveDedupCandidate.path);

/**
 * Operator-only job operations. Every route requires an explicit catalogue
 * permission and mutating routes are throttled far below the read limits,
 * because each one writes an immutable audit event.
 */
@Controller()
@UseGuards(SupabaseAuthGuard, AdminAuthorizationGuard)
export class AdminJobsController {
  constructor(@Inject(AdminJobsService) private readonly service: AdminJobsService) {}

  @Get(apiContract.adminJobSources.path)
  @RequirePermission('job_sources.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async jobSources(@Req() request: AuthenticatedRequest) {
    return apiContract.adminJobSources.response.parse(
      successEnvelope(request, await this.service.jobSources(request)),
    );
  }

  @Post(jobSourceStatePath)
  @HttpCode(200)
  @RequirePermission('job_sources.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async setJobSourceState(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.adminSetJobSourceState.response.parse(
      successEnvelope(request, await this.service.setJobSourceState(request, params, body)),
    );
  }

  @Patch(jobSourceConfigPath)
  @RequirePermission('job_sources.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async updateJobSourceConfig(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.adminUpdateJobSourceConfig.response.parse(
      successEnvelope(request, await this.service.updateJobSourceConfig(request, params, body)),
    );
  }

  @Post(jobSourceScanPath)
  @HttpCode(200)
  @RequirePermission('job_sources.manage')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async requestJobSourceScan(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.adminRequestJobSourceScan.response.parse(
      successEnvelope(request, await this.service.requestJobSourceScan(request, params)),
    );
  }

  @Get(apiContract.adminIngestionHealth.path)
  @RequirePermission('job_sources.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async ingestionHealth(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return apiContract.adminIngestionHealth.response.parse(
      successEnvelope(request, await this.service.ingestionHealth(request, query)),
    );
  }

  @Get(apiContract.adminJobs.path)
  @RequirePermission('jobs.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async jobs(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return apiContract.adminJobs.response.parse(
      successEnvelope(request, await this.service.jobs(request, query)),
    );
  }

  @Get(jobPath)
  @RequirePermission('jobs.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async job(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.adminJob.response.parse(
      successEnvelope(request, await this.service.job(request, params)),
    );
  }

  @Post(jobStatusPath)
  @HttpCode(200)
  @RequirePermission('jobs.moderate')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async setJobStatus(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.adminSetJobStatus.response.parse(
      successEnvelope(request, await this.service.setJobStatus(request, params, body)),
    );
  }

  @Get(apiContract.adminDedupCandidates.path)
  @RequirePermission('jobs.moderate')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async dedupCandidates(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return apiContract.adminDedupCandidates.response.parse(
      successEnvelope(request, await this.service.dedupCandidates(request, query)),
    );
  }

  @Post(dedupResolvePath)
  @HttpCode(200)
  @RequirePermission('jobs.moderate')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async resolveDedupCandidate(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.adminResolveDedupCandidate.response.parse(
      successEnvelope(request, await this.service.resolveDedupCandidate(request, params, body)),
    );
  }
}
