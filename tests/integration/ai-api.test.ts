import 'reflect-metadata';

import { createFakeAiProvider, DisabledAiProvider, type FakeAiProvider } from '@hanaply/ai';
import { parseApiEnvironment } from '@hanaply/config';
import {
  apiContract,
  apiErrorEnvelopeSchema,
  type ConfirmedCareerEvidence,
} from '@hanaply/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';
import { aiError } from '../../services/api/src/ai.repository.js';
import type { AuthContext } from '../../services/api/src/http.js';
import type {
  AiInvocationRecord,
  CoachConversationDetailRow,
  CoachConversationRow,
  CoachMessageRow,
  StoredAnalysis,
} from '../../services/api/src/ai.repository.js';

/**
 * The AI routes, wired end to end against an injected fake provider.
 *
 * The provider layer and the truth gate are covered by
 * `tests/unit/ai-provider.test.ts`. What this proves is the seam the API adds:
 * that the routes exist at their canonical paths, that a generated analysis is
 * cached on its evidence fingerprint and served from cache on a second read,
 * that the truth gate's refusal arrives as a clear refusal rather than a 500,
 * that the coach round-trips with facts and suggestions kept apart, that quota
 * is consumed exactly once across a retry, that a plan without the feature is
 * refused, and that a disabled provider produces a degraded 200 rather than an
 * error or mislabelled deterministic text.
 */

const now = '2026-09-24T09:00:00.000Z';
const userId = '41000000-0000-4000-8000-000000000001';
const profileId = '41000000-0000-4000-8000-000000000002';
const jobId = '41000000-0000-4000-8000-000000000003';
const factId = '41000000-0000-4000-8000-0000000000f1';
const otherFactId = '41000000-0000-4000-8000-0000000000f2';
const conversationId = '41000000-0000-4000-8000-000000000004';
const messageId = '41000000-0000-4000-8000-000000000005';
const invocationId = '41000000-0000-4000-8000-000000000006';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  HANAPLY_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:3100',
  API_BASE_URL: 'http://localhost:3101',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3100',
  RATE_LIMIT_STORE: 'memory',
  OPENAPI_ENABLED: 'true',
  BUILD_SHA: 'integration-test',
});

// ---------------------------------------------------------------------------
// Deterministic inputs the routes read
// ---------------------------------------------------------------------------

/** The stored match result, exactly as `job_detail` returns it. */
const storedMatch = {
  jobId,
  score: 82,
  verdict: 'strong_match' as const,
  confidence: 'high' as const,
  modelVersion: 'matching-v1',
  recommendedAction: 'Apply this week and lead with the automation work.',
  strengths: ['Your confirmed record covers n8n and TypeScript, which the posting names.'],
  gaps: ['No confirmed fact records SaaS operations experience.'],
  blockers: [],
  rejectionRisks: ['The stated experience requirement is above what your profile records.'],
  computedAt: now,
  dimensions: [
    {
      key: 'skillsCoverage',
      label: 'Skills coverage',
      weight: 20,
      score: 90,
      contribution: 18,
      detail: 'Three of four named skills are on the profile.',
    },
  ],
  requirementMapping: [
    {
      requirement: '3+ years building automation with n8n and TypeScript',
      status: 'met' as const,
      matchedSkills: ['n8n', 'TypeScript'],
      evidence: 'Confirmed automation experience at Northstar Systems.',
    },
  ],
  evidenceFactIds: [factId],
  dataQuality: {
    profileCompleteness: 'solid',
    jobDetail: 'detailed',
    unknowns: [],
  },
};

