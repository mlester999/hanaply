'use server';

import { forgotPasswordSchema } from '@hanaply/auth';

import { getWebServerEnvironment } from '@/lib/environment';
import { consumeWebRateLimit } from '@/lib/rate-limit';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ForgotPasswordState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

export async function forgotPasswordAction(
  _previousState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  await assertTrustedMutationOrigin();
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: 'Enter a valid email address.' };
  }

  const rateLimit = await consumeWebRateLimit('password_recovery', parsed.data.email);
  if (!rateLimit.allowed) {
    return {
      status: 'error',
      message: `Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.`,
    };
  }

  const environment = getWebServerEnvironment();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${environment.NEXT_PUBLIC_APP_URL}/auth/callback?flow=recovery&next=/reset-password`,
  });

  return {
    status: 'success',
    message: 'If an account exists for that email, we sent password reset instructions.',
  };
}
