import { z } from 'zod';

import { clampLimit, fetchJson } from '../http.js';
import { buildJobInput, htmlToLines } from '../normalize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';
import {
  boardTokenFromPayload,
  firstNonEmptyString,
  readBoardTokens,
  sourceIdFromValue,
} from './boards.js';

const ENDPOINT = 'https://boards-api.greenhouse.io/v1/boards';

const greenhouseJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    absolute_url: z.string().nullish(),
    updated_at: z.string().nullish(),
    company_name: z.string().nullish(),
    content: z.string().nullish(),
    location: z.object({ name: z.string().nullish() }).catchall(z.unknown()).nullish(),
  })
  .catchall(z.unknown());

const greenhouseResponseSchema = z
  .object({ name: z.string().nullish(), jobs: z.array(z.unknown()) })
  .catchall(z.unknown());

/**
 * Greenhouse job boards.
 *
 * `content` is HTML (and on some boards it is HTML that has been
 * entity-escaped), so it is decoded before tags are removed. Greenhouse does
 * not always state the employer in the postings endpoint: the per-job
 * `company_name` and the board's own `name` are used when present, and the
 * operator-configured board token — the identifier that *is* the employer's
 * board — is the last resort.
 */
export const greenhouseAdapter: JobSourceAdapter = {
  code: 'greenhouse',
  displayName: 'Greenhouse Job Boards',
  attribution: 'Public Greenhouse job board API (boards-api.greenhouse.io).',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const postings: RawPosting[] = [];
    for (const token of readBoardTokens(context)) {
      if (postings.length >= limit) break;
      try {
        const url = `${ENDPOINT}/${encodeURIComponent(token)}/jobs?content=true`;
        const payload = await fetchJson('greenhouse', context, url);
        const parsed = greenhouseResponseSchema.safeParse(payload);
        if (!parsed.success) continue;
        const boardName = firstNonEmptyString(parsed.data.name);

        for (const item of parsed.data.jobs) {
          if (postings.length >= limit) break;
          const job = greenhouseJobSchema.safeParse(item);
          if (!job.success) continue;
          const sourceJobId = sourceIdFromValue(job.data.id);
          if (sourceJobId === null) continue;
          postings.push({
            sourceJobId,
            sourceUrl: job.data.absolute_url ?? '',
            payload: {
              ...job.data,
              boardToken: token,
              companyName: firstNonEmptyString(job.data.company_name, boardName, token),
            },
          });
        }
      } catch {
        // One board failing (HTTP error, timeout, a changed contract) must not
        // stop the rest of the boards or the ingestion run.
        continue;
      }
    }
    return postings;
  },

  normalize(raw: RawPosting): NormalizedJobInput | null {
    const parsed = greenhouseJobSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const job = parsed.data;
    const token = boardTokenFromPayload(job);
    const companyName = firstNonEmptyString(job.companyName, job.company_name, token);
    const content = job.content ?? '';
    const locationText = job.location?.name ?? null;

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: raw.sourceUrl,
      title: job.title ?? '',
      companyName: companyName ?? '',
      description: content,
      bulletText: htmlToLines(content).join('\n'),
      remoteStateText: [job.title ?? '', locationText ?? ''].join(' '),
      locationText,
      // Greenhouse publishes `updated_at` only; using it as `posted_at` would
      // make an old posting look fresh, so the date stays unknown.
      postedAt: null,
      rawPayload: job,
    });
  },
};
