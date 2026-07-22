import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getBrowserEnvironment } from '@/lib/environment';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const environment = getBrowserEnvironment();
  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const cookie of cookiesToSet) {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            }
          } catch {
            // Server Components cannot set cookies. Proxy refreshes sessions before rendering.
          }
        },
      },
    },
  );
}