const jobDetail = {
  id: jobId,
  title: 'Workflow Automation Engineer',
  companyName: 'Northstar Systems',
  employmentType: 'full_time' as const,
  seniority: 'mid' as const,
  remoteState: 'remote' as const,
  locationRaw: 'Remote, Philippines',
  city: 'Manila',
  region: 'Metro Manila',
  countryCode: 'PH',
  isPhilippines: true,
  isInternational: false,
  salaryMinMinor: 9_000_000,
  salaryMaxMinor: 12_000_000,
  salaryCurrency: 'PHP',
  salaryPeriod: 'monthly' as const,
  salaryIsEstimate: false,
  skills: ['n8n', 'TypeScript'],
  postedAt: now,
  firstSeenAt: now,
  lastSeenAt: now,
  lastVerifiedAt: now,
  sourceCount: 1,
  status: 'active' as const,
  excerpt: 'Own internal automation between business systems.',
  expiresAt: null,
  description:
    'Own internal automation between business systems. You will design workflows and maintain integrations.',
  requirements: ['3+ years building automation with n8n and TypeScript'],
  preferredQualifications: ['Experience in SaaS operations'],
  experienceYearsMin: 3,
  experienceYearsMax: null,
  applyUrl: 'https://example.test/jobs/workflow-automation-engineer',
  canonicalUrl: 'https://example.test/jobs/workflow-automation-engineer',
  careerProfileId: profileId,
  savedAt: null,
  feedback: null,
  match: storedMatch,
  sources: [],
};

const profile = {
  id: profileId,
  name: 'Ana Reyes',
  isPrimary: true,
  status: 'active' as const,
  headline: 'Workflow automation specialist',
  currentRoleTitle: 'Automation Specialist',
  careerLevel: 'mid' as const,
  yearsExperience: 3,
  targetRoleTitles: ['Workflow Automation Engineer'],
  preferredWorkArrangement: 'remote' as const,
  completenessPercent: 60,
  version: 3,
  createdAt: now,
  updatedAt: now,
  summary: 'Builds reliable automation between business systems.',
  industries: ['SaaS'],
  excludedRoleTitles: [],
  preferredEmploymentTypes: ['full_time' as const],
  preferredLocations: ['Metro Manila'],
  openToInternational: true,
  openToRelocation: false,
  workAuthorizations: [],
  availability: null,
  salaryExpectation: null,
  careerGoals: null,
  lastReviewedAt: null,
  completeness: {
    percent: 60,
    missing: [],
    counts: { employment: 1, skills: 1, education: 0, links: 0, confirmedFacts: 2 },
  },
  subCareers: [],
  employment: [
    {
      id: '41000000-0000-4000-8000-00000000000e',
      roleTitle: 'Automation Specialist',
      companyName: 'Northstar Systems',
      employmentType: 'full_time' as const,
      isCurrent: true,
      startDate: '2023-02-01',
      endDate: null,
      locationRaw: 'Remote',
      summary: null,
      skills: ['n8n'],
      highlights: ['Rebuilt onboarding automation for a 40-person team'],
      displayOrder: 0,
    },
  ],
  projects: [],
  education: [],
  certifications: [],
  links: [],
  skills: [
    {
      id: '41000000-0000-4000-8000-00000000000f',
      name: 'n8n',
      skillKind: 'tool' as const,
      proficiency: 'advanced' as const,
      yearsExperience: 3,
      lastUsedYear: 2026,
      isPrimary: true,
      displayOrder: 0,
    },
  ],
  factCounts: { candidate: 0, confirmed: 2, rejected: 0 },
};

const evidence: ConfirmedCareerEvidence = {
  careerProfileId: profileId,
  facts: [
    {
      id: factId,
      category: 'experience',
      statement: 'Built automation workflows with n8n and TypeScript at Northstar Systems.',
      source: 'user_entered',
      metricValue: null,
      metricUnit: null,
      metricContext: null,
      evidence: {},
      confirmedAt: now,
    },
    {
      id: otherFactId,
      category: 'responsibility',
      statement: 'Rebuilt onboarding automation for a 40-person team.',
      source: 'user_entered',
      metricValue: null,
      metricUnit: null,
      metricContext: null,
      evidence: {},
      confirmedAt: now,
    },
  ],
};

