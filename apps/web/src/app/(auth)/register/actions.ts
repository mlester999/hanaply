'use server';

import { legalPolicyVersions, maskEmail, registrationSchema } from '@hanaply/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getWebServerEnvironment } from '@/lib/environment';
import { consumeWebRateLimit } from '@/lib/rate-limit';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface RegistrationState {
  status: 'idle' | 'error';
  message: string | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on';
}

function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

export async function registerAction(
  _previousState: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  await assertTrustedMutationOrigin();
  const parsed = registrationSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    password: formData.get('password'),
    passwordConfirmation: formData.get('passwordConfirmation'),
    termsAccepted: checkbox(formData, 'termsAccepted'),
    privacyAccepted: checkbox(formData, 'privacyAccepted'),
    marketingConsent: checkbox(formData, 'marketingConsent'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Review the highlighted fields and try again.',
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  }

  const rateLimit = await consumeWebRateLimit('registration', parsed.data.email);
  if (!rateLimit.allowed) {
    return {
      status: 'error',
      message: `Too many registration attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
      fieldErrors: {},
    };
  }

  const environment = getWebServerEnvironment();
  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${environment.NEXT_PUBLIC_APP_URL}/auth/callback?flow=signup&next=/dashboard`,
      data: {
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
        display_name: `${parsed.data.firstName} ${parsed.data.lastName}`,
        terms_accepted: true,
        terms_version: legalPolicyVersions.terms,
        privacy_accepted: true,
        privacy_version: legalPolicyVersions.privacy,
        marketing_consent: parsed.data.marketingConsent,
      },
    },
  });

  if (result.error && (result.error.status ?? 500) >= 500) {
    return {
      status: 'error',
      message: 'Registration is temporarily unavailable. Wait a moment and try again.',
      fieldErrors: {},
    };
  }

  const cookieStore = await cookies();
  cookieStore.set('hanaply-verification-hint', maskEmail(parsed.data.email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/verify-email',
    maxAge: 60 * 60,
  });
  redirect('/verify-email?registered=1');
}
