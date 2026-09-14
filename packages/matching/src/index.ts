/**
 * Hanaply matching engine.
 *
 * This module is the explainable intelligence layer behind the Career Radar. It
 * is deliberately deterministic: the same profile, job, and model version always
 * produce the same score, every dimension contribution is returned, and nothing
 * is written in prose by a language model. Free-text explanation can be layered
 * on top later, but the ranking itself must be reproducible and auditable.
 *
 * Three rules shape the design:
 *
 *   1. No fabricated precision. A dimension backed by missing data contributes a
 *      neutral value and is reported in `unknowns`; it never silently scores as a
 *      perfect or zero match.
 *   2. Evidence only. `evidenceFactIds` lists the confirmed career facts the
 *      result relied on, and generated text may not assert anything outside it.
 *   3. Confidence is not score. A high score computed from a thin profile is
 *      reported as low confidence.
 */

import { z } from 'zod';

export const marketLevelSchema = z.enum([
  'student',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive',
]);

export const jobSenioritySchema = z.enum([
  'internship',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
  'executive',
  'unspecified',
]);

export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'internship',
  'temporary',
  'volunteer',
]);

export const workArrangementSchema = z.enum(['remote', 'hybrid', 'onsite', 'flexible']);
export const remoteStateSchema = z.enum(['remote', 'hybrid', 'onsite', 'unspecified']);
export const salaryPeriodSchema = z.enum(['hourly', 'daily', 'monthly', 'annual']);

export const matchingCareerProfileSchema = z.object({
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  currentRoleTitle: z.string().nullable(),
  careerLevel: marketLevelSchema.nullable(),
  yearsExperience: z.number().min(0).max(80).nullable(),
  industries: z.array(z.string()),
  targetRoleTitles: z.array(z.string()),
  excludedRoleTitles: z.array(z.string()),
  preferredEmploymentTypes: z.array(employmentTypeSchema),
  preferredWorkArrangement: workArrangementSchema.nullable(),
  preferredLocations: z.array(z.string()),
  openToInternational: z.boolean(),
  openToRelocation: z.boolean(),
  salaryMinMinor: z.number().int().positive().nullable(),
  salaryMaxMinor: z.number().int().positive().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  salaryPeriod: salaryPeriodSchema.nullable(),
  skills: z.array(
    z.object({
      name: z.string(),
      skillKind: z.string(),
      isPrimary: z.boolean(),
      proficiency: z.string().nullable(),
    }),
  ),
  employment: z.array(
    z.object({
      roleTitle: z.string(),
      companyName: z.string(),
      isCurrent: z.boolean(),
      startDate: z.string(),
      endDate: z.string().nullable(),
      skills: z.array(z.string()),
      highlights: z.array(z.string()),
    }),
  ),
});

export const matchingJobSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  companyName: z.string(),
  description: z.string(),
  employmentType: employmentTypeSchema,
  seniority: jobSenioritySchema,
  remoteState: remoteStateSchema,
  locationRaw: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  isPhilippines: z.boolean(),
  salaryMinMinor: z.number().int().positive().nullable(),
  salaryMaxMinor: z.number().int().positive().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  salaryPeriod: salaryPeriodSchema.nullable(),
  skills: z.array(z.string()),
  requirements: z.array(z.string()),
  preferredQualifications: z.array(z.string()),
  experienceYearsMin: z.number().min(0).max(60).nullable(),
  experienceYearsMax: z.number().min(0).max(60).nullable(),
  postedAt: z.string().nullable(),
  lastSeenAt: z.string(),
  status: z.string(),
});

export type MatchingCareerProfile = z.infer<typeof matchingCareerProfileSchema>;
export type MatchingJob = z.infer<typeof matchingJobSchema>;
export type JobSeniority = z.infer<typeof jobSenioritySchema>;

export const dimensionKeys = [
  'roleAlignment',
  'skillsCoverage',
  'seniorityAlignment',
  'experienceAlignment',
  'locationAlignment',
  'compensationAlignment',
  'employmentTypeAlignment',
  'careerDirection',
  'recency',
] as const;

export type DimensionKey = (typeof dimensionKeys)[number];