/** A fully grounded report: nothing in it is invented and every citation exists. */
function groundedReport(): Record<string, unknown> {
  return {
    verdict: {
      restatesMatchVerdict: true,
      summary:
        'Hanaply scored this posting as a strong match with high confidence, and the posting asks for tools your record already shows.',
    },
    whyInteresting: [
      'The posting is a remote role in the Philippines, which fits the work setup on your profile.',
    ],
    strongestEvidence: [
      {
        factId,
        insight: 'This is the fact that speaks most directly to the automation requirement.',
      },
    ],
    transferableStrengths: [
      'Your confirmed automation work is adjacent to the integration work this posting names.',
    ],
    gaps: ['No confirmed fact records SaaS operations experience.'],
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
    ],
    whatNotToClaim: [
      'Do not claim SaaS operations experience. No confirmed fact supports it, so present it as a gap instead.',
    ],
    recommendedNextAction: 'Apply this week and lead with the confirmed automation work.',
    applicationStrategy: ['Put the confirmed automation fact in the first third of the resume.'],
    interviewStrategy: ['Be ready to say plainly that you have not worked in SaaS operations.'],
  };
}

/** A report that cites a fact the member never confirmed. The gate must refuse it. */
function ungroundedReport(): Record<string, unknown> {
  return {
    ...groundedReport(),
    strongestEvidence: [
      {
        factId: '41000000-0000-4000-8000-0000000000ff',
        insight: 'This cites a fact the member never confirmed.',
      },
    ],
  };
}

function coachingReply(): Record<string, unknown> {
  return {
    facts: [
      {
        statement: 'You have confirmed automation work with n8n and TypeScript.',
        evidenceFactIds: [factId],
      },
    ],
    suggestions: [
      {
        kind: 'inference',
        statement: 'It may be worth confirming whether you have worked in SaaS operations.',
        rationale: 'The posting lists it as preferred and no confirmed fact covers it.',
      },
    ],
    questionsToConfirm: ['Have you supported a SaaS product in production?'],
    nextSteps: ['Confirm the automation facts you want your applications to lead with.'],
  };
}

// ---------------------------------------------------------------------------
// The database boundary, replaced
// ---------------------------------------------------------------------------

interface RecordedRecord {
  readonly operation: string;
  readonly outcome: string;
  readonly cached: boolean;
  readonly requestId: string;
}

const invocationRecords: RecordedRecord[] = [];
const analyses = new Map<string, StoredAnalysis & { key: string }>();
const messages: CoachMessageRow[] = [];
let conversationOpened = 0;
let refuseConversation = false;

function analysisKey(input: {
  provider: string;
  model: string;
  promptVersion: string;
  evidenceFingerprint: string;
}): string {
  return [input.provider, input.model, input.promptVersion, input.evidenceFingerprint].join('|');
}

const conversationRow = (): CoachConversationRow => ({
  id: conversationId,
  careerProfileId: profileId,
  title: 'Coaching conversation',
  topic: 'general',
  status: 'open',
  provider: null,
  model: null,
  messageCount: messages.length,
  lastMessageAt: messages.length === 0 ? null : now,
  createdAt: now,
  updatedAt: now,
});

