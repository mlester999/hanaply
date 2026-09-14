import type {
  ApplicationArtifactKind,
  CareerFact,
  CareerProfileDetail,
  PackArtifactStyle,
  PackGenerationJob,
} from '@hanaply/contracts';
import { describe, expect, it } from 'vitest';

import {
  generatePackArtifacts,
  readPackMatchSnapshot,
  type PackArtifactDraft,
  type PackMatchSnapshot,
} from '../../services/api/src/pack-generation.js';

/**
 * Application Pack generation, tested adversarially.
 *
 * The generator's whole reason to exist is that it must not invent anything, so
 * the strongest assertion available is the crude one: collect every run of
 * digits in the generated output and require each one to already exist
 * somewhere in the fixture data. A number that was computed, rounded, totalled,
 * or simply made up cannot survive that check.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const profileId = 'b1000000-0000-4000-8000-000000000001';
const employmentId = 'b1000000-0000-4000-8000-000000000002';
const projectId = 'b1000000-0000-4000-8000-000000000003';
const educationId = 'b1000000-0000-4000-8000-000000000004';
const certificationId = 'b1000000-0000-4000-8000-000000000005';
const linkId = 'b1000000-0000-4000-8000-000000000006';
const jobId = 'b1000000-0000-4000-8000-000000000007';
const skillId = 'b1000000-0000-4000-8000-000000000008';

const achievementFactId = 'b2000000-0000-4000-8000-000000000001';
const metricFactId = 'b2000000-0000-4000-8000-000000000002';
const skillFactId = 'b2000000-0000-4000-8000-000000000003';
const responsibilityFactId = 'b2000000-0000-4000-8000-000000000004';

const achievementStatement = 'Rebuilt onboarding automation for a 40-person operations team';
const metricStatement = 'Cut manual reconciliation time';
const skillStatement = 'Built production n8n workflows for order processing';
const responsibilityStatement = 'Owned integration monitoring for the operations platform';

const unevidencedRequirement = 'Kubernetes cluster administration';

const requirementMapping: PackMatchSnapshot['requirementMapping'] = [
  {
    requirement: 'Three years of hands-on workflow automation experience',
    status: 'met',
    matchedSkills: ['n8n', 'Workflow automation'],
    evidence: 'Your profile lists n8n and Workflow automation.',
  },
  {
    requirement: unevidencedRequirement,
    status: 'unmet',
    matchedSkills: [],
    evidence: null,
  },
  {
    requirement: 'Strong written communication with non-technical stakeholders',
    status: 'partially_met',
    matchedSkills: ['Stakeholder communication'],
    evidence: 'Your profile lists Stakeholder communication.',
  },
  {
    requirement: 'Comfortable working across multiple time zones',
    status: 'unknown',
    matchedSkills: [],
    evidence: null,
  },
];

function profileFixture(overrides: Partial<CareerProfileDetail> = {}): CareerProfileDetail {
  return {
    id: profileId,
    name: 'Ana Reyes',
    isPrimary: true,
    status: 'active',
    headline: 'Workflow automation specialist',
    currentRoleTitle: 'Automation Specialist',
    careerLevel: 'mid',
    yearsExperience: 3.5,
    targetRoleTitles: ['Workflow Automation Engineer'],
    preferredWorkArrangement: 'remote',
    completenessPercent: 72,
    version: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    summary: 'Builds reliable automation between business systems for small operations teams.',
    industries: ['SaaS'],
    excludedRoleTitles: [],
    preferredEmploymentTypes: ['full_time'],
    preferredLocations: ['Metro Manila'],
    openToInternational: true,
    openToRelocation: false,
    workAuthorizations: ['Philippines'],
    availability: 'two_weeks',
    salaryExpectation: null,
    careerGoals: null,
    lastReviewedAt: null,
    completeness: {
      percent: 72,
      missing: ['skills'],
      counts: { employment: 1, skills: 5, education: 1, links: 1, confirmedFacts: 4 },
    },
    subCareers: [],
    employment: [
      {
        id: employmentId,
        companyName: 'Northstar Systems',
        companyUrl: null,
        roleTitle: 'Automation Specialist',
        employmentType: 'full_time',
        workArrangement: 'remote',
        location: 'Remote, Philippines',
        countryCode: 'PH',
        industry: 'SaaS',
        startDate: '2023-02-01',
        endDate: null,
        isCurrent: true,
        summary: 'Owns internal automation between business systems.',
        highlights: [achievementStatement],
        skills: ['n8n', 'TypeScript'],
        displayOrder: 0,
      },
    ],
    projects: [
      {
        id: projectId,
        name: 'Order intake pipeline',
        roleTitle: null,
        description: 'Nightly order intake between the storefront and the operations queue.',
        projectUrl: null,
        repositoryUrl: 'https://github.com/example/order-intake',
        startDate: '2024-01-01',
        endDate: '2024-06-01',
        isFeatured: true,
        highlights: ['Automated nightly order intake'],
        skills: ['n8n'],
        displayOrder: 0,
      },
    ],
    education: [
      {
        id: educationId,
        institution: 'University of the Philippines',
        degree: 'BS Industrial Engineering',
        fieldOfStudy: 'Industrial Engineering',
        startYear: 2015,
        endYear: 2019,
        isCurrent: false,
        grade: 'Cum laude',
        description: null,
      },
    ],
    certifications: [
      {
        id: certificationId,
        name: 'n8n Advanced Workflow Automation',
        issuer: 'n8n',
        credentialId: null,
        credentialUrl: null,
        issuedOn: '2024-03-01',
        expiresOn: null,
      },
    ],
    links: [
      {
        id: linkId,
        linkKind: 'github',
        label: 'GitHub',
        url: 'https://github.com/example',
        displayOrder: 0,
      },
    ],
    skills: [
      {
        id: skillId,
        name: 'n8n',
        skillKind: 'tool',
        proficiency: 'advanced',
        yearsExperience: 3.5,
        lastUsedYear: 2025,
        isPrimary: true,
        displayOrder: 0,
      },
      {
        id: 'b1000000-0000-4000-8000-000000000009',
        name: 'TypeScript',
        skillKind: 'technology',
        proficiency: 'advanced',
        yearsExperience: null,
        lastUsedYear: null,
        isPrimary: true,
        displayOrder: 1,
      },
      {
        id: 'b1000000-0000-4000-8000-000000000010',
        name: 'Supabase',
        skillKind: 'technology',
        proficiency: 'intermediate',
        yearsExperience: null,
        lastUsedYear: null,
        isPrimary: false,
        displayOrder: 2,
      },
      {
        id: 'b1000000-0000-4000-8000-000000000011',
        name: 'Process design',
        skillKind: 'skill',
        proficiency: 'advanced',
        yearsExperience: null,
        lastUsedYear: null,
        isPrimary: false,
        displayOrder: 3,
      },
      {
        id: 'b1000000-0000-4000-8000-000000000012',
        name: 'Stakeholder communication',
        skillKind: 'soft_skill',
        proficiency: 'advanced',
        yearsExperience: null,
        lastUsedYear: null,
        isPrimary: false,
        displayOrder: 4,
      },
    ],
    factCounts: { candidate: 2, confirmed: 4, rejected: 0 },
    ...overrides,
  };
}

function emptyProfileFixture(): CareerProfileDetail {
  return profileFixture({
    headline: null,
    summary: null,
    currentRoleTitle: null,
    careerLevel: null,
    yearsExperience: null,
    targetRoleTitles: [],
    preferredWorkArrangement: null,
    industries: [],
    preferredEmploymentTypes: [],
    preferredLocations: [],
    workAuthorizations: [],
    availability: null,
    completenessPercent: 0,
    completeness: {
      percent: 0,
      missing: ['headline', 'summary', 'employmentHistory', 'skills', 'education', 'evidence'],
      counts: { employment: 0, skills: 0, education: 0, links: 0, confirmedFacts: 0 },
    },
    employment: [],
    projects: [],
    education: [],
    certifications: [],
    links: [],
    skills: [],
    factCounts: { candidate: 0, confirmed: 0, rejected: 0 },
  });
}

function factFixtures(): CareerFact[] {
  return [
    {
      id: achievementFactId,
      careerProfileId: profileId,
      category: 'achievement',
      statement: achievementStatement,
      source: 'user_entered',
      status: 'confirmed',
      confidence: 1,
      evidence: {},
      metricValue: null,
      metricUnit: null,
      metricContext: null,
      documentId: null,
      confirmedAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: metricFactId,
      careerProfileId: profileId,
      category: 'metric',
      statement: metricStatement,
      source: 'user_entered',
      status: 'confirmed',
      confidence: 1,
      evidence: {},
      metricValue: 12,
      metricUnit: 'hours per week',
      metricContext: 'Order intake pipeline',
      documentId: null,
      confirmedAt: '2026-09-02T00:00:00.000Z',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
    {
      id: skillFactId,
      careerProfileId: profileId,
      category: 'skill',
      statement: skillStatement,
      source: 'user_entered',
      status: 'confirmed',
      confidence: 1,
      evidence: {},
      metricValue: null,
      metricUnit: null,
      metricContext: null,
      documentId: null,
      confirmedAt: '2026-09-03T00:00:00.000Z',
      createdAt: '2026-09-03T00:00:00.000Z',
    },
    {
      id: responsibilityFactId,
      careerProfileId: profileId,
      category: 'responsibility',
      statement: responsibilityStatement,
      source: 'user_entered',
      status: 'confirmed',
      confidence: 1,
      evidence: {},
      metricValue: null,
      metricUnit: null,
      metricContext: null,
      documentId: null,
      confirmedAt: '2026-09-04T00:00:00.000Z',
      createdAt: '2026-09-04T00:00:00.000Z',
    },
  ];
}

function jobFixture(overrides: Partial<PackGenerationJob> = {}): PackGenerationJob {
  return {
    id: jobId,
    title: 'Workflow Automation Engineer',
    companyName: 'Northstar Systems',
    employmentType: 'full_time',
    seniority: 'mid',
    remoteState: 'remote',
    locationRaw: 'Remote, Philippines',
    city: 'Manila',
    region: 'Metro Manila',
    countryCode: 'PH',
    isPhilippines: true,
    isInternational: false,
    salaryMinMinor: null,
    salaryMaxMinor: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryIsEstimate: false,
    skills: ['n8n', 'TypeScript'],
    postedAt: '2026-09-16T00:00:00.000Z',
    firstSeenAt: '2026-09-16T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    lastVerifiedAt: '2026-09-17T00:00:00.000Z',
    sourceCount: 1,
    status: 'active',
    excerpt: 'Own internal automation between business systems.',
    expiresAt: null,
    description:
      'Own internal automation between business systems. You will design workflows, maintain integrations, and improve reporting reliability for the operations team.',
    requirements: requirementMapping.map((entry) => entry.requirement),
    preferredQualifications: ['Experience documenting workflows for non-technical readers'],
    experienceYearsMin: 3,
    experienceYearsMax: null,
    applyUrl: 'https://example.test/jobs/workflow-automation-engineer',
    ...overrides,
  };
}

function matchFixture(overrides: Partial<PackMatchSnapshot> = {}): PackMatchSnapshot {
  return {
    jobId,
    score: 74,
    verdict: 'good_match',
    confidence: 'medium',
    modelVersion: 'matching-v1',
    recommendedAction:
      'Apply, and address the gap in your summary honestly rather than leaving it unexplained.',
    strengths: ['Your profile already covers n8n.'],
    gaps: [
      'Compensation could not be compared because the posting does not publish a salary range.',
    ],
    blockers: [],
    dimensions: [
      {
        key: 'roleAlignment',
        label: 'Role alignment',
        weight: 22,
        score: 84,
        contribution: 18,
        detail: 'The title closely matches one of your target roles.',
      },
      {
        key: 'skillsCoverage',
        label: 'Skills coverage',
        weight: 20,
        score: 50,
        contribution: 10,
        detail: 'Your profile covers 1 of the 2 skills this posting names.',
      },
      {
        key: 'compensationAlignment',
        label: 'Compensation',
        weight: 8,
        score: null,
        contribution: 4,
        detail: 'This posting does not publish a salary range.',
      },
    ],
    rejectionRisks: ['1 listed requirement could not be matched to your profile.'],
    requirementMapping,
    evidenceFactIds: [achievementFactId, metricFactId, skillFactId, responsibilityFactId],
    dataQuality: {
      profileCompleteness: 'solid',
      jobDetail: 'detailed',
      unknowns: ['compensationAlignment'],
    },
    computedAt: '2026-09-18T09:00:00.000Z',
    ...overrides,
  };
}

interface Fixture {
  readonly profile: CareerProfileDetail;
  readonly facts: readonly CareerFact[];
  readonly job: PackGenerationJob;
  readonly match: PackMatchSnapshot | null;
}

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    profile: profileFixture(),
    facts: factFixtures(),
    job: jobFixture(),
    match: matchFixture(),
    ...overrides,
  };
}

const allKinds: readonly ApplicationArtifactKind[] = [
  'resume',
  'cover_letter',
  'strategy',
  'requirement_map',
  'recruiter_message',
  'interview_prep',
];

const styles: readonly PackArtifactStyle[] = ['concise', 'standard', 'achievement_led'];

function generate(
  kinds: readonly ApplicationArtifactKind[],
  style: PackArtifactStyle,
  input: Fixture = fixture(),
): readonly PackArtifactDraft[] {
  return generatePackArtifacts({
    profile: input.profile,
    facts: input.facts,
    job: input.job,
    match: input.match,
    kinds,
    style,
  });
}

function draftFor(draftList: readonly PackArtifactDraft[], kind: ApplicationArtifactKind) {
  return draftList.find((draft) => draft.kind === kind);
}

function numbersIn(value: string): readonly string[] {
  return [...value.matchAll(/\d+/gu)].map((match) => match[0]);
}

/** Everything a reader or a machine can see of one draft. */
function draftText(draft: PackArtifactDraft): string {
  return [draft.title, draft.plainText, JSON.stringify(draft.content)].join('\n');
}

