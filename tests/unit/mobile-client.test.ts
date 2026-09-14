import { describe, expect, it } from 'vitest';

import {
  MOBILE_REFRESH_TOKEN_KEY,
  MobileSessionError,
  buildDeepLink,
  createMobileApi,
  createMobileSession,
  resolveDeepLink,
  type MobileFetch,
  type SecureStorePort,
} from '../../packages/mobile-client/src/index.js';

/**
 * Mobile client core.
 *
 * These tests exist to hold two promises that are easy to break silently:
 * refresh material never leaves the secure store and an access token is never
 * written to it, and a deep link can only reach a route on the allowlist.
 */

const ORIGIN = 'https://app.hanaply.test';

/**
 * A complete insights payload. The shared client validates every response
 * against the contract, so a partial fixture would fail for the wrong reason.
 */
const INSIGHTS = {
  hasProfile: false,
  profileStrength: null,
  matching: null,
  pipeline: null,
  gaps: [],
  salary: null,
  directions: [],
  activity: [],
  coaching: [],
};
const JOB_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Normalises whatever the transport was handed. The shared client passes a URL
 * and the session passes a string, and a Request is stringified as
 * [object Request], so the cases are handled explicitly rather than coerced.
 */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function memoryStore(): SecureStorePort & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => Promise.resolve(entries.get(key) ?? null),
    setItem: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

interface Call {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function fakeTransport(handler: (call: Call) => { status: number; json: unknown }): {
  fetch: MobileFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: MobileFetch = (input, init) => {
    const call: Call = {
      url: urlOf(input),
      // The transport only ever receives a JSON string body from this package.
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const result = handler(call);
    return Promise.resolve(
      new Response(JSON.stringify(result.json), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetch, calls };
}

function okHandler(refresh = 'refresh-2') {
  return () => ({
    status: 200,
    json: {
      access_token: 'access-1',
      refresh_token: refresh,
      expires_in: 3600,
      user: { id: 'user-1', email: 'member@hanaply.test' },
    },
  });
}

describe('mobile session', () => {
  it('stores the refresh token in the secure store and signs the caller in', async () => {
    const store = memoryStore();
    const { fetch } = fakeTransport(okHandler());
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    const state = await session.signIn('member@hanaply.test', 'CorrectHorse1');

    expect(state.signedIn).toBe(true);
    expect(state.userId).toBe('user-1');
    expect(store.entries.get(MOBILE_REFRESH_TOKEN_KEY)).toBe('refresh-2');
  });

  it('never writes the access token to the secure store', async () => {
    const store = memoryStore();
    const { fetch } = fakeTransport(okHandler());
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');

    const persisted = [...store.entries.values()].join('|');
    expect(persisted).not.toContain('access-1');
    expect([...store.entries.keys()]).toEqual([MOBILE_REFRESH_TOKEN_KEY]);
  });

  it('never retains the password on the session', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeTransport(okHandler());
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');

    expect(calls).toHaveLength(1);
    expect(JSON.stringify(session.state())).not.toContain('CorrectHorse1');
  });

  it('sends the anon key as the apikey header rather than a service key', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeTransport(okHandler());
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon-key', store, fetch });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');

    expect(calls[0]?.headers.apikey).toBe('anon-key');
  });

  it('reports invalid credentials without echoing the transport response', async () => {
    const store = memoryStore();
    const { fetch } = fakeTransport(() => ({ status: 400, json: { message: 'invalid grant' } }));
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    await expect(session.signIn('member@hanaply.test', 'Wrong')).rejects.toBeInstanceOf(
      MobileSessionError,
    );
    expect(store.entries.size).toBe(0);
  });

  it('returns the signed-out state when there is nothing to restore', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeTransport(okHandler());
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    const state = await session.restore();

    expect(state.signedIn).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('restores a session from the stored refresh token', async () => {
    const store = memoryStore();
    store.entries.set(MOBILE_REFRESH_TOKEN_KEY, 'refresh-1');
    const { fetch, calls } = fakeTransport(okHandler('refresh-2'));
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    const state = await session.restore();

    expect(state.signedIn).toBe(true);
    expect(calls[0]?.url).toContain('grant_type=refresh_token');
    expect(store.entries.get(MOBILE_REFRESH_TOKEN_KEY)).toBe('refresh-2');
  });

  it('discards a refresh token the server rejects, rather than retrying it forever', async () => {
    const store = memoryStore();
    store.entries.set(MOBILE_REFRESH_TOKEN_KEY, 'stale');
    const { fetch } = fakeTransport(() => ({ status: 401, json: { message: 'invalid' } }));
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    const state = await session.restore();

    expect(state.signedIn).toBe(false);
    expect(store.entries.has(MOBILE_REFRESH_TOKEN_KEY)).toBe(false);
  });

  it('returns null rather than throwing when the transport is unreachable', async () => {
    const store = memoryStore();
    store.entries.set(MOBILE_REFRESH_TOKEN_KEY, 'refresh-1');
    const failing: MobileFetch = () => Promise.reject(new Error('offline'));
    const session = createMobileSession({
      supabaseUrl: ORIGIN,
      anonKey: 'anon',
      store,
      fetch: failing,
    });

    await expect(session.getAccessToken()).resolves.toBeNull();
  });

  it('reuses a live access token instead of refreshing on every call', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeTransport(okHandler());
    let clock = 1_000_000;
    const session = createMobileSession({
      supabaseUrl: ORIGIN,
      anonKey: 'anon',
      store,
      fetch,
      now: () => clock,
    });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');
    expect(await session.getAccessToken()).toBe('access-1');
    clock += 60_000;
    expect(await session.getAccessToken()).toBe('access-1');
    expect(calls).toHaveLength(1);
  });

  it('refreshes once the access token is close to expiring', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeTransport(okHandler());
    let clock = 1_000_000;
    const session = createMobileSession({
      supabaseUrl: ORIGIN,
      anonKey: 'anon',
      store,
      fetch,
      now: () => clock,
      refreshLeewayMs: 30_000,
    });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');
    // Past expiry minus the leeway, so the token must be refreshed.
    clock += 3_600_000;
    expect(await session.getAccessToken()).toBe('access-1');
    expect(calls).toHaveLength(2);
  });

