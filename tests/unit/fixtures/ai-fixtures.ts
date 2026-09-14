import {
  scoreMatch,
  type MatchingCareerProfile,
  type MatchingJob,
  type MatchResult,
} from '../../../packages/matching/src/index.js';
import type { GroundingContext, GroundingFact } from '@hanaply/ai';

export const profileId = 'c1000000-0000-4000-8000-000000000001';
export const jobId = 'c1000000-0000-4000-8000-000000000002';

export const automationFactId = 'c1000000-0000-4000-8000-0000000000f1';
export const onboardingFactId = 'c1000000-0000-4000-8000-0000000000f2';
export const metricFactId = 'c1000000-0000-4000-8000-0000000000f3';
export const educationFactId = 'c1000000-0000-4000-8000-0000000000f4';
export const unconfirmedFactId = 'c1000000-0000-4000-8000-0000000000f9';

export const fixedNow = new Date('2026-09-14T00:00:00.000Z');

/** A profile whose facts, employers, and skills are all traceable. */
export function careerProfile(
  overrides: Partial<MatchingCareerProfile> = {},
): MatchingCareerProfile {
  return {
    id: profileId,
    version: 3,
    headline: 'Workflow automation specialist',
    summary: 'Builds reliable automation between business systems for small operations teams.',
    currentRoleTitle: 'Automation Specialist',
    careerLevel: 'mid',
    yearsExperience: 3,
    industries: ['SaaS'],
    targetRoleTitles: ['Workflow Automation Engineer'],
    excludedRoleTitles: ['Unpaid internship'],
    preferredEmploymentTypes: ['full_time'],
    preferredWorkArrangement: 'remote',
    preferredLocations: ['Metro Manila'],
    openToInternational: true,
    openToRelocation: false,
    salaryMinMinor: 8_000_000,
    salaryMaxMinor: 11_000_000,
    salaryCurrency: 'PHP',
    salaryPeriod: 'monthly',
    skills: [
      { name: 'n8n', skillKind: 'tool', isPrimary: true, proficiency: 'advanced' },
      { name: 'TypeScript', skillKind: 'technology', isPrimary: true, proficiency: 'advanced' },
      { name: 'Supabase', skillKind: 'technology', isPrimary: false, proficiency: 'intermediate' },
    ],
    employment: [
      {
        roleTitle: 'Automation Specialist',
        companyName: 'Northstar Systems',
        isCurrent: true,
        startDate: '2023-02-01',
        endDate: null,
        skills: ['n8n', 'TypeScript'],
        highlights: ['Rebuilt onboarding automation for a 40-person team'],
      },
    ],
    ...overrides,
  };
}

