/**
 * Bounds and coercion for untrusted provider data.
 *
 * Everything in this module treats its input as hostile: strings are truncated
 * to the lengths `public.jobs` enforces, URLs are parsed (never concatenated),
 * timestamps are sanity-checked, and raw payloads are bounded so a single
 * pathological response cannot become an unbounded jsonb document.
 */

/** Matches the `public.jobs.description` check (20..40000). */
export const MAX_DESCRIPTION_LENGTH = 40_000;
/** Matches the `public.jobs.title` check (2..300). */
export const MAX_TITLE_LENGTH = 300;
/** Matches the `public.companies.display_name` check (1..200). */
export const MAX_COMPANY_NAME_LENGTH = 200;
/** Matches the `public.jobs.location_raw` check (1..300). */
export const MAX_LOCATION_LENGTH = 300;
/** Matches the `public.jobs.canonical_url` / `apply_url` checks (8..1000). */
export const MAX_URL_LENGTH = 1_000;
/** Matches `app_private.career_text_array(payload, key, 40, 60)` for skills. */
export const MAX_SKILLS = 40;
export const MAX_SKILL_LENGTH = 60;

const TRACKING_PARAMETERS = ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref_src', 'igshid', 'yclid'];

/** Collapses every run of whitespace (including newlines) into one space. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Truncates on the string boundary; a no-op when the value already fits. */
export function truncateText(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum).trimEnd();
}

/**
 * Parses an absolute http(s) URL, drops obvious tracking parameters, and
 * returns `null` for anything that is not a web address. Nothing is ever
 * concatenated into a URL here, so provider text cannot inject a host.
 */
export function sanitizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 8) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.hostname === '') return null;

  parsed.hash = '';
  const removable: string[] = [];
  for (const key of parsed.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMETERS.includes(lower)) removable.push(key);
  }
  for (const key of removable) parsed.searchParams.delete(key);

  let href = parsed.href;
  if (href.length > MAX_URL_LENGTH) {
    parsed.search = '';
    href = parsed.href;
  }
  if (href.length > MAX_URL_LENGTH || href.length < 8) return null;
  return href;
}

/** True when the value looks like an absolute http(s) URL. */
export function isHttpUrl(value: unknown): boolean {
  return sanitizeHttpUrl(value) !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * jsonb columns in this schema require an object. A provider that returns an
 * array or a scalar at the top level is wrapped rather than rejected, so the
 * provenance of the posting is still recorded.
 */
export function toRawPayload(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return { ...value };
  return { value };
}

function boundValue(value: unknown, depth: number, seen: Set<object>): unknown {
  if (value === null) return null;
  if (typeof value === 'string') return truncateText(value, MAX_DESCRIPTION_LENGTH);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object') return null;
  if (depth >= 8 || seen.has(value)) return null;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value.slice(0, 200)) items.push(boundValue(item, depth + 1, seen));
      return items;
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(source)) {
      if (count >= 200) break;
      result[key] = boundValue(source[key], depth + 1, seen);
      count += 1;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** Bounds depth, breadth, and string length of a stored raw payload. */
export function boundPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const bounded = boundValue(payload, 0, new Set<object>());
  return isPlainObject(bounded) ? bounded : {};
}

const EPOCH_MILLISECONDS_THRESHOLD = 100_000_000_000;
const EARLIEST_PLAUSIBLE_POSTING = Date.UTC(2000, 0, 1);
const FUTURE_POSTING_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1_000;

function epochToIso(epoch: number): string | null {
  const milliseconds = Math.abs(epoch) < EPOCH_MILLISECONDS_THRESHOLD ? epoch * 1_000 : epoch;
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

/**
 * Coerces a provider timestamp (ISO string, epoch seconds, or epoch
 * milliseconds) to an ISO-8601 UTC string. `null` means "unknown", which is
 * always preferable to a fabricated date.
 */
export function toIsoTimestamp(value: unknown, now?: Date): string | null {
  let iso: string | null = null;
  if (typeof value === 'number') {
    iso = epochToIso(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (/^\d{9,19}$/u.test(trimmed)) {
      iso = epochToIso(Number.parseInt(trimmed, 10));
    } else {
      const parsed = new Date(trimmed);
      iso = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
  }
  if (iso === null) return null;

  const milliseconds = Date.parse(iso);
  if (milliseconds < EARLIEST_PLAUSIBLE_POSTING) return null;
  const ceiling = (now ?? new Date()).getTime() + FUTURE_POSTING_TOLERANCE_MS;
  if (milliseconds > ceiling) return null;
  return iso;
}

/** Positive integers only, bounded by what `public.jobs` accepts. */
export function positiveIntegerOrNull(value: unknown, maximum = 2_000_000_000): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value <= 0 || value > maximum) return null;
  return value;
}

/** Non-negative numbers with at most one decimal, bounded by the schema. */
export function boundedYearsOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 60) return null;
  return Math.round(value * 10) / 10;
}

/** ISO 3166-1 alpha-2, uppercase, or `null` when the input is not a code. */
export function toCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(trimmed) ? trimmed : null;
}

/** ISO 4217, uppercase, or `null`. */
export function toCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/u.test(trimmed) ? trimmed : null;
}

/** Language tags such as `en` or `en-PH`, matching the `public.jobs` check. */
export function toLanguageTag(value: unknown): string {
  if (typeof value !== 'string') return 'en';
  const trimmed = value.trim();
  return /^[a-z]{2}(-[A-Z]{2})?$/u.test(trimmed) ? trimmed : 'en';
}

/** Trims, bounds, and de-duplicates a list of external strings. */
export function toBoundedStringArray(
  values: readonly unknown[],
  maximumItems: number,
  maximumLength: number,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (result.length >= maximumItems) break;
    if (typeof value !== 'string') continue;
    const cleaned = truncateText(collapseWhitespace(value), maximumLength);
    if (cleaned.length === 0) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}
