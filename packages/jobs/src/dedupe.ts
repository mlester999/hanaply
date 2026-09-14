/**
 * Deduplication scoring.
 *
 * `public.upsert_ingested_job` merges on two hard signals: an identical
 * `content_fingerprint` for the same company, or the same composite dedup key
 * within a posting-date window. Those two signals are deliberately narrow — a
 * repost with a rewritten description matches neither. This module is the
 * softer, explainable layer above them: it scores a candidate posting against
 * an existing one across every fact both carry, and reports each contribution
 * so a reviewer can see *why* a pair was proposed.
 *
 * The score is a weighted mean of independent signals, and an identical content
 * fingerprint is decisive by construction: the SQL already treats that as the
 * same opportunity, so it scores 1 here too.
 */

import { normalizeCompanyName, normalizeTitle } from './normalize.js';
import { collapseWhitespace, sanitizeHttpUrl } from './sanitize.js';

/** Matches the 1814400-second window in `public.upsert_ingested_job`. */
export const RECENCY_WINDOW_DAYS = 21;

export const MERGE_THRESHOLD = 0.92;
export const REVIEW_THRESHOLD = 0.6;

const DAY_MS = 24 * 60 * 60 * 1_000;
const DESCRIPTION_COMPARISON_LIMIT = 2_000;

/**
 * Every signal is weighted so the weights sum to 1. Company and title agreement
 * carry the most weight because they are the two facts a provider always
 * states; the fingerprint is a separate, decisive short-circuit.
 */
const WEIGHTS = {
  contentFingerprint: 0.1,
  canonicalUrl: 0.02,
  sourceJobId: 0.01,
  company: 0.3,
  title: 0.3,
  location: 0.1,
  description: 0.15,
  postedAt: 0.02,
} as const;

/** The fields a deduplication decision needs; `NormalizedJobInput` satisfies it. */
export interface DedupeComparableJob {
  readonly sourceJobId: string;
  readonly sourceUrl: string;
  readonly companyName: string;
  readonly title: string;
  readonly description: string;
  readonly locationRaw: string | null;
  readonly postedAt: string | null;
  readonly contentFingerprint: string;
}

export interface DedupeSignals {
  score: number;
  signals: Record<string, number>;
}

export type DedupeClassification = 'merge' | 'review' | 'distinct';

const WORD_PATTERN = /[a-z0-9+#]+/gu;

/** Lowercased word tokens, used for every set comparison. */
export function normalizedWords(value: string): string[] {
  const words: string[] = [];
  for (const match of collapseWhitespace(value).toLowerCase().matchAll(WORD_PATTERN)) {
    words.push(match[0]);
  }
  return words;
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizedWords(value));
}

/**
 * Token-set Jaccard similarity over normalized words, 0..1. Two empty strings
 * are identical (1); one empty string and one populated string share nothing
 * (0).
 */
export function similarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return leftTokens.size === rightTokens.size ? 1 : 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const union = leftTokens.size + rightTokens.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Host plus path, lowercased and without a trailing slash. Query strings are
 * ignored on purpose: they carry the tracking parameters that made two
 * copies of the same posting look different in the first place.
 */
