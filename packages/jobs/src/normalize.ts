/**
 * Deterministic text normalization for job ingestion.
 *
 * Everything here is pure: no I/O, no clock reads except an explicitly passed
 * `now`, no provider knowledge. Adapters collect facts; this module decides how
 * those facts are spelled, and refuses to guess when the text does not say.
 *
 * The SQL contract in `supabase/migrations/20260915090000_job_ingestion_foundation.sql`
 * is the authority for two functions mirrored here:
 *
 *   - `app_private.normalize_company_name`
 *   - `app_private.normalize_job_title`
 *
 * Both mirrors are covered by parity tests in `tests/unit/jobs-adapters.test.ts`.
 */

import { createHash } from 'node:crypto';

import {
  MAX_COMPANY_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_SKILLS,
  MAX_SKILL_LENGTH,
  MAX_TITLE_LENGTH,
  boundPayload,
  boundedYearsOrNull,
  collapseWhitespace,
  positiveIntegerOrNull,
  sanitizeHttpUrl,
  toBoundedStringArray,
  toCountryCode,
  toCurrencyCode,
  toIsoTimestamp,
  toLanguageTag,
  toRawPayload,
  truncateText,
} from './sanitize.js';
import type {
  EmploymentType,
  JobRemoteState,
  JobSeniority,
  NormalizedJobInput,
  SalaryPeriod,
} from './types.js';

// ---------------------------------------------------------------------------
// HTML and text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  bull: '-',
  copy: '(c)',
  deg: 'deg',
  eacute: 'e',
  ellipsis: '...',
  emdash: '-',
  endash: '-',
  gt: '>',
  hellip: '...',
  laquo: '"',
  ldquo: '"',
  lsquo: "'",
  lt: '<',
  mdash: '-',
  middot: '-',
  nbsp: ' ',
  ndash: '-',
  quot: '"',
  raquo: '"',
  rdquo: '"',
  reg: '(r)',
  rsquo: "'",
  trade: '(tm)',
};

const ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/gu;

/** Decodes the common named and numeric HTML entities. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (match: string, entity: string) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity.charAt(1) === 'x' || entity.charAt(1) === 'X';
      const digits = hexadecimal ? entity.slice(2) : entity.slice(1);
      if (digits === '') return match;
      const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10_ff_ff) return match;
      if (code >= 0xd8_00 && code <= 0xdf_ff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const SCRIPT_OR_STYLE = /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const ANY_TAG = /<[^>]*>/gu;

/**
 * Removes tags (including tags that were entity-escaped, as Greenhouse's
 * `content` field escapes its own markup), decodes entities, and collapses
 * whitespace to single spaces.
 */
export function stripHtml(value: string): string {
  const decoded = decodeHtmlEntities(value);
  const withoutCode = decoded.replace(SCRIPT_OR_STYLE, ' ');
  const withoutTags = withoutCode.replace(ANY_TAG, ' ');
  return collapseWhitespace(decodeHtmlEntities(withoutTags));
}

const BULLET_MARKER = /<li\b[^>]*>/giu;
const LINE_BREAK = /<br\s*\/?>/giu;
const BLOCK_END =
  /<\/(?:p|div|li|ul|ol|dl|dd|dt|h[1-6]|tr|td|th|section|article|blockquote)\s*>/giu;

/**
 * Converts provider HTML into plain lines so bullet structure survives. Used
 * for requirement extraction, where `stripHtml`'s whitespace collapsing would
 * destroy the list shape.
 */
