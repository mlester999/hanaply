import { describe, expect, it, vi } from 'vitest';

import { parseWorkerEnvironment } from '../../packages/config/src/index.js';
import { MissingCredentialError, type JobSourceAdapter } from '../../packages/jobs/src/index.js';
import { modelVersion } from '../../packages/matching/src/index.js';
import { JobIntelligenceWorker } from '../../services/worker/src/jobs.js';

const environment = parseWorkerEnvironment({
  NODE_ENV: 'test',
  HANAPLY_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:3100',
  API_BASE_URL: 'http://localhost:3101',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  WORKER_MODE: 'active',
  JOB_INGESTION_TIMEOUT_MS: '5000',
  MATCHING_BATCH_SIZE: '5',
  MATCHING_CANDIDATE_LIMIT: '8',
  MATCHING_STALE_AFTER_HOURS: '12',
});

const sourceId = 'e0000000-0000-4000-8000-000000000001';
const userId = 'e0000000-0000-4000-8000-000000000002';
const profileId = 'e0000000-0000-4000-8000-000000000003';
const jobId = 'e0000000-0000-4000-8000-000000000004';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A fake PostgREST surface. The worker talks to the database exclusively through
 * named RPCs and one table read, so the fake only needs to answer those.
 *
 * `rpcFailure` is a per-RPC sequence of outcomes, not a switch. It is per-RPC
 * rather than positional across the whole cycle because the ingestion cycle calls
 * its own RPCs before the matching cycle runs: entry N of the array decides what
 * the (N+1)th call to *that* RPC returns. A single string therefore means "every
 * call fails from the first", which is what the existing failure tests expect,
 * while `['record_job_matches', null]` means "the first call to
 * `record_job_matches` fails and the second succeeds" — the shape a retry test
 * needs, and one that a shared counter would get wrong.
 */
function createFakeClient(options: {
  due?: boolean;
  lockAcquired?: boolean;
  sourceConfig?: Record<string, unknown>;
  requiresCredentials?: boolean;
  credentialEnvVar?: string | null;
  candidates?: readonly Record<string, unknown>[];
  candidateBatches?: readonly (readonly Record<string, unknown>[])[];
  profileDetail?: Record<string, unknown>;
  evidence?: readonly string[];
  rpcFailure?: string | readonly (string | null | undefined)[];
  upsertResults?: readonly Record<string, unknown>[];
}) {
  const calls: RpcCall[] = [];
  const callCounts = new Map<string, number>();
  const candidateBatches = options.candidateBatches ?? [options.candidates ?? []];
  const rpcFailure = options.rpcFailure;
  const client = {
    rpc: vi.fn((name: string, args: Record<string, unknown> = {}) => {
      const callIndex = callCounts.get(name) ?? 0;
      callCounts.set(name, callIndex + 1);
      calls.push({ name, args });
      const failsAt =
        typeof rpcFailure === 'string' ? rpcFailure === name : rpcFailure?.[callIndex] === name;
      if (failsAt) {
        return Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } });
      }
      switch (name) {
        case 'job_ingestion_schedule':
          return Promise.resolve({
            data: [
              {
                source_id: sourceId,
                source_code: 'remotive',
                effective_interval_minutes: 15,
                fastest_subscriber_interval_minutes: 15,
                due: options.due ?? true,
              },
            ],
            error: null,
          });
        case 'acquire_ingestion_lock':
          return Promise.resolve({ data: options.lockAcquired ?? true, error: null });
        case 'start_ingestion_run':
          return Promise.resolve({ data: 'run-1', error: null });
        case 'complete_ingestion_run':
        case 'release_ingestion_lock':
        case 'refresh_job_freshness':
          return Promise.resolve({ data: true, error: null });
        case 'upsert_ingested_job': {
          const upsertIndex = callCounts.get('upsert_ingested_job') ?? 1;
          const result = options.upsertResults?.[upsertIndex - 1] ?? {
            jobId,
            created: true,
            merged: false,
            matchedBy: 'created',
            contentChanged: true,
          };
          return Promise.resolve({ data: result, error: null });
        }
        case 'matching_subjects':
          return Promise.resolve({
            data: [
              {
                user_id: userId,
                career_profile_id: profileId,
                plan_code: 'plus_monthly',
                priority: 1,
              },
            ],
            error: null,
          });
        case 'career_profile_detail':
          return Promise.resolve({
            data: options.profileDetail ?? defaultProfileDetail(),
            error: null,
          });
        case 'confirmed_career_evidence':
          return Promise.resolve({
            data: {
              careerProfileId: profileId,
              facts: (options.evidence ?? []).map((id) => ({ id })),
            },
            error: null,
          });
        case 'matching_job_candidates': {
          const batch =
            candidateBatches[
              Math.min(callCounts.get('matching_job_candidates') ?? 1, candidateBatches.length) - 1
            ] ?? [];
          return Promise.resolve({
            data: {
              items: batch,
              careerProfileId: profileId,
              profileVersion: 3,
              modelVersion: 'matching-v1',
            },
            error: null,
          });
        }
        case 'record_job_matches':
          return Promise.resolve({ data: 1, error: null });
        default:
          return Promise.resolve({ data: null, error: null });
      }
    }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: sourceId,
                code: 'remotive',
                status: 'active',
                config: options.sourceConfig ?? {},
                requires_credentials: options.requiresCredentials ?? false,
                credential_env_var: options.credentialEnvVar ?? null,
                batch_size: 25,
              },
              error: null,
            }),
        }),
      }),
    })),
  };
  return { client, calls };
}

