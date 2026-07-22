import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { Alert, Badge, LinkButton } from '@hanaply/ui';

import { ResetPasswordForm } from '@/components/reset-password-form';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Reset Password' };

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const supabase = await createSupabaseServerClient();
  const claims = await supabase.auth.getClaims();
  const validRecovery =
    cookieStore.get('hanaply-recovery-flow')?.value === 'verified' &&
    Boolean(claims.data?.claims.sub);
  return (
    <div className="auth-card">
      <Badge tone="brand">Secure password reset</Badge>
      <h1>Choose a new password.</h1>
      <p>A successful reset signs out every existing Hanaply session for this account.</p>
      {validRecovery ? (
        <ResetPasswordForm />
      ) : (
        <>
          <Alert title="Recovery session required" tone="warning">
            This page must be opened from a current password reset email. The link may have expired
            or already been used.
          </Alert>
          <LinkButton block href="/forgot-password" variant="secondary">
            Request a New Reset Link
          </LinkButton>
        </>
      )}
    </div>
  );
}
