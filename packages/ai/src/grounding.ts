/**
 * The truth gate.
 *
 * The hard rule is that the model may never originate a factual claim about the
 * member. Prompt wording is a hint; this module is the guarantee. It runs on
 * every model response, before the caller ever sees a value, and it either
 * returns a response whose every claim is traceable to admitted evidence or
 * refuses the response outright.
 *
 * Four checks are mechanical rather than judgemental:
 *
 *   1. **Fact citations.** Every identifier in an `evidenceFactIds` list must be
 *      a confirmed career fact that was supplied to the model. A citation the
 *      database trigger would reject is a citation this gate rejects first.
 *   2. **Numbers.** Every numeric literal in generated prose must already exist
 *      in the evidence: a confirmed fact's statement or structured metric, the
 *      deterministic match analysis, or the posting's own text. A model may
 *      quote a figure; it may never compute, round, scale, or invent one.
 *   3. **First-person experience.** A sentence that asserts what the member has
 *      done - "I led", "I have eight years", "my experience with" - must be
 *      backed by a confirmed fact. An uncited one is rejected, which is the
 *      failure mode that matters most for a product that writes application
 *      material.
 *   4. **Named entities.** A capitalised name that is not in the evidence is
 *      rejected. This is what stops an invented employer, job title, school, or
 *      certification from reaching a cover letter.
 *
 * The gate fails closed. An unparseable response, an ambiguous citation, an
 * unrecognised shape: all rejections, never a guess. Rejections are reported per
 * claim so a caller can regenerate or drop the individual claim instead of
 * discarding an otherwise usable response.
 *
 * This module is deliberately conservative about what counts as evidence. It
 * indexes the confirmed facts, the matching engine's own strings, and the
 * structured job record, and it never indexes the model's own output, so a claim
 * cannot become true by being repeated.
 */

import type {
  AiProviderError,
  AiProviderKind,
  AiResponseMetadata,
  AiTaskKind,
  GroundedTaskOutput,
  GroundingClaimKind,
  GroundingClaimResult,
  GroundingContext,
  GroundingRejection,
  GroundingReport,
} from './types.js';
import { AiProviderError as AiProviderErrorConstructor } from './types.js';

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

const combiningMarks = /[\u0300-\u036F]/gu;

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(combiningMarks, '')
    .replace(/[^a-z0-9+#.%$]+/gu, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .replace(/[%$]/gu, ' ')
    .split(' ')
    .map((token) => token.replace(/^\.+|\.+$/gu, ''))
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

/**
 * Words that may legitimately open a sentence or stand alone as a capitalised
 * word without being evidence. Kept to closed-class words, imperatives, and the
 * product's own vocabulary: anything substantive that is not here has to appear
 * in the evidence.
 */
const sentenceSafeCapitalised = new Set([
  'a',
  'about',
  'add',
  'address',
  'after',
  'also',
  'am',
  'an',
  'and',
  'answer',
  'application',
  'apply',
  'are',
  'as',
  'ask',
  'at',
  'avoid',
  'be',
  'because',
  'been',
  'before',
  'begin',
  'being',
  'between',
  'both',
  'bring',
  'build',
  'but',
  'by',
  'can',
  'candidate',
  'career',
  'cebu',
  'check',
  'claim',
  'coach',
  'compare',
  'company',
  'confirm',
  'consider',
  'contract',
  'could',
  'cover',
  'cv',
  'davao',
  'dear',
  'describe',
  'did',
  'didn',
  'discuss',
  'do',
  'does',
  'doesn',
  'don',
  'draft',
  'during',
  'each',
  'either',
  'email',
  'employer',
  'every',
  'example',
  'explain',
  'finally',
  'first',
  'focus',
  'follow',
  'for',
  'four',
  'frame',
  'from',
  'full',
  'furthermore',
  'hanaply',
  'has',
  'have',
  'having',
  'he',
  'hello',
  'her',
  'here',
  'hi',
  'highlight',
  'his',
  'how',
  'however',
  'hybrid',
  'i',
  'if',
  'in',
  'instead',
  'interview',
  'into',
  'is',
  'it',
  'its',
  'job',
  'keep',
  'lead',
  'letter',
  'list',
  'location',
  'manila',
  'may',
  'me',
  'meanwhile',
  'mention',
  'might',
  'mine',
  'moreover',
  'must',
  'my',
  'name',
  'neither',
  'nevertheless',
  'new',
  'next',
  'no',
  'none',
  'nor',
  'not',
  'note',
  'now',
  'of',
  'offer',
  'on',
  'one',
  'only',
  'onsite',
  'or',
  'other',
  'our',
  'ours',
  'part',
  'philippines',
  'position',
  'posting',
  'practice',
  'prepare',
  'ps',
  'put',
  'quantify',
  'recruiter',
  'reference',
  'regards',
  'remote',
  'research',
  'resume',
  'review',
  'revisit',
  'role',
  'salary',
  'say',
  'second',
  'send',
  'she',
  'should',
  'sincerely',
  'so',
  'start',
  'state',
  'still',
  'summary',
  'team',
  'tell',
  'than',
  'thank',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'therefore',
  'these',
  'they',
  'third',
  'this',
  'those',
  'thus',
  'time',
  'to',
  'try',
  'two',
  'use',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'while',
  'who',
  'whom',
  'whose',
  'why',
  'will',
  'with',
  'within',
  'without',
  'would',
  'write',
  'yet',
  'you',
  'your',
  'yours',
]);

/**
 * First-person assertions, including the bare quantified form ("8 years of
 * experience") that a resume summary uses without ever writing "I".
 */
const firstPersonPatterns: readonly RegExp[] = [
  /\bI\s+(?:have|had|hold|held|am|was|built|led|lead|managed|delivered|shipped|created|designed|developed|implemented|improved|increased|reduced|launched|owned|drove|grew|mentored|coordinated|automated|migrated|wrote|worked|supported|handled|achieved|earned|completed|studied|graduated|trained|taught|ran|started|founded|specialise|specialize)\b/u,
  // Any other verb after "I", so "I rebuilt ..." and "I rewrote ..." are covered
  // without an ever-growing verb list.
  /\bI\s+\p{Ll}/u,
  /\bI(?:'|’)?(?:m|ve|d|ll)\s+\w+/u,
  /\bmy\s+(?:experience|background|work|career|skills?|record|achievements?|projects?|role|time|years|degree|education|certifications?|portfolio|expertise|track\s+record)\b/iu,
  /\bwe\s+(?:built|led|managed|delivered|shipped|created|designed|developed|implemented|improved|increased|reduced|launched|grew|migrated|automated|rebuilt|rewrote)\b/iu,
  /\b\d[\d,]*(?:\.\d+)?\+?\s*(?:years?|yrs?)\b/iu,
  /\b(?:over|more\s+than|nearly|almost|about)\s+\w+\s+(?:years?|yrs?)\b/iu,
];

/** Sentence split that keeps the terminating punctuation and drops empties. */
export function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.replace(/\s+/gu, ' ').trim())
    .filter((sentence) => sentence.length > 0);
}

const numberPattern = /\d[\d,]*(?:\.\d+)?/gu;
const wordNumberPattern =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/giu;

const wordNumbers: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
});

