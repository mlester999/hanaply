'use server';

import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';

export async function logout(): Promise<never> {
  await assertTrustedMutationOrigin();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
