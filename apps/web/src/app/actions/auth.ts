'use server';

import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';

export async function logout(): Promise<never> {
  await assertTrustedMutationOrigin();
  const supabase = await createSupabaseServerClient();
  await supabase.rpc('record_my_auth_event', {
    requested_event_type: 'user.logged_out',
    requested_request_id: null,
  });
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login?loggedOut=1');
}
