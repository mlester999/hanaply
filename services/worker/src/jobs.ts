import { randomUUID } from 'node:crypto';

import type { WorkerEnvironment } from '@hanaply/config';
import { createServiceDatabaseClient, type Database, type Json } from '@hanaply/database';
import {
  createEmailProvider,
  emailMessageSchema,
  emailTemplateCategory,
  type EmailMessage,
  type EmailProvider,
} from '@hanaply/email';
import {
  getJobSourceAdapter,
  runSourceIngestion,
  type JobSourceAdapter,
  type NormalizedJobInput,
} from '@hanaply/jobs';
import { scoreMatch, type MatchingCareerProfile, type MatchingJob } from '@hanaply/matching';
import { createLogger } from '@hanaply/observability';
import type { SupabaseClient } from '@supabase/supabase-js';

type ScheduledSource = Database['public']['Functions']['job_ingestion_schedule']['Returns'][number];
type MatchingSubject = Database['public']['Functions']['matching_subjects']['Returns'][number];
type ClaimedOpportunityNotification =
  Database['public']['Functions']['claim_notification_outbox']['Returns'][number];

/**
 * Retry pacing for a released notification claim. The delay uses full jitter
 * drawn from [floor, ceiling]: rows that failed together must not retry
 * together, and the ceiling stays far below the one-day bound the database
 * enforces on a scheduled retry.
 */
const notificationRetryBaseMilliseconds = 60_000;
const notificationRetryCeilingMilliseconds = 3_600_000;
const notificationRetryFloorMilliseconds = 5_000;

interface SourceRow {
  id: string;
  code: string;
  status: string;
  config: unknown;
  requires_credentials: boolean;
  credential_env_var: string | null;
  batch_size: number;
}

export interface JobWorkerState {
  running: boolean;
  cycleActive: boolean;
  lastCycleAt: string | null;
  lastIngestionAt: string | null;
  lastMatchingAt: string | null;
  lastFreshnessAt: string | null;
  lastNotificationAt: string | null;
  lastErrorCode: string | null;
  sourcesAttempted: number;
  jobsCreated: number;
  profilesScored: number;
  notificationsQueued: number;
  notificationsDelivered: number;
  notificationsFailed: number;
}

export interface JobWorkerOptions {
  client?: SupabaseClient<Database>;
  provider?: EmailProvider;
  adapters?: (code: string) => JobSourceAdapter | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  random?: () => number;
}

/**
 * Background job intelligence worker.
 *
 * Four bounded, independent cycles run on one timer:
 *
 *   1. Ingestion asks `job_ingestion_schedule()` which sources are due, takes a
 *      per-source lock, and runs the shared adapter once. One scan serves every
 *      subscriber; plan cadence only decides how often the shared scan runs.
 *   2. Match computation asks `matching_subjects()` for a batch of profiles with
 *      stale results, scores a bounded candidate set with the deterministic
 *      engine, and stores explainable results including their evidence.
 *   3. Freshness ages unobserved postings to stale and then expired so the feed
 *      cannot be dominated by listings that are gone.
 *   4. Notification delivery queues consented opportunity messages, then claims
 *      a bounded batch from `notification_outbox`, renders it, and completes or
 *      releases each row. Queueing happens inside the database, which requires
 *      both the subscriber's consent and their plan entitlement, so this cycle
 *      can only deliver what a subscriber already asked to receive.
 *
 * Every cycle is idempotent: a repeated run re-derives the same work from the
 * database, and a partially completed run is simply picked up again.
 */
export class JobIntelligenceWorker {
  private readonly client: SupabaseClient<Database>;
  private readonly provider: EmailProvider;
  private readonly logger;
  private readonly resolveAdapter: (code: string) => JobSourceAdapter | undefined;
  private readonly fetchImplementation: typeof fetch;
  private readonly clock: () => Date;
  private readonly random: () => number;
  private readonly workerId = `worker-${randomUUID()}`;
  private readonly stateValue: JobWorkerState = {
    running: false,
    cycleActive: false,
    lastCycleAt: null,
    lastIngestionAt: null,
    lastMatchingAt: null,
    lastFreshnessAt: null,
    lastNotificationAt: null,
    lastErrorCode: null,
    sourcesAttempted: 0,
    jobsCreated: 0,
    profilesScored: 0,
    notificationsQueued: 0,
    notificationsDelivered: 0,
    notificationsFailed: 0,
  };
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeCycle: Promise<void> | null = null;
  private lastFreshnessValue = 0;
  private lastDigestQueueValue = 0;

