/**
 * Hanaply Application Pack artifact generation.
 *
 * This module turns a career profile, the confirmed career facts, one job
 * posting, and the match result the pack froze at creation time into the
 * artifacts an Application Pack contains. It is deliberately deterministic and
 * dependency-free: no network call, no language model, no clock, and no
 * randomness. The same inputs always produce byte-identical output, which is
 * what makes a generated resume reviewable rather than merely plausible.
 *
 * The non-negotiable rule is that nothing is invented. Every sentence that
 * asserts experience, a skill, an achievement, a number, an employer, a
 * certification, or a responsibility is traceable to either a confirmed career
 * fact or a structured profile record the subscriber entered themselves. When
 * that evidence does not exist the generator does exactly one of four things,
 * and never a fifth:
 *
 *   1. Omit the claim and the empty section with it.
 *   2. Phrase it truthfully as adjacent or transferable experience, and say so
 *      in the sentence itself ("adjacent to this requirement, not the
 *      requirement itself").
 *   3. Ask: emit an explicit prompt for the subscriber to supply the missing
 *      information.
 *   4. Record it as a gap: an explicit, clearly labelled statement that the
 *      requirement is not evidenced.
 *
 * Two mechanical guarantees back that up. First, the only numbers that can
 * appear in the output are numbers that already exist somewhere in the inputs:
 * the generator never computes, rounds, totals, or scales a figure. Second,
 * `evidenceFactIds` on a draft lists exactly the confirmed facts whose
 * statements the draft quotes - nothing more, so the artifact cannot claim
 * support it did not use, and nothing less, so the database truth gate
 * (`app_private.validate_artifact_evidence`) accepts every draft this module
 * produces.
 *
 * The structured `content` uses the section shape the Application Pack viewer
 * already understands (`{ sections: [{ heading, paragraphs }] }`). Each section
 * additionally carries `body` (the same paragraphs joined with a blank line),
 * which is the field `artifactSections` in the web client reads, and `sources`,
 * which records the profile record or confirmed fact each paragraph came from.
 * `plainText` is a faithful plain-text rendering of the same headings and
 * paragraphs, with no markup of any kind.
 */

import {
  applicationArtifactKindSchema,
  careerFactSchema,
  careerProfileDetailSchema,
  jobMatchDetailSchema,
  packArtifactStyleSchema,
  packGenerationJobSchema,
  type ApplicationArtifactKind,
  type CareerFact,
  type CareerProfileDetail,
  type PackArtifactStyle,
  type PackGenerationJob,
} from '@hanaply/contracts';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// The frozen match result
// ---------------------------------------------------------------------------

/**
 * The match result as `app_private.job_match_summary` froze it onto the pack.
 *
 * It is `jobMatchDetailSchema` with the free-text arrays narrowed from
 * `unknown` to strings and the data-quality block made explicit, because every
 * one of those strings is quoted verbatim into a strategy artifact and a value
 * this module cannot read is a value it must not print.
 */
export const packMatchSnapshotSchema = jobMatchDetailSchema.extend({
  strengths: z.array(z.string().max(2_000)),
  gaps: z.array(z.string().max(2_000)),
  blockers: z.array(z.string().max(2_000)),
  rejectionRisks: z.array(z.string().max(2_000)),
  dataQuality: z.object({
    profileCompleteness: z.enum(['thin', 'partial', 'solid']),
    jobDetail: z.enum(['thin', 'partial', 'detailed']),
    unknowns: z.array(z.string().max(40)),
  }),
});

export type PackMatchSnapshot = z.infer<typeof packMatchSnapshotSchema>;

/**
 * Reads a frozen `match_snapshot` column value.
 *
 * A pack created before the posting had ever been scored stores `{}` rather
 * than a result, and `{}` is not an empty match result - it is the absence of
 * one. Both that and an unreadable snapshot return null, which every artifact
 * then reports as "no match result was frozen" instead of inventing a verdict.
 */
export function readPackMatchSnapshot(value: unknown): PackMatchSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length === 0) return null;
  const parsed = packMatchSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Input and output types
// ---------------------------------------------------------------------------

export const packGenerationInputSchema = z.object({
  profile: careerProfileDetailSchema,
  facts: z.array(careerFactSchema),
  job: packGenerationJobSchema,
  match: packMatchSnapshotSchema.nullable(),
  kinds: z.array(applicationArtifactKindSchema).min(1).max(6),
  style: packArtifactStyleSchema.optional(),
});

export interface PackGenerationInput {
  readonly profile: CareerProfileDetail;
  readonly facts: readonly CareerFact[];
  readonly job: PackGenerationJob;
  readonly match: PackMatchSnapshot | null;
  readonly kinds: readonly ApplicationArtifactKind[];
  /** Defaults to `standard`. Style changes structure and order, never facts. */
  readonly style?: PackArtifactStyle;
}

export const packArtifactSourceTypeSchema = z.enum([
  'career_fact',
  'career_record',
  'career_profile',
  'job_posting',
]);

export type PackArtifactSourceType = z.infer<typeof packArtifactSourceTypeSchema>;

/**
 * Where one paragraph came from. `paragraphIndex` points at the paragraph in
 * the same section, so an entry in a generated resume carries the identifier of
 * the profile record or confirmed fact that produced it.
 */
export interface PackArtifactSource {
  readonly id: string;
  readonly type: PackArtifactSourceType;
  readonly label: string;
  readonly paragraphIndex: number;
}

export interface PackArtifactSection {
  /** `heading` and `paragraphs` are the shape the Application Pack viewer renders. */
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The same paragraphs joined with a blank line, which is the field the viewer reads. */
  readonly body: string;
  readonly sources: readonly PackArtifactSource[];
}

export interface PackArtifactContent {
  readonly sections: readonly PackArtifactSection[];
}

