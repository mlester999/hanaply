import { z } from 'zod';

import { clampLimit, fetchJson } from '../http.js';
import { buildJobInput, htmlToLines } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';

const ENDPOINT = 'https://remotive.com/api/remote-jobs';

const remotiveJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    url: z.string().nullish(),
    title: z.string().nullish(),
    company_name: z.string().nullish(),
    company_logo: z.string().nullish(),
    category: z.string().nullish(),
    job_type: z.string().nullish(),
    publication_date: z.string().nullish(),
    candidate_required_location: z.string().nullish(),
    salary: z.string().nullish(),
    description: z.string().nullish(),
  })
  .catchall(z.unknown());

const remotiveResponseSchema = z.object({ jobs: z.array(z.unknown()) }).catchall(z.unknown());

/**
 * Remotive's public feed. Every posting is remote by definition of the board,
 * so `remoteState` is set explicitly rather than detected: the source states
 * it. Salary is free text, and only an unambiguous amount survives parsing —
 * the original string always stays in `rawPayload`.
 */
export const remotiveAdapter: JobSourceAdapter = {
  code: 'remotive',
  displayName: 'Remotive',
  attribution: 'Remotive public API (remotive.com). Postings syndicated for distribution.',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];
    const payload = await fetchJson('remotive', context, `${ENDPOINT}?limit=${String(limit)}`);
    const parsed = remotiveResponseSchema.safeParse(payload);
    if (!parsed.success) return [];

    const postings: RawPosting[] = [];
    for (const item of parsed.data.jobs) {
      if (postings.length >= limit) break;
      const job = remotiveJobSchema.safeParse(item);
      if (!job.success) continue;
      postings.push({
        sourceJobId: typeof job.data.id === 'string' ? job.data.id : String(job.data.id),
        sourceUrl: typeof job.data.url === 'string' ? job.data.url : '',
        payload: job.data,
      });
    }
    return postings;
  },

  normalize(raw: RawPosting, context: AdapterContext): NormalizedJobInput | null {
    const parsed = remotiveJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;
    const description = job.description ?? '';

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: raw.sourceUrl,
      title: job.title ?? '',
      companyName: job.company_name ?? '',
      description,
      bulletText: htmlToLines(description).join('\n'),
      employmentTypeText: job.job_type ?? null,
      remoteState: 'remote',
      locationText: job.candidate_required_location ?? null,
      salaryText: job.salary ?? null,
      postedAt: toIsoTimestamp(job.publication_date, context.now),
      rawPayload: job,
      now: context.now,
    });
  },
};
