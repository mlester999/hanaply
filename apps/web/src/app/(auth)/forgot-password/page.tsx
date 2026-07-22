import type { Metadata } from 'next';

import { Alert, Badge } from '@hanaply/ui';

import { ForgotPasswordForm } from '@/components/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot Password' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  return (
    <div className="auth-card">
      <Badge tone="brand">Account recovery</Badge>
      <h1>Reset your password.</h1>
      <p>Enter your email address. The response stays generic to protect account privacy.</p>
      {status === 'invalid' ? (
        <Alert title="That recovery link is invalid or expired" tone="warning">
          Request a fresh link below. Only the newest valid link should be used.
        </Alert>
      ) : null}
      <ForgotPasswordForm />
    </div>
  );
}
