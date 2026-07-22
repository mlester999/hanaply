import { Badge } from '@hanaply/ui';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand-logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-brand-panel">
        <BrandLogo />
        <div className="auth-brand-copy">
          <Badge tone="success">Secure account foundation</Badge>
          <h1>One trusted profile for every stronger application.</h1>
          <p>
            Hanaply’s web session uses Supabase Auth while career intelligence stays behind a
            versioned, mobile-ready API.
          </p>
        </div>
        <div className="auth-trust-note">
          <ShieldCheck aria-hidden="true" size={20} />
          <span>Passwords and session tokens are never logged.</span>
        </div>
      </section>
      <section className="auth-content">{children}</section>
    </main>
  );
}
