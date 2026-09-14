import { describe, expect, it } from 'vitest';

import {
  jaccardSimilarity,
  matchingCareerProfileSchema,
  scoreMatch,
  tokenize,
  verdictLabel,
  type MatchingCareerProfile,
  type MatchingJob,
} from '../../packages/matching/src/index.js';

const profileId = 'b0000000-0000-4000-8000-000000000001';
const jobId = 'b0000000-0000-4000-8000-000000000002';
const otherJobId = 'b0000000-0000-4000-8000-000000000003';

const now = new Date('2026-09-14T00:00:00.000Z');

function profile(overrides: Partial<MatchingCareerProfile> = {}): MatchingCareerProfile {
  return {
    id: profileId,
    version: 3,
    headline: 'Workflow automation specialist',
    summary: 'Builds reliable automation between business systems for small operations teams.',
    currentRoleTitle: 'Automation Specialist',
    careerLevel: 'mid',
    yearsExperience: 3.5,
    industries: ['SaaS'],
    targetRoleTitles: ['Workflow Automation Engineer', 'Solutions Engineer'],
    excludedRoleTitles: ['Unpaid internship'],
    preferredEmploymentTypes: ['full_time', 'contract'],
    preferredWorkArrangement: 'remote',
    preferredLocations: ['Metro Manila', 'Remote'],
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
      { name: 'Process design', skillKind: 'skill', isPrimary: false, proficiency: 'advanced' },
      {
        name: 'Stakeholder communication',
        skillKind: 'soft_skill',
        isPrimary: false,
        proficiency: 'advanced',
      },
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

function job(overrides: Partial<MatchingJob> = {}): MatchingJob {
  return {
    id: jobId,
    title: 'Workflow Automation Engineer',
    companyName: 'Northstar Systems',
    description:
      'Own internal automation between business systems. You will design workflows, maintain integrations, and improve reporting reliability.',
    employmentType: 'full_time',
    seniority: 'mid',
    remoteState: 'remote',
    locationRaw: 'Remote — Philippines',
    city: 'Manila',
    region: 'Metro Manila',
    countryCode: 'PH',
    isPhilippines: true,
    salaryMinMinor: 9_000_000,
    salaryMaxMinor: 12_000_000,
    salaryCurrency: 'PHP',
    salaryPeriod: 'monthly',
    skills: ['n8n', 'TypeScript', 'Supabase'],
    requirements: [
      '3+ years building automation with n8n and TypeScript',
      'Experience with Supabase',
    ],
    preferredQualifications: ['Experience in SaaS operations'],
    experienceYearsMin: 3,
    experienceYearsMax: null,
    postedAt: '2026-09-13T00:00:00.000Z',
    lastSeenAt: '2026-09-13T12:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

describe('matching input validation', () => {
  it('rejects a malformed profile instead of scoring garbage', () => {
    expect(matchingCareerProfileSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('accepts a well-formed profile', () => {
    expect(matchingCareerProfileSchema.safeParse(profile()).success).toBe(true);
  });
});

describe('text similarity helpers', () => {
  it('tokenizes while dropping stop words and single characters', () => {
    expect(tokenize('The Senior Automation Engineer (Remote)')).toEqual([
      'senior',
      'automation',
      'engineer',
      'remote',
    ]);
  });

  it('returns 0 for empty input and 1 for identical text', () => {
    expect(jaccardSimilarity('', 'anything')).toBe(0);
    expect(jaccardSimilarity('automation engineer', 'automation engineer')).toBe(1);
  });
});

describe('explainable match scoring', () => {
  const result = scoreMatch(profile(), job(), {
    now,
    evidenceFactIds: ['c0000000-0000-4000-8000-000000000001'],
    confirmedFactCount: 4,
  });

  it('produces a score between 0 and 100 with a verdict and confidence', () => {
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['strong_match', 'good_match', 'stretch', 'weak_match', 'not_recommended']).toContain(
      result.verdict,
    );
    expect(['high', 'medium', 'low']).toContain(result.confidence);
  });

  it('reports every dimension with its weight and contribution', () => {
    expect(result.dimensions).toHaveLength(9);
    for (const dimension of result.dimensions) {
      expect(dimension.weight).toBeGreaterThan(0);
      if (dimension.score !== null) {
        expect(dimension.contribution).toBe(Math.round((dimension.score * dimension.weight) / 100));
      }
      expect(dimension.detail.length).toBeGreaterThan(0);
    }
    const totalWeight = result.dimensions.reduce((total, entry) => total + entry.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('is deterministic for the same inputs', () => {
    const repeat = scoreMatch(profile(), job(), { now });
    expect(repeat.score).toBe(scoreMatch(profile(), job(), { now }).score);
    expect(repeat.verdict).toBe(result.verdict);
    expect(repeat.modelVersion).toBe(result.modelVersion);
  });

  it('recovers the target role and the skills the profile actually has', () => {
    expect(result.strengths.join(' ')).toMatch(/n8n/u);
    expect(result.gaps.join(' ')).not.toMatch(/n8n/u);
  });

  it('lists a missing skill as a gap rather than silently ignoring it', () => {
    const withGap = scoreMatch(
      profile(),
      job({ skills: ['n8n', 'TypeScript', 'Kubernetes'], requirements: [] }),
      { now },
    );
    expect(withGap.gaps.join(' ')).toMatch(/kubernetes/iu);
  });

  it('never upgrades a score when the profile is thin', () => {
    const thin = scoreMatch(
      profile({ skills: [], targetRoleTitles: [], yearsExperience: null, salaryMinMinor: null }),
      job(),
      { now },
    );
    expect(thin.confidence).not.toBe('high');
    expect(thin.dataQuality.profileCompleteness).toBe('thin');
    expect(thin.dataQuality.unknowns.length).toBeGreaterThan(0);
  });

  it('marks an unknown dimension as null instead of guessing a perfect score', () => {
    const withoutTargets = scoreMatch(profile({ targetRoleTitles: [] }), job(), { now });
    const role = withoutTargets.dimensions.find((entry) => entry.key === 'roleAlignment');
    expect(role?.score).toBeNull();
    expect(withoutTargets.dataQuality.unknowns).toContain('roleAlignment');
  });

  it('blocks a role the user explicitly excluded', () => {
    const blocked = scoreMatch(
      profile({ excludedRoleTitles: ['Workflow Automation Engineer'] }),
      job(),
      {
        now,
      },
    );
    expect(blocked.verdict).toBe('not_recommended');
    expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(blocked.recommendedAction).toMatch(/skip/iu);
  });

  it('blocks a foreign on-site role for a candidate who is not open to it', () => {
    const blocked = scoreMatch(
      profile({
        openToInternational: false,
        openToRelocation: false,
        preferredWorkArrangement: 'onsite',
      }),
      job({
        remoteState: 'onsite',
        isPhilippines: false,
        countryCode: 'SG',
        locationRaw: 'Singapore',
        city: 'Singapore',
        region: null,
      }),
      { now },
    );
    expect(blocked.blockers.join(' ')).toMatch(/outside the philippines/iu);
    expect(blocked.verdict).toBe('not_recommended');
  });

  it('flags a non-active posting as a blocker', () => {
    const expired = scoreMatch(profile(), job({ status: 'expired' }), { now });
    expect(expired.blockers.join(' ')).toMatch(/no longer active/iu);
  });

  it('refuses to compare compensation in a different currency', () => {
    const otherCurrency = scoreMatch(profile(), job({ salaryCurrency: 'USD' }), { now });
    const compensation = otherCurrency.dimensions.find(
      (entry) => entry.key === 'compensationAlignment',
    );
    expect(compensation?.score).toBeNull();
    expect(compensation?.detail).toMatch(/not compared/iu);
  });

  it('penalises compensation below the stated minimum', () => {
    const low = scoreMatch(
      profile(),
      job({ salaryMinMinor: 4_000_000, salaryMaxMinor: 5_000_000 }),
      {
        now,
      },
    );
    const compensation = low.dimensions.find((entry) => entry.key === 'compensationAlignment');
    expect(compensation?.score).toBeLessThan(70);
    expect(low.gaps.join(' ')).toMatch(/below your stated minimum/iu);
  });

  it('rewards a recent posting and penalises an old one', () => {
    const fresh = scoreMatch(profile(), job({ postedAt: '2026-09-13T20:00:00.000Z' }), { now });
    const stale = scoreMatch(profile(), job({ postedAt: '2026-06-01T00:00:00.000Z' }), { now });
    const freshRecency = fresh.dimensions.find((entry) => entry.key === 'recency');
    const staleRecency = stale.dimensions.find((entry) => entry.key === 'recency');
    expect(freshRecency?.score).toBe(100);
    expect(staleRecency?.score).toBeLessThan(40);
  });

  it('maps each stated requirement to met, partially met, unmet, or unknown', () => {
    const mapping = scoreMatch(
      profile(),
      job({
        requirements: [
          'Strong n8n and TypeScript experience',
          'Kubernetes cluster administration',
          'Excellent written communication',
        ],
      }),
      { now },
    );
    expect(mapping.requirementMapping.length).toBe(4);
    const statuses = mapping.requirementMapping.map((entry) => entry.status);
    expect(statuses).toContain('met');
    expect(statuses).toContain('unmet');
    const unmet = mapping.requirementMapping.find((entry) => entry.status === 'unmet');
    expect(unmet?.requirement).toMatch(/kubernetes/iu);
    expect(unmet?.evidence).toBeNull();
  });

  it('raises the rejection risk when skill coverage is low', () => {
    const weak = scoreMatch(
      profile({ skills: [] }),
      job({ skills: ['Kubernetes', 'Terraform', 'Go'], requirements: [] }),
      { now },
    );
    expect(weak.rejectionRisks.join(' ')).toMatch(/skill coverage/iu);
  });

  it('carries only the supplied confirmed evidence identifiers', () => {
    const evidence = ['c0000000-0000-4000-8000-00000000000a'];
    const scored = scoreMatch(profile(), job(), { now, evidenceFactIds: evidence });
    expect([...scored.evidenceFactIds]).toEqual(evidence);
  });

  it('recommends completing the profile when confidence is low', () => {
    const thin = scoreMatch(
      profile({
        skills: [],
        targetRoleTitles: [],
        yearsExperience: null,
        summary: null,
        headline: null,
      }),
      job({ requirements: [], skills: [], preferredQualifications: [] }),
      { now },
    );
    expect(thin.confidence).toBe('low');
    expect(thin.recommendedAction).toMatch(/complete more of your career profile/iu);
  });

  it('scores a strong match higher than an unrelated opportunity', () => {
    const good = scoreMatch(profile(), job(), { now });
    const unrelated = scoreMatch(
      profile(),
      job({
        id: otherJobId,
        title: 'Night Shift Customer Support Representative',
        description: 'Handle inbound calls on a night shift schedule.',
        seniority: 'entry',
        remoteState: 'onsite',
        skills: [],
        requirements: [],
        preferredQualifications: [],
        employmentType: 'part_time',
        salaryMinMinor: 1_500_000,
        salaryMaxMinor: 2_000_000,
        experienceYearsMin: null,
      }),
      { now },
    );
    expect(good.score).toBeGreaterThan(unrelated.score);
  });

  it('exposes a human-readable verdict label', () => {
    expect(verdictLabel('strong_match')).toBe('Strong match');
    expect(verdictLabel('not_recommended')).toBe('Not recommended');
  });
});
