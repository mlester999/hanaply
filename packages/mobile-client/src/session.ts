import type { FetchLike } from '@hanaply/contracts';
import { z } from 'zod';

/**
 * Mobile session management.
 *
 * The whole point of this module is that refresh material and access tokens are
 * handled differently, on purpose:
 *
 *   - The **refresh token** is the only thing written to persistent storage, and
 *     it goes through a port the caller implements. On iOS that is the Keychain,
 *     on Android it is Keystore-backed storage. Nothing in this package decides
 *     where it lands, and nothing in this package writes an access token there.
 *   - The **access token** lives in memory only. It is never persisted, never
 *     logged, and never put in a URL.
 *   - A password is passed straight to the caller-supplied transport and is not
 *     retained on the session object at all.
 *
 * The module is deliberately free of React Native imports so it can be unit
 * tested without a device, and so the transport and the storage are both
 * injectable.
 */

export const MOBILE_REFRESH_TOKEN_KEY = 'hanaply.mobile.refresh_token';

/**
 * The transport this package needs.
 *
 * A React Native caller passes `fetch`. It is the shared client's `FetchLike`
 * rather than a narrower alias, so the two cannot drift: the API client builds a
 * `URL` while the session builds a string, and both must be acceptable.
 */
export type MobileFetch = FetchLike;

/**
 * Persistent storage for the refresh token.
 *
 * Implementations must be backed by the platform secure store. The interface is
 * intentionally tiny so that an implementation cannot accidentally become a
 * general-purpose key-value cache for sensitive data.
 */
export interface SecureStorePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface MobileSessionOptions {
  /** The Supabase project URL. */
  supabaseUrl: string;
  /** The publishable anon key. Never the service role key. */
  anonKey: string;
  /** Secure storage for the refresh token. */
  store: SecureStorePort;
  /** The platform fetch implementation. */
  fetch: MobileFetch;
  /**
   * Refreshes this many milliseconds before the access token expires, so a
   * request never races an expiry.
   */
  refreshLeewayMs?: number;
  /** Injectable clock, so expiry behaviour is testable without waiting. */
  now?: () => number;
}

export interface MobileSessionState {
  userId: string | null;
  email: string | null;
  /**
   * True when a refresh token is held. The access token is deliberately not
   * exposed: callers ask for one through `getAccessToken`, which is the only
   * place that can guarantee it is fresh.
   */
  signedIn: boolean;
}

export class MobileSessionError extends Error {
  readonly code:
    'invalid_credentials' | 'not_configured' | 'refresh_failed' | 'transport_failed' | 'no_session';

  constructor(code: MobileSessionError['code'], message: string) {
    super(message);
    this.name = 'MobileSessionError';
    this.code = code;
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  user: z
    .object({
      id: z.string().min(1),
      email: z.string().nullable().optional(),
    })
    .optional(),
});

type TokenResponse = z.infer<typeof tokenResponseSchema>;

export interface MobileSession {
  signIn(email: string, password: string): Promise<MobileSessionState>;
  /**
   * Restores a session from secure storage. Returns the signed-out state rather
   * than throwing when there is nothing to restore, because a first launch is
   * not an error.
   */
  restore(): Promise<MobileSessionState>;
  /** Returns a usable access token, refreshing when it is at or near expiry. */
  getAccessToken(): Promise<string | null>;
  /** Revokes the session server-side and clears secure storage. */
  signOut(): Promise<void>;
  state(): MobileSessionState;
}

export function createMobileSession(options: MobileSessionOptions): MobileSession {
  const leeway = options.refreshLeewayMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  const base = options.supabaseUrl.replace(/\/+$/u, '');

  let accessToken: string | null = null;
  let accessTokenExpiresAt = 0;
  let refreshToken: string | null = null;
  let current: MobileSessionState = { userId: null, email: null, signedIn: false };
  // A single in-flight refresh, so concurrent callers cannot each spend the
  // refresh token and invalidate one another.
  let inFlightRefresh: Promise<string | null> | null = null;

  function applyTokenResponse(payload: TokenResponse): void {
    accessToken = payload.access_token;
    accessTokenExpiresAt = now() + (payload.expires_in ?? 3600) * 1000;
    if (payload.refresh_token !== undefined) {
      refreshToken = payload.refresh_token;
      void options.store.setItem(MOBILE_REFRESH_TOKEN_KEY, payload.refresh_token);
    }
    current = {
      userId: payload.user?.id ?? current.userId,
      email: payload.user?.email ?? current.email,
      signedIn: true,
    };
  }

  async function post(path: string, body: unknown): Promise<Response> {
    try {
      return await options.fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: options.anonKey,
          authorization: `Bearer ${options.anonKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // The transport error is not surfaced verbatim: it can carry a URL with
      // the project reference, and it is not useful to the caller anyway.
      throw new MobileSessionError('transport_failed', 'The sign-in service could not be reached');
    }
  }

  async function exchange(body: unknown, path: string): Promise<TokenResponse> {
    const response = await post(path, body);
    if (!response.ok) {
      throw new MobileSessionError(
        'invalid_credentials',
        'That email and password combination was not accepted',
      );
    }
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new MobileSessionError(
        'not_configured',
        'The sign-in service returned an unexpected response',
      );
    }
    return parsed.data;
  }

  return {
    state() {
      return { ...current };
    },

    async signIn(email, password) {
      const payload = await exchange({ email, password }, '/auth/v1/token?grant_type=password');
      applyTokenResponse(payload);
      return { ...current };
    },

    async restore() {
      let stored: string | null = null;
      try {
        stored = await options.store.getItem(MOBILE_REFRESH_TOKEN_KEY);
      } catch {
        stored = null;
      }
      if (stored === null || stored.length === 0) {
        return { ...current };
      }
      refreshToken = stored;
      try {
        const payload = await exchange(
          { refresh_token: stored },
          '/auth/v1/token?grant_type=refresh_token',
        );
        applyTokenResponse(payload);
      } catch {
        // A rejected refresh token is removed rather than retried: keeping it
        // would repeat the same failure on every launch.
        refreshToken = null;
        await options.store.removeItem(MOBILE_REFRESH_TOKEN_KEY).catch(() => undefined);
      }
      return { ...current };
    },

    async getAccessToken() {
      if (refreshToken === null) return null;
      if (accessToken !== null && now() < accessTokenExpiresAt - leeway) {
        return accessToken;
      }
      inFlightRefresh ??= (async () => {
        try {
          const payload = await exchange(
            { refresh_token: refreshToken },
            '/auth/v1/token?grant_type=refresh_token',
          );
          applyTokenResponse(payload);
          return accessToken;
        } catch {
          accessToken = null;
          current = { ...current, signedIn: false };
          return null;
        } finally {
          inFlightRefresh = null;
        }
      })();
      return inFlightRefresh;
    },

    async signOut() {
      const token = accessToken;
      accessToken = null;
      accessTokenExpiresAt = 0;
      refreshToken = null;
      current = { userId: null, email: null, signedIn: false };
      await options.store.removeItem(MOBILE_REFRESH_TOKEN_KEY).catch(() => undefined);
      if (token !== null) {
        // Best effort: a failed revocation must not leave the device signed in
        // locally, which the state reset above already prevents.
        await options
          .fetch(`${base}/auth/v1/logout`, {
            method: 'POST',
            headers: { apikey: options.anonKey, authorization: `Bearer ${token}` },
          })
          .catch(() => undefined);
      }
    },
  };
}
