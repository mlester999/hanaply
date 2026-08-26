import { parseWorkerEnvironment } from '@hanaply/config';
import type { DatabaseClient, Json } from '@hanaply/database';
import type { EmailDeliveryReceipt, EmailMessage, EmailProvider } from '@hanaply/email';
import { describe, expect, it, vi } from 'vitest';

import { PaymentMaintenanceWorker } from '../../services/worker/src/payments.js';

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
  SUBSCRIPTION_EXPIRY_REMINDER_DAYS: '7,1',
});

const notification = {
  id: '81000000-0000-4000-8000-000000000001',
  user_id: '81000000-0000-4000-8000-000000000002',
  payment_submission_id: '81000000-0000-4000-8000-000000000003',
  subscription_id: '81000000-0000-4000-8000-000000000004',
  template_id: 'payment-approved',
  template_version: 'v1',
  idempotency_key: 'payment:81000000-0000-4000-8000-000000000003:approved:4',
  variables: {
    planCode: 'plus_monthly',
    amountMinor: 49_900,
    currency: 'PHP',
    subscriptionEndsAt: '2026-08-28T04:00:00.000Z',
  } satisfies Json,
  attempts: 0,
};

function databaseFixture(
  options: {
    cleanupJobs?: readonly {
      id: string;
      bucket_id: string;
      object_path: string;
      attempts: number;
    }[];
    includeNotification?: boolean;
    notificationAttempts?: number;
  } = {},
) {
  let claimCount = 0;
  const claimedNotification = {
    ...notification,
    attempts: options.notificationAttempts ?? notification.attempts,
  };
  const rpc = vi.fn((name: string) => {
    if (name === 'claim_payment_notifications') {
      claimCount += 1;
      return {
        data:
          options.includeNotification === false && claimCount === 1
            ? []
            : claimCount === 1
              ? [claimedNotification]
              : [],
        error: null,
      };
    }
    if (name === 'claim_storage_cleanup_jobs') {
      return { data: options.cleanupJobs ?? [], error: null };
    }
    if (name === 'complete_payment_notification' || name === 'release_payment_notification_claim') {
      return { data: true, error: null };
    }
    return { data: 0, error: null };
  });
  const storageRemove = vi.fn(() => Promise.resolve({ data: [], error: null }));
  const client = {
    rpc,
    auth: {
      admin: {
        getUserById: vi.fn(() => ({
          data: { user: { email: 'worker.member@example.test' } },
          error: null,
        })),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => ({
            data: { display_name: 'Mika Santos', first_name: 'Mika', last_name: 'Santos' },
            error: null,
          })),
        })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({ remove: storageRemove })),
    },
  };
  return { client: client as unknown as DatabaseClient, rpc, storageRemove };
}

describe('payment maintenance worker', () => {
  it('delivers a claimed notification and records the provider result', async () => {
    const database = databaseFixture();
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = {
      send: vi.fn((message: EmailMessage): Promise<EmailDeliveryReceipt> => {
        sent.push(message);
        return Promise.resolve({
          provider: 'capture',
          status: 'captured',
          providerMessageId: null,
          templateId: message.templateId,
          templateVersion: 'v1',
          recipientMasked: 'wo****@example.test',
          attempts: 1,
          failureCode: null,
        });
      }),
    };
    const worker = new PaymentMaintenanceWorker(environment, {
      client: database.client,
      provider,
    });
    await worker.runOnce(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipient: 'worker.member@example.test',
      templateId: 'payment-approved',
      category: 'administrative',
      idempotencyKey: notification.idempotency_key,
    });
    expect(sent[0]?.variables).toMatchObject({
      displayName: 'Mika Santos',
      actionUrl: 'http://localhost:3100/dashboard/activation',
    });
    expect(database.rpc).toHaveBeenCalledWith(
      'complete_payment_notification',
      expect.objectContaining({ requested_status: 'captured', requested_attempts: 1 }),
    );
    expect(worker.state()).toMatchObject({ lastErrorCode: null, cycleActive: false });
  });

  it('releases the database claim when a provider throws unexpectedly', async () => {
    const database = databaseFixture();
    const provider: EmailProvider = {
      send: vi.fn(() => Promise.reject(new Error('temporary transport failure'))),
    };
    const worker = new PaymentMaintenanceWorker(environment, {
      client: database.client,
      provider,
    });
    await worker.runOnce(true);
    expect(database.rpc).toHaveBeenCalledWith(
      'release_payment_notification_claim',
      expect.objectContaining({ target_notification_id: notification.id }),
    );
    expect(database.rpc).not.toHaveBeenCalledWith(
      'complete_payment_notification',
      expect.anything(),
    );
  });

  it('deletes queued private objects and completes the cleanup claim', async () => {
    const database = databaseFixture({
      cleanupJobs: [
        {
          id: '81000000-0000-4000-8000-000000000010',
          bucket_id: 'payment-proofs',
          object_path: '81000000-0000-4000-8000-000000000002/old-proof.png',
          attempts: 0,
        },
      ],
      includeNotification: false,
    });
    const worker = new PaymentMaintenanceWorker(environment, { client: database.client });

    await worker.runOnce(true);

    expect(database.storageRemove).toHaveBeenCalledWith([
      '81000000-0000-4000-8000-000000000002/old-proof.png',
    ]);
    expect(database.rpc).toHaveBeenCalledWith(
      'complete_storage_cleanup_job',
      expect.objectContaining({ requested_status: 'completed' }),
    );
  });

  it('dead-letters repeated notification transport failures after the configured limit', async () => {
    const database = databaseFixture({
      notificationAttempts: environment.WORKER_NOTIFICATION_MAX_ATTEMPTS - 1,
    });
    const provider: EmailProvider = {
      send: vi.fn(() => Promise.reject(new Error('temporary transport failure'))),
    };
    const worker = new PaymentMaintenanceWorker(environment, {
      client: database.client,
      provider,
    });

    await worker.runOnce(true);

    expect(database.rpc).toHaveBeenCalledWith(
      'complete_payment_notification',
      expect.objectContaining({ requested_status: 'failed', requested_attempts: 5 }),
    );
    expect(database.rpc).not.toHaveBeenCalledWith(
      'release_payment_notification_claim',
      expect.anything(),
    );
  });
});
