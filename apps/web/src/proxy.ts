import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { getBrowserEnvironment } from '@/lib/environment';

function createContentSecurityPolicy(nonce: string, request: NextRequest): string {
  const environment = getBrowserEnvironment();
  const apiOrigin = new URL(environment.NEXT_PUBLIC_API_URL).origin;
  const supabaseOrigin = new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin;
  const development = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${supabaseOrigin}${development ? ` ws: wss: ${request.nextUrl.origin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    development ? '' : 'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');
}

function applySecurityHeaders(response: NextResponse, policy: string): void {
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function copyCookies(source: NextResponse, destination: NextResponse): void {
  for (const cookie of source.cookies.getAll()) destination.cookies.set(cookie.name, cookie.value);
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/admin' ||
    (pathname.startsWith('/admin/') && pathname !== '/admin/login')
  );
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = createContentSecurityPolicy(nonce, request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const environment = getBrowserEnvironment();
  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const cookie of cookiesToSet) request.cookies.set(cookie.name, cookie.value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    },
  );

  const claims = await supabase.auth.getClaims();
  if (isProtectedPath(request.nextUrl.pathname) && !claims.data?.claims.sub) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = request.nextUrl.pathname.startsWith('/admin') ? '/admin/login' : '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const redirectResponse = NextResponse.redirect(loginUrl);
    copyCookies(response, redirectResponse);
    applySecurityHeaders(redirectResponse, policy);
    return redirectResponse;
  }

  applySecurityHeaders(response, policy);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
