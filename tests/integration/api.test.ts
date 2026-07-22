import 'reflect-metadata';

import { permissions } from '@hanaply/auth';
import { parseApiEnvironment } from '@hanaply/config';
import { apiContract, apiErrorEnvelopeSchema } from '@hanaply/contracts';
import { completeEntitlementFixture, planFixture } from '@hanaply/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';

const userId = '30000000-0000-4000-8000-000000000001';
const adminId = '30000000-0000-4000-8000-000000000002';
const planId = '30000000-0000-4000-8000-000000000010';
const now = '2026-07-22T00:00:00.000Z';

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

const profile = {
  id: userId,
  firstName: 'Phase',
  lastName: 'One',
  displayName: 'Phase Zero User',
  locale: 'en-PH',
  timezone: 'Asia/Manila',
  countryCode: 'PH',
  onboardingStatus: 'not_started' as const,
  accountStatus: 'active' as const,
  emailVerifiedAt: now,
  lastPasswordChangedAt: null,
  createdAt: now,
  updatedAt: now,
};

const subscriptionRow = {
  id: '30000000-0000-4000-8000-000000000020',
  user_id: userId,
  plan_id: planId,
  status: 'active' as const,
  starts_at: '2026-07-01T00:00:00.000Z',
  ends_at: '2026-08-01T00:00:00.000Z',
  source: 'admin_grant' as const,
  activation_metadata: {},
  created_at: now,
  updated_at: now,
};

const state = { ready: true, subscription: true };
const fixture = planFixture();
const repository = {
  isReady: () => Promise.resolve(state.ready),
  listPlans: () => Promise.resolve([fixture]),
  getPlatformSetting: (platform: 'web' | 'ios' | 'android') =>
    Promise.resolve({
      platform,
      status: platform === 'web' ? ('active' as const) : ('planned' as const),
      minimumVersion: null,
      latestVersion: platform === 'web' ? '0.0.0' : null,
      forceUpdate: false,
      maintenanceMode: false,
      apiCompatibilityVersion: 1,
      announcement: platform === 'web' ? null : `Hanaply for ${platform} is planned.`,
    }),
  getFeatureFlagConfiguration: () =>
    Promise.resolve({
      definitions: [
        { key: 'career_profiles', defaultEnabled: false, clientExposed: true },
        { key: 'job_ingestion', defaultEnabled: false, clientExposed: false },
      ],
      rules: [],
    }),
  getProfile: (_accessToken: string, requestedUserId: string) =>
    Promise.resolve({ ...profile, id: requestedUserId }),
  getSubscription: () =>
    Promise.resolve(
      state.subscription
        ? {
            row: subscriptionRow,
            summary: {
              planCode: 'plus_monthly',
              status: 'active' as const,
              startsAt: subscriptionRow.starts_at,
              endsAt: subscriptionRow.ends_at,
            },
          }
        : null,
    ),
  getPlanEntitlementSnapshot: () =>
    Promise.resolve({
      code: 'plus_monthly',
      entitlements: completeEntitlementFixture({ careerProfileLimit: 1, emailAlerts: true }),
    }),
  toEntitlementSubscription: () => ({
    planCode: 'plus_monthly',
    status: 'active' as const,
    startsAt: subscriptionRow.starts_at,
    endsAt: subscriptionRow.ends_at,
  }),
};

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

function authenticationError(message = 'Authentication is required'): AppError {
  return new AppError({ code: 'AUTHENTICATION_REQUIRED', status: 401, message });
}

const authService = {
  authenticate(request: TestRequest): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return Promise.reject(authenticationError());
    const token = authorization.slice(7);
    if (token === 'invalid-token' || token === 'expired-token') {
      return Promise.reject(authenticationError('Session is invalid or expired'));
    }
    if (token === 'suspended-token') {
      return Promise.reject(
        new AppError({
          code: 'ACCOUNT_SUSPENDED',
          status: 403,
          message: 'This account is suspended',
        }),
      );
    }
    if (!['user-token', 'admin-token'].includes(token)) {
      return Promise.reject(authenticationError('Bearer token is invalid'));
    }
    request.auth = {
      userId: token === 'admin-token' ? adminId : userId,
      accessToken: token,
      accountStatus: 'active',
    };
    return Promise.resolve();
  },
  authorizeAdmin(request: TestRequest, _requirement: unknown): Promise<void> {
    void _requirement;
    if (request.auth?.accessToken !== 'admin-token') {
      return Promise.reject(
        new AppError({
          code: 'FORBIDDEN',
          status: 403,
          message: 'Administrator membership is required',
        }),
      );
    }
    request.auth = {
      ...request.auth,
      roles: ['super_admin'],
      permissions: new Set(permissions),
    };
    return Promise.resolve();
  },
};

