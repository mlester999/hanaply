import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './generated.types.js';

export type { Database, Json } from './generated.types.js';

const statelessAuth = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export function createPublicDatabaseClient(
  url: string,
  publishableKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(url, publishableKey, { auth: statelessAuth });
}

export function createUserDatabaseClient(
  url: string,
  publishableKey: string,
  accessToken: string,
): SupabaseClient<Database> {
  return createClient<Database>(url, publishableKey, {
    auth: statelessAuth,
    accessToken: () => Promise.resolve(accessToken),
  });
}

export function createServiceDatabaseClient(
  url: string,
  serviceRoleKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(url, serviceRoleKey, { auth: statelessAuth });
}
