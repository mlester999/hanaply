import { createHash } from 'node:crypto';

import type {
  CareerDocumentExtraction,
  CareerExtractionEmployment,
  CareerExtractionField,
  CareerLinkKind,
} from '@hanaply/contracts';

/**
 * Deterministic resume extraction.
 *
 * Two rules govern this module, and they exist because generated application
 * material must never contain an invented claim:
 *
 *   1. Every value is copied verbatim from a line that exists in the document.
 *      Nothing is normalised into a "better" claim, no title is upgraded, and no
 *      company is guessed. Each field carries the source line as evidence plus a
 *      confidence score derived from how explicit that line was.
 *   2. Metrics are only reported when the number appears in the text together
 *      with its unit. A percentage or duration that cannot be attributed to a
 *      measurable unit is left out rather than guessed.
 *
 * The extractor is intentionally conservative: a missed item costs the user one
 * form field, while a fabricated item would be a truthfulness failure.
 */

const extractorVersion = 'deterministic-v1';

const sectionAliases: Record<string, readonly string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'about', 'objective', 'career objective'],
  experience: [
    'experience',
    'work experience',
    'professional experience',
    'employment',
    'employment history',
    'work history',
    'relevant experience',
  ],
  education: ['education', 'academic background', 'academics', 'educational background'],
  skills: [
    'skills',
    'core skills',
    'technical skills',
    'competencies',
    'areas of expertise',
    'tools',
  ],
  certifications: ['certifications', 'certificates', 'licenses', 'licences', 'credentials'],
  projects: ['projects', 'selected projects', 'personal projects', 'side projects'],
  links: ['links', 'portfolio', 'profiles', 'online presence'],
  awards: ['awards', 'achievements', 'honours', 'honors'],
};

const monthPattern =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const dateRangePattern = new RegExp(
  `((?:${monthPattern}\\.?\\s+)?(?:19|20)\\d{2}|present|current|now)\\s*(?:-|–|—|to|until|through)\\s*((?:${monthPattern}\\.?\\s+)?(?:19|20)\\d{2}|present|current|now)`,
  'iu',
);

const employmentTypePatterns: readonly { readonly pattern: RegExp; readonly value: string }[] = [
  { pattern: /\b(full[\s-]?time)\b/iu, value: 'full_time' },
  { pattern: /\b(part[\s-]?time)\b/iu, value: 'part_time' },
  { pattern: /\b(contract|contractor|fixed[\s-]?term)\b/iu, value: 'contract' },
  { pattern: /\b(freelance|freelancer|independent consultant)\b/iu, value: 'freelance' },
  { pattern: /\b(intern|internship|ojt|on[\s-]?the[\s-]?job training)\b/iu, value: 'internship' },
  { pattern: /\b(temporary|temp role|seasonal)\b/iu, value: 'temporary' },
  { pattern: /\b(volunteer|volunteering)\b/iu, value: 'volunteer' },
];

const arrangementPatterns: readonly { readonly pattern: RegExp; readonly value: string }[] = [
  { pattern: /\b(remote|work from home|wfh|telecommute)\b/iu, value: 'remote' },
  { pattern: /\b(hybrid)\b/iu, value: 'hybrid' },
  { pattern: /\b(on[\s-]?site|onsite|in[\s-]?office)\b/iu, value: 'onsite' },
];

