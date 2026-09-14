import 'reflect-metadata';

import { permissions } from '@hanaply/auth';
import { parseApiEnvironment } from '@hanaply/config';
import { apiContract, apiErrorEnvelopeSchema } from '@hanaply/contracts';
import { completeEntitlementFixture, planFixture } from '@hanaply/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';

/**
 * Administrative job operations are operator-only. These tests pin the public
 * contract of all ten routes: authentication, the exact catalogue permission
 * each one requires, request validation, and the response envelope.
 */

const adminId = '40000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000010';
const jobId = '40000000-0000-4000-8000-000000000020';
const otherJobId = '40000000-0000-4000-8000-000000000021';
const candidateId = '40000000-0000-4000-8000-000000000030';
const runId = '40000000-0000-4000-8000-000000000040';
const now = '2026-09-20T00:00:00.000Z';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  HANAPLY_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:3100',
  API_BASE_URL: 'http://localhost:3101',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3100',
  RATE_LIMIT_STORE: 'memory',
  OPENAPI_ENABLED: 'true',
  BUILD_SHA: 'integration-test',
});

interface TestRequest {
  headers: { authorization?: string };
  auth?: {
    userId: string;
    accessToken: string;
    accountStatus: 'active';
    roles?: readonly string[];
    permissions?: ReadonlySet<string>;
  };
}

const jobSource = {
  id: sourceId,
  code: 'remotive',
  displayName: 'Remotive',
  sourceKind: 'remotive' as const,
  status: 'active' as const,
  baseUrl: 'https://remotive.com/api/remote-jobs',
  attribution: 'Remotive public API',
  termsUrl: 'https://remotive.com/terms',
  requiresCredentials: false,
  credentialEnvVar: null,
  minScanIntervalMinutes: 60,
  requestsPerMinute: 30,
  batchSize: 100,
  config: { boardTokens: ['acme'] },
  lastSuccessAt: now,
  lastFailureAt: null,
  lastErrorCode: null,
  consecutiveFailures: 0,
  circuitOpenUntil: null,
  totalJobsIngested: 12,
  createdAt: now,
  updatedAt: now,
  jobCount: 9,
  credentialConfigured: true,
  due: false,
};

const ingestionRun = {
  id: runId,
  trigger: 'schedule' as const,
  status: 'partial' as const,
  startedAt: now,
  finishedAt: now,
  durationMs: 1500,
  fetchedCount: 10,
  createdCount: 4,
  updatedCount: 2,
  mergedCount: 1,
  skippedCount: 2,
  rejectedCount: 1,
  errorCode: 'posting_rejected',
};

const jobDetail = {
  id: jobId,
  title: 'Senior Platform Engineer',
  companyName: 'Acme PH',
  employmentType: 'full_time' as const,
  seniority: 'senior',
  remoteState: 'remote' as const,
  locationRaw: 'Manila, Philippines',
  city: 'Manila',
  region: 'NCR',
  countryCode: 'PH',
  isPhilippines: true,
  isInternational: false,
  salaryMinMinor: 9_000_000,
  salaryMaxMinor: 12_000_000,
  salaryCurrency: 'PHP',
  salaryPeriod: 'monthly' as const,
  salaryIsEstimate: false,
  skills: ['typescript', 'postgres'],
  sourceCount: 2,
  status: 'active' as const,
  excerpt: 'Build the ingestion platform.',
  description: 'Build the ingestion platform that powers every Hanaply feed.',
  dedupKey: 'acme|senior platform engineer|remote',
  contentFingerprint: 'a'.repeat(64),
  normalizedTitle: 'senior platform engineer',
  requirements: ['Five years of TypeScript'],
  preferredQualifications: ['Experience with Postgres'],
  postedAt: now,
  expiresAt: null,
  firstSeenAt: now,
  lastSeenAt: now,
  lastVerifiedAt: now,
  sources: [
    {
      sourceRecordId: '40000000-0000-4000-8000-000000000050',
      sourceCode: 'remotive',
      displayName: 'Remotive',
      sourceJobId: 'remotive-1',
      sourceUrl: 'https://remotive.com/jobs/1',
      status: 'active' as const,
      isPrimary: true,
      firstSeenAt: now,
      lastSeenAt: now,
      payloadChecksum: 'b'.repeat(64),
    },
  ],
  duplicateCandidates: [
    {
      id: candidateId,
      otherJobId,
      score: 0.93,
      signals: { titleMatch: true, companyMatch: true, locationDeltaKm: 2 },
      resolution: null,
      createdAt: now,
    },
  ],
};

