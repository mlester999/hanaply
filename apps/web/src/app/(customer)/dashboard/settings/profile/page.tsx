import { Badge, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { ProfileSettingsForm } from '@/components/profile-settings-form';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Profile Settings' };

export default async function ProfileSettingsPage() {
  const { me } = await requireUser();
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="success">RLS protected</Badge>}
        description="Update only the identity and regional fields your account is allowed to control."
        eyebrow="Account settings"
        title="Profile"
      />
      <ProfileSettingsForm profile={me.profile} />
    </div>
  );
}
