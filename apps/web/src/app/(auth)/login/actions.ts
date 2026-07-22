'use server';

import { sanitizeRedirectPath } from '@hanaply/auth';
import { createApiClient, HanaplyApiError } from '@hanaply/contracts';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getBrowserEnvironment } from '@/lib/environment';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';

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
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return { status: 'error', message: 'Enter your email address and password.' };
  }

  const supabase = await createSupabaseServerClient();
  const result = await supabase.auth.signInWithPassword({ email, password });
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

  let suspended = false;
  try {
    const environment = getBrowserEnvironment();
    const client = createApiClient({
      baseUrl: environment.NEXT_PUBLIC_API_URL,
      getAccessToken: () => Promise.resolve(accessToken),
    });
    await client.me();
  } catch (error) {
    if (error instanceof HanaplyApiError && error.envelope.error.code === 'ACCOUNT_SUSPENDED') {
      suspended = true;
    } else {
      await supabase.auth.signOut();
      return {
        status: 'error',
        message: 'Your session could not be verified. Wait a moment and try again.',
      };
    }
  }

  if (suspended) {
    return { status: 'redirect', message: null, redirectTo: '/account-suspended' };
  }

  const fallback =
    typeof requestedRedirect === 'string' && requestedRedirect.startsWith('/admin')
      ? '/admin'
      : '/dashboard';
  redirect(
    sanitizeRedirectPath(
      typeof requestedRedirect === 'string' ? requestedRedirect : undefined,
      fallback,
    ),
  );
}
