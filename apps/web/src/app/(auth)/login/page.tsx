import { Badge } from '@hanaply/ui';
import type { Metadata } from 'next';

import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: 'Sign In' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="auth-card">
      <Badge tone="brand">Customer access</Badge>
      <h1>Welcome back.</h1>
      <p>Sign in to continue to your protected Hanaply workspace.</p>
      <LoginForm {...(next ? { nextPath: next } : {})} />
    </div>
  );
}
