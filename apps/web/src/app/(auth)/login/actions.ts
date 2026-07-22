'use server';

import { loginSchema, sanitizeRedirectPath } from '@hanaply/auth';
import { createApiClient, HanaplyApiError } from '@hanaply/contracts';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getBrowserEnvironment } from '@/lib/environment';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { consumeWebRateLimit } from '@/lib/rate-limit';

export interface LoginState {
  status: 'idle' | 'error' | 'redirect';
  message: string | null;
  redirectTo?: string;
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  await assertTrustedMutationOrigin();
  const email = formData.get('email');
  const password = formData.get('password');
  const requestedRedirect = formData.get('next');
  const adminIntent = formData.get('intent') === 'admin';
  const parsed = loginSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { status: 'error', message: 'Enter your email address and password.' };
  }

  const rateLimit = await consumeWebRateLimit('login', parsed.data.email);
  if (!rateLimit.allowed) {
    return {
      status: 'error',
      message: `Too many sign-in attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.signInWithPassword(parsed.data);
  if (result.error) {
    return {
      status: 'error',
      message: 'We could not sign you in with those details. Check them and try again.',
    };
  }

  const accessToken = result.data.session?.access_token;
  if (!accessToken) {
    return { status: 'error', message: 'Sign in completed without a usable session. Try again.' };
  }

  const statusResult = await supabase
    .from('profiles')
    .select('account_status')
    .eq('id', result.data.user.id)
    .maybeSingle();
  if (statusResult.error || !statusResult.data) {
    await supabase.auth.signOut({ scope: 'local' });
    return {
      status: 'error',
      message: 'Your account could not be verified. Wait a moment and try again.',
    };
  }
  if (statusResult.data.account_status === 'suspended') {
    return { status: 'redirect', message: null, redirectTo: '/account-suspended' };
  }
  if (
    statusResult.data.account_status === 'disabled' ||
    statusResult.data.account_status === 'pending_deletion'
  ) {
    return { status: 'redirect', message: null, redirectTo: '/account-unavailable' };
  }

  try {
    const environment = getBrowserEnvironment();
    const client = createApiClient({
      baseUrl: environment.NEXT_PUBLIC_API_URL,
      getAccessToken: () => Promise.resolve(accessToken),
    });
    await client.me();
    if (adminIntent) await client.adminMe();
  } catch (error) {
    if (error instanceof HanaplyApiError && error.envelope.error.code === 'ACCOUNT_SUSPENDED') {
      return { status: 'redirect', message: null, redirectTo: '/account-suspended' };
    }
    if (adminIntent && error instanceof HanaplyApiError && error.status === 403) {
      await supabase.auth.signOut({ scope: 'local' });
      return {
        status: 'error',
        message: 'Administrator access could not be verified for this account.',
      };
    } else {
      await supabase.auth.signOut({ scope: 'local' });
      return {
        status: 'error',
        message: 'Your session could not be verified. Wait a moment and try again.',
      };
    }
  }

  const auditResult = await supabase.rpc('record_my_auth_event', {
    requested_event_type: adminIntent ? 'admin.login_succeeded' : 'user.login_succeeded',
    requested_request_id: null,
  });
  if (auditResult.error) {
    await supabase.auth.signOut({ scope: 'local' });
    return {
      status: 'error',
      message: 'Your session could not be finalized. Wait a moment and try again.',
    };
  }

  const fallback =
    adminIntent || (typeof requestedRedirect === 'string' && requestedRedirect.startsWith('/admin'))
      ? '/admin'
      : '/dashboard';
  redirect(
    sanitizeRedirectPath(
      typeof requestedRedirect === 'string' ? requestedRedirect : undefined,
      fallback,
    ),
  );
}
