import 'reflect-metadata';

import { createFakeAiProvider, type AiProvider, type FakeAiProvider } from '@hanaply/ai';
import { parseApiEnvironment } from '@hanaply/config';
import {
  apiContract,
  apiErrorEnvelopeSchema,
  type CareerFact,
  type CareerProfileDetail,
  type ConfirmedCareerEvidence,
  type JobDetail,
  type PackGenerationJob,
} from '@hanaply/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';
import { aiError } from '../../services/api/src/ai.repository.js';
import {
  careerError,
  type PackGenerationContext,
} from '../../services/api/src/career.repository.js';
import type { AuthContext } from '../../services/api/src/http.js';
import type {
  AiInvocationRecord,
  CoachConversationDetailRow,
  CoachConversationRow,
  CoachMessageRow,
  StoredAnalysis,
} from '../../services/api/src/ai.repository.js';

/**
 * The AI and Application Pack routes under attack.
 *
 * `tests/integration/ai-api.test.ts` proves the routes work. This suite proves
 * they cannot be worked *around*: that the actor is always the verified token
 * and never anything in the request, that another subscriber's identifiers are
 * refused wherever they are supplied — including inside a request body, which a
 * route-scoped check would miss — that a refused operation generates nothing and
 * spends nothing, that the status surface leaks no deployment wiring, and that a
 * plan without the feature gets the entitlement error and zero provider calls.
 *
 * The repository boundary is a fake, but not a permissive one. Every read and
 * write that names a profile, pack, job, or conversation resolves it against the
 * acting user exactly as the database's `_owner` helpers do, and throws the same
 * SQLSTATE the real function raises. That is what makes a passing assertion here
 * mean something: a route that handed over the wrong actor, or that trusted a
 * body value, would come back with the repository's refusal.
 *
 * Two honest limitations, asserted below rather than papered over:
 *
 *   - The database answers "not yours" and "not there" with the same `P0002`, so
 *     a foreign profile is a 404 `NOT_FOUND`, never a 403 `FORBIDDEN`. That is
 *     the right answer — a 403 would confirm the identifier exists — and the
 *     suite asserts the 404 rather than a flattering 403.
 *   - The coach stores the member's own message before entitlement is checked,
 *     so a refused send does leave the member's text in the thread. Nothing is
 *     generated, nothing is charged, and no assistant message is written.
 */

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

const now = '2026-09-25T09:00:00.000Z';

/** The attacker: a valid session, a valid plan, and nothing else. */
const attacker = {
  userId: '51000000-0000-4000-8000-00000000000a',
  token: 'attacker-token',
  profileId: '51000000-0000-4000-8000-0000000000a1',
  jobId: '51000000-0000-4000-8000-0000000000a2',
  packId: '51000000-0000-4000-8000-0000000000a3',
  conversationId: '51000000-0000-4000-8000-0000000000a4',
  factId: '51000000-0000-4000-8000-0000000000a5',
} as const;

/** The victim, who owns everything the attacker will try to name. */
const victim = {
  userId: '51000000-0000-4000-8000-00000000000b',
  token: 'victim-token',
  profileId: '51000000-0000-4000-8000-0000000000b1',
  jobId: '51000000-0000-4000-8000-0000000000b2',
  packId: '51000000-0000-4000-8000-0000000000b3',
  conversationId: '51000000-0000-4000-8000-0000000000b4',
  factId: '51000000-0000-4000-8000-0000000000b5',
} as const;

/** An identifier that exists for nobody, so "not yours" can be compared. */
const absentId = '51000000-0000-4000-8000-0000000000ff';

type Subscriber = typeof attacker | typeof victim;

function subscriberFor(userId: string): Subscriber {
  return userId === victim.userId ? victim : attacker;
}

const profilesByUser = new Map<string, string>([
  [attacker.userId, attacker.profileId],
  [victim.userId, victim.profileId],
]);
const jobsByUser = new Map<string, string>([
  [attacker.userId, attacker.jobId],
  [victim.userId, victim.jobId],
]);
const packsByUser = new Map<string, string>([
  [attacker.userId, attacker.packId],
  [victim.userId, victim.packId],
]);
const conversationsByUser = new Map<string, string>([
  [attacker.userId, attacker.conversationId],
  [victim.userId, victim.conversationId],
]);

const missingProfile = (): AppError =>
  aiError({ code: 'P0002', message: 'career profile does not exist' }, 'Profile not found');

const missingPack = (): AppError =>
  careerError(
    { code: 'P0002', message: 'application pack does not exist' },
    'The Application Pack could not be read',
  );

const missingConversation = (): AppError =>
  aiError({ code: 'P0002', message: 'coach conversation does not exist' }, 'Thread not found');

// ---------------------------------------------------------------------------
// The database boundary, replaced
// ---------------------------------------------------------------------------

