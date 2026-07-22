import { Badge } from '@hanaply/ui';
import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { BrandLogo } from '@/components/brand-logo';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: 'Admin Sign In' };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="admin-login-page" id="main-content">
      <div className="admin-login-brand">
        <BrandLogo />
        <span>
          <ShieldCheck aria-hidden="true" size={18} /> Explicit administrator membership required
        </span>
      </div>
      <div className="auth-card admin-login-card">
        <Badge tone="danger">Restricted administration</Badge>
        <h1>Admin access</h1>
        <p>
          Authentication alone does not grant administration. Active database membership and
          explicit permissions are checked after sign in.
        </p>
        <LoginForm admin {...(next ? { nextPath: next } : {})} />
      </div>
    </main>
  );
}
