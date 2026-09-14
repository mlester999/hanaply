import { Badge, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { NotificationSettingsForm } from '@/components/notification-settings-form';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Notification Settings' };

export default async function NotificationSettingsPage() {
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  // The plan is read from the API's evaluated entitlements rather than from a
  // hard-coded plan name, so the page states the same requirement the API
  // enforces when a save is attempted.
  const [preferences, entitlements] = await Promise.all([
    client.preferences(),
    client.entitlements(),
  ]);
  const included = entitlements.data.entitlements;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">Explicit consent</Badge>}
        description="Security messages remain mandatory. Opportunity alerts, the daily digest, instant alerts, and the weekly strategy need both your consent and a plan that includes them."
        eyebrow="Account settings"
        title="Notifications"
      />
      <NotificationSettingsForm
        plan={{
          jobAlerts: included.emailAlerts === true,
          dailyDigest: included.dailyDigest === true,
          instantAlerts: included.instantAlerts === true,
          weeklyStrategy: included.weeklyAiCareerStrategy === true,
        }}
        value={preferences.data}
      />
    </div>
  );
}