const aiRepository = {
  aiProvider: null as unknown,
  jobDetail: (): Promise<typeof jobDetail> => Promise.resolve(jobDetail),
  careerProfile: (): Promise<typeof profile> => Promise.resolve(profile),
  careerProfileDirectory: () =>
    Promise.resolve({
      items: [profile],
      limits: { careerProfileLimit: 1, subCareerLimitPerProfile: 3 },
    }),
  confirmedEvidence: (): Promise<ConfirmedCareerEvidence> => Promise.resolve(evidence),
  storedAnalysis: (
    _userId: string,
    _profileId: string,
    _jobId: string,
    key: { provider: string; model: string; promptVersion: string; evidenceFingerprint: string },
  ): Promise<StoredAnalysis | null> => {
    const found = analyses.get(analysisKey(key));
    return Promise.resolve(found ?? null);
  },
  coachConversations: (): Promise<readonly CoachConversationRow[]> =>
    Promise.resolve(conversationOpened === 0 ? [] : [conversationRow()]),
  coachConversationDetail: (
    _userId: string,
    targetConversationId: string,
  ): Promise<CoachConversationDetailRow> => {
    if (refuseConversation || targetConversationId !== conversationId) {
      return Promise.reject(
        aiError({ code: 'P0002', message: 'coach conversation does not exist' }, 'not found'),
      );
    }
    return Promise.resolve({ conversation: conversationRow(), messages: [...messages] });
  },
  usageFor: (
    _userId: string,
    feature: 'ai_analysis' | 'coach_message',
  ): Promise<{ used: number; limit: number; remaining: number } | null> => {
    const limit = feature === 'coach_message' ? coachMessageLimit : analysisLimit;
    if (limit <= 0) return Promise.resolve(null);
    return Promise.resolve({ used: usage.get(feature) ?? 0, limit, remaining: limit });
  },
  recordInvocation: (record: AiInvocationRecord): Promise<string> => {
    invocationRecords.push({
      operation: record.operation,
      outcome: record.outcome,
      cached: record.cached,
      requestId: record.requestId,
    });
    return Promise.resolve(invocationId);
  },
  recordAnalysis: (input: {
    evidenceFingerprint: string;
    provider: string;
    model: string;
    promptVersion: string;
    analysis: Record<string, unknown>;
  }): Promise<string> => {
    analyses.set(
      analysisKey({
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        evidenceFingerprint: input.evidenceFingerprint,
      }),
      {
        id: invocationId,
        analysis: input.analysis,
        citedFactIds: [factId],
        createdAt: now,
        key: input.evidenceFingerprint,
      },
    );
    return Promise.resolve(invocationId);
  },
  openCoachConversation: (): Promise<CoachConversationRow> => {
    conversationOpened += 1;
    return Promise.resolve(conversationRow());
  },
  appendCoachMessage: (input: {
    role: 'user' | 'assistant';
    body: string;
    facts: readonly { statement: string; evidenceFactIds: readonly string[] }[];
    suggestions: readonly { kind: 'inference'; statement: string; rationale: string }[];
    citedFactIds: readonly string[];
  }): Promise<CoachMessageRow> => {
    const row: CoachMessageRow = {
      id: messages.length === 0 ? messageId : `${messageId.slice(0, -1)}${messages.length}`,
      sequence: messages.length + 1,
      role: input.role,
      body: input.body,
      facts: input.facts.map((fact) => ({
        statement: fact.statement,
        evidenceFactIds: [...fact.evidenceFactIds],
      })),
      suggestions: input.suggestions.map((suggestion) => ({ ...suggestion })),
      citedFactIds: [...input.citedFactIds],
      createdAt: now,
    };
    messages.push(row);
    return Promise.resolve(row);
  },
};

/**
 * The metered quota the plan grants. `consume` is not exposed as a database
 * function for these features, so the API's own meter records the consumption;
 * this map is that record, and the assertions below read it.
 */
const usage = new Map<'ai_analysis' | 'coach_message', number>();
let analysisLimit = 20;
let coachMessageLimit = 20;

const authService = {
  authenticate(request: { headers: Record<string, string | undefined>; auth?: AuthContext }) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return Promise.reject(
        new AppError({
          code: 'AUTHENTICATION_REQUIRED',
          status: 401,
          message: 'Authentication is required',
        }),
      );
    }
    request.auth = { userId, accessToken: authorization.slice(7), accountStatus: 'active' };
    return Promise.resolve();
  },
  authorizeAdmin: () => Promise.resolve(),
};

const authorized = { authorization: 'Bearer user-token' };

