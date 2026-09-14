import { z } from 'zod';

import { clampLimit, fetchJson } from '../http.js';
import { buildJobInput, extractSkills, htmlToLines } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';

const ENDPOINT = 'https://www.arbeitnow.com/api/job-board-api';

const arbeitnowJobSchema = z
  .object({
    slug: z.string().min(1),
    company_name: z.string().nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    remote: z.boolean().nullish(),
    url: z.string().nullish(),
    tags: z.array(z.unknown()).nullish(),
    job_types: z.array(z.unknown()).nullish(),
    location: z.string().nullish(),
    created_at: z.union([z.string(), z.number()]).nullish(),
  })
  .catchall(z.unknown());

const arbeitnowResponseSchema = z.object({ data: z.array(z.unknown()) }).catchall(z.unknown());

function stringList(value: readonly unknown[] | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') result.push(item.trim());
  }
  return result;
}

/**
 * Arbeitnow's public board. `created_at` arrives as a Unix timestamp, and the
 * board's `remote` flag is trusted only when true; a false flag says nothing
 * about hybrid work, so the text is asked instead.
 */
export const arbeitnowAdapter: JobSourceAdapter = {
  code: 'arbeitnow',
  displayName: 'Arbeitnow',
  attribution: 'Arbeitnow job board API (arbeitnow.com). Postings syndicated for distribution.',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];
    const payload = await fetchJson('arbeitnow', context, ENDPOINT);
    const parsed = arbeitnowResponseSchema.safeParse(payload);
    if (!parsed.success) return [];

    const postings: RawPosting[] = [];
    for (const item of parsed.data.data) {
      if (postings.length >= limit) break;
      const job = arbeitnowJobSchema.safeParse(item);
      if (!job.success) continue;
      postings.push({
        sourceJobId: job.data.slug,
        sourceUrl: typeof job.data.url === 'string' ? job.data.url : '',
        payload: job.data,
      });
    }
    return postings;
  },

  normalize(raw: RawPosting, context: AdapterContext): NormalizedJobInput | null {
    const parsed = arbeitnowJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;
    const description = job.description ?? '';
    const tags = stringList(job.tags);
    const jobTypes = stringList(job.job_types);
    const title = job.title ?? '';

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: raw.sourceUrl,
      title,
      companyName: job.company_name ?? '',
      description,
      bulletText: htmlToLines(description).join('\n'),
      employmentTypeText: jobTypes[0] ?? null,
      remoteState: job.remote === true ? 'remote' : null,
      locationText: job.location ?? null,
      skills: extractSkills([title, description, tags.join(' ')].join(' ')),
      postedAt: toIsoTimestamp(job.created_at, context.now),
      rawPayload: job,
      now: context.now,
    });
  },
};