export function automationJob(overrides: Partial<MatchingJob> = {}): MatchingJob {
  return {
    id: jobId,
    title: 'Workflow Automation Engineer',
    companyName: 'Northstar Systems',
    description:
      'Own internal automation between business systems. You will design workflows, maintain integrations, and improve reporting reliability.',
    employmentType: 'full_time',
    seniority: 'mid',
    remoteState: 'remote',
    locationRaw: 'Remote, Philippines',
    city: 'Manila',
    region: 'Metro Manila',
    countryCode: 'PH',
    isPhilippines: true,
    salaryMinMinor: 9_000_000,
    salaryMaxMinor: 12_000_000,
    salaryCurrency: 'PHP',
    salaryPeriod: 'monthly',
    skills: ['n8n', 'TypeScript', 'Supabase'],
    requirements: ['3+ years building automation with n8n and TypeScript'],
    preferredQualifications: ['Experience in SaaS operations'],
    experienceYearsMin: 3,
    experienceYearsMax: null,
    postedAt: '2026-09-13T00:00:00.000Z',
    lastSeenAt: '2026-09-13T12:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

/**
 * Confirmed career facts. Only rows a member confirmed are admissible; the
 * unconfirmed row is deliberately included in `allFacts` and left out of
 * `confirmedFacts` so a test can prove it is not admissible.
 */
export function confirmedFacts(): GroundingFact[] {
  return [
    {
      id: automationFactId,
      category: 'experience',
      statement: 'Built automation workflows with n8n and TypeScript at Northstar Systems.',
    },
    {
      id: onboardingFactId,
      category: 'responsibility',
      statement: 'Rebuilt onboarding automation for a 40-person team.',
    },
    {
      id: metricFactId,
      category: 'metric',
      statement: 'Cut manual onboarding handling time by 20%.',
      metricValue: 20,
      metricUnit: 'percent',
    },
    {
      id: educationFactId,
      category: 'education',
      statement: 'BS Computer Science, University of the Philippines.',
    },
  ];
}

/** A candidate fact the member never confirmed, used to prove inadmissibility. */
export function unconfirmedFact(): GroundingFact {
  return {
    id: unconfirmedFactId,
    category: 'certification',
    statement: 'AWS Certified Solutions Architect, Associate.',
  };
}

export const admissibleFactIds = [
  automationFactId,
  onboardingFactId,
  metricFactId,
  educationFactId,
];

export function matchResult(): MatchResult {
  return scoreMatch(careerProfile(), automationJob(), {
    now: fixedNow,
    evidenceFactIds: admissibleFactIds,
  });
}

export function groundingContext(
  options: { facts?: GroundingFact[]; profile?: MatchingCareerProfile; job?: MatchingJob } = {},
): GroundingContext {
  const profile = options.profile ?? careerProfile();
  const job = options.job ?? automationJob();
  const match = scoreMatch(profile, job, {
    now: fixedNow,
    evidenceFactIds: admissibleFactIds,
  });
  const facts = options.facts ?? confirmedFacts();
  // Admissibility is declared, never inferred from what happens to be present:
  // a fact the caller passes but does not admit is context, not evidence.
  const admitted = options.facts?.map((fact) => fact.id) ?? admissibleFactIds;
  return {
    facts,
    deterministic: {
      job: {
        id: job.id,
        title: job.title,
        companyName: job.companyName,
        description: job.description,
        location: job.locationRaw,
        employmentType: job.employmentType,
        seniority: job.seniority,
        salaryText: 'PHP 9000000-12000000 monthly, in minor units',
        skills: job.skills,
        requirements: job.requirements,
        preferredQualifications: job.preferredQualifications,
      },
      match: {
        score: match.score,
        verdict: match.verdict,
        confidence: match.confidence,
        modelVersion: match.modelVersion,
        strengths: match.strengths,
        gaps: match.gaps,
        blockers: match.blockers,
        rejectionRisks: match.rejectionRisks,
        recommendedAction: match.recommendedAction,
        dimensionDetails: match.dimensions.map((dimension) =>
          dimension.score === null
            ? `${dimension.label}: not judged from the available data.`
            : `${dimension.label}: judged from the available data. ${dimension.detail}`,
        ),
        requirementStatements: match.requirementMapping.map(
          (entry) => `Requirement: ${entry.requirement} Status: ${entry.status}.`,
        ),
      },
      profileIdentity: {
        name: profile.headline ?? 'the member',
        headline: profile.summary,
        currentRoleTitle: profile.currentRoleTitle,
        totalYearsExperience: profile.yearsExperience,
        employers: profile.employment.map((entry) => entry.companyName),
        employmentTitles: profile.employment.map((entry) => entry.roleTitle),
        institutions: ['University of the Philippines'],
        certifications: [],
        skills: profile.skills.map((skill) => skill.name),
        industries: profile.industries,
        locations: profile.preferredLocations,
      },
      admissibleFactIds: admitted,
    },
  };
}

/** A fully grounded opportunity report: nothing in it is invented. */
export function groundedOpportunityReport(): Record<string, unknown> {
  return {
    verdict: {
      restatesMatchVerdict: true,
      summary:
        'Hanaply scored this posting as a strong match with high confidence, and the posting asks for the tools your record already shows.',
    },
    whyInteresting: [
      'The posting is a remote role in the Philippines, which fits the work setup on your profile.',
      'Your confirmed record already covers n8n and TypeScript, which the posting names.',
    ],
    strongestEvidence: [
      {
        factId: automationFactId,
        insight: 'This is the fact that speaks most directly to the automation requirement.',
      },
      {
        factId: onboardingFactId,
        insight: 'This shows the work was delivered for a real team rather than studied.',
      },
    ],
    transferableStrengths: [
      'Supabase is on your profile, and the posting treats it as an adjacent platform rather than a core requirement.',
    ],
    gaps: [
      'No confirmed fact records SaaS operations experience, which Northstar Systems lists as preferred.',
      'I rebuilt onboarding automation for a 40-person team, which is the fact to use for the onboarding requirement.',
    ],
    hardBlockers: [],
    rejectionRisks: [
      'The stated experience requirement is above what your profile records, so a screen may filter this out.',
    ],
    careerDirection: [
      'This role moves you further into automation engineering, which is where your target titles point.',
    ],
    salaryAndLocationConcerns: [
      'The published range starts at 9000000 minor units monthly, so compare it against your own minimum before applying.',
    ],
    whatToEmphasise: [
      'Lead with the automation work you confirmed, and name the tools exactly as the confirmed fact names them.',
      'Describe the onboarding rebuild as delivered work for a real team.',
    ],
    whatNotToClaim: [
      'Do not claim SaaS operations experience. No confirmed fact supports it, so present it as a gap instead.',
      'Do not claim a certification. No confirmed fact records one.',
    ],
    recommendedNextAction:
      'Apply this week, and lead the application with the confirmed automation work rather than a summary of it.',
    applicationStrategy: [
      'Put the confirmed automation fact in the first third of the resume.',
      'Address the preferred qualification you cannot evidence as a gap rather than leaving it unexplained.',
    ],
    interviewStrategy: [
      'Prepare to describe how the onboarding rebuild was delivered, using the confirmed fact as the anchor.',
      'Be ready to say plainly that you have not worked in SaaS operations.',
    ],
  };
}