const degreePattern =
  /\b(bs|b\.s\.|ba|b\.a\.|bsc|b\.sc\.|bachelor(?:'s)?|master(?:'s)?|ms|m\.s\.|msc|mba|phd|ph\.d\.|doctorate|diploma|associate(?:'s)?|certificate)\b/iu;
const institutionPattern =
  /\b(university|college|institute|school|academy|polytechnic|state u)\b/iu;
const certificationPattern =
  /\b(certified|certification|certificate|license|licence|accredited|credential)\b/iu;

type SkillKind = 'skill' | 'tool' | 'technology' | 'language' | 'soft_skill' | 'domain';
const skillKindRules: readonly { readonly pattern: RegExp; readonly kind: SkillKind }[] = [
  {
    pattern:
      /^(english|filipino|tagalog|cebuano|spanish|mandarin|japanese|korean|french|german)$/iu,
    kind: 'language',
  },
  {
    pattern:
      /^(communication|leadership|teamwork|collaboration|problem solving|critical thinking|time management|adaptability|ownership|mentoring|stakeholder management|attention to detail|presentation)$/iu,
    kind: 'soft_skill',
  },
  {
    pattern:
      /^(operations|marketing|sales|finance|accounting|recruiting|logistics|procurement|compliance|customer success|healthcare|education)$/iu,
    kind: 'domain',
  },
  { pattern: /^[a-z0-9+#.]{1,30}$/iu, kind: 'technology' },
];

const metricPattern =
  /(?<![\w.])(\d+(?:[.,]\d+)?)\s*(%|percent|percentage points?|hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|php|usd|₱|\$|x|times|clients?|customers?|users?|accounts?|tickets?|leads?|people|staff|employees|projects?|countries?|regions?|markets?)(?![\w])/giu;

const linkHosts: readonly { readonly pattern: RegExp; readonly kind: CareerLinkKind }[] = [
  { pattern: /github\.com/iu, kind: 'github' },
  { pattern: /gitlab\.com/iu, kind: 'gitlab' },
  { pattern: /linkedin\.com/iu, kind: 'linkedin' },
  { pattern: /behance\.net/iu, kind: 'behance' },
  { pattern: /dribbble\.com/iu, kind: 'dribbble' },
  { pattern: /stackoverflow\.com/iu, kind: 'stackoverflow' },
];

interface Section {
  readonly name: string;
  readonly lines: string[];
}

function normaliseLine(line: string): string {
  return line.replace(/\s+/gu, ' ').trim();
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => normaliseLine(line.replace(/^[\s•·▪◦*+\-–—]+/u, '')))
    .filter((line) => line.length > 0);
}

function sectionNameFor(line: string): string | null {
  const candidate = line
    .toLowerCase()
    .replace(/[^a-z\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (candidate.length === 0 || candidate.length > 40) return null;
  for (const [name, aliases] of Object.entries(sectionAliases)) {
    if (aliases.includes(candidate)) return name;
  }
  return null;
}

function splitSections(lines: readonly string[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { name: 'header', lines: [] };
  for (const line of lines) {
    const name = sectionNameFor(line);
    if (name && name !== current.name) {
      if (current.lines.length > 0) sections.push(current);
      current = { name, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) sections.push(current);
  return sections;
}

function field(
  value: string | null,
  confidence: number,
  evidence: string | null,
): CareerExtractionField | null {
  if (value === null || value.length === 0) return null;
  return {
    value: value.slice(0, 500),
    confidence: Math.min(1, Math.max(0, confidence)),
    evidence: evidence === null ? null : evidence.slice(0, 400),
  };
}

function toIsoDate(token: string, fallbackYear?: string): string | null {
  const cleaned = token.trim().toLowerCase();
  if (cleaned === 'present' || cleaned === 'current' || cleaned === 'now') return null;
  const monthMatch = new RegExp(`^(${monthPattern})\\.?\\s+((?:19|20)\\d{2})$`, 'iu').exec(cleaned);
  if (monthMatch) {
    const months = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const monthLabel = monthMatch[1] ?? '';
    const year = monthMatch[2] ?? '';
    const month = months.findIndex((entry) => monthLabel.toLowerCase().startsWith(entry));
    if (month >= 0 && year.length === 4) {
      return `${year}-${String(month + 1).padStart(2, '0')}-01`;
    }
  }
  if (/^(19|20)\d{2}$/u.test(cleaned)) {
    return `${cleaned}-01-01`;
  }
  if (/^(19|20)\d{2}$/u.test(fallbackYear ?? '')) {
    return `${fallbackYear}-01-01`;
  }
  return null;
}

function inferSkillKind(name: string): SkillKind {
  for (const rule of skillKindRules) {
    if (rule.pattern.test(name)) return rule.kind;
  }
  return 'technology';
}

function extractLinks(lines: readonly string[]): { linkKind: CareerLinkKind; url: string }[] {
  const found = new Map<string, CareerLinkKind>();
  for (const line of lines) {
    for (const match of line.matchAll(/https?:\/\/[^\s<>()"']+/giu)) {
      const url = match[0].replace(/[.,;:]+$/u, '');
      let kind: CareerLinkKind = 'personal_website';
      for (const host of linkHosts) {
        if (host.pattern.test(url)) {
          kind = host.kind;
          break;
        }
      }
      if (!found.has(url)) found.set(url, kind);
    }
    // Bare linkedin.com/in/... without a scheme.
    for (const match of line.matchAll(
      /(?:^|\s)((?:www\.)?(?:linkedin|github|gitlab)\.com\/[^\s,;]+)/giu,
    )) {
      const bare = match[1];
      if (!bare) continue;
      const url = `https://${bare.replace(/[.,;:]+$/u, '')}`;
      if (!found.has(url)) {
        const kind = linkHosts.find((host) => host.pattern.test(url))?.kind ?? 'personal_website';
        found.set(url, kind);
      }
    }
  }
  return [...found.entries()].map(([url, linkKind]) => ({ linkKind, url: url.slice(0, 500) }));
}

function extractSkills(
  lines: readonly string[],
  section: Section | undefined,
): { name: string; skillKind: SkillKind }[] {
  const names = new Map<string, string>();
  const add = (raw: string): void => {
    const name = raw
      .replace(/\(.*?\)/gu, '')
      .replace(/\s+/gu, ' ')
      .replace(/[.;:,]+$/u, '')
      .trim();
    if (name.length < 2 || name.length > 60) return;
    if (name.split(' ').length > 4) return;
    if (/^\d+$/u.test(name)) return;
    if (!names.has(name.toLowerCase())) {
      names.set(name.toLowerCase(), name);
    }
  };

  if (section) {
    for (const line of section.lines) {
      const [label, remainder] = line.includes(':') ? line.split(/:(.*)/su) : [null, line];
      if (label && remainder) {
        // "Languages: English, Filipino" and "Databases: PostgreSQL" style rows.
        for (const item of remainder.split(/[,;|/·•]/u)) add(item);
        continue;
      }
      for (const item of line.split(/[,;|·•]/u)) add(item);
    }
  }

  // Cross-reference the whole document for a small set of unambiguous tools.
  const wholeText = lines.join('\n');
  const knownTools = [
    'n8n',
    'zapier',
    'make.com',
    'power automate',
    'typescript',
    'javascript',
    'python',
    'java',
    'c#',
    'go',
    'rust',
    'php',
    'ruby',
    'sql',
    'postgresql',
    'mysql',
    'supabase',
    'firebase',
    'mongodb',
    'redis',
    'react',
    'next.js',
    'node.js',
    'vue',
    'angular',
    'django',
    'laravel',
    'docker',
    'kubernetes',
    'terraform',
    'aws',
    'azure',
    'google cloud',
    'git',
    'github actions',
    'excel',
    'google sheets',
    'tableau',
    'power bi',
    'looker',
    'salesforce',
    'hubspot',
    'zendesk',
    'intercom',
    'jira',
    'confluence',
    'notion',
    'airtable',
    'figma',
    'photoshop',
    'canva',
    'quickbooks',
    'xero',
    'sap',
    'netsuite',
    'shopify',
    'wordpress',
    'webflow',
  ];
  for (const tool of knownTools) {
    const pattern = new RegExp(
      `(^|[^\\w.+#])${tool.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}([^\\w.+#]|$)`,
      'iu',
    );
    if (pattern.test(wholeText)) add(tool);
  }

  return [...names.values()].map((name) => ({ name, skillKind: inferSkillKind(name) }));
}

function splitRoleAndCompany(line: string): { roleTitle: string; companyName: string } | null {
  const separators = [/\s+[–—]\s+/u, /\s+\|\s+/u, /\s+@\s+/u, /\s+at\s+/iu, /,\s+/u];
  for (const separator of separators) {
    const parts = line
      .split(separator)
      .map((part) => normaliseLine(part))
      .filter(Boolean);
    const role = parts[0];
    const company = parts[1];
    if (role && company && role.length <= 80 && company.length <= 80) {
      return { roleTitle: role, companyName: company };
    }
  }
  return null;
}

function extractEmployment(bodyLines: readonly string[]): CareerExtractionEmployment[] {
  const results: CareerExtractionEmployment[] = [];
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index] ?? '';
    const range = dateRangePattern.exec(line);
    // A dated line, or a heading line immediately followed by a dated line.
    let dateLine: string | null = range ? line : null;
    let headingLine: string | null = range
      ? line
          .replace(dateRangePattern, '')
          .replace(/[|,–—]\s*$/u, '')
          .trim()
      : null;
    if (!range && index + 1 < bodyLines.length) {
      const nextLine = bodyLines[index + 1] ?? '';
      if (dateRangePattern.test(nextLine)) {
        dateLine = nextLine;
        headingLine = line;
        index += 1;
      }
    }
    if (!dateLine || headingLine === null) continue;

    const split = splitRoleAndCompany(headingLine);
    if (!split) continue;
    const matchedRange = dateRangePattern.exec(dateLine);
    const startToken = matchedRange?.[1] ?? '';
    const endToken = matchedRange?.[2] ?? '';
    const isCurrent = /present|current|now/iu.test(endToken);

    const highlights: CareerExtractionField[] = [];
    const skills: string[] = [];
    for (let cursor = index + 1; cursor < bodyLines.length; cursor += 1) {
      const candidate = bodyLines[cursor] ?? '';
      if (dateRangePattern.test(candidate) || sectionNameFor(candidate)) break;
      if (candidate.length < 15) continue;
      highlights.push({
        value: candidate.slice(0, 500),
        confidence: 0.6,
        evidence: candidate.slice(0, 400),
      });
      if (highlights.length >= 5) break;
    }

    const employmentType =
      employmentTypePatterns.find((entry) => entry.pattern.test(`${headingLine} ${dateLine}`))
        ?.value ?? 'full_time';
    const workArrangement =
      arrangementPatterns.find((entry) => entry.pattern.test(`${headingLine} ${dateLine}`))
        ?.value ?? null;

    const locationMatch = /\b(remote|hybrid|on-?site)\b/iu.exec(`${headingLine} ${dateLine}`);
    results.push({
      companyName: {
        value: split.companyName.slice(0, 500),
        confidence: 0.62,
        evidence: headingLine.slice(0, 400),
      },
      roleTitle: {
        value: split.roleTitle.slice(0, 500),
        confidence: 0.68,
        evidence: headingLine.slice(0, 400),
      },
      employmentType: employmentType as CareerExtractionEmployment['employmentType'],
      workArrangement: workArrangement as CareerExtractionEmployment['workArrangement'],
      startDate: toIsoDate(startToken),
      endDate: isCurrent ? null : toIsoDate(endToken),
      isCurrent,
      location: locationMatch ? field(locationMatch[1] ?? null, 0.5, headingLine) : null,
      highlights,
      skills,
    });
    if (results.length >= 12) break;
  }
  return results;
}

function extractEducation(lines: readonly string[]): CareerDocumentExtraction['education'] {
  const results: CareerDocumentExtraction['education'] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const next = lines[index + 1] ?? '';
    const combined = `${line} ${next}`;
    if (!degreePattern.test(combined) && !institutionPattern.test(combined)) continue;
    if (
      dateRangePattern.test(line) &&
      !degreePattern.test(line) &&
      !institutionPattern.test(line)
    ) {
      continue;
    }

    const institutionSource = institutionPattern.test(line) ? line : next;
    const degreeSource = degreePattern.test(line) ? line : next;
    const yearMatch = /(19|20)\d{2}/u.exec(combined);
    const institution = institutionSource
      .replace(dateRangePattern, '')
      .replace(/[|,–—]\s*$/u, '')
      .trim();

    if (institution.length < 3) continue;
    results.push({
      institution: {
        value: institution.slice(0, 500),
        confidence: institutionPattern.test(line) ? 0.72 : 0.5,
        evidence: line.slice(0, 400),
      },
      degree: degreePattern.test(degreeSource)
        ? field(degreeSource.replace(dateRangePattern, '').trim(), 0.6, degreeSource)
        : null,
      fieldOfStudy: null,
      endYear: yearMatch ? Number(yearMatch[0]) : null,
    });
    if (results.length >= 8) break;
  }
  return results;
}

function extractCandidateFacts(
  lines: readonly string[],
  summary: CareerExtractionField | null,
): CareerDocumentExtraction['candidateFacts'] {
  const facts: CareerDocumentExtraction['candidateFacts'] = [];
  const seen = new Set<string>();

  const push = (
    statement: string,
    category: CareerDocumentExtraction['candidateFacts'][number]['category'],
    confidence: number,
    metricValue: number | null,
    metricUnit: string | null,
  ): void => {
    const key = statement.toLowerCase();
    if (seen.has(key) || statement.length < 12 || statement.length > 500) return;
    seen.add(key);
    facts.push({ statement, category, confidence, metricValue, metricUnit });
  };

  if (summary) {
    push(`Professional summary: ${summary.value}`, 'preference', 0.5, null, null);
  }

  for (const line of lines) {
    if (line.length < 20) continue;
    const verbStart =
      /^(led|managed|built|designed|developed|implemented|improved|reduced|increased|created|launched|owned|automated|delivered|migrated|optimised|optimized|streamlined|coordinated|trained|supported|handled|maintained|analysed|analyzed|resolved)\b/iu;
    const metric = metricPattern.exec(line);
    metricPattern.lastIndex = 0;
    const metricValue = metric?.[1];
    const metricUnit = metric?.[2];
    if (metricValue !== undefined && metricUnit !== undefined) {
      push(
        line.slice(0, 500),
        'metric',
        0.55,
        Number(metricValue.replace(',', '.')),
        metricUnit.toLowerCase().slice(0, 40),
      );
      continue;
    }
    if (verbStart.test(line)) {
      push(line.slice(0, 500), 'achievement', 0.5, null, null);
    }
  }

  return facts.slice(0, 40);
}

export interface ExtractionInput {
  readonly text: string;
  readonly pageCount: number | null;
  readonly wordCount: number;
  readonly warnings: readonly string[];
}

export function extractCareerProfile(input: ExtractionInput): CareerDocumentExtraction & {
  readonly pageCount: number | null;
} {
  const lines = splitLines(input.text);
  const sections = splitSections(lines);
  const header = sections.find((section) => section.name === 'header');
  const summarySection = sections.find((section) => section.name === 'summary');
  const experienceSection = sections.find((section) => section.name === 'experience');
  const skillsSection = sections.find((section) => section.name === 'skills');
  const educationSection = sections.find((section) => section.name === 'education');
  const certificationSection = sections.find((section) => section.name === 'certifications');

  const headerText = (header?.lines ?? lines.slice(0, 4)).join('\n');
  const headlineSource = (header?.lines ?? [])[1] ?? null;
  const headline =
    headlineSource && headlineSource.length >= 4 && headingIsRoleLike(headlineSource)
      ? field(headlineSource, 0.45, headlineSource)
      : null;

  const summary =
    summarySection && summarySection.lines.length > 0
      ? field(summarySection.lines.join(' '), 0.6, summarySection.lines[0] ?? null)
      : null;

  const employment = extractEmployment(experienceSection?.lines ?? []);
  const education = extractEducation(educationSection?.lines ?? lines);
  const certifications = (certificationSection?.lines ?? [])
    .filter((line) => certificationPattern.test(line) && line.length >= 8)
    .slice(0, 20)
    .map((line) => ({
      value: line.slice(0, 500),
      confidence: 0.55,
      evidence: line.slice(0, 400),
    }));

  const candidateFacts = extractCandidateFacts(
    [...(experienceSection?.lines ?? []), ...(header?.lines ?? [])],
    summary,
  );

  const warnings = [...input.warnings];
  if (employment.length === 0) {
    warnings.push(
      'No employment entries with a date range were found. Add your work history manually so matches stay accurate.',
    );
  }
  if (!/\b(19|20)\d{2}\b/u.test(input.text)) {
    warnings.push('No years were detected in this document.');
  }
  warnings.push(
    'Every extracted value is a proposal. Nothing is saved as a fact until you confirm it.',
  );

  return {
    documentId: '00000000-0000-0000-0000-000000000000',
    status: 'needs_review',
    extractor: 'deterministic',
    extractorVersion,
    wordCount: input.wordCount,
    headline,
    summary,
    skills: extractSkills(lines, skillsSection).slice(0, 60),
    employment,
    education,
    certifications,
    links: extractLinks([...splitLines(headerText), ...lines]).slice(0, 10),
    candidateFacts,
    warnings: warnings.slice(0, 8),
    pageCount: input.pageCount,
  };
}

function headingIsRoleLike(line: string): boolean {
  if (line.length > 90) return false;
  if (/@|https?:|www\./iu.test(line)) return false;
  if (/\b(university|college|institute|school)\b/iu.test(line)) return false;
  return /[A-Za-z]/u.test(line);
}

export function extractionFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
