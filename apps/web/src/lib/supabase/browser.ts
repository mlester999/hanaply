'use client';

import { createBrowserClient } from '@supabase/ssr';

import { getBrowserEnvironment } from '@/lib/environment';

export function createSupabaseBrowserClient() {
  const environment = getBrowserEnvironment();
  return createBrowserClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
