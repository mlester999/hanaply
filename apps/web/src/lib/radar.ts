import type { BadgeTone } from '@hanaply/ui';
import {
  jobEmploymentTypeSchema,
  jobMatchVerdictSchema,
  jobRadarQuerySchema,
  jobRemoteStateSchema,
  jobSenioritySchema,
} from '@hanaply/contracts';
import type { JobRadarQuery, JobRadarSort } from '@hanaply/contracts';

import { type CareerOption, optionLabel, salaryPeriodOptions } from '@/lib/career';

/**
 * Display and query helpers for the Career Radar surfaces.
 *
 * Everything here is pure presentation data: option lists that mirror the
 * contract enums, label maps, formatters, and the translation between the flat
 * URL query string and `jobRadarQuerySchema`. No value is invented — when the
 * API has nothing to show, the caller renders an explanatory empty state
 * instead of a number.
 */

const salaryFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

const absoluteDateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
});

const absoluteTimestampFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
});

const hourInMilliseconds = 3_600_000;
const dayInMilliseconds = 24 * hourInMilliseconds;

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Minor units (centavos) rendered as whole pesos. */
export function formatMinor(minor: number): string {
  return salaryFormatter.format(minor / 100);
}

export function formatAbsoluteDate(value: string | null): string | null {
  const date = toDate(value);
  return date === null ? null : absoluteDateFormatter.format(date);
}

export function formatAbsoluteTimestamp(value: string | null): string | null {
  const date = toDate(value);
  return date === null ? null : absoluteTimestampFormatter.format(date);
}

export interface RelativeTime {
  label: string;
  title: string;
}

/**
 * Relative freshness with the exact timestamp kept in a `title` attribute, so
 * the readable label never hides the underlying value.
 */
export function relativeFromIso(
  value: string | null,
  now: Date,
  prefix: string,
): RelativeTime | null {
  const date = toDate(value);
  if (date === null) return null;
  const elapsed = now.getTime() - date.getTime();
  const title = `${prefix} ${absoluteTimestampFormatter.format(date)}`;
  if (elapsed < 0) return { label: `Scheduled ${relativeAge(-elapsed)}`, title };
  return { label: relativeAge(elapsed), title };
}

