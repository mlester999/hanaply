import { z } from 'zod';

import { clampLimit, fetchJson } from '../http.js';
import { buildJobInput, htmlToLines, stripHtml } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';
import { boardTokenFromPayload, readBoardTokens, sourceIdFromValue } from './boards.js';

const ENDPOINT = 'https://api.ashbyhq.com/posting-api/job-board';

const ashbyJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    location: z.string().nullish(),
    secondaryLocations: z.array(z.unknown()).nullish(),
    department: z.string().nullish(),
    team: z.string().nullish(),
    employmentType: z.string().nullish(),
    isListed: z.boolean().nullish(),
    isRemote: z.boolean().nullish(),
    descriptionHtml: z.string().nullish(),
    descriptionPlain: z.string().nullish(),
    publishedAt: z.string().nullish(),
    jobUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    address: z
      .object({
        postalAddress: z
          .object({ addressCountry: z.string().nullish() })
          .catchall(z.unknown())
          .nullish(),
      })
      .catchall(z.unknown())
      .nullish(),
  })
  .catchall(z.unknown());

const ashbyResponseSchema = z.object({ jobs: z.array(z.unknown()) }).catchall(z.unknown());

/**
 * Ashby job boards. `isRemote` and `employmentType` are structured fields, so
 * they are used directly; `publishedAt` is a real publication date and becomes
 * `postedAt`. As with Lever, the board token names the employer because the
 * payload does not.
 */
export const ashbyAdapter: JobSourceAdapter = {
  code: 'ashby',
  displayName: 'Ashby Job Boards',
  attribution: 'Public Ashby job posting API (api.ashbyhq.com).',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const postings: RawPosting[] = [];
    for (const token of readBoardTokens(context)) {
      if (postings.length >= limit) break;
      try {
        const url = `${ENDPOINT}/${encodeURIComponent(token)}`;
        const payload = await fetchJson('ashby', context, url);
        const parsed = ashbyResponseSchema.safeParse(payload);
        if (!parsed.success) continue;

        for (const item of parsed.data.jobs) {
          if (postings.length >= limit) break;
          const job = ashbyJobSchema.safeParse(item);
          if (!job.success) continue;
          const sourceJobId = sourceIdFromValue(job.data.id);
          if (sourceJobId === null) continue;
          postings.push({
            sourceJobId,
            sourceUrl: job.data.jobUrl ?? '',
            payload: { ...job.data, boardToken: token },
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
    const parsed = ashbyJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;
    const token = boardTokenFromPayload(job);
    const locationText = job.location ?? null;
    const html = job.descriptionHtml ?? '';

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: job.applyUrl ?? raw.sourceUrl,
      title: job.title ?? '',
      companyName: token ?? '',
      description: job.descriptionPlain ?? stripHtml(html),
      bulletText: htmlToLines(html).join('\n'),
      employmentTypeText: job.employmentType ?? null,
      remoteState: job.isRemote === true ? 'remote' : null,
      remoteStateText: [job.title ?? '', locationText ?? ''].join(' '),
      locationText,
      countryCode: job.address?.postalAddress?.addressCountry ?? null,
      postedAt: toIsoTimestamp(job.publishedAt),
      rawPayload: job,
    });
  },
};
