import 'reflect-metadata';

import { parseApiEnvironment, type ApiEnvironment } from '@hanaply/config';
import { apiErrorEnvelopeSchema } from '@hanaply/contracts';
import { planFixture } from '@hanaply/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';
import type { AuthenticatedRequest } from '../../services/api/src/http.js';
import {
  createThrottlerStorage,
  rateLimitTracker,
  submittedIdentifier,
} from '../../services/api/src/rate-limit.js';

/**
 * Rate limiting, against the real Nest application.
 *
 * The defect this suite exists for: the throttle used to key on the client
 * address alone, and the web application reaches the API server-to-server, so
 * every member shared one bucket. A single member clicking through the product
 * consumed the whole allowance and unrelated members received 429. Every test
 * below therefore drives `app.inject` with an explicit `remoteAddress`, so a
 * bucket shared by address is indistinguishable from a bucket shared by
 * everybody — which is exactly the production shape behind the Next.js server.
 *
 * The scopes under test:
 *
 *   - an authenticated route keys on the verified session's user id, and the
 *     allowance of one member is invisible to another;
 *   - an unauthenticated (or malformed-token) caller keys on the client address;
 *   - an expensive route carries a tighter ceiling than the member default and
 *     is still refused per member;
 *   - the window resets as configured, and a 429 carries `Retry-After` and the
 *     `RATE_LIMITED` envelope.
 *
 * The repository boundary is a two-method fake and the auth service is a
 * token-to-actor map, mirroring `tests/integration/api.test.ts`: the guard, the
 * storage, the envelope, and the route table are all real, which is what makes
 * a passing assertion here mean something about the deployed application.
 */

const now = '2026-10-01T00:00:00.000Z';

/** The address the web server presents, shared by every member behind it. */
const webServerAddress = '198.51.100.10';

