import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { requireAdmin } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { me } = await requireAdmin();
  return (
    <AppShell admin displayName={me.profile.displayName ?? 'Hanaply administrator'}>
      {children}
    </AppShell>
  );
}
