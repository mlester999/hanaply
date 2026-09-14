import type { AiStatus } from '@hanaply/contracts';
import { Card, LinkButton, PageHeader } from '@hanaply/ui';
import { Bell, Globe2, LockKeyhole } from 'lucide-react';
import type { Metadata } from 'next';

import { AiStatusNotice } from '@/components/coach/ai-status-notice';
import { coachErrorMessage } from '@/lib/coach-action';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Account Settings' };

/**
 * Whether AI generation is available is part of the account surface, not a
 * hidden deployment detail: a member who reads that the coach or an analysis
 * exists deserves to be told when a model cannot write in this deployment. The
 * read is caught here so an unreadable status is reported as unreadable rather
 * than taking the settings page down.
 */
async function readAiStatus(): Promise<{ status: AiStatus | null; unavailable: string | null }> {
  try {
    const { session } = await requireUser();
    return {
      status: (await createAuthenticatedApiClient(session).aiStatus()).data.status,
      unavailable: null,
    };
  } catch (error) {
    return {
      status: null,
      unavailable: coachErrorMessage(error, 'Hanaply could not read whether AI is configured.'),
    };
  }
}

export default async function SettingsPage() {
  const { status, unavailable } = await readAiStatus();

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
        <AiStatusNotice status={status} unavailable={unavailable} variant="settings" />
      </div>
    </div>
  );
}
