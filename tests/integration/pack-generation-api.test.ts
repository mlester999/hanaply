import 'reflect-metadata';

import { parseApiEnvironment } from '@hanaply/config';
import { apiContract, type CareerProfileDetail, type PackGenerationJob } from '@hanaply/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';
import { careerError } from '../../services/api/src/career.repository.js';

/**
 * The Application Pack generation route, wired end to end.
 *
 * The database and the generator are both covered elsewhere. What this proves
 * is the seam between them: that the route exists at the canonical path, that
 * the service reads the generation context from the RPC before it generates,
 * that every draft reaches `record_application_artifact` with the shape the
 * truth gate validates, and that a pack the caller does not own is reported as
 * not found rather than generated.
 */

const now = '2026-09-18T09:00:00.000Z';
const userId = '31000000-0000-4000-8000-000000000001';
const packId = '31000000-0000-4000-8000-000000000002';
const jobId = '31000000-0000-4000-8000-000000000003';
const profileId = '31000000-0000-4000-8000-000000000004';
const factId = '31000000-0000-4000-8000-000000000005';

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

const profile: CareerProfileDetail = {
  id: profileId,
  name: 'Ana Reyes',
  isPrimary: true,
  status: 'active',
  headline: 'Workflow automation specialist',
  currentRoleTitle: null,
  careerLevel: null,
  yearsExperience: null,
  targetRoleTitles: [],
  preferredWorkArrangement: null,
  completenessPercent: 10,
  version: 1,
  createdAt: now,
  updatedAt: now,
  summary: null,
  industries: [],
  excludedRoleTitles: [],
  preferredEmploymentTypes: [],
  preferredLocations: [],
  openToInternational: false,
  openToRelocation: false,
  workAuthorizations: [],
  availability: null,
  salaryExpectation: null,
  careerGoals: null,
  lastReviewedAt: null,
  completeness: {
    percent: 10,
    missing: ['summary'],
    counts: { employment: 0, skills: 0, education: 0, links: 0, confirmedFacts: 1 },
  },
  subCareers: [],
  employment: [],
  projects: [],
  education: [],
  certifications: [],
  links: [],
  skills: [],
  factCounts: { candidate: 0, confirmed: 1, rejected: 0 },
};

const job: PackGenerationJob = {
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
  skills: ['n8n', 'Kubernetes'],
  postedAt: now,
  firstSeenAt: now,
  lastSeenAt: now,
  lastVerifiedAt: now,
  sourceCount: 1,
  status: 'active',
  excerpt: 'Own internal automation between business systems.',
  expiresAt: null,
  description:
    'Own internal automation between business systems. You will design workflows and maintain integrations.',
  requirements: ['Kubernetes cluster administration'],
  preferredQualifications: [],
  experienceYearsMin: 3,
  experienceYearsMax: null,
  applyUrl: 'https://example.test/jobs/workflow-automation-engineer',
};

/** The pack row as the RPC returns it, in the shape `applicationPackSchema` describes. */
const pack = {
  id: packId,
  careerProfileId: profileId,
  jobId,
  status: 'generating' as const,
  matchSnapshot: {},
  modelVersion: null,
  promptVersion: null,
  evidenceFactIds: [factId],
  errorCode: null,
  generatedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
};

/** Exactly what `CareerRepository.generatePackArtifacts` resolves to. */
const context = {
  pack,
  job,
  applyUrl: job.applyUrl,
  artifacts: [],
  match: null,
  evidence: [
    {
      id: factId,
      careerProfileId: profileId,
      category: 'achievement' as const,
      statement: 'Rebuilt onboarding automation for a 40-person operations team',
      source: 'user_entered' as const,
      status: 'confirmed' as const,
      confidence: 1,
      evidence: {},
      metricValue: null,
      metricUnit: null,
      metricContext: null,
      documentId: null,
      confirmedAt: now,
      createdAt: now,
    },
  ],
  profile,
  requestedKinds: ['resume'],
  style: 'standard',
  finalized: false,
};

interface RecordedArtifact {
  readonly kind: string;
  readonly style: string;
  readonly title: string;
  readonly plainText: string;
  readonly evidenceFactIds: readonly string[];
  readonly content: unknown;
}

