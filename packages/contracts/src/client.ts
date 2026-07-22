import type { z } from 'zod';

import { type ApiContractRoute, apiContract } from './api-contract.js';
import { type ApiErrorEnvelope, apiErrorEnvelopeSchema } from './errors.js';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  fetch?: FetchLike;
}

export class HanaplyApiError extends Error {
  readonly status: number;
  readonly envelope: ApiErrorEnvelope;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = 'HanaplyApiError';
    this.status = status;
    this.envelope = envelope;
  }
}

type ParsedRouteResponse<TRoute extends ApiContractRoute> = z.output<TRoute['response']>;

function addQuery(url: URL, query: Record<string, unknown> | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`Unsupported query value for ${key}`);
    }
    url.searchParams.set(key, String(value));
  }
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;

  async function request<TRoute extends ApiContractRoute>(
    route: TRoute,
    requestOptions: { query?: Record<string, unknown>; signal?: AbortSignal } = {},
  ): Promise<ParsedRouteResponse<TRoute>> {
    const url = new URL(route.path.replace(/^\//u, ''), baseUrl);
    addQuery(url, requestOptions.query);
    const token = await options.getAccessToken?.();
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetchImplementation(url, {
      method: route.method,
      headers,
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new HanaplyApiError(response.status, apiErrorEnvelopeSchema.parse(body));
    }
    return route.response.parse(body) as ParsedRouteResponse<TRoute>;
  }

  return Object.freeze({
    request,
    health: () => request(apiContract.health),
    ready: () => request(apiContract.ready),
    version: () => request(apiContract.version),
    meta: (query?: z.input<typeof apiContract.meta.query>) =>
      query ? request(apiContract.meta, { query: { ...query } }) : request(apiContract.meta),
    plans: () => request(apiContract.plans),
    me: () => request(apiContract.me),
    entitlements: () => request(apiContract.entitlements),
    adminMe: () => request(apiContract.adminMe),
  });
}

export type HanaplyApiClient = ReturnType<typeof createApiClient>;
