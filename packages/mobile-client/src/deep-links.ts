import { z } from 'zod';

/**
 * Deep-link routing for the mobile client.
 *
 * A deep link is attacker-influenced input: anyone can craft a URL and ask the
 * operating system to open the app with it. So this module is an allowlist, not
 * a parser that tries to be helpful. Anything not explicitly recognised is
 * rejected with a reason, and the caller routes to a safe authenticated home
 * instead.
 *
 * Deliberate restrictions:
 *
 *   - Only the configured HTTPS host is accepted. A lookalike host, a custom
 *     scheme, `javascript:`, and a protocol-relative URL are all rejected.
 *   - Path segments are matched exactly against a table. No prefix matching, no
 *     wildcards, and no traversal: `..` and `.` are rejected before matching.
 *   - Identifiers must be UUIDs. A link cannot smuggle an arbitrary string into
 *     a query that the API will later receive.
 *   - Percent-encoded control characters and separators are rejected rather than
 *     decoded and matched, because decoding first is how a traversal check gets
 *     bypassed.
 *   - No route carries a token, a document URL, or any credential. Those arrive
 *     through the session, never through a link.
 */

export const mobileRoutes = {
  radar: { path: '/dashboard/radar', params: z.object({}) },
  savedJobs: { path: '/dashboard/radar/saved', params: z.object({}) },
  opportunity: {
    path: '/dashboard/radar/:jobId',
    params: z.object({ jobId: z.uuid() }),
  },
  packs: { path: '/dashboard/packs', params: z.object({}) },
  pack: { path: '/dashboard/packs/:packId', params: z.object({ packId: z.uuid() }) },
  tracker: { path: '/dashboard/applications', params: z.object({}) },
  application: {
    path: '/dashboard/applications/:applicationId',
    params: z.object({ applicationId: z.uuid() }),
  },
  insights: { path: '/dashboard/insights', params: z.object({}) },
  settings: { path: '/dashboard/settings', params: z.object({}) },
  notifications: { path: '/dashboard/settings/notifications', params: z.object({}) },
  subscription: { path: '/dashboard/activation', params: z.object({}) },
} as const;

export type MobileRouteName = keyof typeof mobileRoutes;

export type DeepLinkResult =
  | { accepted: true; name: MobileRouteName; params: Record<string, string> }
  | { accepted: false; reason: DeepLinkRejection };

export type DeepLinkRejection =
  | 'malformed_url'
  | 'wrong_scheme'
  | 'wrong_host'
  | 'unsafe_path'
  | 'unknown_route'
  | 'invalid_parameter';

/**
 * Control characters, backslashes, and encoded separators are never legitimate
 * in a path. The control-character range is the reason this lint rule is
 * disabled: rejecting those characters is the entire point of the expression.
 */
// eslint-disable-next-line no-control-regex -- intentional: control characters must be rejected
const UNSAFE_PATH = /[\u0000-\u001f\u007f\\]|%2e|%2f|%5c|%00/iu;

function matchesRoute(routePath: string, segments: string[]): Record<string, string> | null {
  const routeSegments = routePath.split('/').filter((segment) => segment.length > 0);
  if (routeSegments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, routeSegment] of routeSegments.entries()) {
    const actual = segments[index];
    if (actual === undefined) return null;
    if (routeSegment.startsWith(':')) {
      params[routeSegment.slice(1)] = actual;
    } else if (routeSegment !== actual) {
      return null;
    }
  }
  return params;
}

export function resolveDeepLink(rawUrl: string, expectedOrigin: string): DeepLinkResult {
  let expected: URL;
  try {
    expected = new URL(expectedOrigin);
  } catch {
    return { accepted: false, reason: 'malformed_url' };
  }

  // A protocol-relative link has no scheme of its own and would inherit one.
  if (rawUrl.startsWith('//')) {
    return { accepted: false, reason: 'wrong_scheme' };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { accepted: false, reason: 'malformed_url' };
  }

  if (url.protocol !== 'https:') {
    return { accepted: false, reason: 'wrong_scheme' };
  }
  if (url.host !== expected.host) {
    return { accepted: false, reason: 'wrong_host' };
  }
  if (UNSAFE_PATH.test(url.pathname)) {
    return { accepted: false, reason: 'unsafe_path' };
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { accepted: false, reason: 'unsafe_path' };
  }

  for (const [name, route] of Object.entries(mobileRoutes) as [
    MobileRouteName,
    (typeof mobileRoutes)[MobileRouteName],
  ][]) {
    const params = matchesRoute(route.path, segments);
    if (params === null) continue;
    const parsed = route.params.safeParse(params);
    if (!parsed.success) {
      return { accepted: false, reason: 'invalid_parameter' };
    }
    return { accepted: true, name, params: parsed.data };
  }

  return { accepted: false, reason: 'unknown_route' };
}

/**
 * Builds a link for a route. Used for share sheets and for the auth callback, so
 * the two directions cannot drift apart.
 */
export function buildDeepLink(
  name: MobileRouteName,
  params: Record<string, string>,
  origin: string,
): string {
  const route = mobileRoutes[name];
  const parsed = route.params.safeParse(params);
  if (!parsed.success) {
    throw new TypeError(`Invalid parameters for the ${name} route`);
  }
  const path = Object.entries(parsed.data as Record<string, string>).reduce<string>(
    (result, [key, value]) => result.replace(`:${key}`, encodeURIComponent(value)),
    route.path,
  );
  return new URL(path, origin).toString();
}