const recorded: RecordedArtifact[] = [];
const contextReads: { kinds: readonly string[]; style: string | null }[] = [];
let refuseOwnership = false;

const careerRepository = {
  generatePackArtifacts(
    _actorUserId: string,
    _packId: string,
    kinds: readonly string[],
    style: string | null,
  ): Promise<typeof context> {
    if (refuseOwnership) {
      return Promise.reject(
        careerError(
          { code: 'P0002', message: 'application pack does not exist' },
          'The Application Pack generation context could not be read',
        ),
      );
    }
    contextReads.push({ kinds, style });
    // The first call returns the context; the call made after the drafts are
    // persisted reports the pack as finished.
    return Promise.resolve({ ...context, finalized: recorded.length > 0 });
  },
  recordApplicationArtifact(
    _actorUserId: string,
    _packId: string,
    draft: RecordedArtifact,
  ): Promise<string> {
    recorded.push(draft);
    return Promise.resolve('31000000-0000-4000-8000-000000000099');
  },
};

const authService = {
  authenticate(request: { headers: Record<string, string | undefined>; auth?: unknown }) {
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
};

describe('Application Pack generation route', () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      repository: {},
      careerRepository,
      authService,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/application-packs/${packId}/generate`,
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('generates the requested artifacts and returns the pack detail shape', async () => {
    recorded.length = 0;
    contextReads.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: `/v1/me/application-packs/${packId}/generate`,
      headers: { authorization: 'Bearer user-token' },
      payload: { kinds: ['resume', 'requirement_map'], style: 'concise' },
    });
    expect(response.statusCode).toBe(200);

    const body = apiContract.generateApplicationPack.response.parse(response.json());
    expect(body.data.generatedKinds).toEqual(['resume', 'requirement_map']);
    // The mock reports the pack as finished only once a draft has been
    // persisted, so this is the same assertion the route has always made.
    expect(body.data.finalized).toBe(true);
    expect(body.data.artifacts).toEqual([]);
    // The context is read once before generating and once to finalise, and both
    // reads name the same kinds and style: one read serves both generators, so
    // the model path and the deterministic path cannot disagree about what the
    // pack was asked for.
    expect(contextReads).toHaveLength(2);
    expect(contextReads[0]).toEqual({ kinds: ['resume', 'requirement_map'], style: 'concise' });
    expect(contextReads[1]).toEqual(contextReads[0]);
    // No provider is configured in this environment, so the deterministic
    // generator wrote the pack and the response says so rather than implying a
    // model was involved.
    expect(body.data.ai.path).toBe('deterministic');
    expect(body.data.ai.provenance.generated).toBe(false);
    expect(body.data.ai.provenance.degraded).toBe(true);
    expect(body.data.ai.provenance.reason).toBeTruthy();
  });

  it('persists one draft per requested kind with the shape the truth gate checks', () => {
    expect(recorded).toHaveLength(2);
    expect(recorded.map((draft) => draft.kind)).toEqual(['resume', 'requirement_map']);
    for (const draft of recorded) {
      expect(draft.style).toBe('concise');
      expect(draft.title.length).toBeGreaterThan(0);
      expect(draft.plainText.length).toBeGreaterThan(0);
      expect(draft.plainText).not.toMatch(/<[a-z/!][^>]*>/iu);
      expect(Array.isArray((draft.content as { sections?: unknown }).sections)).toBe(true);
    }
  });

  it('cites only the confirmed evidence the RPC offered, and says so when there is none', () => {
    const resume = recorded[0];
    expect(resume?.evidenceFactIds).toEqual([factId]);
    expect(resume?.plainText).toContain(
      'Rebuilt onboarding automation for a 40-person operations team',
    );
    const map = recorded[1];
    expect(map?.evidenceFactIds).toEqual([]);
    expect(map?.plainText).toContain('not evidenced');
  });

  it('reports a pack the caller does not own as not found', async () => {
    refuseOwnership = true;
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/me/application-packs/${packId}/generate`,
        headers: { authorization: 'Bearer user-token' },
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    } finally {
      refuseOwnership = false;
    }
  });
});
