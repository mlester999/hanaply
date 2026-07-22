import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { Alert, Badge } from '@hanaply/ui';
import { MailCheck } from 'lucide-react';

import { VerificationResendForm } from '@/components/verification-resend-form';

export const metadata: Metadata = { title: 'Verify Email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; status?: string }>;
}) {
  const query = await searchParams;
  const cookieStore = await cookies();
  const hint = cookieStore.get('hanaply-verification-hint')?.value;
  return (
    <div className="auth-card">
      <Badge tone="success">Email verification</Badge>
      <MailCheck aria-hidden="true" className="auth-feature-icon" size={34} />
      <h1>Check your inbox.</h1>
      <p>
        {hint
          ? `We sent verification instructions to ${hint}.`
          : 'Use the verification link in your email to finish securing your account.'}
      </p>
      {query.status === 'invalid' ? (
        <Alert title="That verification link is no longer valid" tone="warning">
          Request a new link below. Reused and expired links are handled safely.
        </Alert>
      ) : null}
      {query.registered === '1' ? (
        <Alert title="Registration received" tone="info">
          Your paid access is not active. Verification only secures your new account.
        </Alert>
      ) : null}
      <ol className="auth-steps">
        <li>Open the newest message from Hanaply.</li>
        <li>Select Verify Email within one hour.</li>
        <li>Return here and sign in if the browser does not continue automatically.</li>
      </ol>
      <VerificationResendForm />
      <div className="auth-form-links">
        <Link href="/register">Use a different email</Link>
        <Link href="/login">Back to sign in</Link>
      </div>
      <p className="auth-support-copy">
        Still stuck? Visit <Link href="/help">Hanaply Help</Link> for safe support guidance.
      </p>
    </div>
  );
}