interface RepositoryTrace {
  readonly jobDetail: { userId: string; jobId: string; profileId: string | null }[];
  readonly careerProfile: { userId: string; profileId: string }[];
  readonly confirmedEvidence: { userId: string; profileId: string }[];
  readonly storedAnalysis: { userId: string; profileId: string; jobId: string }[];
  readonly openCoachConversation: { userId: string; profileId: string | null }[];
  readonly appendCoachMessage: { userId: string; conversationId: string }[];
  readonly generatePackArtifacts: { userId: string; packId: string }[];
}

const trace: RepositoryTrace = {
  jobDetail: [],
  careerProfile: [],
  confirmedEvidence: [],
  storedAnalysis: [],
  openCoachConversation: [],
  appendCoachMessage: [],
  generatePackArtifacts: [],
};

const invocations: AiInvocationRecord[] = [];
const analyses = new Map<string, StoredAnalysis>();
const messages = new Map<string, CoachMessageRow[]>();
const conversationOpens: { userId: string; profileId: string | null }[] = [];
const writtenArtifacts: { userId: string; packId: string; kind: string }[] = [];
const limits = new Map<'ai_analysis' | 'coach_message', number>();

function profileDetail(id: string): CareerProfileDetail {
  return {
    id,
    name: 'Hanaply Subscriber',
    isPrimary: true,
    status: 'active',
    headline: 'Workflow automation specialist',
    currentRoleTitle: 'Automation Specialist',
    careerLevel: 'mid',
    yearsExperience: 3,
    targetRoleTitles: ['Workflow Automation Engineer'],
    preferredWorkArrangement: 'remote',
    completenessPercent: 60,
    version: 3,
    createdAt: now,
    updatedAt: now,
    summary: 'Builds reliable automation between business systems.',
    industries: ['SaaS'],
    excludedRoleTitles: [],
    preferredEmploymentTypes: ['full_time'],
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
      counts: { employment: 1, skills: 1, education: 0, links: 0, confirmedFacts: 1 },
    },
    subCareers: [],
    employment: [
      {
        id: '51000000-0000-4000-8000-0000000000e1',
        companyName: 'Northstar Systems',
        companyUrl: null,
        roleTitle: 'Automation Specialist',
        employmentType: 'full_time',
        workArrangement: 'remote',
        location: 'Remote',
        countryCode: 'PH',
        industry: 'SaaS',
        startDate: '2023-02-01',
        endDate: null,
        isCurrent: true,
        summary: null,
        skills: ['n8n'],
        highlights: [],
        displayOrder: 0,
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    links: [],
    skills: [
      {
        id: '51000000-0000-4000-8000-0000000000e2',
        name: 'n8n',
        skillKind: 'tool',
        proficiency: 'advanced',
        yearsExperience: 3,
        lastUsedYear: 2026,
        isPrimary: true,
        displayOrder: 0,
      },
    ],
    factCounts: { candidate: 0, confirmed: 1, rejected: 0 },
  };
}

function factFor(userId: string): CareerFact {
  const subject = subscriberFor(userId);
  return {
    id: subject.factId,
    careerProfileId: subject.profileId,
    category: 'experience',
    statement: 'Built automation workflows with n8n and TypeScript at Northstar Systems.',
    source: 'user_entered',
    status: 'confirmed',
    confidence: 1,
    evidence: {},
    metricValue: null,
    metricUnit: null,
    metricContext: null,
    documentId: null,
    confirmedAt: now,
    createdAt: now,
  };
}

function evidenceFor(userId: string): ConfirmedCareerEvidence {
  const fact = factFor(userId);
  return {
    careerProfileId: fact.careerProfileId,
    facts: [
      {
        id: fact.id,
        category: fact.category,
        statement: fact.statement,
        source: fact.source,
        metricValue: fact.metricValue,
        metricUnit: fact.metricUnit,
        metricContext: fact.metricContext,
        evidence: fact.evidence,
        confirmedAt: now,
      },
    ],
  };
}

/** The fields every posting shape shares, so the card and the detail agree. */
function jobCoreFor(
  userId: string,
): Omit<
  PackGenerationJob,
  | 'description'
  | 'requirements'
  | 'preferredQualifications'
  | 'experienceYearsMin'
  | 'experienceYearsMax'
  | 'applyUrl'
> {
  const subject = subscriberFor(userId);
  return {
    id: subject.jobId,
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
    salaryMinMinor: 9_000_000,
    salaryMaxMinor: 12_000_000,
    salaryCurrency: 'PHP',
    salaryPeriod: 'monthly',
    salaryIsEstimate: false,
    skills: ['n8n', 'TypeScript'],
    postedAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: now,
    sourceCount: 1,
    status: 'active',
    excerpt: 'Own internal automation between business systems.',
    expiresAt: null,
  };
}

function jobFor(userId: string): PackGenerationJob {
  const job: PackGenerationJob = {
    ...jobCoreFor(userId),
    description:
      'Own internal automation between business systems. You will design workflows and maintain integrations.',
    requirements: ['3+ years building automation with n8n and TypeScript'],
    preferredQualifications: ['Experience in SaaS operations'],
    experienceYearsMin: 3,
    experienceYearsMax: null,
    applyUrl: 'https://example.test/jobs/workflow-automation-engineer',
  };
  return job;
}

const matchSnapshot = {
  jobId: attacker.jobId,
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
  evidenceFactIds: [attacker.factId],
  dataQuality: {
    profileCompleteness: 'solid' as const,
    jobDetail: 'detailed' as const,
    unknowns: [],
  },
};

function jobDetailFor(userId: string): JobDetail {
  const job = jobFor(userId);
  const detail: JobDetail = {
    ...job,
    canonicalUrl: job.applyUrl,
    careerProfileId: subscriberFor(userId).profileId,
    savedAt: null,
    feedback: null,
    match: { ...matchSnapshot, jobId: job.id },
    sources: [],
    expiresAt: null,
  };
  return detail;
}

function packContextFor(userId: string, kinds: readonly string[]): PackGenerationContext {
  const subject = subscriberFor(userId);
  return {
    pack: {
      id: subject.packId,
      careerProfileId: subject.profileId,
      jobId: subject.jobId,
      status: 'generating',
      matchSnapshot: { ...matchSnapshot, jobId: subject.jobId },
      modelVersion: null,
      promptVersion: null,
      evidenceFactIds: [subject.factId],
      errorCode: null,
      generatedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    job: jobFor(userId),
    applyUrl: jobFor(userId).applyUrl,
    artifacts: [],
    match: { ...matchSnapshot, jobId: subject.jobId },
    evidence: [factFor(userId)],
    profile: profileDetail(subject.profileId),
    requestedKinds: kinds.map((kind) => kind as PackGenerationContext['requestedKinds'][number]),
    style: null,
    finalized: writtenArtifacts.length > 0,
  };
}

function conversationRow(userId: string): CoachConversationRow {
  const subject = subscriberFor(userId);
  const thread = messages.get(subject.conversationId) ?? [];
  return {
    id: subject.conversationId,
    careerProfileId: subject.profileId,
    title: 'Coaching conversation',
    topic: 'general',
    status: 'open',
    provider: null,
    model: null,
    messageCount: thread.length,
    lastMessageAt: thread.length === 0 ? null : now,
    createdAt: now,
    updatedAt: now,
  };
}

const aiRepository = {
  aiProvider: null as unknown,
  jobDetail(userId: string, jobId: string, profileId: string | null): Promise<JobDetail> {
    trace.jobDetail.push({ userId, jobId, profileId });
    if (profileId !== null && profilesByUser.get(userId) !== profileId) throw missingProfile();
    if (jobsByUser.get(userId) !== jobId) {
      throw aiError({ code: 'P0002', message: 'job does not exist' }, 'Job not found');
    }
    return Promise.resolve(jobDetailFor(userId));
  },
  careerProfile(userId: string, profileId: string): Promise<CareerProfileDetail> {
    trace.careerProfile.push({ userId, profileId });
    if (profilesByUser.get(userId) !== profileId) throw missingProfile();
    return Promise.resolve(profileDetail(profileId));
  },
  careerProfileDirectory(userId: string) {
    const profileId = profilesByUser.get(userId);
    return Promise.resolve({
      items: profileId === undefined ? [] : [profileDetail(profileId)],
      limits: { careerProfileLimit: 1, subCareerLimitPerProfile: 3 },
    });
  },
  confirmedEvidence(userId: string, profileId: string): Promise<ConfirmedCareerEvidence> {
    trace.confirmedEvidence.push({ userId, profileId });
    if (profilesByUser.get(userId) !== profileId) throw missingProfile();
    return Promise.resolve(evidenceFor(userId));
  },
  storedAnalysis(
    userId: string,
    profileId: string,
    jobId: string,
    key: { provider: string; model: string; promptVersion: string; evidenceFingerprint: string },
  ): Promise<StoredAnalysis | null> {
    trace.storedAnalysis.push({ userId, profileId, jobId });
    if (profilesByUser.get(userId) !== profileId) throw missingProfile();
    const found = analyses.get(
      [
        userId,
        profileId,
        jobId,
        key.provider,
        key.model,
        key.promptVersion,
        key.evidenceFingerprint,
      ].join('|'),
    );
    return Promise.resolve(found ?? null);
  },
  coachConversations(userId: string): Promise<readonly CoachConversationRow[]> {
    const profileId = profilesByUser.get(userId);
    return Promise.resolve(profileId === undefined ? [] : [conversationRow(userId)]);
  },
  coachConversationDetail(
    userId: string,
    conversationId: string,
  ): Promise<CoachConversationDetailRow> {
    const owned = conversationsByUser.get(userId);
    // The database answers "not yours" and "not there" with the same P0002, so
    // the two are indistinguishable to a caller by construction.
    if (owned === undefined || owned !== conversationId) throw missingConversation();
    return Promise.resolve({
      conversation: conversationRow(userId),
      messages: [...(messages.get(conversationId) ?? [])],
    });
  },
  usageFor(
    _userId: string,
    feature: 'ai_analysis' | 'coach_message',
  ): Promise<{ used: number; limit: number; remaining: number } | null> {
    const limit = limits.get(feature) ?? 0;
    return Promise.resolve({ used: 0, limit, remaining: limit });
  },
  recordInvocation(record: AiInvocationRecord): Promise<string> {
    invocations.push(record);
    return Promise.resolve('51000000-0000-4000-8000-0000000000f1');
  },
  recordAnalysis(input: {
    userId: string;
    careerProfileId: string;
    jobId: string;
    evidenceFingerprint: string;
    provider: string;
    model: string;
    promptVersion: string;
    analysis: Record<string, unknown>;
  }): Promise<string> {
    if (profilesByUser.get(input.userId) !== input.careerProfileId) throw missingProfile();
    analyses.set(
      [
        input.userId,
        input.careerProfileId,
        input.jobId,
        input.provider,
        input.model,
        input.promptVersion,
        input.evidenceFingerprint,
      ].join('|'),
      {
        id: '51000000-0000-4000-8000-0000000000f2',
        analysis: input.analysis,
        citedFactIds: [subscriberFor(input.userId).factId],
        createdAt: now,
      },
    );
    return Promise.resolve('51000000-0000-4000-8000-0000000000f2');
  },
  openCoachConversation(input: {
    userId: string;
    careerProfileId: string | null;
  }): Promise<CoachConversationRow> {
    trace.openCoachConversation.push({ userId: input.userId, profileId: input.careerProfileId });
    if (
      input.careerProfileId !== null &&
      profilesByUser.get(input.userId) !== input.careerProfileId
    ) {
      throw missingProfile();
    }
    conversationOpens.push({ userId: input.userId, profileId: input.careerProfileId });
    return Promise.resolve(conversationRow(input.userId));
  },
  appendCoachMessage(input: {
    userId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    body: string;
    facts: readonly { statement: string; evidenceFactIds: readonly string[] }[];
    suggestions: readonly { kind: 'inference'; statement: string; rationale: string }[];
    citedFactIds: readonly string[];
  }): Promise<CoachMessageRow> {
    trace.appendCoachMessage.push({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    if (conversationsByUser.get(input.userId) !== input.conversationId) throw missingConversation();
    const thread = messages.get(input.conversationId) ?? [];
    const row: CoachMessageRow = {
      id: `51000000-0000-4000-8000-0000000000${(thread.length + 1).toString().padStart(2, '0')}`,
      sequence: thread.length + 1,
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
    thread.push(row);
    messages.set(input.conversationId, thread);
    return Promise.resolve(row);
  },
};

const careerRepository = {
  generatePackArtifacts(
    userId: string,
    packId: string,
    kinds: readonly string[],
  ): Promise<PackGenerationContext> {
    trace.generatePackArtifacts.push({ userId, packId });
    if (packsByUser.get(userId) !== packId) throw missingPack();
    return Promise.resolve(packContextFor(userId, kinds));
  },
  recordApplicationArtifact(
    userId: string,
    packId: string,
    draft: { kind: string },
  ): Promise<string> {
    if (packsByUser.get(userId) !== packId) throw missingPack();
    writtenArtifacts.push({ userId, packId, kind: draft.kind });
    return Promise.resolve('51000000-0000-4000-8000-0000000000f3');
  },
};

/** The bearer tokens this deployment accepts, and the session each one names. */
const sessions = new Map<string, AuthContext>([
  [
    attacker.token,
    { userId: attacker.userId, accessToken: attacker.token, accountStatus: 'active' },
  ],
  [victim.token, { userId: victim.userId, accessToken: victim.token, accountStatus: 'active' }],
]);

function authenticationError(message: string): AppError {
  return new AppError({ code: 'AUTHENTICATION_REQUIRED', status: 401, message });
}

const authService = {
  authenticate(request: { headers: Record<string, string | undefined>; auth?: AuthContext }) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return Promise.reject(authenticationError('Authentication is required'));
    }
    const accessToken = authorization.slice('Bearer '.length).trim();
    const session = sessions.get(accessToken);
    if (accessToken.length === 0 || session === undefined) {
      // A malformed bearer value and an expired one are answered identically:
      // both name no live session, and the caller learns nothing from which.
      return Promise.reject(authenticationError('Session is invalid or expired'));
    }
    request.auth = session;
    return Promise.resolve();
  },
  authorizeAdmin: () => Promise.resolve(),
};

interface NormalisedResponse {
  readonly status: number;
  readonly body: string;
  json(): unknown;
}

interface InjectOptions {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly payload?: unknown;
  /** `null` sends no Authorization header at all. */
  readonly token?: string | null;
}

const aiRoutes: readonly { readonly method: 'GET' | 'POST'; readonly url: string }[] = [
  { method: 'GET', url: '/v1/me/ai/status' },
  { method: 'GET', url: '/v1/me/coach/conversations' },
  { method: 'POST', url: '/v1/me/coach/conversations' },
  { method: 'GET', url: `/v1/me/coach/conversations/${attacker.conversationId}` },
  { method: 'POST', url: `/v1/me/coach/conversations/${attacker.conversationId}/messages` },
  { method: 'POST', url: `/v1/me/opportunities/${attacker.jobId}/analysis` },
  { method: 'GET', url: `/v1/me/opportunities/${attacker.jobId}/analysis` },
  { method: 'POST', url: `/v1/me/application-packs/${attacker.packId}/generate` },
];

describe('AI routes under attack', () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;
  let provider: FakeAiProvider;

  function inject(options: InjectOptions): Promise<NormalisedResponse> {
    const headers: Record<string, string> = {};
    if (options.token !== null) headers.authorization = `Bearer ${options.token ?? attacker.token}`;
    return app
      .inject({
        method: options.method,
        url: options.url,
        headers,
        ...(options.payload === undefined || options.payload === null
          ? {}
          : { payload: options.payload }),
      })
      .then((response) => {
        const body = response.body;
        return { status: response.statusCode, body, json: () => JSON.parse(body) as unknown };
      });
  }

  function resetTrace(): void {
    trace.jobDetail.length = 0;
    trace.careerProfile.length = 0;
    trace.confirmedEvidence.length = 0;
    trace.storedAnalysis.length = 0;
    trace.openCoachConversation.length = 0;
    trace.appendCoachMessage.length = 0;
    trace.generatePackArtifacts.length = 0;
  }

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      repository: {},
      careerRepository,
      aiRepository,
      aiProvider: createFakeAiProvider({ model: 'hanaply-fake-1' }),
      authService,
    });
    const { AI_PROVIDER_TOKEN } = await import('../../services/api/src/tokens.js');
    const resolved: AiProvider = app.get(AI_PROVIDER_TOKEN);
    if (!(resolved instanceof Object) || !('reset' in resolved)) {
      throw new Error('the fake provider was not installed');
    }
    provider = resolved as FakeAiProvider;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    provider.reset();
    invocations.length = 0;
    analyses.clear();
    messages.clear();
    conversationOpens.length = 0;
    writtenArtifacts.length = 0;
    limits.clear();
    limits.set('ai_analysis', 20);
    limits.set('coach_message', 20);
    resetTrace();
  });

  // -------------------------------------------------------------------------
  // Every route refuses an unauthenticated, expired, or malformed caller
  // -------------------------------------------------------------------------

  it.each(aiRoutes)('refuses $method $url with no bearer token', async (route) => {
    const response = await inject({ method: route.method, url: route.url, token: null });

    expect(response.status).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe(
      'AUTHENTICATION_REQUIRED',
    );
    expect(provider.requests).toHaveLength(0);
    expect(writtenArtifacts).toHaveLength(0);
  });

  it.each(aiRoutes)('refuses $method $url with a malformed bearer token', async (route) => {
    for (const token of ['not-a-jwt', 'a.b.c', `${attacker.token} ${attacker.token}`]) {
      const response = await inject({ method: route.method, url: route.url, token });

      expect(response.status).toBe(401);
      expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe(
        'AUTHENTICATION_REQUIRED',
      );
    }
    expect(provider.requests).toHaveLength(0);
  });

  it.each(aiRoutes)('refuses $method $url with an expired bearer token', async (route) => {
    const response = await inject({ method: route.method, url: route.url, token: 'expired-token' });

    expect(response.status).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe(
      'AUTHENTICATION_REQUIRED',
    );
    expect(provider.requests).toHaveLength(0);
  });

  it('does not answer an unauthenticated status request with deployment detail', async () => {
    const response = await inject({ method: 'GET', url: '/v1/me/ai/status', token: null });

    expect(response.status).toBe(401);
    expect(response.body).not.toMatch(/api[_-]?key/iu);
    expect(response.body).not.toMatch(/https?:\/\//u);
  });

  it('does not let a token reach another subscriber by naming them in a header', async () => {
    // An actor header is not part of the contract, and adding one changes
    // nothing: the token is the only input the guard reads.
    const asVictim = await app
      .inject({
        method: 'GET',
        url: '/v1/me/ai/status',
        headers: { authorization: `Bearer ${attacker.token}`, 'x-hanaply-user-id': victim.userId },
      })
      .then((response) => response.statusCode);
    expect(asVictim).toBe(200);

    const spoofed = await app
      .inject({
        method: 'POST',
        url: '/v1/me/coach/conversations',
        headers: { authorization: `Bearer ${attacker.token}`, 'x-hanaply-user-id': victim.userId },
        payload: { careerProfileId: victim.profileId },
      })
      .then((response) => response.statusCode);
    // The spoofed header does not make the victim's profile the attacker's:
    // the repository still sees the attacker as the actor and refuses.
    expect(spoofed).toBe(404);
    expect(conversationOpens).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // The actor is the token, never anything in the request
  // -------------------------------------------------------------------------

  it('cannot analyse another subscriber job, even by naming their profile in the body', async () => {
    const response = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${victim.jobId}/analysis`,
      payload: { careerProfileId: victim.profileId },
    });

    // The route passes the body value through, so the refusal comes from where
    // every other career read gets it: the database, resolving the profile
    // against the acting user. 404 rather than 403 is the honest answer, because
    // that is exactly what the victim's own lookup returns for a profile id that
    // is not theirs, and a 403 would confirm the identifier exists.
    expect(response.status).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');

    // The repository was asked for the victim's job *as the attacker*, which is
    // the only reason the refusal was possible at all.
    expect(trace.jobDetail).toContainEqual({
      userId: attacker.userId,
      jobId: victim.jobId,
      profileId: victim.profileId,
    });
    expect(provider.requests).toHaveLength(0);
    expect(analyses.size).toBe(0);
    expect(invocations).toHaveLength(0);
  });

  it('cannot read another subscriber cached analysis, and cannot tell that it exists', async () => {
    // The victim's analysis is generated and cached first, so a zero below is a
    // real absence of access rather than an absence of data.
    provider.queue(groundedReport(victim.factId));
    const stored = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${victim.jobId}/analysis`,
      token: victim.token,
      payload: {},
    });
    expect(stored.status).toBe(200);
    expect(analyses.size).toBe(1);

    const foreignProfile = await inject({
      method: 'GET',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis?careerProfileId=${victim.profileId}`,
    });
    expect(foreignProfile.status).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(foreignProfile.json()).error.code).toBe('NOT_FOUND');

    const foreignJobAndProfile = await inject({
      method: 'GET',
      url: `/v1/me/opportunities/${victim.jobId}/analysis?careerProfileId=${victim.profileId}`,
    });
    expect(foreignJobAndProfile.status).toBe(404);

    // The same 404 answers a job that does not exist at all, so the response
    // does not distinguish "someone else's" from "nobody's".
    const absent = await inject({
      method: 'GET',
      url: `/v1/me/opportunities/${absentId}/analysis?careerProfileId=${victim.profileId}`,
    });
    expect(absent.status).toBe(foreignJobAndProfile.status);

    // And the attacker's own read is their own: not a hit on the victim's cache.
    const own = await inject({
      method: 'GET',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis`,
    });
    expect(own.status).toBe(200);
    const ownData = apiContract.opportunityAnalysisRead.response.parse(own.json()).data;
    expect(ownData.cached).toBe(false);
    expect(ownData.analysis).toBeNull();
    expect(provider.requests).toHaveLength(1);
  });

  it('cannot open a coach thread for another subscriber profile in the body', async () => {
    const response = await inject({
      method: 'POST',
      url: '/v1/me/coach/conversations',
      payload: { title: 'Thread about someone else', careerProfileId: victim.profileId },
    });

    expect(response.status).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    expect(trace.careerProfile).toContainEqual({
      userId: attacker.userId,
      profileId: victim.profileId,
    });
    expect(conversationOpens).toHaveLength(0);
    expect(trace.openCoachConversation).toHaveLength(0);
  });

  it('cannot open a thread naming a profile that exists for nobody', async () => {
    const response = await inject({
      method: 'POST',
      url: '/v1/me/coach/conversations',
      payload: { title: 'Thread', careerProfileId: absentId },
    });

    expect(response.status).toBe(404);
    expect(conversationOpens).toHaveLength(0);
  });

  it('cannot read another subscriber coach thread through the id', async () => {
    const response = await inject({
      method: 'GET',
      url: `/v1/me/coach/conversations/${victim.conversationId}`,
    });

    expect(response.status).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    // The answer carries no fragment of the thread it refused to read.
    expect(response.body).not.toContain('Coaching conversation');
    expect(response.body).not.toContain(victim.conversationId);
  });

  it('cannot post into another subscriber coach thread, and spends nothing doing it', async () => {
    provider.queue(coachingReply(attacker.factId));

    const response = await inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${victim.conversationId}/messages`,
      payload: { body: 'Let me in.' },
    });

    expect(response.status).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    expect(provider.requests).toHaveLength(0);
    expect(messages.size).toBe(0);
    expect(invocations).toHaveLength(0);
    expect(trace.appendCoachMessage).toHaveLength(0);
  });

  it('cannot post into a thread by naming another subscriber profile, job, or thread', async () => {
    provider.queue(coachingReply(attacker.factId));

    const response = await inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${victim.conversationId}/messages`,
      payload: {
        body: 'Let me in.',
        careerProfileId: victim.profileId,
        jobId: victim.jobId,
      },
    });

    expect(response.status).toBe(404);
    expect(provider.requests).toHaveLength(0);
    expect(messages.size).toBe(0);
    expect(trace.appendCoachMessage).toHaveLength(0);
  });

  it('cannot reach the message writer with a conversation id that is not the caller own', async () => {
    for (const conversationId of [victim.conversationId, absentId]) {
      const response = await inject({
        method: 'POST',
        url: `/v1/me/coach/conversations/${conversationId}/messages`,
        payload: { body: 'Anything.' },
      });
      expect(response.status).toBe(404);
    }

    expect(trace.appendCoachMessage).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  it('cannot generate artifacts into another subscriber pack', async () => {
    const response = await inject({
      method: 'POST',
      url: `/v1/me/application-packs/${victim.packId}/generate`,
      payload: { kinds: ['resume'], generator: 'auto' },
    });

    expect(response.status).toBe(404);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    expect(provider.requests).toHaveLength(0);
    expect(writtenArtifacts).toHaveLength(0);
    // The pack context was read as the attacker and refused, so the generator
    // never reached a provider for it.
    expect(trace.generatePackArtifacts).toContainEqual({
      userId: attacker.userId,
      packId: victim.packId,
    });
  });

  it('refuses a pack request that tries to name a foreign profile at all', async () => {
    // The pack generation body has no profile field, and the schema is strict:
    // a subscriber cannot even ask for the pack to be built against someone
    // else's ledger. The context is read through the pack — which resolves the
    // profile from the pack row, not from the request — and then the unknown
    // field is refused, so neither generator runs and nothing is written.
    const response = await inject({
      method: 'POST',
      url: `/v1/me/application-packs/${attacker.packId}/generate`,
      payload: { kinds: ['resume'], careerProfileId: victim.profileId },
    });

    expect(response.status).toBe(400);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    // The context read is the attacker's own pack, and the profile inside it is
    // the attacker's own: the body value never reached a profile lookup.
    expect(trace.generatePackArtifacts).toContainEqual({
      userId: attacker.userId,
      packId: attacker.packId,
    });
    expect(trace.careerProfile).toHaveLength(0);
    expect(writtenArtifacts).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Quota
  // -------------------------------------------------------------------------

  it('refuses an analysis the plan does not include, and generates nothing', async () => {
    limits.set('ai_analysis', 0);
    provider.queue(groundedReport(attacker.factId));

    const response = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis`,
      payload: {},
    });

    expect(response.status).toBe(403);
    const envelope = apiErrorEnvelopeSchema.parse(response.json());
    expect(envelope.error.code).toBe('ENTITLEMENT_REQUIRED');
    expect(envelope.error.message).toMatch(/does not include/iu);

    // No provider call, no stored analysis, and no invocation row: entitlement is
    // checked before generation, so a refusal is not an attempt and is not paid
    // for or recorded as one.
    expect(provider.requests).toHaveLength(0);
    expect(analyses.size).toBe(0);
    expect(invocations).toHaveLength(0);
  });

  it('refuses a coach message the plan does not include, and generates nothing', async () => {
    limits.set('coach_message', 0);
    provider.queue(coachingReply(attacker.factId));

    const response = await inject({
      method: 'POST',
      url: `/v1/me/coach/conversations/${attacker.conversationId}/messages`,
      payload: { body: 'What should I emphasise?' },
    });

    expect(response.status).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('ENTITLEMENT_REQUIRED');

    // Nothing was generated and nothing was charged. The member's own text is
    // saved first, deliberately, so it survives a refusal — what must not exist
    // is an assistant reply, an invocation row, or a provider call.
    expect(provider.requests).toHaveLength(0);
    expect(invocations).toHaveLength(0);
    const thread = messages.get(attacker.conversationId) ?? [];
    expect(thread.map((message) => message.role)).toEqual(['user']);
  });

  it('refuses an artifact generation the plan does not include, and writes nothing', async () => {
    limits.set('ai_analysis', 0);

    const response = await inject({
      method: 'POST',
      url: `/v1/me/application-packs/${attacker.packId}/generate`,
      payload: { kinds: ['resume', 'cover_letter'], generator: 'auto' },
    });

    expect(response.status).toBe(403);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe('ENTITLEMENT_REQUIRED');
    // The context was read, the entitlement was refused, and neither generator
    // ran: no provider call and no artifact row.
    expect(provider.requests).toHaveLength(0);
    expect(writtenArtifacts).toHaveLength(0);
  });

  it('spends nothing on an operation the truth gate refuses, and can still retry it', async () => {
    provider.queue(ungroundedReport(attacker.factId));

    const refused = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis`,
      payload: {},
    });
    expect(refused.status).toBe(200);
    const refusedData = apiContract.opportunityAnalysis.response.parse(refused.json()).data;
    expect(refusedData.analysis).toBeNull();
    expect(refusedData.refusal).toMatch(/refused/iu);
    expect(refusedData.provenance.degraded).toBe(true);
    expect(analyses.size).toBe(0);

    // The reserved unit was released, so the next attempt at the same operation
    // is a first attempt again — and it succeeds, and is charged once.
    provider.queue(groundedReport(attacker.factId));
    const retried = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis`,
      payload: {},
    });
    expect(retried.status).toBe(200);
    const retriedData = apiContract.opportunityAnalysis.response.parse(retried.json()).data;
    expect(retriedData.analysis).not.toBeNull();
    expect(analyses.size).toBe(1);
    expect(invocations.filter((record) => record.outcome === 'grounding_rejected')).toHaveLength(1);
    expect(
      invocations.filter((record) => record.outcome === 'succeeded' && !record.cached),
    ).toHaveLength(1);
  });

  it('serves a repeat read from cache rather than spending a second unit', async () => {
    provider.queue(groundedReport(attacker.factId));
    const first = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis`,
      payload: {},
    });
    expect(first.status).toBe(200);

    provider.queue(groundedReport(attacker.factId));
    const second = await inject({
      method: 'POST',
      url: `/v1/me/opportunities/${attacker.jobId}/analysis`,
      payload: {},
    });
    expect(second.status).toBe(200);
    const data = apiContract.opportunityAnalysis.response.parse(second.json()).data;

    expect(data.cached).toBe(true);
    expect(provider.requests).toHaveLength(1);
    expect(analyses.size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // The status route
  // -------------------------------------------------------------------------

  it('leaks no key, base URL, or internal identifier in the raw status body', async () => {
    const response = await inject({ method: 'GET', url: '/v1/me/ai/status' });
    expect(response.status).toBe(200);

    // Asserted on the raw body, not the parsed shape: a property the contract
    // does not know about would be dropped by a parse and would still be a leak.
    let decoded = response.body;
    try {
      decoded = decodeURIComponent(response.body);
    } catch {
      decoded = response.body;
    }
    for (const raw of [response.body, decoded]) {
      expect(raw).not.toMatch(/api[_-]?key/iu);
      expect(raw).not.toMatch(/\bsecret\b/iu);
      expect(raw).not.toMatch(/\btoken\b/iu);
      expect(raw).not.toMatch(/bearer/iu);
      expect(raw).not.toMatch(/sk-[A-Za-z0-9]/u);
      expect(raw).not.toMatch(/https?:\/\//u);
      expect(raw).not.toMatch(/127\.0\.0\.1/u);
      expect(raw).not.toMatch(/service-test-key/u);
      expect(raw).not.toMatch(/publishable-test-key/u);
      expect(raw).not.toMatch(/supabase/iu);
      expect(raw).not.toMatch(/integration-test/u);
    }

    // And it does say what a member needs: the provider family, the capability
    // set, and what still works when generation does not.
    const status = apiContract.aiStatus.response.parse(response.json()).data.status;
    expect(status.provider).toBe('fake');
    expect(status.capabilities.opportunityAnalysis).toBe('ai');
    expect(status.capabilities.coach).toBe('ai');
    expect(status.capabilities.artifactGeneration).toBe('deterministic');
    expect(status.deterministicAlternatives.length).toBeGreaterThan(0);
  });
});

/** A fully grounded report: nothing in it is invented and every citation exists. */
function groundedReport(factId: string): Record<string, unknown> {
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

/** A report citing a fact the subscriber never confirmed. The gate must refuse it. */
function ungroundedReport(factId: string): Record<string, unknown> {
  return {
    ...groundedReport(factId),
    strongestEvidence: [
      {
        factId: absentId,
        insight: 'This cites a fact the member never confirmed.',
      },
    ],
  };
}

function coachingReply(factId: string): Record<string, unknown> {
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
