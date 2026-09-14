/**
 * Shared plumbing for board-scoped adapters (Greenhouse, Lever, Ashby,
 * Workable).
 *
 * Every board endpoint in this group is public and free to read, but each is
 * owned by a different company, so one board changing shape, rate-limiting, or
 * disappearing must never stop the others. The contract these adapters keep:
 *
 *   - a transport failure for one board is swallowed and the next board is
 *     tried anyway;
 *   - an unexpected response shape yields no postings for that board, never a
 *     throw;
 *   - `context.limit` bounds the *total* number of postings returned.
 *
 * Board tokens are configuration, not provider data, but they still travel
 * through the same validation as anything else before touching a URL.
 */

import { isSafeConfigToken, readConfigString, readConfigStringArray } from '../http.js';
import type { AdapterContext } from '../types.js';

/** Reads `config.boardTokens` (plus a single `config.boardToken` alias). */
export function readBoardTokens(context: AdapterContext): string[] {
  const tokens: string[] = [];
  const single = readConfigString(context, 'boardToken');
  if (single !== null) tokens.push(single);
  for (const token of readConfigStringArray(context, 'boardTokens')) tokens.push(token);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!isSafeConfigToken(token)) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }
  return unique;
}

/** First non-empty trimmed string, or `null`. */
export function firstNonEmptyString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
}

/** A validated board token from a payload, used as the employer fallback. */
export function boardTokenFromPayload(payload: Record<string, unknown>): string | null {
  const value = payload.boardToken;
  if (typeof value !== 'string') return null;
  return isSafeConfigToken(value) ? value : null;
}

/** Provider ids are usually numbers, sometimes strings; both are valid keys. */
export function sourceIdFromValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
