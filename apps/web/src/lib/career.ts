import type { CareerDocument, CareerFact, CareerProfileDetail } from '@hanaply/contracts';

/**
 * Display helpers for the Career Intelligence Profile surfaces.
 *
 * Everything here is pure presentation data: option lists that mirror the
 * contract enums, labels, and formatters. No value is invented — when the API
 * has nothing to show, the caller renders an empty state instead.
 */

/** Contract-derived enums, so option values stay assignable to API payloads. */
export type EmploymentType = NonNullable<CareerProfileDetail['preferredEmploymentTypes'][number]>;
export type WorkArrangement = NonNullable<CareerProfileDetail['preferredWorkArrangement']>;
export type CareerLevel = NonNullable<CareerProfileDetail['careerLevel']>;
export type Availability = NonNullable<CareerProfileDetail['availability']>;
export type SalaryPeriod = NonNullable<
  NonNullable<CareerProfileDetail['salaryExpectation']>['period']
>;
export type SkillKind = NonNullable<CareerProfileDetail['skills'][number]>['skillKind'];
export type ProficiencyLevel = NonNullable<
  NonNullable<CareerProfileDetail['skills'][number]>['proficiency']
>;
export type LinkKind = NonNullable<CareerProfileDetail['links'][number]>['linkKind'];
export type CareerProfileStatus = CareerProfileDetail['status'];
export type CareerFactCategory = CareerFact['category'];
export type CareerDocumentKind = CareerDocument['documentKind'];

export interface CareerOption<TValue extends string = string> {
  value: TValue;
  label: string;
}

export const careerLevelOptions: readonly CareerOption<CareerLevel>[] = [
  { value: 'student', label: 'Student' },
  { value: 'entry', label: 'Entry level' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'director', label: 'Director' },
  { value: 'executive', label: 'Executive' },
];

export const employmentTypeOptions: readonly CareerOption<EmploymentType>[] = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'internship', label: 'Internship' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'volunteer', label: 'Volunteer' },
];

export const workArrangementOptions: readonly CareerOption<WorkArrangement>[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'flexible', label: 'Flexible' },
];

export const availabilityOptions: readonly CareerOption<Availability>[] = [
  { value: 'immediately', label: 'Immediately' },
  { value: 'two_weeks', label: 'In two weeks' },
  { value: 'one_month', label: 'In one month' },
  { value: 'three_months', label: 'In three months' },
  { value: 'not_looking', label: 'Not looking right now' },
];

export const salaryPeriodOptions: readonly CareerOption<SalaryPeriod>[] = [
  { value: 'hourly', label: 'Per hour' },
  { value: 'daily', label: 'Per day' },
  { value: 'monthly', label: 'Per month' },
  { value: 'annual', label: 'Per year' },
];

export const proficiencyOptions: readonly CareerOption<ProficiencyLevel>[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

export const skillKindOptions: readonly CareerOption<SkillKind>[] = [
  { value: 'skill', label: 'Skill' },
  { value: 'tool', label: 'Tool' },
  { value: 'technology', label: 'Technology' },
  { value: 'language', label: 'Language' },
  { value: 'soft_skill', label: 'Soft skill' },
  { value: 'domain', label: 'Domain knowledge' },
];

export const linkKindOptions: readonly CareerOption<LinkKind>[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'personal_website', label: 'Personal website' },
  { value: 'behance', label: 'Behance' },
  { value: 'dribbble', label: 'Dribbble' },
  { value: 'stackoverflow', label: 'Stack Overflow' },
  { value: 'other', label: 'Other link' },
];

export const factCategoryOptions: readonly CareerOption<CareerFactCategory>[] = [
  { value: 'experience', label: 'Experience' },
  { value: 'responsibility', label: 'Responsibility' },
  { value: 'achievement', label: 'Achievement' },
  { value: 'metric', label: 'Metric' },
  { value: 'skill', label: 'Skill' },
  { value: 'education', label: 'Education' },
  { value: 'certification', label: 'Certification' },
  { value: 'preference', label: 'Preference' },
  { value: 'goal', label: 'Goal' },
];

export const documentKindOptions: readonly CareerOption<CareerDocumentKind>[] = [
  { value: 'resume', label: 'Resume' },
  { value: 'cover_letter', label: 'Cover letter' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'other', label: 'Other document' },
];

export const profileStatusOptions: readonly CareerOption<CareerProfileStatus>[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export const currencyOptions: readonly CareerOption[] = [
  { value: 'PHP', label: 'PHP — Philippine peso' },
  { value: 'USD', label: 'USD — US dollar' },
  { value: 'SGD', label: 'SGD — Singapore dollar' },
  { value: 'AUD', label: 'AUD — Australian dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — Pound sterling' },
];

/** Fact sources are shown to the owner, so they read as plain language. */
const factSourceLabels: Readonly<Record<string, string>> = {
  user_entered: 'You',
  resume_extraction: 'Resume',
  ai_inference: 'AI proposal',
  imported: 'Imported',
};

const documentStatusLabels: Readonly<Record<string, string>> = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  parsed: 'Parsed',
  needs_review: 'Needs review',
  failed: 'Parsing failed',
  rejected: 'Rejected',
  archived: 'Archived',
};

