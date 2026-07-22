'use server';

import { sanitizeRedirectPath } from '@hanaply/auth';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface LoginState {
  status: 'idle' | 'error';
  message: string | null;
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
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