export function htmlToLines(value: string): string[] {
  const decoded = decodeHtmlEntities(value)
    .replace(SCRIPT_OR_STYLE, ' ')
    .replace(BULLET_MARKER, '\n- ')
    .replace(LINE_BREAK, '\n')
    .replace(BLOCK_END, '\n')
    .replace(ANY_TAG, ' ');
  const lines: string[] = [];
  for (const line of decoded.split('\n')) {
    const cleaned = collapseWhitespace(line);
    if (cleaned !== '') lines.push(cleaned);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const NEGATED_REMOTE =
  /\b(?:not|no|non)[-\s]+(?:a\s+|an\s+|the\s+)?remote\b|\bremote\s+(?:is\s+)?not\s+(?:available|offered|possible|an option)\b/iu;
const HYBRID_TOKENS = [
  /\bhybrid\b/iu,
  /\bpartially\s+remote\b/iu,
  /\bremote\s+\d+\s+days?\b/iu,
  /\b\d+\s+days?\s+(?:per\s+week\s+)?(?:in|at)\s+(?:the\s+)?office\b/iu,
];
const REMOTE_TOKENS = [
  /\bremote[-\s]?first\b/iu,
  /\bfully\s+remote\b/iu,
  /\b\d{2,3}%\s*remote\b/iu,
  /\bremote\b/iu,
  /\bwork\s+from\s+home\b/iu,
  /\bwfh\b/iu,
  /\btelecommut\w*/iu,
  /\bwork\s+from\s+anywhere\b/iu,
  /\banywhere\b/iu,
];
const ONSITE_TOKENS = [
  /\bon[-\s_]?site\b/iu,
  /\bin[-\s_]?office\b/iu,
  /\bin\s+the\s+office\b/iu,
  /\boffice[-\s_]based\b/iu,
  /\bon[-\s_]?premises?\b/iu,
];

/**
 * Explicit tokens only. A country or city name is never treated as evidence of
 * on-site work, and a posting that says nothing stays `unspecified`.
 */
export function detectRemoteState(text: string): JobRemoteState {
  if (NEGATED_REMOTE.test(text)) return 'onsite';
  if (HYBRID_TOKENS.some((pattern) => pattern.test(text))) return 'hybrid';
  if (REMOTE_TOKENS.some((pattern) => pattern.test(text))) return 'remote';
  if (ONSITE_TOKENS.some((pattern) => pattern.test(text))) return 'onsite';
  return 'unspecified';
}

const EMPLOYMENT_TOKENS: readonly (readonly [EmploymentType, RegExp])[] = [
  ['internship', /\bintern(?:ship|s)?\b/iu],
  ['part_time', /\bpart[-\s_]?time\b/iu],
  ['contract', /\bcontract(?:or|ing|ual)?\b|\bfixed[-\s_]term\b/iu],
  ['freelance', /\bfreelanc(?:e|er|ing)\b/iu],
  ['temporary', /\btemporar(?:y|ily)\b|\bseasonal\b|\binterim\b/iu],
  ['volunteer', /\bvolunteer(?:ing)?\b/iu],
  ['full_time', /\bfull[-\s_]?time\b/iu],
];

/**
 * Explicit tokens only, defaulting to `full_time` (the enum's own default) when
 * the text is silent.
 */
export function detectEmploymentType(text: string): EmploymentType {
  for (const [type, pattern] of EMPLOYMENT_TOKENS) {
    if (pattern.test(text)) return type;
  }
  return 'full_time';
}

interface SeniorityToken {
  readonly level: JobSeniority;
  readonly pattern: RegExp;
}

/** Ordered strongest-first: the first matching token wins. */
const SENIORITY_TOKENS: readonly SeniorityToken[] = [
  { level: 'internship', pattern: /\bintern(?:ship|s)?\b/iu },
  {
    level: 'executive',
    pattern:
      /\bchief\b|\b(?:ceo|cto|cfo|coo|cmo|cpo|cio|cro|chro)\b|\bvice[-\s]?president\b|\b(?:svp|evp|vp)\b|\bpresident\b/iu,
  },
  { level: 'director', pattern: /\bdirector\b|\bhead\s+of\b/iu },
  { level: 'manager', pattern: /\bmanager\b|\bsupervisor\b|\bmanagement\b/iu },
  { level: 'principal', pattern: /\bprincipal\b|\bstaff\b|\bdistinguished\b/iu },
  { level: 'lead', pattern: /\blead\b|\bleader\b|\bteam\s+lead\b|\btech\s+lead\b/iu },
  { level: 'senior', pattern: /\bsenior\b|\bsr\.?\b|\bsnr\b/iu },
  { level: 'mid', pattern: /\bmid[-\s_]?(?:level|senior)\b|\bintermediate\b|\bmid\b/iu },
  { level: 'junior', pattern: /\bjunior\b|\bjr\.?\b|\bassociate\b/iu },
  {
    level: 'entry',
    pattern: /\bentry[-\s_]?level\b|\bentry\b|\bgraduate\b|\btrainee\b|\bapprentice\b/iu,
  },
];

/**
 * A description may only place a *silent* title at or below the junior band.
 * That is what stops "we mentor interns" or "you will work with senior
 * engineers" from rewriting a plain "Software Engineer" title.
 */
const DESCRIPTION_SENIORITY_TOKENS: readonly SeniorityToken[] = [
  { level: 'internship', pattern: /\binternship\b/iu },
  { level: 'junior', pattern: /\bjunior\b|\bjr\.?\b/iu },
  { level: 'entry', pattern: /\bentry[-\s_]?level\b/iu },
];

function firstMatchingLevel(text: string, tokens: readonly SeniorityToken[]): JobSeniority | null {
  for (const token of tokens) {
    if (token.pattern.test(text)) return token.level;
  }
  return null;
}

/**
 * Title tokens win outright. A title with no level token stays `unspecified`
 * unless the description states an explicitly *lower* band; a title is never
 * upgraded.
 */
export function detectSeniority(title: string, description = ''): JobSeniority {
  const fromTitle = firstMatchingLevel(title, SENIORITY_TOKENS);
  if (fromTitle !== null) return fromTitle;
  return firstMatchingLevel(description, DESCRIPTION_SENIORITY_TOKENS) ?? 'unspecified';
}

// ---------------------------------------------------------------------------
// Salary
// ---------------------------------------------------------------------------

export interface ParsedSalary {
  minMinor: number | null;
  maxMinor: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
  isEstimate: boolean;
}

const NO_SALARY: ParsedSalary = {
  minMinor: null,
  maxMinor: null,
  currency: null,
  period: null,
  isEstimate: false,
};

/**
 * Currency tokens, most specific first. Symbols that several currencies share
 * (`$`, `¥`) are resolved by the explicit code when one is present, and fall
 * back to the dominant currency otherwise.
 */
const CURRENCY_TOKENS: readonly (readonly [string, RegExp])[] = [
  ['PHP', /₱|\bphp\b|\bpesos?\b/iu],
  ['SGD', /s\$|\bsgd\b/iu],
  ['AUD', /a\$|\baud\b/iu],
  ['HKD', /hk\$|\bhkd\b/iu],
  ['NZD', /nz\$|\bnzd\b/iu],
  ['CAD', /c\$|\bcad\b/iu],
  ['MYR', /\bmyr\b|\brm\s?\d/iu],
  ['IDR', /\bidr\b|\brp\s?\d/iu],
  ['THB', /฿|\bthb\b|\bbht\b/iu],
  ['VND', /₫|\bvnd\b/iu],
  ['INR', /₹|\binr\b|\brupees?\b/iu],
  ['GBP', /£|\bgbp\b/iu],
  ['EUR', /€|\beur\b|\beuros?\b/iu],
  ['JPY', /¥|\bjpy\b|\byen\b/iu],
  ['KRW', /₩|\bkrw\b/iu],
  ['AED', /\baed\b|\bdhs\b/iu],
  ['CNY', /\bcny\b|\brmb\b/iu],
  ['USD', /\$|\busd\b|\bdollars?\b/iu],
];

/** Currencies whose minor unit is the unit itself. */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK']);

const PERIOD_TOKENS: readonly (readonly [SalaryPeriod, RegExp])[] = [
  ['hourly', /\bper\s+hour\b|\/\s*hours?\b|\bhourly\b|\ban\s+hour\b|\bper\s+hr\b/iu],
  ['daily', /\bper\s+day\b|\/\s*days?\b|\bdaily\b|\bper\s+diem\b/iu],
  ['monthly', /\bper\s+month\b|\/\s*months?\b|\bmonthly\b|\bper\s+mo\b/iu],
  [
    'annual',
    /\bper\s+year\b|\/\s*years?\b|\bannually\b|\bannual\b|\bper\s+annum\b|\bp\.a\.\b|\bper\s+yr\b|\byearly\b/iu,
  ],
];

const AMOUNT_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*([kK])?/gu;
const AMOUNT_EXCLUSION = /^\s*(?:%|percent\b|years?\b|yrs?\b)/iu;
const RANGE_CHARACTER = /[\d,.\s\-–—+]/u;
const MAX_AMOUNTS = 2;

interface SalaryAmount {
  readonly value: number;
  readonly abbreviated: boolean;
}

function findCurrency(
  text: string,
  defaultCurrency?: string,
): { code: string; index: number } | null {
  for (const [code, pattern] of CURRENCY_TOKENS) {
    const match = pattern.exec(text);
    if (match !== null) return { code, index: match.index };
  }
  const fallback = toCurrencyCode(defaultCurrency);
  return fallback === null ? null : { code: fallback, index: 0 };
}

function salaryWindow(text: string, anchor: number): string {
  let start = anchor;
  let steps = 0;
  while (start > 0 && steps < 48 && RANGE_CHARACTER.test(text.charAt(start - 1))) {
    start -= 1;
    steps += 1;
  }
  return text.slice(start, Math.min(text.length, anchor + 80));
}

function collectAmounts(segment: string): SalaryAmount[] {
  const pattern = new RegExp(AMOUNT_PATTERN.source, 'gu');
  const amounts: SalaryAmount[] = [];
  let match = pattern.exec(segment);
  while (match !== null) {
    const raw = match[1] ?? '';
    const suffix = match[2] ?? '';
    const end = match.index + match[0].length;
    if (!AMOUNT_EXCLUSION.test(segment.slice(end, end + 12))) {
      const digits = raw.replace(/,/gu, '');
      const digitsOnly = digits.replace(/\./gu, '');
      const value = Number(digits) * (suffix === '' ? 1 : 1_000);
      const plausible = digitsOnly.length >= 3 || suffix !== '';
      if (plausible && Number.isFinite(value) && value > 0) {
        amounts.push({ value, abbreviated: suffix !== '' });
        if (amounts.length > MAX_AMOUNTS) return amounts;
      }
    }
    match = pattern.exec(segment);
  }
  return amounts;
}

function detectSalaryPeriod(text: string): SalaryPeriod | null {
  for (const [period, pattern] of PERIOD_TOKENS) {
    if (pattern.test(text)) return period;
  }
  return null;
}

/**
 * Parses only what the text states unambiguously.
 *
 * A range that reads as `min - max` (with an optional `k` suffix) and a single
 * explicit amount are both accepted. Anything else — more than two amounts in
 * one window, an inverted range, an amount with no currency anywhere — yields
 * all-null fields rather than a guess. `isEstimate` is true when the value came
 * from a range or from an abbreviated (`60k`) form.
 */
export function parseSalary(text: string, defaultCurrency?: string): ParsedSalary {
  const source = collapseWhitespace(text);
  if (source === '') return NO_SALARY;

  const currency = findCurrency(source, defaultCurrency);
  if (currency === null) return NO_SALARY;

  const segment = salaryWindow(source, currency.index);
  const amounts = collectAmounts(segment);
  if (amounts.length === 0 || amounts.length > MAX_AMOUNTS) return NO_SALARY;

  const first = amounts[0];
  if (first === undefined) return NO_SALARY;
  const second = amounts[1];

  const factor = ZERO_DECIMAL_CURRENCIES.has(currency.code) ? 1 : 100;
  const minMinor = Math.round(first.value * factor);
  const maxMinor = second === undefined ? null : Math.round(second.value * factor);
  // An inverted range is a contradiction, not a salary: report nothing.
  if (maxMinor !== null && maxMinor < minMinor) return NO_SALARY;

  if (minMinor <= 0 || minMinor > 2_000_000_000) return NO_SALARY;
  if (maxMinor !== null && maxMinor > 2_000_000_000) return NO_SALARY;

  const isEstimate =
    amounts.length > 1 || first.abbreviated || amounts.some((amount) => amount.abbreviated);
  return {
    minMinor,
    maxMinor,
    currency: currency.code,
    period: detectSalaryPeriod(segment) ?? detectSalaryPeriod(source),
    isEstimate,
  };
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export interface ParsedLocation {
  locationRaw: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
}

const REMOTE_LOCATION_MARKERS = [
  /\bremote\b/iu,
  /\banywhere\b/iu,
  /\bworldwide\b/iu,
  /\bwork\s+from\s+home\b/iu,
  /\bwfh\b/iu,
  /\btelecommut\w*/iu,
  /\bglobal\b/iu,
  /\bdistributed\s+team\b/iu,
  /\bhybrid\b/iu,
  /\bon[-\s]?site\b/iu,
  /\bmultiple\s+locations\b/iu,
];

const WORLDWIDE_PATTERN = /\bworldwide\b|\banywhere\b|\bglobally?\b|\binternational\b/iu;

/** True when the text names a work arrangement instead of a place. */
export function isRemoteMarkerLocation(text: string): boolean {
  return REMOTE_LOCATION_MARKERS.some((pattern) => pattern.test(text));
}

const PHILIPPINE_CITIES: readonly (readonly [string, string])[] = [
  ['quezon city', 'Quezon City'],
  ['cagayan de oro', 'Cagayan de Oro'],
  ['general santos', 'General Santos'],
  ['zamboanga city', 'Zamboanga City'],
  ['puerto princesa', 'Puerto Princesa'],
  ['cotabato city', 'Cotabato City'],
  ['trece martires', 'Trece Martires'],
  ['santa rosa', 'Santa Rosa'],
  ['batangas city', 'Batangas City'],
  ['san fernando', 'San Fernando'],
  ['lapu-lapu', 'Lapu-Lapu'],
  ['las pinas', 'Las Piñas'],
  ['las piñas', 'Las Piñas'],
  ['paranaque', 'Parañaque'],
  ['parañaque', 'Parañaque'],
  ['dasmariñas', 'Dasmariñas'],
  ['dasmarinas', 'Dasmariñas'],
  ['cebu city', 'Cebu City'],
  ['tagbilaran', 'Tagbilaran'],
  ['dumaguete', 'Dumaguete'],
  ['tuguegarao', 'Tuguegarao'],
  ['cabanatuan', 'Cabanatuan'],
  ['meycauayan', 'Meycauayan'],
  ['caloocan', 'Caloocan'],
  ['mandaluyong', 'Mandaluyong'],
  ['marikina', 'Marikina'],
  ['muntinlupa', 'Muntinlupa'],
  ['valenzuela', 'Valenzuela'],
  ['tagaytay', 'Tagaytay'],
  ['antipolo', 'Antipolo'],
  ['mabalacat', 'Mabalacat'],
  ['olongapo', 'Olongapo'],
  ['malolos', 'Malolos'],
  ['dagupan', 'Dagupan'],
  ['legazpi', 'Legazpi'],
  ['sorsogon', 'Sorsogon'],
  ['tacloban', 'Tacloban'],
  ['tagum', 'Tagum'],
  ['digos', 'Digos'],
  ['iligan', 'Iligan'],
  ['butuan', 'Butuan'],
  ['koronadal', 'Koronadal'],
  ['surigao', 'Surigao'],
  ['ozamiz', 'Ozamiz'],
  ['marawi', 'Marawi'],
  ['bacolod', 'Bacolod'],
  ['iloilo', 'Iloilo'],
  ['kalibo', 'Kalibo'],
  ['mandaue', 'Mandaue'],
  ['talisay', 'Talisay'],
  ['ormoc', 'Ormoc'],
  ['manila', 'Manila'],
  ['makati', 'Makati'],
  ['pasay', 'Pasay'],
  ['pasig', 'Pasig'],
  ['taguig', 'Taguig'],
  ['malabon', 'Malabon'],
  ['navotas', 'Navotas'],
  ['pateros', 'Pateros'],
  ['marikina', 'Marikina'],
  ['bacoor', 'Bacoor'],
  ['imus', 'Imus'],
  ['cainta', 'Cainta'],
  ['taytay', 'Taytay'],
  ['calamba', 'Calamba'],
  ['lucena', 'Lucena'],
  ['angeles', 'Angeles'],
  ['subic', 'Subic'],
  ['baliuag', 'Baliuag'],
  ['balanga', 'Balanga'],
  ['vigan', 'Vigan'],
  ['laoag', 'Laoag'],
  ['baguio', 'Baguio'],
  ['naga', 'Naga'],
  ['cebu', 'Cebu'],
  ['davao', 'Davao'],
];

const PHILIPPINE_REGIONS: readonly (readonly [string, string])[] = [
  ['national capital region', 'Metro Manila'],
  ['cordillera administrative region', 'Cordillera Administrative Region'],
  ['zamboanga peninsula', 'Zamboanga Peninsula'],
  ['northern mindanao', 'Northern Mindanao'],
  ['soccsksargen', 'Soccsksargen'],
  ['metro manila', 'Metro Manila'],
  ['ilocos region', 'Ilocos Region'],
  ['cagayan valley', 'Cagayan Valley'],
  ['central luzon', 'Central Luzon'],
  ['western visayas', 'Western Visayas'],
  ['central visayas', 'Central Visayas'],
  ['eastern visayas', 'Eastern Visayas'],
  ['davao region', 'Davao Region'],
  ['bicol region', 'Bicol Region'],
  ['calabarzon', 'Calabarzon'],
  ['mimaropa', 'Mimaropa'],
  ['bangsamoro', 'Bangsamoro'],
  ['cordillera', 'Cordillera Administrative Region'],
  ['caraga', 'Caraga'],
  ['barmm', 'Bangsamoro'],
  ['bicol', 'Bicol Region'],
  ['ncr', 'Metro Manila'],
];

const COUNTRY_NAMES: readonly (readonly [string, string])[] = [
  ['united states of america', 'US'],
  ['united arab emirates', 'AE'],
  ['united kingdom', 'GB'],
  ['united states', 'US'],
  ['saudi arabia', 'SA'],
  ['south africa', 'ZA'],
  ['new zealand', 'NZ'],
  ['south korea', 'KR'],
  ['north korea', 'KP'],
  ['sri lanka', 'LK'],
  ['switzerland', 'CH'],
  ['netherlands', 'NL'],
  ['philippines', 'PH'],
  ['great britain', 'GB'],
  ['hong kong', 'HK'],
  ['bangladesh', 'BD'],
  ['cambodia', 'KH'],
  ['colombia', 'CO'],
  ['indonesia', 'ID'],
  ['argentina', 'AR'],
  ['australia', 'AU'],
  ['singapore', 'SG'],
  ['thailand', 'TH'],
  ['vietnam', 'VN'],
  ['viet nam', 'VN'],
  ['türkiye', 'TR'],
  ['germany', 'DE'],
  ['deutschland', 'DE'],
  ['england', 'GB'],
  ['scotland', 'GB'],
  ['wales', 'GB'],
  ['ireland', 'IE'],
  ['portugal', 'PT'],
  ['pakistan', 'PK'],
  ['malaysia', 'MY'],
  ['myanmar', 'MM'],
  ['taiwan', 'TW'],
  ['denmark', 'DK'],
  ['finland', 'FI'],
  ['norway', 'NO'],
  ['sweden', 'SE'],
  ['belgium', 'BE'],
  ['austria', 'AT'],
  ['israel', 'IL'],
  ['ukraine', 'UA'],
  ['romania', 'RO'],
  ['hungary', 'HU'],
  ['greece', 'GR'],
  ['bulgaria', 'BG'],
  ['croatia', 'HR'],
  ['estonia', 'EE'],
  ['latvia', 'LV'],
  ['lithuania', 'LT'],
  ['slovakia', 'SK'],
  ['slovenia', 'SI'],
  ['czech republic', 'CZ'],
  ['czechia', 'CZ'],
  ['brunei', 'BN'],
  ['mexico', 'MX'],
  ['brazil', 'BR'],
  ['canada', 'CA'],
  ['france', 'FR'],
  ['spain', 'ES'],
  ['italy', 'IT'],
  ['poland', 'PL'],
  ['japan', 'JP'],
  ['china', 'CN'],
  ['india', 'IN'],
  ['egypt', 'EG'],
  ['kenya', 'KE'],
  ['nigeria', 'NG'],
  ['qatar', 'QA'],
  ['turkey', 'TR'],
  ['peru', 'PE'],
  ['chile', 'CL'],
  ['nepal', 'NP'],
  ['russia', 'RU'],
  ['usa', 'US'],
  ['uae', 'AE'],
];

/**
 * Two-letter codes are only honoured when written in uppercase (or as one of
 * the unambiguous lowercase forms below). `in`, `no`, `it`, `at`, `my`, and
 * friends are ordinary English words, so they are never read as countries.
 */
const UPPERCASE_COUNTRY_CODES = new Set([
  'AE',
  'AR',
  'AU',
  'BD',
  'BG',
  'BN',
  'BR',
  'CA',
  'CH',
  'CL',
  'CN',
  'CO',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EG',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HK',
  'HR',
  'HU',
  'ID',
  'IE',
  'IL',
  'IS',
  'JP',
  'KE',
  'KH',
  'KR',
  'LK',
  'LT',
  'LV',
  'MM',
  'MX',
  'MY',
  'NG',
  'NL',
  'NP',
  'NZ',
  'PE',
  'PH',
  'PK',
  'PL',
  'PT',
  'QA',
  'RO',
  'RS',
  'RU',
  'SA',
  'SE',
  'SG',
  'SI',
  'SK',
  'TH',
  'TR',
  'TW',
  'UA',
  'UK',
  'US',
  'VN',
  'ZA',
]);

const UPPERCASE_CODE_PATTERN = /(?:^|[^A-Za-z0-9])([A-Z]{2})(?=$|[^A-Za-z0-9])/gu;
const LOWERCASE_COUNTRY_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bph\b/iu, 'PH'],
  [/\buk\b/iu, 'GB'],
  [/\buae\b/iu, 'AE'],
  [/\busa\b/iu, 'US'],
];

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function phrasePattern(phrase: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${escapeForRegExp(phrase)}(?=$|[^a-z0-9])`, 'u');
}

const CITY_PATTERNS = [...PHILIPPINE_CITIES]
  .sort((left, right) => right[0].length - left[0].length)
  .map(([name, canonical]) => ({ pattern: phrasePattern(name), name, canonical }));
const REGION_PATTERNS = [...PHILIPPINE_REGIONS]
  .sort((left, right) => right[0].length - left[0].length)
  .map(([name, canonical]) => ({ pattern: phrasePattern(name), name, canonical }));
const COUNTRY_PATTERNS = [...COUNTRY_NAMES]
  .sort((left, right) => right[0].length - left[0].length)
  .map(([name, canonical]) => ({ pattern: phrasePattern(name), name, canonical }));

function firstPlace(
  haystack: string,
  entries: readonly { pattern: RegExp; canonical: string }[],
): string | null {
  for (const entry of entries) {
    if (entry.pattern.test(haystack)) return entry.canonical;
  }
  return null;
}

/**
 * Removes region phrases before city matching, so "Metro Manila" is read as the
 * region it is instead of yielding the city "Manila".
 */
function maskRegions(haystack: string): string {
  let masked = haystack;
  for (const entry of REGION_PATTERNS) {
    masked = masked.replace(new RegExp(entry.pattern.source, 'gu'), ' ');
  }
  return masked;
}

function findCountryCode(text: string, haystack: string): string | null {
  const named = firstPlace(haystack, COUNTRY_PATTERNS);
  if (named !== null) return named;
  for (const [pattern, code] of LOWERCASE_COUNTRY_WORDS) {
    if (pattern.test(text)) return code;
  }
  const uppercase = new RegExp(UPPERCASE_CODE_PATTERN.source, 'gu');
  let match = uppercase.exec(text);
  while (match !== null) {
    const candidate = match[1] ?? '';
    if (UPPERCASE_COUNTRY_CODES.has(candidate)) return candidate;
    match = uppercase.exec(text);
  }
  return null;
}

/**
 * Recognises Philippine cities and regions, the country names in
 * `COUNTRY_NAMES`, uppercase ISO codes, and the common remote markers. City and
 * region are returned in canonical casing; an unknown place stays `null`
 * instead of being promoted from surrounding words.
 */
export function parseLocation(text: string): ParsedLocation {
  const locationRaw = truncateText(
    collapseWhitespace(decodeHtmlEntities(text)),
    MAX_LOCATION_LENGTH,
  );
  if (locationRaw === '') {
    return { locationRaw: null, city: null, region: null, countryCode: null };
  }

  const haystack = locationRaw.toLowerCase();
  const city = firstPlace(maskRegions(haystack), CITY_PATTERNS);
  const region = firstPlace(haystack, REGION_PATTERNS);
  let countryCode = findCountryCode(locationRaw, haystack);
  if (countryCode === null && (city !== null || region !== null)) countryCode = 'PH';

  return { locationRaw, city, region, countryCode };
}

/**
 * `public.jobs.is_international`. A stated country decides; otherwise only an
 * explicit worldwide/anywhere marker on a remote posting counts, because a
 * silent location is unknown rather than foreign.
 */
export function deriveIsInternational(input: {
  readonly countryCode: string | null;
  readonly remoteState: JobRemoteState;
  readonly locationRaw: string | null;
}): boolean {
  if (input.countryCode === 'PH') return false;
  if (input.countryCode !== null) return true;
  if (input.remoteState !== 'remote') return false;
  return input.locationRaw !== null && WORLDWIDE_PATTERN.test(input.locationRaw);
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * Canonical skill names. Drawn from the `knownTools` lexicon in
 * `services/api/src/career-extraction.ts` and extended with the tooling this
 * product's sources mention most often. Matching is whole-word and
 * case-insensitive; the canonical casing is what gets stored.
 */
export const SKILL_LEXICON: readonly string[] = [
  'n8n',
  'Zapier',
  'Make.com',
  'Power Automate',
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'C#',
  'Go',
  'Rust',
  'PHP',
  'Ruby',
  'SQL',
  'PostgreSQL',
  'MySQL',
  'SQL Server',
  'Supabase',
  'Firebase',
  'MongoDB',
  'Redis',
  'React',
  'React Native',
  'Next.js',
  'Node.js',
  'Vue',
  'Angular',
  'Django',
  'Laravel',
  'Docker',
  'Kubernetes',
  'Terraform',
  'AWS',
  'Azure',
  'Google Cloud',
  'Git',
  'GitHub',
  'GitHub Actions',
  'GitLab',
  'Bitbucket',
  'Jenkins',
  'CircleCI',
  'Excel',
  'Google Sheets',
  'Tableau',
  'Power BI',
  'Looker',
  'Salesforce',
  'HubSpot',
  'Zendesk',
  'Intercom',
  'Jira',
  'Confluence',
  'Notion',
  'Airtable',
  'Figma',
  'Photoshop',
  'Canva',
  'QuickBooks',
  'Xero',
  'SAP',
  'NetSuite',
  'Shopify',
  'WordPress',
  'Webflow',
  'GraphQL',
  'REST APIs',
  'Tailwind CSS',
  'Kotlin',
  'Swift',
  'Flutter',
  'Express',
  'Fastify',
  'NestJS',
  'Oracle',
  'Snowflake',
  'BigQuery',
  'Airflow',
  'dbt',
  'pandas',
  'NumPy',
  'PyTorch',
  'TensorFlow',
  'Selenium',
  'Cypress',
  'Playwright',
  'Jest',
  'Vitest',
  'Linux',
  'Bash',
  'PowerShell',
];

const SKILL_PATTERNS = SKILL_LEXICON.map((name) => ({
  name,
  pattern: new RegExp(`(^|[^\\w.+#])${escapeForRegExp(name)}([^\\w.+#]|$)`, 'iu'),
}));

/**
 * Whole-word matches against `SKILL_LEXICON`, returned in canonical casing and
 * lexicon order (deterministic for the same text).
 */
export function extractSkills(text: string): string[] {
  const skills: string[] = [];
  for (const entry of SKILL_PATTERNS) {
    if (skills.length >= MAX_SKILLS) break;
    if (entry.pattern.test(text)) skills.push(entry.name);
  }
  return skills;
}

// ---------------------------------------------------------------------------
// Requirement bullets
// ---------------------------------------------------------------------------

export interface RequirementBullets {
  requirements: string[];
  preferredQualifications: string[];
}

const MAX_REQUIREMENTS = 30;
const MAX_PREFERRED = 20;
const MAX_BULLET_LENGTH = 500;
const MIN_BULLET_LENGTH = 3;

const REQUIREMENT_HEADING =
  /^(?:key\s+|minimum\s+|basic\s+)?(?:requirements?|qualifications?|required\s+(?:skills|experience|qualifications)|what\s+(?:we(?:'re|\s+are)\s+looking\s+for|you(?:'ll|\s+will)\s+(?:need|bring))|who\s+you\s+are|must[-\s]?haves?)\b/iu;
const PREFERRED_HEADING =
  /^(?:nice[-\s]to[-\s]haves?|preferred(?:\s+(?:qualifications?|skills|experience))?|bonus(?:\s+points?)?|plus(?:es)?|good[-\s]to[-\s]have|desirable|advantageous|added\s+advantage|an?\s+advantage)\b/iu;
const NEUTRAL_HEADING =
  /^(?:responsibilities|duties|what\s+you(?:'ll|\s+will)\s+do|the\s+role|about\s+the\s+role|role\s+overview|day[-\s]to[-\s]day|benefits?|perks?|about\s+(?:us|the\s+company|you)|why\s+join(?:\s+us)?|compensation(?:\s+and\s+benefits)?|how\s+to\s+apply|application\s+process|equal\s+opportunity)\b/iu;
const BULLET_MARKER_PATTERN = /^\s*(?:[-*•·◦▪‣]|\d{1,2}[.)]|[a-z][.)])\s+/iu;

type BulletSection = 'requirements' | 'preferred' | 'neutral';

/**
 * Splits a description into requirement and preferred-qualification bullets.
 *
 * Bullets under a Requirements/Qualifications heading become requirements;
 * bullets under Nice to have/Preferred/Bonus become preferred qualifications;
 * bullets under a responsibilities heading are dropped, because a duty is not
 * a requirement. Before any heading, bullets are treated as requirements.
 * Entries are capped at 30 / 20 items of 500 characters.
 */
export function splitRequirementBullets(text: string): RequirementBullets {
  const requirements: string[] = [];
  const preferred: string[] = [];
  let section: BulletSection | null = null;
  let open: { text: string; section: BulletSection } | null = null;

  const commit = (): void => {
    if (open === null) return;
    const cleaned = truncateText(collapseWhitespace(open.text), MAX_BULLET_LENGTH);
    const target = open.section;
    open = null;
    if (cleaned.length < MIN_BULLET_LENGTH) return;
    if (target === 'preferred') preferred.push(cleaned);
    else requirements.push(cleaned);
  };

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = collapseWhitespace(rawLine);
    if (line === '') {
      commit();
      continue;
    }
    if (REQUIREMENT_HEADING.test(line)) {
      commit();
      section = 'requirements';
      continue;
    }
    if (PREFERRED_HEADING.test(line)) {
      commit();
      section = 'preferred';
      continue;
    }
    if (NEUTRAL_HEADING.test(line)) {
      commit();
      section = 'neutral';
      continue;
    }
    const marker = BULLET_MARKER_PATTERN.exec(line);
    if (marker !== null) {
      commit();
      if (section === 'neutral') continue;
      open = { text: line.slice(marker[0].length), section: section ?? 'requirements' };
      continue;
    }
    if (open !== null) open.text = `${open.text} ${line}`;
  }
  commit();

  return {
    requirements: toBoundedStringArray(requirements, MAX_REQUIREMENTS, MAX_BULLET_LENGTH),
    preferredQualifications: toBoundedStringArray(preferred, MAX_PREFERRED, MAX_BULLET_LENGTH),
  };
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

export interface ExperienceRange {
  min: number | null;
  max: number | null;
}

const EXPERIENCE_RANGE_PATTERN =
  /(\d{1,2}(?:\.\d)?)\s*(?:-|–|—|\bto\b)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b/iu;
const EXPERIENCE_MINIMUM_PATTERN = /(\d{1,2}(?:\.\d)?)\s*\+\s*(?:years?|yrs?)\b/iu;

/**
 * Reads only explicit `N+ years` / `N-M years` phrasing. "5 years of
 * experience" and "several years" are left alone on purpose: they are not a
 * stated requirement, and inferring one would put words in the employer's
 * mouth.
 */
export function deriveSeniorityFromExperience(text: string): ExperienceRange {
  const range = EXPERIENCE_RANGE_PATTERN.exec(text);
  if (range !== null) {
    const min = boundedYearsOrNull(Number(range[1]));
    const max = boundedYearsOrNull(Number(range[2]));
    if (min === null || max === null || max < min) return { min: null, max: null };
    return { min, max };
  }
  const minimum = EXPERIENCE_MINIMUM_PATTERN.exec(text);
  if (minimum !== null) {
    const min = boundedYearsOrNull(Number(minimum[1]));
    if (min !== null) return { min, max: null };
  }
  return { min: null, max: null };
}

// ---------------------------------------------------------------------------
// SQL mirrors
// ---------------------------------------------------------------------------

/**
 * Mirrors `app_private.normalize_company_name`. PostgreSQL strips one trailing
 * legal suffix per `regexp_replace` pass, and this mirror repeats the pass so a
 * name that carries several (`Meridian Support Philippines Inc`) reduces to the
 * same core the SQL contract expects: `meridian support`.
 */
const COMPANY_SUFFIX_PATTERN =
  /\s*[,.]?\s*\b(?:inc|incorporated|corp|corporation|co|company|llc|ltd|limited|plc|gmbh|bv|nv|pte|pvt|sdn bhd|bhd|philippines|ph)\b\.?\s*$/u;
const COMPANY_DISALLOWED_PATTERN = /[^a-z0-9]+/gu;

export function normalizeCompanyName(name: string): string {
  let value = name.trim().toLowerCase();
  let passes = 0;
  while (passes < 8 && COMPANY_SUFFIX_PATTERN.test(value)) {
    value = value.replace(COMPANY_SUFFIX_PATTERN, '');
    passes += 1;
  }
  return value.replace(COMPANY_DISALLOWED_PATTERN, ' ').trim();
}

/**
 * Mirrors `app_private.normalize_job_title`: parenthesised noise is dropped,
 * then every character outside `[a-z0-9+#.]` becomes a space. The trailing trim
 * is deliberate — the SQL inserts a literal space where the parentheses were,
 * and no consumer wants `'senior engineer '`.
 */
const TITLE_PARENTHETICAL_PATTERN = /\s*[([{][^)\]}]*[)\]}]\s*/gu;
const TITLE_DISALLOWED_PATTERN = /[^a-z0-9+#.]+/gu;

export function normalizeTitle(title: string): string {
  const withoutParentheticals = title
    .trim()
    .toLowerCase()
    .replace(TITLE_PARENTHETICAL_PATTERN, ' ');
  return withoutParentheticals.replace(TITLE_DISALLOWED_PATTERN, ' ').trim();
}

/**
 * Mirrors the location component of `app_private.job_dedup_key`: lowercase,
 * non-alphanumerics collapsed to `-`, truncated to 80 characters. An absent
 * location becomes `unspecified`, exactly as the SQL `coalesce` does.
 */
export function normalizeLocationBucket(location: string | null | undefined): string {
  const value = collapseWhitespace(location ?? '');
  if (value === '') return 'unspecified';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 80);
}

