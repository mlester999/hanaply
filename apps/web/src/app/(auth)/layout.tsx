import type { ReactNode } from 'react';

import { AuthBrandPanel } from '@/components/auth-brand-panel';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell" id="main-content" tabIndex={-1}>
      <AuthBrandPanel />
      <section className="auth-content">{children}</section>
    </main>
  );
}