  constructor(
    private readonly environment: WorkerEnvironment,
    options: JobWorkerOptions = {},
  ) {
    this.client =
      options.client ??
      createServiceDatabaseClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
    this.provider = options.provider ?? createEmailProvider(environment);
    this.resolveAdapter = options.adapters ?? ((code) => getJobSourceAdapter(code) ?? undefined);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.clock = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.logger = createLogger({
      service: 'job-worker',
      environment: environment.HANAPLY_ENV,
      level: environment.LOG_LEVEL,
      pretty: environment.HANAPLY_ENV === 'local',
    });
  }

  state(): Readonly<JobWorkerState> {
    return { ...this.stateValue };
  }

  start(): void {
    if (this.stateValue.running) return;
    this.stateValue.running = true;
    this.activeCycle = this.runOnce(true);
    this.timer = setInterval(() => {
      this.activeCycle ??= this.runOnce(false);
    }, this.environment.WORKER_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stateValue.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeCycle;
  }

  async runOnce(forceMaintenance = false): Promise<void> {
    if (this.stateValue.cycleActive) return;
    this.stateValue.cycleActive = true;
    try {
      await this.runIngestionCycle();
      await this.runMatchingCycle();

      const now = this.clock().getTime();
      if (
        forceMaintenance ||
        now - this.lastFreshnessValue >= this.environment.WORKER_MAINTENANCE_INTERVAL_MS
      ) {
        await this.runFreshnessCycle();
        this.lastFreshnessValue = now;
        this.stateValue.lastFreshnessAt = new Date(now).toISOString();
      }

      // Runs after matching so an alert can include the matches this cycle just
      // produced, and on every poll so a queued message is never left waiting
      // for a maintenance interval.
      await this.runNotificationCycle(forceMaintenance);

      this.stateValue.lastCycleAt = new Date().toISOString();
      this.stateValue.lastErrorCode = null;
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 100) : 'unknown_worker_error';
      this.stateValue.lastErrorCode = code;
      this.logger.error({ errorCode: code }, 'Job intelligence cycle failed');
    } finally {
      this.stateValue.cycleActive = false;
      this.activeCycle = null;
    }
  }

  // -------------------------------------------------------------------------
  // Ingestion
  // -------------------------------------------------------------------------

  private async runIngestionCycle(): Promise<void> {
    const schedule = await this.client.rpc('job_ingestion_schedule');
    if (schedule.error) {
      throw new Error('ingestion_schedule_unavailable');
    }

    const due = (schedule.data ?? []).filter((entry: ScheduledSource) => entry.due);
    this.stateValue.sourcesAttempted = due.length;

    for (const entry of due) {
      // Sequential by design: provider rate limits are per provider, and a
      // shared worker must not open unbounded parallel provider calls.
      await this.ingestSource(entry);
    }

    this.stateValue.lastIngestionAt = new Date().toISOString();
  }