export interface DimensionScore {
  readonly key: DimensionKey;
  readonly label: string;
  readonly weight: number;
  /** 0..100, or null when the available data cannot support a judgement. */
  readonly score: number | null;
  readonly contribution: number;
  readonly detail: string;
}

export interface RequirementMapping {
  readonly requirement: string;
  readonly status: 'met' | 'partially_met' | 'unmet' | 'unknown';
  readonly matchedSkills: readonly string[];
  readonly evidence: string | null;
}

export interface MatchResult {
  readonly jobId: string;
  readonly careerProfileId: string;
  readonly score: number;
  readonly verdict: 'strong_match' | 'good_match' | 'stretch' | 'weak_match' | 'not_recommended';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly modelVersion: string;
  readonly dimensions: readonly DimensionScore[];
  readonly strengths: readonly string[];
  readonly gaps: readonly string[];
  readonly blockers: readonly string[];
  readonly rejectionRisks: readonly string[];
  readonly requirementMapping: readonly RequirementMapping[];
  readonly recommendedAction: string;
  readonly evidenceFactIds: readonly string[];
  readonly dataQuality: {
    readonly profileCompleteness: 'thin' | 'partial' | 'solid';
    readonly jobDetail: 'thin' | 'partial' | 'detailed';
    readonly unknowns: readonly DimensionKey[];
  };
}

export const modelVersion = 'matching-v1';

const dimensionWeights: Readonly<Record<DimensionKey, number>> = Object.freeze({
  roleAlignment: 22,
  skillsCoverage: 20,
  seniorityAlignment: 12,
  experienceAlignment: 12,
  locationAlignment: 12,
  compensationAlignment: 8,
  employmentTypeAlignment: 6,
  careerDirection: 5,
  recency: 3,
});

const dimensionLabels: Readonly<Record<DimensionKey, string>> = Object.freeze({
  roleAlignment: 'Role alignment',
  skillsCoverage: 'Skills coverage',
  seniorityAlignment: 'Seniority alignment',
  experienceAlignment: 'Experience alignment',
  locationAlignment: 'Location and work setup',
  compensationAlignment: 'Compensation',
  employmentTypeAlignment: 'Employment type',
  careerDirection: 'Career direction',
  recency: 'Freshness',
});

const neutralScore = 55;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
  'you',
  'your',
  'we',
  'our',
  'will',
  'role',
  'job',
  'work',
  'team',
  'teams',
  'experience',
  'years',
  'year',
  'plus',
  'using',
  'strong',
  'good',
  'must',
  'have',
  'has',
  'ability',
  'including',
  'etc',
  'other',
  'new',
  'well',
  'also',
  'who',
  'this',
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9+#.]+/gu, ' ')
    .split(' ')
    .map((token) => token.replace(/^\.+|\.+$/gu, ''))
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function normalizeSkill(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9+#.]+/gu, ' ')
    .trim();
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

function scoreRoleAlignment(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string } {
  const targets = profile.targetRoleTitles.map((title) => normalizeSkill(title)).filter(Boolean);
  if (targets.length === 0) {
    return { score: null, detail: 'No target roles are recorded on this profile yet.' };
  }
  const jobTitle = normalizeSkill(job.title);
  let best = 0;
  for (const target of targets) {
    if (jobTitle === target) {
      best = Math.max(best, 100);
      continue;
    }
    const targetTokens = new Set(tokenize(target));
    const jobTokens = new Set(tokenize(job.title));
    let overlap = 0;
    for (const token of targetTokens) {
      if (jobTokens.has(token)) overlap += 1;
    }
    const containment = targetTokens.size === 0 ? 0 : overlap / targetTokens.size;
    const similarity = jaccardSimilarity(target, job.title);
    best = Math.max(best, clamp(Math.round(containment * 80 + similarity * 40)));
  }
  const current = profile.currentRoleTitle ? normalizeSkill(profile.currentRoleTitle) : '';
  if (current && (current === jobTitle || jaccardSimilarity(current, job.title) > 0.6)) {
    best = Math.max(best, 70);
  }
  return {
    score: best,
    detail:
      best >= 70
        ? 'The title closely matches one of your target roles.'
        : best >= 40
          ? 'The title partially overlaps your target roles.'
          : 'The title does not resemble your stated target roles.',
  };
}

/**
 * Vocabulary shared by skill coverage and requirement mapping.
 *
 * Coverage must only ever consider terms that are actually named somewhere: the
 * posting's own skill list, the candidate's own skill list, or a token in the
 * requirement text that carries an explicit technology marker (a symbol or an
 * acronym). Ordinary English words are never treated as skills, so a posting
 * cannot be credited with a match it never asked for.
 */
function buildVocabulary(profile: MatchingCareerProfile, job: MatchingJob): Map<string, string> {
  const vocabulary = new Map<string, string>();
  const add = (value: string): void => {
    const normalized = normalizeSkill(value);
    if (normalized.length < 2) return;
    if (!vocabulary.has(normalized)) vocabulary.set(normalized, value);
  };
  for (const skill of job.skills) add(skill);
  for (const skill of profile.skills) add(skill.name);
  for (const requirement of [...job.requirements, ...job.preferredQualifications]) {
    for (const token of extractMarkerTokens(requirement)) add(token);
  }
  return vocabulary;
}

function mentionsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, 'iu').test(haystack);
}

