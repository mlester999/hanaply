import { parseWorkerEnvironment } from '@hanaply/config';
import type { DatabaseClient, Json } from '@hanaply/database';
import {
  CaptureEmailProvider,
  createEmailProvider,
  type EmailDeliveryReceipt,
  type EmailMessage,
  type EmailProvider,
  emailMessageSchema,
  maskEmailRecipient,
  renderEmailTemplate,
  type RenderedEmail,
} from '@hanaply/email';
import { describe, expect, it, vi } from 'vitest';

import { JobIntelligenceWorker } from '../../services/worker/src/jobs.js';

const environment = parseWorkerEnvironment({
  NODE_ENV: 'test',
  HANAPLY_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:3100',
  API_BASE_URL: 'http://localhost:3101',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'local-publishable-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'local-service-test-key',
  WORKER_MODE: 'active',
  EMAIL_PROVIDER: 'capture',
  JOB_ALERT_WINDOW_MINUTES: '30',
  JOB_ALERT_MINIMUM_SCORE: '75',
  DIGEST_MINIMUM_SCORE: '55',
  NOTIFICATION_BATCH_SIZE: '5',
});

const userId = '70000000-0000-4000-8000-000000000001';
const notificationId = '70000000-0000-4000-8000-000000000002';
const otherNotificationId = '70000000-0000-4000-8000-000000000003';
const radarUrl = 'http://localhost:3100/dashboard/radar';
const alertIdempotencyKey = `alert:${userId}:202609190900`;
const digestIdempotencyKey = `digest:${userId}:20260919`;

// The exact shape public.queue_job_alert_notifications() writes into
// notification_outbox.variables, including the nulls a listing may carry.
const alertJobs = [
  {
    jobId: '71000000-0000-4000-8000-000000000001',
    title: 'Workflow Automation Engineer',
    companyName: 'Northstar Systems',
    score: 88,
    verdict: 'strong_match',
    locationRaw: 'Metro Manila, Philippines',
    remoteState: 'hybrid',
    salaryMinMinor: 9_000_000,
    salaryMaxMinor: 12_000_000,
    salaryCurrency: 'PHP',
  },
  {
    jobId: '71000000-0000-4000-8000-000000000002',
    title: 'Data Operations Specialist',
    companyName: 'Harbor Analytics',
    score: 76,
    verdict: 'good_match',
    locationRaw: null,
    remoteState: 'remote',
    salaryMinMinor: null,
    salaryMaxMinor: null,
    salaryCurrency: null,
  },
];

const digestJobs = alertJobs.map(
  ({ jobId, title, companyName, score, verdict, locationRaw, remoteState }) => ({
    jobId,
    title,
    companyName,
    score,
    verdict,
    locationRaw,
    remoteState,
  }),
);

function message(input: {
  templateId: 'job-alert' | 'daily-digest';
  variables: Record<string, unknown>;
}): EmailMessage {
  return emailMessageSchema.parse({
    recipient: 'member@example.test',
    templateId: input.templateId,
    templateVersion: 'v1',
    category: input.templateId === 'job-alert' ? 'job_alert' : 'daily_digest',
    idempotencyKey: input.templateId === 'job-alert' ? alertIdempotencyKey : digestIdempotencyKey,
    variables: { displayName: 'Mika Santos', radarUrl, ...input.variables },
  });
}

function variableSchemaAccepts(variables: Record<string, unknown>): boolean {
  return emailMessageSchema.safeParse({
    recipient: 'member@example.test',
    templateId: 'job-alert',
    templateVersion: 'v1',
    category: 'job_alert',
    idempotencyKey: alertIdempotencyKey,
    variables,
  }).success;
}

// ---------------------------------------------------------------------------
// Fake database and provider
// ---------------------------------------------------------------------------

type OutboxStatus = 'pending' | 'delivered' | 'failed' | 'disabled';