describe('Phase 0 API integration', () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;

  beforeAll(async () => {
    app = await createApiApplication(environment, { repository, authService });
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves public liveness with a valid request ID and contract envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(200);
    const body = apiContract.health.response.parse(response.json());
    expect(body.data.service).toBe('api');
    expect(response.headers['x-request-id']).toBe(body.meta.requestId);
  });

  it('serves readiness and maps dependency failure to a safe 503', async () => {
    const healthy = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(apiContract.ready.response.parse(healthy.json()).data.checks.supabase).toBe('up');
    state.ready = false;
    const unavailable = await app.inject({ method: 'GET', url: '/v1/ready' });
    state.ready = true;
    expect(unavailable.statusCode).toBe(503);
    expect(apiErrorEnvelopeSchema.parse(unavailable.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('returns API and build versions', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/version' });
    const body = apiContract.version.response.parse(response.json());
    expect(body.data).toMatchObject({ apiVersion: 'v1', buildSha: 'integration-test' });
  });

  it('evaluates platform state and only client-exposed flags', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/meta?platform=web' });
    const body = apiContract.meta.response.parse(response.json());
    expect(body.data.platform.availability).toBe('available');
    expect(body.data.featureFlags).toEqual({ career_profiles: false });
  });

  it('returns safe validation errors for invalid platform and semantic version inputs', async () => {
    for (const url of ['/v1/meta?platform=desktop', '/v1/meta?platform=web&clientVersion=nope']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      const error = apiErrorEnvelopeSchema.parse(response.json());
      expect(error.error.code).toBe('VALIDATION_ERROR');
      expect(error.error.details?.length).toBeGreaterThan(0);
    }
  });

  it('returns database-authoritative public plans', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/plans' });
    const body = apiContract.plans.response.parse(response.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ code: 'plus_monthly', priceMinor: 49_900 });
  });

  it.each([
    [undefined, 'AUTHENTICATION_REQUIRED'],
    ['Bearer invalid-token', 'AUTHENTICATION_REQUIRED'],
    ['Bearer expired-token', 'AUTHENTICATION_REQUIRED'],
    ['Bearer suspended-token', 'ACCOUNT_SUSPENDED'],
  ])('rejects protected access for %s', async (authorization, code) => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      ...(authorization ? { headers: { authorization } } : {}),
    });
    expect(response.statusCode).toBe(code === 'ACCOUNT_SUSPENDED' ? 403 : 401);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe(code);
  });

  it('returns the active caller profile and subscription', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer user-token' },
    });
    const body = apiContract.me.response.parse(response.json());
    expect(body.data.profile.id).toBe(userId);
    expect(body.data.subscription.planCode).toBe('plus_monthly');
  });

  it('evaluates caller entitlements and denies by default without a subscription', async () => {
    const active = await app.inject({
      method: 'GET',
      url: '/v1/me/entitlements',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(apiContract.entitlements.response.parse(active.json()).data.planCode).toBe(
      'plus_monthly',
    );
    state.subscription = false;
    const inactive = await app.inject({
      method: 'GET',
      url: '/v1/me/entitlements',
      headers: { authorization: 'Bearer user-token' },
    });
    state.subscription = true;
    const body = apiContract.entitlements.response.parse(inactive.json());
    expect(body.data.planCode).toBeNull();
    expect(body.data.entitlements.careerProfileLimit).toBe(0);
  });

  it('denies a normal user and returns database-derived administrator access', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/admin/me',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(denied.statusCode).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(denied.json()).error.code).toBe('FORBIDDEN');

    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/admin/me',
      headers: { authorization: 'Bearer admin-token' },
    });
    const body = apiContract.adminMe.response.parse(allowed.json());
    expect(body.data.roles).toEqual(['super_admin']);
    expect(body.data.permissions).toEqual([...permissions].sort());
  });

  it('generates OpenAPI 3.1 from every canonical route and serves local docs', async () => {
    const openApiResponse = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApiResponse.statusCode).toBe(200);
    expect(openApiResponse.body).toContain('"openapi":"3.1.0"');
    for (const route of Object.values(apiContract)) {
      expect(openApiResponse.body).toContain(`"${route.path}"`);
    }

    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');
    expect(docs.body).toContain('/openapi.json');
  });

  it('hides generated documentation in production', async () => {
    const productionApp = await createApiApplication(
      { ...environment, HANAPLY_ENV: 'production' },
      { repository, authService },
    );
    const response = await productionApp.inject({ method: 'GET', url: '/openapi.json' });
    await productionApp.close();
    expect(response.statusCode).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('enforces the in-memory Phase 0 rate limit with a safe envelope', async () => {
    let limitedResponse: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let attempt = 0; attempt < 140; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/v1/plans' });
      if (response.statusCode === 429) {
        limitedResponse = response;
        break;
      }
    }
    expect(limitedResponse).toBeDefined();
    expect(apiErrorEnvelopeSchema.parse(limitedResponse?.json()).error.code).toBe('RATE_LIMITED');
  });
});
