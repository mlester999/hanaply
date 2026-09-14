import type { ApplicationArtifact, ApplicationStage } from '@hanaply/contracts';
import type { BadgeTone } from '@hanaply/ui';

import { humanise } from '@/lib/career';

/**
 * Display helpers for the Application Pack and application tracker surfaces.
 *
 * Everything here is pure presentation data: label maps that mirror the contract
 * enums, badge tones, and formatters. Nothing is invented — a value the API did
 * not return is rendered as an explicit "not recorded" note by the caller, and a
 * failure code this page does not recognise is shown exactly as stored rather
 * than translated into a guess.
 */

export type PackStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'archived';
export type ArtifactKind = ApplicationArtifact['kind'];
export type TruthGateStatus = ApplicationArtifact['truthGateStatus'];

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

/**
 * The board order, and the order the stage select lists. It is written out
 * rather than read from the contract so the pipeline reads left-to-right as a
 * hiring process; the label map below is keyed by this tuple, which makes a
 * stage added to the contract a type error here instead of a silent gap.
 */
export const applicationStageOrder = [
  'saved',
  'preparing',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
  'archived',
] as const satisfies readonly ApplicationStage[];

export type TrackerStage = (typeof applicationStageOrder)[number];

export const applicationStageLabels: Readonly<Record<TrackerStage, string>> = {
  saved: 'Saved',
  preparing: 'Preparing',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  archived: 'Archived',
};

export const applicationStageDescriptions: Readonly<Record<TrackerStage, string>> = {
  saved: 'Kept for later. Nothing has been sent.',
  preparing: 'An Application Pack or an application is being prepared.',
  applied: 'The application has been sent.',
  interviewing: 'Conversations, tests, or interviews are in progress.',
  offer: 'An offer has been made.',
  rejected: 'The employer said no.',
  withdrawn: 'You stopped pursuing this opportunity.',
  archived: 'Closed and kept for your records.',
};

export function applicationStageLabel(stage: TrackerStage): string {
  return applicationStageLabels[stage];
}