function defaultProfileDetail() {
  return {
    id: profileId,
    version: 3,
    headline: 'Workflow automation specialist',
    summary: 'Builds reliable automation between business systems for small operations teams.',
    currentRoleTitle: 'Automation Specialist',
    careerLevel: 'mid',
    yearsExperience: 3.5,
    industries: ['SaaS'],
    targetRoleTitles: ['Workflow Automation Engineer'],
    excludedRoleTitles: [],
    preferredEmploymentTypes: ['full_time'],
    preferredWorkArrangement: 'remote',
    preferredLocations: ['Remote'],
    openToInternational: true,
    openToRelocation: false,
    salaryExpectation: {
      minMinor: 8_000_000,
      maxMinor: 11_000_000,
      currency: 'PHP',
      period: 'monthly',
    },
    skills: [{ name: 'n8n', skillKind: 'tool', isPrimary: true, proficiency: 'advanced' }],
    employment: [
      {
        roleTitle: 'Automation Specialist',
        companyName: 'Northstar Systems',
        isCurrent: true,
        startDate: '2023-02-01',
        endDate: null,
        skills: ['n8n'],
        highlights: [],
      },
    ],
  };
}

/**
 * A posting identifier for a synthetic candidate. `candidateJob()` defaults to
 * the one `jobId` the ingestion fixtures use; a test that needs several distinct
 * candidates has to give them distinct identifiers, because the worker keys its
 * per-posting accounting on them.
 */
function syntheticJobId(suffix: string): string {
  return `e0000000-0000-4000-8000-0000000000${suffix}`;
}

function candidateJob(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    title: 'Workflow Automation Engineer',
    companyName: 'Northstar Systems',
    description:
      'Own internal automation between business systems and improve reporting reliability.',
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
    skills: ['n8n'],
    requirements: ['Strong n8n experience'],
    preferredQualifications: [],
    experienceYearsMin: 3,
    experienceYearsMax: null,
    postedAt: '2026-09-13T00:00:00.000Z',
    lastSeenAt: '2026-09-13T12:00:00.000Z',
    status: 'active',
    // What `public.matching_job_candidates` reports for every item it returns.
    eligibleReason: 'new_job',
    ...overrides,
  };
}

function adapter(postings: readonly Record<string, unknown>[]): JobSourceAdapter {
  return {
    code: 'remotive',
    displayName: 'Remotive',
    attribution: 'Job data provided by Remotive.',
    requiresCredentials: false,
    credentialEnvVars: [],
    fetchPostings: () =>
      Promise.resolve(
        postings.map((payload, index) => ({
          sourceJobId: `posting-${index}`,
          sourceUrl: `https://example.test/${index}`,
          payload,
        })),
      ),
    normalize: (raw) => ({
      sourceJobId: raw.sourceJobId,
      sourceUrl: raw.sourceUrl,
      applyUrl: null,
      title: 'Workflow Automation Engineer',
      companyName: 'Northstar Systems',
      companyDomain: null,
      companyCountryCode: 'PH',
      description: 'A sufficiently detailed description body for the posting.',
      employmentType: 'full_time',
      seniority: 'mid',
      remoteState: 'remote',
      locationRaw: 'Remote — Philippines',
      city: 'Manila',
      region: 'Metro Manila',
      countryCode: 'PH',
      isInternational: false,
      salaryMinMinor: null,
      salaryMaxMinor: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salaryIsEstimate: true,
      requirements: [],
      preferredQualifications: [],
      skills: ['n8n'],
      experienceYearsMin: null,
      experienceYearsMax: null,
      language: 'en',
      postedAt: null,
      expiresAt: null,
      contentFingerprint: 'a'.repeat(64),
      payloadChecksum: 'b'.repeat(64),
      rawPayload: { raw: true },
    }),
  };
}