export function comparableUrl(value: string): string | null {
  const sanitized = sanitizeHttpUrl(value);
  if (sanitized === null) return null;
  try {
    const url = new URL(sanitized);
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    const path = url.pathname.toLowerCase().replace(/\/+$/u, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function exactMatch(left: string, right: string): number {
  const a = collapseWhitespace(left).toLowerCase();
  const b = collapseWhitespace(right).toLowerCase();
  if (a === '' || b === '') return 0;
  return a === b ? 1 : 0;
}

function companySignal(candidate: string, existing: string): number {
  const left = normalizeCompanyName(candidate);
  const right = normalizeCompanyName(existing);
  if (left === '' || right === '') return 0;
  return left === right ? 1 : similarity(left, right);
}

function titleSignal(candidate: string, existing: string): number {
  const left = normalizeTitle(candidate);
  const right = normalizeTitle(existing);
  if (left === '' || right === '') return 0;
  return similarity(left, right);
}

function locationSignal(candidate: string | null, existing: string | null): number {
  if (candidate === null || existing === null) return 0;
  const left = collapseWhitespace(candidate).toLowerCase();
  const right = collapseWhitespace(existing).toLowerCase();
  if (left === '' || right === '') return 0;
  return similarity(left, right);
}

function descriptionSignal(candidate: string, existing: string): number {
  return similarity(
    candidate.slice(0, DESCRIPTION_COMPARISON_LIMIT),
    existing.slice(0, DESCRIPTION_COMPARISON_LIMIT),
  );
}

/**
 * Posting-date proximity, 1 on the same day and 0 at (or beyond) the 21-day
 * window the SQL merge rule uses. A missing or unparsable date contributes
 * nothing rather than a default.
 */
export function recencySignal(
  candidate: string | null,
  existing: string | null,
  windowDays = RECENCY_WINDOW_DAYS,
): number {
  if (candidate === null || existing === null) return 0;
  const left = Date.parse(candidate);
  const right = Date.parse(existing);
  if (Number.isNaN(left) || Number.isNaN(right)) return 0;
  const difference = Math.abs(left - right);
  if (difference >= windowDays * DAY_MS) return 0;
  return 1 - difference / (windowDays * DAY_MS);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Scores a candidate against an existing job. `signals` carries each
 * contribution (0..1) under a stable key, and `score` is the weighted mean —
 * except when the two postings share a content fingerprint, which is the exact
 * signal `public.upsert_ingested_job` merges on and therefore scores 1.
 */
export function dedupeSignals(
  candidate: DedupeComparableJob,
  existing: DedupeComparableJob,
): DedupeSignals {
  const fingerprintMatch = exactMatch(candidate.contentFingerprint, existing.contentFingerprint);
  const candidateUrl = comparableUrl(candidate.sourceUrl);
  const existingUrl = comparableUrl(existing.sourceUrl);

  const fingerprintSignal = fingerprintMatch;
  const canonicalUrlSignal =
    candidateUrl !== null && existingUrl !== null && candidateUrl === existingUrl ? 1 : 0;
  const sourceJobIdSignal = exactMatch(candidate.sourceJobId, existing.sourceJobId);
  const company = companySignal(candidate.companyName, existing.companyName);
  const title = titleSignal(candidate.title, existing.title);
  const location = locationSignal(candidate.locationRaw, existing.locationRaw);
  const description = descriptionSignal(candidate.description, existing.description);
  const postedAt = recencySignal(candidate.postedAt, existing.postedAt);

  const signals: Record<string, number> = {
    contentFingerprint: fingerprintSignal,
    canonicalUrl: canonicalUrlSignal,
    sourceJobId: sourceJobIdSignal,
    company,
    title,
    location,
    description,
    postedAt,
  };

  const weighted =
    fingerprintSignal * WEIGHTS.contentFingerprint +
    canonicalUrlSignal * WEIGHTS.canonicalUrl +
    sourceJobIdSignal * WEIGHTS.sourceJobId +
    company * WEIGHTS.company +
    title * WEIGHTS.title +
    location * WEIGHTS.location +
    description * WEIGHTS.description +
    postedAt * WEIGHTS.postedAt;

  return {
    score: fingerprintMatch === 1 ? 1 : round(weighted),
    signals: Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, round(value)])),
  };
}

/**
 * `merge` at or above 0.92, `review` at or above 0.6, otherwise `distinct`.
 * A non-finite score is always distinct.
 */
export function classifyDedupe(score: number): DedupeClassification {
  if (!Number.isFinite(score)) return 'distinct';
  if (score >= MERGE_THRESHOLD) return 'merge';
  if (score >= REVIEW_THRESHOLD) return 'review';
  return 'distinct';
}