/** Mirrors `app_private.job_dedup_key(title, company, location)`. */
export function jobDedupKey(
  title: string,
  companyName: string,
  location: string | null | undefined,
): string {
  return `${normalizeTitle(title)}@${normalizeCompanyName(companyName)}@${normalizeLocationBucket(location)}`;
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

/** Characters of the normalized description folded into the fingerprint. */
export const DESCRIPTION_FINGERPRINT_PREFIX = 1_200;

function canonicalValue(value: unknown, depth: number, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'undefined':
      return 'null';
    default:
      break;
  }
  if (typeof value !== 'object') return 'null';
  if (depth >= 32 || seen.has(value)) return 'null';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value as unknown[];
      return `[${items.map((item) => canonicalValue(item, depth + 1, seen)).join(',')}]`;
    }
    const source = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalValue(item, depth + 1, seen)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * Deterministic JSON with sorted object keys, so two payloads that differ only
 * in key order hash identically.
 */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, 0, new Set<object>());
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** SHA-256 of a stored raw payload, matching `payload_checksum ~ '^[a-f0-9]{64}$'`. */
export function payloadChecksum(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

export interface FingerprintInput {
  readonly title: string;
  readonly companyName: string;
  readonly locationRaw?: string | null;
  readonly description: string;
}

/** Normalized description prefix used inside the fingerprint. */
export function normalizeDescriptionPrefix(description: string, maximum: number): string {
  return truncateText(collapseWhitespace(stripHtml(description)).toLowerCase(), maximum);
}

/**
 * The `public.jobs.content_fingerprint` value: SHA-256 over the normalized
 * title, company, location bucket, and the first 1200 characters of the
 * normalized description. Independent of key order and of call count.
 */
export function stableFingerprint(input: FingerprintInput): string {
  return sha256Hex(
    canonicalJson({
      title: normalizeTitle(input.title),
      company: normalizeCompanyName(input.companyName),
      location: normalizeLocationBucket(input.locationRaw ?? null),
      description: normalizeDescriptionPrefix(input.description, DESCRIPTION_FINGERPRINT_PREFIX),
    }),
  );
}

// ---------------------------------------------------------------------------
// Canonical input assembly
// ---------------------------------------------------------------------------

export interface JobSalaryFields {
  readonly minMinor: number | null;
  readonly maxMinor: number | null;
  readonly currency: string | null;
  readonly period: SalaryPeriod | null;
  readonly isEstimate: boolean;
}

/**
 * Everything an adapter knows about one posting. Adapters fill in what the
 * provider states and leave the rest undefined; `buildJobInput` decides the
 * canonical spelling and refuses the posting when it cannot be represented.
 */
export interface JobInputDraft {
  readonly sourceJobId: string;
  readonly sourceUrl: string;
  readonly applyUrl?: string | null;
  readonly title: string;
  readonly companyName: string;
  readonly companyDomain?: string | null;
  readonly companyCountryCode?: string | null;
  readonly description: string;
  /** Line-preserving text (see `htmlToLines`) used for bullet extraction. */
  readonly bulletText?: string | null;
  /** Text carrying the provider's own employment-type token, if any. */
  readonly employmentTypeText?: string | null;
  readonly seniority?: JobSeniority | null;
  readonly remoteState?: JobRemoteState | null;
  /** Text used for remote-state detection; defaults to title + location + description. */
  readonly remoteStateText?: string | null;
  readonly locationText?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly countryCode?: string | null;
  readonly isInternational?: boolean | null;
  readonly salary?: Partial<JobSalaryFields> | null;
  readonly salaryText?: string | null;
  readonly salaryDefaultCurrency?: string | null;
  readonly skills?: readonly string[] | null;
  readonly postedAt?: string | null;
  readonly expiresAt?: string | null;
  readonly language?: string | null;
  readonly rawPayload: unknown;
  readonly now?: Date;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = truncateText(collapseWhitespace(value), maximum);
  return cleaned === '' ? null : cleaned;
}

function toCompanyDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '');
  const host = cleaned.split('/')[0] ?? '';
  return /^[a-z0-9.-]{3,200}$/u.test(host) ? host : null;
}