function relativeAge(elapsed: number): string {
  if (elapsed < hourInMilliseconds) {
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'just now';
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (elapsed < dayInMilliseconds) {
    const hours = Math.floor(elapsed / hourInMilliseconds);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(elapsed / dayInMilliseconds);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/**
 * The opportunity was seen most recently through `lastSeenAt`; `postedAt` is
 * only used when the source never published a posting date.
 */
export function opportunityFreshness(
  item: { postedAt: string | null; lastSeenAt: string },
  now: Date,
): RelativeTime {
  return (
    relativeFromIso(item.postedAt, now, 'Posted') ??
    relativeFromIso(item.lastSeenAt, now, 'Last seen') ?? {
      label: 'First seen date not recorded',
      title: 'Hanaply has no posting or sighting timestamp for this opportunity.',
    }
  );
}

export interface SalaryDisplay {
  text: string;
  /** Always rendered next to the amount when the source row marks it estimated. */
  isEstimate: boolean;
  note: string | null;
}

/** Salary is only shown from the API's own figures, or not shown at all. */
export function salaryDisplay(item: {
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryIsEstimate: boolean;
  salaryPeriod: string | null;
}): SalaryDisplay | null {
  if (item.salaryMinMinor === null && item.salaryMaxMinor === null) return null;
  const period = item.salaryPeriod
    ? (optionLabel(salaryPeriodOptions, item.salaryPeriod)?.toLowerCase() ?? null)
    : null;
  let range: string;
  if (item.salaryMinMinor !== null && item.salaryMaxMinor !== null) {
    range =
      item.salaryMinMinor === item.salaryMaxMinor
        ? formatMinor(item.salaryMinMinor)
        : `${formatMinor(item.salaryMinMinor)} – ${formatMinor(item.salaryMaxMinor)}`;
  } else if (item.salaryMinMinor !== null) {
    range = `From ${formatMinor(item.salaryMinMinor)}`;
  } else {
    range = `Up to ${formatMinor(item.salaryMaxMinor ?? 0)}`;
  }
  return {
    text: period === null ? range : `${range} ${period}`,
    isEstimate: item.salaryIsEstimate,
    note: item.salaryIsEstimate
      ? 'This figure is an estimate from the source, not a published range.'
      : null,
  };
}

export function locationDisplay(item: {
  city: string | null;
  region: string | null;
  countryCode: string | null;
  locationRaw: string | null;
}): string | null {
  const parts = [item.city, item.region, item.countryCode].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  const composed = parts.join(', ');
  if (composed !== '') return composed;
  const raw = item.locationRaw?.trim() ?? '';
  return raw === '' ? null : raw;
}

export function matchVerdictLabel(verdict: string): string {
  return (
    {
      strong_match: 'Strong match',
      good_match: 'Good match',
      stretch: 'Stretch opportunity',
      weak_match: 'Weak match',
      not_recommended: 'Not recommended',
    }[verdict] ?? verdict
  );
}

export function matchConfidenceLabel(confidence: string): string {
  return (
    { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }[confidence] ??
    confidence
  );
}

export function verdictTone(verdict: string): BadgeTone {
  switch (verdict) {
    case 'strong_match':
      return 'success';
    case 'good_match':
      return 'brand';
    case 'stretch':
      return 'warning';
    case 'not_recommended':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function verdictToneClass(verdict: string): string {
  return `is-${verdict.replaceAll('_', '-')}`;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export const jobFeedbackKinds = [
  'interested',
  'not_interested',
  'wrong_role',
  'wrong_seniority',
  'wrong_location',
  'salary_too_low',
  'already_applied',
  'irrelevant',
  'saved',
] as const;

export type JobFeedbackValue = (typeof jobFeedbackKinds)[number];

export const jobFeedbackLabels: Readonly<Record<JobFeedbackValue, string>> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  wrong_role: 'Wrong role',
  wrong_seniority: 'Wrong seniority',
  wrong_location: 'Wrong location',
  salary_too_low: 'Salary too low',
  already_applied: 'Already applied',
  irrelevant: 'Irrelevant',
  saved: 'Saved',
};

/** Why a feedback choice removes the opportunity from the default radar view. */
export const jobFeedbackEffects: Readonly<Record<JobFeedbackValue, string>> = {
  interested: 'Stays in your radar and ranks higher.',
  not_interested: 'Hidden from your radar; find it again under Dismissed.',
  wrong_role: 'Hidden from your radar and used to sharpen role matching.',
  wrong_seniority: 'Hidden from your radar and used to sharpen level matching.',
  wrong_location: 'Hidden from your radar and used to sharpen location matching.',
  salary_too_low: 'Hidden from your radar and used to sharpen compensation matching.',
  already_applied: 'Hidden from your radar so only open opportunities remain.',
  irrelevant: 'Hidden from your radar as noise.',
  saved: 'Kept in your saved list, like the Save action.',
};

export function jobFeedbackLabel(value: string): string {
  return jobFeedbackKinds.includes(value as JobFeedbackValue)
    ? jobFeedbackLabels[value as JobFeedbackValue]
    : value.replaceAll('_', ' ');
}

// ---------------------------------------------------------------------------
// Filter option lists
// ---------------------------------------------------------------------------

export type RadarEmploymentType = (typeof jobEmploymentTypeSchema.options)[number];
export type RadarSeniority = (typeof jobSenioritySchema.options)[number];
export type RadarRemoteState = (typeof jobRemoteStateSchema.options)[number];
export type RadarVerdict = (typeof jobMatchVerdictSchema.options)[number];
export type RadarSort = JobRadarSort;

export const radarRemoteStateOptions: readonly CareerOption<RadarRemoteState>[] =
  jobRemoteStateSchema.options.map((value) => ({
    value,
    label: value === 'onsite' ? 'Onsite' : value.charAt(0).toUpperCase() + value.slice(1),
  }));

export const radarEmploymentTypeOptions: readonly CareerOption<RadarEmploymentType>[] =
  jobEmploymentTypeSchema.options.map((value) => ({
    value,
    label: value.replaceAll('_', ' ').replace(/^\w/u, (letter) => letter.toUpperCase()),
  }));

export const radarSeniorityOptions: readonly CareerOption<RadarSeniority>[] =
  jobSenioritySchema.options.map((value) => ({
    value,
    label: value.replaceAll('_', ' ').replace(/^\w/u, (letter) => letter.toUpperCase()),
  }));

export const radarSortOptions: readonly CareerOption<RadarSort>[] = [
  { value: 'best_match', label: 'Best match' },
  { value: 'newest', label: 'Newest first' },
  { value: 'salary', label: 'Highest advertised salary' },
  { value: 'company', label: 'Company name' },
];

export const radarVerdictOptions: readonly CareerOption<RadarVerdict>[] =
  jobMatchVerdictSchema.options.map((value) => ({ value, label: matchVerdictLabel(value) }));

export const radarMinimumScoreOptions: readonly { value: string; label: string }[] = [
  { value: '50', label: '50 and above' },
  { value: '58', label: '58 and above' },
  { value: '70', label: '70 and above' },
  { value: '82', label: '82 and above' },
  { value: '90', label: '90 and above' },
];

export const radarPostedWithinOptions: readonly { value: string; label: string }[] = [
  { value: '1', label: 'Last 24 hours' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

// ---------------------------------------------------------------------------
// URL query string ⇄ jobRadarQuerySchema
// ---------------------------------------------------------------------------

/** Next.js hands a repeated parameter to a server component as a string array. */
export type RadarSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Every filter the radar filter bar understands, in display order. */
export const radarFilterKeys = [
  'search',
  'careerProfileId',
  'sort',
  'page',
  'minScore',
  'verdicts',
  'remoteStates',
  'employmentTypes',
  'seniorities',
  'philippinesOnly',
  'internationalOnly',
  'postedWithinDays',
  'savedOnly',
  'dismissedOnly',
] as const;

const multiValueKeys = new Set(['verdicts', 'remoteStates', 'employmentTypes', 'seniorities']);

/** `?remoteStates=remote&remoteStates=hybrid` and `?remoteStates=remote,hybrid` both work. */
export function firstValue(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
  return undefined;
}

function joinedValue(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw: readonly string[] = typeof value === 'string' ? [value] : value;
  const cleaned = raw
    .flatMap((entry: string) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return cleaned.length === 0 ? undefined : cleaned.join(',');
}

function trimmedValue(value: string | readonly string[] | undefined): string | undefined {
  const first = firstValue(value)?.trim();
  return first === undefined || first === '' ? undefined : first;
}

function booleanValue(value: string | readonly string[] | undefined): true | undefined {
  const first = firstValue(value);
  return first === 'on' || first === '1' || first === 'true' ? true : undefined;
}

export interface RadarQueryResult {
  /** Validated, API-ready input. Invalid values are dropped, never forwarded. */
  query: JobRadarQuery;
  /** Values that were dropped, so the page can say so instead of failing. */
  invalidKeys: readonly string[];
}

/**
 * The URL is the source of truth for filters, and the API client only accepts
 * flat query values, so every array filter is sent as one comma-separated
 * value. Values the contract rejects are dropped from the request but stay in
 * the URL, and the page tells the member which ones were ignored.
 */
export function radarQueryFromSearchParams(values: RadarSearchParams): RadarQueryResult {
  const candidate: Record<string, unknown> = {};
  const invalidKeys: string[] = [];

  for (const [key, raw] of Object.entries(values)) {
    if (!(radarFilterKeys as readonly string[]).includes(key)) continue;
    if (raw === undefined) continue;
    if (multiValueKeys.has(key)) {
      const joined = joinedValue(raw);
      if (joined !== undefined) candidate[key] = joined;
      continue;
    }
    if (key === 'page') {
      const page = trimmedValue(raw);
      if (page !== undefined) candidate[key] = page;
      continue;
    }
    if (key === 'search' || key === 'careerProfileId') {
      const text = trimmedValue(raw);
      if (text !== undefined) candidate[key] = text;
      continue;
    }
    if (key === 'minScore' || key === 'postedWithinDays') {
      const numeric = trimmedValue(raw);
      if (numeric !== undefined) candidate[key] = numeric;
      continue;
    }
    if (key === 'sort') {
      const sort = trimmedValue(raw);
      if (sort !== undefined) candidate[key] = sort;
      continue;
    }
    const flag = booleanValue(raw);
    if (flag !== undefined) candidate[key] = flag;
  }

  const parsed = jobRadarQuerySchema.safeParse(candidate);
  if (parsed.success) {
    return { query: parsed.data, invalidKeys };
  }

  const rejected = new Set(
    parsed.error.issues
      .map((issue) => issue.path[0])
      .filter((key): key is string => typeof key === 'string'),
  );
  const accepted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!rejected.has(key)) accepted[key] = value;
  }
  const retried = jobRadarQuerySchema.safeParse(accepted);
  return {
    query: retried.success ? retried.data : { sort: 'best_match', page: 1, pageSize: 20 },
    invalidKeys: [...rejected].sort((left, right) => left.localeCompare(right)),
  };
}

export function searchParamKeyLabel(key: string): string {
  const labels: Readonly<Record<string, string>> = {
    careerProfileId: 'career profile',
    sort: 'sort order',
    page: 'page number',
    minScore: 'minimum match score',
    verdicts: 'verdict filter',
    remoteStates: 'remote state filter',
    employmentTypes: 'employment type filter',
    seniorities: 'seniority filter',
    philippinesOnly: 'Philippines only toggle',
    internationalOnly: 'international toggle',
    postedWithinDays: 'posted within filter',
    savedOnly: 'saved filter',
    dismissedOnly: 'dismissed filter',
  };
  return labels[key] ?? key;
}

// ---------------------------------------------------------------------------
// Active filters, query string building, and pagination
// ---------------------------------------------------------------------------

export interface RadarActiveFilter {
  label: string;
  value: string;
}

/** `excludeStatus` keeps the saved feed's own `savedOnly=true` out of "clear all". */
export function radarActiveFilters(
  query: JobRadarQuery,
  options: { excludeStatus?: boolean } = {},
): readonly RadarActiveFilter[] {
  const filters: RadarActiveFilter[] = [];
  if (query.search) filters.push({ label: 'Search', value: query.search });
  if (query.careerProfileId) filters.push({ label: 'Career profile', value: 'Selected profile' });
  if (query.sort !== 'best_match') {
    filters.push({
      label: 'Sort',
      value: optionLabel(radarSortOptions, query.sort) ?? query.sort,
    });
  }
  if (query.minScore !== undefined) {
    filters.push({ label: 'Minimum score', value: `${query.minScore} and above` });
  }
  if (query.verdicts?.length) {
    filters.push({
      label: 'Verdict',
      value: query.verdicts.map((verdict) => matchVerdictLabel(verdict)).join(', '),
    });
  }
  if (query.remoteStates?.length) {
    filters.push({
      label: 'Work setup',
      value: query.remoteStates
        .map((state) => optionLabel(radarRemoteStateOptions, state) ?? state)
        .join(', '),
    });
  }
  if (query.employmentTypes?.length) {
    filters.push({
      label: 'Employment type',
      value: query.employmentTypes
        .map((type) => optionLabel(radarEmploymentTypeOptions, type) ?? type)
        .join(', '),
    });
  }
  if (query.seniorities?.length) {
    filters.push({
      label: 'Seniority',
      value: query.seniorities
        .map((seniority) => optionLabel(radarSeniorityOptions, seniority) ?? seniority)
        .join(', '),
    });
  }
  const location: string[] = [];
  if (query.philippinesOnly) location.push('Philippines only');
  if (query.internationalOnly) location.push('International');
  if (query.countryCode) location.push(`Country ${query.countryCode}`);
  if (location.length > 0) filters.push({ label: 'Location', value: location.join(' · ') });
  if (query.postedWithinDays !== undefined) {
    filters.push({ label: 'Posted within', value: `${query.postedWithinDays} days` });
  }
  if (!options.excludeStatus) {
    if (query.savedOnly) filters.push({ label: 'Showing', value: 'Saved only' });
    if (query.dismissedOnly) filters.push({ label: 'Showing', value: 'Dismissed only' });
  }
  return filters;
}

/** Current filters minus pagination, as strings ready for `URLSearchParams`. */
export function radarHrefQueryValues(query: JobRadarQuery): Record<string, string> {
  const values: Record<string, string> = {};
  const set = (key: string, value: string | number | boolean | undefined): void => {
    if (value === undefined || value === false || value === '') return;
    values[key] = String(value);
  };
  set('search', query.search);
  set('careerProfileId', query.careerProfileId);
  if (query.sort !== 'best_match') set('sort', query.sort);
  set('minScore', query.minScore);
  set('verdicts', query.verdicts?.join(','));
  set('remoteStates', query.remoteStates?.join(','));
  set('employmentTypes', query.employmentTypes?.join(','));
  set('seniorities', query.seniorities?.join(','));
  set('countryCode', query.countryCode);
  set('philippinesOnly', query.philippinesOnly);
  set('internationalOnly', query.internationalOnly);
  set('postedWithinDays', query.postedWithinDays);
  set('salaryMinMinor', query.salaryMinMinor);
  set('companyId', query.companyId);
  set('savedOnly', query.savedOnly);
  set('dismissedOnly', query.dismissedOnly);
  set('includeDismissed', query.includeDismissed);
  if (query.pageSize !== 20) set('pageSize', query.pageSize);
  return values;
}

export function radarHref(basePath: string, query: JobRadarQuery, page?: number): string {
  const params = new URLSearchParams(radarHrefQueryValues(query));
  if (page !== undefined && page > 1) params.set('page', String(page));
  const queryString = params.toString();
  return queryString === '' ? basePath : `${basePath}?${queryString}`;
}

export interface RadarPaginationLink {
  page: number | null;
  label: string;
  current: boolean;
}

/**
 * A bounded window around the current page. Rendering one link per page stops
 * being usable past a few dozen results, and a window never claims there are
 * more pages than the API reported.
 */
export function radarPaginationWindow(
  page: number,
  totalPages: number,
): readonly RadarPaginationLink[] {
  if (totalPages <= 0) return [];
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  if (page <= 3) pages.add(2);
  if (page >= totalPages - 2) pages.add(totalPages - 1);
  const ordered = [...pages]
    .filter((candidate) => candidate >= 1 && candidate <= totalPages)
    .sort((left, right) => left - right);
  const links: RadarPaginationLink[] = [];
  let previous: number | null = null;
  for (const candidate of ordered) {
    if (previous !== null && candidate - previous > 1) {
      links.push({ page: null, label: '…', current: false });
    }
    links.push({ page: candidate, label: String(candidate), current: candidate === page });
    previous = candidate;
  }
  return links;
}

export interface RadarFeedScope {
  basePath: string;
  /** Empty-state copy depends on which entry point rendered the feed. */
  isSavedView: boolean;
  isDismissedView: boolean;
}

export function radarScope(query: JobRadarQuery, basePath: string): RadarFeedScope {
  return {
    basePath,
    isSavedView: query.savedOnly === true,
    isDismissedView: query.dismissedOnly === true,
  };
}

/** Skills are trimmed to a readable row plus an exact "+N more" count. */
export function radarSkillSplit(skills: readonly string[], limit: number) {
  return {
    shown: skills.slice(0, limit),
    remaining: Math.max(skills.length - limit, 0),
  };
}

/** The same UUID shape the contract schemas enforce, for pre-validating input. */
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}
