'use server';

import { forgotPasswordSchema, maskEmail } from '@hanaply/auth';
import { cookies } from 'next/headers';

import { getWebServerEnvironment } from '@/lib/environment';
import { consumeWebRateLimit } from '@/lib/rate-limit';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface VerificationResendState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  retryAfterSeconds: number;
}

export async function resendVerificationAction(
  _previousState: VerificationResendState,
  formData: FormData,
): Promise<VerificationResendState> {
  await assertTrustedMutationOrigin();
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter a valid email address.',
      retryAfterSeconds: 0,
    };
  }

  const rateLimit = await consumeWebRateLimit('verification_resend', parsed.data.email);
  if (!rateLimit.allowed) {
    return {
      status: 'error',
      message: `Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.`,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  const environment = getWebServerEnvironment();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resend({
    type: 'signup',
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${environment.NEXT_PUBLIC_APP_URL}/auth/callback?flow=signup&next=/dashboard`,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set('hanaply-verification-hint', maskEmail(parsed.data.email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/verify-email',
    maxAge: 60 * 60,
  });
  return {
    status: 'success',
    message: 'If verification is still needed, a new email is on its way.',
    retryAfterSeconds: 60,
  };
}
