import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { requireUser } from '@/lib/session';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { me } = await requireUser();
  return (
    <AppShell
      displayName={me.profile.displayName ?? 'Hanaply member'}
      onboardingIncomplete={me.profile.onboardingStatus !== 'complete'}
    >
      {children}
    </AppShell>
  );
}