/**
 * Capitalised terms that look like a named technology or product. Job postings
 * capitalise tool names, so this recovers requirements such as "Kubernetes
 * cluster administration". Common sentence-leading and requirement-leading words
 * are filtered so "Strong communication skills" does not invent a skill called
 * "Strong". This vocabulary is used for requirement mapping only; widening the
 * scoring vocabulary would distort coverage.
 */
function extractProperNounTerms(value: string): string[] {
  const results: string[] = [];
  for (const match of value.matchAll(/(?<![.!?]\s)\b([A-Z][A-Za-z0-9+#.]{2,30})\b/gu)) {
    const candidate = match[1];
    if (!candidate) continue;
    const normalized = normalizeSkill(candidate);
    if (normalized.length < 3 || stopWords.has(normalized)) continue;
    if (nonSkillWords.has(normalized)) continue;
    results.push(normalized);
  }
  return results;
}

const nonSkillWords = new Set([
  'strong',
  'excellent',
  'proven',
  'experience',
  'experienced',
  'ability',
  'must',
  'demonstrated',
  'solid',
  'good',
  'great',
  'deep',
  'familiar',
  'familiarity',
  'knowledge',
  'hands',
  'we',
  'you',
  'the',
  'this',
  'that',
  'minimum',
  'plus',
  'preferred',
  'required',
  'requirements',
  'qualifications',
  'responsibilities',
  'about',
  'role',
  'job',
  'company',
  'team',
  'years',
  'work',
  'working',
  'comfortable',
  'confident',
  'passionate',
  'self',
  'highly',
  'well',
  'at',
  'in',
  'on',
  'with',
  'and',
  'or',
  'our',
  'your',
  'their',
  'they',
  'it',
  'is',
  'are',
  'be',
  'as',
  'an',
  'a',
]);

function scoreSkillsCoverage(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string; matched: string[]; missing: string[] } {
  const vocabulary = buildVocabulary(profile, job);
  if (vocabulary.size === 0) {
    return {
      score: null,
      detail: 'This posting does not list explicit skills, so coverage cannot be judged.',
      matched: [],
      missing: [],
    };
  }
  const profileSkills = new Set(profile.skills.map((skill) => normalizeSkill(skill.name)));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const [normalized, original] of vocabulary) {
    if (profileSkills.has(normalized)) {
      matched.push(original);
      continue;
    }
    const partial = [...profileSkills].some(
      (candidate) => candidate.includes(normalized) || normalized.includes(candidate),
    );
    if (partial) matched.push(original);
    else missing.push(original);
  }
  const coverage = matched.length / vocabulary.size;
  return {
    score: clamp(Math.round(coverage * 100)),
    detail: `Your profile covers ${matched.length} of the ${vocabulary.size} skills this posting names.`,
    matched,
    missing,
  };
}

/**
 * Tokens in free text that are unambiguously a technology: they contain a
 * symbol (`node.js`, `c#`, `c++`) or they are an acronym (`AWS`, `SQL`).
 */
function extractMarkerTokens(requirement: string): string[] {
  const matches = requirement.matchAll(/\b([A-Za-z][A-Za-z0-9+#.]{1,30})\b/gu);
  const results: string[] = [];
  for (const match of matches) {
    const candidate = match[1];
    if (!candidate) continue;
    const normalized = normalizeSkill(candidate);
    if (normalized.length < 2 || stopWords.has(normalized)) continue;
    if (/[+#.]/u.test(candidate) || /^[A-Z]{2,}$/u.test(candidate)) {
      results.push(normalized);
    }
  }
  return results;
}

const seniorityOrder: Readonly<Record<string, number>> = Object.freeze({
  internship: 0,
  entry: 1,
  junior: 2,
  mid: 3,
  senior: 4,
  lead: 5,
  principal: 6,
  manager: 5,
  director: 7,
  executive: 8,
});

function scoreSeniorityAlignment(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string } {
  if (job.seniority === 'unspecified' || profile.careerLevel === null) {
    return { score: null, detail: 'Seniority could not be compared from the available data.' };
  }
  const profileRank = seniorityOrder[profile.careerLevel];
  const jobRank = seniorityOrder[job.seniority];
  if (profileRank === undefined || jobRank === undefined) {
    return { score: null, detail: 'Seniority could not be compared from the available data.' };
  }
  const distance = jobRank - profileRank;
  if (distance === 0) return { score: 100, detail: 'The level matches your stated career level.' };
  if (distance === 1) return { score: 82, detail: 'This is one step above your stated level.' };
  if (distance === 2) return { score: 62, detail: 'This is two steps above your stated level.' };
  if (distance > 2) {
    return { score: 30, detail: 'This role is several levels above your stated level.' };
  }
  if (distance === -1) return { score: 78, detail: 'This is one step below your stated level.' };
  return { score: 45, detail: 'This role is well below your stated level.' };
}

function scoreExperienceAlignment(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string } {
  if (profile.yearsExperience === null || job.experienceYearsMin === null) {
    return { score: null, detail: 'The posting does not state a required experience range.' };
  }
  const years = profile.yearsExperience;
  const minimum = job.experienceYearsMin;
  const maximum = job.experienceYearsMax;
  if (years >= minimum && (maximum === null || years <= maximum + 2)) {
    return {
      score: 100,
      detail: `You have ${years} years against a ${minimum}+ year requirement.`,
    };
  }
  if (years >= minimum - 1) {
    return {
      score: 78,
      detail: `You have ${years} years against a ${minimum}+ year requirement, which is close.`,
    };
  }
  const shortfall = minimum - years;
  return {
    score: clamp(Math.round(100 - shortfall * 22)),
    detail: `You have ${years} years against a ${minimum}+ year requirement.`,
  };
}

function scoreLocationAlignment(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string; blocker: string | null } {
  const arrangement = profile.preferredWorkArrangement;
  const wantsRemote = arrangement === 'remote' || arrangement === 'flexible';
  const jobArrangement = job.remoteState;

  if (jobArrangement === 'unspecified' && job.locationRaw === null) {
    return {
      score: null,
      detail: 'The posting does not state a location or work setup.',
      blocker: null,
    };
  }

  if (jobArrangement === 'remote') {
    if (profile.openToInternational || job.isPhilippines) {
      return {
        score: wantsRemote ? 100 : 82,
        detail: 'This is a remote role that fits your stated preferences.',
        blocker: null,
      };
    }
    return {
      score: 45,
      detail: 'This remote role may be restricted to another country.',
      blocker: null,
    };
  }

  if (jobArrangement === 'onsite' && wantsRemote) {
    return {
      score: 25,
      detail: 'This is an on-site role and you have asked for remote work.',
      blocker: null,
    };
  }

  const preferred = profile.preferredLocations.map((location) => normalizeSkill(location));
  const haystack = normalizeSkill(
    [job.locationRaw ?? '', job.city ?? '', job.region ?? '', job.countryCode ?? ''].join(' '),
  );
  if (preferred.length === 0) {
    if (job.isPhilippines) {
      return { score: 75, detail: 'This role is in the Philippines.', blocker: null };
    }
    return {
      score: null,
      detail: 'No preferred locations are recorded on this profile.',
      blocker: null,
    };
  }
  const matches = preferred.some((location) => location.length > 2 && haystack.includes(location));
  if (matches)
    return { score: 95, detail: 'This role is in one of your preferred locations.', blocker: null };

  if (!job.isPhilippines && !profile.openToInternational && !profile.openToRelocation) {
    return {
      score: 20,
      detail:
        'This role is outside the Philippines and you have not opted into international work.',
      blocker:
        'This posting is outside the Philippines and your profile is not open to international roles.',
    };
  }
  return {
    score: 45,
    detail: 'This role is outside your preferred locations but you are open to it.',
    blocker: null,
  };
}

function toMonthlyMinor(amount: number, period: z.infer<typeof salaryPeriodSchema> | null): number {
  switch (period) {
    case 'hourly':
      return Math.round(amount * 8 * 22);
    case 'daily':
      return Math.round(amount * 22);
    case 'annual':
      return Math.round(amount / 12);
    default:
      return amount;
  }
}

function scoreCompensationAlignment(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string } {
  if (profile.salaryMinMinor === null) {
    return { score: null, detail: 'No salary expectation is recorded on this profile.' };
  }
  if (job.salaryMinMinor === null && job.salaryMaxMinor === null) {
    return { score: null, detail: 'This posting does not publish a salary range.' };
  }
  if (
    job.salaryCurrency !== null &&
    profile.salaryCurrency !== null &&
    job.salaryCurrency !== profile.salaryCurrency
  ) {
    return {
      score: null,
      detail: `The posting is quoted in ${job.salaryCurrency} and your expectation is in ${profile.salaryCurrency}, so they were not compared.`,
    };
  }

  const expectation = toMonthlyMinor(profile.salaryMinMinor, profile.salaryPeriod);
  const jobTop = job.salaryMaxMinor ?? job.salaryMinMinor;
  const jobBottom = job.salaryMinMinor ?? job.salaryMaxMinor;
  if (jobTop === null || jobBottom === null) {
    return { score: null, detail: 'This posting does not publish a salary range.' };
  }
  const top = toMonthlyMinor(jobTop, job.salaryPeriod);
  const bottom = toMonthlyMinor(jobBottom, job.salaryPeriod);

  if (top < expectation) {
    return {
      score: clamp(Math.round((top / expectation) * 70)),
      detail: 'The advertised range is below your stated minimum.',
    };
  }
  if (bottom >= expectation) {
    return { score: 100, detail: 'The advertised range meets or exceeds your stated minimum.' };
  }
  return { score: 80, detail: 'The advertised range only reaches your minimum at its top end.' };
}

function scoreEmploymentTypeAlignment(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string } {
  if (profile.preferredEmploymentTypes.length === 0) {
    return { score: null, detail: 'No employment-type preference is recorded on this profile.' };
  }
  if (profile.preferredEmploymentTypes.includes(job.employmentType)) {
    return { score: 100, detail: 'The employment type matches your stated preference.' };
  }
  return { score: 20, detail: 'The employment type is not one you selected.' };
}

function scoreCareerDirection(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): { score: number | null; detail: string } {
  const industries = profile.industries.map((industry) => normalizeSkill(industry));
  const description = `${job.title} ${job.description}`.toLowerCase();
  if (industries.length === 0) {
    if (profile.headline === null && profile.summary === null) {
      return { score: null, detail: 'No career direction is recorded on this profile yet.' };
    }
    const similarity = jaccardSimilarity(
      `${profile.headline ?? ''} ${profile.summary ?? ''}`.slice(0, 2000),
      `${job.title} ${job.description}`.slice(0, 2000),
    );
    return {
      score: clamp(Math.round(40 + similarity * 120)),
      detail: 'Direction was estimated from your headline and summary.',
    };
  }
  const matched = industries.filter((industry) => description.includes(industry));
  if (matched.length > 0) {
    return {
      score: clamp(70 + matched.length * 10),
      detail: `This posting mentions ${matched.join(', ')}, which is on your profile.`,
    };
  }
  return { score: 45, detail: 'This posting does not mention the industries on your profile.' };
}

function scoreRecency(job: MatchingJob, now: Date): { score: number; detail: string } {
  const reference = job.postedAt ?? job.lastSeenAt;
  const posted = new Date(reference);
  if (Number.isNaN(posted.getTime())) {
    return { score: neutralScore, detail: 'The posting date is unavailable.' };
  }
  const ageHours = (now.getTime() - posted.getTime()) / 3_600_000;
  if (ageHours <= 24) return { score: 100, detail: 'Posted in the last day.' };
  if (ageHours <= 72) return { score: 90, detail: 'Posted in the last three days.' };
  if (ageHours <= 168) return { score: 75, detail: 'Posted this week.' };
  if (ageHours <= 336) return { score: 55, detail: 'Posted in the last two weeks.' };
  if (ageHours <= 720) return { score: 35, detail: 'Posted about a month ago.' };
  return { score: 15, detail: 'This posting is more than a month old.' };
}

// ---------------------------------------------------------------------------
// Requirement mapping
// ---------------------------------------------------------------------------

function buildRequirementMapping(
  profile: MatchingCareerProfile,
  job: MatchingJob,
): RequirementMapping[] {
  // What the candidate can legitimately claim: skills, listed industries, the
  // skills recorded on their roles, and their target-role vocabulary. Industries
  // and role skills are real evidence, not inferences.
  const profileVocabulary = new Set<string>([
    ...profile.skills.map((skill) => normalizeSkill(skill.name)),
    ...profile.industries.map((industry) => normalizeSkill(industry)),
    ...profile.employment.flatMap((entry) => entry.skills.map((skill) => normalizeSkill(skill))),
  ]);
  const vocabulary = buildVocabulary(profile, job);
  const requirementText = [
    ...job.requirements,
    ...job.preferredQualifications,
    ...(job.requirements.length === 0 && job.preferredQualifications.length === 0
      ? extractSentences(job.description).slice(0, 6)
      : []),
  ].slice(0, 12);

  return requirementText.map((requirement) => {
    // Requirement mapping is allowed a wider net than scoring: a capitalised
    // term that is not at the start of the sentence is treated as a named
    // technology so the user gets a real met/unmet answer for it.
    const candidates = new Map(vocabulary);
    for (const term of extractProperNounTerms(requirement)) {
      if (!candidates.has(term)) candidates.set(term, term);
    }
    const named = [...candidates.entries()]
      .filter(([normalized]) => mentionsTerm(requirement, normalized))
      .map(([normalized, original]) => ({ normalized, original }));
    const matched = named
      .filter((entry) => profileVocabulary.has(entry.normalized))
      .map((entry) => entry.original);
    const status: RequirementMapping['status'] =
      named.length === 0
        ? 'unknown'
        : matched.length === named.length
          ? 'met'
          : matched.length > 0
            ? 'partially_met'
            : 'unmet';
    return {
      requirement: requirement.slice(0, 500),
      status,
      matchedSkills: matched,
      evidence: matched.length > 0 ? `Your profile lists ${matched.join(', ')}.` : null,
    };
  });
}

function extractSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.replace(/\s+/gu, ' ').trim())
    .filter((sentence) => sentence.length >= 25 && sentence.length <= 500);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ScoreMatchOptions {
  readonly now?: Date;
  /** Confirmed career fact identifiers. Their count drives confidence, not score. */
  readonly evidenceFactIds?: readonly string[];
  readonly confirmedFactCount?: number;
}

export function scoreMatch(
  profileInput: MatchingCareerProfile,
  jobInput: MatchingJob,
  options: ScoreMatchOptions = {},
): MatchResult {
  const profile = matchingCareerProfileSchema.parse(profileInput);
  const job = matchingJobSchema.parse(jobInput);
  const now = options.now ?? new Date();

  const role = scoreRoleAlignment(profile, job);
  const skills = scoreSkillsCoverage(profile, job);
  const seniority = scoreSeniorityAlignment(profile, job);
  const experience = scoreExperienceAlignment(profile, job);
  const location = scoreLocationAlignment(profile, job);
  const compensation = scoreCompensationAlignment(profile, job);
  const employmentType = scoreEmploymentTypeAlignment(profile, job);
  const direction = scoreCareerDirection(profile, job);
  const recency = scoreRecency(job, now);

  const rawDimensions: Record<DimensionKey, { score: number | null; detail: string }> = {
    roleAlignment: role,
    skillsCoverage: skills,
    seniorityAlignment: seniority,
    experienceAlignment: experience,
    locationAlignment: location,
    compensationAlignment: compensation,
    employmentTypeAlignment: employmentType,
    careerDirection: direction,
    recency,
  };

  const unknowns: DimensionKey[] = [];
  const dimensions: DimensionScore[] = dimensionKeys.map((key) => {
    const entry = rawDimensions[key];
    const weight = dimensionWeights[key];
    const score = entry.score;
    if (score === null) unknowns.push(key);
    const effective = score ?? neutralScore;
    return {
      key,
      label: dimensionLabels[key],
      weight,
      score,
      contribution: Math.round((effective * weight) / 100),
      detail: entry.detail,
    };
  });

  // Unknown dimensions contribute a neutral value. The score is then rescaled so
  // a profile with missing data is not artificially penalised or rewarded.
  const knownWeight = dimensionKeys.reduce(
    (total, key) => total + (rawDimensions[key].score === null ? 0 : dimensionWeights[key]),
    0,
  );
  const knownContribution = dimensions.reduce(
    (total, dimension) => total + (dimension.score === null ? 0 : dimension.contribution),
    0,
  );
  const score = knownWeight === 0 ? 0 : clamp(Math.round((knownContribution / knownWeight) * 100));

  const blockers: string[] = [];
  if (location.blocker !== null) blockers.push(location.blocker);

  const excluded = profile.excludedRoleTitles
    .map((title) => normalizeSkill(title))
    .filter((title) => title.length > 2);
  const jobTitleNormalized = normalizeSkill(job.title);
  const excludedMatch = excluded.find(
    (title) => jobTitleNormalized.includes(title) || jaccardSimilarity(title, job.title) > 0.75,
  );
  if (excludedMatch) {
    blockers.push('The role matches a role you asked Hanaply not to show you.');
  }

  if (job.status !== 'active') {
    blockers.push('This posting is no longer active.');
  }

  const strengths: string[] = [];
  if (skills.matched.length > 0) {
    strengths.push(
      `Your profile already covers ${skills.matched.slice(0, 6).join(', ')}${skills.matched.length > 6 ? ` and ${skills.matched.length - 6} more` : ''}.`,
    );
  }
  if (role.score !== null && role.score >= 70)
    strengths.push('The title lines up with a target role.');
  if (seniority.score !== null && seniority.score >= 82)
    strengths.push('The level matches your experience.');
  if (location.score !== null && location.score >= 90)
    strengths.push('The location and work setup fit your preferences.');
  if (compensation.score !== null && compensation.score >= 80) {
    strengths.push('The advertised compensation is compatible with your expectation.');
  }

  const gaps: string[] = [];
  if (skills.missing.length > 0) {
    const gapSkills = skills.missing.slice(0, 6);
    const transferable = gapSkills.filter((skill) =>
      profile.skills.some((profileSkill) => {
        const profileSkillName = normalizeSkill(profileSkill.name);
        return (
          profileSkill.skillKind === 'technology' &&
          (profileSkillName.startsWith(skill.slice(0, 4)) ||
            skill.startsWith(profileSkillName.slice(0, 4)))
        );
      }),
    );
    gaps.push(
      `This posting names ${gapSkills.join(', ')}${skills.missing.length > 6 ? ` and ${skills.missing.length - 6} more` : ''}, which are not on your profile.`,
    );
    if (transferable.length > 0) {
      gaps.push(
        `You may be able to frame adjacent experience with ${transferable.join(', ')} as transferable rather than claiming it directly.`,
      );
    }
  }
  if (experience.score !== null && experience.score < 80) {
    gaps.push(experience.detail);
  }
  if (compensation.score !== null && compensation.score < 80) {
    gaps.push(compensation.detail);
  }
  if (employmentType.score !== null && employmentType.score < 50) {
    gaps.push(employmentType.detail);
  }

  const rejectionRisks: string[] = [];
  const unmetRequirements = buildRequirementMapping(profile, job);
  const unmetCount = unmetRequirements.filter((entry) => entry.status === 'unmet').length;
  if (unmetCount > 0) {
    rejectionRisks.push(
      `${unmetCount} listed requirement${unmetCount === 1 ? '' : 's'} could not be matched to your profile.`,
    );
  }
  if (seniority.score !== null && seniority.score < 62) {
    rejectionRisks.push('A recruiter may screen this as a level mismatch.');
  }
  if (experience.score !== null && experience.score < 70) {
    rejectionRisks.push('The stated experience requirement is above what your profile records.');
  }
  if (skills.score !== null && skills.score < 45) {
    rejectionRisks.push(
      'Skill coverage is low enough that an automated screen may filter this out.',
    );
  }
  if (job.salaryMinMinor === null && job.salaryMaxMinor === null) {
    rejectionRisks.push(
      'No salary range is published, so compensation expectations are unverified.',
    );
  }

  const confirmedFactCount = options.confirmedFactCount ?? options.evidenceFactIds?.length ?? 0;
  const profileCompleteness: 'thin' | 'partial' | 'solid' =
    profile.skills.length >= 5 && profile.yearsExperience !== null && confirmedFactCount >= 3
      ? 'solid'
      : profile.skills.length > 0 || profile.yearsExperience !== null
        ? 'partial'
        : 'thin';
  const jobDetail: 'thin' | 'partial' | 'detailed' =
    job.requirements.length >= 3 && job.skills.length >= 3
      ? 'detailed'
      : job.requirements.length > 0 || job.skills.length > 0
        ? 'partial'
        : 'thin';

  const confidence: MatchResult['confidence'] =
    profileCompleteness === 'solid' && jobDetail === 'detailed'
      ? 'high'
      : profileCompleteness === 'thin' || jobDetail === 'thin'
        ? 'low'
        : 'medium';

  const verdict: MatchResult['verdict'] =
    blockers.length > 0
      ? 'not_recommended'
      : score >= 82 && confidence !== 'low'
        ? 'strong_match'
        : score >= 70
          ? 'good_match'
          : score >= 58
            ? 'stretch'
            : 'weak_match';

  const recommendedAction = buildRecommendedAction(verdict, confidence, blockers, gaps, strengths);

  return {
    jobId: job.id,
    careerProfileId: profile.id,
    score,
    verdict,
    confidence,
    modelVersion,
    dimensions,
    strengths: strengths.slice(0, 6),
    gaps: gaps.slice(0, 6),
    blockers: blockers.slice(0, 5),
    rejectionRisks: rejectionRisks.slice(0, 6),
    requirementMapping: unmetRequirements,
    recommendedAction,
    evidenceFactIds: options.evidenceFactIds ?? [],
    dataQuality: { profileCompleteness, jobDetail, unknowns },
  };
}

function buildRecommendedAction(
  verdict: MatchResult['verdict'],
  confidence: MatchResult['confidence'],
  blockers: readonly string[],
  gaps: readonly string[],
  strengths: readonly string[],
): string {
  if (blockers.length > 0) {
    return 'Skip this one unless something in your situation has changed, and tell Hanaply why so future rankings improve.';
  }
  if (confidence === 'low') {
    return 'Complete more of your career profile first, then review this match again for a reliable recommendation.';
  }
  switch (verdict) {
    case 'strong_match':
      return strengths.length > 0
        ? 'Apply now and lead your resume with the experience that matches this posting.'
        : 'Apply now while this posting is fresh.';
    case 'good_match':
      return gaps.length > 0
        ? 'Apply, and address the gap in your summary honestly rather than leaving it unexplained.'
        : 'Apply, and keep your application focused on the requirements you already meet.';
    case 'stretch':
      return 'Consider applying only if you can show adjacent experience for the unmet requirements.';
    default:
      return 'This is a long shot. Save it for later or dismiss it so your radar stays focused.';
  }
}

export function verdictLabel(verdict: MatchResult['verdict']): string {
  switch (verdict) {
    case 'strong_match':
      return 'Strong match';
    case 'good_match':
      return 'Good match';
    case 'stretch':
      return 'Stretch opportunity';
    case 'weak_match':
      return 'Weak match';
    default:
      return 'Not recommended';
  }
}
