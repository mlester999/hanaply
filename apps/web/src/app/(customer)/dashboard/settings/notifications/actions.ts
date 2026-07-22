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

export async function updateNotificationPreferencesAction(
  _previousState: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  await assertTrustedMutationOrigin();
  const parsed = notificationPreferencesSchema.safeParse({
    productUpdates: formData.get('productUpdates') === 'on',
    marketingEmails: formData.get('marketingEmails') === 'on',
  });
  if (!parsed.success) return { status: 'error', message: 'Preferences are invalid.' };

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).updatePreferences(parsed.data);
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof HanaplyApiError && error.envelope.error.code === 'RATE_LIMITED'
          ? 'Too many preference updates. Wait before trying again.'
          : 'Preferences could not be saved. Wait a moment and try again.',
    };
  }

  revalidatePath('/dashboard/settings/notifications');
  return { status: 'success', message: 'Your optional email preferences were saved.' };
}