function resolveSalary(draft: JobInputDraft): JobSalaryFields {
  const salaryText = boundedText(draft.salaryText, 200);
  const parsed =
    salaryText === null ? null : parseSalary(salaryText, draft.salaryDefaultCurrency ?? undefined);
  const explicit = draft.salary ?? null;

  const minMinor = positiveIntegerOrNull(explicit?.minMinor) ?? parsed?.minMinor ?? null;
  let maxMinor = positiveIntegerOrNull(explicit?.maxMinor) ?? parsed?.maxMinor ?? null;
  if (minMinor !== null && maxMinor !== null && maxMinor < minMinor) maxMinor = null;
  if (minMinor === null && maxMinor === null) {
    return { minMinor: null, maxMinor: null, currency: null, period: null, isEstimate: false };
  }

  return {
    minMinor,
    maxMinor,
    currency: toCurrencyCode(explicit?.currency) ?? parsed?.currency ?? null,
    period: explicit?.period ?? parsed?.period ?? null,
    isEstimate: explicit?.isEstimate ?? parsed?.isEstimate ?? true,
  };
}

/**
 * Assembles a `NormalizedJobInput`, or returns `null` when the posting cannot
 * be represented truthfully: no HTTP source URL, no usable title, no company
 * name, or no description long enough for `public.jobs` to accept it.
 */
