import type { ApiEnvironment } from '@hanaply/config';
import { Inject, Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerStorageService,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from './app-error.js';
import { SupabaseAuthService } from './auth.js';
import type { AuthenticatedRequest } from './http.js';
import { API_ENVIRONMENT } from './tokens.js';

/**
 * Scoped rate limiting.
 *
 * ## Why the scope is the whole point
 *
 * `@nestjs/throttler`'s default tracker is `request.ip`. Hanaply's web
 * application calls the API server-to-server with the member's access token, so
 * every member arrived from one address and shared one bucket: one member's
 * burst answered 429 to unrelated members. A limit a stranger can spend is not a
 * limit, and raising the number is not a fix — it only moves the point at which
 * the shared bucket collapses.
 *
 * The scope is therefore chosen per route from what the request can prove:
 *
 *   - `authenticated` — the default for a route that requires a session. The
 *     bucket is the user id from the *verified* session (`SupabaseAuthService`
 *     checks the token, the session's liveness, and the account's status), so one
 *     member's traffic cannot consume another member's allowance. A caller who
 *     presents no usable session falls back to the `anonymous` budget: an
 *     unproven caller is an anonymous caller.
 *   - `anonymous` — a route that is public by design (`PublicController`). The
 *     client address is the correct scope there: there is no identity to key on,
 *     and the address is what an unauthenticated abuser has to spend.
 *   - `sensitive` — an authentication surface that accepts a submitted
 *     identifier (an email address or a phone number). It is keyed by the address
 *     *and* by the identifier, so one account cannot be sprayed from many
 *     addresses and many accounts cannot be sprayed from one address. This API
 *     terminates no such route today: credential entry, verification resend,
 *     password recovery, and token refresh are Supabase Auth operations the web
 *     server performs directly, and `apps/web/src/lib/rate-limit.ts` already
 *     applies this address-plus-subject policy through
 *     `consume_auth_rate_limit`. The scope is implemented and configured here so
 *     that an authentication route added to this API inherits the policy by
 *     declaring it, rather than by rediscovering the defect.
 *   - `expensive` — a route whose work is a model call or another synchronous
 *     expensive operation. It is keyed by the member, and it carries a second,
 *     independent ceiling from `RATE_LIMIT_EXPENSIVE_*` that no route decorator
 *     can loosen.
 *
 * ## Route decorators are preserved
 *
 * An existing `@Throttle({ default: { limit, ttl } })` still decides that route's
 * limit and window; it is read by the library exactly as before. What changes is
 * the key: the same decorator now counts against a member rather than against
 * whichever address the web server happened to use.
 *
 * ## The store
 *
 * `ThrottlerStorage` is the plug point, and `createThrottlerStorage` is where a
 * distributed adapter is selected. This deployment runs `ThrottlerStorageService`,
 * an in-process map, which is the supported mode for local development and tests.
 * It is **per process**: with two API instances each keeps its own buckets, so a
 * member's effective allowance is the configured limit multiplied by the number
 * of instances, and a limit reached on one instance is invisible to the others.
 * That is why `@hanaply/config` refuses to parse a production environment while
 * `RATE_LIMIT_STORE=memory`: a shared counter must be selected here and in the
 * environment before a multi-instance production deployment is correct. See
 * `tests/integration/rate-limit.test.ts`, which states both behaviours.
 *
 * ## What a caller sees
 *
 * A refused request is a 429 that `ApiExceptionFilter` renders as the standard
 * `RATE_LIMITED` envelope, with `Retry-After` in seconds; the window resets as
 * configured. No token and no raw identifier is logged or stored: the tracker
 * string below is hashed by the library's key generator before it reaches the
 * store, and this module logs nothing at all.
 */

export const rateLimitScopeNames = [
  'authenticated',
  'anonymous',
  'sensitive',
  'expensive',
] as const;

export type RateLimitScope = (typeof rateLimitScopeNames)[number];

const RATE_LIMIT_SCOPE = 'hanaply.rate_limit_scope';

/** Declares the scope of a route or of every route on a controller. */
export const RateLimitScope = (scope: RateLimitScope) => SetMetadata(RATE_LIMIT_SCOPE, scope);

export interface RateLimitPolicy {
  readonly limit: number;
  readonly ttl: number;
}

/**
 * Routes whose work is a model call, a document parse, or another synchronous
 * expensive operation.
 *
 * They are named here, by method and by Fastify's route pattern, so that adding
 * an expensive route is a change a reviewer sees in the limiter rather than a
 * detail of a controller. A route that also carries its own `@Throttle` keeps
 * that tighter value; the ceiling is a second, independent bucket.
 */
const expensiveRoutes: readonly { readonly method: string; readonly url: string }[] = Object.freeze(
  [
    { method: 'POST', url: '/v1/me/opportunities/:jobId/analysis' },
    { method: 'POST', url: '/v1/me/coach/conversations' },
    { method: 'POST', url: '/v1/me/coach/conversations/:conversationId/messages' },
    { method: 'POST', url: '/v1/me/application-packs/:packId/generate' },
    { method: 'GET', url: '/v1/me/career/documents/:documentId/extraction' },
    { method: 'POST', url: '/v1/admin/job-sources/:sourceId/scan' },
  ],
);

function routePattern(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split('?')[0] ?? request.url;
}

export function isExpensiveRequest(request: FastifyRequest): boolean {
  const pattern = routePattern(request);
  return expensiveRoutes.some((route) => route.method === request.method && route.url === pattern);
}

/**
 * The scope of a request.
 *
 * An explicit declaration wins; an expensive route is classified by the table
 * above; everything else is authenticated, which means "key on the session when
 * there is one, and on the address when there is not".
 */
export function rateLimitScopeFor(context: ExecutionContext, reflector: Reflector): RateLimitScope {
  const declared = reflector.getAllAndOverride<RateLimitScope>(RATE_LIMIT_SCOPE, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (declared) return declared;
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return isExpensiveRequest(request) ? 'expensive' : 'authenticated';
}

/** The configured ceiling and window for a scope. */
export function rateLimitPolicy(
  environment: ApiEnvironment,
  scope: RateLimitScope,
): RateLimitPolicy {
  if (scope === 'anonymous') {
    return {
      limit: environment.RATE_LIMIT_ANONYMOUS_LIMIT,
      ttl: environment.RATE_LIMIT_ANONYMOUS_TTL_MS,
    };
  }
  if (scope === 'sensitive') {
    return {
      limit: environment.RATE_LIMIT_SENSITIVE_LIMIT,
      ttl: environment.RATE_LIMIT_SENSITIVE_TTL_MS,
    };
  }
  if (scope === 'expensive') {
    return {
      limit: environment.RATE_LIMIT_EXPENSIVE_LIMIT,
      ttl: environment.RATE_LIMIT_EXPENSIVE_TTL_MS,
    };
  }
  return {
    limit: environment.RATE_LIMIT_AUTHENTICATED_LIMIT,
    ttl: environment.RATE_LIMIT_AUTHENTICATED_TTL_MS,
  };
}

/**
 * Whether a bearer token is worth verifying.
 *
 * A Supabase access token is a JWT: three base64url segments. A header that is
 * not even shaped like one is treated as absent, so a flood of garbage cannot
 * make the API call the Auth server once per request; the request is then limited
 * by address like any other anonymous caller, and the authentication guard still
 * refuses it.
 */
export function isAccessTokenShaped(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token);
}

/** The bearer token on a request, or `undefined` when the header is absent or malformed. */
function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token || token.includes(' ')) return undefined;
  return isAccessTokenShaped(token) ? token : undefined;
}

