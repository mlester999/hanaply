'use server';

import { profileUpdateSchema } from '@hanaply/auth';
import { HanaplyApiError } from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export interface ProfileFormState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
}

function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

export async function updateProfileAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  await assertTrustedMutationOrigin();
  const parsed = profileUpdateSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    displayName: formData.get('displayName'),
    countryCode: formData.get('countryCode'),
    locale: formData.get('locale'),
    timezone: formData.get('timezone'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Review the highlighted profile fields.',
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).updateMe(parsed.data);
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof HanaplyApiError && error.envelope.error.code === 'RATE_LIMITED'
          ? 'Too many profile updates. Wait before trying again.'
          : 'Your profile could not be updated. Wait a moment and try again.',
      fieldErrors: {},
    };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/settings/profile');
  return { status: 'success', message: 'Your profile was updated.', fieldErrors: {} };
}
