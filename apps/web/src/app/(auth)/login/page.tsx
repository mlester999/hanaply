import { Alert, Badge } from '@hanaply/ui';
import type { Metadata } from 'next';

import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: 'Sign In' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; loggedOut?: string; password?: string; error?: string }>;
}) {
  const { next, loggedOut, password, error } = await searchParams;
  return (
    <div className="auth-card">
      <Badge tone="brand">Customer access</Badge>
      <h1>Welcome back.</h1>
      <p>Sign in to continue to your protected Hanaply workspace.</p>
      {password === 'changed' ? (
        <Alert title="Password changed" tone="success">
          Sign in with your new password. Other sessions were revoked.
        </Alert>
      ) : null}
      {loggedOut === '1' ? (
        <Alert title="Signed out" tone="info">
          Protected account data is no longer available in this browser session.
        </Alert>
      ) : null}
      {error ? (
        <Alert title="Session could not be completed" tone="warning">
          Start again from a current sign-in or email link.
        </Alert>
      ) : null}
      <LoginForm {...(next ? { nextPath: next } : {})} />
    </div>
  );
}