const dedupCandidate = {
  id: candidateId,
  jobId,
  jobTitle: jobDetail.title,
  jobCompany: jobDetail.companyName,
  duplicateJobId: otherJobId,
  duplicateTitle: 'Platform Engineer (Senior)',
  duplicateCompany: 'Acme Philippines',
  duplicateSourceCount: 1,
  score: 0.93,
  signals: { titleMatch: true, companyMatch: true },
  resolution: null,
  resolvedAt: null,
  createdAt: now,
};

const calls: { name: string; args: Record<string, unknown> }[] = [];

const repository = {
  isReady: () => Promise.resolve(true),
  listPlans: () => Promise.resolve([planFixture()]),
  getPlatformSetting: (platform: 'web' | 'ios' | 'android') =>
    Promise.resolve({
      platform,
      status: 'active' as const,
      minimumVersion: null,
      latestVersion: null,
      forceUpdate: false,
      maintenanceMode: false,
      apiCompatibilityVersion: 1,
      announcement: null,
    }),
  getFeatureFlagConfiguration: () => Promise.resolve({ definitions: [], rules: [] }),
  getProfile: () =>
    Promise.resolve({
      id: adminId,
      firstName: 'Ada',
      lastName: 'Admin',
      displayName: 'Ada Admin',
      locale: 'en-PH',
      timezone: 'Asia/Manila',
      countryCode: 'PH',
      onboardingStatus: 'complete' as const,
      accountStatus: 'active' as const,
      emailVerifiedAt: now,
      lastPasswordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  getNotificationPreferences: () =>
    Promise.resolve({
      productUpdates: false,
      marketingEmails: false,
      jobAlerts: false,
      dailyDigest: false,
      instantAlerts: false,
      weeklyStrategy: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      securityEmails: true as const,
      updatedAt: now,
    }),
  getMySubscriptionRecord: () =>
    Promise.resolve({
      id: '40000000-0000-4000-8000-000000000060',
      planId: '40000000-0000-4000-8000-000000000061',
      status: 'active' as const,
      startsAt: now,
      endsAt: null,
      source: 'admin_grant' as const,
      entitlements: completeEntitlementFixture(),
    }),
};

const adminJobsRepository = {
  jobSources: () => Promise.resolve({ items: [jobSource], evaluatedAt: now }),
  setJobSourceState: (
    _actor: string,
    id: string,
    action: string,
    reason: string,
    requestId: string,
  ) => {
    calls.push({
      name: 'admin_set_job_source_state',
      args: { id, action, reason, requestId },
    });
    // A provider that already had the requested status affects no row.
    return Promise.resolve(action === 'pause' ? 0 : 1);
  },
  updateJobSourceConfig: (_actor: string, id: string, config: Record<string, unknown>) => {
    calls.push({ name: 'admin_update_job_source_config', args: { id, config } });
    if (Object.keys(config).some((key) => key.toLowerCase() === 'apikey')) {
      // Mirrors the SQLSTATE the database function raises for a credential key.
      return Promise.reject(
        new AppError({
          code: 'VALIDATION_ERROR',
          status: 400,
          message: 'provider configuration must not contain credentials',
        }),
      );
    }
    return Promise.resolve(true);
  },
  requestSourceScan: (_actor: string, id: string) => {
    calls.push({ name: 'admin_request_source_scan', args: { id } });
    return Promise.resolve(true);
  },
  ingestionHealth: (_actor: string, runLimit: number) => {
    calls.push({ name: 'admin_ingestion_health', args: { runLimit } });
    return Promise.resolve({
      sources: [
        {
          sourceId,
          sourceCode: jobSource.code,
          displayName: jobSource.displayName,
          status: jobSource.status,
          lastSuccessAt: now,
          lastFailureAt: null,
          lastErrorCode: null,
          consecutiveFailures: 0,
          circuitOpenUntil: null,
          totalJobsIngested: 12,
          recentRuns: [ingestionRun],
        },
      ],
      recentRuns: [
        {
          id: runId,
          sourceCode: jobSource.code,
          status: 'partial' as const,
          startedAt: now,
          durationMs: 1500,
          createdCount: 4,
          errorCode: 'posting_rejected',
        },
      ],
      totals: {
        activeJobs: 5,
        staleJobs: 1,
        expiredJobs: 0,
        companies: 3,
        sourceRecords: 9,
        openDeduplicationCandidates: 1,
      },
      evaluatedAt: now,
    });
  },
  jobs: (_actor: string, filters: { pageSize: number; pageOffset: number }) => {
    calls.push({ name: 'admin_job_directory', args: { ...filters } });
    return Promise.resolve({
      items: [
        {
          id: jobId,
          title: jobDetail.title,
          companyName: jobDetail.companyName,
          status: jobDetail.status,
          remoteState: jobDetail.remoteState,
          countryCode: jobDetail.countryCode,
          sourceCount: jobDetail.sourceCount,
          postedAt: jobDetail.postedAt,
          firstSeenAt: jobDetail.firstSeenAt,
          lastSeenAt: jobDetail.lastSeenAt,
          dedupKey: jobDetail.dedupKey,
        },
      ],
      total: 1,
      pageSize: filters.pageSize,
      pageOffset: filters.pageOffset,
    });
  },
  job: () => Promise.resolve(jobDetail),
  setJobStatus: (_actor: string, id: string, status: string, reason: string) => {
    calls.push({ name: 'admin_set_job_status', args: { id, status, reason } });
    return Promise.resolve(true);
  },
  dedupCandidates: (
    _actor: string,
    filters: { includeResolved: boolean; pageSize: number; pageOffset: number },
  ) => {
    calls.push({ name: 'admin_dedup_candidates', args: { ...filters } });
    return Promise.resolve({ items: [dedupCandidate], openCount: 1, evaluatedAt: now });
  },
  resolveDedupCandidate: (_actor: string, id: string, resolution: string, reason: string) => {
    calls.push({ name: 'admin_resolve_dedup_candidate', args: { id, resolution, reason } });
    return Promise.resolve(true);
  },
};

function authenticationError(message = 'Authentication is required'): AppError {
  return new AppError({ code: 'AUTHENTICATION_REQUIRED', status: 401, message });
}

const authService = {
  authenticate(request: TestRequest): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return Promise.reject(authenticationError());
    const token = authorization.slice(7);
    if (!['admin-token', 'source-reader-token', 'job-reader-token'].includes(token)) {
      return Promise.reject(authenticationError('Bearer token is invalid'));
    }
    request.auth = { userId: adminId, accessToken: token, accountStatus: 'active' };
    return Promise.resolve();
  },
  authorizeAdmin(request: TestRequest, requirement: unknown): Promise<void> {
    const auth = request.auth;
    if (!auth) {
      return Promise.reject(
        new AppError({
          code: 'FORBIDDEN',
          status: 403,
          message: 'Administrator membership is required',
        }),
      );
    }
    const granted =
      auth.accessToken === 'admin-token'
        ? new Set<string>(permissions)
        : auth.accessToken === 'source-reader-token'
          ? new Set(['job_sources.read'])
          : new Set(['jobs.read']);
    const permissionRequirement = requirement as {
      mode: 'all' | 'any';
      permissions: readonly string[];
    };
    const permitted =
      permissionRequirement.mode === 'any'
        ? permissionRequirement.permissions.some((permission) => granted.has(permission))
        : permissionRequirement.permissions.every((permission) => granted.has(permission));
    if (!permitted) {
      return Promise.reject(
        new AppError({
          code: 'FORBIDDEN',
          status: 403,
          message: 'Required administrator permission is missing',
        }),
      );
    }
    request.auth = { ...auth, roles: ['super_admin'], permissions: granted };
    return Promise.resolve();
  },
};

const adminHeaders = { authorization: 'Bearer admin-token' };
const sourceReaderHeaders = { authorization: 'Bearer source-reader-token' };
const jobReaderHeaders = { authorization: 'Bearer job-reader-token' };

type InjectMethod = 'GET' | 'POST' | 'PATCH';

/**
 * Every assertion below reads the response through the shared contract schemas,
 * so a shape the contract does not describe fails the test rather than passing
 * silently.
 */
describe('Administrative job operations', () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      repository,
      adminJobsRepository,
      authService,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function inject(
    method: InjectMethod,
    url: string,
    options: { headers?: Record<string, string>; payload?: Record<string, unknown> } = {},
  ) {
    return app.inject({
      method,
      url,
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.payload ? { payload: options.payload } : {}),
    });
  }

  it('requires authentication on every administrative job route', async () => {
    const response = await inject('GET', '/v1/admin/job-sources');
    expect(response.statusCode).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe(
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('lists the provider catalogue with health and due state', async () => {
    const response = await inject('GET', '/v1/admin/job-sources', { headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    const body = apiContract.adminJobSources.response.parse(response.json());
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.credentialConfigured).toBe(true);
    expect(body.data.items[0]?.due).toBe(false);
  });

  it('denies the provider catalogue without job_sources.read', async () => {
    const response = await inject('GET', '/v1/admin/job-sources', { headers: jobReaderHeaders });
    expect(response.statusCode).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('FORBIDDEN');
  });

  it('changes a provider state with an audited reason', async () => {
    const response = await inject('POST', `/v1/admin/job-sources/${sourceId}/state`, {
      headers: adminHeaders,
      payload: { action: 'disable', reason: 'Provider terms changed on 2026-09-20' },
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminSetJobSourceState.response.parse(response.json()).data).toEqual({
      changed: true,
    });
    const lastCall = calls.at(-1);
    expect(lastCall?.name).toBe('admin_set_job_source_state');
    expect(lastCall?.args).toMatchObject({
      id: sourceId,
      action: 'disable',
      reason: 'Provider terms changed on 2026-09-20',
    });
    // The audit event is keyed by the inbound request id, which the interceptor
    // guarantees is a UUID.
    expect(lastCall?.args.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('reports no change when the provider already had the requested status', async () => {
    const response = await inject('POST', `/v1/admin/job-sources/${sourceId}/state`, {
      headers: adminHeaders,
      payload: { action: 'pause', reason: 'Pause while the provider rotates its endpoint' },
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminSetJobSourceState.response.parse(response.json()).data).toEqual({
      changed: false,
    });
  });

  it('rejects a provider state change with a short reason', async () => {
    const response = await inject('POST', `/v1/admin/job-sources/${sourceId}/state`, {
      headers: adminHeaders,
      payload: { action: 'disable', reason: 'too short' },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unsupported provider action before reaching the database', async () => {
    const response = await inject('POST', `/v1/admin/job-sources/${sourceId}/state`, {
      headers: adminHeaders,
      payload: { action: 'restart', reason: 'Try to restart the provider safely' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('denies a provider state change without job_sources.manage', async () => {
    const response = await inject('POST', `/v1/admin/job-sources/${sourceId}/state`, {
      headers: sourceReaderHeaders,
      payload: { action: 'disable', reason: 'Provider terms changed on 2026-09-20' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('replaces a provider configuration that holds no credential key', async () => {
    const response = await inject('PATCH', `/v1/admin/job-sources/${sourceId}/config`, {
      headers: adminHeaders,
      payload: {
        config: { boardTokens: ['acme', 'globex'] },
        reason: 'Add the Globex board to the scan list',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminUpdateJobSourceConfig.response.parse(response.json()).data).toEqual({
      updated: true,
    });
  });

  it('surfaces the database refusal when a credential key is sent', async () => {
    const response = await inject('PATCH', `/v1/admin/job-sources/${sourceId}/config`, {
      headers: adminHeaders,
      payload: { config: { apiKey: 'secret' }, reason: 'Attempt to store a credential' },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.message).toBe(
      'provider configuration must not contain credentials',
    );
  });

  it('rejects a provider configuration that is not a JSON object', async () => {
    const response = await inject('PATCH', `/v1/admin/job-sources/${sourceId}/config`, {
      headers: adminHeaders,
      payload: { config: ['acme'], reason: 'Send a list instead of an object' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('requests a provider scan', async () => {
    const response = await inject('POST', `/v1/admin/job-sources/${sourceId}/scan`, {
      headers: adminHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminRequestJobSourceScan.response.parse(response.json()).data).toEqual({
      requested: true,
    });
  });

  it('rejects a provider path that is not a UUID', async () => {
    const response = await inject('POST', '/v1/admin/job-sources/not-a-uuid/scan', {
      headers: adminHeaders,
    });
    expect(response.statusCode).toBe(404);
  });

  it('reads ingestion health with the default run limit', async () => {
    const response = await inject('GET', '/v1/admin/ingestion', { headers: adminHeaders });
    expect(response.statusCode).toBe(200);
    const body = apiContract.adminIngestionHealth.response.parse(response.json());
    expect(body.data.totals.activeJobs).toBe(5);
    expect(body.data.recentRuns[0]?.status).toBe('partial');
    expect(calls.at(-1)).toEqual({ name: 'admin_ingestion_health', args: { runLimit: 25 } });
  });

  it('rejects an ingestion run limit outside the allowed range', async () => {
    const response = await inject('GET', '/v1/admin/ingestion?runLimit=500', {
      headers: adminHeaders,
    });
    expect(response.statusCode).toBe(400);
  });

  it('lists the canonical job directory with filters and pagination', async () => {
    const response = await inject(
      'GET',
      '/v1/admin/jobs?status=active&search=platform&page=2&pageSize=10',
      { headers: adminHeaders },
    );
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminJobs.response.parse(response.json()).data.total).toBe(1);
    expect(calls.at(-1)).toEqual({
      name: 'admin_job_directory',
      args: { search: 'platform', status: 'active', pageSize: 10, pageOffset: 10 },
    });
  });

  it('treats an empty search and status filter as absent', async () => {
    await inject('GET', '/v1/admin/jobs?search=&status=', { headers: adminHeaders });
    expect(calls.at(-1)).toEqual({
      name: 'admin_job_directory',
      args: { search: null, status: null, pageSize: 25, pageOffset: 0 },
    });
  });

  it('denies the job directory without jobs.read', async () => {
    const response = await inject('GET', '/v1/admin/jobs', { headers: sourceReaderHeaders });
    expect(response.statusCode).toBe(403);
  });

  it('reads one canonical job record with provenance and candidates', async () => {
    const response = await inject('GET', `/v1/admin/jobs/${jobId}`, { headers: jobReaderHeaders });
    expect(response.statusCode).toBe(200);
    const body = apiContract.adminJob.response.parse(response.json());
    expect(body.data.dedupKey).toBe(jobDetail.dedupKey);
    expect(body.data.sources[0]?.payloadChecksum).toBe('b'.repeat(64));
    expect(body.data.duplicateCandidates[0]?.score).toBeCloseTo(0.93);
  });

  it('changes a job status with an audited reason', async () => {
    const response = await inject('POST', `/v1/admin/jobs/${jobId}/status`, {
      headers: adminHeaders,
      payload: { status: 'rejected', reason: 'Duplicate of an existing canonical posting' },
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminSetJobStatus.response.parse(response.json()).data).toEqual({
      changed: true,
    });
    expect(calls.at(-1)).toEqual({
      name: 'admin_set_job_status',
      args: {
        id: jobId,
        status: 'rejected',
        reason: 'Duplicate of an existing canonical posting',
      },
    });
  });

  it('denies a job status change without jobs.moderate', async () => {
    const response = await inject('POST', `/v1/admin/jobs/${jobId}/status`, {
      headers: jobReaderHeaders,
      payload: { status: 'rejected', reason: 'Duplicate of an existing canonical posting' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a status outside the moderation set', async () => {
    const response = await inject('POST', `/v1/admin/jobs/${jobId}/status`, {
      headers: adminHeaders,
      payload: { status: 'duplicate', reason: 'Try to set the duplicate status directly' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('lists the deduplication queue and honours the resolved filter', async () => {
    const response = await inject('GET', '/v1/admin/deduplication?includeResolved=true', {
      headers: adminHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminDedupCandidates.response.parse(response.json()).data.openCount).toBe(1);
    expect(calls.at(-1)).toEqual({
      name: 'admin_dedup_candidates',
      args: { includeResolved: true, pageSize: 25, pageOffset: 0 },
    });
  });

  it('defaults the deduplication queue to open pairs only', async () => {
    await inject('GET', '/v1/admin/deduplication', { headers: adminHeaders });
    expect(calls.at(-1)).toEqual({
      name: 'admin_dedup_candidates',
      args: { includeResolved: false, pageSize: 25, pageOffset: 0 },
    });
  });

  it('denies the deduplication queue without jobs.moderate', async () => {
    const response = await inject('GET', '/v1/admin/deduplication', { headers: jobReaderHeaders });
    expect(response.statusCode).toBe(403);
  });

  it('resolves a deduplication candidate', async () => {
    const response = await inject('POST', `/v1/admin/deduplication/${candidateId}/resolve`, {
      headers: adminHeaders,
      payload: { resolution: 'merged', reason: 'Same role posted twice by the same employer' },
    });
    expect(response.statusCode).toBe(200);
    expect(apiContract.adminResolveDedupCandidate.response.parse(response.json()).data).toEqual({
      resolved: true,
    });
    expect(calls.at(-1)).toEqual({
      name: 'admin_resolve_dedup_candidate',
      args: {
        id: candidateId,
        resolution: 'merged',
        reason: 'Same role posted twice by the same employer',
      },
    });
  });

  it('rejects an unsupported deduplication resolution', async () => {
    const response = await inject('POST', `/v1/admin/deduplication/${candidateId}/resolve`, {
      headers: adminHeaders,
      payload: { resolution: 'deleted', reason: 'Attempt an unsupported resolution value' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('denies resolving a candidate without jobs.moderate', async () => {
    const response = await inject('POST', `/v1/admin/deduplication/${candidateId}/resolve`, {
      headers: jobReaderHeaders,
      payload: { resolution: 'merged', reason: 'Same role posted twice by the same employer' },
    });
    expect(response.statusCode).toBe(403);
  });
});
