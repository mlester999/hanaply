import { z } from 'zod';

import { JobSourceRequestError } from '../errors.js';
import {
  clampLimit,
  fetchJson,
  readConfigNumber,
  readConfigString,
  requireCredentials,
} from '../http.js';
import { buildJobInput } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';
import { sourceIdFromValue } from './boards.js';

const ENDPOINT = 'https://jooble.org/api';
const CREDENTIAL_ENV_VARS = ['JOOBLE_API_KEY'] as const;
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

const joobleJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    location: z.string().nullish(),
    snippet: z.string().nullish(),
    description: z.string().nullish(),
    salary: z.string().nullish(),
    source: z.string().nullish(),
    type: z.string().nullish(),
    link: z.string().nullish(),
    company: z.string().nullish(),
    updated: z.string().nullish(),
  })
  .catchall(z.unknown());

const joobleResponseSchema = z.object({ jobs: z.array(z.unknown()) }).catchall(z.unknown());

/**
 * Jooble partner API. The key is part of the request path, so it is validated
 * as an API-key-shaped token before it is encoded into a URL, and the error
 * surfaced when a request fails carries only the HTTP status.
 *
 * Jooble returns a page of results per call and offers no page-size parameter,
 * so `limit` trims what comes back.
 */
export const joobleAdapter: JobSourceAdapter = {
  code: 'jooble',
  displayName: 'Jooble',
  attribution: 'Jooble partner API (jooble.org). Attribution required on display.',
  requiresCredentials: true,
  credentialEnvVars: CREDENTIAL_ENV_VARS,

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const credentials = requireCredentials(
      { code: 'jooble', credentialEnvVars: CREDENTIAL_ENV_VARS },
      context,
    );
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const apiKey = credentials[CREDENTIAL_ENV_VARS[0]] ?? '';
    if (!API_KEY_PATTERN.test(apiKey)) {
      throw new JobSourceRequestError(
        'invalid_credential',
        'jooble credential is not a usable API key',
      );
    }

    const keywords = readConfigString(context, 'keywords') ?? '';
    const location = readConfigString(context, 'location') ?? '';
    const page = Math.max(1, Math.trunc(readConfigNumber(context, 'page') ?? 1));
    const url = `${ENDPOINT}/${encodeURIComponent(apiKey)}`;
    const payload = await fetchJson('jooble', context, url, {
      method: 'POST',
      body: JSON.stringify({ keywords, location, page }),
      headers: { 'content-type': 'application/json' },
    });
    const parsed = joobleResponseSchema.safeParse(payload);
    if (!parsed.success) return [];

    const postings: RawPosting[] = [];
    for (const item of parsed.data.jobs) {
      if (postings.length >= limit) break;
      const job = joobleJobSchema.safeParse(item);
      if (!job.success) continue;
      const sourceJobId = sourceIdFromValue(job.data.id);
      if (sourceJobId === null) continue;
      postings.push({
        sourceJobId,
        sourceUrl: job.data.link ?? '',
        payload: job.data,
      });
    }
    return postings;
  },

  normalize(raw: RawPosting): NormalizedJobInput | null {
    const parsed = joobleJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: raw.sourceUrl,
      title: job.title ?? '',
      companyName: job.company ?? '',
      description: job.description ?? job.snippet ?? '',
      employmentTypeText: job.type ?? null,
      locationText: job.location ?? null,
      salaryText: job.salary ?? null,
      postedAt: toIsoTimestamp(job.updated),
      rawPayload: job,
    });
  },
};
