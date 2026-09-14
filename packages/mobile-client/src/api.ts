import { createApiClient, type HanaplyApiClient } from '@hanaply/contracts';

import type { MobileFetch, MobileSession } from './session.js';

export interface MobileApiOptions {
  baseUrl: string;
  session: MobileSession;
  fetch: MobileFetch;
}

/**
 * The API client a mobile screen uses.
 *
 * It is the same `createApiClient` the web app uses, against the same contract
 * registry, with the session supplying the bearer token. That is the whole
 * design: entitlements, matching, truth gating, and every plan limit are decided
 * by the server, and the mobile client has no copy of any of those rules to
 * drift out of step.
 */
export function createMobileApi(options: MobileApiOptions): HanaplyApiClient {
  return createApiClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    getAccessToken: () => options.session.getAccessToken(),
  });
}