  private async ingestSource(entry: ScheduledSource): Promise<void> {
    const source = await this.loadSource(entry.source_id);
    if (!source) return;

    const adapter = this.resolveAdapter(source.code);
    if (!adapter) {
      this.logger.warn({ sourceCode: source.code }, 'No adapter is registered for this source');
      return;
    }

    const lockKey = `ingest.${source.code}`;
    const acquired = await this.client.rpc('acquire_ingestion_lock', {
      requested_lock_key: lockKey,
      requested_holder: this.workerId,
      ttl_seconds: 900,
    });
    if (acquired.error || !acquired.data) {
      // Another worker owns this source. Skipping is the correct outcome, not a
      // failure: overlapping scans are exactly what the lock prevents.
      return;
    }

    const run = await this.client.rpc('start_ingestion_run', {
      target_source_id: source.id,
      requested_trigger: 'schedule',
      action_request_id: randomUUID(),
    });
    if (run.error || !run.data) {
      await this.releaseLock(lockKey);
      return;
    }

    try {
      const result = await runSourceIngestion({
        adapter,
        context: {
          fetch: this.fetchImplementation,
          credentials: this.credentialsFor(source),
          limit: source.batch_size,
          now: this.clock(),
          userAgent: this.environment.JOB_INGESTION_USER_AGENT,
          timeoutMs: this.environment.JOB_INGESTION_TIMEOUT_MS,
          config: isRecord(source.config) ? source.config : {},
        },
        sink: { upsertJob: (input: NormalizedJobInput) => this.persistJob(source.id, input) },
        limit: source.batch_size,
      });

      await this.client.rpc('complete_ingestion_run', {
        target_run_id: run.data,
        outcome: {
          // A posting the normalizer could not represent, or a single write that
          // failed, makes the run partial rather than successful: the operator
          // needs to see that some of the source was not stored.
          status: result.errors.length > 0 || result.rejected > 0 ? 'partial' : 'succeeded',
          fetchedCount: result.fetched,
          createdCount: result.created,
          updatedCount: result.updated,
          mergedCount: result.merged,
          skippedCount: result.skipped,
          rejectedCount: result.rejected,
        },
      });

      this.stateValue.jobsCreated += result.created;
      this.logger.info(
        {
          sourceCode: source.code,
          fetched: result.fetched,
          created: result.created,
          merged: result.merged,
          rejected: result.rejected,
        },
        'Source ingestion completed',
      );
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 80) : 'ingestion_failed';
      await this.client.rpc('complete_ingestion_run', {
        target_run_id: run.data,
        outcome: { status: 'failed', errorCode: code },
      });
      this.logger.error({ sourceCode: source.code, errorCode: code }, 'Source ingestion failed');
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private async loadSource(sourceId: string): Promise<SourceRow | null> {
    const { data, error } = await this.client
      .from('job_sources')
      .select('id, code, status, config, requires_credentials, credential_env_var, batch_size')
      .eq('id', sourceId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  }

  private credentialsFor(source: SourceRow): Record<string, string> {
    if (!source.requires_credentials || !source.credential_env_var) return {};
    // Only the variable name is stored in the database; the secret itself comes
    // from the process environment and is never persisted or logged.
    const value = process.env[source.credential_env_var];
    return value ? { [source.credential_env_var]: value } : {};
  }

  private async persistJob(sourceId: string, input: NormalizedJobInput) {
    const { data, error } = await this.client.rpc('upsert_ingested_job', {
      target_source_id: sourceId,
      job_input: input as unknown as Json,
      action_request_id: randomUUID(),
    });
    if (error || !data) {
      throw new Error(error?.code ?? 'ingest_write_failed');
    }
    const outcome = data as {
      jobId?: string;
      created?: boolean;
      merged?: boolean;
      matchedBy?: string;
    };
    return {
      jobId: outcome.jobId ?? '',
      created: outcome.created === true,
      merged: outcome.merged === true,
      matchedBy: outcome.matchedBy ?? 'created',
    };
  }

  private async releaseLock(lockKey: string): Promise<void> {
    await this.client.rpc('release_ingestion_lock', {
      requested_lock_key: lockKey,
      requested_holder: this.workerId,
    });
  }

  // -------------------------------------------------------------------------
  // Match computation
  // -------------------------------------------------------------------------

  private async runMatchingCycle(): Promise<void> {
    const subjects = await this.client.rpc('matching_subjects', {
      batch_size: this.environment.MATCHING_BATCH_SIZE,
      stale_after_hours: this.environment.MATCHING_STALE_AFTER_HOURS,
    });
    if (subjects.error) {
      throw new Error('matching_subjects_unavailable');
    }

    for (const subject of subjects.data ?? []) {
      await this.scoreSubject(subject);
    }

    this.stateValue.lastMatchingAt = new Date().toISOString();
  }

  private async scoreSubject(subject: MatchingSubject): Promise<void> {
    const detail = await this.client.rpc('career_profile_detail', {
      actor_user_id: subject.user_id,
      target_profile_id: subject.career_profile_id,
    });
    const evidence = await this.client.rpc('confirmed_career_evidence', {
      actor_user_id: subject.user_id,
      target_profile_id: subject.career_profile_id,
    });
    if (detail.error || !detail.data || evidence.error || !evidence.data) return;

    const profile = toMatchingProfile(
      detail.data as Record<string, unknown>,
      subject.career_profile_id,
    );
    const evidenceData = evidence.data as { facts?: readonly { id: string }[] };
    const evidenceFactIds = (evidenceData.facts ?? []).map((fact) => fact.id);

    const candidates = await this.client.rpc('matching_job_candidates', {
      actor_user_id: subject.user_id,
      target_career_profile_id: subject.career_profile_id,
      batch_size: this.environment.MATCHING_CANDIDATE_LIMIT,
    });
    if (candidates.error || !candidates.data) return;

    const items = ((candidates.data as { items?: readonly MatchingJob[] }).items ?? []).slice(
      0,
      this.environment.MATCHING_CANDIDATE_LIMIT,
    );
    if (items.length === 0) return;

    const now = this.clock();
    const results = items.map((job) => {
      const result = scoreMatch(profile, job, {
        now,
        evidenceFactIds,
        confirmedFactCount: evidenceFactIds.length,
      });
      return {
        jobId: job.id,
        score: result.score,
        verdict: result.verdict,
        confidence: result.confidence,
        modelVersion: result.modelVersion,
        dimensions: result.dimensions,
        strengths: result.strengths,
        gaps: result.gaps,
        blockers: result.blockers,
        rejectionRisks: result.rejectionRisks,
        requirementMapping: result.requirementMapping,
        recommendedAction: result.recommendedAction,
        evidenceFactIds: result.evidenceFactIds,
        dataQuality: result.dataQuality,
      };
    });

    const stored = await this.client.rpc('record_job_matches', {
      actor_user_id: subject.user_id,
      match_input: {
        careerProfileId: subject.career_profile_id,
        items: results,
      } as unknown as Json,
      action_request_id: randomUUID(),
    });
    if (stored.error) {
      this.logger.warn(
        { profileId: subject.career_profile_id, errorCode: stored.error.code },
        'Match results could not be stored',
      );
      return;
    }
    this.stateValue.profilesScored += 1;
  }

  // -------------------------------------------------------------------------
  // Freshness
  // -------------------------------------------------------------------------

  private async runFreshnessCycle(): Promise<void> {
    const { data, error } = await this.client.rpc('refresh_job_freshness', {
      evaluated_at: this.clock().toISOString(),
      stale_after_hours: this.environment.JOB_STALE_AFTER_HOURS,
      expire_after_hours: this.environment.JOB_EXPIRE_AFTER_HOURS,
    });
    if (error || !data) {
      throw new Error('freshness_refresh_failed');
    }
    this.logger.info(data as Record<string, unknown>, 'Job freshness refreshed');
  }

  // -------------------------------------------------------------------------
  // Opportunity notification delivery
  // -------------------------------------------------------------------------

  /**
   * Queues consented messages and then delivers a bounded batch of them.
   *
   * Queueing is delegated to the database so consent and entitlement are
   * evaluated next to the data they depend on, and the unique idempotency key
   * makes a repeated pass a no-op. A digest is queued at most once per
   * maintenance interval because it is a once-a-day message whose own key
   * already collapses repeats; polling it every few seconds would only add
   * pointless work.
   */
  private async runNotificationCycle(forceMaintenance: boolean): Promise<void> {
    const now = this.clock();
    await this.queueOpportunityNotifications(now, forceMaintenance);
    await this.deliverNotificationOutbox();
    this.stateValue.lastNotificationAt = this.clock().toISOString();
    this.logger.info(
      {
        notificationsQueued: this.stateValue.notificationsQueued,
        notificationsDelivered: this.stateValue.notificationsDelivered,
        notificationsFailed: this.stateValue.notificationsFailed,
      },
      'Opportunity notifications processed',
    );
  }

  private async queueOpportunityNotifications(now: Date, forceDigest: boolean): Promise<void> {
    const alerts = await this.client.rpc('queue_job_alert_notifications', {
      evaluated_at: now.toISOString(),
      window_minutes: this.environment.JOB_ALERT_WINDOW_MINUTES,
      minimum_score: this.environment.JOB_ALERT_MINIMUM_SCORE,
      batch_size: this.environment.NOTIFICATION_BATCH_SIZE,
    });
    if (alerts.error) throw new Error('job_alert_queue_failed');
    this.stateValue.notificationsQueued += queuedNotificationCount(alerts.data);

    const currentTime = now.getTime();
    if (
      !forceDigest &&
      currentTime - this.lastDigestQueueValue < this.environment.WORKER_MAINTENANCE_INTERVAL_MS
    ) {
      return;
    }

    const digest = await this.client.rpc('queue_job_digest_notifications', {
      evaluated_at: now.toISOString(),
      minimum_score: this.environment.DIGEST_MINIMUM_SCORE,
      batch_size: this.environment.NOTIFICATION_BATCH_SIZE,
    });
    if (digest.error) throw new Error('job_digest_queue_failed');
    this.stateValue.notificationsQueued += queuedNotificationCount(digest.data);
    this.lastDigestQueueValue = currentTime;
  }

  private async deliverNotificationOutbox(): Promise<void> {
    const claimToken = randomUUID();
    const claimed = await this.client.rpc('claim_notification_outbox', {
      requested_claim_token: claimToken,
      requested_batch_size: this.environment.NOTIFICATION_BATCH_SIZE,
    });
    if (claimed.error) throw new Error('notification_claim_failed');
    for (const notification of claimed.data ?? []) {
      await this.deliverNotification(notification, claimToken);
    }
  }

  private async deliverNotification(
    notification: ClaimedOpportunityNotification,
    claimToken: string,
  ): Promise<void> {
    let recipient: string | null;
    try {
      recipient = await this.notificationRecipient(notification.user_id);
    } catch {
      // The address could not be resolved at all, which is a transient lookup
      // problem rather than a decision about the subscriber.
      await this.retryOrFailNotification(notification, claimToken);
      return;
    }

    if (recipient === null) {
      // Nobody can deliver mail to an unconfirmed address, so the row is closed
      // as disabled instead of being retried until the attempt cap.
      await this.completeNotification(notification, claimToken, {
        status: 'disabled',
        providerMessageId: null,
        failureCode: null,
        attempts: 0,
      });
      return;
    }

    let message: EmailMessage;
    try {
      message = this.notificationMessage(notification, recipient);
    } catch {
      // A message that cannot be built from the stored row will never become
      // valid by waiting, so it fails immediately with a short code.
      await this.completeNotification(notification, claimToken, {
        status: 'failed',
        providerMessageId: null,
        failureCode: 'message_validation_failed',
        attempts: 1,
      });
      this.stateValue.notificationsFailed += 1;
      return;
    }

    try {
      const receipt = await this.provider.send(message);
      if (receipt.status === 'failed') {
        await this.completeNotification(notification, claimToken, {
          status: 'failed',
          providerMessageId: receipt.providerMessageId,
          failureCode: receipt.failureCode ?? 'provider_rejected',
          attempts: receipt.attempts,
        });
        this.stateValue.notificationsFailed += 1;
        return;
      }
      const delivered = receipt.status !== 'disabled';
      await this.completeNotification(notification, claimToken, {
        status: delivered ? 'delivered' : 'disabled',
        providerMessageId: receipt.providerMessageId,
        failureCode: receipt.failureCode,
        attempts: receipt.attempts,
      });
      if (delivered) this.stateValue.notificationsDelivered += 1;
    } catch {
      await this.retryOrFailNotification(notification, claimToken);
    }
  }

  private async notificationRecipient(userId: string): Promise<string | null> {
    const result = await this.client.auth.admin.getUserById(userId);
    if (result.error) throw new Error('notification_recipient_unavailable');
    const user = result.data.user;
    const confirmedAt = user?.email_confirmed_at ?? user?.confirmed_at ?? null;
    const email = user?.email;
    if (!email || !confirmedAt) return null;
    return email;
  }

  private notificationMessage(
    notification: ClaimedOpportunityNotification,
    recipient: string,
  ): EmailMessage {
    const category = emailTemplateCategory(notification.template_id);
    if (!category) throw new Error('notification_template_unsupported');
    return emailMessageSchema.parse({
      recipient,
      templateId: notification.template_id,
      templateVersion: notification.template_version,
      category,
      // The outbox key travels with the message, so a retry after a crash sends
      // the provider the same idempotency key and cannot double-send.
      idempotencyKey: notification.idempotency_key,
      variables: {
        ...notificationOutboxVariables(notification.variables),
        // The action always points at the radar on our own origin. A raw job or
        // apply URL is never a redirect target, so a listing cannot move a
        // reader off Hanaply from inside an email.
        radarUrl: new URL('/dashboard/radar', this.environment.APP_BASE_URL).toString(),
      },
    });
  }

  private async completeNotification(
    notification: ClaimedOpportunityNotification,
    claimToken: string,
    result: {
      status: 'delivered' | 'failed' | 'disabled';
      providerMessageId: string | null;
      failureCode: string | null;
      attempts: number;
    },
  ): Promise<void> {
    const completed = await this.client.rpc('complete_notification_outbox', {
      target_notification_id: notification.id,
      requested_claim_token: claimToken,
      requested_status: result.status,
      requested_provider_message_id: result.providerMessageId ?? '',
      requested_failure_code: result.failureCode ?? '',
      requested_attempts: notification.attempts + result.attempts,
    });
    if (completed.error || !completed.data) throw new Error('notification_completion_failed');
  }

  private async retryOrFailNotification(
    notification: ClaimedOpportunityNotification,
    claimToken: string,
  ): Promise<void> {
    if (notification.attempts + 1 >= this.environment.WORKER_NOTIFICATION_MAX_ATTEMPTS) {
      await this.completeNotification(notification, claimToken, {
        status: 'failed',
        providerMessageId: null,
        failureCode: 'transport_error',
        attempts: 1,
      });
      this.stateValue.notificationsFailed += 1;
      return;
    }
    await this.releaseNotification(notification, claimToken);
  }

  private async releaseNotification(
    notification: ClaimedOpportunityNotification,
    claimToken: string,
  ): Promise<void> {
    const ceiling = Math.min(
      notificationRetryBaseMilliseconds * 2 ** Math.min(notification.attempts, 8),
      notificationRetryCeilingMilliseconds,
    );
    const delay = Math.max(Math.floor(this.random() * ceiling), notificationRetryFloorMilliseconds);
    const released = await this.client.rpc('release_notification_outbox', {
      target_notification_id: notification.id,
      requested_claim_token: claimToken,
      retry_at: new Date(this.clock().getTime() + delay).toISOString(),
    });
    if (released.error || !released.data) throw new Error('notification_release_failed');
  }
}

/**
 * The outbox stores variables as JSON so the queueing function can build a
 * message without a schema migration. The email schema validates every value
 * before a template reads it; this only rejects a row that is not an object.
 */
function notificationOutboxVariables(value: Json): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('notification_variables_invalid');
  }
  return { ...value };
}

