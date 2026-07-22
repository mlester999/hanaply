import { sanitizeRedirectPath } from '@hanaply/auth';
import { type NextRequest, NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = sanitizeRedirectPath(request.nextUrl.searchParams.get('next'));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (!result.error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL('/login?error=callback', request.url));
}