function fixtureText(input: Fixture): string {
  return JSON.stringify({
    profile: input.profile,
    facts: input.facts,
    job: input.job,
    match: input.match,
  });
}

// ---------------------------------------------------------------------------
// The truth gate, adversarially
// ---------------------------------------------------------------------------

describe('the truth gate holds under adversarial reading', () => {
  const input = fixture();
  const drafts = generate(allKinds, 'standard', input);

  it('has a draft for every requested kind, in the order requested', () => {
    expect(drafts.map((draft) => draft.kind)).toEqual([...allKinds]);
  });

  it('reports a requirement with no evidence as an explicit gap', () => {
    const map = draftFor(drafts, 'requirement_map');
    expect(map).toBeDefined();
    const section = map?.content.sections.find((entry) =>
      entry.heading.includes(unevidencedRequirement),
    );
    expect(section).toBeDefined();
    expect(section?.paragraphs.some((paragraph) => paragraph.includes('not evidenced'))).toBe(true);
  });

  it('cites no confirmed fact for a requirement that has none', () => {
    const map = draftFor(drafts, 'requirement_map');
    const section = map?.content.sections.find((entry) =>
      entry.heading.includes(unevidencedRequirement),
    );
    expect(section?.sources.filter((source) => source.type === 'career_fact')).toEqual([]);
  });

  it('never turns an unevidenced requirement into a claim anywhere in the output', () => {
    // Every paragraph that names the unevidenced requirement must be saying that
    // it is not evidenced. A paragraph that asserted it would fail here.
    const offending: string[] = [];
    for (const draft of drafts) {
      for (const section of draft.content.sections) {
        for (const paragraph of section.paragraphs) {
          if (paragraph.includes(unevidencedRequirement) && !paragraph.includes('not evidenced')) {
            offending.push(`${draft.kind}: ${paragraph}`);
          }
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it('quotes the confirmed metric fact with its exact number and unit', () => {
    const text = drafts.map(draftText).join('\n');
    expect(text).toContain(metricStatement);
    expect(text).toContain('12 hours per week');
  });

  it('quotes the confirmed achievement fact with the number it already contains', () => {
    expect(drafts.map(draftText).join('\n')).toContain(achievementStatement);
  });

  it('emits no number that is not already present in the inputs', () => {
    const allowed = fixtureText(input);
    const invented: string[] = [];
    for (const draft of drafts) {
      for (const number of numbersIn(draftText(draft))) {
        if (!allowed.includes(number)) invented.push(`${draft.kind}: ${number}`);
      }
    }
    expect(invented).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Evidence bookkeeping
// ---------------------------------------------------------------------------

describe('evidence bookkeeping', () => {
  const input = fixture();
  const confirmedIds = new Set(input.facts.map((fact) => fact.id));
  const drafts = generate(allKinds, 'standard', input);

  it('cites only identifiers from the confirmed evidence set', () => {
    const unknown: string[] = [];
    for (const draft of drafts) {
      for (const id of draft.evidenceFactIds) {
        if (!confirmedIds.has(id)) unknown.push(`${draft.kind}: ${id}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('cites every confirmed fact whose statement it quotes verbatim', () => {
    const missing: string[] = [];
    for (const draft of drafts) {
      for (const fact of input.facts) {
        if (!draft.plainText.includes(fact.statement)) continue;
        if (!draft.evidenceFactIds.includes(fact.id)) missing.push(`${draft.kind}: ${fact.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('never repeats an identifier inside one draft', () => {
    for (const draft of drafts) {
      expect(new Set(draft.evidenceFactIds).size).toBe(draft.evidenceFactIds.length);
    }
  });

  it('cites nothing when there is nothing confirmed to cite', () => {
    const empty = generate(
      allKinds,
      'standard',
      fixture({ facts: [], profile: emptyProfileFixture() }),
    );
    for (const draft of empty) {
      expect(draft.evidenceFactIds).toEqual([]);
    }
  });

  it('builds every paragraph source identifier from a real record or fact', () => {
    const known = new Set<string>([
      ...confirmedIds,
      profileId,
      employmentId,
      projectId,
      educationId,
      certificationId,
      linkId,
      jobId,
    ]);
    const unknown: string[] = [];
    for (const draft of drafts) {
      for (const section of draft.content.sections) {
        for (const source of section.sources) {
          if (!known.has(source.id)) unknown.push(`${draft.kind}: ${source.id}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Content shape
// ---------------------------------------------------------------------------

describe('content shape', () => {
  const drafts = generate(allKinds, 'standard');

  it('uses the sections shape the pack viewer renders', () => {
    for (const draft of drafts) {
      expect(draft.content.sections.length).toBeGreaterThan(0);
      for (const section of draft.content.sections) {
        expect(typeof section.heading).toBe('string');
        expect(section.heading.length).toBeGreaterThan(0);
        expect(Array.isArray(section.paragraphs)).toBe(true);
        for (const paragraph of section.paragraphs) {
          expect(typeof paragraph).toBe('string');
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('sets body to the same paragraphs joined with a blank line', () => {
    // `artifactSections` in the pack viewer reads `body`; the contract asks for
    // `paragraphs`. Both are emitted, and they cannot disagree.
    for (const draft of drafts) {
      for (const section of draft.content.sections) {
        expect(section.body).toBe(section.paragraphs.join('\n\n'));
      }
    }
  });

  it('renders plain text faithfully: every heading and paragraph is present', () => {
    for (const draft of drafts) {
      for (const section of draft.content.sections) {
        expect(draft.plainText).toContain(section.heading);
        for (const paragraph of section.paragraphs) {
          expect(draft.plainText).toContain(paragraph);
        }
      }
    }
  });

  it('contains no HTML tags in plain text', () => {
    for (const draft of drafts) {
      expect(draft.plainText).not.toMatch(/<[a-z/!][^>]*>/iu);
    }
  });

  it('stays inside the storage limits the artifact table enforces', () => {
    for (const draft of drafts) {
      expect(draft.title.length).toBeGreaterThan(0);
      expect(draft.title.length).toBeLessThanOrEqual(200);
      expect(draft.plainText.length).toBeGreaterThan(0);
      expect(draft.plainText.length).toBeLessThanOrEqual(60_000);
      expect(draft.style.length).toBeLessThanOrEqual(60);
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement map
// ---------------------------------------------------------------------------

describe('requirement map', () => {
  const input = fixture();
  const drafts = generate(['requirement_map'], 'standard', input);
  const map = drafts[0];

  it('has exactly one entry per requirement, with none dropped', () => {
    expect(map?.content.sections).toHaveLength(requirementMapping.length);
    expect(map?.content.sections.map((section) => section.heading)).toEqual(
      requirementMapping.map((entry) => entry.requirement),
    );
  });

  it('quotes the confirmed fact that meets a met requirement', () => {
    const section = map?.content.sections.find((entry) => entry.heading.startsWith('Three years'));
    expect(section?.paragraphs).toContain(`Confirmed evidence: "${achievementStatement}"`);
    expect(section?.sources.map((source) => source.id)).toContain(achievementFactId);
  });

  it('says a partially met requirement is only partly evidenced', () => {
    const section = map?.content.sections.find((entry) =>
      entry.heading.startsWith('Strong written communication'),
    );
    expect(section?.paragraphs.some((paragraph) => paragraph.includes('partially met'))).toBe(true);
    expect(section?.paragraphs.some((paragraph) => paragraph.includes('not evidenced'))).toBe(true);
  });

  it('reports an unjudged requirement as not judged rather than as met', () => {
    const section = map?.content.sections.find((entry) =>
      entry.heading.startsWith('Comfortable working'),
    );
    expect(section?.paragraphs.some((paragraph) => paragraph.includes('not judged'))).toBe(true);
  });

  it('receives no confirmation from the frozen snapshot for an unmet requirement', () => {
    // The snapshot's own evidence line is quoted only for requirements the match
    // engine matched, so an unmet requirement carries no profile claim either.
    const section = map?.content.sections.find((entry) =>
      entry.heading.includes(unevidencedRequirement),
    );
    expect(section?.paragraphs.some((paragraph) => paragraph.includes('Your profile lists'))).toBe(
      false,
    );
  });

  it('keeps every requirement in every style', () => {
    for (const style of styles) {
      const styled = generate(['requirement_map'], style, input)[0];
      for (const entry of requirementMapping) {
        expect(styled?.plainText).toContain(entry.requirement);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

describe('strategy', () => {
  const input = fixture();
  const strategy = generate(['strategy'], 'standard', input)[0];

  it('reports the verdict and the score from the frozen match snapshot', () => {
    expect(strategy?.plainText).toContain('Good match');
    expect(strategy?.plainText).toContain('Score: 74');
  });

  it('reports every dimension with its weight and contribution', () => {
    expect(strategy?.plainText).toContain('Role alignment: score 84, weight 22, contributing 18');
    expect(strategy?.plainText).toContain('Compensation: not judged from the available data');
  });

  it('carries the hard blockers and the rejection risks', () => {
    expect(strategy?.plainText).toContain(
      'No hard blocker was recorded in the frozen match result.',
    );
    expect(strategy?.plainText).toContain(
      '1 listed requirement could not be matched to your profile.',
    );
  });

  it('carries the recommended next action verbatim', () => {
    expect(strategy?.plainText).toContain(
      'Apply, and address the gap in your summary honestly rather than leaving it unexplained.',
    );
  });

  it('quotes every number either from the match snapshot or from a confirmed statement it cites', () => {
    // The strategy never introduces a figure of its own: its score and
    // dimensions are the frozen snapshot's, and the only other numbers it can
    // contain are the ones already inside the confirmed statements it quotes
    // word for word.
    const snapshot = JSON.stringify(input.match);
    const cited = input.facts.filter((fact) => strategy?.evidenceFactIds.includes(fact.id));
    const invented = numbersIn(strategy?.plainText ?? '').filter(
      (number) =>
        !snapshot.includes(number) && !cited.some((fact) => fact.statement.includes(number)),
    );
    expect(invented).toEqual([]);
  });

  it('says plainly when no match result was frozen', () => {
    const empty = generate(['strategy'], 'standard', fixture({ match: null }))[0];
    expect(empty?.evidenceFactIds).toEqual([]);
    expect(empty?.plainText).toContain('No match result was frozen for this Application Pack');
  });
});

// ---------------------------------------------------------------------------
// Cover letter, interview preparation, and the recruiter message
// ---------------------------------------------------------------------------

describe('cover letter', () => {
  const input = fixture();
  const letter = generate(['cover_letter'], 'standard', input)[0];

  it('names the role and the employer', () => {
    expect(letter?.plainText).toContain('Workflow Automation Engineer');
    expect(letter?.plainText).toContain('Northstar Systems');
  });

  it('cites between two and four pieces of confirmed evidence', () => {
    expect(letter?.evidenceFactIds.length).toBeGreaterThanOrEqual(2);
    expect(letter?.evidenceFactIds.length).toBeLessThanOrEqual(4);
  });

  it('states which key requirements are not evidenced', () => {
    const text = letter?.plainText ?? '';
    expect(text).toContain(`Not evidenced: "${unevidencedRequirement}"`);
  });

  it('claims nothing when the profile has no confirmed facts at all', () => {
    const empty = generate(
      ['cover_letter'],
      'standard',
      fixture({ facts: [], profile: emptyProfileFixture() }),
    )[0];
    expect(empty?.evidenceFactIds).toEqual([]);
    expect(empty?.plainText).toContain('cites no evidence and claims none');
  });
});

describe('interview preparation', () => {
  const input = fixture();
  const prep = generate(['interview_prep'], 'standard', input)[0];

  it('derives one question per requirement from the posting', () => {
    for (const entry of requirementMapping) {
      expect(prep?.plainText).toContain(entry.requirement);
    }
  });

  it('pairs a met requirement with the confirmed fact to draw on', () => {
    expect(prep?.plainText).toContain(achievementStatement);
  });

  it('tells the candidate to say an unevidenced requirement is not evidenced', () => {
    expect(prep?.plainText).toContain(
      'this requirement is not evidenced by any confirmed career fact',
    );
  });
});

describe('recruiter message', () => {
  const input = fixture();
  const message = generate(['recruiter_message'], 'standard', input)[0];

  it('stays short', () => {
    expect(message?.plainText.length).toBeLessThan(1_500);
  });

  it('cites only the strongest confirmed evidence', () => {
    expect(message?.evidenceFactIds.length).toBeGreaterThan(0);
    expect(message?.evidenceFactIds.length).toBeLessThanOrEqual(2);
  });

  it('makes no seniority, availability, or compensation claim', () => {
    const text = (message?.plainText ?? '').toLowerCase();
    expect(text).not.toContain('senior');
    expect(text).not.toContain('available immediately');
    expect(text).not.toContain('salary');
    expect(text).not.toContain('compensation');
  });
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

describe('styles', () => {
  const input = fixture();

  it('produces different structure for the same inputs', () => {
    for (const kind of allKinds) {
      const headings = styles.map((style) =>
        generate([kind], style, input)[0]?.content.sections.map((section) => section.heading),
      );
      const [concise, standard, achievementLed] = headings;
      expect(concise).not.toEqual(standard);
      expect(achievementLed).not.toEqual(standard);
      expect(concise).not.toEqual(achievementLed);
    }
  });

  it('cites exactly the same confirmed facts in every style', () => {
    for (const kind of allKinds) {
      const cited = styles.map((style) =>
        generate([kind], style, input)[0]?.evidenceFactIds.join(','),
      );
      const [concise, standard, achievementLed] = cited;
      expect(concise).toBe(standard);
      expect(achievementLed).toBe(standard);
    }
  });

  it('defaults to the standard style when none is requested', () => {
    const defaults = generatePackArtifacts({
      profile: input.profile,
      facts: input.facts,
      job: input.job,
      match: input.match,
      kinds: ['resume'],
    });
    expect(defaults[0]?.style).toBe('standard');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces byte-identical output across two calls', () => {
    const first = generate(allKinds, 'achievement_led');
    const second = generate(allKinds, 'achievement_led');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not depend on the order the confirmed facts arrive in', () => {
    const input = fixture();
    const ordered = generate(['resume'], 'standard', input);
    const reversed = generate(
      ['resume'],
      'standard',
      fixture({ facts: [...input.facts].reverse() }),
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(ordered));
  });

  it('reads an empty frozen snapshot as no match result rather than as an empty one', () => {
    expect(readPackMatchSnapshot({})).toBeNull();
    expect(readPackMatchSnapshot(null)).toBeNull();
    expect(readPackMatchSnapshot(matchFixture())?.score).toBe(74);
  });
});

// ---------------------------------------------------------------------------
// An empty profile
// ---------------------------------------------------------------------------

describe('an empty profile', () => {
  const input = fixture({ facts: [], profile: emptyProfileFixture() });
  const drafts = generate(allKinds, 'standard', input);

  it('still produces a non-empty artifact for every kind', () => {
    for (const draft of drafts) {
      expect(draft.content.sections.length).toBeGreaterThan(0);
      expect(draft.plainText.trim().length).toBeGreaterThan(0);
    }
  });

  it('says the resume has nothing to assemble instead of inventing one', () => {
    const resume = draftFor(drafts, 'resume');
    expect(resume?.plainText).toContain('Nothing could be assembled for this artifact yet');
    expect(resume?.plainText).toContain('does not invent experience, employers, dates, or numbers');
  });

  it('still records every requirement as not evidenced', () => {
    const map = draftFor(drafts, 'requirement_map');
    expect(map?.plainText).toContain(unevidencedRequirement);
    expect(map?.plainText).toContain('not evidenced');
  });

  it('emits no number at all beyond the ones in the posting itself', () => {
    const allowed = fixtureText(input);
    const invented = drafts
      .flatMap((draft) => numbersIn(draftText(draft)))
      .filter((number) => !allowed.includes(number));
    expect(invented).toEqual([]);
  });

  it('cites no evidence and says so in the cover letter', () => {
    const letter = draftFor(drafts, 'cover_letter');
    expect(letter?.evidenceFactIds).toEqual([]);
    expect(letter?.plainText).toContain('no evidence');
  });
});