export interface PackArtifactDraft {
  readonly kind: ApplicationArtifactKind;
  readonly style: PackArtifactStyle;
  readonly title: string;
  readonly plainText: string;
  readonly content: PackArtifactContent;
  /** Exactly the confirmed facts this draft quotes, sorted. */
  readonly evidenceFactIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Words that carry no evidence. Kept deliberately short: the vocabulary only
 * has to stop "with", "and", and "experience" from linking a requirement to an
 * unrelated fact.
 */
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
  'working',
  'team',
  'teams',
  'experience',
  'experienced',
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
  'comfortable',
]);

/** Mirrors the matching engine's tokenizer so vocabulary stays consistent. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9+#.]+/gu, ' ')
    .split(' ')
    .map((token) => token.replace(/^\.+|\.+$/gu, ''))
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function tokenSet(value: string): ReadonlySet<string> {
  return new Set(tokenize(value));
}

/** Overlapping meaningful tokens. Zero means "these are not about the same thing". */
function overlapCount(target: ReadonlySet<string>, source: ReadonlySet<string>): number {
  let overlap = 0;
  for (const token of target) {
    if (source.has(token)) overlap += 1;
  }
  return overlap;
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `2023-02-01` becomes `February 2023`. A date the generator cannot parse is
 * returned untouched rather than reformatted into something it is not.
 */
function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/u.exec(value);
  if (match === null) return value;
  const year = match[1];
  const monthNumber = match[2];
  if (year === undefined || monthNumber === undefined) return value;
  const month = monthNames[Number(monthNumber) - 1];
  if (month === undefined) return value;
  return `${month} ${year}`;
}

function formatRange(startDate: string, endDate: string | null, isCurrent: boolean): string {
  const from = formatMonth(startDate);
  if (isCurrent || endDate === null) return `${from} to present`;
  return `${from} to ${formatMonth(endDate)}`;
}

/**
 * A project may record only one of its two dates. The range is then described
 * with what exists rather than with a start date that was never entered.
 */
function projectDateRange(startDate: string | null, endDate: string | null): string | null {
  if (startDate === null && endDate === null) return null;
  if (startDate === null) return `Completed ${formatMonth(endDate ?? '')}`;
  if (endDate === null) return `${formatMonth(startDate)} onwards`;
  return formatRange(startDate, endDate, false);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return value.slice(0, maximum).trimEnd();
}

/** `a, b, and c` - a list never introduces a number that was not already there. */
function joinList(values: readonly string[]): string {
  const parts = values.filter((value) => value.trim() !== '');
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  const head = parts.slice(0, -1).join(', ');
  const tail = parts[parts.length - 1] ?? '';
  return `${head}, and ${tail}`;
}

/** A non-empty, single-line description of one part of a record. */
function parts(values: readonly (string | null | undefined)[]): string {
  return values
    .map((value) => (value ?? '').trim())
    .filter((value) => value !== '')
    .join(' - ');
}

// ---------------------------------------------------------------------------
// Fact handling
// ---------------------------------------------------------------------------

/** Order confirmed facts by the strength of the claim they make, best first. */
const categoryRank: Readonly<Record<CareerFact['category'], number>> = Object.freeze({
  achievement: 0,
  metric: 1,
  responsibility: 2,
  experience: 3,
  skill: 4,
  certification: 5,
  education: 6,
  preference: 7,
  goal: 8,
});

/** The categories that read as deliverable work on a resume. */
const achievementCategories: readonly CareerFact['category'][] = [
  'achievement',
  'metric',
  'responsibility',
  'experience',
  'skill',
];

/** The statement with its structured metric appended, never a computed figure. */
function factSentence(fact: CareerFact): string {
  if (fact.metricValue === null || fact.metricUnit === null) return fact.statement;
  return `${fact.statement} (${fact.metricValue} ${fact.metricUnit})`;
}

interface RankedFact {
  readonly fact: CareerFact;
  readonly relevance: number;
  readonly hasMetric: boolean;
  readonly categoryRank: number;
}

function rankFacts(
  facts: readonly CareerFact[],
  postingTokens: ReadonlySet<string>,
): readonly RankedFact[] {
  const ranked = facts.map((fact): RankedFact => ({
    fact,
    relevance: overlapCount(postingTokens, tokenSet(fact.statement)),
    hasMetric: fact.metricValue !== null && fact.metricUnit !== null,
    categoryRank: categoryRank[fact.category],
  }));
  return ranked.sort((left, right) => {
    if (left.relevance !== right.relevance) return right.relevance - left.relevance;
    if (left.hasMetric !== right.hasMetric) return left.hasMetric ? -1 : 1;
    if (left.categoryRank !== right.categoryRank) return left.categoryRank - right.categoryRank;
    if (left.fact.statement.length !== right.fact.statement.length) {
      return left.fact.statement.length - right.fact.statement.length;
    }
    return left.fact.id.localeCompare(right.fact.id);
  });
}

/**
 * The single confirmed fact that best supports a piece of text, or null when
 * nothing in the ledger shares a meaningful term with it. A fact is never
 * attached on the strength of a shared stop word.
 */
function bestSupportingFact(
  facts: readonly CareerFact[],
  target: string,
  extraVocabulary: readonly string[] = [],
): CareerFact | null {
  const targetTokens = tokenSet(`${target} ${extraVocabulary.join(' ')}`);
  if (targetTokens.size === 0) return null;
  let best: { fact: CareerFact; overlap: number } | null = null;
  for (const fact of facts) {
    const overlap = overlapCount(targetTokens, tokenSet(fact.statement));
    if (overlap === 0) continue;
    if (best === null || overlap > best.overlap) best = { fact, overlap };
  }
  return best === null ? null : best.fact;
}

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

