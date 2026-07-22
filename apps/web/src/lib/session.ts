import { createApiClient, HanaplyApiError } from '@hanaply/contracts';
import { redirect } from 'next/navigation';

import { getBrowserEnvironment } from '@/lib/environment';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface VerifiedWebSession {
  userId: string;
  accessToken: string;
}

export async function getVerifiedWebSession(): Promise<VerifiedWebSession | null> {
  const supabase = await createSupabaseServerClient();
  const claimsResult = await supabase.auth.getClaims();
  const userId = claimsResult.data?.claims.sub;
  if (!userId) return null;
  const sessionResult = await supabase.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;
  if (!accessToken) return null;
  return { userId, accessToken };
}

export async function requireUser() {
  const session = await getVerifiedWebSession();
  if (!session) redirect('/login?next=/dashboard');
  const environment = getBrowserEnvironment();
  const client = createApiClient({
    baseUrl: environment.NEXT_PUBLIC_API_URL,
    getAccessToken: () => Promise.resolve(session.accessToken),
  });
  try {
    const me = await client.me();
    if (me.data.profile.accountStatus === 'suspended') redirect('/account-suspended');
    return { session, me: me.data };
  } catch (error) {
    if (error instanceof HanaplyApiError && error.envelope.error.code === 'ACCOUNT_SUSPENDED') {
      redirect('/account-suspended');
    }
    throw error;
  }
}

export async function requireAdmin() {
  const { session, me } = await requireUser();
  const environment = getBrowserEnvironment();
  const client = createApiClient({
    baseUrl: environment.NEXT_PUBLIC_API_URL,
    getAccessToken: () => Promise.resolve(session.accessToken),
  });
  try {
    const admin = await client.adminMe();
    return { session, me, admin: admin.data };
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 403) redirect('/forbidden');
    throw error;
  }
}
