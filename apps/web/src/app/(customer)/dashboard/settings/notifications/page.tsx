import { Badge, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { NotificationSettingsForm } from '@/components/notification-settings-form';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Notification Settings' };

export default async function NotificationSettingsPage() {
  const { session } = await requireUser();
  const result = await createAuthenticatedApiClient(session).preferences();
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">Explicit consent</Badge>}
        description="Security messages remain mandatory. Optional categories are controlled independently."
        eyebrow="Account settings"
        title="Notifications"
      />
      <NotificationSettingsForm value={result.data} />
    </div>
  );
}
