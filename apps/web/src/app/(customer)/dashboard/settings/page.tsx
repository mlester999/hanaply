import { Card, LinkButton, PageHeader } from '@hanaply/ui';
import { Bell, Globe2, LockKeyhole } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Account Settings' };

export default function SettingsPage() {
  return (
    <div className="workspace-page">
      <PageHeader
        description="Manage your profile, security, and explicit email preferences."
        eyebrow="Customer dashboard"
        title="Settings"
      />
      <div className="settings-grid">
        <Card className="settings-card">
          <Globe2 aria-hidden="true" size={22} />
          <h2>Profile</h2>
          <p>Names, country, locale, and timezone with server validation and RLS.</p>
          <LinkButton href="/dashboard/settings/profile" size="sm" variant="secondary">
            Edit Profile
          </LinkButton>
        </Card>
        <Card className="settings-card">
          <LockKeyhole aria-hidden="true" size={22} />
          <h2>Security</h2>
          <p>Change your password and revoke other refresh sessions.</p>
          <LinkButton href="/dashboard/settings/security" size="sm" variant="secondary">
            Review Security
          </LinkButton>
        </Card>
        <Card className="settings-card">
          <Bell aria-hidden="true" size={22} />
          <h2>Notifications</h2>
          <p>Control optional product and marketing email consent.</p>
          <LinkButton href="/dashboard/settings/notifications" size="sm" variant="secondary">
            Email Preferences
          </LinkButton>
        </Card>
      </div>
    </div>
  );
}
