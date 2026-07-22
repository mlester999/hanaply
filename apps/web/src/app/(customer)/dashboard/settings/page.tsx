import { Alert, Card, PageHeader } from '@hanaply/ui';
import { Globe2, LockKeyhole, Settings } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Account Settings' };

export default function SettingsPage() {
  return (
    <div className="workspace-page">
      <PageHeader
        description="Account preferences will expand during the Phase 1 experience."
        eyebrow="Customer dashboard"
        title="Settings"
      />
      <Alert title="Settings are currently read-only" tone="info">
        The foundation stores configurable locale, timezone, and country defaults without exposing
        unsafe account-status fields.
      </Alert>
      <div className="settings-grid">
        <Card className="settings-card">
          <Globe2 aria-hidden="true" size={22} />
          <h2>Regional defaults</h2>
          <dl>
            <div>
              <dt>Locale</dt>
              <dd>English (Philippines)</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>Asia/Manila</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>PHP</dd>
            </div>
          </dl>
        </Card>
        <Card className="settings-card">
          <LockKeyhole aria-hidden="true" size={22} />
          <h2>Session controls</h2>
          <p>Session history and revocation controls arrive in Phase 1.</p>
        </Card>
        <Card className="settings-card">
          <Settings aria-hidden="true" size={22} />
          <h2>Career preferences</h2>
          <p>Main career, sub-careers, keywords, and exclusions arrive in Phase 3.</p>
        </Card>
      </div>
    </div>
  );
}
