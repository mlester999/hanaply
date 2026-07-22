import { sanitizeRedirectPath } from '@hanaply/auth';
import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const requestedType = request.nextUrl.searchParams.get('type');
  const flow = request.nextUrl.searchParams.get('flow') ?? requestedType;
  const recovery = flow === 'recovery';
  const next = recovery
    ? '/reset-password'
    : sanitizeRedirectPath(request.nextUrl.searchParams.get('next'));
  const supabase = await createSupabaseServerClient();
  const allowedTypes = new Set<EmailOtpType>([
    'signup',
    'recovery',
    'invite',
    'email_change',
    'magiclink',
    'email',
  ]);

  let verified = false;
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    verified = !result.error;
  } else if (tokenHash && requestedType && allowedTypes.has(requestedType)) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: requestedType,
    });
    verified = !result.error;
  }

  if (!verified) {
    const existingClaims = await supabase.auth.getClaims();
    if (!existingClaims.data?.claims.sub) {
      const failurePath = recovery
        ? '/forgot-password?status=invalid'
        : '/verify-email?status=invalid';
      return NextResponse.redirect(new URL(failurePath, request.url));
    }
  }

  const reconciliation = await supabase.rpc('reconcile_my_profile');
  if (reconciliation.error) {
    await supabase.auth.signOut({ scope: 'local' });
    return NextResponse.redirect(new URL('/login?error=profile', request.url));
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.delete('hanaply-verification-hint');
  if (recovery) {
    response.cookies.set('hanaply-recovery-flow', 'verified', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/reset-password',
      maxAge: 15 * 60,
    });
  }
  return response;
}
