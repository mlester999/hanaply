import { z } from 'zod';

import {
  clampLimit,
  fetchJson,
  readConfigNumber,
  readConfigString,
  readConfigStringArray,
  requireCredentials,
} from '../http.js';
import { buildJobInput } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';
import { sourceIdFromValue } from './boards.js';

const ENDPOINT = 'https://api.adzuna.com/v1/api/jobs';
const CREDENTIAL_ENV_VARS = ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'] as const;
const COUNTRY_PATTERN = /^[a-z]{2}$/u;
const RESULTS_PER_PAGE = 50;
const MAX_PAGES = 10;

/**
 * Adzuna returns salary as an annualised model estimate in the local currency
 * of the searched market and never states the currency itself. The currency is
 * therefore only recorded when the market is one this table knows; otherwise
 * every salary field stays null.
 */
const MARKET_CURRENCIES: Readonly<Record<string, string>> = {
  at: 'EUR',
  au: 'AUD',
  be: 'EUR',
  br: 'BRL',
  ca: 'CAD',
  ch: 'CHF',
  de: 'EUR',
  es: 'EUR',
  fr: 'EUR',
  gb: 'GBP',
  ie: 'EUR',
  in: 'INR',
  it: 'EUR',
  mx: 'MXN',
  my: 'MYR',
  nl: 'EUR',
  nz: 'NZD',
  ph: 'PHP',
  pl: 'PLN',
  sg: 'SGD',
  us: 'USD',
  za: 'ZAR',
};

const adzunaJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    description: z.string().nullish(),
    redirect_url: z.string().nullish(),
    created: z.string().nullish(),
    contract_time: z.string().nullish(),
    contract_type: z.string().nullish(),
    salary_min: z.number().nullish(),
    salary_max: z.number().nullish(),
    company: z.object({ display_name: z.string().nullish() }).catchall(z.unknown()).nullish(),
    location: z
      .object({ display_name: z.string().nullish(), area: z.array(z.unknown()).nullish() })
      .catchall(z.unknown())
      .nullish(),
    category: z
      .object({ label: z.string().nullish(), tag: z.string().nullish() })
      .catchall(z.unknown())
      .nullish(),
  })
  .catchall(z.unknown());

const adzunaResponseSchema = z.object({ results: z.array(z.unknown()) }).catchall(z.unknown());

function readCountries(context: AdapterContext): string[] {
  const configured: string[] = [];
  for (const value of readConfigStringArray(context, 'countries')) {
    const country = value.trim().toLowerCase();
    if (COUNTRY_PATTERN.test(country) && !configured.includes(country)) configured.push(country);
  }
  return configured;
}

function marketSalary(
  country: string,
  min: number | null | undefined,
  max: number | null | undefined,
): {
  minMinor: number | null;
  maxMinor: number | null;
  currency: string | null;
  period: 'annual' | null;
  isEstimate: boolean;
} {
  const currency = MARKET_CURRENCIES[country] ?? null;
  const usable = currency !== null && (typeof min === 'number' || typeof max === 'number');
  if (!usable) {
    return { minMinor: null, maxMinor: null, currency: null, period: null, isEstimate: false };
  }
  return {
    minMinor: typeof min === 'number' ? Math.round(min * 100) : null,
    maxMinor: typeof max === 'number' ? Math.round(max * 100) : null,
    currency,
    period: 'annual',
    isEstimate: true,
  };
}

/**
 * Adzuna search API. Credentials are read from the context only; the app id
 * and key travel in the query string because that is the provider's contract,
 * which is exactly why no error from this adapter ever quotes a URL. The
 * markets to search come from `config.countries` and default to the product's
 * home market.
 */
export const adzunaAdapter: JobSourceAdapter = {
  code: 'adzuna',
  displayName: 'Adzuna',
  attribution: 'Adzuna Search API (adzuna.com). Attribution required on display.',
  requiresCredentials: true,
  credentialEnvVars: CREDENTIAL_ENV_VARS,

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const credentials = requireCredentials(
      { code: 'adzuna', credentialEnvVars: CREDENTIAL_ENV_VARS },
      context,
    );
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const countries = readCountries(context);
    const targets = countries.length > 0 ? countries : ['ph'];
    const what = readConfigString(context, 'what') ?? '';
    const where = readConfigString(context, 'where') ?? '';
    const startPage = Math.max(1, Math.trunc(readConfigNumber(context, 'page') ?? 1));
    const maxPages = Math.min(
      MAX_PAGES,
      Math.max(1, Math.trunc(readConfigNumber(context, 'maxPages') ?? 1)),
    );
    const perPage = Math.max(1, Math.min(limit, RESULTS_PER_PAGE));

    const postings: RawPosting[] = [];
    for (const country of targets) {
      for (let page = startPage; page < startPage + maxPages; page += 1) {
        if (postings.length >= limit) break;
        const url = new URL(`${ENDPOINT}/${country}/search/${String(page)}`);
        url.searchParams.set('app_id', credentials[CREDENTIAL_ENV_VARS[0]] ?? '');
        url.searchParams.set('app_key', credentials[CREDENTIAL_ENV_VARS[1]] ?? '');
        url.searchParams.set('results_per_page', String(perPage));
        url.searchParams.set('content-type', 'application/json');
        if (what !== '') url.searchParams.set('what', what);
        if (where !== '') url.searchParams.set('where', where);

        const payload = await fetchJson('adzuna', context, url.href);
        const parsed = adzunaResponseSchema.safeParse(payload);
        if (!parsed.success) continue;

        for (const item of parsed.data.results) {
          if (postings.length >= limit) break;
          const job = adzunaJobSchema.safeParse(item);
          if (!job.success) continue;
          const sourceJobId = sourceIdFromValue(job.data.id);
          if (sourceJobId === null) continue;
          postings.push({
            sourceJobId,
            sourceUrl: job.data.redirect_url ?? '',
            payload: { ...job.data, marketCountry: country },
          });
        }
      }
    }
    return postings;
  },

  normalize(raw: RawPosting, context: AdapterContext): NormalizedJobInput | null {
    const parsed = adzunaJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;
    const market = typeof job.marketCountry === 'string' ? job.marketCountry.toLowerCase() : null;
    const countryCode = market !== null && COUNTRY_PATTERN.test(market) ? market : null;

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: raw.sourceUrl,
      title: job.title ?? '',
      companyName: job.company?.display_name ?? '',
      description: job.description ?? '',
      employmentTypeText: [job.contract_time ?? '', job.contract_type ?? ''].join(' '),
      locationText: job.location?.display_name ?? null,
      countryCode,
      salary:
        countryCode === null ? null : marketSalary(countryCode, job.salary_min, job.salary_max),
      postedAt: toIsoTimestamp(job.created, context.now),
      rawPayload: job,
      now: context.now,
    });
  },
};