function profileFor(userId: string) {
  return {
    id: userId,
    firstName: 'Rate',
    lastName: 'Limit',
    displayName: 'Rate Limit',
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
}

function environmentWith(overrides: Record<string, string>): ApiEnvironment {
  return parseApiEnvironment({
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
    ...overrides,
  });
}

interface Member {
  readonly userId: string;
  readonly token: string;
}

/**
 * A Supabase access token is a JWT, and the guard only spends a verification on
 * a header that is shaped like one — a flood of garbage must not make the API
 * call the Auth server per request. Test sessions are therefore shaped like real
 * ones: three base64url segments, of which only the middle one carries meaning.
 */
function sessionToken(label: string): string {
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${label}.c2lnbmF0dXJl`;
}

const first: Member = {
  userId: '40000000-0000-4000-8000-00000000000a',
  token: sessionToken('first'),
};
const second: Member = {
  userId: '40000000-0000-4000-8000-00000000000b',
  token: sessionToken('second'),
};
const third: Member = {
  userId: '40000000-0000-4000-8000-00000000000c',
  token: sessionToken('third'),
};
const fourth: Member = {
  userId: '40000000-0000-4000-8000-00000000000d',
  token: sessionToken('fourth'),
};
const fifth: Member = {
  userId: '40000000-0000-4000-8000-00000000000e',
  token: sessionToken('fifth'),
};
const sixth: Member = {
  userId: '40000000-0000-4000-8000-00000000000f',
  token: sessionToken('sixth'),
};
const seventh: Member = {
  userId: '40000000-0000-4000-8000-000000000010',
  token: sessionToken('seventh'),
};

const members: readonly Member[] = [first, second, third, fourth, fifth, sixth, seventh];

const repository = {
  getProfile: (_accessToken: string, userId: string) => Promise.resolve(profileFor(userId)),
  getSubscription: () => Promise.resolve(undefined),
  listPlans: () => Promise.resolve([planFixture()]),
};

const authService = {
  authenticate: (request: AuthenticatedRequest): Promise<void> => {
    const header = request.headers.authorization;
    const presented = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;
    const member = presented
      ? members.find((candidate) => candidate.token === presented)
      : undefined;
    if (!member) {
      return Promise.reject(
        new AppError({
          code: 'AUTHENTICATION_REQUIRED',
          status: 401,
          message: 'Authentication is required',
        }),
      );
    }
    request.auth = { userId: member.userId, accessToken: member.token, accountStatus: 'active' };
    return Promise.resolve();
  },
  authorizeAdmin: () => Promise.resolve(),
};

interface InjectOptions {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  /** `null` sends no Authorization header at all. */
  readonly token?: string | null;
  /** The client address the API observes for this request. */
  readonly address?: string;
  readonly payload?: Record<string, unknown>;
}

interface NormalisedResponse {
  readonly status: number;
  readonly retryAfter: string | undefined;
  readonly body: string;
  json(): unknown;
}

type ApiApplication = Awaited<ReturnType<typeof createApiApplication>>;

function headerValue(value: string | number | readonly string[] | undefined): string | undefined {
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const first: string | undefined = value[0];
  return first;
}

function inject(app: ApiApplication, options: InjectOptions): Promise<NormalisedResponse> {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? first.token}`;
  return app
    .inject({
      method: options.method,
      url: options.url,
      headers,
      remoteAddress: options.address ?? webServerAddress,
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    })
    .then((response) => ({
      status: response.statusCode,
      retryAfter: headerValue(response.headers['retry-after']),
      body: response.body,
      json: () => JSON.parse(response.body) as unknown,
    }));
}

function retryAfterSeconds(response: NormalisedResponse): number {
  return response.retryAfter === undefined ? Number.NaN : Number(response.retryAfter);
}

async function burst(
  app: ApiApplication,
  count: number,
  options: InjectOptions,
): Promise<NormalisedResponse[]> {
  const responses: NormalisedResponse[] = [];
  for (let index = 0; index < count; index += 1) {
    responses.push(await inject(app, options));
  }
  return responses;
}

/**
 * The member default is deliberately tiny here: the arithmetic is what is under
 * test, and the production default is the same code path with a larger number.
 * The unauthenticated and expensive ceilings are smaller still, so each scope
 * can be told apart from the others by the status its burst produces.
 */
const scopedEnvironment = environmentWith({
  RATE_LIMIT_AUTHENTICATED_LIMIT: '5',
  RATE_LIMIT_AUTHENTICATED_TTL_MS: '60000',
  RATE_LIMIT_ANONYMOUS_LIMIT: '3',
  RATE_LIMIT_ANONYMOUS_TTL_MS: '60000',
  RATE_LIMIT_SENSITIVE_LIMIT: '2',
  RATE_LIMIT_SENSITIVE_TTL_MS: '60000',
  RATE_LIMIT_EXPENSIVE_LIMIT: '2',
  RATE_LIMIT_EXPENSIVE_TTL_MS: '60000',
});

describe('scoped rate limiting', () => {
  let app: ApiApplication;

  beforeAll(async () => {
    app = await createApiApplication(scopedEnvironment, { repository, authService });
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * The defect, stated as a test.
   *
   * Every request below arrives from the same address, because that is what the
   * web server does. The first member's burst is deliberately longer than the
   * 100-request address bucket the previous build created, so this test fails
   * against that build for the right reason: the first member's own burst, not
   * the second member's behaviour, is what used to answer 429 to everybody.
   */
  it('does not let one member’s burst throttle an unrelated member', async () => {
    const responses = await burst(app, 101, { method: 'GET', url: '/v1/me', token: first.token });

    expect(responses[0]?.status).toBe(200);
    expect(responses.at(-1)?.status).toBe(429);

    const unrelated = await inject(app, { method: 'GET', url: '/v1/me', token: second.token });
    expect(unrelated.status).toBe(200);
  });

  it('throttles the same member with the RATE_LIMITED envelope and Retry-After', async () => {
    const allowed = await burst(app, 5, { method: 'GET', url: '/v1/me', token: third.token });
    expect(allowed.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);

    const refused = await inject(app, { method: 'GET', url: '/v1/me', token: third.token });
    expect(refused.status).toBe(429);
    expect(apiErrorEnvelopeSchema.parse(refused.json()).error.code).toBe('RATE_LIMITED');
    expect(retryAfterSeconds(refused)).toBeGreaterThan(0);

    // The refused request is not charged to anyone else, and the member is still
    // the only actor whose allowance moved: a second member of the same address
    // is unaffected by the first member's refusal.
    const other = await inject(app, { method: 'GET', url: '/v1/me', token: fourth.token });
    expect(other.status).toBe(200);
  });

  it('refuses an address that exceeds the unauthenticated limit', async () => {
    const address = '203.0.113.7';
    const unauthenticated = await burst(app, 3, {
      method: 'GET',
      url: '/v1/me',
      token: null,
      address,
    });
    expect(unauthenticated.map((response) => response.status)).toEqual([401, 401, 401]);

    const refused = await inject(app, { method: 'GET', url: '/v1/me', token: null, address });
    expect(refused.status).toBe(429);
    expect(apiErrorEnvelopeSchema.parse(refused.json()).error.code).toBe('RATE_LIMITED');
    expect(retryAfterSeconds(refused)).toBeGreaterThan(0);

    // A different address has its own allowance: the key is the address, not the
    // process.
    const elsewhere = await inject(app, {
      method: 'GET',
      url: '/v1/me',
      token: null,
      address: '203.0.113.8',
    });
    expect(elsewhere.status).toBe(401);
  });

  it('keeps an expensive route on its own tighter ceiling, per member', async () => {
    const analysisUrl = '/v1/me/opportunities/40000000-0000-4000-8000-0000000000ff/analysis';

    // The route declares 20 requests an hour of its own; the configured
    // expensive ceiling for this application is 2 a minute, so the ceiling is
    // what refuses the third request. The handler is deliberately unstubbed —
    // what matters is that the refusal is a throttle and not a handler result.
    const allowed = await burst(app, 2, {
      method: 'POST',
      url: analysisUrl,
      token: fifth.token,
      payload: { refresh: false },
    });
    expect(allowed.map((response) => response.status)).not.toContain(429);

    const refused = await inject(app, {
      method: 'POST',
      url: analysisUrl,
      token: fifth.token,
      payload: { refresh: false },
    });
    expect(refused.status).toBe(429);
    expect(apiErrorEnvelopeSchema.parse(refused.json()).error.code).toBe('RATE_LIMITED');
    expect(retryAfterSeconds(refused)).toBeGreaterThan(0);

    const other = await inject(app, {
      method: 'POST',
      url: analysisUrl,
      token: sixth.token,
      payload: { refresh: false },
    });
    expect(other.status).not.toBe(429);
  });

  it('keeps a public route on its own limit, keyed by address rather than session', async () => {
    // `GET /v1/plans` is public and declares 120 requests a minute of its own.
    // It is deliberately keyed by address: a caller cannot spend a member's
    // allowance on a route that needs no session, not even by presenting one.
    const address = '203.0.113.20';
    const responses = await burst(app, 121, {
      method: 'GET',
      url: '/v1/plans',
      token: first.token,
      address,
    });
    expect(responses.slice(0, 120).map((response) => response.status)).not.toContain(429);
    expect(responses.at(-1)?.status).toBe(429);

    const sameMemberElsewhere = await inject(app, {
      method: 'GET',
      url: '/v1/plans',
      token: first.token,
      address: '203.0.113.21',
    });
    expect(sameMemberElsewhere.status).toBe(200);
  });

  it('falls back to the address when the bearer token is missing or malformed', async () => {
    const address = '203.0.113.9';
    for (const token of ['not-a-jwt', 'a.b.c', `${first.token} ${first.token}`]) {
      const response = await inject(app, { method: 'GET', url: '/v1/me', token, address });
      expect(response.status).toBe(401);
    }

    const refused = await inject(app, { method: 'GET', url: '/v1/me', token: 'a.b.c', address });
    expect(refused.status).toBe(429);
    expect(apiErrorEnvelopeSchema.parse(refused.json()).error.code).toBe('RATE_LIMITED');

    // The garbage did not buy a fresh bucket per token: the address is the key,
    // so the same address cannot escape the limit by changing the token it
    // sends.
    const elsewhere = await inject(app, {
      method: 'GET',
      url: '/v1/me',
      token: 'a.b.c',
      address: '203.0.113.11',
    });
    expect(elsewhere.status).toBe(401);
  });

  it('preserves a route’s own tighter per-route limit under the production defaults', async () => {
    const defaultConcurrency = await createApiApplication(
      environmentWith({
        RATE_LIMIT_AUTHENTICATED_LIMIT: '100',
        RATE_LIMIT_AUTHENTICATED_TTL_MS: '60000',
        RATE_LIMIT_EXPENSIVE_LIMIT: '60',
        RATE_LIMIT_EXPENSIVE_TTL_MS: '60000',
      }),
      { repository, authService },
    );
    try {
      const analysisUrl = '/v1/me/opportunities/40000000-0000-4000-8000-0000000000fe/analysis';
      const responses = await burst(defaultConcurrency, 21, {
        method: 'POST',
        url: analysisUrl,
        token: seventh.token,
        payload: { refresh: false },
      });

      // `POST /v1/me/opportunities/:jobId/analysis` declares 20 requests an hour
      // and the member default is 100 a minute, so the route's own decorator is
      // what refuses the twenty-first request: the decorators were kept.
      expect(responses.slice(0, 20).map((response) => response.status)).not.toContain(429);
      expect(responses.at(-1)?.status).toBe(429);
    } finally {
      await defaultConcurrency.close();
    }
  });
});

/**
 * The authentication scope, whose key is derived rather than observed.
 *
 * The API terminates no authentication route today — credential entry,
 * verification resend, password recovery, and token refresh are Supabase Auth
 * operations the web server performs directly, and the web layer applies this
 * exact policy in `apps/web/src/lib/rate-limit.ts` — so there is no route to
 * drive end to end. What can be pinned is the derivation the scope uses when a
 * route declares it: one bucket per address-and-identifier pair, so neither the
 * address nor the identifier alone can be varied to escape the limit, and the
 * identifier itself is hashed rather than carried in the key.
 */
describe('the authentication scope’s key', () => {
  const address = '203.0.113.30';

  it('separates one address and identifier pair from every other', () => {
    const pair = rateLimitTracker({ scope: 'sensitive', address, identifier: 'ana@example.com' });
    const otherIdentifier = rateLimitTracker({
      scope: 'sensitive',
      address,
      identifier: 'boa@example.com',
    });
    const otherAddress = rateLimitTracker({
      scope: 'sensitive',
      address: '203.0.113.31',
      identifier: 'ana@example.com',
    });

    expect(pair).not.toBe(otherIdentifier);
    expect(pair).not.toBe(otherAddress);
  });

  it('never puts the submitted identifier in the key in the clear', () => {
    const tracker = rateLimitTracker({
      scope: 'sensitive',
      address,
      identifier: 'Ana.Reyes+career@Example.com',
    });

    expect(tracker).toContain(address);
    expect(tracker.toLowerCase()).not.toContain('ana.reyes');
    expect(tracker.toLowerCase()).not.toContain('example.com');
  });

  it('reads a submitted identifier from the body and the query', () => {
    const requestWith = (body: unknown, query: unknown): AuthenticatedRequest =>
      ({ body, query }) as unknown as AuthenticatedRequest;

    const fromBody = submittedIdentifier(requestWith({ email: '  Ana.Reyes@Example.COM ' }, {}));
    const fromQuery = submittedIdentifier(
      requestWith({ note: 'no address here' }, { email: 'Ana.Reyes@Example.COM' }),
    );
    const absent = submittedIdentifier(requestWith({}, {}));

    expect(fromBody).toBe('ana.reyes@example.com');
    expect(fromQuery).toBe('ana.reyes@example.com');
    expect(absent).toBeUndefined();
  });
});

describe('rate-limit window reset', () => {
  let app: ApiApplication;

  beforeAll(async () => {
    // One second is the shortest window the environment schema accepts, which
    // keeps the reset assertion honest without a long sleep.
    app = await createApiApplication(
      environmentWith({
        RATE_LIMIT_AUTHENTICATED_LIMIT: '2',
        RATE_LIMIT_AUTHENTICATED_TTL_MS: '1000',
      }),
      { repository, authService },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves requests again once the configured window has passed', async () => {
    const allowed = await burst(app, 2, { method: 'GET', url: '/v1/me', token: first.token });
    expect(allowed.map((response) => response.status)).toEqual([200, 200]);

    const refused = await inject(app, { method: 'GET', url: '/v1/me', token: first.token });
    expect(refused.status).toBe(429);
    expect(retryAfterSeconds(refused)).toBeLessThanOrEqual(1);

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const recovered = await inject(app, { method: 'GET', url: '/v1/me', token: first.token });
    expect(recovered.status).toBe(200);
  });
});

/**
 * The storage seam.
 *
 * The in-memory store is per process, so two API instances do not share a
 * bucket: each one grants the configured allowance on its own, and a member's
 * effective allowance behind N instances is N times the configured number. That
 * is why production refuses to start on `RATE_LIMIT_STORE=memory`. These two
 * tests state the behaviour rather than describing it: the first shows two
 * instances sharing one store are one limiter, the second shows the default
 * deployment is not.
 */
describe('throttler storage', () => {
  const sharedEnvironment = environmentWith({
    RATE_LIMIT_AUTHENTICATED_LIMIT: '2',
    RATE_LIMIT_AUTHENTICATED_TTL_MS: '60000',
  });

  it('enforces one allowance across instances that share a store', async () => {
    const storage = createThrottlerStorage(sharedEnvironment);
    const primary = await createApiApplication(sharedEnvironment, {
      repository,
      authService,
      throttlerStorage: storage,
    });
    const replica = await createApiApplication(sharedEnvironment, {
      repository,
      authService,
      throttlerStorage: storage,
    });
    try {
      const exhausted = await burst(primary, 2, {
        method: 'GET',
        url: '/v1/me',
        token: second.token,
      });
      expect(exhausted.map((response) => response.status)).toEqual([200, 200]);

      const onReplica = await inject(replica, {
        method: 'GET',
        url: '/v1/me',
        token: second.token,
      });
      expect(onReplica.status).toBe(429);
    } finally {
      await primary.close();
      await replica.close();
    }
  });

  it('keeps per-process buckets when no shared store is configured', async () => {
    const primary = await createApiApplication(sharedEnvironment, { repository, authService });
    const replica = await createApiApplication(sharedEnvironment, { repository, authService });
    try {
      const exhausted = await burst(primary, 2, {
        method: 'GET',
        url: '/v1/me',
        token: third.token,
      });
      expect(exhausted.map((response) => response.status)).toEqual([200, 200]);

      const onReplica = await inject(replica, {
        method: 'GET',
        url: '/v1/me',
        token: third.token,
      });
      expect(onReplica.status).toBe(200);
    } finally {
      await primary.close();
      await replica.close();
    }
  });
});