  it('performs a single refresh when several callers ask at once', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeTransport(okHandler());
    let clock = 1_000_000;
    const session = createMobileSession({
      supabaseUrl: ORIGIN,
      anonKey: 'anon',
      store,
      fetch,
      now: () => clock,
    });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');
    clock += 3_600_000;

    const results = await Promise.all([
      session.getAccessToken(),
      session.getAccessToken(),
      session.getAccessToken(),
    ]);

    expect(results).toEqual(['access-1', 'access-1', 'access-1']);
    // One sign-in plus exactly one refresh, not one refresh per caller.
    expect(calls).toHaveLength(2);
  });

  it('clears the secure store on sign-out even when revocation fails', async () => {
    const store = memoryStore();
    let attempt = 0;
    const fetch: MobileFetch = (input) => {
      attempt += 1;
      // The sign-in succeeds; the logout call fails.
      if (urlOf(input).includes('logout')) return Promise.reject(new Error('network down'));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'access-1',
            refresh_token: 'refresh-2',
            expires_in: 3600,
            user: { id: 'user-1', email: 'member@hanaply.test' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');
    await session.signOut();

    expect(session.state().signedIn).toBe(false);
    expect(store.entries.has(MOBILE_REFRESH_TOKEN_KEY)).toBe(false);
    expect(attempt).toBe(2);
  });

  it('returns no token after sign-out', async () => {
    const store = memoryStore();
    const { fetch } = fakeTransport(okHandler());
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });

    await session.signIn('member@hanaply.test', 'CorrectHorse1');
    await session.signOut();

    expect(await session.getAccessToken()).toBeNull();
  });

  it('survives a secure store that throws on read', async () => {
    const failing: SecureStorePort = {
      getItem: () => Promise.reject(new Error('keystore unavailable')),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    };
    const { fetch } = fakeTransport(okHandler());
    const session = createMobileSession({
      supabaseUrl: ORIGIN,
      anonKey: 'anon',
      store: failing,
      fetch,
    });

    await expect(session.restore()).resolves.toMatchObject({ signedIn: false });
  });
});