function buildWorker(
  overrides: Parameters<typeof createFakeClient>[0] = {},
  postings: readonly Record<string, unknown>[] = [{ id: 1 }],
  options: { adapters?: (code: string) => JobSourceAdapter | undefined } = {},
) {
  const { client, calls } = createFakeClient(overrides);
  const worker = new JobIntelligenceWorker(environment, {
    client: client as never,
    adapters: options.adapters ?? (() => adapter(postings)),
    fetch: (() => Promise.reject(new Error('network_must_not_be_used'))) as unknown as typeof fetch,
    now: () => new Date('2026-09-14T00:00:00.000Z'),
  });
  return { worker, calls };
}

describe('job intelligence worker', () => {
  it('runs one shared scan per due source and reports the cycle', async () => {
    const { worker, calls } = buildWorker();
    await worker.runOnce();
    const names = calls.map((call) => call.name);
    expect(names).toContain('job_ingestion_schedule');
    expect(names).toContain('acquire_ingestion_lock');
    expect(names).toContain('start_ingestion_run');
    expect(names).toContain('upsert_ingested_job');
    expect(names).toContain('complete_ingestion_run');
    expect(names).toContain('release_ingestion_lock');
    expect(names).toContain('refresh_job_freshness');
    expect(worker.state().lastIngestionAt).not.toBeNull();
    expect(worker.state().lastErrorCode).toBeNull();
  });

  it('does not scan a source that is not due', async () => {
    const { worker, calls } = buildWorker({ due: false });
    await worker.runOnce();
    expect(calls.some((call) => call.name === 'start_ingestion_run')).toBe(false);
    expect(calls.some((call) => call.name === 'upsert_ingested_job')).toBe(false);
  });

  it('skips a source another worker has locked instead of scanning twice', async () => {
    const { worker, calls } = buildWorker({ lockAcquired: false });
    await worker.runOnce();
    expect(calls.some((call) => call.name === 'start_ingestion_run')).toBe(false);
    expect(calls.some((call) => call.name === 'upsert_ingested_job')).toBe(false);
    expect(worker.state().lastErrorCode).toBeNull();
  });

  it('releases the lock even when the scan fails', async () => {
    const failing: JobSourceAdapter = {
      ...adapter([{ id: 1 }]),
      fetchPostings: () => Promise.reject(new Error('provider_timeout')),
    };
    const { worker, calls } = buildWorker({}, [], { adapters: () => failing });
    await worker.runOnce();
    expect(calls.some((call) => call.name === 'release_ingestion_lock')).toBe(true);
    const completion = calls.find((call) => call.name === 'complete_ingestion_run');
    expect(completion?.args.outcome).toMatchObject({ status: 'failed' });
  });

  it('reports a partial run when individual postings were rejected', async () => {
    const selective: JobSourceAdapter = {
      ...adapter([{ id: 1 }, { id: 2 }]),
      normalize: (raw) =>
        raw.sourceJobId === 'posting-1'
          ? null
          : adapter([]).normalize(raw, {
              fetch: globalThis.fetch,
              credentials: {},
              limit: 25,
              now: new Date(),
              userAgent: 'test',
              timeoutMs: 1000,
            }),
    };
    const { worker, calls } = buildWorker({}, [], { adapters: () => selective });
    await worker.runOnce();
    const completion = calls.find((call) => call.name === 'complete_ingestion_run');
    expect(completion?.args.outcome).toMatchObject({
      status: 'partial',
      fetchedCount: 2,
      rejectedCount: 1,
    });
  });

  it('passes credentials by environment variable name and never from the database', async () => {
    const captured: Record<string, string>[] = [];
    const credentialAdapter: JobSourceAdapter = {
      ...adapter([{ id: 1 }]),
      requiresCredentials: true,
      credentialEnvVars: ['HANAPLY_TEST_PROVIDER_KEY'],
      fetchPostings: (context) => {
        captured.push({ ...context.credentials });
        return Promise.resolve([
          { sourceJobId: 'a', sourceUrl: 'https://example.test/a', payload: {} },
        ]);
      },
    };
    process.env.HANAPLY_TEST_PROVIDER_KEY = 'secret-value';
    const { worker } = buildWorker(
      { requiresCredentials: true, credentialEnvVar: 'HANAPLY_TEST_PROVIDER_KEY' },
      [],
      { adapters: () => credentialAdapter },
    );
    await worker.runOnce();
    delete process.env.HANAPLY_TEST_PROVIDER_KEY;
    expect(captured[0]).toEqual({ HANAPLY_TEST_PROVIDER_KEY: 'secret-value' });
  });

  it('omits credentials entirely when the provider secret is absent', async () => {
    const captured: Record<string, string>[] = [];
    const credentialAdapter: JobSourceAdapter = {
      ...adapter([{ id: 1 }]),
      requiresCredentials: true,
      credentialEnvVars: ['HANAPLY_ABSENT_PROVIDER_KEY'],
      fetchPostings: (context) => {
        captured.push({ ...context.credentials });
        throw new MissingCredentialError('remotive', ['HANAPLY_ABSENT_PROVIDER_KEY']);
      },
    };
    const { worker, calls } = buildWorker(
      { requiresCredentials: true, credentialEnvVar: 'HANAPLY_ABSENT_PROVIDER_KEY' },
      [],
      { adapters: () => credentialAdapter },
    );
    await worker.runOnce();
    expect(captured[0]).toEqual({});
    const completion = calls.find((call) => call.name === 'complete_ingestion_run');
    expect(completion?.args.outcome).toMatchObject({ status: 'failed' });
  });

  it('scores a bounded candidate set and stores explainable results', async () => {
    const { worker, calls } = buildWorker(
      {
        candidates: [candidateJob(), candidateJob({ id: 'e0000000-0000-4000-8000-000000000009' })],
        evidence: ['f0000000-0000-4000-8000-000000000001'],
      },
      [{ id: 1 }],
    );
    await worker.runOnce();
    const stored = calls.find((call) => call.name === 'record_job_matches');
    expect(stored).toBeDefined();
    const items = (stored?.args.match_input as { items: readonly Record<string, unknown>[] }).items;
    expect(items.length).toBe(2);
    expect(items[0]).toHaveProperty('score');
    expect(items[0]).toHaveProperty('dimensions');
    expect(items[0]).toHaveProperty('requirementMapping');
    expect(items[0]?.evidenceFactIds).toEqual(['f0000000-0000-4000-8000-000000000001']);
    expect(worker.state().profilesScored).toBe(1);
  });

  it('cites no evidence when the profile has no confirmed facts', async () => {
    const { worker, calls } = buildWorker({ candidates: [candidateJob()], evidence: [] });
    await worker.runOnce();
    const stored = calls.find((call) => call.name === 'record_job_matches');
    const items = (stored?.args.match_input as { items: readonly Record<string, unknown>[] }).items;
    expect(items[0]?.evidenceFactIds).toEqual([]);
  });

  it('does not call the match writer when there is nothing to score', async () => {
    const { worker, calls } = buildWorker({ candidates: [] });
    await worker.runOnce();
    expect(calls.some((call) => call.name === 'record_job_matches')).toBe(false);
    expect(worker.state().profilesScored).toBe(0);
  });

  it('surfaces an rpc failure as a cycle error code without throwing', async () => {
    const { worker } = buildWorker({ rpcFailure: 'job_ingestion_schedule' });
    await expect(worker.runOnce()).resolves.toBeUndefined();
    expect(worker.state().lastErrorCode).not.toBeNull();
    expect(worker.state().cycleActive).toBe(false);
  });

  it('ignores a concurrent run while a cycle is active', async () => {
    const { worker, calls } = buildWorker();
    await Promise.all([worker.runOnce(), worker.runOnce()]);
    const scheduleCalls = calls.filter((call) => call.name === 'job_ingestion_schedule');
    expect(scheduleCalls.length).toBe(1);
  });

  it('asks for candidates under the engine version the engine reports', async () => {
    /*
     * The version is an argument rather than something the database remembers.
     * If this stops being passed, a deliberate engine version change re-queues
     * nothing at all: the stored results keep claiming to be current, which is
     * the defect the eligibility rule exists to remove.
     */
    const { worker, calls } = buildWorker({ candidates: [candidateJob()] });
    await worker.runOnce();
    const candidates = calls.find((call) => call.name === 'matching_job_candidates');
    expect(candidates?.args.requested_model_version).toBe(modelVersion);
  });

  it('counts and reports why each posting was offered for scoring', async () => {
    const { worker } = buildWorker({
      candidates: [
        candidateJob({ id: syntheticJobId('11'), eligibleReason: 'new_job' }),
        candidateJob({ id: syntheticJobId('12'), eligibleReason: 'content_changed' }),
        candidateJob({ id: syntheticJobId('13'), eligibleReason: 'profile_changed' }),
        candidateJob({ id: syntheticJobId('14'), eligibleReason: 'matching_version_changed' }),
      ],
    });
    await worker.runOnce();
    const state = worker.state();
    // Every posting the database offered was scored and counted exactly once, so
    // the breakdown adds up to the total rather than approximating it.
    expect(state.jobsOffered).toBe(4);
    expect(state.jobMatchesReasoned).toBe(4);
    expect(state.jobMatchesNew).toBe(1);
    expect(state.jobMatchesContentChanged).toBe(1);
    expect(state.jobMatchesProfileChanged).toBe(1);
    expect(state.jobMatchesMatchingVersionChanged).toBe(1);
    expect(state.jobMatchesRetried).toBe(0);
  });

  it('counts an unchanged posting as unchanged rather than as work', async () => {
    const { worker, calls } = buildWorker({ candidates: [] });
    await worker.runOnce();
    expect(worker.state().profilesUnchanged).toBe(1);
    expect(worker.state().jobsOffered).toBe(0);
    expect(calls.some((call) => call.name === 'record_job_matches')).toBe(false);
  });

  it('treats a candidate that reports no reason as new work rather than skipping it', async () => {
    const { worker, calls } = buildWorker({
      candidates: [candidateJob({ id: syntheticJobId('15'), eligibleReason: undefined })],
    });
    await worker.runOnce();
    expect(worker.state().jobMatchesNew).toBe(1);
    expect(calls.some((call) => call.name === 'record_job_matches')).toBe(true);
  });

  it('retries a batch whose results could not be stored, and reports the retry as a retry', async () => {
    /*
     * The row is not partially written: `record_job_matches` is one call for the
     * whole batch, so a failure stores nothing and every posting in the batch is
     * still due. The profile stays in the queue because no match row was
     * recorded, and the second cycle is what proves the retry happened.
     */
    const { worker, calls } = buildWorker(
      {
        candidates: [candidateJob({ id: syntheticJobId('16') })],
        rpcFailure: ['record_job_matches', null],
      },
      [{ id: 1 }],
    );
    await worker.runOnce();
    expect(worker.state().profilesScored).toBe(0);
    expect(worker.state().jobMatchesRetried).toBe(0);

    await worker.runOnce();
    expect(calls.filter((call) => call.name === 'record_job_matches').length).toBe(2);
    expect(worker.state().profilesScored).toBe(1);
    // The second attempt is reported as a retry of the posting the first attempt
    // could not store, not as new work: the retry is the breakdown entry, so
    // `newJob` is zero for this cycle.
    expect(worker.state().jobMatchesRetried).toBe(1);
    expect(worker.state().jobMatchesNew).toBe(0);
    expect(worker.state().jobsOffered).toBe(1);
  });

  it('forgets a pending retry once the batch is stored', async () => {
    const { worker } = buildWorker({
      candidates: [candidateJob({ id: syntheticJobId('17') })],
      rpcFailure: ['record_job_matches', null],
    });
    await worker.runOnce();
    await worker.runOnce();
    // A third cycle that still sees the posting is new work again, not a retry:
    // the batch that failed was stored by the second attempt.
    await worker.runOnce();
    expect(worker.state().jobMatchesRetried).toBe(0);
    expect(worker.state().jobMatchesNew).toBe(1);
  });

  it('reports whether a re-observed posting actually changed', async () => {
    /*
     * The ingestion write path tells the caller whether the canonical content
     * moved, so an operator reading an ingestion run can tell "the provider
     * re-sent the same posting" from "the posting was edited" — the difference
     * between a healthy scan and a reprocessing storm. `created` and `matchedBy`
     * cannot answer that: they say how the row was found, not whether its content
     * changed.
     */
    const { worker, calls } = buildWorker({
      upsertResults: [
        {
          jobId,
          created: false,
          merged: false,
          matchedBy: 'source_identity',
          contentChanged: false,
        },
      ],
    });
    await worker.runOnce();
    const upsert = calls.find((call) => call.name === 'upsert_ingested_job');
    expect(upsert).toBeDefined();
    const completion = calls.find((call) => call.name === 'complete_ingestion_run');
    expect(completion?.args.outcome).toMatchObject({ status: 'succeeded' });
  });

  it('keeps a cycle healthy when the canonical content did change', async () => {
    const { worker, calls } = buildWorker({
      upsertResults: [
        { jobId, created: true, merged: false, matchedBy: 'created', contentChanged: true },
      ],
    });
    await worker.runOnce();
    expect(calls.some((call) => call.name === 'upsert_ingested_job')).toBe(true);
    expect(worker.state().lastErrorCode).toBeNull();
    expect(worker.state().jobsCreated).toBe(1);
  });
});