export function applicationStageTone(stage: TrackerStage): BadgeTone {
  switch (stage) {
    case 'preparing':
      return 'warning';
    case 'applied':
    case 'interviewing':
      return 'brand';
    case 'offer':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * The single step forward this pipeline actually has. Terminal stages return
 * null, and the card hides its advance button rather than offering a move the
 * member did not ask for.
 */
const nextStage: Readonly<Partial<Record<TrackerStage, TrackerStage>>> = {
  saved: 'preparing',
  preparing: 'applied',
  applied: 'interviewing',
  interviewing: 'offer',
};

export function nextApplicationStage(stage: TrackerStage): TrackerStage | null {
  return nextStage[stage] ?? null;
}

/** Stages that clear the scheduled next action when they are entered. */
export const closedApplicationStages: readonly TrackerStage[] = [
  'offer',
  'rejected',
  'withdrawn',
  'archived',
];

// ---------------------------------------------------------------------------
// Application Packs
// ---------------------------------------------------------------------------

export const packStatusLabels: Readonly<Record<PackStatus, string>> = {
  queued: 'Queued',
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
  archived: 'Archived',
};

export function packStatusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = packStatusLabels;
  return labels[status] ?? humanise(status);
}

export function packStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'generating':
      return 'brand';
    case 'ready':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function packStatusExplanation(status: string): string {
  switch (status) {
    case 'queued':
      return 'Waiting to start. Nothing has been drafted for this pack yet.';
    case 'generating':
      return 'Drafting now. An artifact appears here only once it has been written and checked against your confirmed facts.';
    case 'ready':
      return 'Every artifact stored for this pack is listed below.';
    case 'failed':
      return 'Generation stopped before this pack finished.';
    case 'archived':
      return 'This pack is archived and no longer listed with your active packs.';
    default:
      return 'The stored status is shown exactly as the API reported it.';
  }
}

/**
 * Only codes this interface can explain are translated. An unknown code is never
 * guessed at: the stored value is repeated verbatim beside the explanation.
 */
const packFailureCodes: Readonly<Record<string, string>> = {
  insufficient_evidence: 'your career profile had no confirmed facts to draw on',
  no_confirmed_facts: 'your career profile had no confirmed facts to draw on',
  quota_exceeded: 'the monthly Application Pack allowance was already used',
  truth_gate_failed: 'the draft did not pass the truth gate, so nothing was published',
  job_unavailable: 'the opportunity was no longer active',
  generation_timeout: 'generation did not finish in the time allowed',
  provider_error: 'the drafting service did not answer',
};

export function packFailureExplanation(errorCode: string | null): string {
  if (errorCode === null) {
    return 'Generation stopped before it finished and no failure code was recorded for this pack.';
  }
  const reason = packFailureCodes[errorCode];
  if (reason !== undefined) return `Generation stopped because ${reason}.`;
  return 'Generation stopped before it finished. Hanaply recorded a failure code for this pack; this page does not translate an unrecognised code into a reason, so the stored value is shown unchanged.';
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const artifactKindOrder = [
  'resume',
  'cover_letter',
  'strategy',
  'requirement_map',
  'recruiter_message',
  'interview_prep',
] as const satisfies readonly ArtifactKind[];

export type KnownArtifactKind = (typeof artifactKindOrder)[number];

export const artifactKindLabels: Readonly<Record<KnownArtifactKind, string>> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  strategy: 'Application strategy',
  requirement_map: 'Requirement map',
  recruiter_message: 'Recruiter message',
  interview_prep: 'Interview preparation',
};

export const artifactKindDescriptions: Readonly<Record<KnownArtifactKind, string>> = {
  resume: 'Your confirmed experience, arranged for this posting.',
  cover_letter: 'A letter written from the same confirmed facts.',
  strategy: 'How Hanaply reads this opportunity against your profile.',
  requirement_map: 'Each stated requirement beside the confirmed fact that answers it.',
  recruiter_message: 'A short message you can send to the recruiter or hiring team.',
  interview_prep: 'Preparation drawn from your own history for this posting.',
};

export function artifactKindLabel(kind: ArtifactKind): string {
  return artifactKindLabels[kind];
}

export function artifactKindDescription(kind: ArtifactKind): string {
  return artifactKindDescriptions[kind];
}

/** Contract order first, then style, so two runs of the same pack read alike. */
export function sortedArtifacts(
  artifacts: readonly ApplicationArtifact[],
): readonly ApplicationArtifact[] {
  return [...artifacts].sort((left, right) => {
    const byKind = artifactKindOrder.indexOf(left.kind) - artifactKindOrder.indexOf(right.kind);
    if (byKind !== 0) return byKind;
    return (left.style ?? '').localeCompare(right.style ?? '');
  });
}

export const truthGateStatusLabels: Readonly<Record<TruthGateStatus, string>> = {
  passed: 'Grounded in your confirmed facts',
  needs_review: 'Needs your review',
  rejected: 'Not usable',
};

export function truthGateTone(status: TruthGateStatus): BadgeTone {
  if (status === 'passed') return 'success';
  if (status === 'needs_review') return 'warning';
  return 'danger';
}

/**
 * The truth gate is a statement about provenance, never about quality or about
 * anyone having verified the content, so the copy says only that.
 */
export function truthGateExplanation(status: TruthGateStatus): string {
  switch (status) {
    case 'passed':
      return 'Every statement is traceable to career facts you confirmed yourself. Nothing was invented on your behalf. This describes where the wording came from; it is not a claim that Hanaply or an employer has verified the content.';
    case 'needs_review':
      return 'At least one part of this draft could not be matched to a confirmed fact, so the truth gate would not pass it through. Read it and correct anything you cannot support before you use it.';
    case 'rejected':
      return 'The truth gate refused this draft, so it is not offered as something to send. It is kept here so you can see what was produced.';
    default:
      return 'The stored truth-gate result is shown exactly as the API reported it.';
  }
}

export interface ArtifactSection {
  heading: string | null;
  body: string;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  // `typeof value === 'object'` already proved this is a non-null object; the
  // cast only names that for the index signature.
  return value as Readonly<Record<string, unknown>>;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The artifact body is always readable as `plainText`. The structured `content`
 * record is only used for the two shapes this interface can render without
 * guessing — a list of sections, or a list of paragraphs. Any other shape
 * returns null and the caller renders the stored plain text instead, because
 * mis-reading an unknown structure would misrepresent the member's own record.
 */
export function artifactSections(
  content: Readonly<Record<string, unknown>>,
): readonly ArtifactSection[] | null {
  const rawSections = content.sections;
  if (Array.isArray(rawSections) && rawSections.length > 0) {
    const sections: ArtifactSection[] = [];
    for (const entry of rawSections) {
      const record = asRecord(entry);
      if (record === null) return null;
      const body = nonEmptyText(record.body);
      if (body === null) return null;
      sections.push({ heading: nonEmptyText(record.heading), body });
    }
    return sections;
  }

  const rawParagraphs = content.paragraphs;
  if (Array.isArray(rawParagraphs) && rawParagraphs.length > 0) {
    const paragraphs: ArtifactSection[] = [];
    for (const entry of rawParagraphs) {
      const body = nonEmptyText(entry);
      if (body === null) return null;
      paragraphs.push({ heading: null, body });
    }
    return paragraphs;
  }

  return null;
}

/** `plainText` split on blank lines, so paragraph breaks survive rendering. */
export function plainTextParagraphs(plainText: string): readonly string[] {
  return plainText
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export const usageFeatureLabels: Readonly<Record<string, string>> = {
  application_pack: 'Application Packs',
  resume_variant: 'Tailored resumes',
  cover_letter: 'Cover letters',
  ai_analysis: 'AI analysis',
  interview_prep: 'Interview preparation',
  recruiter_message: 'Recruiter messages',
  coach_message: 'Coach messages',
};

export function usageFeatureLabel(feature: string): string {
  return usageFeatureLabels[feature] ?? humanise(feature);
}

const usagePeriodFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

/**
 * `periodStart` and `periodEnd` are calendar dates, not instants, so they are
 * formatted from their parts in UTC rather than shifted into a local day.
 */
export function formatIsoDate(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return usagePeriodFormatter.format(date);
}

export function usagePeriodLabel(periodStart: string, periodEnd: string): string {
  const start = formatIsoDate(periodStart);
  const end = formatIsoDate(periodEnd);
  if (start === null && end === null) return 'The API did not report a billing period.';
  if (start === null) return `Until ${end ?? 'an unreported date'}`;
  if (end === null) return `From ${start}`;
  return `${start} – ${end}`;
}

export interface UsageProgress {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  /** Rounded for the bar only; the exact figures are always shown as text. */
  percent: number;
  exhausted: boolean;
  included: boolean;
}

/**
 * One row per feature the plan meters. A zero limit means the plan does not
 * include the feature at all, which is a different sentence from "none left".
 */
export function usageProgress(item: {
  feature: string;
  used: number;
  limit: number;
  remaining: number;
}): UsageProgress {
  const included = item.limit > 0;
  const ratio = included ? (item.used / item.limit) * 100 : 0;
  return {
    label: usageFeatureLabel(item.feature),
    used: item.used,
    limit: item.limit,
    remaining: item.remaining,
    percent: Math.min(Math.max(Math.round(ratio), 0), 100),
    exhausted: included && item.remaining === 0,
    included,
  };
}