export function buildJobInput(draft: JobInputDraft): NormalizedJobInput | null {
  const sourceUrl = sanitizeHttpUrl(draft.sourceUrl);
  if (sourceUrl === null) return null;

  const sourceJobId = truncateText(collapseWhitespace(draft.sourceJobId), 200);
  if (sourceJobId === '') return null;

  const title = truncateText(collapseWhitespace(decodeHtmlEntities(draft.title)), MAX_TITLE_LENGTH);
  if (title.length < 2) return null;

  const companyName = truncateText(
    collapseWhitespace(decodeHtmlEntities(draft.companyName)),
    MAX_COMPANY_NAME_LENGTH,
  );
  if (companyName === '') return null;

  const description = truncateText(
    collapseWhitespace(stripHtml(draft.description)),
    MAX_DESCRIPTION_LENGTH,
  );
  if (description.length < 20) return null;

  const now = draft.now ?? new Date();
  const location = parseLocation(draft.locationText ?? '');
  const city = boundedText(draft.city, 120) ?? location.city;
  const region = boundedText(draft.region, 120) ?? location.region;
  const countryCode = toCountryCode(draft.countryCode) ?? location.countryCode;

  const remoteState =
    draft.remoteState ??
    detectRemoteState(
      draft.remoteStateText ??
        [title, location.locationRaw ?? '', description.slice(0, 2_000)].join(' '),
    );

  const salary = resolveSalary(draft);
  const bullets = splitRequirementBullets(draft.bulletText ?? description);
  const experience = deriveSeniorityFromExperience(description);
  const skills =
    draft.skills === null || draft.skills === undefined
      ? extractSkills([title, description].join(' '))
      : toBoundedStringArray(draft.skills, MAX_SKILLS, MAX_SKILL_LENGTH);

  const rawPayload = boundPayload(toRawPayload(draft.rawPayload));
  const employmentTypeText = boundedText(draft.employmentTypeText, 200);

  return {
    sourceJobId,
    sourceUrl,
    applyUrl: sanitizeHttpUrl(draft.applyUrl ?? null) ?? sourceUrl,
    title,
    companyName,
    companyDomain: toCompanyDomain(draft.companyDomain),
    companyCountryCode: toCountryCode(draft.companyCountryCode),
    description,
    employmentType:
      employmentTypeText === null
        ? detectEmploymentType([title, description.slice(0, 800)].join(' '))
        : detectEmploymentType(employmentTypeText),
    seniority: draft.seniority ?? detectSeniority(title, description),
    remoteState,
    locationRaw: location.locationRaw,
    city,
    region,
    countryCode,
    isInternational:
      draft.isInternational ??
      deriveIsInternational({ countryCode, remoteState, locationRaw: location.locationRaw }),
    salaryMinMinor: salary.minMinor,
    salaryMaxMinor: salary.maxMinor,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period,
    salaryIsEstimate: salary.isEstimate,
    requirements: bullets.requirements,
    preferredQualifications: bullets.preferredQualifications,
    skills,
    experienceYearsMin: experience.min,
    experienceYearsMax: experience.max,
    language: toLanguageTag(draft.language),
    postedAt: draft.postedAt == null ? null : toIsoTimestamp(draft.postedAt, now),
    expiresAt: draft.expiresAt == null ? null : toIsoTimestamp(draft.expiresAt),
    contentFingerprint: stableFingerprint({
      title,
      companyName,
      locationRaw: location.locationRaw,
      description,
    }),
    payloadChecksum: payloadChecksum(rawPayload),
    rawPayload,
  };
}
