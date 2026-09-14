import { z } from 'zod';

import { clampLimit, fetchJson, readConfigString } from '../http.js';
import { buildJobInput, decodeHtmlEntities, htmlToLines } from '../normalize.js';
import { toIsoTimestamp } from '../sanitize.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput, RawPosting } from '../types.js';

const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';
const ITEM_URL = 'https://news.ycombinator.com/item?id=';
const NUMERIC_ID = /^\d{1,20}$/u;
const PARAGRAPH_BOUNDARY =
  /<\/?(?:p|div|li|ul|ol|h[1-6]|section|article|blockquote)\b[^>]*>|<br\s*\/?>/giu;
const ANY_TAG = /<[^>]*>/gu;

const hnHitSchema = z
  .object({
    objectID: z.string().min(1),
    comment_text: z.string().nullish(),
    story_id: z.union([z.string(), z.number()]).nullish(),
    author: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .catchall(z.unknown());

const hnResponseSchema = z.object({ hits: z.array(z.unknown()) }).catchall(z.unknown());

interface CommentBlock {
  /** The `Company | Role | Location | ...` line, when the block has one. */
  readonly firstLine: string;
  /** The whole block, newlines preserved. */
  readonly text: string;
}

function splitCommentBlocks(commentText: string): CommentBlock[] {
  const decoded = decodeHtmlEntities(commentText).replace(ANY_TAG, (tag: string) =>
    /^<br\b/iu.test(tag) ? '\n' : tag,
  );
  const blocks: CommentBlock[] = [];
  for (const chunk of decoded.split(PARAGRAPH_BOUNDARY)) {
    const lines = htmlToLines(chunk);
    const text = lines.join('\n');
    if (text.trim() === '') continue;
    blocks.push({ firstLine: lines[0] ?? '', text });
  }
  return blocks;
}

function pipeSegments(line: string): string[] {
  if (!line.includes('|')) return [];
  const segments: string[] = [];
  for (const part of line.split('|')) {
    const cleaned = part
      .replace(/^[\s>*_`-]+/u, '')
      .replace(/[\s*_`]+$/u, '')
      .trim();
    if (cleaned !== '') segments.push(cleaned);
  }
  return segments;
}

function blockIndexOf(sourceJobId: string): number | null {
  const separator = sourceJobId.lastIndexOf('#');
  if (separator < 0) return null;
  const suffix = sourceJobId.slice(separator + 1);
  if (!/^\d{1,4}$/u.test(suffix)) return null;
  return Number.parseInt(suffix, 10);
}

/**
 * Hacker News "Who is hiring?" comments, read through the Algolia search API.
 *
 * The thread id comes from the source configuration (a source row per thread),
 * and is validated as a number before it is placed in the query string. Each
 * comment is split on paragraph boundaries; only blocks whose first line is a
 * `Company | Role | Location` style row become postings, because everything
 * else is conversation. These comments are unstructured, so seniority is left
 * `unspecified`, salary is never read out of prose, and the remote state is
 * taken only from an explicit token.
 */
export const hnAlgoliaAdapter: JobSourceAdapter = {
  code: 'hn_algolia',
  displayName: 'Hacker News "Who is hiring?"',
  attribution: 'Hacker News hiring threads via the Algolia Search API (hn.algolia.com).',
  requiresCredentials: false,
  credentialEnvVars: [],

  async fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]> {
    const threadId = readConfigString(context, 'threadId');
    if (threadId === null || !NUMERIC_ID.test(threadId)) return [];
    const limit = clampLimit(context.limit);
    if (limit === 0) return [];

    const tags = encodeURIComponent(`comment,story_${threadId}`);
    const url = `${ENDPOINT}?tags=${tags}&hitsPerPage=${String(Math.min(limit, 1_000))}`;
    const payload = await fetchJson('hn_algolia', context, url);
    const parsed = hnResponseSchema.safeParse(payload);
    if (!parsed.success) return [];

    const postings: RawPosting[] = [];
    for (const item of parsed.data.hits) {
      if (postings.length >= limit) break;
      const hit = hnHitSchema.safeParse(item);
      if (!hit.success || !NUMERIC_ID.test(hit.data.objectID)) continue;
      const commentText = hit.data.comment_text ?? '';
      const blocks = splitCommentBlocks(commentText);
      for (let index = 0; index < blocks.length; index += 1) {
        if (postings.length >= limit) break;
        const block = blocks[index];
        if (block === undefined) continue;
        if (pipeSegments(block.firstLine).length < 2) continue;
        postings.push({
          sourceJobId: `${hit.data.objectID}#${String(index)}`,
          sourceUrl: `${ITEM_URL}${hit.data.objectID}`,
          payload: hit.data,
        });
      }
    }
    return postings;
  },

  normalize(raw: RawPosting): NormalizedJobInput | null {
    const parsed = hnHitSchema.safeParse(raw.payload);
    if (!parsed.success) return null;
    const hit = parsed.data;
    const index = blockIndexOf(raw.sourceJobId);
    if (index === null) return null;

    const blocks = splitCommentBlocks(hit.comment_text ?? '');
    const block = blocks[index];
    if (block === undefined) return null;

    const segments = pipeSegments(block.firstLine);
    const companyName = segments[0];
    const title = segments[1];
    if (companyName === undefined || title === undefined) return null;
    const location = segments[2] ?? null;

    return buildJobInput({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: raw.sourceUrl,
      title,
      companyName,
      description: block.text,
      bulletText: block.text,
      seniority: 'unspecified',
      locationText: location,
      salaryText: null,
      postedAt: toIsoTimestamp(hit.created_at),
      language: 'en',
      rawPayload: hit,
    });
  },
};
