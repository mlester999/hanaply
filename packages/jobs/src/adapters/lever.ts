import { z } from 'zod';

import { clampLimit, fetchJson } from '../http.js';
import { buildJobInput, htmlToLines, stripHtml } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type {
  AdapterContext,
  JobRemoteState,
  JobSourceAdapter,
  NormalizedJobInput,
  RawPosting,
} from '../types.js';
import { boardTokenFromPayload, readBoardTokens, sourceIdFromValue } from './boards.js';

const ENDPOINT = 'https://api.lever.co/v0/postings';

const leverListSchema = z
  .object({ text: z.string().nullish(), content: z.string().nullish() })
  .catchall(z.unknown());

const leverPostingSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    text: z.string().nullish(),
    description: z.string().nullish(),
    descriptionPlain: z.string().nullish(),
    hostedUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    createdAt: z.union([z.number(), z.string()]).nullish(),
    workplaceType: z.string().nullish(),
    categories: z
      .object({
        location: z.string().nullish(),
        team: z.string().nullish(),
        department: z.string().nullish(),
        commitment: z.string().nullish(),
      })
      .catchall(z.unknown())
      .nullish(),
    lists: z.array(z.unknown()).nullish(),
  })
  .catchall(z.unknown());

const leverResponseSchema = z.array(z.unknown());

const WORKPLACE_TYPES: Readonly<Record<string, JobRemoteState>> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'onsite',
  'on-site': 'onsite',
  'in-office': 'onsite',
};

function remoteStateFromWorkplaceType(value: string | null | undefined): JobRemoteState | null {
  if (value === null || value === undefined) return null;
  return WORKPLACE_TYPES[value.trim().toLowerCase()] ?? null;
}

function listHtml(lists: readonly unknown[] | null | undefined): string {
  if (lists === null || lists === undefined) return '';
  const parts: string[] = [];
  for (const entry of lists) {
    const parsed = leverListSchema.safeParse(entry);
    if (!parsed.success) continue;
    if (typeof parsed.data.content === 'string' && parsed.data.content.trim() !== '') {
      parts.push(parsed.data.content);
    }
  }
  return parts.join('\n');
}

/**
 * Lever postings. The endpoint returns a bare JSON array, and the employer name
 * is not part of the payload, so the configured board token supplies it.
 * `workplaceType` is authoritative when present; otherwise the text is asked.
 */
export const leverAdapter: JobSourceAdapter = {
  code: 'lever',
  displayName: 'Lever Postings',
  attribution: 'Public Lever postings API (api.lever.co).',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const postings: RawPosting[] = [];
    for (const token of readBoardTokens(context)) {
      if (postings.length >= limit) break;
      try {
        const url = `${ENDPOINT}/${encodeURIComponent(token)}?mode=json`;
        const payload = await fetchJson('lever', context, url);
        const parsed = leverResponseSchema.safeParse(payload);
        if (!parsed.success) continue;

        for (const item of parsed.data) {
          if (postings.length >= limit) break;
          const posting = leverPostingSchema.safeParse(item);
          if (!posting.success) continue;
          const sourceJobId = sourceIdFromValue(posting.data.id);
          if (sourceJobId === null) continue;
          postings.push({
            sourceJobId,
            sourceUrl: posting.data.hostedUrl ?? '',
            payload: { ...posting.data, boardToken: token },
          });
        }
      } catch {
        // Isolated per board: one provider's bad response is not the run's.
        continue;
      }
    }
    return postings;
  },

  normalize(raw: RawPosting): NormalizedJobInput | null {
    const parsed = leverPostingSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const posting = parsed.data;
    const token = boardTokenFromPayload(posting);
    const locationText = posting.categories?.location ?? null;
    const html = `${posting.description ?? ''}\n${listHtml(posting.lists)}`;
    const plain = posting.descriptionPlain ?? '';

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: posting.applyUrl ?? raw.sourceUrl,
      title: posting.text ?? '',
      companyName: token ?? '',
      description: plain.trim() === '' ? stripHtml(html) : plain,
      bulletText: htmlToLines(html).join('\n'),
      employmentTypeText: posting.categories?.commitment ?? null,
      remoteState: remoteStateFromWorkplaceType(posting.workplaceType),
      remoteStateText: [posting.text ?? '', locationText ?? ''].join(' '),
      locationText,
      postedAt: toIsoTimestamp(posting.createdAt),
      rawPayload: posting,
    });
  },
};
