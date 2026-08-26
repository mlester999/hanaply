import { randomUUID } from 'node:crypto';

import type { WorkerEnvironment } from '@hanaply/config';
import { emailMessageSchema, type EmailMessage, type EmailProvider } from '@hanaply/email';
import { createEmailProvider } from '@hanaply/email';
import { createServiceDatabaseClient, type Database, type Json } from '@hanaply/database';
import { createLogger } from '@hanaply/observability';
import type { SupabaseClient } from '@supabase/supabase-js';

type ClaimedNotification =
  Database['public']['Functions']['claim_payment_notifications']['Returns'][number];
type ClaimedStorageCleanupJob =
  Database['public']['Functions']['claim_storage_cleanup_jobs']['Returns'][number];

export interface PaymentWorkerState {
  running: boolean;
  cycleActive: boolean;
  lastCycleAt: string | null;
  lastMaintenanceAt: string | null;
  lastErrorCode: string | null;
}

function primitiveVariables(value: Json): Record<string, string | number | boolean | null> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('notification_variables_invalid');
  }
  const variables: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean'
    ) {
      variables[key] = entry;
    } else {
      throw new Error('notification_variables_invalid');
    }
  }
  return variables;
}

function displayName(
  profile: {
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null,
): string {
  const combined = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  return profile?.display_name ?? (combined || 'there');
}

export class PaymentMaintenanceWorker {
  private readonly client: SupabaseClient<Database>;
  private readonly provider: EmailProvider;
  private readonly logger;
  private readonly stateValue: PaymentWorkerState = {
    running: false,
    cycleActive: false,
    lastCycleAt: null,
    lastMaintenanceAt: null,
    lastErrorCode: null,
  };
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeCycle: Promise<void> | null = null;
  private lastMaintenanceValue = 0;

  constructor(
    private readonly environment: WorkerEnvironment,
    options: {
      client?: SupabaseClient<Database>;
      provider?: EmailProvider;
    } = {},
  ) {
    this.client =
      options.client ??
      createServiceDatabaseClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
    this.provider = options.provider ?? createEmailProvider(environment);
    this.logger = createLogger({
      service: 'payment-worker',
      environment: environment.HANAPLY_ENV,
      level: environment.LOG_LEVEL,
      pretty: environment.HANAPLY_ENV === 'local',
    });
  }

  state(): Readonly<PaymentWorkerState> {
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
      const now = Date.now();
      if (
        forceMaintenance ||
        now - this.lastMaintenanceValue >= this.environment.WORKER_MAINTENANCE_INTERVAL_MS
      ) {
        await this.runSubscriptionMaintenance(new Date(now).toISOString());
        this.lastMaintenanceValue = now;
        this.stateValue.lastMaintenanceAt = new Date(now).toISOString();
      }
      await this.cleanStorage();
      await this.deliverNotifications();
      this.stateValue.lastCycleAt = new Date().toISOString();
      this.stateValue.lastErrorCode = null;
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 100) : 'unknown_worker_error';
      this.stateValue.lastErrorCode = code;
      this.logger.error({ errorCode: code }, 'Payment maintenance cycle failed');
    } finally {
      this.stateValue.cycleActive = false;
      this.activeCycle = null;
    }
  }

  private async runSubscriptionMaintenance(now: string): Promise<void> {
    for (const days of this.environment.SUBSCRIPTION_EXPIRY_REMINDER_DAYS) {
      const reminder = await this.client.rpc('queue_subscription_expiry_reminders', {
        evaluated_at: now,
        reminder_days: days,
      });
      if (reminder.error) throw new Error('expiry_reminder_queue_failed');
    }
    const expiration = await this.client.rpc('expire_subscriptions', {
      evaluated_at: now,
      action_request_id: randomUUID(),
    });
    if (expiration.error) throw new Error('subscription_expiration_failed');
  }

  private async deliverNotifications(): Promise<void> {
    const claimToken = randomUUID();
    const claimed = await this.client.rpc('claim_payment_notifications', {
      requested_claim_token: claimToken,
      requested_batch_size: this.environment.WORKER_NOTIFICATION_BATCH_SIZE,
    });
    if (claimed.error) throw new Error('notification_claim_failed');
    for (const notification of claimed.data ?? []) {
      await this.deliverNotification(notification, claimToken);
    }
  }

  private async cleanStorage(): Promise<void> {
    const claimToken = randomUUID();
    const claimed = await this.client.rpc('claim_storage_cleanup_jobs', {
      requested_claim_token: claimToken,
      requested_batch_size: this.environment.WORKER_STORAGE_CLEANUP_BATCH_SIZE,
    });
    if (claimed.error) throw new Error('storage_cleanup_claim_failed');
    for (const job of claimed.data ?? []) {
      await this.cleanStorageJob(job, claimToken);
    }
  }

  private async cleanStorageJob(job: ClaimedStorageCleanupJob, claimToken: string): Promise<void> {
    let failure = false;
    try {
      const removed = await this.client.storage.from(job.bucket_id).remove([job.object_path]);
      failure = Boolean(removed.error);
    } catch {
      failure = true;
    }

    const terminal = job.attempts + 1 >= this.environment.WORKER_STORAGE_CLEANUP_MAX_ATTEMPTS;
    if (failure && !terminal) {
      const released = await this.client.rpc('release_storage_cleanup_job', {
        requested_claim_token: claimToken,
        retry_at: new Date(
          Date.now() + Math.min(60_000 * 2 ** job.attempts, 3_600_000),
        ).toISOString(),
        target_job_id: job.id,
      });
      if (released.error || !released.data) throw new Error('storage_cleanup_release_failed');
      return;
    }

    const completed = await this.client.rpc('complete_storage_cleanup_job', {
      requested_claim_token: claimToken,
      requested_error_code: failure ? 'storage_delete_failed' : '',
      requested_status: failure ? 'failed' : 'completed',
      target_job_id: job.id,
    });
    if (completed.error || !completed.data) throw new Error('storage_cleanup_completion_failed');
  }

  private async message(notification: ClaimedNotification): Promise<EmailMessage> {
    const [userResult, profileResult] = await Promise.all([
      this.client.auth.admin.getUserById(notification.user_id),
      this.client
        .from('profiles')
        .select('display_name, first_name, last_name')
        .eq('id', notification.user_id)
        .maybeSingle(),
    ]);
    const recipient = userResult.data.user?.email;
    if (userResult.error || !recipient) throw new Error('notification_recipient_unavailable');
    if (profileResult.error) throw new Error('notification_profile_unavailable');
    return emailMessageSchema.parse({
      recipient,
      templateId: notification.template_id,
      templateVersion: notification.template_version,
      category: 'administrative',
      idempotencyKey: notification.idempotency_key,
      variables: {
        ...primitiveVariables(notification.variables),
        displayName: displayName(profileResult.data),
        actionUrl: new URL('/dashboard/activation', this.environment.APP_BASE_URL).toString(),
      },
    });
  }

  private async complete(
    notification: ClaimedNotification,
    claimToken: string,
    result: {
      status: 'captured' | 'queued' | 'delivered' | 'failed' | 'disabled';
      providerMessageId: string | null;
      failureCode: string | null;
      attempts: number;
    },
  ): Promise<void> {
    const completed = await this.client.rpc('complete_payment_notification', {
      target_notification_id: notification.id,
      requested_claim_token: claimToken,
      requested_status: result.status,
      requested_provider_message_id: result.providerMessageId ?? '',
      requested_failure_code: result.failureCode ?? '',
      requested_attempts: notification.attempts + result.attempts,
    });
    if (completed.error || !completed.data) throw new Error('notification_completion_failed');
  }

  private async release(notification: ClaimedNotification, claimToken: string): Promise<void> {
    const delay = Math.min(60_000 * 2 ** Math.min(notification.attempts, 6), 3_600_000);
    const released = await this.client.rpc('release_payment_notification_claim', {
      target_notification_id: notification.id,
      requested_claim_token: claimToken,
      retry_at: new Date(Date.now() + delay).toISOString(),
    });
    if (released.error || !released.data) throw new Error('notification_release_failed');
  }

  private async deliverNotification(
    notification: ClaimedNotification,
    claimToken: string,
  ): Promise<void> {
    let message: EmailMessage;
    try {
      message = await this.message(notification);
    } catch {
      await this.complete(notification, claimToken, {
        status: 'failed',
        providerMessageId: null,
        failureCode: 'message_validation_failed',
        attempts: 1,
      });
      return;
    }
    try {
      const receipt = await this.provider.send(message);
      await this.complete(notification, claimToken, {
        status: receipt.status,
        providerMessageId: receipt.providerMessageId,
        failureCode: receipt.failureCode,
        attempts: receipt.attempts,
      });
    } catch {
      if (notification.attempts + 1 >= this.environment.WORKER_NOTIFICATION_MAX_ATTEMPTS) {
        await this.complete(notification, claimToken, {
          status: 'failed',
          providerMessageId: null,
          failureCode: 'transport_error',
          attempts: 1,
        });
      } else {
        await this.release(notification, claimToken);
      }
    }
  }
}
