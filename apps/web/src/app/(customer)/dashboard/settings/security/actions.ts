'use server';

import { changePasswordSchema } from '@hanaply/auth';
import { HanaplyApiError } from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { consumeWebRateLimit } from '@/lib/rate-limit';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SecurityActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

export async function changePasswordAction(
  _previousState: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  await assertTrustedMutationOrigin();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    password: formData.get('password'),
    passwordConfirmation: formData.get('passwordConfirmation'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Password is invalid.' };
  }

  const { session } = await requireUser();
  const rateLimit = await consumeWebRateLimit('password_reset', session.userId);
  if (!rateLimit.allowed) {
    return {
      status: 'error',
      message: `Too many password changes. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const user = await supabase.auth.getUser();
  const email = user.data.user?.email;
  if (user.error || !email) {
    return {
      status: 'error',
      message: 'Your identity could not be verified. Sign in again before changing your password.',
    };
  }
  const reauthentication = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
  });
  if (reauthentication.error || reauthentication.data.user.id !== session.userId) {
    return {
      status: 'error',
      message: 'Password was not changed. Check your current password and try again.',
    };
  }
  const update = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (update.error) {
    return {
      status: 'error',
      message: 'Password was not changed. Check your current password and try again.',
    };
  }
  const revocation = await supabase.auth.signOut({ scope: 'others' });
  if (revocation.error) {
    return {
      status: 'error',
      message: 'Password changed, but other sessions could not be revoked. Sign out everywhere.',
    };
  }
  revalidatePath('/dashboard/settings/security');
  return { status: 'success', message: 'Password changed and other sessions were revoked.' };
}

export async function revokeOtherSessionsAction(
  _previousState: SecurityActionState,
  _formData: FormData,
): Promise<SecurityActionState> {
  void _previousState;
  void _formData;
  await assertTrustedMutationOrigin();
  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).revokeOtherSessions();
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof HanaplyApiError && error.envelope.error.code === 'RATE_LIMITED'
          ? 'Too many session actions. Wait before trying again.'
          : 'Other sessions could not be revoked. Wait a moment and try again.',
    };
  }
  revalidatePath('/dashboard/settings/security');
  return { status: 'success', message: 'Every other refresh session was revoked.' };
}