describe('mobile deep links', () => {
  it('accepts an allowlisted route with a valid identifier', () => {
    const result = resolveDeepLink(`${ORIGIN}/dashboard/radar/${JOB_ID}`, ORIGIN);
    expect(result).toEqual({ accepted: true, name: 'opportunity', params: { jobId: JOB_ID } });
  });

  it('accepts a static allowlisted route', () => {
    expect(resolveDeepLink(`${ORIGIN}/dashboard/insights`, ORIGIN)).toEqual({
      accepted: true,
      name: 'insights',
      params: {},
    });
  });

  it('rejects a lookalike host', () => {
    expect(
      resolveDeepLink(`https://app.hanaply.test.evil.example/dashboard/radar`, ORIGIN),
    ).toEqual({
      accepted: false,
      reason: 'wrong_host',
    });
  });

  it('rejects a custom scheme', () => {
    expect(resolveDeepLink(`hanaply://dashboard/radar`, ORIGIN)).toEqual({
      accepted: false,
      reason: 'wrong_scheme',
    });
  });

  it('rejects a javascript URL', () => {
    expect(resolveDeepLink(`javascript:alert(1)`, ORIGIN).accepted).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(resolveDeepLink(`//evil.example/dashboard/radar`, ORIGIN)).toEqual({
      accepted: false,
      reason: 'wrong_scheme',
    });
  });

  it('rejects plain HTTP', () => {
    expect(resolveDeepLink(`http://app.hanaply.test/dashboard/radar`, ORIGIN)).toEqual({
      accepted: false,
      reason: 'wrong_scheme',
    });
  });

  it('rejects path traversal', () => {
    const result = resolveDeepLink(`${ORIGIN}/dashboard/radar/..%2f..%2fadmin`, ORIGIN);
    expect(result.accepted).toBe(false);
  });

  it('rejects an encoded control character', () => {
    expect(resolveDeepLink(`${ORIGIN}/dashboard/radar/%00`, ORIGIN).accepted).toBe(false);
  });

  it('rejects a route that is not on the allowlist', () => {
    expect(resolveDeepLink(`${ORIGIN}/admin/users`, ORIGIN)).toEqual({
      accepted: false,
      reason: 'unknown_route',
    });
  });

  it('rejects an identifier that is not a UUID', () => {
    expect(resolveDeepLink(`${ORIGIN}/dashboard/radar/not-a-uuid`, ORIGIN)).toEqual({
      accepted: false,
      reason: 'invalid_parameter',
    });
  });

  it('rejects a malformed URL', () => {
    expect(resolveDeepLink('not a url at all', ORIGIN)).toEqual({
      accepted: false,
      reason: 'malformed_url',
    });
  });

  it('ignores a query string rather than passing it through', () => {
    const result = resolveDeepLink(`${ORIGIN}/dashboard/radar/${JOB_ID}?token=stolen`, ORIGIN);
    expect(result).toEqual({ accepted: true, name: 'opportunity', params: { jobId: JOB_ID } });
    expect(JSON.stringify(result)).not.toContain('stolen');
  });

  it('round-trips every route through buildDeepLink and resolveDeepLink', () => {
    const cases: [Parameters<typeof buildDeepLink>[0], Record<string, string>][] = [
      ['radar', {}],
      ['savedJobs', {}],
      ['opportunity', { jobId: JOB_ID }],
      ['packs', {}],
      ['pack', { packId: JOB_ID }],
      ['tracker', {}],
      ['application', { applicationId: JOB_ID }],
      ['insights', {}],
      ['settings', {}],
      ['notifications', {}],
      ['subscription', {}],
    ];
    for (const [name, params] of cases) {
      const link = buildDeepLink(name, params, ORIGIN);
      const resolved = resolveDeepLink(link, ORIGIN);
      expect(resolved, `${name} must round-trip`).toEqual({ accepted: true, name, params });
    }
  });

  it('refuses to build a link with an invalid parameter', () => {
    expect(() => buildDeepLink('opportunity', { jobId: 'nope' }, ORIGIN)).toThrow(TypeError);
  });

  it('builds a link on the configured origin', () => {
    expect(buildDeepLink('insights', {}, ORIGIN)).toBe(`${ORIGIN}/dashboard/insights`);
  });
});

describe('mobile api client', () => {
  it('reuses the shared contract registry rather than a mobile-specific copy', async () => {
    const store = memoryStore();
    store.entries.set(MOBILE_REFRESH_TOKEN_KEY, 'refresh-1');
    const seen: string[] = [];
    const fetch: MobileFetch = (input, init) => {
      seen.push(`${init?.method ?? 'GET'} ${urlOf(input)}`);
      if (urlOf(input).includes('/auth/v1/token')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'access-1',
              refresh_token: 'refresh-2',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: INSIGHTS,
            meta: { apiVersion: 'v1', requestId: '00000000-0000-4000-8000-000000000000' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    };
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });
    await session.restore();

    const api = createMobileApi({ baseUrl: 'https://api.hanaply.test', session, fetch });
    const response = await api.careerInsights();

    expect(response.data.hasProfile).toBe(false);
    // The path comes from the registry, so it cannot drift from the server.
    expect(seen.some((entry) => entry.includes('/v1/me/career/insights'))).toBe(true);
  });

  it('sends the session access token as a bearer credential', async () => {
    const store = memoryStore();
    store.entries.set(MOBILE_REFRESH_TOKEN_KEY, 'refresh-1');
    let bearer: string | null = null;
    const fetch: MobileFetch = (input, init) => {
      if (urlOf(input).includes('/auth/v1/token')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'access-1',
              refresh_token: 'refresh-2',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      // The shared client sends headers as a Headers instance, so read them the
      // way a server would rather than assuming a plain object.
      bearer = new Headers(init?.headers).get('authorization');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: INSIGHTS,
            meta: { apiVersion: 'v1', requestId: '00000000-0000-4000-8000-000000000000' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const session = createMobileSession({ supabaseUrl: ORIGIN, anonKey: 'anon', store, fetch });
    await session.restore();
    const api = createMobileApi({ baseUrl: 'https://api.hanaply.test', session, fetch });

    await api.careerInsights();

    expect(bearer).toBe('Bearer access-1');
  });
});
