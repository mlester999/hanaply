import { z } from 'zod';

import { clampLimit, fetchJson } from '../http.js';
import { buildJobInput, htmlToLines } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';
import {
  boardTokenFromPayload,
  firstNonEmptyString,
  readBoardTokens,
  sourceIdFromValue,
} from './boards.js';

const ENDPOINT = 'https://apply.workable.com/api/v1/widget/accounts';

const workableJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    shortcode: z.string().nullish(),
    code: z.string().nullish(),
    employment_type: z.string().nullish(),
    telecommuting: z.boolean().nullish(),
    department: z.string().nullish(),
    url: z.string().nullish(),
    shortlink: z.string().nullish(),
    application_url: z.string().nullish(),
    location: z
      .object({
        country: z.string().nullish(),
        country_code: z.string().nullish(),
        city: z.string().nullish(),
        region: z.string().nullish(),
      })
      .catchall(z.unknown())
      .nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    description: z.string().nullish(),
    requirements: z.string().nullish(),
    benefits: z.string().nullish(),
  })
  .catchall(z.unknown());

const workableResponseSchema = z
  .object({ name: z.string().nullish(), jobs: z.array(z.unknown()) })
  .catchall(z.unknown());

/**
 * Workable job widgets. This endpoint does publish the account name, so the
 * employer is provider data here; the `location` object carries a real
 * ISO 3166-1 country code, which is more reliable than anything parsed out of
 * the location text.
 */
export const workableAdapter: JobSourceAdapter = {
  code: 'workable',
  displayName: 'Workable Job Widgets',
  attribution: 'Public Workable account widget API (apply.workable.com).',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const postings: RawPosting[] = [];
    for (const token of readBoardTokens(context)) {
      if (postings.length >= limit) break;
      try {
        const url = `${ENDPOINT}/${encodeURIComponent(token)}?details=true`;
        const payload = await fetchJson('workable', context, url);
        const parsed = workableResponseSchema.safeParse(payload);
        if (!parsed.success) continue;
        const accountName = firstNonEmptyString(parsed.data.name);

        for (const item of parsed.data.jobs) {
          if (postings.length >= limit) break;
          const job = workableJobSchema.safeParse(item);
          if (!job.success) continue;
          const sourceJobId = sourceIdFromValue(job.data.shortcode ?? job.data.id);
          if (sourceJobId === null) continue;
          postings.push({
            sourceJobId,
            sourceUrl: firstNonEmptyString(job.data.url, job.data.shortlink) ?? '',
            payload: { ...job.data, boardToken: token, companyName: accountName },
          });
        }
      } catch {
        // Isolated per board, as with every board adapter.
        continue;
      }
    }
    return postings;
  },

  normalize(raw: RawPosting): NormalizedJobInput | null {
    const parsed = workableJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;
    const token = boardTokenFromPayload(job);
    const companyName = firstNonEmptyString(job.companyName, token);
    const locationText = firstNonEmptyString(
      [job.location?.city, job.location?.region, job.location?.country]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .join(', '),
      job.location?.country,
    );
    const html = [job.description ?? '', job.requirements ?? '', job.benefits ?? '']
      .filter((part) => part.trim() !== '')
      .join('\n');

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: job.application_url ?? raw.sourceUrl,
      title: job.title ?? '',
      companyName: companyName ?? '',
      description: html,
      bulletText: htmlToLines(html).join('\n'),
      employmentTypeText: job.employment_type ?? null,
      remoteState: job.telecommuting === true ? 'remote' : null,
      remoteStateText: [job.title ?? '', locationText ?? ''].join(' '),
      locationText,
      city: job.location?.city ?? null,
      region: job.location?.region ?? null,
      countryCode: job.location?.country_code ?? null,
      postedAt: toIsoTimestamp(job.created_at),
      rawPayload: job,
    });
  },
};