const profileStatusLabels: Readonly<Record<string, string>> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const documentKindLabels: Readonly<Record<string, string>> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  portfolio: 'Portfolio',
  other: 'Other document',
};

export function humanise(value: string): string {
  const spaced = value.replaceAll('_', ' ').trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function optionLabel(options: readonly CareerOption[], value: string | null): string | null {
  if (!value) return null;
  return options.find((option) => option.value === value)?.label ?? humanise(value);
}

export function factSourceLabel(source: string): string {
  return factSourceLabels[source] ?? humanise(source);
}

export function documentStatusLabel(status: string): string {
  return documentStatusLabels[status] ?? humanise(status);
}

export function profileStatusLabel(status: string): string {
  return profileStatusLabels[status] ?? humanise(status);
}

export function documentKindLabel(kind: string): string {
  return documentKindLabels[kind] ?? humanise(kind);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatIsoDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(date);
}

export function formatMonthRange(
  startDate: string,
  endDate: string | null,
  isCurrent: boolean,
): string {
  const start = formatIsoDate(startDate) ?? startDate;
  if (isCurrent) return `${start} — Present`;
  const end = formatIsoDate(endDate) ?? endDate;
  return end ? `${start} — ${end}` : start;
}

export function formatSalary(
  salary: {
    minMinor: number;
    maxMinor: number | null;
    currency: string;
    period: string | null;
  } | null,
): string | null {
  if (!salary) return null;
  const amount = (minor: number) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: salary.currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  const period = salary.period
    ? ` ${optionLabel(salaryPeriodOptions, salary.period)?.toLowerCase() ?? ''}`
    : '';
  const range =
    salary.maxMinor === null
      ? `From ${amount(salary.minMinor)}`
      : `${amount(salary.minMinor)} – ${amount(salary.maxMinor)}`;
  return `${range}${period}`;
}

/**
 * Completeness keys come from the database completeness function. Each answer
 * is worth ten points, so every missing item has a concrete cost.
 */
const missingItemCopy: Readonly<Record<string, { label: string; impact: string }>> = {
  headline: {
    label: 'Professional headline',
    impact:
      'The headline is the first signal a match reads. Without it, ranking falls back to job titles alone.',
  },
  summary: {
    label: 'Professional summary of at least 80 characters',
    impact:
      'A short summary gives match analysis the context that titles and dates cannot carry on their own.',
  },
  currentRole: {
    label: 'Current role title and career level',
    impact: 'Seniority scoring needs both your current title and your declared career level.',
  },
  yearsExperience: {
    label: 'Years of experience',
    impact: 'Without total years, seniority filters cannot be applied and roles may be mis-ranked.',
  },
  targetRoles: {
    label: 'At least one target role',
    impact:
      'Target roles are the primary matching signal. With none recorded, nothing can be matched at all.',
  },
  employmentHistory: {
    label: 'At least one employment entry',
    impact:
      'Employment history is the evidence behind your experience. Generated material cannot cite what is not recorded.',
  },
  skills: {
    label: 'Five or more skills',
    impact:
      'Skill overlap is scored from your skill list. Fewer than five skills leaves that score incomplete.',
  },
  education: {
    label: 'At least one education entry',
    impact:
      'Requirements that are gated on a degree or field of study cannot be satisfied without an education entry.',
  },
  locationPreferences: {
    label: 'Work arrangement and location preferences',
    impact:
      'Work arrangement and locations decide which opportunities are eligible before any ranking happens.',
  },
  evidence: {
    label: 'One link or three confirmed facts',
    impact:
      'Match analysis may only cite confirmed facts or a public link. Without either, claims stay unverifiable.',
  },
};

export function missingItemLabel(key: string): string {
  return missingItemCopy[key]?.label ?? humanise(key);
}

export function missingItemImpact(key: string): string {
  return (
    missingItemCopy[key]?.impact ??
    'This item contributes to the completeness score and to how confidently matches can be ranked.'
  );
}

/** Reads the first grounded string an extractor stored next to a fact. */
export function factEvidenceSnippet(evidence: CareerFact['evidence']): string | null {
  for (const [key, value] of Object.entries(evidence)) {
    if (key === 'kind' || key === 'id') continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function factMetricLabel(fact: CareerFact): string | null {
  if (fact.metricValue === null || !fact.metricUnit) return null;
  return `${fact.metricValue} ${fact.metricUnit}`;
}

/** Minor units rendered back into a human-editable currency amount. */
export function minorToInputValue(minor: number | null): string {
  if (minor === null) return '';
  return String(minor / 100);
}