interface SourceRef {
  readonly id: string;
  readonly type: PackArtifactSourceType;
  readonly label: string;
}

interface BlockEntry {
  readonly paragraphs: readonly string[];
  readonly sources: readonly SourceRef[];
}

interface ContentBlock {
  readonly key: string;
  readonly entries: readonly BlockEntry[];
}

interface SectionSpec {
  readonly heading: string;
  readonly keys: readonly string[];
  readonly merge: boolean;
}

function entry(paragraphs: readonly string[], sources: readonly SourceRef[] = []): BlockEntry {
  return { paragraphs, sources };
}

/** A block with no paragraphs is dropped so an empty heading is never emitted. */
function textBlock(
  key: string,
  paragraphs: readonly string[],
  sources: readonly SourceRef[] = [],
): ContentBlock | null {
  if (paragraphs.length === 0) return null;
  return { key, entries: [entry(paragraphs, sources)] };
}

function compact(blocks: readonly (ContentBlock | null)[]): readonly ContentBlock[] {
  return blocks.filter((block): block is ContentBlock => block !== null);
}

function sectionSpec(heading: string, keys: readonly string[], merge = false): SectionSpec {
  return { heading, keys, merge };
}

function dedupeSources(sources: readonly PackArtifactSource[]): readonly PackArtifactSource[] {
  const seen = new Set<string>();
  const result: PackArtifactSource[] = [];
  for (const source of sources) {
    const marker = `${source.type}:${source.id}:${source.paragraphIndex}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    result.push(source);
  }
  return result;
}

/**
 * Places blocks into sections.
 *
 * A block listed in no spec is still emitted, under a clearly labelled final
 * section, so a layout mistake can never silently drop a requirement or a
 * record. Omitting a section whose blocks are all empty is the other half of
 * the rule: no heading without content.
 */
function layoutSections(
  blocks: readonly ContentBlock[],
  specs: readonly SectionSpec[],
): readonly PackArtifactSection[] {
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const placed = new Set<string>();
  const sections: PackArtifactSection[] = [];

  const place = (heading: string, keys: readonly string[], merge: boolean): void => {
    const paragraphs: string[] = [];
    const sources: PackArtifactSource[] = [];
    for (const key of keys) {
      const block = byKey.get(key);
      if (block === undefined || placed.has(key)) continue;
      placed.add(key);
      for (const item of block.entries) {
        for (const paragraph of item.paragraphs) {
          paragraphs.push(paragraph);
          for (const source of item.sources) {
            sources.push({ ...source, paragraphIndex: paragraphs.length - 1 });
          }
        }
      }
    }
    if (paragraphs.length === 0) return;
    if (merge) {
      const merged = paragraphs.join(' ');
      sections.push({
        heading,
        paragraphs: [merged],
        body: merged,
        sources: dedupeSources(sources.map((source) => ({ ...source, paragraphIndex: 0 }))),
      });
      return;
    }
    sections.push({
      heading,
      paragraphs,
      body: paragraphs.join('\n\n'),
      sources: dedupeSources(sources),
    });
  };

  for (const spec of specs) place(spec.heading, spec.keys, spec.merge);
  const unplaced = blocks.filter((block) => !placed.has(block.key));
  if (unplaced.length > 0) {
    place(
      'Additional confirmed detail',
      unplaced.map((block) => block.key),
      false,
    );
  }
  return sections;
}

function renderPlainText(sections: readonly PackArtifactSection[]): string {
  return sections
    .map((section) => `${section.heading}\n\n${section.paragraphs.join('\n\n')}`)
    .join('\n\n');
}

const kindLabels: Readonly<Record<ApplicationArtifactKind, string>> = Object.freeze({
  resume: 'Resume',
  cover_letter: 'Cover letter',
  strategy: 'Application strategy',
  requirement_map: 'Requirement map',
  recruiter_message: 'Recruiter message',
  interview_prep: 'Interview preparation',
});

const styleLabels: Readonly<Record<PackArtifactStyle, string>> = Object.freeze({
  concise: 'concise',
  standard: 'standard',
  achievement_led: 'achievement led',
});

function composeTitle(
  kind: ApplicationArtifactKind,
  style: PackArtifactStyle,
  job: PackGenerationJob,
): string {
  const suffix = ` (${styleLabels[style]})`;
  const base = `${kindLabels[kind]} for ${job.title} at ${job.companyName}`;
  return `${truncate(base, 200 - suffix.length)}${suffix}`;
}

/**
 * The one section emitted when a kind has nothing at all to assemble. It is an
 * explicit statement about the missing evidence rather than an empty document.
 */
function missingEvidenceSection(kind: ApplicationArtifactKind): PackArtifactSection {
  const paragraphs = [
    'Nothing could be assembled for this artifact yet. No professional headline, summary, employment record, project, education entry, certification, skill, or confirmed career fact exists on this career profile.',
    'Nothing has been written in its place: Hanaply does not invent experience, employers, dates, or numbers. Complete the career profile and confirm the facts that are true, then generate this artifact again.',
  ];
  const heading = `${kindLabels[kind]}: nothing to assemble yet`;
  return { heading, paragraphs, body: paragraphs.join('\n\n'), sources: [] };
}

function finalizeDraft(
  kind: ApplicationArtifactKind,
  style: PackArtifactStyle,
  title: string,
  sections: readonly PackArtifactSection[],
): PackArtifactDraft {
  const finalSections = sections.length > 0 ? sections : [missingEvidenceSection(kind)];
  const factIds = new Set<string>();
  for (const section of finalSections) {
    for (const source of section.sources) {
      if (source.type === 'career_fact') factIds.add(source.id);
    }
  }
  return {
    kind,
    style,
    title,
    content: { sections: finalSections },
    plainText: renderPlainText(finalSections),
    evidenceFactIds: [...factIds].sort(),
  };
}

// ---------------------------------------------------------------------------
// Requirement coverage
// ---------------------------------------------------------------------------

type RequirementStatus = 'met' | 'partially_met' | 'unmet' | 'unknown';

interface RequirementEntry {
  readonly requirement: string;
  readonly status: RequirementStatus;
  readonly matchedSkills: readonly string[];
  /** The match engine's own evidence line, quoted verbatim when it exists. */
  readonly profileEvidence: string | null;
  /** The confirmed fact whose statement is quoted for this requirement. */
  readonly fact: CareerFact | null;
}

/**
 * One entry per job requirement. Requirements come from the frozen
 * `requirementMapping`; when the pack predates a match result they come from
 * the posting's own requirement list, so a requirement is never silently
 * dropped merely because the score was never computed.
 */
function buildRequirementEntries(context: GeneratorContext): readonly RequirementEntry[] {
  const mapping = context.match?.requirementMapping ?? [];
  if (mapping.length > 0) {
    return mapping.map((item) => ({
      requirement: item.requirement,
      status: item.status,
      matchedSkills: item.matchedSkills,
      profileEvidence: item.evidence,
      fact: bestSupportingFact(context.facts, item.requirement, item.matchedSkills),
    }));
  }
  const fallback = [...context.job.requirements, ...context.job.preferredQualifications].slice(
    0,
    12,
  );
  return fallback.map((requirement) => ({
    requirement,
    status: 'unknown',
    matchedSkills: [],
    profileEvidence: null,
    fact: bestSupportingFact(context.facts, requirement),
  }));
}

function requirementStatusParagraph(statusItem: RequirementStatus): string {
  switch (statusItem) {
    case 'met':
      return 'Status: met.';
    case 'partially_met':
      return 'Status: partially met.';
    case 'unmet':
      return 'Status: not evidenced.';
    default:
      return 'Status: not judged. The match result could not check this requirement against your profile.';
  }
}

function requirementGapParagraph(requirement: string): string {
  return `Gap: "${requirement}" is not evidenced by any confirmed career fact on this profile, so nothing here claims it.`;
}

function requirementEvidenceParagraph(requirement: RequirementEntry): string | null {
  const { fact } = requirement;
  if (fact === null) {
    if (requirement.status === 'met' || requirement.status === 'partially_met') {
      return 'This requirement is not evidenced by a confirmed career fact yet, even though your profile mentions it. Confirm the fact on your profile so this entry can quote it instead of paraphrasing it.';
    }
    return null;
  }
  const sentence = factSentence(fact);
  if (requirement.status === 'met') {
    return `Confirmed evidence: "${sentence}"`;
  }
  if (requirement.status === 'partially_met') {
    return `Partially evidenced by this confirmed fact: "${sentence}" The remainder of the requirement is not evidenced.`;
  }
  return `Closest confirmed evidence: "${sentence}" This is adjacent experience, not the requirement itself.`;
}

function requirementSources(requirement: RequirementEntry): readonly SourceRef[] {
  const sources: SourceRef[] = [];
  if (requirement.fact !== null) {
    sources.push({
      id: requirement.fact.id,
      type: 'career_fact',
      label: requirement.fact.category,
    });
  }
  return sources;
}

/**
 * Paragraphs for one requirement, ordered by style.
 *
 * `standard` puts the requirement in the section heading, so the entry itself
 * only has to state the status. The grouped styles have generic headings, so
 * they name the requirement in the status paragraph instead: a requirement must
 * never become invisible merely because a style regroups the document.
 */
function requirementParagraphs(
  requirement: RequirementEntry,
  style: PackArtifactStyle,
): readonly string[] {
  const status = requirementStatusParagraph(requirement.status);
  const namedStatus = `Requirement: "${requirement.requirement}". ${status}`;
  const evidence = requirementEvidenceParagraph(requirement);
  const profile = requirement.profileEvidence;
  const met = requirement.status === 'met' || requirement.status === 'partially_met';
  const gap = met ? null : requirementGapParagraph(requirement.requirement);

  if (style === 'achievement_led') {
    return [evidence, profile, namedStatus, gap].filter(
      (value): value is string => value !== null,
    );
  }
  if (style === 'concise') {
    const pieces = [namedStatus, profile, evidence, gap].filter(
      (value): value is string => value !== null,
    );
    return [pieces.join(' ')];
  }
  return [status, profile, evidence, gap].filter((value): value is string => value !== null);
}

function buildRequirementMapDraft(context: GeneratorContext): PackArtifactDraft {
  const requirements = buildRequirementEntries(context);
  const blocks: ContentBlock[] = requirements.map((requirement, index) => ({
    key: `requirement-${index}`,
    entries: [
      entry(requirementParagraphs(requirement, context.style), requirementSources(requirement)),
    ],
  }));

  const specs: SectionSpec[] = [];
  if (context.style === 'concise') {
    specs.push(
      sectionSpec(
        'Requirement coverage',
        blocks.map((block) => block.key),
      ),
    );
  } else if (context.style === 'achievement_led') {
    const covered = requirements
      .map((requirement, index) => ({ requirement, index }))
      .filter(
        ({ requirement }) => requirement.status === 'met' || requirement.status === 'partially_met',
      )
      .map(({ index }) => `requirement-${index}`);
    const uncovered = requirements
      .map((requirement, index) => ({ requirement, index }))
      .filter(
        ({ requirement }) => requirement.status !== 'met' && requirement.status !== 'partially_met',
      )
      .map(({ index }) => `requirement-${index}`);
    if (covered.length > 0) {
      specs.push(sectionSpec('Requirements your confirmed record covers', covered));
    }
    if (uncovered.length > 0) {
      specs.push(sectionSpec('Requirements with no confirmed evidence yet', uncovered));
    }
  } else {
    for (const [index, requirement] of requirements.entries()) {
      specs.push(sectionSpec(truncate(requirement.requirement, 180), [`requirement-${index}`]));
    }
  }

  return finalizeDraft(
    'requirement_map',
    context.style,
    composeTitle('requirement_map', context.style, context.job),
    layoutSections(blocks, specs),
  );
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

const verdictLabels: Readonly<Record<string, string>> = Object.freeze({
  strong_match: 'Strong match',
  good_match: 'Good match',
  stretch: 'Stretch opportunity',
  weak_match: 'Weak match',
  not_recommended: 'Not recommended',
});

const confidenceLabels: Readonly<Record<string, string>> = Object.freeze({
  high: 'High',
  medium: 'Medium',
  low: 'Low',
});

/** Every number quoted here is already in the frozen match snapshot. */
function buildStrategyDraft(context: GeneratorContext): PackArtifactDraft {
  const { match } = context;
  const evidenceFacts = rankFacts(context.facts, postingTokens(context)).slice(0, 3);

  if (match === null) {
    const blocks = compact([
      textBlock('verdict', [
        'No match result was frozen for this Application Pack, so there is no score, no verdict, and no dimension breakdown to report.',
        'Hanaply does not estimate a score here. Recompute the match for this opportunity, then generate the strategy again.',
      ]),
    ]);
    return finalizeDraft(
      'strategy',
      context.style,
      composeTitle('strategy', context.style, context.job),
      layoutSections(blocks, [sectionSpec('Match verdict', ['verdict'])]),
    );
  }

  const verdictParagraphs = [
    `Verdict: ${verdictLabels[match.verdict] ?? match.verdict}.`,
    `Score: ${match.score}.`,
    `Confidence: ${confidenceLabels[match.confidence] ?? match.confidence}.`,
    `Model version: ${match.modelVersion}.`,
    `Profile data quality: ${match.dataQuality.profileCompleteness}; posting detail: ${match.dataQuality.jobDetail}.`,
  ];
  const unknownLabels = match.dataQuality.unknowns.map((key) => {
    const dimension = match.dimensions.find((candidate) => candidate.key === key);
    return dimension === undefined ? key : dimension.label;
  });
  if (unknownLabels.length > 0) {
    verdictParagraphs.push(
      `Dimensions the available data could not judge: ${joinList(unknownLabels)}.`,
    );
  }

  const dimensionParagraphs = match.dimensions.map((dimension) => {
    if (dimension.score === null) {
      return `${dimension.label}: not judged from the available data (weight ${dimension.weight}). ${dimension.detail}`;
    }
    return `${dimension.label}: score ${dimension.score}, weight ${dimension.weight}, contributing ${dimension.contribution}. ${dimension.detail}`;
  });

  const evidenceParagraphs =
    evidenceFacts.length === 0
      ? [
          'No confirmed career fact exists on this profile yet, so there is no evidence to lead with. Confirm the facts that are true before relying on this strategy.',
        ]
      : [
          'The strongest confirmed facts for this posting, quoted from your own ledger:',
          // The statement is quoted as it stands. The structured metric is not
          // appended here: a strategy reports the frozen score and its
          // dimensions, and a confirmed statement is the only other thing it may
          // repeat, so no number in this artifact originates with the generator.
          ...evidenceFacts.map((ranked) => `- "${ranked.fact.statement}"`),
          ...(match.strengths.length === 0
            ? []
            : [
                'The match result recorded these strengths:',
                ...match.strengths.map((strength) => `- ${strength}`),
              ]),
        ];

  const blockerParagraphs =
    match.blockers.length === 0
      ? ['No hard blocker was recorded in the frozen match result.']
      : match.blockers.map((blocker) => `- ${blocker}`);

  const riskParagraphs =
    match.rejectionRisks.length === 0
      ? ['No rejection risk was recorded in the frozen match result.']
      : match.rejectionRisks.map((risk) => `- ${risk}`);

  const blocks = compact([
    textBlock('verdict', verdictParagraphs),
    textBlock('dimensions', dimensionParagraphs),
    textBlock(
      'evidence',
      evidenceParagraphs,
      evidenceFacts.map((ranked) => ({
        id: ranked.fact.id,
        type: 'career_fact' as const,
        label: ranked.fact.category,
      })),
    ),
    textBlock('blockers', blockerParagraphs),
    textBlock('risks', riskParagraphs),
    textBlock('action', [match.recommendedAction]),
  ]);

  const specs: SectionSpec[] =
    context.style === 'concise'
      ? [
          sectionSpec('Verdict and next action', ['verdict', 'action']),
          sectionSpec('Evidence', ['evidence']),
          sectionSpec('Blockers and risks', ['blockers', 'risks'], true),
          sectionSpec('Dimensions', ['dimensions']),
        ]
      : context.style === 'achievement_led'
        ? [
            sectionSpec('Strongest confirmed evidence', ['evidence']),
            sectionSpec('Match verdict', ['verdict']),
            sectionSpec('Dimension contributions', ['dimensions']),
            sectionSpec('Hard blockers', ['blockers']),
            sectionSpec('Rejection risks', ['risks']),
            sectionSpec('Recommended next action', ['action']),
          ]
        : [
            sectionSpec('Match verdict', ['verdict']),
            sectionSpec('Dimension contributions', ['dimensions']),
            sectionSpec('Strongest confirmed evidence', ['evidence']),
            sectionSpec('Hard blockers', ['blockers']),
            sectionSpec('Rejection risks', ['risks']),
            sectionSpec('Recommended next action', ['action']),
          ];

  return finalizeDraft(
    'strategy',
    context.style,
    composeTitle('strategy', context.style, context.job),
    layoutSections(blocks, specs),
  );
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

function buildResumeDraft(context: GeneratorContext): PackArtifactDraft {
  const { profile } = context;
  const rankedFacts = rankFacts(context.facts, postingTokens(context));
  const usedFactIds = new Set<string>();
  const blocks: (ContentBlock | null)[] = [];

  const summaryParagraphs = [
    profile.headline,
    profile.summary,
    profile.currentRoleTitle === null || profile.yearsExperience === null
      ? null
      : `${profile.currentRoleTitle} with ${profile.yearsExperience} years of recorded experience.`,
    profile.targetRoleTitles.length === 0
      ? null
      : `Target roles: ${joinList(profile.targetRoleTitles)}.`,
  ].filter((value): value is string => value !== null && value.trim() !== '');
  blocks.push(
    textBlock('summary', summaryParagraphs, [
      { id: profile.id, type: 'career_profile', label: 'career profile' },
    ]),
  );

  const experienceEntries: BlockEntry[] = profile.employment.map((employment) => {
    const sources: SourceRef[] = [
      { id: employment.id, type: 'career_record', label: 'employment' },
    ];
    const paragraphs = [
      `${employment.roleTitle} at ${employment.companyName}`,
      parts([
        formatRange(employment.startDate, employment.endDate, employment.isCurrent),
        employment.location,
        employment.workArrangement,
      ]),
      employment.summary,
      ...employment.highlights.map((highlight) => {
        const fact = bestSupportingFact(context.facts, highlight);
        if (fact !== null) {
          usedFactIds.add(fact.id);
          sources.push({ id: fact.id, type: 'career_fact', label: fact.category });
        }
        return highlight;
      }),
    ].filter((value): value is string => value !== null && value.trim() !== '');
    return entry(paragraphs, sources);
  });
  blocks.push({ key: 'experience', entries: experienceEntries });

  const projectEntries: BlockEntry[] = profile.projects.map((project) => {
    const sources: SourceRef[] = [{ id: project.id, type: 'career_record', label: 'project' }];
    const paragraphs = [
      parts([project.name, project.roleTitle]),
      projectDateRange(project.startDate, project.endDate),
      project.description,
      ...project.highlights,
      project.skills.length === 0 ? null : `Built with ${joinList(project.skills)}.`,
      project.repositoryUrl,
      project.projectUrl,
    ].filter((value): value is string => value !== null && value.trim() !== '');
    return entry(paragraphs, sources);
  });
  if (projectEntries.length > 0) blocks.push({ key: 'projects', entries: projectEntries });

  const achievementEntries: BlockEntry[] = rankedFacts
    .filter((ranked) => achievementCategories.includes(ranked.fact.category))
    .filter((ranked) => !usedFactIds.has(ranked.fact.id))
    .slice(0, 5)
    .map((ranked) => {
      usedFactIds.add(ranked.fact.id);
      return entry(
        [`- ${factSentence(ranked.fact)}`],
        [{ id: ranked.fact.id, type: 'career_fact', label: ranked.fact.category }],
      );
    });
  if (achievementEntries.length > 0) {
    blocks.push({
      key: 'achievements',
      entries: [
        entry([
          'These statements are quoted word for word from career facts you confirmed yourself:',
        ]),
        ...achievementEntries,
      ],
    });
  }

  const educationEntries: BlockEntry[] = profile.education.map((education) =>
    entry(
      [
        parts([
          education.institution,
          education.degree,
          education.fieldOfStudy,
          education.endYear === null ? null : String(education.endYear),
          education.grade,
        ]),
        education.description,
      ].filter((value): value is string => value !== null && value.trim() !== ''),
      [{ id: education.id, type: 'career_record', label: 'education' }],
    ),
  );
  if (educationEntries.length > 0) blocks.push({ key: 'education', entries: educationEntries });

  const certificationEntries: BlockEntry[] = profile.certifications.map((certification) =>
    entry(
      [
        parts([
          certification.name,
          certification.issuer,
          certification.issuedOn === null ? null : formatMonth(certification.issuedOn),
        ]),
        certification.credentialUrl,
      ].filter((value): value is string => value !== null && value.trim() !== ''),
      [{ id: certification.id, type: 'career_record', label: 'certification' }],
    ),
  );
  if (certificationEntries.length > 0) {
    blocks.push({ key: 'certifications', entries: certificationEntries });
  }

  const skillsParagraph =
    profile.skills.length === 0
      ? []
      : [
          profile.skills
            .map((skill) => (skill.isPrimary ? `${skill.name} (primary)` : skill.name))
            .join(', '),
        ];
  blocks.push(
    textBlock('skills', skillsParagraph, [
      { id: profile.id, type: 'career_profile', label: 'skills' },
    ]),
  );

  const linksParagraph =
    profile.links.length === 0
      ? []
      : profile.links.map((link) => parts([link.label ?? link.linkKind, link.url]));
  blocks.push(
    textBlock(
      'links',
      linksParagraph,
      profile.links.map((link) => ({
        id: link.id,
        type: 'career_record' as const,
        label: link.linkKind,
      })),
    ),
  );

  const present = compact(blocks);
  const specs: SectionSpec[] =
    context.style === 'concise'
      ? [
          sectionSpec('Profile', ['summary'], true),
          sectionSpec('Experience and projects', ['experience', 'projects'], true),
          sectionSpec('Selected achievements', ['achievements'], true),
          sectionSpec('Education and certifications', ['education', 'certifications'], true),
          sectionSpec('Skills', ['skills'], true),
          sectionSpec('Links', ['links'], true),
        ]
      : context.style === 'achievement_led'
        ? [
            sectionSpec('Selected achievements', ['achievements']),
            sectionSpec('Professional summary', ['summary']),
            sectionSpec('Experience', ['experience'], true),
            sectionSpec('Projects', ['projects'], true),
            sectionSpec('Skills', ['skills'], true),
            sectionSpec('Education', ['education']),
            sectionSpec('Certifications', ['certifications']),
            sectionSpec('Links', ['links']),
          ]
        : [
            sectionSpec('Professional summary', ['summary']),
            sectionSpec('Experience', ['experience']),
            sectionSpec('Projects', ['projects']),
            sectionSpec('Selected achievements', ['achievements']),
            sectionSpec('Education', ['education']),
            sectionSpec('Certifications', ['certifications']),
            sectionSpec('Skills', ['skills']),
            sectionSpec('Links', ['links']),
          ];

  return finalizeDraft(
    'resume',
    context.style,
    composeTitle('resume', context.style, context.job),
    layoutSections(present, specs),
  );
}

// ---------------------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------------------

function buildCoverLetterDraft(context: GeneratorContext): PackArtifactDraft {
  const { job, profile, match } = context;
  const requirements = buildRequirementEntries(context);
  const rankedFacts = rankFacts(context.facts, postingTokens(context));
  const cited = rankedFacts.slice(0, 4).map((ranked) => ranked.fact);
  const evidenceSources: SourceRef[] = cited.map((fact) => ({
    id: fact.id,
    type: 'career_fact' as const,
    label: fact.category,
  }));

  const openingParagraphs = [
    `Dear ${job.companyName} hiring team,`,
    `I am applying for the ${job.title} role at ${job.companyName}.`,
    match === null
      ? null
      : `Hanaply recorded this opportunity as a ${verdictLabels[match.verdict] ?? match.verdict} for my profile.`,
  ].filter((value): value is string => value !== null);

  const evidenceParagraphs =
    cited.length === 0
      ? [
          'No confirmed career fact exists on this profile yet, so this letter cites no evidence and claims none. Confirm the facts that are true, then generate this letter again.',
        ]
      : [
          'The following statements are quoted word for word from career facts I confirmed myself:',
          ...cited.map((fact) => `- "${factSentence(fact)}"`),
        ];
  if (cited.length === 1) {
    evidenceParagraphs.push(
      'Only one confirmed career fact exists on this profile so far, which is fewer than the two a letter of this kind normally draws on.',
    );
  }

  const unevidenced = requirements.filter(
    (requirement) => requirement.fact === null || requirement.status === 'partially_met',
  );
  const gapParagraphs =
    unevidenced.length === 0
      ? ['Every requirement this posting lists is backed by a confirmed career fact on my profile.']
      : unevidenced.map(
          (requirement) =>
            `Not evidenced: "${requirement.requirement}" is not evidenced by a confirmed career fact on my profile, so I am not claiming it here.`,
        );

  const closingParagraphs = ['Thank you for considering this application.', profile.name].filter(
    (value) => value.trim() !== '',
  );

  const blocks = compact([
    textBlock('opening', openingParagraphs, [
      { id: job.id, type: 'job_posting', label: 'job posting' },
    ]),
    textBlock('evidence', evidenceParagraphs, evidenceSources),
    textBlock('gaps', gapParagraphs),
    textBlock('closing', closingParagraphs, [
      { id: profile.id, type: 'career_profile', label: 'career profile' },
    ]),
  ]);

  const specs: SectionSpec[] =
    context.style === 'concise'
      ? [
          sectionSpec('Letter', ['opening', 'closing'], true),
          sectionSpec('Confirmed evidence', ['evidence'], true),
          sectionSpec('Not evidenced', ['gaps'], true),
        ]
      : context.style === 'achievement_led'
        ? [
            sectionSpec('Confirmed evidence', ['evidence']),
            sectionSpec('Letter', ['opening']),
            sectionSpec('Not evidenced in this application', ['gaps']),
            sectionSpec('Closing', ['closing']),
          ]
        : [
            sectionSpec('Opening', ['opening']),
            sectionSpec('Confirmed evidence', ['evidence']),
            sectionSpec('Not evidenced in this application', ['gaps']),
            sectionSpec('Closing', ['closing']),
          ];

  return finalizeDraft(
    'cover_letter',
    context.style,
    composeTitle('cover_letter', context.style, context.job),
    layoutSections(blocks, specs),
  );
}

// ---------------------------------------------------------------------------
// Interview preparation
// ---------------------------------------------------------------------------

function buildInterviewPrepDraft(context: GeneratorContext): PackArtifactDraft {
  const requirements = buildRequirementEntries(context);
  const blocks: ContentBlock[] = [];

  blocks.push({
    key: 'intro',
    entries: [
      entry([
        'Each question below comes from a requirement this posting states. The guidance quotes the confirmed career fact to draw on, or says plainly that the requirement is not evidenced by any confirmed fact yet, in which case the honest answer is to say so rather than to claim experience you do not have.',
      ]),
    ],
  });

  requirements.forEach((requirement, index) => {
    const question = `The posting asks for "${requirement.requirement}". What can you describe against it?`;
    const guidance =
      requirement.fact === null
        ? requirement.status === 'met' || requirement.status === 'partially_met'
          ? 'Guidance: your profile covers this requirement, but no confirmed career fact evidences it yet. Confirm the fact on your profile and quote it, rather than paraphrasing a claim you cannot produce.'
          : 'Guidance: this requirement is not evidenced by any confirmed career fact on your profile. Say plainly that you have not done it, and describe the closest work you have actually done instead of claiming experience you do not have.'
        : requirement.status === 'met'
          ? `Guidance: draw on this confirmed fact and describe how it was done - "${factSentence(requirement.fact)}"`
          : requirement.status === 'partially_met'
            ? `Guidance: this requirement is only partially evidenced. Use "${factSentence(requirement.fact)}" and be explicit about the part that is not evidenced.`
            : `Guidance: the requirement itself is not evidenced. The closest confirmed fact is "${factSentence(requirement.fact)}", which is adjacent experience - present it as such and do not claim the requirement.`;
    const sources: SourceRef[] =
      requirement.fact === null
        ? []
        : [{ id: requirement.fact.id, type: 'career_fact', label: requirement.fact.category }];
    blocks.push({
      key: `question-${index}`,
      entries: [entry([`${question} ${guidance}`], sources)],
    });
  });

  const specs: SectionSpec[] =
    context.style === 'concise'
      ? [
          sectionSpec(
            'Likely questions and what to answer with',
            blocks.map((block) => block.key),
          ),
        ]
      : context.style === 'achievement_led'
        ? [
            sectionSpec('Before the interview', ['intro']),
            sectionSpec(
              'Likely questions, evidence first',
              blocks.filter((block) => block.key !== 'intro').map((block) => block.key),
            ),
          ]
        : [
            sectionSpec('How to use this preparation', ['intro']),
            sectionSpec(
              'Likely questions and the evidence to draw on',
              blocks.filter((block) => block.key !== 'intro').map((block) => block.key),
            ),
          ];

  return finalizeDraft(
    'interview_prep',
    context.style,
    composeTitle('interview_prep', context.style, context.job),
    layoutSections(blocks, specs),
  );
}

// ---------------------------------------------------------------------------
// Recruiter message
// ---------------------------------------------------------------------------

function buildRecruiterMessageDraft(context: GeneratorContext): PackArtifactDraft {
  const { job, profile } = context;
  const rankedFacts = rankFacts(context.facts, postingTokens(context)).slice(0, 2);
  const cited = rankedFacts.map((ranked) => ranked.fact);

  const openingParagraphs = [
    `Hello, I am writing about the ${job.title} role at ${job.companyName}.`,
    cited.length === 0
      ? 'I have not confirmed any career facts on my Hanaply profile yet, so I am not going to summarise experience I cannot evidence here.'
      : 'Two things from my record that are directly relevant:',
  ];

  const evidenceParagraphs = cited.map((fact) => `- "${factSentence(fact)}"`);
  const closingParagraph =
    cited.length === 0
      ? 'I would rather send a short, accurate note than an impressive one I cannot support. May I follow up once my profile is confirmed?'
      : 'I would be glad to send the full detail behind either of these. Thank you for your time.';

  const blocks = compact([
    textBlock('opening', openingParagraphs, [
      { id: job.id, type: 'job_posting', label: 'job posting' },
    ]),
    textBlock(
      'evidence',
      evidenceParagraphs,
      cited.map((fact) => ({
        id: fact.id,
        type: 'career_fact' as const,
        label: fact.category,
      })),
    ),
    textBlock(
      'closing',
      [closingParagraph],
      [{ id: profile.id, type: 'career_profile', label: 'career profile' }],
    ),
  ]);

  const specs: SectionSpec[] =
    context.style === 'concise'
      ? [sectionSpec('Message', ['opening', 'evidence', 'closing'], true)]
      : context.style === 'achievement_led'
        ? [
            sectionSpec('What I would lead with', ['evidence']),
            sectionSpec('Message', ['opening', 'closing']),
          ]
        : [
            sectionSpec('Message', ['opening']),
            sectionSpec('Relevant confirmed record', ['evidence']),
            sectionSpec('Closing', ['closing']),
          ];

  return finalizeDraft(
    'recruiter_message',
    context.style,
    composeTitle('recruiter_message', context.style, context.job),
    layoutSections(blocks, specs),
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface GeneratorContext {
  readonly profile: CareerProfileDetail;
  readonly facts: readonly CareerFact[];
  readonly job: PackGenerationJob;
  readonly match: PackMatchSnapshot | null;
  readonly style: PackArtifactStyle;
}

/**
 * The vocabulary the posting is about. The full description is deliberately
 * excluded: it is the noisiest field on the record and would let a generic word
 * make an unrelated fact look relevant.
 */
function postingTokens(context: GeneratorContext): ReadonlySet<string> {
  const mapping = context.match?.requirementMapping ?? [];
  return tokenSet(
    [
      context.job.title,
      ...context.job.skills,
      ...context.job.requirements,
      ...context.job.preferredQualifications,
      ...mapping.map((item) => item.requirement),
      ...mapping.flatMap((item) => item.matchedSkills),
    ].join(' '),
  );
}

function buildDraft(context: GeneratorContext, kind: ApplicationArtifactKind): PackArtifactDraft {
  switch (kind) {
    case 'resume':
      return buildResumeDraft(context);
    case 'cover_letter':
      return buildCoverLetterDraft(context);
    case 'strategy':
      return buildStrategyDraft(context);
    case 'requirement_map':
      return buildRequirementMapDraft(context);
    case 'recruiter_message':
      return buildRecruiterMessageDraft(context);
    default:
      return buildInterviewPrepDraft(context);
  }
}

/**
 * Generates one artifact draft per requested kind, in the order requested.
 *
 * This is a pure function of its input. It reads no clock, performs no I/O, and
 * uses no randomness, so the same profile, facts, posting, match snapshot,
 * kinds, and style always produce byte-identical drafts. The caller is
 * responsible for persisting them through `public.record_application_artifact`,
 * which applies the database truth gate.
 */
export function generatePackArtifacts(input: PackGenerationInput): readonly PackArtifactDraft[] {
  const parsed = packGenerationInputSchema.parse(input);
  const style: PackArtifactStyle = parsed.style ?? 'standard';
  const context: GeneratorContext = {
    profile: parsed.profile,
    // Sorted by identifier so the output cannot depend on the order the rows
    // arrived in.
    facts: [...parsed.facts].sort((left, right) => left.id.localeCompare(right.id)),
    job: parsed.job,
    match: parsed.match,
    style,
  };
  return parsed.kinds.map((kind) => buildDraft(context, kind));
}