function parseNumberLiteral(literal: string): number | null {
  const parsed = Number.parseFloat(literal.replace(/,/gu, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Indexes figures so "1,200", "1200", and "1200.0" are one value and a new one
 * cannot be created by respelling an old one.
 *
 * `withDerivedForms` is the difference between prose and a structured field. A
 * confirmed fact's statement is prose, so "20" in it is a claimable figure
 * whatever the model writes around it. A match detail line such as "weight 12,
 * contributing 97" is a report about the engine, and its fragments are not
 * admissible answers to anything, so only the exact literal is indexed and a
 * model cannot borrow "12" from the word "weight 12" to justify "12 years".
 */
function indexNumbers(text: string, into: Set<string>, withDerivedForms = true): void {
  for (const match of text.matchAll(numberPattern)) {
    const literal = match[0];
    into.add(literal);
    if (!withDerivedForms) continue;
    into.add(literal.replace(/,/gu, ''));
    const parsed = parseNumberLiteral(literal);
    if (parsed !== null) into.add(String(parsed));
  }
  if (!withDerivedForms) return;
  for (const match of text.matchAll(wordNumberPattern)) {
    const word = match[1];
    if (word === undefined) continue;
    const value = wordNumbers[word.toLowerCase()];
    if (value !== undefined) into.add(String(value));
  }
}

// ---------------------------------------------------------------------------
// Evidence index
// ---------------------------------------------------------------------------

export interface EvidenceIndex {
  readonly factIds: ReadonlySet<string>;
  readonly numbers: ReadonlySet<string>;
  readonly unigrams: ReadonlySet<string>;
  readonly bigrams: ReadonlySet<string>;
  readonly factStatements: readonly { readonly id: string; readonly normalized: string }[];
}

function indexVocabulary(text: string, unigrams: Set<string>, bigrams: Set<string>): void {
  // Chunk boundaries are sentence and clause boundaries, so a bigram never
  // spans the end of one requirement and the start of the next: "Kubernetes
  // experience. Supabase" must not make "experience supabase" look evidenced.
  for (const chunk of text.split(/[.;\n|]+/u)) {
    const tokens = tokenize(chunk);
    for (const token of tokens) unigrams.add(token);
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const left = tokens[index];
      const right = tokens[index + 1];
      if (left === undefined || right === undefined) continue;
      bigrams.add(`${left} ${right}`);
    }
  }
}

/**
 * Builds the admissible evidence index.
 *
 * Only confirmed facts, the deterministic match analysis, and the structured
 * job record go in. `profileIdentity` supplies names and record labels the model
 * may refer to; its vocabulary is indexed so a real employer is writable, while
 * its figures are not, so identity is never a licence to quote a number.
 */
export function buildEvidenceIndex(context: GroundingContext): EvidenceIndex {
  // The declared admissible set is authoritative, and nothing widens it. A fact
  // object that is present but was never declared admissible contributes
  // context only: it must not become citable merely by being passed in.
  const factIds = new Set<string>(context.deterministic.admissibleFactIds);
  const numbers = new Set<string>();
  const unigrams = new Set<string>();
  const bigrams = new Set<string>();
  const factStatements: { id: string; normalized: string }[] = [];

  for (const fact of context.facts) {
    indexVocabulary(`${fact.statement} ${fact.category}`, unigrams, bigrams);
    factStatements.push({ id: fact.id, normalized: normalizeText(fact.statement) });
    indexNumbers(fact.statement, numbers);
    // The identifier itself is structural: a response that echoes it is citing
    // evidence, not asserting a figure about anyone.
    indexNumbers(fact.id, numbers);
    const metricValue = fact.metricValue;
    if (metricValue !== null && metricValue !== undefined) {
      indexNumbers(String(metricValue), numbers);
    }
    const unit = fact.metricUnit;
    if (unit !== null && unit !== undefined) indexVocabulary(unit, unigrams, bigrams);
    const metricContext = fact.metricContext;
    if (metricContext !== null && metricContext !== undefined) {
      indexVocabulary(metricContext, unigrams, bigrams);
      indexNumbers(metricContext, numbers);
    }
  }

  const { job, match, profileIdentity } = context.deterministic;

  // The posting is third-party text. A number the posting publishes (a salary,
  // a required number of years) may be quoted; it may not be recomputed.
  for (const value of [
    job.title,
    job.companyName,
    job.location,
    job.employmentType,
    job.seniority,
    ...job.skills,
    ...job.requirements,
    ...job.preferredQualifications,
    job.description,
  ]) {
    if (value === null) continue;
    indexVocabulary(value, unigrams, bigrams);
    indexNumbers(value, numbers);
  }
  // The published compensation is structured, and a range is two figures rather
  // than one run of digits, so both ends are indexed exactly as published.
  if (job.salaryText !== null) {
    indexVocabulary(job.salaryText, unigrams, bigrams);
    for (const literal of job.salaryText.match(numberPattern) ?? []) numbers.add(literal);
  }

  // The deterministic analysis. Its figures are the score, the confidence, and
  // the per-dimension contributions, all computed by the matching engine. Only
  // the score and the dimension numbers are indexed as figures, and only in the
  // form the engine wrote them: the surrounding prose is a report about the
  // engine, and a fragment of it must not become quotable evidence.
  numbers.add(String(match.score));
  for (const value of [match.verdict, match.confidence, match.modelVersion]) {
    indexVocabulary(value, unigrams, bigrams);
  }
  for (const value of [
    ...match.strengths,
    ...match.gaps,
    ...match.blockers,
    ...match.rejectionRisks,
    match.recommendedAction,
  ]) {
    indexVocabulary(value, unigrams, bigrams);
    indexNumbers(value, numbers);
  }
  for (const value of [...match.dimensionDetails, ...match.requirementStatements]) {
    indexVocabulary(value, unigrams, bigrams);
    indexNumbers(value, numbers, false);
  }

  for (const value of [
    profileIdentity.name,
    profileIdentity.headline,
    profileIdentity.currentRoleTitle,
    ...profileIdentity.employers,
    ...profileIdentity.employmentTitles,
    ...profileIdentity.institutions,
    ...profileIdentity.certifications,
    ...profileIdentity.skills,
    ...profileIdentity.industries,
    ...profileIdentity.locations,
  ]) {
    if (value === null) continue;
    indexVocabulary(value, unigrams, bigrams);
  }
  if (profileIdentity.totalYearsExperience !== null) {
    indexNumbers(String(profileIdentity.totalYearsExperience), numbers);
  }

  return { factIds, numbers, unigrams, bigrams, factStatements };
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

function isKnownWord(word: string, index: EvidenceIndex): boolean {
  const normalized = normalizeText(word).replace(/[^a-z0-9+#.]/gu, '');
  if (normalized.length <= 1) return true;
  if (stopWords.has(normalized)) return true;
  if (index.unigrams.has(normalized)) return true;
  return false;
}

/** An ordinary word that happens to be capitalised because it opens a sentence. */
function isOrdinaryOpener(word: string): boolean {
  return isSentenceOpener(word);
}

/**
 * Capitalised runs that look like a name.
 *
 * A run of two or more capitalised tokens is one candidate; a single
 * capitalised token is a candidate only when it is not an ordinary sentence
 * opener, so prose is never rejected merely for starting with "Consider".
 * Callers filter candidates against the evidence, because dropping a leading
 * opener is only safe when the opener is not itself a real name.
 */
export function extractNamedEntityPhrases(sentence: string): string[] {
  const tokens = sentence.split(/\s+/u).filter((token) => token.length > 0);
  const phrases: string[] = [];
  let run: string[] = [];

  const flush = (): void => {
    if (run.length > 0) {
      const phrase = run.join(' ');
      if (phrase.trim().length > 1) phrases.push(phrase);
    }
    run = [];
  };

  for (const [position, token] of tokens.entries()) {
    const stripped = token.replace(/^[^\p{L}\p{N}]+/u, '');
    if (!/^\p{Lu}/u.test(stripped)) {
      flush();
      continue;
    }
    // A single capitalised word that opens a sentence, or that stands alone as a
    // heading, is ordinary prose rather than a name. Only a run of two or more
    // words, or a capitalised word inside a sentence, is evidence of a name.
    const alone = tokens.length === 1;
    if (alone) continue;
    if (position === 0 && isSentenceOpener(stripTrailing(token))) {
      flush();
      continue;
    }
    run.push(stripTrailing(token));
  }
  flush();

  return phrases.filter((phrase) => phrase.split(' ').length >= 2);
}

function isSentenceOpener(word: string): boolean {
  return sentenceSafeCapitalised.has(normalizeText(word).replace(/[^a-z-]/gu, ''));
}

function stripTrailing(token: string): string {
  return token.replace(/[^\p{L}\p{N}'’.-]+$/u, '');
}

interface ExtractedClaim {
  readonly kind: GroundingClaimKind;
  readonly text: string;
  readonly status: 'supported' | 'rejected';
  readonly reason: string | null;
  readonly factId: string | null;
}

/**
 * The confirmed fact a sentence is a claim about, or null.
 *
 * Two ways to qualify, and nothing weaker: the sentence quotes the fact's own
 * statement, or it shares enough of the fact's vocabulary that it is evidently
 * the same claim. A single shared word is never enough, because borrowing one
 * word is exactly how a fabricated claim would try to look supported.
 */
function supportingFact(sentence: string, index: EvidenceIndex): string | null {
  const normalizedSentence = normalizeText(sentence);
  const sentenceTokens = new Set(tokenize(sentence));
  let best: { id: string; ratio: number } | null = null;

  for (const fact of index.factStatements) {
    if (fact.normalized.length > 8 && normalizedSentence.includes(fact.normalized)) return fact.id;
    const factTokens = new Set(tokenize(fact.normalized));
    if (factTokens.size === 0) continue;
    let overlap = 0;
    for (const token of factTokens) {
      if (sentenceTokens.has(token)) overlap += 1;
    }
    if (overlap < 2) continue;
    const ratio = overlap / factTokens.size;
    if (ratio < 0.6) continue;
    if (best === null || ratio > best.ratio) best = { id: fact.id, ratio };
  }
  return best === null ? null : best.id;
}

export interface ExtractClaimsOptions {
  /** Suppresses the experience check, used inside explicitly labelled inference. */
  readonly skipExperienceClaims?: boolean;
  /** Suppresses the named-entity check, used for navigation text such as a heading. */
  readonly skipEntityClaims?: boolean;
}

/**
 * Extracts every claim from one prose value.
 *
 * Numbers are checked first: they are unit-attached and unambiguous, so a
 * figure the model produced stands out even when the sentence around it is
 * fluent. Named entities come next, then first-person assertions resolved
 * against the facts that could support them.
 */
export function extractClaims(
  value: string,
  index: EvidenceIndex,
  options: ExtractClaimsOptions = {},
): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  for (const sentence of splitSentences(value)) {
    for (const match of sentence.matchAll(numberPattern)) {
      const literal = match[0];
      if (isStructuralNumber(sentence, match.index, literal)) continue;
      const variants = [literal, literal.replace(/,/gu, '')];
      const parsed = parseNumberLiteral(literal);
      if (parsed !== null) variants.push(String(parsed));
      const supported = variants.some((variant) => index.numbers.has(variant));
      claims.push({
        kind: 'numeric',
        text: literal,
        status: supported ? 'supported' : 'rejected',
        reason: supported
          ? null
          : `The figure ${literal} appears in no confirmed career fact, in no deterministic match analysis, and in no supplied posting text.`,
        factId: null,
      });
    }

    for (const phrase of options.skipEntityClaims === true
      ? []
      : extractNamedEntityPhrases(sentence)) {
      const tokens = tokenize(phrase);
      if (tokens.length === 0) continue;
      const unknown = tokens.filter((token) => !isKnownWord(token, index));
      if (unknown.length === 0) {
        // Recognised, so the name is evidence-backed. It is still reported, so a
        // caller can see that names were checked rather than skipped.
        claims.push({
          kind: 'entity',
          text: phrase.slice(0, 200),
          status: 'supported',
          reason: null,
          factId: null,
        });
        continue;
      }
      // One ordinary word may open a sentence - "Consider Acme Rocket Labs".
      // Every other unrecognised term is an unverifiable name, and a name is
      // never allowed to be unverifiable.
      const offending =
        unknown.length === 1 && isOrdinaryOpener(unknown[0] ?? '')
          ? null
          : (unknown.find((token) => !isOrdinaryOpener(token)) ?? unknown[0]);
      if (offending === null || offending === undefined) continue;
      claims.push({
        kind: 'entity',
        text: phrase.slice(0, 200),
        status: 'rejected',
        reason: `"${offending}" is not a name, employer, job title, school, or technology that appears in the confirmed career facts or in the supplied posting.`,
        factId: null,
      });
    }

    if (options.skipExperienceClaims === true) continue;
    // A fresh regex, because a `/g` pattern carries `lastIndex` between calls
    // and a stateful check is a check that silently stops checking.
    const spelledQuantity =
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:years?|yrs?)\b/iu;
    const assertsExperience =
      firstPersonPatterns.some((pattern) =>
        new RegExp(pattern.source, pattern.flags).test(sentence),
      ) || spelledQuantity.test(sentence);
    if (!assertsExperience) continue;
    const factId = supportingFact(sentence, index);
    claims.push({
      kind: 'experience',
      text: sentence.slice(0, 300),
      status: factId === null ? 'rejected' : 'supported',
      reason:
        factId === null
          ? 'The sentence asserts first-person experience that no confirmed career fact supports. Omit it, phrase it as a gap, or ask the member to confirm it.'
          : null,
      factId,
    });
  }
  return claims;
}

/**
 * A figure that is part of the answer's own structure, not a claim about anyone.
 *
 * Three forms: a figure in parentheses or after a `#` is a reference, a
 * four-digit year is a date, and a digit run inside an identifier is a fact id
 * or a hash rather than prose. Anything else is a claim, and a claim has to be
 * supported.
 */
function isStructuralNumber(sentence: string, offset: number, literal: string): boolean {
  const before = sentence.slice(Math.max(offset - 2, 0), offset);
  if (before.endsWith('(') || before.endsWith('#')) return true;
  if (literal.length === 4 && /^(?:19|20)\d{2}$/u.test(literal)) return true;
  return isInsideIdentifier(sentence, offset, literal.length);
}

/** The character span of the whitespace-delimited token containing an offset. */
function tokenBounds(
  sentence: string,
  offset: number,
  length: number,
): { start: number; text: string } {
  let start = offset;
  while (start > 0 && !/\s/u.test(sentence.charAt(start - 1))) start -= 1;
  let end = offset + length;
  while (end < sentence.length && !/\s/u.test(sentence.charAt(end))) end += 1;
  return { start, text: sentence.slice(start, end) };
}

/**
 * True when the figure is a fragment of a fact identifier, a content hash, or a
 * URL rather than a claim about the member.
 *
 * The test is structural, not a list of known shapes: a hyphen inside an
 * eight-or-more-character token of hex digits and hyphens is an identifier. That
 * keeps "40-person" and "3+ years" as claims while a UUID's version and variant
 * segments stop looking like figures a model is asserting.
 */
function isInsideIdentifier(sentence: string, offset: number, length: number): boolean {
  const token = tokenBounds(sentence, offset, length);
  const prefix = sentence.slice(Math.max(token.start - 8, 0), token.start);
  if (/(?:^|\s)(?:https?:\/\/|www\.)$/u.test(prefix) || prefix.endsWith('__')) return true;
  if (!token.text.includes('-')) return false;
  return /^[0-9a-f-]{8,}$/iu.test(token.text) && /[0-9]/u.test(token.text);
}

// ---------------------------------------------------------------------------
// Response walking
// ---------------------------------------------------------------------------

interface TextTarget {
  readonly path: string;
  readonly text: string;
  readonly insideInference: boolean;
  /**
   * True when the field's prose is meant to be a verified statement about the
   * member. An unsupported claim there is not a sentence to delete: the field
   * exists to assert evidence, so a false assertion in it means the model
   * misunderstood the task and the response is refused.
   */
  readonly assertsFacts: boolean;
  /** True for navigation text, where a capitalised word is not a named entity. */
  readonly structural: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const inferenceFields = new Set([
  'suggestions',
  'questionsToConfirm',
  'nextSteps',
  'whatToEmphasise',
  'applicationStrategy',
  'interviewStrategy',
  'recommendedNextAction',
  'whyInteresting',
  'transferableStrengths',
  'careerDirection',
  'salaryAndLocationConcerns',
]);

/**
 * Fields whose prose asserts something about the member's history, so an
 * unsupported claim in one is a misunderstanding of the task rather than a
 * sentence to trim. Advice fields may legitimately contain "I would describe
 * ...", and a draft's paragraphs are prose that can be shortened, which is why
 * the strict list is short and explicit rather than inherited by container keys.
 */
const assertionFields = new Set([
  'gaps',
  'hardBlockers',
  'rejectionRisks',
  'whatNotToClaim',
  'insight',
  'statement',
]);

/**
 * Structural labels: a heading, a title, or an artifact kind is navigation text
 * the member never reads as a claim about themselves, so a capitalised word in
 * one is not treated as a named entity. Numbers in a heading are still checked,
 * because a fabricated figure in a heading is still a fabricated figure.
 */
const structuralFields = new Set(['heading', 'title', 'kind', 'label', 'rationale']);

function textTargetsFrom(
  value: unknown,
  path: string,
  insideInference: boolean,
  assertsFacts: boolean,
  structural: boolean,
): TextTarget[] {
  if (typeof value === 'string') {
    return [{ path, text: value, insideInference, assertsFacts, structural }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      textTargetsFrom(item, `${path}[${index}]`, insideInference, assertsFacts, structural),
    );
  }
  if (!isPlainObject(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    // Identifier, enum, and provenance properties are checked as citations and
    // as names elsewhere; mining them for prose claims would be noise.
    if (key === 'evidenceFactIds' || key === 'kind' || key === 'model' || key === 'provider') {
      return [];
    }
    const inference = insideInference || inferenceFields.has(key);
    return textTargetsFrom(
      entry,
      `${path}.${key}`,
      inference && !assertionFields.has(key),
      assertsFacts || assertionFields.has(key),
      structural || structuralFields.has(key),
    );
  });
}

interface CitationList {
  readonly path: string;
  readonly ids: readonly string[];
  readonly malformed: boolean;
}

function citationListsFrom(value: unknown, path: string): CitationList[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => citationListsFrom(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) return [];
  const results: CitationList[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'evidenceFactIds' || key === 'factId') {
      // `factId` is the single-citation form used by `strongestEvidence`; it is
      // held to exactly the same rule as the plural list.
      const raw = key === 'factId' ? [entry] : Array.isArray(entry) ? entry : [];
      const ids = raw.filter((id): id is string => typeof id === 'string');
      results.push({ path: `${path}.${key}`, ids, malformed: ids.length !== raw.length });
      continue;
    }
    results.push(...citationListsFrom(entry, `${path}.${key}`));
  }
  return results;
}

const scoreLikeKeys = new Set([
  'score',
  'matchscore',
  'overallscore',
  'percentmatch',
  'percentagematch',
  'confidence',
  'confidencelevel',
  'confidencepercent',
]);

/** Any property named like a score, at any depth. */
export function findScoreLikeFields(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findScoreLikeFields(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) return [];
  const found: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (scoreLikeKeys.has(key.toLowerCase().replace(/[^a-z]/gu, ''))) found.push(`${path}.${key}`);
    found.push(...findScoreLikeFields(entry, `${path}.${key}`));
  }
  return found;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type GatedTask = 'opportunity_analysis' | 'application_artifact' | 'coaching';

export interface GateInput<TOutput> {
  readonly value: TOutput;
  readonly context: GroundingContext;
  readonly task: GatedTask;
  readonly taskKind?: AiTaskKind;
}

/** One generated value with its unsupported claims removed. */
export interface CleanedValue<TOutput> {
  /** The value with every unsupported claim dropped and every unsupported citation pruned. */
  readonly value: TOutput;
  /** The number of claims removed from the returned value. */
  readonly droppedClaims: number;
  /** The number of citations removed from the returned value. */
  readonly droppedCitations: number;
}

export interface GateDecision<TOutput> {
  readonly accepted: boolean;
  /** The cleaned response, or null when the gate rejected it. */
  readonly value: TOutput | null;
  readonly report: GroundingReport;
}

/**
 * Splits a prose value into the sentences that may be returned and the ones
 * that may not.
 *
 * This is what makes a partial response usable: a draft with one unverifiable
 * sentence loses that sentence and keeps the rest, and the caller is told
 * exactly which claim went and why.
 */
function partitionSentences(
  value: string,
  index: EvidenceIndex,
  options: ExtractClaimsOptions,
): { readonly kept: string[]; readonly dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  for (const sentence of splitSentences(value)) {
    const claims = extractClaims(sentence, index, options);
    if (claims.some((claim) => claim.status === 'rejected')) {
      dropped += 1;
      continue;
    }
    kept.push(sentence);
  }
  return { kept, dropped };
}

/**
 * Removes unsupported prose claims from a generated value.
 *
 * Citations are deliberately not trimmed: an inadmissible one rejects the
 * response rather than being pruned quietly, because the database truth gate
 * refuses such a row and a caller should not receive as acceptable a result it
 * could never persist. What cleaning does remove is the sentences the evidence
 * does not support, so a mostly good response stays usable.
 */
export function cleanGeneratedValue<TOutput>(
  value: TOutput,
  index: EvidenceIndex,
  insideInference = false,
): CleanedValue<TOutput> {
  let droppedClaims = 0;

  const walk = (entry: unknown, inference: boolean): unknown => {
    if (typeof entry === 'string') {
      const partition = partitionSentences(entry, index, {
        skipExperienceClaims: inference,
      });
      droppedClaims += partition.dropped;
      // A value is a list of sentences, so a removed sentence leaves no empty
      // placeholder behind: `join` on an empty list already produces ''.
      return partition.kept.join(' ');
    }
    if (Array.isArray(entry)) {
      const items: unknown[] = [];
      for (const item of entry) {
        const cleaned = walk(item, inference);
        // A list entry that consisted only of unsupported claims is removed
        // rather than left as an empty string or empty object, so a cleaned
        // response does not carry hollow placeholders into a document.
        if (cleaned === '') continue;
        items.push(cleaned);
      }
      return items;
    }
    if (!isPlainObject(entry)) return entry;

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(entry)) {
      result[key] =
        key === 'kind' || key === 'model' || key === 'provider'
          ? child
          : walk(child, inference || inferenceFields.has(key));
    }
    return result;
  };

  const cleaned = walk(value, insideInference) as TOutput;
  return { value: cleaned, droppedClaims, droppedCitations: 0 };
}

function toReport(
  claims: readonly GroundingClaimResult[],
  rejections: readonly GroundingRejection[],
  context: GroundingContext,
  counts: { numeric: number; entity: number; experience: number },
): GroundingReport {
  const rejected = claims.filter((claim) => claim.status === 'rejected');
  const dropped = claims.filter((claim) => claim.status === 'dropped');
  const status: GroundingReport['status'] =
    rejections.length > 0 || rejected.length > 0
      ? 'rejected'
      : dropped.length > 0
        ? 'partial'
        : 'passed';
  const admissible = [
    ...new Set([
      ...context.deterministic.admissibleFactIds,
      ...context.facts.map((fact) => fact.id),
    ]),
  ];
  return {
    status,
    // Both a refused claim and a removed one are unsupported, and the caller
    // reporting either to the member needs to know which claims they were.
    unsupportedClaimIds: [
      ...new Set(
        [...rejected, ...dropped].map((claim) =>
          claim.text === '' ? claim.kind : `${claim.kind}:${claim.text}`,
        ),
      ),
    ],
    verifiedFactIds: [
      ...new Set(
        claims
          .filter((claim) => claim.kind === 'fact_citation' && claim.status === 'supported')
          .map((claim) => claim.text),
      ),
    ],
    admissibleFactIds: admissible,
    claims,
    rejections,
    numericClaimsChecked: counts.numeric,
    entityClaimsChecked: counts.entity,
    experienceClaimsChecked: counts.experience,
  };
}

/**
 * Runs the gate.
 *
 * Two outcomes are possible. Everything supported, or nothing but removable
 * claims wrong: the gate returns the cleaned value and a `passed` or `partial`
 * report, so a caller can present it and tell the user which claim was dropped.
 * Anything else - an unparseable shape, a coaching fact with no citation, a
 * score the model chose, an artefact with no evidence at all - is rejected
 * outright, because there is no honest version of it to return.
 */
export function gateGeneratedOutput<TOutput>(input: GateInput<TOutput>): GateDecision<TOutput> {
  const index = buildEvidenceIndex(input.context);
  const claims: GroundingClaimResult[] = [];
  const rejections: GroundingRejection[] = [];
  const counts = { numeric: 0, entity: 0, experience: 0 };

  const reject = (kind: GroundingClaimKind, path: string, detail: string, text = ''): void => {
    rejections.push({ code: kind, path, detail });
    claims.push({ path, kind, text, status: 'rejected', reason: detail });
  };

  if (!isPlainObject(input.value)) {
    reject('label', '$', 'The response is not a JSON object, so no claim in it can be checked.');
    return {
      accepted: false,
      value: null,
      report: toReport(claims, rejections, input.context, counts),
    };
  }

  // 1. Fact citations. An identifier outside the admissible set is a citation
  //    the database trigger would also refuse, so it is refused here first.
  for (const list of citationListsFrom(input.value, '$')) {
    if (list.malformed) {
      reject(
        'fact_citation',
        list.path,
        'An evidence list contained a value that is not a career fact identifier.',
      );
      continue;
    }
    for (const id of list.ids) {
      if (!index.factIds.has(id)) {
        reject(
          'fact_citation',
          list.path,
          `The response cites ${id}, which is not a confirmed career fact that was supplied to the model.`,
          id,
        );
        continue;
      }
      claims.push({
        path: list.path,
        kind: 'fact_citation',
        text: id,
        status: 'supported',
        reason: null,
      });
    }
  }

  // 2. Numeric, entity, and first-person claims in generated prose.
  for (const target of textTargetsFrom(input.value, '$', false, false, false)) {
    for (const claim of extractClaims(target.text, index, {
      skipExperienceClaims: target.insideInference,
      skipEntityClaims: target.structural,
    })) {
      if (claim.kind === 'numeric') counts.numeric += 1;
      if (claim.kind === 'entity') counts.entity += 1;
      if (claim.kind === 'experience') counts.experience += 1;
      if (claim.status === 'rejected') {
        if (target.assertsFacts) {
          // An evidence field is not allowed to be merely pruned: the field
          // exists to hold verified statements, so a false one there means the
          // response is refused rather than quietly shortened.
          reject(claim.kind, target.path, claim.reason ?? 'Unsupported claim.', claim.text);
          continue;
        }
        claims.push({
          path: target.path,
          kind: claim.kind,
          text: claim.text,
          status: 'dropped',
          reason: claim.reason,
        });
        continue;
      }
      claims.push({
        path: target.path,
        kind: claim.kind,
        text: claim.text,
        status: 'supported',
        reason: null,
      });
    }
  }

  // 3. Task-specific shape rules: facts versus inferences, a restated verdict,
  //    and a citation list on a draft. These describe the response as a whole
  //    and cannot be repaired by removing a sentence, so they reject.
  for (const rejection of shapeRejections(input.task, input.value, index)) {
    reject(rejection.code, rejection.path, rejection.detail);
  }

  // 4. Score and confidence stay deterministic. A response that carries its own
  //    is rejected rather than silently ignored, because a caller that stored it
  //    would be presenting an invented number as the product's own.
  for (const field of findScoreLikeFields(input.value)) {
    reject(
      'numeric',
      field,
      'The response carries a score or confidence field. Score and confidence are computed by the matching engine and may only be quoted.',
    );
  }

  const cleaned = cleanGeneratedValue(input.value, index);
  if (rejections.length > 0) {
    return {
      accepted: false,
      value: null,
      report: toReport(claims, rejections, input.context, counts),
    };
  }
  return {
    accepted: true,
    value: cleaned.value,
    report: toReport(claims, rejections, input.context, counts),
  };
}

/**
 * Enforces the rules that are about the shape of a task's output rather than
 * about a sentence: coaching must separate fact from inference, an opportunity
 * report must restate the verdict, and a draft must carry citations.
 */
function shapeRejections(
  task: GatedTask,
  value: Record<string, unknown>,
  index: EvidenceIndex,
): GroundingRejection[] {
  const rejections: GroundingRejection[] = [];
  const add = (code: GroundingClaimKind, path: string, detail: string): void => {
    rejections.push({ code, path, detail });
  };

  if (task === 'coaching') {
    if (!Array.isArray(value.facts)) {
      add('label', '$.facts', 'A coaching response must carry a facts list.');
    }
    if (!Array.isArray(value.suggestions)) {
      add('label', '$.suggestions', 'A coaching response must carry a suggestions list.');
    }
    asArray(value.facts).forEach((entry, position) => {
      const path = `$.facts[${position}]`;
      if (!isPlainObject(entry)) {
        add('label', path, 'A coaching fact must be an object.');
        return;
      }
      const ids = entry.evidenceFactIds;
      const admissible = asArray(ids).filter(
        (id): id is string => typeof id === 'string' && index.factIds.has(id),
      );
      if (admissible.length === 0) {
        add(
          'fact_citation',
          `${path}.evidenceFactIds`,
          'A statement presented as a fact must cite the confirmed career facts behind it. Without a live citation it is an inference and belongs in suggestions, so the response is refused rather than silently reclassified.',
        );
      }
    });
    asArray(value.suggestions).forEach((entry, position) => {
      const path = `$.suggestions[${position}]`;
      if (!isPlainObject(entry)) {
        add('label', path, 'A coaching suggestion must be an object.');
        return;
      }
      const kind = entry.kind;
      if (typeof kind !== 'string' || kind.trim().toLowerCase() !== 'inference') {
        add(
          'label',
          `${path}.kind`,
          'A suggestion must be labelled kind: "inference", so the interface cannot present an inference as a fact about the member.',
        );
      }
    });
    return rejections;
  }

  if (task === 'opportunity_analysis') {
    const verdict = value.verdict;
    if (!isPlainObject(verdict) || verdict.restatesMatchVerdict !== true) {
      add(
        'label',
        '$.verdict.restatesMatchVerdict',
        'The analysis must restate the deterministic match verdict rather than choose its own.',
      );
    }
    return rejections;
  }

  const evidence = asArray(value.evidenceFactIds).filter(
    (id): id is string => typeof id === 'string' && index.factIds.has(id),
  );
  if (evidence.length === 0) {
    add(
      'fact_citation',
      '$.evidenceFactIds',
      'A generated application draft must list at least one confirmed career fact it quotes. A draft with no evidence behind it is refused rather than stored.',
    );
  }
  return rejections;
}

/**
 * Turns a gate decision into a task result, re-validating the cleaned value.
 *
 * Cleaning can empty a required field, so the cleaned value goes back through
 * the schema. A response that no longer conforms is rejected: the schema is the
 * contract, and a "cleaned" object the caller cannot trust the shape of is worse
 * than an explicit failure.
 */
export function toTaskResult(options: {
  readonly decision: GateDecision<unknown>;
  readonly schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } };
  readonly meta: AiResponseMetadata;
  readonly provider: AiProviderKind;
  readonly requestId: string;
}):
  | { ok: true; result: GroundedTaskOutput<unknown> }
  | { ok: false; error: AiProviderError; grounding: GroundingReport | null } {
  const { decision } = options;
  if (!decision.accepted || decision.value === null) {
    return {
      ok: false,
      error: new AiProviderErrorConstructor({
        code: 'schema_invalid',
        message: 'The generated response failed the truth gate and was refused.',
        provider: options.provider,
        requestId: options.requestId,
        retryable: false,
      }),
      grounding: decision.report,
    };
  }
  const reparsed = options.schema.safeParse(decision.value);
  if (!reparsed.success) {
    return {
      ok: false,
      error: new AiProviderErrorConstructor({
        code: 'schema_invalid',
        message:
          'Removing the unsupported claims left a response that no longer satisfies the required schema, so it was refused.',
        provider: options.provider,
        requestId: options.requestId,
        retryable: false,
      }),
      grounding: decision.report,
    };
  }
  return {
    ok: true,
    result: {
      value: reparsed.data,
      meta: options.meta,
      grounding: decision.report,
    },
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
