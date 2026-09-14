'use server';

import { notificationPreferencesSchema } from '@hanaply/auth';
import { HanaplyApiError } from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export interface NotificationFormState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

/**
 * Quiet hours are optional, so a blank field means "no quiet hours". Anything
 * that is not a whole number is passed through as NaN, which the shared schema
 * rejects with the message shown to the subscriber.
 */
function quietHour(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export async function updateNotificationPreferencesAction(
  _previousState: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  await assertTrustedMutationOrigin();
  const parsed = notificationPreferencesSchema.safeParse({
    productUpdates: formData.get('productUpdates') === 'on',
    marketingEmails: formData.get('marketingEmails') === 'on',
    jobAlerts: formData.get('jobAlerts') === 'on',
    dailyDigest: formData.get('dailyDigest') === 'on',
    instantAlerts: formData.get('instantAlerts') === 'on',
    weeklyStrategy: formData.get('weeklyStrategy') === 'on',
    quietHoursStart: quietHour(formData.get('quietHoursStart')),
    quietHoursEnd: quietHour(formData.get('quietHoursEnd')),
  });
  if (!parsed.success) {
    // Only the quiet-hours rules are reachable from this form, so their own
    // message is shown instead of a generic failure.
    const quietHoursIssue = parsed.error.issues.find((issue) =>
      ['quietHoursStart', 'quietHoursEnd'].includes(String(issue.path[0])),
    );
    return {
      status: 'error',
      message: quietHoursIssue?.message ?? 'Preferences are invalid.',
    };
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).updatePreferences(parsed.data);
  } catch (error) {
    if (error instanceof HanaplyApiError) {
      const envelope = error.envelope.error;
      // A plan that does not include a category is explained by the API itself,
      // so its message is shown verbatim rather than replaced.
      if (envelope.code === 'ENTITLEMENT_REQUIRED') {
        return { status: 'error', message: envelope.message };
      }
      if (envelope.code === 'RATE_LIMITED') {
        return {
          status: 'error',
          message: 'Too many preference updates. Wait before trying again.',
        };
      }
    }
    return {
      status: 'error',
      message: 'Preferences could not be saved. Wait a moment and try again.',
    };
  }

  revalidatePath('/dashboard/settings/notifications');
  return { status: 'success', message: 'Your optional email preferences were saved.' };
}