interface FakeOutboxRow {
  id: string;
  user_id: string;
  category: string;
  template_id: string;
  template_version: string;
  idempotency_key: string;
  variables: Json;
  attempts: number;
  status: OutboxStatus;
  claim_token: string | null;
  available_at: number;
  failure_code: string | null;
  completed_attempts: number | null;
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function outboxRow(overrides: {
  id?: string;
  category?: string;
  templateId?: string;
  idempotencyKey?: string;
  variables?: Json;
  attempts?: number;
}): FakeOutboxRow {
  const templateId = overrides.templateId ?? 'job-alert';
  const category =
    overrides.category ?? (templateId === 'daily-digest' ? 'daily_digest' : 'job_alert');
  return {
    id: overrides.id ?? notificationId,
    user_id: userId,
    category,
    template_id: templateId,
    template_version: 'v1',
    idempotency_key:
      overrides.idempotencyKey ??
      (templateId === 'daily-digest' ? digestIdempotencyKey : alertIdempotencyKey),
    variables:
      overrides.variables ??
      ({
        displayName: 'Mika Santos',
        jobCount: alertJobs.length,
        jobs: alertJobs,
      } satisfies Json),
    attempts: overrides.attempts ?? 0,
    status: 'pending',
    claim_token: null,
    available_at: 0,
    failure_code: null,
    completed_attempts: null,
  };
}

interface FakeUser {
  email?: string | undefined;
  emailConfirmedAt?: string | null;
}

/**
 * A fake PostgREST and Auth surface. The worker only reaches the database
 * through named RPCs, so the fake answers those and keeps the outbox in memory
 * with the same claim semantics the migration defines: only a pending row whose
 * available_at has passed can be claimed, and a release increments attempts.
 */
function createFakeDatabase(options: {
  clock: () => Date;
  rows?: readonly FakeOutboxRow[];
  user?: FakeUser | null;
  queuedAlerts?: number;
  queuedDigest?: number;
  claimReturnsNull?: boolean;
}) {
  const rows = [...(options.rows ?? [])];
  const calls: RpcCall[] = [];
  const rpc = vi.fn((name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args });
    switch (name) {
      case 'job_ingestion_schedule':
        return Promise.resolve({ data: [], error: null });
      case 'matching_subjects':
        return Promise.resolve({ data: [], error: null });
      case 'refresh_job_freshness':
        return Promise.resolve({ data: true, error: null });
      case 'queue_job_alert_notifications':
        return Promise.resolve({ data: options.queuedAlerts ?? 0, error: null });
      case 'queue_job_digest_notifications':
        return Promise.resolve({ data: options.queuedDigest ?? 0, error: null });
      case 'claim_notification_outbox': {
        const batchSize =
          typeof args.requested_batch_size === 'number' ? args.requested_batch_size : 25;
        const claimToken =
          typeof args.requested_claim_token === 'string' ? args.requested_claim_token : '';
        const now = options.clock().getTime();
        const claimable = rows
          .filter((row) => row.status === 'pending' && row.available_at <= now)
          .slice(0, batchSize);
        for (const row of claimable) row.claim_token = claimToken;
        const claimed = claimable.map((row) => ({
          id: row.id,
          user_id: row.user_id,
          category: row.category,
          template_id: row.template_id,
          template_version: row.template_version,
          idempotency_key: row.idempotency_key,
          variables: row.variables,
          attempts: row.attempts,
        }));
        return Promise.resolve({
          data: options.claimReturnsNull === true ? null : claimed,
          error: null,
        });
      }
      case 'complete_notification_outbox': {
        const row = rows.find(
          (candidate) =>
            candidate.id === args.target_notification_id &&
            candidate.claim_token === args.requested_claim_token,
        );
        if (!row) return Promise.resolve({ data: false, error: null });
        row.status =
          args.requested_status === 'delivered'
            ? 'delivered'
            : args.requested_status === 'disabled'
              ? 'disabled'
              : 'failed';
        row.failure_code =
          typeof args.requested_failure_code === 'string' && args.requested_failure_code !== ''
            ? args.requested_failure_code
            : null;
        row.completed_attempts =
          typeof args.requested_attempts === 'number' ? args.requested_attempts : row.attempts;
        row.claim_token = null;
        return Promise.resolve({ data: true, error: null });
      }
      case 'release_notification_outbox': {
        const row = rows.find(
          (candidate) =>
            candidate.id === args.target_notification_id &&
            candidate.claim_token === args.requested_claim_token,
        );
        if (!row) return Promise.resolve({ data: false, error: null });
        row.attempts += 1;
        row.available_at = Date.parse(String(args.retry_at));
        row.claim_token = null;
        return Promise.resolve({ data: true, error: null });
      }
      default:
        return Promise.resolve({ data: null, error: null });
    }
  });

  const client = {
    rpc,
    auth: {
      admin: {
        getUserById: vi.fn((requestedUserId: string) => {
          if (!options.user) {
            return { data: { user: null }, error: { message: 'user lookup failed' } };
          }
          return {
            data: {
              user: {
                id: requestedUserId,
                email: options.user.email,
                email_confirmed_at: options.user.emailConfirmedAt,
              },
            },
            error: null,
          };
        }),
      },
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    })),
  };

  function rpcCalls(name: string): RpcCall[] {
    return calls.filter((call) => call.name === name);
  }

  function rpcArgs(name: string): Record<string, unknown> | undefined {
    return calls.find((call) => call.name === name)?.args;
  }

  return { client: client as unknown as DatabaseClient, rows, calls, rpcCalls, rpcArgs };
}

