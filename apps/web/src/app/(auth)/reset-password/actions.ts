'use server';

import { passwordUpdateSchema } from '@hanaply/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { consumeWebRateLimit } from '@/lib/rate-limit';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ResetPasswordState {
  status: 'idle' | 'error';
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

export async function resetPasswordAction(
  _previousState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  await assertTrustedMutationOrigin();
  const cookieStore = await cookies();
  if (cookieStore.get('hanaply-recovery-flow')?.value !== 'verified') {
    return {
      status: 'error',
      message: 'This recovery session is invalid or expired. Request a new reset link.',
      fieldErrors: {},
    };
  }

  const parsed = passwordUpdateSchema.safeParse({
    password: formData.get('password'),
    passwordConfirmation: formData.get('passwordConfirmation'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Review the password fields and try again.',
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  }

  const supabase = await createSupabaseServerClient();
  const claims = await supabase.auth.getClaims();
  const userId = claims.data?.claims.sub;
  if (!userId) {
    return {
      status: 'error',
      message: 'This recovery session is invalid or expired. Request a new reset link.',
      fieldErrors: {},
    };
  }

  const rateLimit = await consumeWebRateLimit('password_reset', userId);
  if (!rateLimit.allowed) {
    return {
      status: 'error',
      message: `Too many reset attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
      fieldErrors: {},
    };
  }

  const update = await supabase.auth.updateUser({ password: parsed.data.password });
  if (update.error) {
    return {
      status: 'error',
      message: 'Your password could not be updated. Request a new reset link and try again.',
      fieldErrors: {},
    };
  }

  cookieStore.delete('hanaply-recovery-flow');
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login?password=changed');
}