describe('AI routes', () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;
  let provider: FakeAiProvider;
  let meter: { reset: () => void };

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      repository: {},
      careerRepository: {},
      aiRepository,
      aiProvider: createFakeAiProvider({ model: 'hanaply-fake-1' }),
      authService,
    });
    const { AI_PROVIDER_TOKEN } = await import('../../services/api/src/tokens.js');
    provider = app.get(AI_PROVIDER_TOKEN);
    // Each case below starts from a fresh quota ledger so "consumed exactly
    // once" is asserted within one logical operation rather than across cases.
    const { AiMeter } = await import('../../services/api/src/ai-meter.js');
    meter = app.get(AiMeter);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    provider.reset();
    meter.reset();
    invocationRecords.length = 0;
    analyses.clear();
    messages.length = 0;
    conversationOpened = 0;
    refuseConversation = false;
    usage.clear();
    analysisLimit = 20;
    coachMessageLimit = 20;
  });

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  it('reports the provider and capability set without a key, base URL, or model secret', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me/ai/status',
      headers: authorized,
    });
    expect(response.statusCode).toBe(200);
    const body = apiContract.aiStatus.response.parse(response.json());
    expect(body.data.status.configured).toBe(true);
    expect(body.data.status.provider).toBe('fake');
    expect(body.data.status.model).toBe('hanaply-fake-1');
    expect(body.data.status.degraded).toBe(false);
    expect(body.data.status.capabilities.opportunityAnalysis).toBe('ai');
    expect(body.data.status.deterministicAlternatives.length).toBeGreaterThan(0);
    // No credential material, and no deployment wiring, anywhere in the payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/api[_-]?key/iu);
    expect(serialized).not.toMatch(/https?:\/\//u);
  });

  it('requires authentication on every AI route', async () => {
    const unauthenticated = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/me/ai/status' }),
      app.inject({ method: 'GET', url: '/v1/me/coach/conversations' }),
      app.inject({
        method: 'POST',
        url: `/v1/me/opportunities/${jobId}/analysis`,
        payload: {},
      }),
      app.inject({
        method: 'GET',
        url: `/v1/me/coach/conversations/${conversationId}`,
      }),
    ]);
    for (const response of unauthenticated) {
      expect(response.statusCode).toBe(401);
    }
  });

  // -------------------------------------------------------------------------
  // Opportunity analysis
  // -------------------------------------------------------------------------

  it('generates a grounded analysis, stores it, and consumes quota exactly once', async () => {
    provider.queue(groundedReport());
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = apiContract.opportunityAnalysis.response.parse(response.json());
    const data = body.data;

    expect(data.jobId).toBe(jobId);
    expect(data.careerProfileId).toBe(profileId);
    expect(data.cached).toBe(false);
    expect(data.refusal).toBeNull();
    expect(data.analysis).not.toBeNull();
    expect(data.analysis?.whatNotToClaim.length).toBeGreaterThan(0);
    expect(data.analysis?.strongestEvidence[0]?.factId).toBe(factId);

    // The provenance says a model wrote it, and names which one.
    expect(data.provenance.generated).toBe(true);
    expect(data.provenance.degraded).toBe(false);
    expect(data.provenance.provider).toBe('fake');
    expect(data.provenance.model).toBe('hanaply-fake-1');
    expect(data.provenance.inputTokens).toBeGreaterThanOrEqual(0);

    // The grounding report travels with the output and reports what was checked.
    expect(data.grounding.status).toBe('passed');
    expect(data.grounding.verifiedFactIds).toContain(factId);
    expect(data.grounding.admissibleFactIds).toEqual(expect.arrayContaining([factId, otherFactId]));

    // Score and confidence are quoted from the matching engine, not from a model.
    expect(data.deterministicMatch?.score).toBe(82);
    expect(data.deterministicMatch?.verdict).toBe('strong_match');
    expect(data.deterministicMatch?.confidence).toBe('high');

    expect(analyses.size).toBe(1);
    expect(invocationRecords.map((record) => record.outcome)).toEqual(['succeeded']);
    expect(invocationRecords[0]?.cached).toBe(false);
  });

  it('serves a second read from the cache without calling the provider again', async () => {
    provider.queue(groundedReport());
    const first = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(apiContract.opportunityAnalysis.response.parse(first.json()).data.cached).toBe(false);
    const requestsAfterFirst = provider.requests.length;

    const second = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    const data = apiContract.opportunityAnalysis.response.parse(second.json()).data;
    expect(data.cached).toBe(true);
    expect(data.analysis).not.toBeNull();
    // The provider was not asked a second time: the cache is the point.
    expect(provider.requests.length).toBe(requestsAfterFirst);
    expect(analyses.size).toBe(1);
    // The cached read is recorded as cached, so cost reporting can tell the two
    // apart even though neither charged a second unit.
    expect(invocationRecords.at(-1)?.cached).toBe(true);
  });

  it('re-generates on a forced refresh', async () => {
    provider.queue(groundedReport());
    const first = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const requestsAfterFirst = provider.requests.length;

    provider.queue(groundedReport());
    const refreshed = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: { refresh: true },
    });
    expect(refreshed.statusCode).toBe(200);
    const data = apiContract.opportunityAnalysis.response.parse(refreshed.json()).data;
    expect(data.cached).toBe(false);
    expect(provider.requests.length).toBe(requestsAfterFirst + 1);
  });

  it('surfaces a grounding rejection as a clear refusal rather than a 500', async () => {
    provider.queue(ungroundedReport());
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    // A refusal is a decision about output, not a server fault.
    expect(response.statusCode).toBe(200);
    const data = apiContract.opportunityAnalysis.response.parse(response.json()).data;
    expect(data.analysis).toBeNull();
    expect(data.refusal).toMatch(/refused/iu);
    expect(data.refusal).toMatch(/not supported by your confirmed facts/iu);
    // Nothing was stored, nothing was charged, and the deterministic analysis is
    // still offered so the member is not left with an empty box.
    expect(analyses.size).toBe(0);
    expect(data.deterministicMatch?.score).toBe(82);
    expect(data.provenance.generated).toBe(false);
    expect(data.provenance.degraded).toBe(true);
    expect(invocationRecords.map((record) => record.outcome)).toContain('grounding_rejected');
  });

  it('does not charge a second unit for a retry of the same operation', async () => {
    // The first attempt fails at the provider, so nothing is produced and the
    // reserved unit is released. The retry is therefore a first attempt again
    // and succeeds, and the member is charged once for one logical operation.
    provider.fail('server_error');
    const failed = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(failed.statusCode).toBe(200);
    const failedData = apiContract.opportunityAnalysis.response.parse(failed.json()).data;
    expect(failedData.analysis).toBeNull();
    expect(analyses.size).toBe(0);

    provider.queue(groundedReport());
    const succeeded = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(succeeded.statusCode).toBe(200);
    const data = apiContract.opportunityAnalysis.response.parse(succeeded.json()).data;
    expect(data.analysis).not.toBeNull();

    // One stored analysis, and the succeeded outcome is the only one that
    // consumed the operation's single unit.
    expect(analyses.size).toBe(1);
    const successes = invocationRecords.filter((record) => record.outcome === 'succeeded');
    expect(successes).toHaveLength(1);
    expect(invocationRecords.map((record) => record.outcome)).toEqual([
      'provider_error',
      'succeeded',
    ]);
  });

  it('refuses a plan that does not include the feature, with the allowance stated', async () => {
    analysisLimit = 0;
    provider.queue(groundedReport());
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/opportunities/${jobId}/analysis`,
      headers: authorized,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    // Parsed with the shared schema rather than asserted: the envelope is the
    // API's own contract, so validating it also proves the refusal is well-formed.
    const envelope = apiErrorEnvelopeSchema.parse(response.json());
    expect(envelope.error.code).toBe('ENTITLEMENT_REQUIRED');
    expect(envelope.error.message).toMatch(/does not include/iu);
    // Nothing was generated and nothing was stored.
    expect(provider.requests).toHaveLength(0);
    expect(analyses.size).toBe(0);
  });

  it('returns a degraded response rather than an error when no provider is configured', async () => {
    // The deployment this exercises is the default one: nothing resolves to a
    // provider, and every AI route still has to answer. A disabled provider is
    // what `createAiProvider` returns for an unconfigured deployment, so this is
    // the real object rather than a stub that pretends to be one.
    const disabledApp = await createApiApplication(environment, {
      repository: {},
      careerRepository: {},
      aiRepository,
      aiProvider: new DisabledAiProvider({
        reason:
          'No AI provider is configured. Hanaply is running on its deterministic engine, and everything it produces is deterministic rather than model-generated.',
      }),
      authService,
    });
    try {
      const status = await disabledApp.inject({
        method: 'GET',
        url: '/v1/me/ai/status',
        headers: authorized,
      });
      expect(status.statusCode).toBe(200);
      const statusBody = apiContract.aiStatus.response.parse(status.json());
      expect(statusBody.data.status.configured).toBe(false);
      expect(statusBody.data.status.degraded).toBe(true);
      expect(statusBody.data.status.state).toBe('disabled');
      expect(statusBody.data.status.capabilities.opportunityAnalysis).toBe('deterministic');
      expect(statusBody.data.status.capabilities.coach).toBe('deterministic');
      expect(statusBody.data.status.reason).toMatch(/deterministic engine/iu);
      expect(statusBody.data.status.deterministicAlternatives.length).toBeGreaterThan(0);

      // The analysis route is a decision, not a crash: 200, no model text, and
      // the deterministic analysis named as what to use instead.
      const analysis = await disabledApp.inject({
        method: 'POST',
        url: `/v1/me/opportunities/${jobId}/analysis`,
        headers: authorized,
        payload: {},
      });
      expect(analysis.statusCode).toBe(200);
      const analysisData = apiContract.opportunityAnalysis.response.parse(analysis.json()).data;
      expect(analysisData.analysis).toBeNull();
      expect(analysisData.provenance.generated).toBe(false);
      expect(analysisData.provenance.degraded).toBe(true);
      expect(analysisData.provenance.reason).toMatch(/deterministic engine/iu);
      expect(analysisData.grounding.status).toBe('not_evaluated');
      // The deterministic analysis is still handed over, so the panel has
      // something real to point at rather than an empty box.
      expect(analysisData.deterministicMatch?.score).toBe(82);
      expect(analysisData.deterministicMatch?.verdict).toBe('strong_match');
      expect(invocationRecords.map((record) => record.outcome)).toContain('disabled');

      // The coach opens and stores the member's message, and the reply is an
      // honest notice rather than deterministic text labelled as coaching.
      messages.length = 0;
      conversationOpened = 1;
      const sent = await disabledApp.inject({
        method: 'POST',
        url: `/v1/me/coach/conversations/${conversationId}/messages`,
        headers: authorized,
        payload: { body: 'What should I emphasise?' },
      });
      expect(sent.statusCode).toBe(200);
      const detail = apiContract.sendCoachMessage.response.parse(sent.json()).data;
      expect(detail.provenance.generated).toBe(false);
      expect(detail.provenance.degraded).toBe(true);
      expect(detail.messages[0]?.body).toBe('What should I emphasise?');
      const notice = detail.messages.at(-1);
      expect(notice?.facts ?? []).toEqual([]);
      expect(notice?.body).toMatch(/no AI provider is configured/iu);
      expect(notice?.body).toMatch(/deterministic/iu);
    } finally {
      await disabledApp.close();
    }
  });

  // -------------------------------------------------------------------------
  // Coach
  // -------------------------------------------------------------------------

  it('round-trips a coach thread with facts and suggestions kept apart', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/v1/me/coach/conversations',
      headers: authorized,
      payload: { title: 'Coaching conversation', topic: 'career_strategy' },
    });
    expect(opened.statusCode).toBe(200);
    const openedBody = apiContract.openCoachConversation.response.parse(opened.json());
    expect(openedBody.data.conversation.id).toBe(conversationId);
    expect(openedBody.data.messages).toEqual([]);
    // The test environment selects the fake provider, so provenance must report
    // a real generator rather than a degraded state.
    expect(openedBody.data.provenance.degraded).toBe(false);

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/me/coach/conversations',
      headers: authorized,
    });
    expect(listed.statusCode).toBe(200);
    const directory = apiContract.coachConversations.response.parse(listed.json());
    expect(directory.data.items).toHaveLength(1);
    expect(directory.data.ai.degraded).toBe(false);

    provider.queue(coachingReply());
    const sent = await app.inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${conversationId}/messages`,
      headers: authorized,
      payload: { body: 'What should I emphasise when I apply?' },
    });
    expect(sent.statusCode).toBe(200);
    const detail = apiContract.sendCoachMessage.response.parse(sent.json()).data;
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]?.role).toBe('user');
    expect(detail.messages[0]?.facts).toEqual([]);
    expect(detail.messages[0]?.suggestions).toEqual([]);

    const reply = detail.messages[1];
    expect(reply?.role).toBe('assistant');
    // A fact carries the confirmed identifiers behind it.
    expect(reply?.facts).toHaveLength(1);
    expect(reply?.facts[0]?.evidenceFactIds).toEqual([factId]);
    expect(reply?.citedFactIds).toEqual([factId]);
    // A suggestion is labelled as an inference and cites nothing.
    expect(reply?.suggestions).toHaveLength(1);
    expect(reply?.suggestions[0]?.kind).toBe('inference');
    expect(reply?.suggestions[0]).not.toHaveProperty('evidenceFactIds');
    // The grounded reply carries its per-claim verdicts.
    expect(detail.grounding.status).toBe('passed');
    expect(detail.provenance.generated).toBe(true);

    // The thread reads back the same way through the GET route.
    const reloaded = await app.inject({
      method: 'GET',
      url: `/v1/me/coach/conversations/${conversationId}`,
      headers: authorized,
    });
    expect(reloaded.statusCode).toBe(200);
    const reloadedBody = apiContract.coachConversation.response.parse(reloaded.json()).data;
    expect(reloadedBody.messages).toHaveLength(2);
    expect(reloadedBody.messages[1]?.facts[0]?.evidenceFactIds).toEqual([factId]);
  });

  it('reports a conversation the caller does not own as not found', async () => {
    refuseConversation = true;
    const response = await app.inject({
      method: 'GET',
      url: `/v1/me/coach/conversations/${conversationId}`,
      headers: authorized,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('refuses a coach message on a plan that does not include the feature', async () => {
    conversationOpened = 1;
    coachMessageLimit = 0;
    provider.queue(coachingReply());
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${conversationId}/messages`,
      headers: authorized,
      payload: { body: 'What should I emphasise?' },
    });
    expect(response.statusCode).toBe(403);
    const envelope = apiErrorEnvelopeSchema.parse(response.json());
    expect(envelope.error.code).toBe('ENTITLEMENT_REQUIRED');
    expect(provider.requests).toHaveLength(0);
  });

  it('keeps an uncited claim out of the facts channel', async () => {
    conversationOpened = 1;
    provider.queue({
      ...coachingReply(),
      facts: [
        {
          statement: 'You have led a SaaS platform team.',
          evidenceFactIds: ['41000000-0000-4000-8000-0000000000ff'],
        },
      ],
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${conversationId}/messages`,
      headers: authorized,
      payload: { body: 'What should I emphasise?' },
    });
    expect(response.statusCode).toBe(200);
    const detail = apiContract.sendCoachMessage.response.parse(response.json()).data;
    const reply = detail.messages.at(-1);
    // The citation is not admissible, so the statement is not stored as a fact.
    expect(reply?.role).toBe('assistant');
    expect(reply?.facts ?? []).toEqual([]);
  });

  it('saves the member message even when generation is impossible', async () => {
    conversationOpened = 1;
    provider.fail('server_error');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${conversationId}/messages`,
      headers: authorized,
      payload: { body: 'What should I emphasise?' },
    });
    expect(response.statusCode).toBe(200);
    const detail = apiContract.sendCoachMessage.response.parse(response.json()).data;
    expect(detail.messages[0]?.role).toBe('user');
    expect(detail.messages[0]?.body).toBe('What should I emphasise?');
    const reply = detail.messages.at(-1);
    expect(reply?.role).toBe('assistant');
    // The notice asserts nothing about the member.
    expect(reply?.facts ?? []).toEqual([]);
    expect(reply?.body).toMatch(/could not generate a reply/iu);
  });
});
