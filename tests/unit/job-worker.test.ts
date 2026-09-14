import { describe, expect, it, vi } from 'vitest';

import { parseWorkerEnvironment } from '../../packages/config/src/index.js';
import { MissingCredentialError, type JobSourceAdapter } from '../../packages/jobs/src/index.js';
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
  MATCHING_CANDIDATE_LIMIT: '3',
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
 */
function createFakeClient(options: {
  due?: boolean;
  lockAcquired?: boolean;
  sourceConfig?: Record<string, unknown>;
  requiresCredentials?: boolean;
  credentialEnvVar?: string | null;
  candidates?: readonly Record<string, unknown>[];
  profileDetail?: Record<string, unknown>;
  evidence?: readonly string[];
  rpcFailure?: string;
}) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn((name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (options.rpcFailure === name) {
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
        case 'upsert_ingested_job':
          return Promise.resolve({
            data: { jobId, created: true, merged: false, matchedBy: 'created' },
            error: null,
          });
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
        case 'matching_job_candidates':
          return Promise.resolve({
            data: {
              items: options.candidates ?? [],
              careerProfileId: profileId,
              profileVersion: 3,
            },
            error: null,
          });
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
});