/** The queueing functions return the number of rows they inserted. */
function queuedNotificationCount(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the engine's profile view from the career detail read model. Only
 * structured, owner-entered or confirmed data is passed through: nothing is
 * inferred here, so the engine cannot score against an invented attribute.
 */
function toMatchingProfile(
  detail: Record<string, unknown>,
  profileId: string,
): MatchingCareerProfile {
  const salary = detail.salaryExpectation as
    { minMinor?: number; maxMinor?: number; currency?: string; period?: string } | null | undefined;
  return {
    id: profileId,
    version: typeof detail.version === 'number' ? detail.version : 0,
    headline: asText(detail.headline),
    summary: asText(detail.summary),
    currentRoleTitle: asText(detail.currentRoleTitle),
    careerLevel: asText(detail.careerLevel) as MatchingCareerProfile['careerLevel'],
    yearsExperience: typeof detail.yearsExperience === 'number' ? detail.yearsExperience : null,
    industries: asTextArray(detail.industries),
    targetRoleTitles: asTextArray(detail.targetRoleTitles),
    excludedRoleTitles: asTextArray(detail.excludedRoleTitles),
    preferredEmploymentTypes: asTextArray(
      detail.preferredEmploymentTypes,
    ) as MatchingCareerProfile['preferredEmploymentTypes'],
    preferredWorkArrangement: asText(
      detail.preferredWorkArrangement,
    ) as MatchingCareerProfile['preferredWorkArrangement'],
    preferredLocations: asTextArray(detail.preferredLocations),
    openToInternational: detail.openToInternational === true,
    openToRelocation: detail.openToRelocation === true,
    salaryMinMinor: typeof salary?.minMinor === 'number' ? salary.minMinor : null,
    salaryMaxMinor: typeof salary?.maxMinor === 'number' ? salary.maxMinor : null,
    salaryCurrency: asText(salary?.currency),
    salaryPeriod: asText(salary?.period) as MatchingCareerProfile['salaryPeriod'],
    skills: (Array.isArray(detail.skills) ? detail.skills : []).flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const name = asText(entry.name);
      if (!name) return [];
      return [
        {
          name,
          skillKind: asText(entry.skillKind) ?? 'skill',
          isPrimary: entry.isPrimary === true,
          proficiency: asText(entry.proficiency),
        },
      ];
    }),
    employment: (Array.isArray(detail.employment) ? detail.employment : []).flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const roleTitle = asText(entry.roleTitle);
      const companyName = asText(entry.companyName);
      if (!roleTitle || !companyName) return [];
      return [
        {
          roleTitle,
          companyName,
          isCurrent: entry.isCurrent === true,
          startDate: asText(entry.startDate) ?? '1970-01-01',
          endDate: asText(entry.endDate),
          skills: asTextArray(entry.skills),
          highlights: asTextArray(entry.highlights),
        },
      ];
    }),
  };
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}