/**
 * A fake email provider: it renders the message exactly as the real providers
 * do and records what it was asked to send, without any network call.
 */
function createFakeProvider(): {
  provider: EmailProvider;
  send: ReturnType<typeof vi.fn>;
  sent: EmailMessage[];
  rendered: RenderedEmail[];
} {
  const sent: EmailMessage[] = [];
  const rendered: RenderedEmail[] = [];
  const send = vi.fn((input: EmailMessage): Promise<EmailDeliveryReceipt> => {
    sent.push(input);
    const output = renderEmailTemplate(input);
    rendered.push(output);
    return Promise.resolve({
      provider: 'capture',
      status: 'captured',
      providerMessageId: `message-${sent.length}`,
      templateId: output.templateId,
      templateVersion: 'v1',
      recipientMasked: maskEmailRecipient(input.recipient),
      attempts: 1,
      failureCode: null,
    } satisfies EmailDeliveryReceipt);
  });
  return { provider: { send }, send, sent, rendered };
}

function failingProvider(): { provider: EmailProvider; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(() => Promise.reject(new Error('provider connection reset by peer')));
  return { provider: { send }, send };
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function buildWorker(
  database: ReturnType<typeof createFakeDatabase>,
  provider: EmailProvider,
  clock: () => Date,
): JobIntelligenceWorker {
  return new JobIntelligenceWorker(environment, {
    client: database.client,
    provider,
    adapters: () => undefined,
    fetch: () => Promise.reject(new Error('network_must_not_be_used')),
    now: clock,
    random: () => 0.5,
  });
}

const confirmedUser: FakeUser = {
  email: 'member@example.test',
  emailConfirmedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('opportunity notification templates', () => {
  it('renders the job alert with job detail, the radar link, and no markup in the text', () => {
    const rendered = renderEmailTemplate(
      message({
        templateId: 'job-alert',
        variables: { jobCount: alertJobs.length, jobs: alertJobs },
      }),
    );
    expect(rendered.subject).toBe('2 new strong matches on Hanaply');
    expect(rendered.preheader).toContain('2 opportunities');
    expect(rendered.html).toContain('Workflow Automation Engineer');
    expect(rendered.html).toContain('Data Operations Specialist');
    expect(rendered.text).toContain('Workflow Automation Engineer');
    expect(rendered.text).toContain('Data Operations Specialist');
    expect(rendered.html).toContain(radarUrl);
    expect(rendered.text).toContain(radarUrl);
    expect(rendered.html).toContain('88% match');
    expect(rendered.text).toContain('88% match');
    expect(rendered.text).toContain('Strong match');
    expect(rendered.text).toContain('Hybrid · Metro Manila, Philippines');
    expect(rendered.text).toContain('Remote');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.text).not.toMatch(/<\/?[a-z][^>]*>/iu);
  });

  it('shows a salary line only for a listing that carries a salary', () => {
    const alert = renderEmailTemplate(
      message({
        templateId: 'job-alert',
        variables: { jobCount: alertJobs.length, jobs: alertJobs },
      }),
    );
    const digest = renderEmailTemplate(
      message({
        templateId: 'daily-digest',
        variables: {
          localDay: 'September 19, 2026',
          jobCount: digestJobs.length,
          jobs: digestJobs,
          savedCount: 4,
          activeApplicationCount: 2,
        },
      }),
    );
    expect(alert.text.match(/Salary:/gu)).toHaveLength(1);
    expect(alert.text).toMatch(/Salary: .*90,000.*120,000/u);
    expect(digest.text).not.toContain('Salary:');
  });

  it('describes the daily digest counts and links to the radar', () => {
    const rendered = renderEmailTemplate(
      message({
        templateId: 'daily-digest',
        variables: {
          localDay: 'September 19, 2026',
          jobCount: digestJobs.length,
          jobs: digestJobs,
          savedCount: 4,
          activeApplicationCount: 2,
        },
      }),
    );
    expect(rendered.subject).toBe('Your Hanaply digest for September 19, 2026');
    expect(rendered.preheader).toContain('4 saved jobs');
    expect(rendered.text).toContain('Your daily radar digest');
    expect(rendered.text).toContain('4 saved jobs');
    expect(rendered.text).toContain('2 active applications');
    expect(rendered.text).toContain('Workflow Automation Engineer');
    expect(rendered.text).toContain(radarUrl);
    expect(rendered.text).not.toMatch(/<\/?[a-z][^>]*>/iu);
  });

  it('points at notification settings and never promises a one-click unsubscribe link', () => {
    for (const templateId of ['job-alert', 'daily-digest'] as const) {
      const rendered = renderEmailTemplate(
        message({
          templateId,
          variables:
            templateId === 'job-alert'
              ? { jobCount: alertJobs.length, jobs: alertJobs }
              : {
                  localDay: 'September 19, 2026',
                  jobCount: digestJobs.length,
                  jobs: digestJobs,
                  savedCount: 4,
                  activeApplicationCount: 2,
                },
        }),
      );
      expect(rendered.text).toContain('notification settings');
      expect(rendered.text.toLowerCase()).not.toContain('one-click');
      expect(rendered.text.toLowerCase()).not.toContain('click here to unsubscribe');
    }
  });

  it('rejects a raw listing URL as the opportunity action', () => {
    expect(() =>
      renderEmailTemplate(
        message({
          templateId: 'job-alert',
          variables: {
            jobCount: 1,
            jobs: alertJobs,
            radarUrl: 'https://jobs.example.test/apply/abc-123',
          },
        }),
      ),
    ).toThrow(/Hanaply radar/u);
  });

  it('still renders when no radar URL was supplied', () => {
    const rendered = renderEmailTemplate(
      emailMessageSchema.parse({
        recipient: 'member@example.test',
        templateId: 'job-alert',
        templateVersion: 'v1',
        category: 'job_alert',
        idempotencyKey: alertIdempotencyKey,
        variables: {
          displayName: 'Mika Santos',
          jobCount: alertJobs.length,
          jobs: alertJobs,
        },
      }),
    );
    expect(rendered.text).toContain('Workflow Automation Engineer');
    expect(rendered.html).not.toContain('jobs.example.test');
    expect(rendered.text).not.toContain('Open Job Radar');
  });

  it('rejects an array longer than twenty entries and objects nested deeper than two levels', () => {
    const tooManyJobs = Array.from({ length: 21 }, (_value, index) => ({
      jobId: `job-${index}`,
      title: 'Engineer',
    }));
    expect(variableSchemaAccepts({ jobs: tooManyJobs })).toBe(false);
    expect(variableSchemaAccepts({ jobs: tooManyJobs.slice(0, 20) })).toBe(true);
    expect(variableSchemaAccepts({ jobs: [{ jobId: 'job-1', salary: { minimum: 1 } }] })).toBe(
      false,
    );
    expect(variableSchemaAccepts({ detail: { nested: { deep: true } } })).toBe(false);
    expect(variableSchemaAccepts({ detail: { savedCount: 4, tags: ['a', 'b'] } })).toBe(true);
    expect(
      variableSchemaAccepts({
        tags: Array.from({ length: 21 }, (_value, index) => `tag-${index}`),
      }),
    ).toBe(false);
    expect(variableSchemaAccepts({ score: Number.NaN })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Worker delivery
// ---------------------------------------------------------------------------

describe('opportunity notification delivery', () => {
  it('queues, claims, renders, and completes a notification', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      rows: [outboxRow({})],
      user: confirmedUser,
      queuedAlerts: 1,
      queuedDigest: 1,
    });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await worker.runOnce(true);

    expect(database.rpcArgs('queue_job_alert_notifications')).toMatchObject({
      evaluated_at: '2026-09-19T00:00:00.000Z',
      window_minutes: environment.JOB_ALERT_WINDOW_MINUTES,
      minimum_score: environment.JOB_ALERT_MINIMUM_SCORE,
      batch_size: environment.NOTIFICATION_BATCH_SIZE,
    });
    expect(database.rpcArgs('queue_job_digest_notifications')).toMatchObject({
      evaluated_at: '2026-09-19T00:00:00.000Z',
      minimum_score: environment.DIGEST_MINIMUM_SCORE,
      batch_size: environment.NOTIFICATION_BATCH_SIZE,
    });
    expect(database.rpcArgs('claim_notification_outbox')).toMatchObject({
      requested_batch_size: environment.NOTIFICATION_BATCH_SIZE,
    });

    expect(fake.sent).toHaveLength(1);
    // The provider idempotency key is the outbox key, so a retry after a crash
    // cannot deliver the same notification twice.
    expect(fake.sent[0]?.idempotencyKey).toBe(alertIdempotencyKey);
    expect(fake.sent[0]?.recipient).toBe('member@example.test');
    expect(fake.sent[0]?.templateId).toBe('job-alert');
    expect(fake.sent[0]?.category).toBe('job_alert');
    expect(fake.sent[0]?.variables.radarUrl).toBe(radarUrl);
    expect(fake.rendered[0]?.html).toContain('Workflow Automation Engineer');
    expect(fake.rendered[0]?.text).toContain(radarUrl);

    expect(database.rpcArgs('complete_notification_outbox')).toMatchObject({
      target_notification_id: notificationId,
      requested_status: 'delivered',
      requested_attempts: 1,
    });
    expect(database.rows[0]?.status).toBe('delivered');
    expect(worker.state()).toMatchObject({
      notificationsQueued: 2,
      notificationsDelivered: 1,
      notificationsFailed: 0,
      lastErrorCode: null,
    });
    expect(worker.state().lastNotificationAt).not.toBeNull();
  });

  it('renders a daily digest row through the same cycle', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      rows: [
        outboxRow({
          id: otherNotificationId,
          templateId: 'daily-digest',
          variables: {
            displayName: 'Mika Santos',
            localDay: 'September 19, 2026',
            jobCount: digestJobs.length,
            jobs: digestJobs,
            savedCount: 4,
            activeApplicationCount: 2,
          },
        }),
      ],
      user: confirmedUser,
    });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await worker.runOnce(true);

    expect(fake.sent[0]?.idempotencyKey).toBe(digestIdempotencyKey);
    expect(fake.sent[0]?.category).toBe('daily_digest');
    expect(fake.rendered[0]?.text).toContain('4 saved jobs');
    expect(database.rows[0]?.status).toBe('delivered');
  });

  it('delivers through the provider the environment configures', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      rows: [outboxRow({})],
      user: confirmedUser,
      queuedAlerts: 1,
    });
    const worker = new JobIntelligenceWorker(environment, {
      client: database.client,
      adapters: () => undefined,
      fetch: () => Promise.reject(new Error('network_must_not_be_used')),
      now: clock,
      random: () => 0.5,
    });

    expect(createEmailProvider(environment)).toBeInstanceOf(CaptureEmailProvider);
    await worker.runOnce(true);

    expect(worker.state()).toMatchObject({
      notificationsQueued: 1,
      notificationsDelivered: 1,
      notificationsFailed: 0,
    });
    expect(database.rows[0]?.status).toBe('delivered');
  });

  it('queues the digest at most once per maintenance interval', async () => {
    const start = Date.parse('2026-09-19T00:00:00.000Z');
    let current = start;
    const clock = () => new Date(current);
    const database = createFakeDatabase({ clock, user: confirmedUser });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await worker.runOnce();
    expect(database.rpcCalls('queue_job_alert_notifications')).toHaveLength(1);
    expect(database.rpcCalls('queue_job_digest_notifications')).toHaveLength(1);

    current = start + 30_000;
    await worker.runOnce();
    expect(database.rpcCalls('queue_job_alert_notifications')).toHaveLength(2);
    expect(database.rpcCalls('queue_job_digest_notifications')).toHaveLength(1);

    current = start + environment.WORKER_MAINTENANCE_INTERVAL_MS + 1;
    await worker.runOnce();
    expect(database.rpcCalls('queue_job_digest_notifications')).toHaveLength(2);
  });

  it('releases a transport failure with bounded backoff and retries it later', async () => {
    const start = Date.parse('2026-09-19T00:00:00.000Z');
    let current = start;
    const clock = () => new Date(current);
    const database = createFakeDatabase({ clock, rows: [outboxRow({})], user: confirmedUser });
    const failing = failingProvider();
    const worker = buildWorker(database, failing.provider, clock);

    await worker.runOnce(true);

    const firstRelease = database.rpcArgs('release_notification_outbox');
    expect(firstRelease).toMatchObject({ target_notification_id: notificationId });
    // Full jitter with a fixed 0.5 draw: half of the 60s first-attempt ceiling.
    expect(Date.parse(String(firstRelease?.retry_at)) - start).toBe(30_000);
    expect(database.rows[0]?.attempts).toBe(1);
    expect(database.rows[0]?.status).toBe('pending');
    expect(database.rpcCalls('complete_notification_outbox')).toHaveLength(0);

    // The released row is not claimable before its retry time.
    await worker.runOnce(true);
    expect(failing.send).toHaveBeenCalledTimes(1);

    current = start + 60_000;
    await worker.runOnce(true);
    expect(failing.send).toHaveBeenCalledTimes(2);
    const secondRelease = database.rpcCalls('release_notification_outbox')[1]?.args;
    expect(Date.parse(String(secondRelease?.retry_at)) - current).toBe(60_000);
    expect(database.rows[0]?.attempts).toBe(2);
  });

  it('completes the row as failed once the attempt cap is reached', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      rows: [outboxRow({ attempts: environment.WORKER_NOTIFICATION_MAX_ATTEMPTS - 1 })],
      user: confirmedUser,
    });
    const failing = failingProvider();
    const worker = buildWorker(database, failing.provider, clock);

    await worker.runOnce(true);

    const completion = database.rpcArgs('complete_notification_outbox');
    expect(completion).toMatchObject({
      requested_status: 'failed',
      requested_failure_code: 'transport_error',
      requested_attempts: environment.WORKER_NOTIFICATION_MAX_ATTEMPTS,
    });
    // Only a short failure code is recorded: never the provider error body.
    expect(JSON.stringify(completion)).not.toContain('provider connection reset');
    expect(database.rpcCalls('release_notification_outbox')).toHaveLength(0);
    expect(database.rows[0]?.status).toBe('failed');
    expect(worker.state().notificationsFailed).toBe(1);
  });

  it('closes a notification as disabled when the subscriber has no confirmed email', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      rows: [outboxRow({})],
      user: { email: 'unconfirmed@example.test', emailConfirmedAt: null },
    });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await worker.runOnce(true);

    const completion = database.rpcArgs('complete_notification_outbox');
    expect(completion).toMatchObject({ requested_status: 'disabled' });
    // The recipient address never reaches the database or a log through this call.
    expect(JSON.stringify(completion)).not.toContain('unconfirmed@example.test');
    expect(fake.sent).toHaveLength(0);
    expect(fake.send).not.toHaveBeenCalled();
    expect(database.rpcCalls('release_notification_outbox')).toHaveLength(0);
    expect(database.rows[0]?.status).toBe('disabled');
    expect(worker.state()).toMatchObject({ notificationsFailed: 0, lastErrorCode: null });
  });

  it('treats a subscriber with no address at all as disabled rather than retrying', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      rows: [outboxRow({})],
      user: { email: undefined, emailConfirmedAt: '2026-01-01T00:00:00.000Z' },
    });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await worker.runOnce(true);

    expect(database.rpcArgs('complete_notification_outbox')).toMatchObject({
      requested_status: 'disabled',
    });
    expect(database.rows[0]?.attempts).toBe(0);
    expect(database.rows[0]?.status).toBe('disabled');
  });

  it('never throws when the claim returns no work', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({ clock, user: confirmedUser });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await expect(worker.runOnce(true)).resolves.toBeUndefined();

    expect(database.rpcCalls('claim_notification_outbox')).toHaveLength(1);
    expect(fake.sent).toHaveLength(0);
    expect(worker.state()).toMatchObject({
      notificationsDelivered: 0,
      notificationsFailed: 0,
      lastErrorCode: null,
    });
  });

  it('never throws when the claim answers with an empty payload', async () => {
    const clock = fixedClock('2026-09-19T00:00:00.000Z');
    const database = createFakeDatabase({
      clock,
      user: confirmedUser,
      rows: [outboxRow({})],
      claimReturnsNull: true,
    });
    const fake = createFakeProvider();
    const worker = buildWorker(database, fake.provider, clock);

    await expect(worker.runOnce(true)).resolves.toBeUndefined();

    expect(fake.send).not.toHaveBeenCalled();
    expect(database.rpcCalls('complete_notification_outbox')).toHaveLength(0);
    expect(worker.state().lastErrorCode).toBeNull();
  });
});