/**
 * The submitted identifier on an authentication request, when one is present.
 *
 * The body is read first (a submitted address) and the query second. It is never
 * logged, and `rateLimitTracker` hashes it before it reaches the store.
 */
export function submittedIdentifier(request: FastifyRequest): string | undefined {
  const normalise = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim()
      ? value.normalize('NFKC').trim().toLowerCase()
      : undefined;
  const body: unknown = request.body;
  if (body && typeof body === 'object') {
    for (const key of ['email', 'identifier', 'phone'] as const) {
      const found = normalise((body as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  const query: unknown = request.query;
  if (query && typeof query === 'object') {
    return normalise((query as Record<string, unknown>).email);
  }
  return undefined;
}

/**
 * The bucket key for a request.
 *
 * Each route already owns a bucket — the library prefixes the key with the
 * controller, the handler, and the throttler name — so this string only has to
 * separate one *caller* from another within a route.
 */
export function rateLimitTracker(input: {
  readonly scope: RateLimitScope;
  readonly address: string;
  readonly userId?: string;
  readonly identifier?: string;
}): string {
  if (input.scope === 'sensitive') {
    const identifier = input.identifier
      ? createHash('sha256').update(input.identifier).digest('hex').slice(0, 32)
      : 'none';
    return `identifier:${input.address}:${identifier}`;
  }
  return input.userId ? `user:${input.userId}` : `address:${input.address}`;
}

/**
 * The store for this deployment.
 *
 * The seam. A distributed adapter — a shared counter in Postgres, Redis, or the
 * deployment's own store — is added as a case here and named in
 * `RATE_LIMIT_STORE`, which `@hanaply/config` validates and which production
 * refuses to leave on `memory`. Until then, `memory` is the only accepted value
 * and the in-process store below is what every deployment that starts gets.
 */
export function createThrottlerStorage(environment: ApiEnvironment): ThrottlerStorage {
  switch (environment.RATE_LIMIT_STORE) {
    case 'memory':
      return new ThrottlerStorageService();
  }
}

/**
 * The module-level limit and window registered for the `default` throttler.
 *
 * The library resolves a route's `@Throttle` decorator before the module
 * default, and `ScopedThrottlerGuard` cannot tell the two apart from the number
 * alone. Registering this sentinel makes the distinction explicit: it means "this
 * route declared nothing of its own", and the guard replaces it with the scope's
 * configured policy. A finite value is always a route's own declaration and is
 * left alone.
 */
export const routeDeclaredNothing = Number.POSITIVE_INFINITY;

interface ResolvedRateLimit {
  readonly tracker: string;
  readonly policy: RateLimitPolicy;
}

@Injectable()
export class ScopedThrottlerGuard extends ThrottlerGuard {
  private readonly resolved = new WeakMap<FastifyRequest, Promise<ResolvedRateLimit>>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(SupabaseAuthService) private readonly authService: SupabaseAuthService,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * The library asks for the tracker once per named throttler. Resolution is
   * memoised per request, so the session is verified at most once and the default
   * and expensive throttlers cannot disagree about who is calling.
   */
  protected override async getTracker(request: FastifyRequest): Promise<string> {
    return (await this.resolve(request)).tracker;
  }

  /**
   * The route's own decorator wins where it exists; otherwise the scope's
   * configured policy applies, and the expensive ceiling is what the second
   * throttler enforces.
   */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const request = requestProps.context.switchToHttp().getRequest<FastifyRequest>();
    const { policy } = await this.resolve(request, requestProps.context);
    const limit = Number.isFinite(requestProps.limit) ? requestProps.limit : policy.limit;
    const ttl = Number.isFinite(requestProps.ttl) ? requestProps.ttl : policy.ttl;
    const blockDuration = Number.isFinite(requestProps.blockDuration)
      ? requestProps.blockDuration
      : ttl;

    try {
      return await super.handleRequest({ ...requestProps, limit, ttl, blockDuration });
    } catch (error) {
      /**
       * A named throttler sets `Retry-After-<name>`; the API's contract is the
       * plain header on every refused request, so it is added when the library's
       * own header carries a name. The default throttler's exact value is left
       * alone.
       */
      if (error instanceof ThrottlerException) {
        const reply = requestProps.context.switchToHttp().getResponse<FastifyReply>();
        if (!reply.hasHeader('Retry-After')) {
          reply.header('Retry-After', Math.max(1, Math.ceil(ttl / 1_000)));
        }
      }
      throw error;
    }
  }

  private resolve(request: FastifyRequest, context?: ExecutionContext): Promise<ResolvedRateLimit> {
    const cached = this.resolved.get(request);
    if (cached) return cached;
    const pending = this.resolveUncached(request, context);
    this.resolved.set(request, pending);
    return pending;
  }

  private async resolveUncached(
    request: FastifyRequest,
    context?: ExecutionContext,
  ): Promise<ResolvedRateLimit> {
    const scope = context ? rateLimitScopeFor(context, this.reflector) : 'authenticated';
    const address = request.ip;

    if (scope === 'sensitive') {
      const identifier = submittedIdentifier(request);
      return {
        tracker: rateLimitTracker({ scope, address, ...(identifier ? { identifier } : {}) }),
        policy: rateLimitPolicy(this.environment, scope),
      };
    }
    if (scope === 'anonymous') {
      return {
        tracker: rateLimitTracker({ scope, address }),
        policy: rateLimitPolicy(this.environment, scope),
      };
    }

    const token = bearerToken(request);
    const authenticated = request as AuthenticatedRequest;
    if (token) {
      try {
        await this.authService.authenticate(authenticated);
      } catch (error) {
        /**
         * An unproven session is an anonymous caller: the same route, keyed by
         * address, on the anonymous budget. Nothing here decides access — the
         * authentication guard still refuses the request with its own 401 — and a
         * genuine infrastructure failure is not swallowed.
         */
        if (!(error instanceof AppError)) throw error;
      }
    }
    const userId = authenticated.auth?.userId;
    return {
      tracker: rateLimitTracker({ scope, address, ...(userId ? { userId } : {}) }),
      policy: rateLimitPolicy(this.environment, userId ? scope : 'anonymous'),
    };
  }
}
